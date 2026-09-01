const db = require('../../../config/database');
const integrationsConfig = require('../../../config/integrations.config');

const redondear = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const texto = (value) => String(value ?? '').trim();
const mayusculas = (value) => texto(value).toUpperCase();

const mediosPago = (rows = []) => [...new Set(rows
    .map(row => mayusculas(row.medio_pago || row.tipocontado_key))
    .filter(Boolean))]
    .sort()
    .join(', ');

const agregarSi = (lista, condicion, mensaje) => {
    if (condicion && !lista.includes(mensaje)) lista.push(mensaje);
};

const construirResumen = ({ contexto, detalle, descuento, pagos, serie }) => {
    const errores = [];
    const advertencias = [];
    const facturacionGuardada = Boolean(contexto.facturacion_id);
    const productoConfigurado = Boolean(detalle?.producto_facturacion_id);
    const productoActivo = detalle?.producto_activo !== false;
    const tipoComprobante = mayusculas(contexto.tipo_comprobante);
    const esFactura = tipoComprobante === 'FACTURA';
    const seriePrevista = texto(contexto.serie_asignada)
        || texto(esFactura ? serie?.seriefactura : serie?.serieboleta).toUpperCase();

    const precioLista = redondear(descuento?.importe_original ?? detalle?.tarifa_precio ?? contexto.importe_total);
    const importeDescuento = redondear(descuento?.importe_descuento || 0);
    const total = redondear(contexto.importe_total ?? descuento?.importe_final ?? precioLista);
    const baseImponible = redondear(contexto.base_imponible ?? (total / 1.18));
    const igv = redondear(contexto.igv ?? (total - baseImponible));
    const cantidad = Number(detalle?.cantidad || 1);
    const unidad = mayusculas(detalle?.producto_unidad || detalle?.unidad_snapshot);
    const codigoInterno = texto(detalle?.producto_sku || detalle?.codigo_sku_snapshot || detalle?.servicio_codigo);
    const codigoSunat = texto(detalle?.producto_codigo_sunat || detalle?.codigo_sunat_snapshot);
    const descripcion = texto(detalle?.producto_descripcion || detalle?.descripcion_snapshot || detalle?.servicio_nombre);
    const afectacionIgv = texto(detalle?.producto_afectacion_igv || detalle?.afectacion_igv_snapshot);
    const condicionPago = mayusculas(contexto.condicion_pago || contexto.formapago_key || 'CONTADO');
    const medioPago = texto(contexto.medio_pago) || mediosPago(pagos) || null;
    const credenciales = contexto.credencial_clave
        ? integrationsConfig.nubefact.obtenerCredenciales(contexto.credencial_clave)
        : null;

    agregarSi(errores, !facturacionGuardada, 'Guarde los datos de facturación antes de emitir.');
    agregarSi(errores, !texto(contexto.ruc_emisor) || !/^\d{11}$/.test(texto(contexto.ruc_emisor)), 'El RUC de la empresa emisora no está configurado correctamente.');
    agregarSi(errores, !texto(contexto.razon_social_emisor), 'La razón social de la empresa emisora no está configurada.');
    agregarSi(errores, !texto(contexto.sede_nombre), 'La sede emisora no está configurada.');
    agregarSi(errores, !productoConfigurado, 'La tarifa seleccionada no tiene un producto de facturación vinculado.');
    agregarSi(errores, productoConfigurado && !productoActivo, 'El producto de facturación vinculado está inactivo.');
    agregarSi(errores, !codigoInterno, 'Falta el código interno/SKU del servicio.');
    agregarSi(errores, !descripcion, 'Falta la descripción tributaria del servicio.');
    agregarSi(errores, !unidad, 'Falta la unidad de medida tributaria del servicio.');
    agregarSi(errores, Boolean(unidad) && unidad !== 'ZZ', 'La unidad tributaria del servicio debe ser ZZ.');
    agregarSi(errores, !codigoSunat, 'Falta el código de clasificación SUNAT del servicio.');
    agregarSi(errores, Boolean(codigoSunat) && !/^\d{8}$/.test(codigoSunat), 'El código de clasificación SUNAT debe contener 8 dígitos.');
    agregarSi(errores, !/^\d{2}$/.test(afectacionIgv), 'Falta el tipo de afectación IGV del servicio.');
    agregarSi(errores, !seriePrevista, `No existe una serie productiva de ${esFactura ? 'factura' : 'boleta'} para la sede.`);
    agregarSi(errores, !Number.isFinite(total) || total <= 0, 'El total de la operación no es válido.');
    agregarSi(errores, Math.abs(redondear(baseImponible + igv) - total) > 0.01, 'La base imponible y el IGV no coinciden con el total.');
    agregarSi(advertencias, !texto(contexto.email), 'No se registró un correo; Nubefact no enviará automáticamente el comprobante al cliente.');
    agregarSi(advertencias, !integrationsConfig.nubefact.enabled, 'Nubefact está deshabilitado en el backend.');
    agregarSi(advertencias, integrationsConfig.nubefact.simulationEnabled, 'El backend está en modo simulación y no enviará el comprobante a Nubefact/SUNAT.');
    agregarSi(advertencias, Boolean(contexto.credencial_clave) && !(credenciales?.apiUrl && credenciales?.token), 'La empresa emisora no tiene ruta y token Nubefact disponibles en variables de entorno.');

    const item = {
        orden: Number(detalle?.orden || 1),
        productoFacturacionId: detalle?.producto_facturacion_id ? Number(detalle.producto_facturacion_id) : null,
        codigoInterno,
        codigoSunat: codigoSunat || null,
        descripcion,
        unidad: unidad || null,
        cantidad,
        afectacionIgv: afectacionIgv || null,
        valorUnitario: redondear((precioLista / Math.max(cantidad, 1)) / 1.18),
        precioUnitario: redondear(precioLista / Math.max(cantidad, 1)),
        descuentoSinIgv: redondear(importeDescuento / 1.18),
        baseImponible,
        igv,
        total
    };

    return {
        estado: errores.length === 0 ? 'LISTO' : 'INCOMPLETO',
        errores,
        advertencias,
        emisor: {
            empresaKey: texto(contexto.empresa_key) || null,
            razonSocial: texto(contexto.razon_social_emisor) || null,
            ruc: texto(contexto.ruc_emisor) || null,
            direccion: texto(contexto.direccion_emisor) || null
        },
        sede: {
            key: texto(contexto.planta_key) || null,
            nombre: texto(contexto.sede_nombre) || null,
            direccion: texto(contexto.sede_direccion) || null
        },
        integracion: {
            proveedor: 'NUBEFACT',
            entorno: mayusculas(contexto.entorno_facturador || integrationsConfig.nubefact.environment || 'DEMO'),
            habilitada: integrationsConfig.nubefact.enabled,
            simulacion: integrationsConfig.nubefact.simulationEnabled,
            configurada: Boolean(credenciales?.apiUrl && credenciales?.token)
        },
        comprobante: {
            tipo: tipoComprobante || null,
            serie: seriePrevista || null,
            numero: contexto.numero_asignado === null || contexto.numero_asignado === undefined
                ? null
                : Number(contexto.numero_asignado),
            numeroAsignado: contexto.numero_asignado !== null && contexto.numero_asignado !== undefined,
            fuenteSerie: 'COMPARTIDO_FARENET'
        },
        cliente: {
            tipoDocumento: texto(contexto.tipo_documento_cliente) || null,
            numeroDocumento: texto(contexto.nro_documento) || null,
            nombreRazonSocial: texto(contexto.nombre_razon_social) || null,
            direccion: texto(contexto.direccion_cliente) || null,
            email: texto(contexto.email) || null
        },
        items: [item],
        totales: {
            moneda: mayusculas(contexto.moneda_key) === 'SOL' ? 'PEN' : mayusculas(contexto.moneda_key || 'PEN'),
            precioAntesDescuento: precioLista,
            descuento: importeDescuento,
            baseImponible,
            igv,
            total
        },
        pago: {
            condicion: condicionPago === 'CREDITO' ? 'CREDITO' : 'CONTADO',
            medio: medioPago,
            fechaVencimiento: contexto.fecha_vencimiento || null
        }
    };
};

