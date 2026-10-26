const TIPOS_SOLICITUD = Object.freeze([
    'ANULAR_CERTIFICADO',
    'ANULAR_COMPROBANTE',
    'ANULAR_AMBOS',
    'RECTIFICAR_CERTIFICADO',
    'RECTIFICAR_COMPROBANTE',
    'RECTIFICAR_AMBOS'
]);

const ESTADOS_SOLICITUD = Object.freeze([
    'PENDIENTE_APROBACION',
    'APROBADA',
    'RECHAZADA',
    'CANCELADA',
    'EN_EJECUCION',
    'COMPLETADA',
    'ERROR',
    'REQUIERE_INTERVENCION'
]);

const ESTADOS_QUE_BLOQUEAN = Object.freeze([
    'PENDIENTE_APROBACION',
    'APROBADA',
    'EN_EJECUCION',
    'REQUIERE_INTERVENCION'
]);

const PERMISOS_SOLICITUD = Object.freeze({
    CREAR: 'FAREGAS_SOLICITUD_CREAR',
    VER: 'FAREGAS_SOLICITUD_VER',
    APROBAR: 'FAREGAS_SOLICITUD_APROBAR',
    AUTOAPROBAR: 'FAREGAS_SOLICITUD_AUTOAPROBAR',
    AUTOEJECUTAR: 'FAREGAS_SOLICITUD_AUTOEJECUTAR',
    RECHAZAR: 'FAREGAS_SOLICITUD_RECHAZAR',
    ADMINISTRAR: 'FAREGAS_SOLICITUD_ADMINISTRAR',
    EJECUTAR_ANULACION_CERTIFICADO: 'FAREGAS_CERTIFICADO_ANULAR_EJECUTAR',
    EJECUTAR_RECTIFICACION_CERTIFICADO: 'FAREGAS_CERTIFICADO_RECTIFICAR_EJECUTAR'
});

const TIPOS_CERTIFICADO = new Set([
    'ANULAR_CERTIFICADO',
    'RECTIFICAR_CERTIFICADO'
]);

const TIPOS_COMPROBANTE = new Set([
    'ANULAR_COMPROBANTE',
    'RECTIFICAR_COMPROBANTE'
]);

const TIPOS_AMBOS = new Set([
    'ANULAR_AMBOS',
    'RECTIFICAR_AMBOS'
]);

const TIPOS_RECTIFICACION = new Set([
    'RECTIFICAR_CERTIFICADO',
    'RECTIFICAR_COMPROBANTE',
    'RECTIFICAR_AMBOS'
]);

const ESTADOS_VERSION_CERTIFICADO = Object.freeze([
    'ORIGINAL',
    'PROPUESTA',
    'PREPARADA',
    'VIGENTE',
    'SUSTITUIDA',
    'RECHAZADA'
]);

const CAMPOS_RECTIFICABLES_BASE = Object.freeze([
    // Vehículo
    'placa', 'categoria', 'clase', 'marca', 'modelo', 'version',
    'anio_fabricacion', 'anio_modelo', 'vin', 'serie_chasis',
    'numero_motor', 'combustible', 'color', 'carroceria',
    'numero_cilindros', 'cilindrada', 'numero_ejes', 'numero_ruedas',
    'numero_asientos', 'numero_pasajeros', 'longitud', 'ancho', 'alto',
    'peso_neto', 'peso_bruto', 'carga_util', 'potencia', 'formula_rodante',
    // Propietario / Titular
    'titular_nombre', 'nombre_razon_social', 'tipo_documento', 'nro_documento', 'direccion',
    // Taller
    'taller_razon_social', 'taller_sede', 'taller_direccion', 'taller_codigo_autorizacion',
    // General
    'observaciones'
]);

