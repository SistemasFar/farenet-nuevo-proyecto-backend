-- ============================================================================
-- ARCHIVO: 001_faregas_datos_iniciales.sql
-- MÓDULO: FAREGAS (Catálogos Iniciales y Configuración Base del Sistema)
-- DESTINO: Carga de catálogos mínimos indispensables para base independiente
-- MOTOR: PostgreSQL 13 o superior
-- CODIFICACIÓN: UTF-8
--
-- ADVERTENCIA OBLIGATORIA:
-- ESTE ARCHIVO NO CONTIENE DATOS SENSIBLES, NI CLIENTES REALES, NI VENTAS,
-- NI FACTURAS, NI CONSTRASEÑAS REALES DE USUARIOS.
-- SU PROPÓSITO ES PROVEER LOS CATÁLOGOS TÉCNICOS Y REGLAS RBAC ESENCIALES
-- PARA QUE LA APLICACIÓN OPERE DESDE SU PRIMER DESPLIEGUE.
--
-- CARACTERÍSTICA DE IDEMPOTENCIA:
-- TODAS LAS SENTENCIAS UTILIZAN 'ON CONFLICT DO NOTHING' O 'ON CONFLICT DO UPDATE'
-- PERMITIENDO RE-EJECUCIONES SEGURAS SIN PRODUCIR DUPLICADOS NI ERRORES.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. CATÁLOGO DE PERFILES (fg_perfil)
-- Incluye perfiles nominales estándar y perfiles operativos compatibles
-- ----------------------------------------------------------------------------
INSERT INTO public.fg_perfil (clave, nombre, visible)
VALUES
    ('ADMINISTRADOR', 'ADMINISTRADOR', TRUE),
    ('AMINISTRADOR', 'ADMINISTRADOR', TRUE),
    ('CAJERO', 'CAJERO', TRUE),
    ('CERTIFICADOR', 'CERTIFICADOR', TRUE),
    ('CONSULTA', 'CONSULTA', TRUE),
    ('CONTADOR', 'CONTADOR', TRUE),
    ('JEFE_PLANTA', 'Jefe de Planta', TRUE),
    ('OPERADOR', 'operador/emisor/ventas', TRUE),
    ('SISTEMAS', 'Sistemas', TRUE),
    ('SUPERVISOR', 'SUPERVISOR', TRUE),
    ('TALLER', 'TALLER', TRUE)
ON CONFLICT (clave) DO UPDATE
SET nombre = EXCLUDED.nombre, visible = EXCLUDED.visible;