const obtenerContexto = async (certificadoId, queryable) => {
    const result = await queryable.query(`
        SELECT c.id AS certificado_id, c.planta_key, c.tarifa_codigo,
               p.nombre AS sede_nombre, p.direccion AS sede_direccion,
               e.key AS empresa_key, e.nombre AS razon_social_emisor,
               e.ruc AS ruc_emisor, e.direccion AS direccion_emisor,
               ef.entorno AS entorno_facturador, ef.credencial_clave,
               f.id AS facturacion_id, f.tipo_comprobante, f.tipo_documento_cliente,
               f.nro_documento, f.nombre_razon_social, f.direccion AS direccion_cliente,
               f.email, f.moneda_key, f.base_imponible, f.igv, f.importe_total,
               f.condicion_pago, f.fecha_vencimiento, f.medio_pago,
               f.serie AS serie_asignada, f.numero AS numero_asignado,
               op.id AS orden_pago_id, op.formapago_key
        FROM fg_certificado c
        JOIN fg_planta p ON p.key = c.planta_key
        JOIN fg_empresa e ON e.key = p.empresa_key
        LEFT JOIN fg_empresa_facturador ef
          ON ef.empresa_key = e.key
         AND ef.proveedor = 'NUBEFACT'
         AND ef.entorno = $2
         AND ef.activo = TRUE
        LEFT JOIN fg_facturacion f ON f.certificado_id = c.id
        LEFT JOIN fg_orden_pago op ON op.certificado_id = c.id
        WHERE c.id = $1
        LIMIT 1
    `, [certificadoId, integrationsConfig.nubefact.environment]);
    if (result.rowCount === 0) {
        const error = new Error('CERTIFICADO_NOT_FOUND');
        error.code = 'CERTIFICADO_NOT_FOUND';
        throw error;
    }
    return result.rows[0];
};

