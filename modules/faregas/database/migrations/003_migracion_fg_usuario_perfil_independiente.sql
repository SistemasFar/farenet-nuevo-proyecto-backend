-- ============================================================================
-- MIGRACIÓN INCREMENTAL: 003_migracion_fg_usuario_perfil_independiente.sql
-- Sistema: FAREGAS
-- Objetivo: Crear la tabla fg_usuario_perfil para la administración independiente
--           de perfiles y datos personales de usuarios FAREGAS, desvinculando
--           por completo las escrituras de la tabla 'persona' de FARENET.
-- Idempotencia: 100% seguro para re-ejecución sin duplicados ni pérdida de datos.
-- ============================================================================

BEGIN;

-- 1. Crear tabla fg_usuario_perfil si no existe
CREATE TABLE IF NOT EXISTS public.fg_usuario_perfil (
    usuario_username character varying(255) NOT NULL,
    tipo_documento_key character varying(20) NOT NULL,
    nro_documento character varying(20) NOT NULL,
    nombres character varying(200),
    apellidos character varying(200),
    nombre_razon_social character varying(500),
    pais_key character varying(20),
    departamento_key character varying(20),
    provincia_key character varying(20),
    distrito_key character varying(20),
    direccion character varying(500),
    email character varying(150),
    telefono character varying(100),
    persona_contacto character varying(255),
    fecha_creacion timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    fecha_actualizacion timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 2. Clave primaria
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fg_usuario_perfil_pkey'
    ) THEN
        ALTER TABLE ONLY public.fg_usuario_perfil
            ADD CONSTRAINT fg_usuario_perfil_pkey PRIMARY KEY (usuario_username);
    END IF;
END $$;

-- 3. Restricción de unicidad de documento
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_fg_usuario_perfil_documento'
    ) THEN
        ALTER TABLE ONLY public.fg_usuario_perfil
            ADD CONSTRAINT uq_fg_usuario_perfil_documento UNIQUE (tipo_documento_key, nro_documento);
    END IF;
END $$;

-- 4. Índice para búsquedas por nombre/apellidos
CREATE INDEX IF NOT EXISTS idx_fg_usuario_perfil_nombre 
    ON public.fg_usuario_perfil USING btree (nombre_razon_social, apellidos, nombres);

-- 5. Clave foránea hacia fg_usuario
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_fg_usuario_perfil_usuario'
    ) THEN
        ALTER TABLE ONLY public.fg_usuario_perfil
            ADD CONSTRAINT fk_fg_usuario_perfil_usuario 
            FOREIGN KEY (usuario_username) REFERENCES public.fg_usuario(username) 
            ON UPDATE CASCADE ON DELETE CASCADE;
    END IF;
END $$;

-- 6. Backfill inicial seguro desde 'persona' para usuarios existentes en fg_usuario
--    (Permite que los usuarios ya existentes tengan su perfil propio sin tocar FARENET)
DO $$
DECLARE
    tiene_tipo_doc boolean;
    tiene_dir boolean;
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'persona') THEN
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'persona' AND column_name = 'tipodocumentoidentidad_key'
        ) INTO tiene_tipo_doc;

        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'persona' AND column_name = 'direccion'
        ) INTO tiene_dir;

        IF tiene_tipo_doc AND tiene_dir THEN
            -- Entorno con esquema completo de persona (Base compartida / Producción)
            INSERT INTO public.fg_usuario_perfil (
                usuario_username, tipo_documento_key, nro_documento,
                nombres, apellidos, nombre_razon_social,
                pais_key, departamento_key, provincia_key, distrito_key,
                direccion, email, telefono, persona_contacto,
                fecha_creacion, fecha_actualizacion
            )
            SELECT 
                u.username,
                COALESCE(p.tipodocumentoidentidad_key, 'DNI'),
                COALESCE(p.nrodocumentoidentidad, u.persona_nrodocumentoidentidad, '00000000'),
                p.nombres,
                p.apellidos,
                p.nombrerazonsocial,
                p.pais_key,
                p.departamento_key,
                p.provincia_key,
                p.distrito_key,
                p.direccion,
                p.email,
                p.telefono,
                p.persona_contacto,
                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP
            FROM public.fg_usuario u
            JOIN public.persona p ON u.persona_nrodocumentoidentidad = p.nrodocumentoidentidad
            ON CONFLICT (usuario_username) DO NOTHING;
        ELSE
            -- Entorno aislado / stub minimalista
            INSERT INTO public.fg_usuario_perfil (
                usuario_username, tipo_documento_key, nro_documento,
                nombres, apellidos,
                fecha_creacion, fecha_actualizacion
            )
            SELECT 
                u.username,
                'DNI',
                COALESCE(u.persona_nrodocumentoidentidad, '00000000'),
                p.nombres,
                p.apellidos,
                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP
            FROM public.fg_usuario u
            JOIN public.persona p ON u.persona_nrodocumentoidentidad = p.nrodocumentoidentidad
            ON CONFLICT (usuario_username) DO NOTHING;
        END IF;
    END IF;
END $$;

COMMIT;