-- ----------------------------------------------------------------------------
-- 2. CATÁLOGO DE PERMISOS DEL SISTEMA (51 PERMISOS AUDITADOS)
-- ----------------------------------------------------------------------------
INSERT INTO public.fg_permiso (clave, nombre, modulo, descripcion, activo)
VALUES
    ('CHIPS_BAJA', 'Dar de baja chips', 'FAREGAS', 'Dar de baja chips disponibles', TRUE),
    ('CHIPS_CONFIGURAR', 'Configurar productos inventariables', 'FAREGAS', 'Crear y editar productos inventariables y su disponibilidad por sede', TRUE),
    ('CHIPS_INGRESAR', 'Ingresar chips al inventario', 'FAREGAS', 'Registrar compras y stock inicial de chips', TRUE),
    ('CHIPS_TRANSFERIR', 'Transferir chips entre sedes', 'FAREGAS', 'Transferir chips disponibles a otras sedes autorizadas', TRUE),
    ('CHIPS_VENDER', 'Vender chips sueltos', 'FAREGAS', 'Vender chips a talleres autorizados', TRUE),
    ('CHIPS_VER', 'Consultar inventario de chips', 'FAREGAS', 'Ver stock y movimientos de chips en las sedes asignadas', TRUE),
    ('CONFIGURACION_CATEGORIAS', 'Configurar categorías', 'FAREGAS', 'Administrar categorías de servicios', TRUE),
    ('CONFIGURACION_EMPRESAS', 'Configurar empresas', 'FAREGAS', 'Administrar empresas emisoras y facturadores', TRUE),
    ('CONFIGURACION_PRODUCTOS', 'Configurar productos', 'FAREGAS', 'Administrar productos de facturación y mapeos DMS', TRUE),
    ('CONFIGURACION_SEDES', 'Configurar sedes', 'FAREGAS', 'Administrar configuración operativa de sedes', TRUE),
    ('CONFIGURACION_SERIES', 'Configurar series', 'FAREGAS', 'Administrar series de comprobantes por sede y tipo', TRUE),
    ('CONFIGURACION_SERVICIOS', 'Configurar servicios', 'FAREGAS', 'Administrar servicios prestados en sedes', TRUE),
    ('CONFIGURACION_TARIFAS', 'Configurar tarifas', 'FAREGAS', 'Administrar tarifas y precios por sede', TRUE),
    ('DASHBOARD_EXPORTAR', 'Exportar métricas de gestión', 'FAREGAS', 'Exportar reportes del panel de control de FAREGAS', TRUE),
    ('DASHBOARD_GLOBAL', 'Ver métricas de todas las sedes', 'FAREGAS', 'Acceder a métricas consolidadas de todas las sedes en el dashboard', TRUE),
    ('DASHBOARD_SEDE', 'Ver métricas de sedes asignadas', 'FAREGAS', 'Acceder a métricas de las sedes asignadas en el dashboard', TRUE),
    ('DESCUENTOS_ADMINISTRAR', 'Administrar descuentos comerciales', 'FAREGAS', 'Crear, editar y activar reglas comerciales de descuento y convenios', TRUE),
    ('FAREGAS_ANULAR_COMPROBANTE', 'Anular comprobante electrónico FAREGAS', 'FAREGAS', 'Permite iniciar la baja fiscal de comprobantes electrónicos FAREGAS; no incluye rectificaciones ni notas de crédito.', TRUE),
    ('FAREGAS_CERTIFICADO_ANULAR_EJECUTAR', 'Ejecutar anulación técnica de certificado', 'FAREGAS', 'Aplica en base de datos la anulación técnica del certificado luego de verificaciones fiscales y de flujo.', TRUE),
    ('FAREGAS_CERTIFICADO_RECTIFICAR_EJECUTAR', 'Ejecutar rectificación técnica de certificado', 'FAREGAS', 'Aplica la versión rectificada vigente del certificado manteniendo el histórico inmutable.', TRUE),
    ('FAREGAS_NOTA_CREDITO', 'Emitir nota de crédito', 'FAREGAS', 'Permite preparar y emitir notas de crédito electrónicas vinculadas a comprobantes de FAREGAS.', TRUE),
    ('FAREGAS_NOTA_CREDITO_APROBAR', 'Aprobar solicitudes de nota de crédito', 'FAREGAS', 'Permite aprobar solicitudes de nota de crédito creadas por sedes u operadores.', TRUE),
    ('FAREGAS_NOTA_CREDITO_AUTOAPROBAR', 'Aprobación automática de nota de crédito', 'FAREGAS', 'Permite que notas de crédito bajo umbral o reglas específicas no requieran aprobación de un tercero.', TRUE),
    ('FAREGAS_NOTIFICACION_CORTESIA_RECIBIR', 'Recibir notificaciones de cortesías', 'FAREGAS', 'Recibe avisos informativos cuando se emite una cortesía en una sede autorizada. No autoriza a emitir cortesías.', TRUE),
    ('FAREGAS_SOLICITUD_ADMINISTRAR', 'Administrar panel de solicitudes operativas', 'FAREGAS', 'Acceso a la bandeja global de solicitudes de anulación, rectificación y notas de crédito.', TRUE),
    ('FAREGAS_SOLICITUD_APROBAR', 'Aprobar solicitudes operativas', 'FAREGAS', 'Permite autorizar formalmente una solicitud de anulación o rectificación.', TRUE),
    ('FAREGAS_SOLICITUD_AUTOAPROBAR', 'Auto-aprobar solicitudes propias', 'FAREGAS', 'Permite auto-aprobar solicitudes creadas por el mismo usuario cuando la regla lo permite.', TRUE),
    ('FAREGAS_SOLICITUD_AUTOEJECUTAR', 'Auto-ejecutar solicitudes aprobadas', 'FAREGAS', 'Permite disparar la ejecución automática tras la aprobación sin intervención adicional.', TRUE),
    ('FAREGAS_SOLICITUD_CREAR', 'Crear solicitudes administrativas', 'FAREGAS', 'Permite a un operador crear solicitudes de anulación, rectificación o nota de crédito.', TRUE),
    ('FAREGAS_SOLICITUD_RECHAZAR', 'Rechazar solicitudes operativas', 'FAREGAS', 'Permite desestimar o rechazar solicitudes pendientes de aprobación.', TRUE),
    ('FAREGAS_SOLICITUD_VER', 'Consultar solicitudes operativas', 'FAREGAS', 'Ver el estado, historial y trazabilidad de solicitudes de su sede o ámbito.', TRUE),
    ('MENU_AUDITORIA', 'Menú Auditoría', 'FAREGAS', 'Acceso al módulo de auditoría de accesos y operaciones', TRUE),
    ('MENU_CHIPS', 'Menú Chips', 'FAREGAS', 'Acceso al módulo principal de control de chips', TRUE),
    ('MENU_CHIPS_INVENTARIO', 'Submenú Inventario Chips', 'FAREGAS', 'Acceso a inventario y stock físico de chips', TRUE),
    ('MENU_CHIPS_TIPOS', 'Submenú Tipos de Chip', 'FAREGAS', 'Acceso a tipos y especificaciones técnicas de chips', TRUE),
    ('MENU_CHIPS_VENTAS', 'Submenú Ventas Chips', 'FAREGAS', 'Acceso al registro de venta de chips sueltos', TRUE),
    ('MENU_CONFIGURACION', 'Menú Configuración', 'FAREGAS', 'Acceso al menú principal de configuración', TRUE),
    ('MENU_CONFIGURACION_CATALOGO', 'Submenú Catálogo', 'FAREGAS', 'Acceso a catálogos operativos del sistema', TRUE),
    ('MENU_CONFIGURACION_CORRELATIVOS', 'Submenú Correlativos', 'FAREGAS', 'Acceso a correlativos y series de certificados', TRUE),
    ('MENU_CONFIGURACION_EMPRESAS', 'Submenú Empresas', 'FAREGAS', 'Acceso a configuración de empresas y facturadores', TRUE),
    ('MENU_CONFIGURACION_SEDES', 'Submenú Sedes', 'FAREGAS', 'Acceso a administración de sedes y plantas', TRUE),
    ('MENU_CONFIGURACION_TARIFAS', 'Submenú Tarifas', 'FAREGAS', 'Acceso a configuración de tarifas y precios', TRUE),
    ('MENU_DASHBOARD', 'Menú Dashboard', 'FAREGAS', 'Acceso al panel de control y analítica', TRUE),
    ('MENU_DESCUENTOS', 'Menú Descuentos', 'FAREGAS', 'Acceso al módulo de descuentos comerciales y cortesías', TRUE),
    ('MENU_FACTURACION', 'Menú Facturación', 'FAREGAS', 'Acceso al módulo principal de facturación electrónica', TRUE),
    ('MENU_FACTURACION_CLIENTES', 'Submenú Clientes Facturación', 'FAREGAS', 'Acceso a clientes locales de facturación', TRUE),
    ('MENU_FACTURACION_COMPROBANTES', 'Submenú Comprobantes', 'FAREGAS', 'Acceso a comprobantes emitidos y notas de crédito', TRUE),
    ('MENU_FACTURACION_PREPARACION', 'Submenú Preparación Facturación', 'FAREGAS', 'Acceso al flujo de preparación de comprobantes', TRUE),
    ('MENU_FACTURACION_SERIES', 'Submenú Series Facturación', 'FAREGAS', 'Acceso a series de comprobantes electrónicos', TRUE),
    ('MENU_INICIO', 'Menú Inicio', 'FAREGAS', 'Acceso a la pantalla principal del sistema', TRUE),
    ('MENU_USUARIOS', 'Menú Usuarios', 'FAREGAS', 'Acceso a la gestión de usuarios y perfiles', TRUE)
