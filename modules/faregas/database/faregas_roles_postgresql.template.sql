-- PLANTILLA PARA REVISIÓN DBA. NO EJECUTAR SIN VENTANA Y APROBACIÓN.
-- Ejecutar con psql conectado a la base objetivo, usando un DBA.
-- No cambia la conexión activa de la aplicación ni revoca privilegios a otros roles.
-- Antes de aplicar: revisar membresías, privilegios de PUBLIC, dueños de tablas,
-- tablas/funciones adicionales requeridas por el despliegue y el resultado del
-- bloque de verificación del final.
-- Plantilla de una sola aplicación: verificar que estos cuatro roles no existan.

CREATE ROLE faregas_app
    NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;

CREATE ROLE faregas_runtime
    LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;

CREATE ROLE faregas_migrator
    NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;

CREATE ROLE faregas_migration
    LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;

\password faregas_runtime
\password faregas_migration

GRANT faregas_app TO faregas_runtime;
GRANT faregas_migrator TO faregas_migration;
GRANT CONNECT ON DATABASE inspeccion TO faregas_app;
GRANT CONNECT ON DATABASE inspeccion TO faregas_migrator;
REVOKE CREATE, TEMPORARY ON DATABASE inspeccion FROM faregas_app;
REVOKE CREATE, TEMPORARY ON DATABASE inspeccion FROM faregas_migrator;
GRANT USAGE ON SCHEMA public TO faregas_app;
REVOKE CREATE ON SCHEMA public FROM faregas_app;
GRANT USAGE, CREATE ON SCHEMA public TO faregas_migrator;

-- Limpiar concesiones directas previas a este grupo sin tocar otros roles.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM faregas_app;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM faregas_app;

-- FAREGAS puede operar sus tablas y consumir sus secuencias.
DO $faregas_grants$
DECLARE
    obj record;
BEGIN
    FOR obj IN
        SELECT schemaname, tablename
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename LIKE 'fg\_%' ESCAPE '\'
    LOOP
        EXECUTE format(
            'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I.%I TO faregas_app',
            obj.schemaname, obj.tablename
        );
    END LOOP;

    FOR obj IN
        SELECT n.nspname AS schemaname, c.relname AS sequencename
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'S'
          AND c.relname LIKE 'fg\_%' ESCAPE '\'
    LOOP
        EXECUTE format(
            'GRANT USAGE, SELECT ON SEQUENCE %I.%I TO faregas_app',
            obj.schemaname, obj.sequencename
        );
    END LOOP;
END;
$faregas_grants$;

-- Transferir propiedad solo de objetos FAREGAS existentes al rol de
-- migraciones. Esto le da DDL sobre fg_* y no sobre objetos heredados.
DO $faregas_owners$
DECLARE
    obj record;
BEGIN
    FOR obj IN
        SELECT schemaname, tablename
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename LIKE 'fg\_%' ESCAPE '\'
    LOOP
        EXECUTE format('ALTER TABLE %I.%I OWNER TO faregas_migrator', obj.schemaname, obj.tablename);
    END LOOP;

    FOR obj IN
        SELECT n.nspname AS schemaname, c.relname AS sequencename
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'S'
          AND c.relname LIKE 'fg\_%' ESCAPE '\'
    LOOP
        EXECUTE format('ALTER SEQUENCE %I.%I OWNER TO faregas_migrator', obj.schemaname, obj.sequencename);
    END LOOP;

    FOR obj IN
        SELECT n.nspname AS schemaname, p.proname,
               pg_get_function_identity_arguments(p.oid) AS argumentos
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname LIKE 'fg\_%' ESCAPE '\'
    LOOP
        EXECUTE format(
            'ALTER FUNCTION %I.%I(%s) OWNER TO faregas_migrator',
            obj.schemaname, obj.proname, obj.argumentos
        );
    END LOOP;
END;
$faregas_owners$;

-- Cada migración futura debe otorgar DML al grupo solo sobre las nuevas tablas
-- fg_* creadas por ella. No usar ALTER DEFAULT PRIVILEGES sobre todo public.

