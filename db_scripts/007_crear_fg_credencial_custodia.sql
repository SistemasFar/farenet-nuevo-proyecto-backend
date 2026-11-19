-- Migración versionada 007: Creación de tabla para custodia cifrada de credenciales administradas
-- Esquema no destructivo. Aislado a FAREGAS (sin tocar tablas ni vistas de FARENET).
-- Almacena contraseñas administradas cifradas con AES-256-GCM.
-- No almacena texto plano. La clave maestra se conserva estrictamente fuera de PostgreSQL.

CREATE TABLE IF NOT EXISTS public.fg_credencial_custodia (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    ciphertext TEXT NOT NULL,
    iv VARCHAR(64) NOT NULL,
    tag VARCHAR(64) NOT NULL,
    algoritmo VARCHAR(30) DEFAULT 'aes-256-gcm' NOT NULL,
    version_clave INT DEFAULT 1 NOT NULL,
    origen VARCHAR(50) DEFAULT 'ADMINISTRACION_USUARIOS' NOT NULL,
    creado_por VARCHAR(100) NOT NULL,
    fecha_creacion TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    fecha_actualizacion TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT fk_fg_credencial_custodia_user FOREIGN KEY (username) REFERENCES public.fg_usuario(username) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_fg_credencial_custodia_username
ON public.fg_credencial_custodia(LOWER(username));

COMMENT ON TABLE public.fg_credencial_custodia IS 'Almacén de secretos cifrados (AES-256-GCM) para credenciales expresamente administradas. Cero texto plano.';