const CAMPOS_RECTIFICABLES_ESPECIFICOS = Object.freeze({
    GNV: Object.freeze(['numero_chip', 'modalidad', 'combustible_posterior', 'peso_neto_posterior', 'observaciones']),
    GLP: Object.freeze(['expediente_tecnico', 'modalidad', 'combustible_posterior', 'peso_neto_posterior', 'carga_util_posterior']),
    CONFORMIDAD: Object.freeze(['tipo_conformidad', 'tipo_tramite', 'caracteristica_registrable', 'motivo', 'descripcion', 'uso_original_vehiculo'])
});

const CAMPOS_RECTIFICABLES_PERMITIDOS = new Set([
    ...CAMPOS_RECTIFICABLES_BASE,
    ...CAMPOS_RECTIFICABLES_ESPECIFICOS.GNV,
    ...CAMPOS_RECTIFICABLES_ESPECIFICOS.GLP,
    ...CAMPOS_RECTIFICABLES_ESPECIFICOS.CONFORMIDAD
]);

const CAMPOS_RECTIFICABLES_COMPROBANTE = Object.freeze([
    'facturacion_tipo_documento',
    'facturacion_nro_documento',
    'facturacion_nombre_razon_social',
    'facturacion_direccion',
    'facturacion_descripcion_servicio'
]);

const CAMPOS_RECTIFICABLES_COMPROBANTE_PERMITIDOS = new Set(CAMPOS_RECTIFICABLES_COMPROBANTE);

const TRANSICIONES_ADMINISTRATIVAS = Object.freeze({
    APROBAR: Object.freeze({ desde: 'PENDIENTE_APROBACION', hacia: 'APROBADA' }),
    RECHAZAR: Object.freeze({ desde: 'PENDIENTE_APROBACION', hacia: 'RECHAZADA' }),
    CANCELAR: Object.freeze({ desde: 'PENDIENTE_APROBACION', hacia: 'CANCELADA' }),
    EJECUTAR_ANULACION_CERTIFICADO: Object.freeze({ desde: ['APROBADA', 'REQUIERE_INTERVENCION'], hacia: 'COMPLETADA' }),
    EJECUTAR_RECTIFICACION_CERTIFICADO: Object.freeze({ desde: ['APROBADA', 'REQUIERE_INTERVENCION'], hacia: ['COMPLETADA', 'REQUIERE_INTERVENCION'] }),
    EJECUTAR_ANULACION_TOTAL: Object.freeze({ desde: ['APROBADA', 'REQUIERE_INTERVENCION'], hacia: ['EN_EJECUCION', 'COMPLETADA', 'REQUIERE_INTERVENCION', 'ERROR'] })
});

const CONFIG_ANULACION_TECNICA = Object.freeze({
    habilitadoPorDefecto: false,
    tiposPermitidosLocal: Object.freeze([])
});

const CONFIG_RECTIFICACION_TECNICA = Object.freeze({
    // Nivel 1 (Preparación interna) siempre disponible con permisos.
    // Nivel 2 (Aplicación oficial de rectificación en vivo) deshabilitado por defecto
    // hasta contar con autorización normativa externa o regla verificada.
    aplicacionOficialHabilitadaPorDefecto: false
});

module.exports = {
    TIPOS_SOLICITUD,
    ESTADOS_SOLICITUD,
    ESTADOS_QUE_BLOQUEAN,
    PERMISOS_SOLICITUD,
    TIPOS_CERTIFICADO,
    TIPOS_COMPROBANTE,
    TIPOS_AMBOS,
    TIPOS_RECTIFICACION,
    ESTADOS_VERSION_CERTIFICADO,
    CAMPOS_RECTIFICABLES_BASE,
    CAMPOS_RECTIFICABLES_ESPECIFICOS,
    CAMPOS_RECTIFICABLES_PERMITIDOS,
    CAMPOS_RECTIFICABLES_COMPROBANTE,
    CAMPOS_RECTIFICABLES_COMPROBANTE_PERMITIDOS,
    TRANSICIONES_ADMINISTRATIVAS,
    CONFIG_ANULACION_TECNICA,
    CONFIG_RECTIFICACION_TECNICA
};