ON CONFLICT (clave) DO UPDATE
SET nombre = EXCLUDED.nombre,
    modulo = EXCLUDED.modulo,
    descripcion = EXCLUDED.descripcion,
    activo = EXCLUDED.activo;

-- ----------------------------------------------------------------------------
-- 3. ASIGNACIONES DE PERMISOS A PERFILES (fg_perfil_permiso)
-- Matriz auditada extraída de inspeccion
-- ----------------------------------------------------------------------------
INSERT INTO public.fg_perfil_permiso (perfil_clave, permiso_clave)
VALUES
    ('AMINISTRADOR', 'CHIPS_BAJA'),
    ('AMINISTRADOR', 'CHIPS_CONFIGURAR'),
    ('AMINISTRADOR', 'CHIPS_INGRESAR'),
    ('AMINISTRADOR', 'CHIPS_TRANSFERIR'),
    ('AMINISTRADOR', 'CHIPS_VENDER'),
    ('AMINISTRADOR', 'CHIPS_VER'),
    ('AMINISTRADOR', 'CONFIGURACION_CATEGORIAS'),
    ('AMINISTRADOR', 'CONFIGURACION_EMPRESAS'),
    ('AMINISTRADOR', 'CONFIGURACION_PRODUCTOS'),
    ('AMINISTRADOR', 'CONFIGURACION_SEDES'),
    ('AMINISTRADOR', 'CONFIGURACION_SERIES'),
    ('AMINISTRADOR', 'CONFIGURACION_SERVICIOS'),
    ('AMINISTRADOR', 'CONFIGURACION_TARIFAS'),
    ('AMINISTRADOR', 'DASHBOARD_EXPORTAR'),
    ('AMINISTRADOR', 'DASHBOARD_GLOBAL'),
    ('AMINISTRADOR', 'DASHBOARD_SEDE'),
    ('AMINISTRADOR', 'DESCUENTOS_ADMINISTRAR'),
    ('AMINISTRADOR', 'FAREGAS_ANULAR_COMPROBANTE'),
    ('AMINISTRADOR', 'FAREGAS_CERTIFICADO_ANULAR_EJECUTAR'),
    ('AMINISTRADOR', 'FAREGAS_CERTIFICADO_RECTIFICAR_EJECUTAR'),
    ('AMINISTRADOR', 'FAREGAS_NOTA_CREDITO'),
    ('AMINISTRADOR', 'FAREGAS_NOTA_CREDITO_APROBAR'),
    ('AMINISTRADOR', 'FAREGAS_NOTA_CREDITO_AUTOAPROBAR'),
    ('AMINISTRADOR', 'FAREGAS_NOTIFICACION_CORTESIA_RECIBIR'),
    ('AMINISTRADOR', 'FAREGAS_SOLICITUD_ADMINISTRAR'),
    ('AMINISTRADOR', 'FAREGAS_SOLICITUD_APROBAR'),
    ('AMINISTRADOR', 'FAREGAS_SOLICITUD_AUTOAPROBAR'),
    ('AMINISTRADOR', 'FAREGAS_SOLICITUD_AUTOEJECUTAR'),
    ('AMINISTRADOR', 'FAREGAS_SOLICITUD_CREAR'),
    ('AMINISTRADOR', 'FAREGAS_SOLICITUD_RECHAZAR'),
    ('AMINISTRADOR', 'FAREGAS_SOLICITUD_VER'),
    ('AMINISTRADOR', 'MENU_AUDITORIA'),
    ('AMINISTRADOR', 'MENU_CHIPS'),
    ('AMINISTRADOR', 'MENU_CHIPS_INVENTARIO'),
    ('AMINISTRADOR', 'MENU_CHIPS_TIPOS'),
    ('AMINISTRADOR', 'MENU_CHIPS_VENTAS'),
    ('AMINISTRADOR', 'MENU_CONFIGURACION'),
    ('AMINISTRADOR', 'MENU_CONFIGURACION_CATALOGO'),
    ('AMINISTRADOR', 'MENU_CONFIGURACION_CORRELATIVOS'),
    ('AMINISTRADOR', 'MENU_CONFIGURACION_EMPRESAS'),
    ('AMINISTRADOR', 'MENU_CONFIGURACION_SEDES'),
    ('AMINISTRADOR', 'MENU_CONFIGURACION_TARIFAS'),
    ('AMINISTRADOR', 'MENU_DASHBOARD'),
    ('AMINISTRADOR', 'MENU_DESCUENTOS'),
    ('AMINISTRADOR', 'MENU_FACTURACION'),
    ('AMINISTRADOR', 'MENU_FACTURACION_CLIENTES'),
    ('AMINISTRADOR', 'MENU_FACTURACION_COMPROBANTES'),
    ('AMINISTRADOR', 'MENU_FACTURACION_PREPARACION'),
    ('AMINISTRADOR', 'MENU_FACTURACION_SERIES'),
    ('AMINISTRADOR', 'MENU_INICIO'),
    ('AMINISTRADOR', 'MENU_USUARIOS'),
    ('ADMINISTRADOR', 'CHIPS_BAJA'),
    ('ADMINISTRADOR', 'CHIPS_CONFIGURAR'),
    ('ADMINISTRADOR', 'CHIPS_INGRESAR'),
    ('ADMINISTRADOR', 'CHIPS_TRANSFERIR'),
    ('ADMINISTRADOR', 'CHIPS_VENDER'),
    ('ADMINISTRADOR', 'CHIPS_VER'),
    ('ADMINISTRADOR', 'CONFIGURACION_CATEGORIAS'),
    ('ADMINISTRADOR', 'CONFIGURACION_EMPRESAS'),
    ('ADMINISTRADOR', 'CONFIGURACION_PRODUCTOS'),
    ('ADMINISTRADOR', 'CONFIGURACION_SEDES'),
    ('ADMINISTRADOR', 'CONFIGURACION_SERIES'),
    ('ADMINISTRADOR', 'CONFIGURACION_SERVICIOS'),
    ('ADMINISTRADOR', 'CONFIGURACION_TARIFAS'),
    ('ADMINISTRADOR', 'DASHBOARD_EXPORTAR'),
    ('ADMINISTRADOR', 'DASHBOARD_GLOBAL'),
    ('ADMINISTRADOR', 'DASHBOARD_SEDE'),
    ('ADMINISTRADOR', 'DESCUENTOS_ADMINISTRAR'),
    ('ADMINISTRADOR', 'FAREGAS_ANULAR_COMPROBANTE'),
    ('ADMINISTRADOR', 'FAREGAS_CERTIFICADO_ANULAR_EJECUTAR'),
    ('ADMINISTRADOR', 'FAREGAS_CERTIFICADO_RECTIFICAR_EJECUTAR'),
    ('ADMINISTRADOR', 'FAREGAS_NOTA_CREDITO'),
    ('ADMINISTRADOR', 'FAREGAS_NOTA_CREDITO_APROBAR'),
    ('ADMINISTRADOR', 'FAREGAS_NOTA_CREDITO_AUTOAPROBAR'),
    ('ADMINISTRADOR', 'FAREGAS_NOTIFICACION_CORTESIA_RECIBIR'),
    ('ADMINISTRADOR', 'FAREGAS_SOLICITUD_ADMINISTRAR'),
    ('ADMINISTRADOR', 'FAREGAS_SOLICITUD_APROBAR'),
    ('ADMINISTRADOR', 'FAREGAS_SOLICITUD_AUTOAPROBAR'),
    ('ADMINISTRADOR', 'FAREGAS_SOLICITUD_AUTOEJECUTAR'),
    ('ADMINISTRADOR', 'FAREGAS_SOLICITUD_CREAR'),
    ('ADMINISTRADOR', 'FAREGAS_SOLICITUD_RECHAZAR'),
    ('ADMINISTRADOR', 'FAREGAS_SOLICITUD_VER'),
    ('ADMINISTRADOR', 'MENU_AUDITORIA'),
    ('ADMINISTRADOR', 'MENU_CHIPS'),
    ('ADMINISTRADOR', 'MENU_CHIPS_INVENTARIO'),
    ('ADMINISTRADOR', 'MENU_CHIPS_TIPOS'),
    ('ADMINISTRADOR', 'MENU_CHIPS_VENTAS'),
    ('ADMINISTRADOR', 'MENU_CONFIGURACION'),
    ('ADMINISTRADOR', 'MENU_CONFIGURACION_CATALOGO'),
    ('ADMINISTRADOR', 'MENU_CONFIGURACION_CORRELATIVOS'),
    ('ADMINISTRADOR', 'MENU_CONFIGURACION_EMPRESAS'),
    ('ADMINISTRADOR', 'MENU_CONFIGURACION_SEDES'),
    ('ADMINISTRADOR', 'MENU_CONFIGURACION_TARIFAS'),
    ('ADMINISTRADOR', 'MENU_DASHBOARD'),
    ('ADMINISTRADOR', 'MENU_DESCUENTOS'),
    ('ADMINISTRADOR', 'MENU_FACTURACION'),
    ('ADMINISTRADOR', 'MENU_FACTURACION_CLIENTES'),
    ('ADMINISTRADOR', 'MENU_FACTURACION_COMPROBANTES'),
    ('ADMINISTRADOR', 'MENU_FACTURACION_PREPARACION'),
    ('ADMINISTRADOR', 'MENU_FACTURACION_SERIES'),
    ('ADMINISTRADOR', 'MENU_INICIO'),
    ('ADMINISTRADOR', 'MENU_USUARIOS'),
    ('CONTADOR', 'DASHBOARD_EXPORTAR'),
    ('CONTADOR', 'DASHBOARD_GLOBAL'),
    ('CONTADOR', 'MENU_DASHBOARD'),
    ('CONTADOR', 'MENU_FACTURACION'),
    ('CONTADOR', 'MENU_FACTURACION_COMPROBANTES'),
    ('CONTADOR', 'MENU_INICIO'),
    ('JEFE_PLANTA', 'CHIPS_TRANSFERIR'),
    ('JEFE_PLANTA', 'CHIPS_VER'),
    ('JEFE_PLANTA', 'DASHBOARD_SEDE'),
    ('JEFE_PLANTA', 'FAREGAS_ANULAR_COMPROBANTE'),
    ('JEFE_PLANTA', 'FAREGAS_SOLICITUD_CREAR'),
    ('JEFE_PLANTA', 'FAREGAS_SOLICITUD_VER'),
    ('JEFE_PLANTA', 'MENU_CHIPS'),
    ('JEFE_PLANTA', 'MENU_CHIPS_INVENTARIO'),
    ('JEFE_PLANTA', 'MENU_DASHBOARD'),
    ('JEFE_PLANTA', 'MENU_FACTURACION'),
    ('JEFE_PLANTA', 'MENU_FACTURACION_COMPROBANTES'),
    ('JEFE_PLANTA', 'MENU_INICIO'),
    ('OPERADOR', 'CHIPS_VENDER'),
    ('OPERADOR', 'CHIPS_VER'),
    ('OPERADOR', 'FAREGAS_SOLICITUD_CREAR'),
    ('OPERADOR', 'FAREGAS_SOLICITUD_VER'),
    ('OPERADOR', 'MENU_CHIPS'),
    ('OPERADOR', 'MENU_CHIPS_INVENTARIO'),
    ('OPERADOR', 'MENU_CHIPS_VENTAS'),
    ('OPERADOR', 'MENU_FACTURACION'),
    ('OPERADOR', 'MENU_FACTURACION_CLIENTES'),
    ('OPERADOR', 'MENU_FACTURACION_COMPROBANTES'),
    ('OPERADOR', 'MENU_FACTURACION_PREPARACION'),
    ('OPERADOR', 'MENU_INICIO'),
    ('CAJERO', 'CHIPS_VENDER'),
    ('CAJERO', 'CHIPS_VER'),
    ('CAJERO', 'MENU_CHIPS'),
    ('CAJERO', 'MENU_CHIPS_VENTAS'),
    ('CAJERO', 'MENU_FACTURACION'),
    ('CAJERO', 'MENU_FACTURACION_CLIENTES'),
    ('CAJERO', 'MENU_FACTURACION_COMPROBANTES'),
    ('CAJERO', 'MENU_FACTURACION_PREPARACION'),
    ('CAJERO', 'MENU_INICIO'),
    ('CERTIFICADOR', 'FAREGAS_SOLICITUD_CREAR'),
    ('CERTIFICADOR', 'FAREGAS_SOLICITUD_VER'),
    ('CERTIFICADOR', 'MENU_INICIO'),
    ('CONSULTA', 'CHIPS_VER'),
    ('CONSULTA', 'DASHBOARD_SEDE'),
    ('CONSULTA', 'FAREGAS_SOLICITUD_VER'),
    ('CONSULTA', 'MENU_DASHBOARD'),
    ('CONSULTA', 'MENU_FACTURACION_COMPROBANTES'),
    ('CONSULTA', 'MENU_INICIO'),
    ('SUPERVISOR', 'CHIPS_VER'),
    ('SUPERVISOR', 'DASHBOARD_EXPORTAR'),
    ('SUPERVISOR', 'DASHBOARD_GLOBAL'),
    ('SUPERVISOR', 'FAREGAS_ANULAR_COMPROBANTE'),
    ('SUPERVISOR', 'FAREGAS_NOTA_CREDITO'),
    ('SUPERVISOR', 'FAREGAS_NOTA_CREDITO_APROBAR'),
    ('SUPERVISOR', 'FAREGAS_NOTIFICACION_CORTESIA_RECIBIR'),
    ('SUPERVISOR', 'FAREGAS_SOLICITUD_ADMINISTRAR'),
    ('SUPERVISOR', 'FAREGAS_SOLICITUD_APROBAR'),
    ('SUPERVISOR', 'FAREGAS_SOLICITUD_RECHAZAR'),
    ('SUPERVISOR', 'FAREGAS_SOLICITUD_VER'),
    ('SUPERVISOR', 'MENU_AUDITORIA'),
    ('SUPERVISOR', 'MENU_CHIPS'),
    ('SUPERVISOR', 'MENU_CHIPS_INVENTARIO'),
    ('SUPERVISOR', 'MENU_DASHBOARD'),
    ('SUPERVISOR', 'MENU_DESCUENTOS'),
    ('SUPERVISOR', 'MENU_FACTURACION'),
    ('SUPERVISOR', 'MENU_FACTURACION_COMPROBANTES'),
    ('SUPERVISOR', 'MENU_INICIO'),
    ('TALLER', 'MENU_INICIO'),
    ('SISTEMAS', 'CHIPS_BAJA'),
    ('SISTEMAS', 'CHIPS_CONFIGURAR'),
    ('SISTEMAS', 'CHIPS_INGRESAR'),
    ('SISTEMAS', 'CHIPS_TRANSFERIR'),
    ('SISTEMAS', 'CHIPS_VENDER'),
    ('SISTEMAS', 'CHIPS_VER'),
    ('SISTEMAS', 'CONFIGURACION_CATEGORIAS'),
    ('SISTEMAS', 'CONFIGURACION_EMPRESAS'),
    ('SISTEMAS', 'CONFIGURACION_PRODUCTOS'),
    ('SISTEMAS', 'CONFIGURACION_SEDES'),
    ('SISTEMAS', 'CONFIGURACION_SERIES'),
    ('SISTEMAS', 'CONFIGURACION_SERVICIOS'),
    ('SISTEMAS', 'CONFIGURACION_TARIFAS'),
    ('SISTEMAS', 'DASHBOARD_EXPORTAR'),
    ('SISTEMAS', 'DASHBOARD_GLOBAL'),
    ('SISTEMAS', 'DASHBOARD_SEDE'),
    ('SISTEMAS', 'DESCUENTOS_ADMINISTRAR'),
    ('SISTEMAS', 'FAREGAS_ANULAR_COMPROBANTE'),
    ('SISTEMAS', 'FAREGAS_CERTIFICADO_ANULAR_EJECUTAR'),
    ('SISTEMAS', 'FAREGAS_CERTIFICADO_RECTIFICAR_EJECUTAR'),
    ('SISTEMAS', 'FAREGAS_NOTA_CREDITO'),
    ('SISTEMAS', 'FAREGAS_NOTA_CREDITO_APROBAR'),
    ('SISTEMAS', 'FAREGAS_NOTA_CREDITO_AUTOAPROBAR'),
    ('SISTEMAS', 'FAREGAS_NOTIFICACION_CORTESIA_RECIBIR'),
    ('SISTEMAS', 'FAREGAS_SOLICITUD_ADMINISTRAR'),
    ('SISTEMAS', 'FAREGAS_SOLICITUD_APROBAR'),
    ('SISTEMAS', 'FAREGAS_SOLICITUD_AUTOAPROBAR'),
    ('SISTEMAS', 'FAREGAS_SOLICITUD_AUTOEJECUTAR'),
    ('SISTEMAS', 'FAREGAS_SOLICITUD_CREAR'),
    ('SISTEMAS', 'FAREGAS_SOLICITUD_RECHAZAR'),
    ('SISTEMAS', 'FAREGAS_SOLICITUD_VER'),
    ('SISTEMAS', 'MENU_AUDITORIA'),
    ('SISTEMAS', 'MENU_CHIPS'),
    ('SISTEMAS', 'MENU_CHIPS_INVENTARIO'),
    ('SISTEMAS', 'MENU_CHIPS_TIPOS'),
    ('SISTEMAS', 'MENU_CHIPS_VENTAS'),
    ('SISTEMAS', 'MENU_CONFIGURACION'),
    ('SISTEMAS', 'MENU_CONFIGURACION_CATALOGO'),
    ('SISTEMAS', 'MENU_CONFIGURACION_CORRELATIVOS'),
    ('SISTEMAS', 'MENU_CONFIGURACION_EMPRESAS'),
    ('SISTEMAS', 'MENU_CONFIGURACION_SEDES'),
    ('SISTEMAS', 'MENU_CONFIGURACION_TARIFAS'),
    ('SISTEMAS', 'MENU_DASHBOARD'),
    ('SISTEMAS', 'MENU_DESCUENTOS'),
    ('SISTEMAS', 'MENU_FACTURACION'),
    ('SISTEMAS', 'MENU_FACTURACION_CLIENTES'),
    ('SISTEMAS', 'MENU_FACTURACION_COMPROBANTES'),
    ('SISTEMAS', 'MENU_FACTURACION_PREPARACION'),
    ('SISTEMAS', 'MENU_FACTURACION_SERIES'),
    ('SISTEMAS', 'MENU_INICIO'),
    ('SISTEMAS', 'MENU_USUARIOS')
