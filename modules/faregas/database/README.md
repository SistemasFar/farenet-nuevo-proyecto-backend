# Instalación de la base de datos FAREGAS

El archivo [faregas_consolidado.sql](faregas_consolidado.sql) crea el esquema
FAREGAS para una base nueva e independiente. La instalación contiene **74 tablas
de FAREGAS** y **13 contratos mínimos para catálogos compartidos**. Los contratos
se crean vacíos cuando faltan. Los catálogos existentes conservan su estructura
y sus filas.

## Variante para una base compartida

Si la base nueva para FAREGAS ya contiene objetos de FARENET, use la variante
generada a partir de la revisión auditada del consolidado. La variante comprueba
el nombre exacto de la base, falla si ya existen objetos FAREGAS en `public` y
valida las columnas de los 13 catálogos existentes con consultas sin filas.
La huella del consolidado obliga a repetir la auditoría cuando se actualiza.

```bash
node generar-instalador-compartido.cjs BASE_AUTORIZADA instalador-compartido.sql
```

Antes de autorizar la instalación, el DBA debe confirmar el endpoint, disponer
de `btree_gist` en `public` o `pg_catalog` y revisar los permisos del rol de
instalación. Este necesita crear objetos propios en `public`, leer los catálogos
y tener `REFERENCES` en las columnas compartidas que apuntan las 12 FKs.
La variante conserva esas FKs, que toman bloqueos al crearse y pueden condicionar
bajas de filas de catálogo referenciadas. Conviene validar el impacto y acordar
una ventana antes de tocar la base definitiva.

La instalación separa el DDL de FAREGAS de los catálogos compartidos. El
aislamiento de la aplicación requiere además revisar el arranque del backend
combinado. Su cron de FARENET ejecuta un `UPDATE inspeccion`. Asimismo, las
rutas de MFA y credenciales emiten DDL sobre tablas propias durante la
ejecución. Un rol de aplicación con permisos DML sobre FAREGAS y lectura sobre
FARENET no satisface esos dos comportamientos por sí solo. Definir el modelo
de ejecución y validar sus permisos antes del pase. Mantener las rutas
compartidas de autenticación y maestros cubiertas por la prueba de integración.

## Requisitos y orden de instalación

1. Confirmar el endpoint, el nombre de la base nueva, el esquema `public`,
   la codificación UTF-8 y la versión de PostgreSQL. El objetivo del instalador
   es PostgreSQL 13 o superior. La fuente de comparación, `inspeccion`, usa
   13.23. La reconstrucción local se ejecutó en 12.20. Antes de instalar en AWS,
   repetir el ensayo en una instancia desechable con la versión exacta del destino.
2. Preparar un rol de instalación con permisos DDL sobre `public` y habilitar
   `btree_gist`, según los permisos del servicio administrado. Provisionar
   separadamente el rol de ejecución con acceso a los objetos que use el backend.
   Revisar la plantilla comentada de roles antes de aplicarla por separado.
3. Confirmar que el destino carece de objetos FAREGAS. Ejecutar el archivo completo
   con psql usando el endpoint y el rol aprobados de ese ambiente. En DataGrip,
   confirmar el destino y ejecutar el archivo completo con detención ante errores.
4. Validar esquema, catálogos compartidos y conectividad del backend antes de
   provisionar los datos maestros y arrancar los procesos de emisión.

```bash
psql -X -v ON_ERROR_STOP=1 -h HOST_APROBADO -U ROL_INSTALADOR -d BASE_NUEVA -f faregas_consolidado.sql
```

El SQL aplica una sola transacción. Protege nombres de bases conocidas y rechaza
la instalación si detecta relaciones o funciones `fg_*` en `public`. Una segunda
ejecución debe fallar antes de aplicar DDL. Si una instrucción falla, conservar
su línea y SQLSTATE, cerrar la transacción con `ROLLBACK` si la sesión sigue
abierta, verificar el destino y repetir el archivo tras resolver la causa.
Para bases ya instaladas, usar solo una migración incremental revisada.

## Datos maestros y habilitación

