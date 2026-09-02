const db = require('../../../config/database');
const integrationsConfig = require('../../../config/integrations.config');
const resumenTributarioService = require('./faregas-resumen-tributario.service');
const nubefactConfigService = require('./faregas-nubefact-config.service');

const check = (codigo, estado, mensaje, detalles = null) => ({ codigo, estado, mensaje, detalles });

const obtenerMigracionV2 = async (queryable) => {
    const result = await queryable.query(`
        SELECT COUNT(*)::int AS columnas
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'fg_serie_comprobante'
          AND column_name IN ('confirmada_produccion', 'numero_inicial_confirmado', 'fecha_corte')
    `);
    return Number(result.rows[0]?.columnas || 0) === 3;
};

const construirChecksCertificado = ({ resumen, integracion }) => {
    const checks = [];
    const agregar = (codigo, condicion, mensajeOk, mensajeError, detalles = null) => {
        checks.push(check(codigo, condicion ? 'OK' : 'BLOQUEO', condicion ? mensajeOk : mensajeError, detalles));
    };

    agregar('CLIENTE', Boolean(resumen?.cliente?.numeroDocumento && resumen?.cliente?.nombreRazonSocial),
        'Los datos fiscales del cliente están completos.', 'Faltan datos fiscales del cliente.');
    agregar('CATALOGO_FISCAL', resumen?.items?.length > 0 && resumen.items.every(item => item.productoFacturacionId),
        'La tarifa tiene producto fiscal vinculado.', 'La tarifa no tiene producto fiscal vinculado.');
    agregar('CALCULOS', Boolean(resumen?.totales?.total > 0)
        && Math.abs(Number(resumen?.totales?.baseImponible || 0) + Number(resumen?.totales?.igv || 0) - Number(resumen?.totales?.total || 0)) <= 0.01,
    'Los totales tributarios son consistentes.', 'Los totales tributarios no son consistentes.');
    agregar('SERIE', Boolean(resumen?.comprobante?.serie),
        'Existe una serie prevista.', 'No existe una serie tributaria prevista.');
    agregar('EMPRESA_EMISORA', Boolean(resumen?.emisor?.ruc && resumen?.emisor?.razonSocial),
        'La empresa emisora está identificada.', 'Falta configurar la empresa emisora.');
    agregar('CREDENCIALES', Boolean(integracion?.configured),
        'Las credenciales están disponibles en el backend.', 'No hay credenciales disponibles para la empresa.');
    agregar('DETRACCION', integrationsConfig.nubefact.detractionDecision !== 'PENDIENTE',
        'La decisión sobre detracción está registrada.', 'La decisión sobre detracción continúa pendiente.');
    agregar('MOTOR_CORRELATIVOS_V2', integrationsConfig.nubefact.correlativosV2Enabled,
        'El motor tributario V2 está habilitado.', 'El motor tributario V2 permanece deshabilitado.');
    agregar('INTEGRACION', integrationsConfig.nubefact.enabled,
        'La integración Nubefact está habilitada.', 'Nubefact está deshabilitado de forma segura.');

    for (const mensaje of resumen?.advertencias || []) {
        checks.push(check('ADVERTENCIA_TRIBUTARIA', 'ADVERTENCIA', mensaje));
    }
    for (const mensaje of resumen?.errores || []) {
        if (!checks.some(item => item.mensaje === mensaje)) {
            checks.push(check('VALIDACION_TRIBUTARIA', 'BLOQUEO', mensaje));
        }
    }
    const bloqueos = checks.filter(item => item.estado === 'BLOQUEO').length;
    return {
        estado: bloqueos === 0 ? 'LISTO' : 'BLOQUEADO',
        bloqueos,
        advertencias: checks.filter(item => item.estado === 'ADVERTENCIA').length,
        checks
    };
};

exports.evaluarCertificado = async (certificadoId, queryable = db) => {
    const resumen = await resumenTributarioService.obtenerResumenTributario(certificadoId, queryable);
    const integracion = await nubefactConfigService.obtenerEstadoParaPlanta(resumen.sede.key, queryable);
    return {
        ...construirChecksCertificado({ resumen, integracion }),
        certificadoId,
        evaluadoEn: new Date().toISOString(),
        resumen
    };
};

