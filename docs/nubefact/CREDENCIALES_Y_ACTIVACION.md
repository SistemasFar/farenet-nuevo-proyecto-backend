# Credenciales y activación Nubefact

## Dónde pegar ruta y token

Editar únicamente `farenetBackend/.env`. Para la empresa emisora CAMBRIDGE ya
existe un bloque señalizado. Pegar los valores después de `=` según el ambiente:

```dotenv
# Cuenta de pruebas
NUBEFACT_CAMBRIDGE_DEMO_API_URL=PEGAR_AQUI_LA_RUTA_HTTPS_DEMO
NUBEFACT_CAMBRIDGE_DEMO_TOKEN=PEGAR_AQUI_EL_TOKEN_DEMO
NUBEFACT_CAMBRIDGE_DEMO_RUC=PEGAR_AQUI_EL_RUC_DUEÑO_DEL_TOKEN

# Cuenta real; mantener vacía hasta el pase autorizado
NUBEFACT_CAMBRIDGE_PRODUCCION_API_URL=PEGAR_AQUI_LA_RUTA_HTTPS_PRODUCTIVA
NUBEFACT_CAMBRIDGE_PRODUCCION_TOKEN=PEGAR_AQUI_EL_TOKEN_PRODUCTIVO
NUBEFACT_CAMBRIDGE_PRODUCCION_RUC=PEGAR_AQUI_EL_RUC_DUEÑO_DEL_TOKEN
```

No agregar comillas, `Bearer`, `Token ` ni espacios. Para CAMBRIDGE el RUC
esperado por la configuración actual es `20600444531`; si la cuenta Nubefact
pertenece a otro RUC, no debe asociarse a esta clave. Reiniciar el backend después
de editar. El token nunca debe pegarse en frontend, documentación, chat o Git.

## Estado seguro actual

Estos interruptores deben permanecer así mientras se completa la preparación:

```dotenv
NUBEFACT_ENABLED=false
NUBEFACT_ENVIRONMENT=DEMO
NUBEFACT_PRODUCTION_CONFIRMED=false
NUBEFACT_ENVIAR_SUNAT=false
NUBEFACT_ENVIAR_CLIENTE=false
NUBEFACT_CORRELATIVOS_V2_ENABLED=false
```

Pegar credenciales no envía nada. La pantalla Configuración → Facturación →
Preparación permite comprobar si fueron detectadas sin revelar sus valores.

## Orden de habilitación

1. Revisar y autorizar la migración `20260902_faregas_nubefact_preparacion.sql`.
2. Aplicarla con backup y ventana de cambio; nunca desde el arranque automático.
3. Crear series exclusivas `NUBEFACT / DEMO` y probar boleta, factura y notas.
4. Completar y vincular el catálogo fiscal.
5. Resolver formalmente detracción.
6. Validar PDF, XML, CDR, rechazos, timeout, reintentos y anulaciones en DEMO.
7. Cargar credenciales y series exclusivas de PRODUCCIÓN.
8. Ejecutar el checklist con doble revisión.
9. Cambiar los interruptores productivos sólo en la ventana autorizada.

Nunca se reutilizan las series que aparecen como `LEGACY / FARENET`.
