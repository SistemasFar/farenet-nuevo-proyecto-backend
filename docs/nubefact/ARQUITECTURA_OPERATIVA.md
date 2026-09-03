# Arquitectura operativa Nubefact — Faregas

## Objetivo

Integrar Nubefact sin alterar el flujo de certificados Faregas ni los correlativos de certificados. La emisión tributaria permanece cerrada por defecto y se habilita únicamente después de completar catálogo, series, credenciales, decisión de detracción y pruebas controladas.

## Límites

- `fg_correlativo_certificado` y los rangos DG no forman parte de esta integración.
- Las series tributarias pertenecen a `fg_serie_comprobante` y se aíslan por `proveedor_emision` y `entorno_emision`.
- El motor V2 sólo acepta series `NUBEFACT`; una fila `LEGACY` nunca es elegible.
- Los tokens existen únicamente en variables de entorno del backend.
- Ningún dato fiscal se infiere o inventa.
- Un error del proveedor no elimina ni modifica el certificado guardado.

## Flujo

1. El operador guarda cliente y pago.
2. Faregas construye el resumen tributario.
3. El preflight devuelve controles `OK`, `ADVERTENCIA` o `BLOQUEO`.
4. Una transacción bloquea la factura y reserva el siguiente número tributario.
5. Faregas persiste `codigo_unico`, payload e intento antes de llamar al proveedor.
6. Nubefact recibe el mismo comprobante en todos los reintentos.
7. Ante timeout, Faregas consulta por tipo, serie y número antes de repetir.
8. Faregas guarda respuesta, enlaces y estado SUNAT.

## Seguros obligatorios

Para producción deben estar simultáneamente habilitados:

- `NUBEFACT_ENABLED=true`
- `NUBEFACT_ENVIRONMENT=PRODUCCION`
- `NUBEFACT_PRODUCTION_CONFIRMED=true`
- `NUBEFACT_ENVIAR_SUNAT=true`
- `NUBEFACT_CORRELATIVOS_V2_ENABLED=true`
- `NUBEFACT_DETRACCION_DECISION=NO_APLICA`, o implementación SPOT validada.

Mientras cualquiera permanezca cerrado, la emisión productiva debe fallar de forma segura.

Las credenciales también están separadas por ambiente: `NUBEFACT_<CLAVE>_DEMO_*` y
`NUBEFACT_<CLAVE>_PRODUCCION_*`. El backend nunca devuelve ruta ni token al frontend.