exports.obtenerPanel = async ({ plantaKey = null } = {}, queryable = db) => {
    const filtroTarifa = plantaKey ? 'AND t.planta_key = $1' : '';
    const filtroSerie = plantaKey ? 'AND s.planta_key = $1' : '';
    const valores = plantaKey ? [plantaKey] : [];
    const migracionV2Aplicada = await obtenerMigracionV2(queryable);
    const [tarifas, series, facturadores, documentos] = await Promise.all([
        queryable.query(`
            SELECT COUNT(*) FILTER (WHERE t.activo)::int AS activas,
                   COUNT(*) FILTER (WHERE t.activo AND t.producto_facturacion_id IS NOT NULL)::int AS vinculadas,
                   COUNT(*) FILTER (WHERE t.activo AND t.producto_facturacion_id IS NULL)::int AS sin_vincular,
                   COUNT(*) FILTER (WHERE t.activo AND t.producto_facturacion_id IS NOT NULL
                     AND pf.activo AND pf.es_para_venta AND UPPER(BTRIM(pf.unidad)) = 'ZZ'
                     AND BTRIM(pf.tipo_afectacion_igv) = '10'
                     AND (COALESCE(BTRIM(pf.codigo_clasificacion_sunat), '') = ''
                       OR BTRIM(pf.codigo_clasificacion_sunat) ~ '^\\d{8}$'))::int AS listas
            FROM fg_tarifa t
            LEFT JOIN fg_producto_facturacion pf ON pf.id = t.producto_facturacion_id
            WHERE TRUE ${filtroTarifa}
        `, valores),
        queryable.query(`
            SELECT COUNT(*) FILTER (WHERE s.activo)::int AS activas,
                   COUNT(*) FILTER (WHERE s.activo AND s.es_predeterminada)::int AS predeterminadas,
                   COUNT(*) FILTER (WHERE s.activo AND s.ultimo_numero >= 99999000)::int AS proximas_agotarse
                   ${migracionV2Aplicada ? ", COUNT(*) FILTER (WHERE s.activo AND s.confirmada_produccion)::int AS confirmadas_produccion" : ''}
            FROM fg_serie_comprobante s WHERE TRUE ${filtroSerie}
        `, valores),
        queryable.query(`
            SELECT entorno, COUNT(*)::int AS cantidad
            FROM fg_empresa_facturador
            WHERE proveedor = 'NUBEFACT' AND activo = TRUE
            GROUP BY entorno ORDER BY entorno
        `),
        queryable.query(`
            SELECT estado, COUNT(*)::int AS cantidad
            FROM fg_facturacion
            GROUP BY estado ORDER BY estado
        `)
    ]);

    const t = tarifas.rows[0] || {};
    const s = series.rows[0] || {};
    const bloqueos = [];
    if (Number(t.sin_vincular || 0) > 0) bloqueos.push(`${t.sin_vincular} tarifas activas no tienen producto fiscal.`);
    if (!migracionV2Aplicada) bloqueos.push('La migración del motor de correlativos V2 no está aplicada.');
    if (!integrationsConfig.nubefact.correlativosV2Enabled) bloqueos.push('El motor de correlativos V2 está deshabilitado.');
    if (integrationsConfig.nubefact.detractionDecision === 'PENDIENTE') bloqueos.push('La decisión sobre detracción está pendiente.');
    if (!integrationsConfig.nubefact.enabled) bloqueos.push('Nubefact está deshabilitado.');

    return {
        estado: bloqueos.length === 0 ? 'LISTO' : 'BLOQUEADO',
        bloqueos,
        configuracion: {
            environment: integrationsConfig.nubefact.environment,
            enabled: integrationsConfig.nubefact.enabled,
            productionConfirmed: integrationsConfig.nubefact.productionConfirmed,
            correlativosV2Enabled: integrationsConfig.nubefact.correlativosV2Enabled,
            detractionDecision: integrationsConfig.nubefact.detractionDecision,
            migracionV2Aplicada
        },
        catalogo: {
            activas: Number(t.activas || 0),
            vinculadas: Number(t.vinculadas || 0),
            sinVincular: Number(t.sin_vincular || 0),
            listas: Number(t.listas || 0)
        },
        series: {
            activas: Number(s.activas || 0),
            predeterminadas: Number(s.predeterminadas || 0),
            confirmadasProduccion: migracionV2Aplicada ? Number(s.confirmadas_produccion || 0) : 0,
            proximasAgotarse: Number(s.proximas_agotarse || 0)
        },
        facturadores: facturadores.rows,
        documentos: documentos.rows,
        monitoreo: {
            pendientes: Number(documentos.rows.find(row => row.estado === 'PENDIENTE')?.cantidad || 0),
            errores: Number(documentos.rows.find(row => row.estado === 'ERROR')?.cantidad || 0),
            rechazados: Number(documentos.rows.find(row => row.estado === 'RECHAZADO')?.cantidad || 0),
            aceptados: Number(documentos.rows.find(row => row.estado === 'ACEPTADO')?.cantidad || 0)
        },
        evaluadoEn: new Date().toISOString()
    };
};

exports._private = { construirChecksCertificado, obtenerMigracionV2, check };