const obtenerDetalle = async (contexto, queryable) => {
    if (!contexto.tarifa_codigo) return null;
    const result = await queryable.query(`
        SELECT od.id AS detalle_id, od.cantidad, od.orden,
               od.codigo_sku_snapshot, od.descripcion_snapshot, od.unidad_snapshot,
               od.afectacion_igv_snapshot, od.codigo_sunat_snapshot,
               t.id AS tarifa_id, t.precio AS tarifa_precio,
               s.id AS servicio_id, s.codigo AS servicio_codigo, s.nombre AS servicio_nombre,
               pf.id AS producto_facturacion_id, pf.codigo_sku AS producto_sku,
               pf.descripcion AS producto_descripcion, pf.unidad AS producto_unidad,
               pf.codigo_clasificacion_sunat AS producto_codigo_sunat,
               pf.tipo_afectacion_igv AS producto_afectacion_igv,
               pf.activo AS producto_activo
        FROM fg_tarifa t
        JOIN fg_servicio s ON s.id = t.servicio_id
        LEFT JOIN fg_operacion_detalle od
          ON od.certificado_id = $3
         AND od.tarifa_id = t.id
        LEFT JOIN fg_producto_facturacion pf
          ON pf.id = COALESCE(od.producto_facturacion_id, t.producto_facturacion_id)
        WHERE t.planta_key = $1
          AND t.codigo = $2
          AND t.activo = TRUE
          AND s.activo = TRUE
        ORDER BY od.id DESC NULLS LAST
        LIMIT 1
    `, [contexto.planta_key, contexto.tarifa_codigo, contexto.certificado_id]);
    return result.rows[0] || null;
};

const obtenerDescuento = async (certificadoId, queryable) => {
    const result = await queryable.query(`
        SELECT importe_original, importe_descuento, importe_final, estado
        FROM fg_descuentocomprobante
        WHERE certificado_id = $1
          AND estado IN ('RESERVADO', 'APLICADO')
        ORDER BY id DESC
        LIMIT 1
    `, [certificadoId]);
    return result.rows[0] || null;
};

const obtenerPagos = async (ordenPagoId, queryable) => {
    if (!ordenPagoId) return [];
    const result = await queryable.query(`
        SELECT DISTINCT tipocontado_key AS medio_pago
        FROM fg_pago
        WHERE orden_pago_id = $1
          AND estado = 'CAN'
          AND tipocontado_key IS NOT NULL
        ORDER BY tipocontado_key
    `, [ordenPagoId]);
    return result.rows;
};

const obtenerSerie = async (plantaKey, queryable) => {
    const result = await queryable.query(`
        SELECT serieboleta, seriefactura, nroactualboleta, nroactualfactura
        FROM seriedocumentobase
        WHERE planta_key = $1
          AND COALESCE(estado, TRUE) = TRUE
        ORDER BY id DESC
        LIMIT 1
    `, [plantaKey]);
    return result.rows[0] || null;
};

exports.obtenerResumenTributario = async (certificadoId, queryable = db) => {
    const contexto = await obtenerContexto(certificadoId, queryable);
    const [detalle, descuento, pagos, serie] = await Promise.all([
        obtenerDetalle(contexto, queryable),
        obtenerDescuento(certificadoId, queryable),
        obtenerPagos(contexto.orden_pago_id, queryable),
        obtenerSerie(contexto.planta_key, queryable)
    ]);
    return construirResumen({ contexto, detalle, descuento, pagos, serie });
};

exports.construirDetallesNubefact = (resumen) => (resumen?.items || []).map(item => ({
    orden: item.orden,
    producto_facturacion_id: item.productoFacturacionId,
    unidad_snapshot: item.unidad,
    codigo_sku_snapshot: item.codigoInterno,
    codigo_sunat_snapshot: item.codigoSunat,
    descripcion_snapshot: item.descripcion,
    cantidad: item.cantidad,
    valor_unitario: item.valorUnitario,
    precio_unitario: item.precioUnitario,
    descuento: item.descuentoSinIgv,
    base_imponible: item.baseImponible,
    afectacion_igv_snapshot: item.afectacionIgv,
    igv: item.igv,
    importe_total: item.total
}));

exports._private = {
    construirResumen,
    mediosPago,
    redondear
};
