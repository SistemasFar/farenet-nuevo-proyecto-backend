-- Migración versionada 008: Creación de tabla para segundo factor de autenticación (MFA / TOTP)
-- Esquema no destructivo. Aislado a FAREGAS (sin tocar tablas ni vistas de FARENET).
-- Almacena configuración TOTP (RFC 6238) con secreto cifrado (AES-256-GCM) y códigos de recuperación únicos con hash seguro.
-- Opt-in en desarrollo: no activa obligatoriamente MFA para usuarios existentes sin enrolamiento previo.

CREATE TABLE IF NOT EXISTS public.fg_usuario_mfa (
    username VARCHAR(100) PRIMARY KEY,
    activo BOOLEAN DEFAULT FALSE NOT NULL,
    secreto_cifrado TEXT,
    secreto_iv VARCHAR(64),
    secreto_tag VARCHAR(64),
    codigos_recuperacion JSONB DEFAULT '[]'::jsonb NOT NULL,
    ultimo_paso_usado BIGINT,
    enrolado_en TIMESTAMP WITH TIME ZONE,
    actualizado_en TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT fk_fg_usuario_mfa_user FOREIGN KEY (username) REFERENCES public.fg_usuario(username) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_fg_usuario_mfa_username
ON public.fg_usuario_mfa(LOWER(username));

COMMENT ON TABLE public.fg_usuario_mfa IS 'Almacén de segundo factor TOTP (RFC 6238) y códigos de recuperación únicos para administradores FAREGAS.';

