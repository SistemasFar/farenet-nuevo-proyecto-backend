-- =============================================================================
-- POLÍTICA DE MÍNIMOS PRIVILEGIOS: ROL OPERATIVO FAREGAS EN BD COMPARTIDA 'inspeccion'
-- =============================================================================
-- OBJETIVO: Permitir a FAREGAS operar de forma autónoma con DML completo sobre sus
-- tablas propias (fg_*), garantizando acceso de SOLO LECTURA (SELECT) sobre las tablas
-- operativas y catálogos de FARENET, e IMPIDIENDO cualquier INSERT/UPDATE/DELETE/DDL ajeno.
--
-- NOTA DE SEGURIDAD: Este script está preparado para ser ejecutado por el DBA / Administrador
-- de Infraestructura en PostgreSQL. NO altera datos productivos.
-- =============================================================================

-- 1. CREACIÓN DEL ROL OPERATIVO (Sin permisos de superusuario, sin DDL de esquema)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'faregas_app_user') THEN
        CREATE ROLE faregas_app_user WITH
            LOGIN
            NOSUPERUSER
            NOCREATEDB
            NOCREATEROLE
            NOINHERIT
            NOREPLICATION
            CONNECTION LIMIT 50
            PASSWORD 'CambiarPorPasswordSeguroEnProduccion!';
        RAISE NOTICE 'Rol faregas_app_user creado exitosamente.';
    ELSE
        RAISE NOTICE 'Rol faregas_app_user ya existe.';
    END IF;
END $$;

-- 2. REVOCACIÓN PREVENTIVA DE PRIVILEGIOS POR DEFECTO EN EL ESQUEMA PUBLIC
-- Impide que el rol cree nuevas tablas, vistas o tipos en public (previene DDL en runtime)
REVOKE CREATE ON SCHEMA public FROM faregas_app_user;
GRANT USAGE ON SCHEMA public TO faregas_app_user;

-- 3. REVOCACIÓN GENERAL PREVIA SOBRE TODAS LAS TABLAS DE PUBLIC
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM faregas_app_user;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM faregas_app_user;

-- 4. CONCESIÓN DE DML COMPLETO SOBRE TODAS LAS TABLAS PROPIAS DE FAREGAS (fg_*)
-- Incluye: fg_usuario, fg_usuario_perfil, fg_usuario_sesion, fg_usuario_planta,
-- fg_certificado, fg_comprobante, fg_pago, fg_recibo, fg_inventario, fg_chip,
-- fg_solicitud_operacion, fg_auditoria_config, fg_credencial_custodia, fg_usuario_mfa, etc.
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT tablename 
        FROM pg_tables 
        WHERE schemaname = 'public' AND tablename LIKE 'fg_%'
    ) LOOP
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO faregas_app_user', r.tablename);
    END LOOP;
END $$;

-- Secuencias asociadas a tablas fg_*
DO $$
DECLARE
    s RECORD;
BEGIN
    FOR s IN (
        SELECT sequence_name 
        FROM information_schema.sequences 
        WHERE sequence_schema = 'public' AND sequence_name LIKE 'fg_%'
    ) LOOP
        EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.%I TO faregas_app_user', s.sequence_name);
    END LOOP;
END $$;

-- 5. CONCESIÓN EXCLUSIVA DE SOLO LECTURA (SELECT) SOBRE TABLAS COMPARTIDAS DE FARENET
-- A. Tablas Operativas de FARENET (Acceso para lectura de datos vehiculares y de titular)
GRANT SELECT ON TABLE public.persona TO faregas_app_user;
GRANT SELECT ON TABLE public.vehiculo TO faregas_app_user;
GRANT SELECT ON TABLE public.tarjetapropiedad TO faregas_app_user;

-- B. Catálogos Vehiculares y Maestros Compartidos
GRANT SELECT ON TABLE public.categoria TO faregas_app_user;
GRANT SELECT ON TABLE public.vehiculoclase TO faregas_app_user;
GRANT SELECT ON TABLE public.marca TO faregas_app_user;
GRANT SELECT ON TABLE public.modelo TO faregas_app_user;
GRANT SELECT ON TABLE public.combustible TO faregas_app_user;
GRANT SELECT ON TABLE public.color TO faregas_app_user;
GRANT SELECT ON TABLE public.carroceria TO faregas_app_user;
GRANT SELECT ON TABLE public.tipoplaca TO faregas_app_user;
GRANT SELECT ON TABLE public.tipoinspeccion TO faregas_app_user;
GRANT SELECT ON TABLE public.conceptoinspeccion TO faregas_app_user;
GRANT SELECT ON TABLE public.conceptoinspecciondetalle TO faregas_app_user;
GRANT SELECT ON TABLE public.tipocertificado TO faregas_app_user;
GRANT SELECT ON TABLE public.tipoautorizacion TO faregas_app_user;
GRANT SELECT ON TABLE public.tipodocumento TO faregas_app_user;
GRANT SELECT ON TABLE public.tipopoliza TO faregas_app_user;
GRANT SELECT ON TABLE public.aseguradora TO faregas_app_user;

-- C. Catálogos Financieros, Comerciales y Ubigeo
GRANT SELECT ON TABLE public.moneda TO faregas_app_user;
GRANT SELECT ON TABLE public.formapago TO faregas_app_user;
GRANT SELECT ON TABLE public.cuentacorriente TO faregas_app_user;
GRANT SELECT ON TABLE public.entidadfinanciera TO faregas_app_user;
GRANT SELECT ON TABLE public.tarjeta TO faregas_app_user;
GRANT SELECT ON TABLE public.tipocontado TO faregas_app_user;
GRANT SELECT ON TABLE public.tipodocumentoidentidad TO faregas_app_user;
GRANT SELECT ON TABLE public.pais TO faregas_app_user;
GRANT SELECT ON TABLE public.departamento TO faregas_app_user;
GRANT SELECT ON TABLE public.provincia TO faregas_app_user;
GRANT SELECT ON TABLE public.distrito TO faregas_app_user;
GRANT SELECT ON TABLE public.seriedocumentobase TO faregas_app_user;

-- 6. PRIVILEGIOS POR DEFECTO PARA FUTURAS TABLAS
-- Si se crean nuevas tablas fg_* en futuras migraciones, otorgar DML al rol
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO faregas_app_user;

-- 7. VERIFICACIÓN DE AUDITORÍA Y SEGURIDAD
-- Comprobar que no existen permisos de escritura (INSERT, UPDATE, DELETE, TRUNCATE) 
-- en ninguna tabla que no sea fg_* para faregas_app_user:
--
-- SELECT table_name, privilege_type 
-- FROM information_schema.role_table_grants 
-- WHERE grantee = 'faregas_app_user' 
--   AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
--   AND table_name NOT LIKE 'fg_%';
--
-- (El resultado de la consulta anterior DEBE SER CERO FILAS).
