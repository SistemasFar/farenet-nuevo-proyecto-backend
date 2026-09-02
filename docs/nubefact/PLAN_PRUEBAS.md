# Plan de pruebas Nubefact

## Automatizadas

- Reserva correlativa y formato del número.
- Exclusión mutua y detección de concurrencia.
- Serie productiva no confirmada.
- Límite y bloqueo temporal de reintentos.
- Preflight con controles separados.
- Importación fiscal en vista previa.
- Archivo duplicado o inválido.
- Guardas de producción y detracción.
- Payload de boleta, factura, crédito y descuento.
- Timeout, consulta y recuperación.

## Integración DEMO

- Boleta contado con DNI.
- Factura contado con RUC.
- Factura crédito con una y varias cuotas.
- Descuento permitido.
- Correo vacío y correo válido.
- Rechazo controlado.
- Timeout simulado.
- Nota de crédito total y parcial.
- Anulación y consulta de ticket.

## Piloto productivo

Ejecutar solamente con aprobación: una boleta y una factura de importe y cliente controlados. Verificar estado tributario, correlativo, PDF, XML, CDR y conciliación en Nubefact/SUNAT.