| Área | Instalación inicial | Configuración por ambiente |
|---|---|---|
| Acceso | Perfiles, permisos y asignaciones de la semilla versionada. Una cuenta técnica deshabilitada para atribución de la cortesía base. | Crear administradores identificables por el procedimiento autorizado, asignar sedes y revisar RBAC y MFA. |
| Certificados | Tipos, códigos de tipo y ancho existentes en el catálogo operativo. | Configurar empresa, sedes, formatos vigentes, datos legales, talleres, servicios, tarifas y rangos oficiales de numeración. La clasificación inicial/anual se configura también en servicio y modalidad. |
| Productos e inventario | Estructura vacía. | Revisar el [catálogo de 274 SKU](seeds/faregas_productos_20260819.json) e importar solo los aprobados para el destino. Vincular sedes, tarifas y tipos de inventario. Validar SPOT por SKU, unidad y afectación fiscal. |
| Pago | Catálogos compartidos vacíos si se crearon en esta ejecución. | Provisionar moneda `sol`, formas de pago, tarjetas, entidad y cuenta de FAREGAS verificadas y los demás códigos que use el backend. La falta de la cuenta autorizada impide cargar maestros de pago. |
| Facturación y correo | Tablas, series vacías y cola de contingencia vacía. | Configurar el emisor y las series oficiales por empresa y sede, validar su último número, gestionar secretos de NubeFact, custodia y correo por ambiente. |
| Operación | Sin certificados, facturas, pagos, ventas, inventario operativo ni datos de prueba. | Mantener los entornos de prueba y producción separados. Validar el cron y sus políticas en un entorno aislado. |

El importador `scripts/import_faregas_productos.js` valida el JSON y agrega
SKU inexistentes. No actualiza los existentes ni carga clasificación SPOT.
Ejecutarlo solo tras verificar explícitamente su conexión. Confirmar que el
importador se incluya en el paquete de operación si se va a usar en AWS.

## Catálogos que consume el backend compartido

Las FKs de FAREGAS apuntan a `moneda`, `formapago`, `cuentacorriente`,
`entidadfinanciera`, `tarjeta`, `tipocontado` y `persona`. Los contratos de
identidad y geografía se usan en Usuarios, y `seriedocumentobase` en la consulta
de series. Si ya existen, el instalador los deja intactos. Si están vacíos,
cargar únicamente los datos aprobados antes de operar.

El login unificado también lee `public.usuario`. Los maestros usados por el
asistente y la consulta de vehículo de FARENET requieren los catálogos legacy,
entre ellos `tipoplaca`, `conceptoinspeccion`, `categoria`, `tipoinspeccion`,
`tipocertificado`, `tipoautorizacion`, `tipodocumento`, `vehiculo`,
`tarjetapropiedad`, `vehiculoclase`, `marca`, `modelo`, `combustible`,
`color`, `carroceria`, `tipopoliza` y `aseguradora`. Estos contratos de la
aplicación compartida deben prepararse y validarse con el responsable de
FARENET antes de habilitar esas rutas. El instalador no crea una tabla de
usuarios legacy ni copia cuentas, hashes o datos de vehículos de FARENET.

## Secciones incorporadas y diferencias con inspeccion

El SQL aplica las secciones 000 a 004, 006 a 008 y 010 a 012. El resultado de
la 005 ya está en la 000. Su bloque incremental queda comentado para evitar
recrear FKs durante una instalación nueva. La 011 ya incorpora la cola
de contingencia y sus estados de regularización y correo. La 012 incorpora
`fg_usuario_credencial` y `fg_credencial_custodia`. La 009 queda comentada porque
actualiza productos por IDs de otro catálogo. El apéndice conserva propuestas
y SQL alternativos como referencias. Aplicar migraciones publicadas después
de esta versión según su orden y destino, sin repetir las ya incorporadas.

Se conservan la reserva de códigos de chip del repositorio y los cambios de
integridad de la sección 005 para perfiles y auditoría. La fuente comparada
carece de la reserva de chip y conserva las FKs anteriores de perfiles y auditoría.
Los dos respaldos históricos de tablas de `inspeccion` quedaron fuera del esquema.

## Verificación

```sql
SELECT current_database(), current_setting('server_version');

SELECT count(*) AS tablas_faregas
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p') AND left(c.relname, 3) = 'fg_';

SELECT to_regclass('public.fg_facturacion_contingencia') AS contingencia,
       to_regclass('public.fg_usuario_mfa') AS mfa,
       to_regclass('public.fg_usuario_credencial') AS credenciales,
       to_regclass('public.fg_credencial_custodia') AS custodia;
```

En una base nueva se esperan 74 tablas FAREGAS y los cuatro objetos de la
consulta final. Verificar índices válidos, FKs validadas, triggers de
inmutabilidad y tablas operativas vacías. Probar login, usuarios, maestros,
series y lectura de certificados con el backend configurado para una instancia
aislada. Validar emisión y correo con simuladores antes de habilitar cualquier
proveedor de producción.
