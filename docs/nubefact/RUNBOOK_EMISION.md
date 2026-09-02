# Runbook de emisión y recuperación

## Comprobante pendiente reciente

No volver a emitir durante el bloqueo configurado por `NUBEFACT_RETRY_LOCK_MS`. Esperar y consultar el comprobante por tipo, serie y número.

## Timeout o error de conexión

1. No cambiar serie, número, cliente, importes ni `codigo_unico`.
2. Consultar primero el comprobante en Nubefact.
3. Si existe y fue aceptado, registrar la respuesta recuperada.
4. Si fue rechazado, conservar el rechazo y corregir mediante el procedimiento autorizado.
5. Si no existe, permitir reintento controlado con el mismo número.

## Máximo de intentos

Al alcanzar `NUBEFACT_MAX_ATTEMPTS`, detener reintentos automáticos. Sistemas debe revisar intentos, respuesta y consulta al proveedor antes de autorizar otra acción.

## Rechazo SUNAT

No marcar el certificado como facturado. Conservar payload, respuesta, código y descripción. No generar un nuevo número para ocultar el rechazo.

## Duplicado

Tratarlo como respuesta incierta: consultar el comprobante. Nunca reservar otro correlativo antes de determinar el estado del número original.

## Evidencias

Después de una aceptación deben existir estado aceptado, fecha, hash/QR cuando corresponda y enlaces PDF, XML y CDR.