ON CONFLICT (perfil_clave, permiso_clave) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 4. CATÁLOGO DE TIPOS DE CERTIFICADO (fg_tipo_certificado)
-- ----------------------------------------------------------------------------
INSERT INTO public.fg_tipo_certificado (
    clave, nombre, descripcion, activo,
    entidad_certificadora_nombre, resolucion_directoral,
    domicilio_fiscal, telefono, lugar_emision, codigo, ancho_correlativo
)
VALUES
    ('GLP_ANUAL', 'GLP Revisión Anual', 'Certificación anual periódica para vehículos a GLP', TRUE, 'FAREGAS S.A.C.', 'RD-001-2024-MTC', 'Lima, Perú', '(01) 500-0000', 'LIMA', '01', 8),
    ('GNV_ANUAL', 'GNV Revisión Anual', 'Certificación anual periódica para vehículos a GNV', TRUE, 'FAREGAS S.A.C.', 'RD-001-2024-MTC', 'Lima, Perú', '(01) 500-0000', 'LIMA', '02', 8),
    ('GLP_INICIAL', 'Conversión a GLP', 'Certificación inicial de conversión vehicular a GLP', TRUE, 'FAREGAS S.A.C.', 'RD-001-2024-MTC', 'Lima, Perú', '(01) 500-0000', 'LIMA', '03', 8),
    ('GNV_INICIAL', 'Conversión a GNV', 'Certificación inicial de conversión vehicular a GNV', TRUE, 'FAREGAS S.A.C.', 'RD-001-2024-MTC', 'Lima, Perú', '(01) 500-0000', 'LIMA', '04', 8),
    ('CONFORMIDAD', 'Certificado de Conformidad', 'Certificado de conformidad de modificación o fabricación', TRUE, 'FAREGAS S.A.C.', 'RD-001-2024-MTC', 'Lima, Perú', '(01) 500-0000', 'LIMA', '05', 8),
    ('DUPLICADO', 'Duplicado de Certificado', 'Emisión de duplicado de certificado por pérdida o deterioro', TRUE, 'FAREGAS S.A.C.', 'RD-001-2024-MTC', 'Lima, Perú', '(01) 500-0000', 'LIMA', '06', 8),
    ('MODIFICACION', 'Modificación de Características', 'Certificación de modificaciones mecánicas o estructurales', TRUE, 'FAREGAS S.A.C.', 'RD-001-2024-MTC', 'Lima, Perú', '(01) 500-0000', 'LIMA', '07', 8)
