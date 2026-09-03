# Plan de corte DMS Fact → Nubefact

1. Definir empresa, sede y series **nuevas/exclusivas de Nubefact** para el piloto.
2. Exportar productos, comprobantes pendientes, notas y anulaciones para conciliación; las series DMS quedan como `LEGACY`.
3. Completar pruebas DEMO en Faregas.
4. Definir fecha y hora de congelamiento.
5. Confirmar que ninguna serie elegida para Nubefact se use en DMS Fact, FARENET u otro emisor.
6. Obtener el último número real de la serie Nubefact; si es nueva, documentar que inicia en cero.
7. Registrar ambiente, último número y evidencia de aprobación en Faregas.
8. Validar que el siguiente número no exista en Nubefact ni SUNAT.
9. Confirmar las series para producción.
10. Activar flags en una ventana controlada.
11. Emitir una boleta y una factura de piloto.
12. Verificar SUNAT, PDF, XML y CDR.
13. Conciliar números y autorizar continuidad.

## Retroceso

Si el piloto falla, cerrar emisión Faregas desactivando `NUBEFACT_ENABLED`. No reutilizar la serie Nubefact en DMS Fact ni en otro facturador. Antes de reintentar, conciliar cualquier solicitud incierta por tipo, serie y número.
