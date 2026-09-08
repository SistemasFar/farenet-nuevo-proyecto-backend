const db = require('../../../config/database');
const integrationsConfig = require('../../../config/integrations.config');
const resumenTributarioService = require('./faregas-resumen-tributario.service');
const nubefactConfigService = require('./faregas-nubefact-config.service');
const { esRucValido } = require('./faregas-facturacion.rules');
const { UNIDADES_TRIBUTARIAS_ADMITIDAS } = require('./faregas-producto-fiscal.rules');

const check = (codigo, estado, mensaje, detalles = null) => ({ codigo, estado, mensaje, detalles });

const obtenerMigracionV2 = async (queryable) => {
    const result = await queryable.query(`
        SELECT COUNT(*)::int AS columnas
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'fg_serie_comprobante'
          AND column_name IN (
            'empresa_key', 'proveedor_emision', 'entorno_emision',
            'confirmada_produccion', 'numero_inicial_confirmado', 'fecha_corte'
          )
    `);
    return Number(result.rows[0]?.columnas || 0) === 6;
};

const obtenerEstadoEsquema = async (queryable) => {
    const [seriesV2Aplicada, estadoFacturacion] = await Promise.all([
        obtenerMigracionV2(queryable),
        queryable.query(`
            SELECT EXISTS (
                SELECT 1
                FROM pg_constraint c
                JOIN pg_class t ON t.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = t.relnamespace
                WHERE n.nspname = 'public'
                  AND t.relname = 'fg_facturacion'
                  AND c.contype = 'c'
                  AND pg_get_constraintdef(c.oid) LIKE '%PENDIENTE_SUNAT%'
            ) AS pendiente_sunat_aplicado,
            to_regclass('public.fg_chip') IS NOT NULL
              AND to_regclass('public.fg_producto_inventariable') IS NOT NULL
              AND to_regclass('public.fg_producto_inventariable_sede') IS NOT NULL
              AND (
                  SELECT COUNT(*)
                  FROM information_schema.columns
                  WHERE table_schema = 'public'
                    AND table_name = 'fg_producto_inventariable_sede'
                    AND column_name IN ('stock_permitido', 'venta_habilitada')
              ) = 2 AS chips_aplicado
        `)
    ]);
    const pendienteSunatAplicado = estadoFacturacion.rows[0]?.pendiente_sunat_aplicado === true;
    const chipsAplicado = estadoFacturacion.rows[0]?.chips_aplicado === true;
    return {
        seriesV2Aplicada,
        pendienteSunatAplicado,
        chipsAplicado,
        completo: seriesV2Aplicada && pendienteSunatAplicado
    };
};

const pasoFase2 = (codigo, nombre, completado, detalle, siguienteAccion) => ({
    codigo,
    nombre,
    estado: completado ? 'COMPLETADO' : 'PENDIENTE',
    detalle,
    siguienteAccion: completado ? null : siguienteAccion
});