-- Tablas heredadas usadas por FAREGAS como fuente de consulta/FK.
GRANT SELECT ON TABLE
    public.persona,
    public.vehiculo,
    public.tarjetapropiedad,
    public.categoria,
    public.vehiculoclase,
    public.marca,
    public.modelo,
    public.combustible,
    public.color,
    public.carroceria,
    public.moneda,
    public.formapago,
    public.cuentacorriente,
    public.entidadfinanciera,
    public.tarjeta,
    public.tipocontado,
    public.seriedocumentobase,
    public.tipodocumentoidentidad,
    public.pais,
    public.departamento,
    public.provincia,
    public.distrito
TO faregas_app;

GRANT SELECT, REFERENCES ON TABLE
    public.persona,
    public.vehiculo,
    public.tarjetapropiedad,
    public.categoria,
    public.vehiculoclase,
    public.marca,
    public.modelo,
    public.combustible,
    public.color,
    public.carroceria,
    public.moneda,
    public.formapago,
    public.cuentacorriente,
    public.entidadfinanciera,
    public.tarjeta,
    public.tipocontado,
    public.seriedocumentobase,
    public.tipodocumentoidentidad,
    public.pais,
    public.departamento,
    public.provincia,
    public.distrito
TO faregas_migrator;

-- Garantía ejecutable: la plantilla debe abortar si faregas_runtime recibe
-- escritura sobre cualquier tabla heredada, incluso por PUBLIC o por otra
-- membresía agregada antes de ejecutar este bloque.
DO $faregas_runtime_sin_escritura_legacy$
DECLARE
    tabla_con_escritura text;
BEGIN
    SELECT table_name
    INTO tabla_con_escritura
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name NOT LIKE 'fg\_%' ESCAPE '\'
      AND (
          has_table_privilege('faregas_runtime', format('public.%I', table_name), 'INSERT')
          OR has_table_privilege('faregas_runtime', format('public.%I', table_name), 'UPDATE')
          OR has_table_privilege('faregas_runtime', format('public.%I', table_name), 'DELETE')
          OR has_table_privilege('faregas_runtime', format('public.%I', table_name), 'TRUNCATE')
      )
    ORDER BY table_name
    LIMIT 1;

    IF tabla_con_escritura IS NOT NULL THEN
        RAISE EXCEPTION
            'faregas_runtime conserva permisos de escritura sobre la tabla heredada public.%',
            tabla_con_escritura;
    END IF;
END;
$faregas_runtime_sin_escritura_legacy$;

-- Verificación posterior. Todo debe devolver false para permisos de escritura
-- heredados; inspeccionar y resolver cualquier true antes de conectar la app.
SELECT table_name,
       has_table_privilege('faregas_runtime', format('public.%I', table_name), 'INSERT') AS puede_insertar,
       has_table_privilege('faregas_runtime', format('public.%I', table_name), 'UPDATE') AS puede_actualizar,
       has_table_privilege('faregas_runtime', format('public.%I', table_name), 'DELETE') AS puede_eliminar,
       has_table_privilege('faregas_runtime', format('public.%I', table_name), 'TRUNCATE') AS puede_truncar
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
  AND table_name NOT LIKE 'fg\_%' ESCAPE '\'
ORDER BY table_name;

-- Este grupo no debe ser dueño de objetos ni miembro de roles adicionales con
-- permisos de escritura heredados. Revisar también permisos concedidos a PUBLIC.
SELECT r.rolname, r.rolsuper, r.rolcreatedb, r.rolcreaterole,
       pg_get_userbyid(m.roleid) AS miembro_de
FROM pg_roles r
LEFT JOIN pg_auth_members m ON m.member = r.oid
WHERE r.rolname IN ('faregas_runtime', 'faregas_app', 'faregas_migration', 'faregas_migrator');

-- Dejar las contraseñas fuera del historial de shell: \password las solicita
-- de forma interactiva. Tras aprobar el diseño, configurar faregasBackend/.env
-- con el login runtime. No otorgar membresía migradora al runtime.