ON CONFLICT (clave) DO UPDATE
SET nombre = EXCLUDED.nombre,
    descripcion = EXCLUDED.descripcion,
    activo = EXCLUDED.activo,
    codigo = EXCLUDED.codigo;

-- ----------------------------------------------------------------------------
-- 5. USUARIO TÉCNICO DE SISTEMA (fg_usuario)
-- Cuenta deshabilitada (estado=false) exclusivamente para atribución de auditoría
-- de catálogos y semillas iniciales. No contiene credenciales de personas reales.
-- ----------------------------------------------------------------------------
INSERT INTO public.fg_usuario (username, user_type, contrasenha, perfil_id, estado)
VALUES ('SISTEMAS_FAREGAS', 'SISTEMA', 'CUENTA_TECNICA_INICIAL_BLOQUEADA', 'SISTEMAS', FALSE)
ON CONFLICT (username) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 6. REGLAS BASE DE DESCUENTO COMERCIAL (fg_descuento)
-- ----------------------------------------------------------------------------
INSERT INTO public.fg_descuento (
    codigo, nombre, tipo, tipo_calculo, valor,
    fecha_inicio, fecha_fin, activo, usuario_creacion
)
SELECT
    'CORTESIA_FAREGAS',
    'CORTESÍA FAREGAS',
    'PROMOCION',
    'PORCENTAJE',
    100,
    TIMESTAMP '2020-01-01 00:00:00',
    TIMESTAMP '2099-12-31 23:59:59',
    TRUE,
    'SISTEMAS_FAREGAS'
WHERE NOT EXISTS (
    SELECT 1
    FROM public.fg_descuento
    WHERE UPPER(BTRIM(codigo)) = 'CORTESIA_FAREGAS'
);

UPDATE public.fg_descuento
SET nombre = 'CORTESÍA FAREGAS',
    tipo = 'PROMOCION',
    tipo_calculo = 'PORCENTAJE',
    valor = 100,
    activo = TRUE,
    fecha_modificacion = CURRENT_TIMESTAMP,
    usuario_modificacion = 'SISTEMAS_FAREGAS'
WHERE UPPER(BTRIM(codigo)) = 'CORTESIA_FAREGAS';

COMMIT;