const construirFase2 = ({ configuracion, esquema, catalogo, series, credenciales, pruebaDemo }) => {
    const esDemo = configuracion.environment === 'DEMO';
    const catalogoCompleto = catalogo.activas > 0 && catalogo.listas === catalogo.activas;
    const credencialesCompletas = esDemo
        && credenciales.total > 0
        && credenciales.configuradas === credenciales.total;
    const seriesCompletas = esquema.seriesV2Aplicada
        && series.seriesBasicasRequeridas > 0
        && series.seriesBasicasFaltantes.length === 0;
    const decisionTributaria = configuracion.detractionDecision === 'NO_APLICA';
    const demoCompletada = pruebaDemo.aceptadasConArchivos > 0;
    const pasos = [
        pasoFase2(
            'ESQUEMA',
            'Preparar el esquema tributario',
            esquema.completo,
            esquema.completo
                ? 'Las migraciones de series y PENDIENTE_SUNAT están presentes.'
                : 'El esquema tributario todavía está incompleto.',
            'Aplicar las migraciones autorizadas en una base controlada y volver a validar.'
        ),
        pasoFase2(
            'CATALOGO',
            'Completar el catálogo fiscal',
            catalogoCompleto,
            `${catalogo.listas} de ${catalogo.activas} tarifas activas están listas.`,
            'Vincular cada tarifa activa con un producto fiscal válido mediante previsualización.'
        ),
        pasoFase2(
            'CREDENCIALES_DEMO',
            'Configurar credenciales DEMO',
            credencialesCompletas,
            `${credenciales.configuradas} de ${credenciales.total} configuraciones empresariales tienen ruta, token y RUC coincidente.`,
            esDemo
                ? 'Completar ruta, token y RUC DEMO de las empresas emisoras faltantes.'
                : 'Cambiar el entorno a DEMO antes de realizar la certificación técnica.'
        ),
        pasoFase2(
            'SERIES_DEMO',
            'Configurar series exclusivas DEMO',
            seriesCompletas,
            `${series.seriesBasicasConfiguradas} de ${series.seriesBasicasRequeridas} series básicas por sede están configuradas.`,
            'Crear las series predeterminadas de factura y boleta que faltan en cada sede activa.'
        ),
        pasoFase2(
            'DETRACCION',
            'Registrar la decisión sobre detracción',
            decisionTributaria,
            `Decisión actual: ${configuracion.detractionDecision}.`,
            'Confirmar con el responsable tributario si APLICA o NO_APLICA.'
        ),
        pasoFase2(
            'PRUEBA_DEMO',
            'Completar una emisión DEMO controlada',
            demoCompletada,
            `${pruebaDemo.aceptadasConArchivos} comprobante(s) DEMO aceptado(s) con PDF, XML y CDR.`,
            'Cuando las cinco puertas anteriores estén completas, autorizar una emisión DEMO y verificar PDF, XML y CDR.'
        )
    ];
    const completados = pasos.filter(item => item.estado === 'COMPLETADO').length;
    const puertasPreparacion = pasos.slice(0, 5).every(item => item.estado === 'COMPLETADO');
    return {
        estado: demoCompletada ? 'COMPLETADA' : puertasPreparacion ? 'LISTA_PARA_PRUEBA_DEMO' : 'EN_PREPARACION',
        progreso: Math.round((completados / pasos.length) * 100),
        completados,
        total: pasos.length,
        pasos
    };
};

