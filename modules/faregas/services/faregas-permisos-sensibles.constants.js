/**
 * Catálogo de permisos sensibles de FAREGAS.
 *
 * "Sensible" es sólo una etiqueta visual para resaltar permisos de alto impacto.
 * La autorización para concederlos o revocarlos se decide con el permiso que ya
 * controla la administración de perfiles: MENU_USUARIOS. No existe una segunda
 * autorización administrativa ni se decide por el nombre del perfil receptor.
 */

const FAREGAS_PERMISO_ADMINISTRAR_PERFILES = 'MENU_USUARIOS';

const PERMISOS_SENSIBLES = Object.freeze([
    'FAREGAS_SOLICITUD_APROBAR',
    'FAREGAS_SOLICITUD_AUTOAPROBAR',
    'FAREGAS_SOLICITUD_AUTOEJECUTAR',
    'FAREGAS_SOLICITUD_RECHAZAR',
    'FAREGAS_SOLICITUD_ADMINISTRAR',
    'FAREGAS_CERTIFICADO_ANULAR_EJECUTAR',
    'FAREGAS_CERTIFICADO_RECTIFICAR_EJECUTAR',
    'FAREGAS_NOTA_CREDITO',
    'FAREGAS_ANULAR_COMPROBANTE'
]);

const PERMISOS_SENSIBLES_SET = new Set(PERMISOS_SENSIBLES);

/**
 * Permiso obsoleto de la implementación anterior. Si alguna instalación ya lo
 * tiene registrado o asignado, se ignora en el editor y no se elimina de la
 * base de datos automáticamente.
 */
const PERMISOS_OBSOLETOS = Object.freeze([
    'FAREGAS_PERMISOS_SENSIBLES_ADMINISTRAR'
]);

const PERMISOS_OBSOLETOS_SET = new Set(PERMISOS_OBSOLETOS);

/**
 * Permisos FAREGAS que el editor de perfiles puede administrar. Se mantiene
 * junto al catálogo sensible para que el backend valide exactamente las mismas
 * claves que luego persiste en `fg_perfil_permiso`.
 */
const PERMISOS_FAREGAS_GESTIONABLES = Object.freeze([
    'FAREGAS_SOLICITUD_CREAR',
    'FAREGAS_SOLICITUD_VER',
    ...PERMISOS_SENSIBLES
]);

module.exports = {
    FAREGAS_PERMISO_ADMINISTRAR_PERFILES,
    PERMISOS_SENSIBLES,
    PERMISOS_SENSIBLES_SET,
    PERMISOS_OBSOLETOS,
    PERMISOS_OBSOLETOS_SET,
    PERMISOS_FAREGAS_GESTIONABLES
};
