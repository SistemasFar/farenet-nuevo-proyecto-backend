-- Migración aditiva y exclusiva de FAREGAS.
-- No ejecutada automáticamente. Aplicar después de respaldo y revisión DBA.
-- Los usuarios existentes siguen autenticándose en fg_usuario; si todavía no
-- tienen fila de perfil propio, el backend muestra los datos heredados mediante
-- LEFT JOIN de solo lectura. Su perfil propio se crea al guardar su formulario.
-- No se realiza backfill: así se evitan colisiones documentarias y cualquier
-- escritura indirecta sobre persona durante el despliegue.

BEGIN;

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
    fecha_creacion timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion timestamp with time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fg_usuario_perfil_pkey PRIMARY KEY (usuario_username),
    CONSTRAINT fk_fg_usuario_perfil_usuario
        FOREIGN KEY (usuario_username)
        REFERENCES public.fg_usuario (username)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT uq_fg_usuario_perfil_documento
        UNIQUE (tipo_documento_key, nro_documento)
);

CREATE INDEX IF NOT EXISTS idx_fg_usuario_perfil_nombre
    ON public.fg_usuario_perfil (nombre_razon_social, apellidos, nombres);

-- Una migración histórica vinculó los movimientos de inventario con usuario
-- (FARENET). La estructura consolidada vigente ya usa fg_usuario. Corregir solo
-- la FK de la tabla FAREGAS para que cuentas nuevas no dependan de usuario.
DO $faregas_inventario_usuario_fk$
DECLARE
    restriccion record;
    tabla_movimiento oid := to_regclass('public.fg_inventario_cantidad_movimiento');
    tabla_usuario_legacy oid := to_regclass('public.usuario');
    tabla_usuario_faregas oid := to_regclass('public.fg_usuario');
    columna_usuario smallint;
BEGIN
    -- La tabla de inventario puede no existir en instalaciones parciales. La
    -- creación del perfil propio sigue siendo válida en ese caso.
    IF tabla_movimiento IS NULL THEN
        RETURN;
    END IF;

    IF tabla_usuario_faregas IS NULL THEN
        RAISE EXCEPTION 'No existe public.fg_usuario; no se puede independizar la FK de inventario';
    END IF;

    SELECT attnum::smallint
    INTO columna_usuario
    FROM pg_attribute
    WHERE attrelid = tabla_movimiento
      AND attname = 'usuario'
      AND NOT attisdropped;

    IF columna_usuario IS NULL THEN
        RAISE EXCEPTION 'No existe la columna usuario en public.fg_inventario_cantidad_movimiento';
    END IF;

    FOR restriccion IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = tabla_movimiento
          AND tabla_usuario_legacy IS NOT NULL
          AND confrelid = tabla_usuario_legacy
          AND contype = 'f'
    LOOP
        EXECUTE format(
            'ALTER TABLE public.fg_inventario_cantidad_movimiento DROP CONSTRAINT %I',
            restriccion.conname
        );
    END LOOP;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = tabla_movimiento
          AND confrelid = tabla_usuario_faregas
          AND contype = 'f'
          AND conkey = ARRAY[columna_usuario]::smallint[]
    ) THEN
        IF EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conrelid = tabla_movimiento
              AND conname = 'fk_fg_inv_cantidad_usuario'
        ) THEN
            RAISE EXCEPTION 'La restricción fk_fg_inv_cantidad_usuario existe con una definición incompatible';
        END IF;

        ALTER TABLE public.fg_inventario_cantidad_movimiento
            ADD CONSTRAINT fk_fg_inv_cantidad_usuario
            FOREIGN KEY (usuario)
            REFERENCES public.fg_usuario (username)
            ON UPDATE CASCADE ON DELETE RESTRICT
            NOT VALID;
    END IF;
END;
$faregas_inventario_usuario_fk$;

COMMIT;