const construirPreparacionProduccion = ({ configuracion, esquema, catalogo, credenciales, series, pruebas }) => {
    const catalogoRealCompleto = catalogo.activas > 0
        && catalogo.listasProduccion === catalogo.activas;
    const credencialesCompletas = credenciales.total > 0
        && credenciales.configuradas === credenciales.total;
    const serieFactura = series.detalle.find(item => item.tipoComprobante === 'FACTURA');
    const serieBoleta = series.detalle.find(item => item.tipoComprobante === 'BOLETA');
    const serieLista = (serie) => Boolean(serie?.configurada);
    const correlativoConfirmado = (serie) => Boolean(
        serie?.confirmadaProduccion
        && serie.numeroInicialConfirmado !== null
        && serie.fechaCorte
    );
    const decisionTributaria = ['APLICA', 'NO_APLICA'].includes(configuracion.detractionDecision);
    const pasos = [
        pasoFase2('ESQUEMA', 'Esquema tributario', esquema.completo,
            esquema.completo ? 'Las migraciones tributarias requeridas están presentes.' : 'El esquema tributario está incompleto.',
            'Aplicar las migraciones pendientes antes de activar producción.'),
        pasoFase2('CATALOGO_PRODUCTIVO', 'Catálogo fiscal real', catalogoRealCompleto,
            `${catalogo.listasProduccion} de ${catalogo.activas} tarifas activas tienen producto fiscal válido y sin marcadores DEMO.`,
            'Vincular cada tarifa con su SKU y descripción fiscal reales; no reutilizar SKU-DEMO.'),
        pasoFase2('CREDENCIALES_PRODUCCION', 'Credenciales productivas', credencialesCompletas,
            `${credenciales.configuradas} de ${credenciales.total} empresas del alcance tienen ruta, token y RUC productivos coincidentes.`,
            catalogoRealCompleto
                ? 'Configurar URL, token y RUC de PRODUCCIÓN para la empresa emisora.'
                : 'Completar primero el catálogo fiscal; no solicitar ni cargar credenciales todavía.'),
        pasoFase2('SERIE_FACTURA', 'Serie productiva de factura', serieLista(serieFactura),
            serieLista(serieFactura) ? `${serieFactura.serie}; último ${serieFactura.ultimoNumero}.` : 'No existe serie productiva predeterminada de factura.',
            'Registrar la serie real de factura autorizada para esta empresa y sede.'),
        pasoFase2('SERIE_BOLETA', 'Serie productiva de boleta', serieLista(serieBoleta),
            serieLista(serieBoleta) ? `${serieBoleta.serie}; último ${serieBoleta.ultimoNumero}.` : 'No existe serie productiva predeterminada de boleta.',
            'Registrar la serie real de boleta autorizada para esta empresa y sede.'),
        pasoFase2('CORRELATIVOS_PRODUCTIVOS', 'Correlativos productivos confirmados',
            correlativoConfirmado(serieFactura) && correlativoConfirmado(serieBoleta),
            `${series.confirmadas} de ${series.requeridas} series tienen corte y último correlativo confirmados.`,
            'Confirmar el último número real y la fecha de corte de factura y boleta.'),
        pasoFase2('MOTOR_V2', 'Motor seguro de correlativos', configuracion.correlativosV2Enabled,
            configuracion.correlativosV2Enabled ? 'El motor V2 está habilitado.' : 'El motor V2 está deshabilitado.',
            'Habilitar el motor V2 después de validar las series y sus cortes.'),
        pasoFase2('ENVIO_SUNAT', 'Envío real a SUNAT', configuracion.enviarSunat,
            configuracion.enviarSunat ? 'El envío a SUNAT está habilitado.' : 'El envío a SUNAT permanece deshabilitado.',
            'Habilitarlo solo durante el pase productivo autorizado.'),
        pasoFase2('RECONCILIACION', 'Reconciliación automática', configuracion.cronReconciliationEnabled,
            configuracion.cronReconciliationEnabled ? 'El reconciliador de factura/boleta está habilitado.' : 'El reconciliador está deshabilitado.',
            'Habilitar el reconciliador de factura/boleta antes de producción.'),
        pasoFase2('DETRACCION', 'Decisión sobre detracción', decisionTributaria,
            `Decisión actual: ${configuracion.detractionDecision}.`,
            configuracion.detractionDecision === 'APLICA'
                ? 'Implementar y validar los datos SPOT antes de producir.'
                : 'Confirmar si la operación está afecta a detracción.'),
        pasoFase2('ENTORNO', 'Ambiente productivo activo', configuracion.environment === 'PRODUCCION',
            `Ambiente efectivo: ${configuracion.environment}.`,
            'Cambiar a PRODUCCION únicamente durante el pase controlado.'),
        pasoFase2('NUBEFACT_HABILITADO', 'Integración Nubefact habilitada', configuracion.enabled,
            configuracion.enabled ? 'La integración está habilitada.' : 'La integración está deshabilitada.',
            'Habilitar Nubefact cuando todos los demás prerequisitos estén completos.'),
        pasoFase2('CONFIRMACION_PRODUCTIVA', 'Confirmación productiva explícita', configuracion.productionConfirmed,
            configuracion.productionConfirmed ? 'El pase productivo fue confirmado.' : 'La confirmación productiva permanece cerrada.',
            'Confirmar producción solo inmediatamente antes de la emisión controlada.'),
        pasoFase2('BOLETA_PRODUCTIVA', 'Boleta productiva aceptada con archivos', pruebas.boletaAceptadaConArchivos,
            pruebas.boletaAceptadaConArchivos ? 'Existe evidencia productiva de boleta con PDF, XML y CDR.' : 'Aún no existe evidencia productiva de boleta aceptada con archivos.',
            'Emitir una sola boleta controlada después de aprobar el preflight.'),
        pasoFase2('FACTURA_PRODUCTIVA', 'Factura productiva aceptada con archivos', pruebas.facturaAceptadaConArchivos,
            pruebas.facturaAceptadaConArchivos ? 'Existe evidencia productiva de factura con PDF, XML y CDR.' : 'Aún no existe evidencia productiva de factura aceptada con archivos.',
            'Después de la boleta, emitir una sola factura controlada con RUC válido.')
    ];
    const completados = pasos.filter(item => item.estado === 'COMPLETADO').length;
    const preflightCompleto = pasos.slice(0, 13).every(item => item.estado === 'COMPLETADO');
    const operativo = pasos.every(item => item.estado === 'COMPLETADO');
    return {
        estado: operativo ? 'OPERATIVA' : preflightCompleto ? 'LISTA_PARA_EMISION_CONTROLADA' : 'EN_PREPARACION',
        progreso: Math.round((completados / pasos.length) * 100),
        completados,
        total: pasos.length,
        requiereDemo: false,
        pasos
    };
};

