# Base de datos FAREGAS

El SQL de instalación está en [faregas_consolidado.sql](faregas_consolidado.sql).
Úselo en una base PostgreSQL nueva e independiente con codificación UTF-8.
Ejecute el script completo desde DataGrip o con psql.

```bash
psql -X -v ON_ERROR_STOP=1 -d faregas_db -f faregas_consolidado.sql
```

La instalación crea el esquema y los catálogos iniciales en una transacción.
El archivo conserva el nombre original de cada bloque como encabezado SQL.
El apéndice contiene la clasificación SPOT por IDs, la plantilla de roles,
las propuestas pendientes y el instalador alternativo para revisión.

Para actualizar una base existente, revise su esquema y extraiga únicamente
la sección que corresponda. La [guía técnica](migrations/README.md) describe
las dependencias y las verificaciones de cada cambio.

El importador de productos y su catálogo JSON se usan por separado.