const obtenerCredencialesAmbiente = async (queryable, plantaKey, entorno) => {
    const valores = [entorno];
    if (plantaKey) valores.push(plantaKey);
    const result = await queryable.query(`
        SELECT e.key AS empresa_key, e.ruc AS ruc_emisor, f.credencial_clave
        FROM fg_empresa e
        LEFT JOIN fg_empresa_facturador f
          ON f.empresa_key = e.key
         AND f.proveedor = 'NUBEFACT'
         AND f.entorno = $1
         AND f.activo = TRUE
        WHERE e.activo = TRUE
          AND EXISTS (
              SELECT 1 FROM fg_planta p
              WHERE p.empresa_key = e.key AND p.activo = TRUE
                ${plantaKey ? 'AND p.key = $2' : ''}
          )
        ORDER BY e.key
    `, valores);
    const faltantes = result.rows.filter(row => {
        const item = integrationsConfig.nubefact.obtenerCredenciales(row.credencial_clave, entorno);
        return !(item.apiUrl && item.token
            && esRucValido(item.rucEmisor)
            && esRucValido(row.ruc_emisor)
            && item.rucEmisor === String(row.ruc_emisor || ''));
    }).map(row => row.empresa_key);
    return {
        ambiente: entorno,
        total: result.rowCount,
        configuradas: result.rowCount - faltantes.length,
        faltantes
    };
};

const obtenerSeriesAmbiente = async (queryable, plantaKey, entorno, migracionV2Aplicada) => {
    if (!migracionV2Aplicada) return { requeridas: 0, configuradas: 0, confirmadas: 0, faltantes: [], detalle: [] };
    const valores = [entorno];
    if (plantaKey) valores.push(plantaKey);
    const result = await queryable.query(`
        SELECT p.key AS planta_key, e.key AS empresa_key, e.ruc AS ruc_emisor,
               tipos.tipo_comprobante, s.id, s.serie, s.ultimo_numero,
               s.confirmada_produccion, s.numero_inicial_confirmado, s.fecha_corte
        FROM fg_planta p
        JOIN fg_empresa e ON e.key = p.empresa_key AND e.activo = TRUE
        CROSS JOIN (VALUES ('FACTURA'), ('BOLETA')) AS tipos(tipo_comprobante)
        LEFT JOIN fg_serie_comprobante s
          ON s.planta_key = p.key
         AND s.empresa_key = e.key
         AND s.tipo_comprobante = tipos.tipo_comprobante
         AND s.proveedor_emision = 'NUBEFACT'
         AND s.entorno_emision = $1
         AND s.activo = TRUE
         AND s.es_predeterminada = TRUE
         AND s.autogenerada = TRUE
        WHERE p.activo = TRUE ${plantaKey ? 'AND p.key = $2' : ''}
        ORDER BY p.key, tipos.tipo_comprobante
    `, valores);
    const detalle = result.rows.map(row => ({
        plantaKey: row.planta_key,
        empresaKey: row.empresa_key,
        rucEmisor: row.ruc_emisor,
        tipoComprobante: row.tipo_comprobante,
        configurada: Boolean(row.id),
        serie: row.serie || null,
        ultimoNumero: row.id ? Number(row.ultimo_numero) : null,
        siguienteNumero: row.id ? Number(row.ultimo_numero) + 1 : null,
        confirmadaProduccion: row.confirmada_produccion === true,
        numeroInicialConfirmado: row.numero_inicial_confirmado === null ? null : Number(row.numero_inicial_confirmado),
        fechaCorte: row.fecha_corte || null
    }));
    return {
        requeridas: detalle.length,
        configuradas: detalle.filter(item => item.configurada).length,
        confirmadas: detalle.filter(item => item.configurada && item.confirmadaProduccion
            && item.numeroInicialConfirmado !== null && item.fechaCorte).length,
        faltantes: detalle.filter(item => !item.configurada)
            .map(item => `${item.plantaKey}:${item.tipoComprobante}`),
        detalle
    };
};

const obtenerPruebasAmbiente = async (queryable, plantaKey, entorno) => {
    const valores = [entorno];
    if (plantaKey) valores.push(plantaKey);
    const result = await queryable.query(`
        SELECT tipo_comprobante,
               COUNT(*) FILTER (WHERE estado = 'ACEPTADO')::int AS aceptadas,
               COUNT(*) FILTER (WHERE estado = 'ACEPTADO' AND aceptada_sunat = TRUE
                 AND enlace_pdf IS NOT NULL AND enlace_xml IS NOT NULL AND enlace_cdr IS NOT NULL)::int AS aceptadas_con_archivos
        FROM fg_facturacion
        WHERE proveedor = 'NUBEFACT' AND entorno_facturador = $1
          ${plantaKey ? 'AND planta_key = $2' : ''}
        GROUP BY tipo_comprobante
    `, valores);
    const porTipo = (tipo) => result.rows.find(row => row.tipo_comprobante === tipo);
    return {
        boletaAceptadaConArchivos: Number(porTipo('BOLETA')?.aceptadas_con_archivos || 0) > 0,
        facturaAceptadaConArchivos: Number(porTipo('FACTURA')?.aceptadas_con_archivos || 0) > 0,
        detalle: result.rows.map(row => ({
            tipoComprobante: row.tipo_comprobante,
            aceptadas: Number(row.aceptadas || 0),
            aceptadasConArchivos: Number(row.aceptadas_con_archivos || 0)
        }))
    };
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
        const esCatalogoYaReportado = /producto (fiscal|de facturaci[oó]n)/i.test(mensaje)
            && checks.some(item => item.codigo === 'CATALOGO_FISCAL' && item.estado === 'BLOQUEO');
        if (!esCatalogoYaReportado && !checks.some(item => item.mensaje === mensaje)) {
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
    const valoresTarifas = [...valores, UNIDADES_TRIBUTARIAS_ADMITIDAS];
    const unidadesTarifaParam = `$${valoresTarifas.length}`;
    const esquema = await obtenerEstadoEsquema(queryable);
    const migracionV2Aplicada = esquema.seriesV2Aplicada;
    const valoresSeries = [...valores];
    if (migracionV2Aplicada) valoresSeries.push(integrationsConfig.nubefact.environment);
    const entornoParam = `$${valoresSeries.length}`;
    const valoresCredenciales = [integrationsConfig.nubefact.environment];
    const filtroAlcanceEmpresa = plantaKey
        ? 'AND p.key = $2'
        : '';
    if (plantaKey) valoresCredenciales.push(plantaKey);
    const seriesBasicasPromise = migracionV2Aplicada
        ? queryable.query(`
            SELECT COUNT(*)::int AS requeridas,
                   COUNT(s.id)::int AS configuradas,
                   COALESCE(
                       ARRAY_AGG(p.key || ':' || tipos.tipo_comprobante ORDER BY p.key, tipos.tipo_comprobante)
                           FILTER (WHERE s.id IS NULL),
                       ARRAY[]::text[]
                   ) AS faltantes
            FROM fg_planta p
            JOIN fg_empresa e ON e.key = p.empresa_key AND e.activo = TRUE
            CROSS JOIN (VALUES ('FACTURA'), ('BOLETA')) AS tipos(tipo_comprobante)
            LEFT JOIN fg_serie_comprobante s
              ON s.planta_key = p.key
             AND s.tipo_comprobante = tipos.tipo_comprobante
             AND s.proveedor_emision = 'NUBEFACT'
             AND s.entorno_emision = $1
             AND s.activo = TRUE
             AND s.es_predeterminada = TRUE
            WHERE p.activo = TRUE ${plantaKey ? 'AND p.key = $2' : ''}
        `, valoresCredenciales)
        : Promise.resolve({ rows: [{ requeridas: 0, configuradas: 0, faltantes: [] }] });
    const [tarifas, series, facturadores, documentos, configuracionesCredenciales, pruebaDemoResult, seriesBasicasResult] = await Promise.all([
        queryable.query(`
            SELECT COUNT(*) FILTER (WHERE t.activo)::int AS activas,
                   COUNT(*) FILTER (WHERE t.activo AND t.producto_facturacion_id IS NOT NULL)::int AS vinculadas,
                   COUNT(*) FILTER (WHERE t.activo AND t.producto_facturacion_id IS NULL)::int AS sin_vincular,
                   COUNT(*) FILTER (WHERE t.activo AND t.producto_facturacion_id IS NOT NULL
                     AND pf.activo AND pf.es_para_venta
                     AND UPPER(BTRIM(pf.unidad)) = ANY(${unidadesTarifaParam}::text[])
                     AND BTRIM(pf.tipo_afectacion_igv) = '10'
                     AND (COALESCE(BTRIM(pf.codigo_clasificacion_sunat), '') = ''
                       OR BTRIM(pf.codigo_clasificacion_sunat) ~ '^\\d{8}$'))::int AS listas,
                   COUNT(*) FILTER (WHERE t.activo AND t.producto_facturacion_id IS NOT NULL
                     AND pf.activo AND pf.es_para_venta
                     AND UPPER(BTRIM(pf.unidad)) = ANY(${unidadesTarifaParam}::text[])
                     AND BTRIM(pf.tipo_afectacion_igv) = '10'
                     AND (COALESCE(BTRIM(pf.codigo_clasificacion_sunat), '') = ''
                       OR BTRIM(pf.codigo_clasificacion_sunat) ~ '^\\d{8}$')
                     AND UPPER(BTRIM(pf.codigo_sku)) NOT LIKE '%DEMO%'
                     AND UPPER(BTRIM(pf.descripcion)) NOT LIKE '%DEMO%')::int AS listas_produccion
            FROM fg_tarifa t
            LEFT JOIN fg_producto_facturacion pf ON pf.id = t.producto_facturacion_id
            WHERE TRUE ${filtroTarifa}
        `, valoresTarifas),
        queryable.query(`
            SELECT COUNT(*) FILTER (WHERE s.activo)::int AS activas,
                   COUNT(*) FILTER (WHERE s.activo AND s.es_predeterminada)::int AS predeterminadas,
                   COUNT(*) FILTER (WHERE s.activo AND s.ultimo_numero >= 99999000)::int AS proximas_agotarse
                   ${migracionV2Aplicada ? `,
                   COUNT(*) FILTER (WHERE s.activo AND s.proveedor_emision = 'LEGACY')::int AS legacy,
                   COUNT(*) FILTER (WHERE s.activo AND s.proveedor_emision = 'NUBEFACT'
                     AND s.entorno_emision = ${entornoParam})::int AS nubefact_exclusivas,
                   COUNT(*) FILTER (WHERE s.activo AND s.es_predeterminada
                     AND s.proveedor_emision = 'NUBEFACT'
                     AND s.entorno_emision = ${entornoParam})::int AS nubefact_predeterminadas,
                   COUNT(*) FILTER (WHERE s.activo AND s.confirmada_produccion
                     AND s.proveedor_emision = 'NUBEFACT'
                     AND s.entorno_emision = 'PRODUCCION')::int AS confirmadas_produccion` : ''}
            FROM fg_serie_comprobante s WHERE TRUE ${filtroSerie}
        `, valoresSeries),
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
        `),
        queryable.query(`
            SELECT e.key AS empresa_key, $1::text AS entorno,
                   f.credencial_clave, e.ruc AS ruc_emisor
            FROM fg_empresa e
            LEFT JOIN fg_empresa_facturador f
              ON f.empresa_key = e.key
             AND f.proveedor = 'NUBEFACT'
             AND f.entorno = $1
             AND f.activo = TRUE
            WHERE e.activo = TRUE
              AND EXISTS (
                  SELECT 1
                  FROM fg_planta p
                  WHERE p.empresa_key = e.key
                    AND p.activo = TRUE
                    ${filtroAlcanceEmpresa}
              )
            ORDER BY e.key
        `, valoresCredenciales),
        queryable.query(`
            SELECT COUNT(*) FILTER (WHERE estado = 'ACEPTADO')::int AS aceptadas,
                   COUNT(*) FILTER (
                       WHERE estado = 'ACEPTADO'
                         AND enlace_pdf IS NOT NULL
                         AND enlace_xml IS NOT NULL
                         AND enlace_cdr IS NOT NULL
                   )::int AS aceptadas_con_archivos
            FROM fg_facturacion
            WHERE proveedor = 'NUBEFACT' AND entorno_facturador = $1
        `, [integrationsConfig.nubefact.environment]),
        seriesBasicasPromise
    ]);

    const [credencialesDemo, credencialesProduccion, seriesDemo, seriesProduccion,
        pruebasDemo, pruebasProduccion] = await Promise.all([
        obtenerCredencialesAmbiente(queryable, plantaKey, 'DEMO'),
        obtenerCredencialesAmbiente(queryable, plantaKey, 'PRODUCCION'),
        obtenerSeriesAmbiente(queryable, plantaKey, 'DEMO', migracionV2Aplicada),
        obtenerSeriesAmbiente(queryable, plantaKey, 'PRODUCCION', migracionV2Aplicada),
        obtenerPruebasAmbiente(queryable, plantaKey, 'DEMO'),
        obtenerPruebasAmbiente(queryable, plantaKey, 'PRODUCCION')
    ]);
    const chipsResult = esquema.chipsAplicado ? await queryable.query(`
        SELECT COUNT(*)::int AS productos,
               COUNT(*) FILTER (WHERE pi.producto_facturacion_id IS NOT NULL)::int AS mapeados,
               BOOL_OR(pis.stock_permitido) AS stock_permitido,
               BOOL_OR(pis.venta_habilitada) AS venta_habilitada,
               COUNT(c.id) FILTER (WHERE c.estado = 'DISPONIBLE')::int AS disponibles,
               COUNT(c.id) FILTER (WHERE c.estado = 'RESERVADO')::int AS reservados
        FROM fg_producto_inventariable pi
        JOIN fg_producto_inventariable_sede pis ON pis.producto_inventariable_id=pi.id AND pis.activo=TRUE
        LEFT JOIN fg_chip c ON c.producto_inventariable_id=pi.id AND c.planta_actual_key=pis.planta_key
        WHERE pi.codigo='CHIP' AND pi.activo=TRUE ${plantaKey ? 'AND pis.planta_key=$1' : ''}
    `, valores) : { rows: [{ productos: 0, mapeados: 0, disponibles: 0, reservados: 0 }] };

    const t = tarifas.rows[0] || {};
    const s = series.rows[0] || {};
    const sb = seriesBasicasResult.rows[0] || {};
    const credencialesFaltantes = configuracionesCredenciales.rows
        .filter(row => {
            const credentials = integrationsConfig.nubefact.obtenerCredenciales(row.credencial_clave, row.entorno);
            return !(credentials.apiUrl && credentials.token
                && credentials.rucEmisor === String(row.ruc_emisor || ''));
        })
        .map(row => row.empresa_key);
    const catalogo = {
        activas: Number(t.activas || 0),
        vinculadas: Number(t.vinculadas || 0),
        sinVincular: Number(t.sin_vincular || 0),
        listas: Number(t.listas || 0),
        listasProduccion: Number(t.listas_produccion || 0)
    };
    const seriesResumen = {
        activas: Number(s.activas || 0),
        predeterminadas: Number(s.predeterminadas || 0),
        legacy: migracionV2Aplicada ? Number(s.legacy || 0) : Number(s.activas || 0),
        nubefactExclusivas: migracionV2Aplicada ? Number(s.nubefact_exclusivas || 0) : 0,
        nubefactPredeterminadas: migracionV2Aplicada ? Number(s.nubefact_predeterminadas || 0) : 0,
        confirmadasProduccion: migracionV2Aplicada ? Number(s.confirmadas_produccion || 0) : 0,
        proximasAgotarse: Number(s.proximas_agotarse || 0),
        seriesBasicasRequeridas: Number(sb.requeridas || 0),
        seriesBasicasConfiguradas: Number(sb.configuradas || 0),
        seriesBasicasFaltantes: Array.isArray(sb.faltantes) ? sb.faltantes : []
    };
    const credenciales = {
        ambiente: integrationsConfig.nubefact.environment,
        total: configuracionesCredenciales.rowCount,
        configuradas: configuracionesCredenciales.rowCount - credencialesFaltantes.length,
        faltantes: credencialesFaltantes
    };
    const pruebaDemo = {
        aceptadas: Number(pruebaDemoResult.rows[0]?.aceptadas || 0),
        aceptadasConArchivos: Number(pruebaDemoResult.rows[0]?.aceptadas_con_archivos || 0)
    };
    const configuracion = {
        environment: integrationsConfig.nubefact.environment,
        enabled: integrationsConfig.nubefact.enabled,
        productionConfirmed: integrationsConfig.nubefact.productionConfirmed,
        correlativosV2Enabled: integrationsConfig.nubefact.correlativosV2Enabled,
        cronReconciliationEnabled: integrationsConfig.nubefact.cronReconciliationEnabled,
        enviarSunat: integrationsConfig.nubefact.enviarSunat,
        reconciliationRetryMs: integrationsConfig.nubefact.reconciliationRetryMs,
        maxAttempts: integrationsConfig.nubefact.maxAttempts,
        detractionDecision: integrationsConfig.nubefact.detractionDecision,
        migracionV2Aplicada
    };
    const chip = {
        esquemaAplicado: esquema.chipsAplicado,
        configurado: Number(chipsResult.rows[0]?.productos || 0) > 0,
        mappingFiscalCompleto: Number(chipsResult.rows[0]?.mapeados || 0) > 0,
        stockPermitido: chipsResult.rows[0]?.stock_permitido === true,
        ventaHabilitada: chipsResult.rows[0]?.venta_habilitada === true,
        disponibles: Number(chipsResult.rows[0]?.disponibles || 0),
        reservados: Number(chipsResult.rows[0]?.reservados || 0)
    };
    const pruebaDemoSeparada = {
        aceptadas: pruebasDemo.detalle.reduce((total, item) => total + item.aceptadas, 0),
        aceptadasConArchivos: pruebasDemo.detalle.reduce((total, item) => total + item.aceptadasConArchivos, 0)
    };
    const fase2 = construirFase2({
        configuracion: { ...configuracion, environment: 'DEMO' },
        esquema,
        catalogo,
        series: {
            ...seriesResumen,
            seriesBasicasRequeridas: seriesDemo.requeridas,
            seriesBasicasConfiguradas: seriesDemo.configuradas,
            seriesBasicasFaltantes: seriesDemo.faltantes
        },
        credenciales: credencialesDemo,
        pruebaDemo: pruebaDemoSeparada
    });
    const preparacionProduccion = construirPreparacionProduccion({
        configuracion,
        esquema,
        catalogo,
        credenciales: credencialesProduccion,
        series: seriesProduccion,
        pruebas: pruebasProduccion
    });
    const bloqueos = [];
    if (Number(t.sin_vincular || 0) > 0) bloqueos.push(`${t.sin_vincular} tarifas activas no tienen producto fiscal.`);
    const catalogoVinculadoInvalido = Math.max(0, catalogo.activas - catalogo.listas - catalogo.sinVincular);
    if (catalogoVinculadoInvalido > 0) {
        bloqueos.push(`${catalogoVinculadoInvalido} tarifas vinculadas tienen unidad, afectación IGV o código SUNAT inválido.`);
    }
    if (!migracionV2Aplicada) bloqueos.push('La migración del motor de correlativos V2 no está aplicada.');
    if (!esquema.pendienteSunatAplicado) bloqueos.push('El estado PENDIENTE_SUNAT no está habilitado en el esquema de facturación.');
    if (migracionV2Aplicada && Number(s.nubefact_predeterminadas || 0) === 0) {
        bloqueos.push(`No existen series exclusivas Nubefact predeterminadas para ${integrationsConfig.nubefact.environment}.`);
    }
    if (migracionV2Aplicada && seriesResumen.seriesBasicasFaltantes.length > 0) {
        bloqueos.push(`${seriesResumen.seriesBasicasFaltantes.length} series básicas de factura/boleta faltan en las sedes activas.`);
    }
    if (!integrationsConfig.nubefact.correlativosV2Enabled) bloqueos.push('El motor de correlativos V2 está deshabilitado.');
    if (integrationsConfig.nubefact.enabled && !integrationsConfig.nubefact.cronReconciliationEnabled) {
        bloqueos.push('La reconciliación automática de comprobantes pendientes está deshabilitada.');
    }
    if (integrationsConfig.nubefact.detractionDecision === 'PENDIENTE') bloqueos.push('La decisión sobre detracción está pendiente.');
    if (!integrationsConfig.nubefact.enabled) bloqueos.push('Nubefact está deshabilitado.');
    if (!chip.esquemaAplicado || !chip.configurado) bloqueos.push('El inventario de chips no está configurado para la sede.');
    else if (!chip.mappingFiscalCompleto) bloqueos.push('El chip no tiene un SKU fiscal demostrado y vinculado para la sede.');
    if (configuracionesCredenciales.rowCount === 0) {
        bloqueos.push(`No existe configuración empresarial Nubefact para ${integrationsConfig.nubefact.environment}.`);
    } else if (credencialesFaltantes.length > 0) {
        bloqueos.push(`${credencialesFaltantes.length} empresa(s) no tienen ruta y token ${integrationsConfig.nubefact.environment}.`);
    }

    return {
        estado: bloqueos.length === 0 ? 'LISTO' : 'BLOQUEADO',
        bloqueos,
        configuracion,
        esquema,
        catalogo,
        chip,
        series: seriesResumen,
        facturadores: facturadores.rows,
        credenciales,
        pruebaDemo,
        fase2,
        preparacionProduccion,
        ambientes: {
            demo: { credenciales: credencialesDemo, series: seriesDemo, pruebas: pruebasDemo },
            produccion: { credenciales: credencialesProduccion, series: seriesProduccion, pruebas: pruebasProduccion }
        },
        documentos: documentos.rows,
        monitoreo: {
            pendientes: Number(documentos.rows.find(row => row.estado === 'PENDIENTE')?.cantidad || 0)
                + Number(documentos.rows.find(row => row.estado === 'PENDIENTE_SUNAT')?.cantidad || 0),
            pendientesSunat: Number(documentos.rows.find(row => row.estado === 'PENDIENTE_SUNAT')?.cantidad || 0),
            errores: Number(documentos.rows.find(row => row.estado === 'ERROR')?.cantidad || 0),
            rechazados: Number(documentos.rows.find(row => row.estado === 'RECHAZADO')?.cantidad || 0),
            aceptados: Number(documentos.rows.find(row => row.estado === 'ACEPTADO')?.cantidad || 0)
        },
        evaluadoEn: new Date().toISOString()
    };
};

exports._private = {
    construirChecksCertificado,
    construirFase2,
    construirPreparacionProduccion,
    obtenerMigracionV2,
    obtenerEstadoEsquema,
    check
};
