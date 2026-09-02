# Plan de corte DMS Fact → Nubefact

1. Definir empresa, sede y series del piloto.
2. Exportar productos, series, comprobantes pendientes, notas y anulaciones.
3. Completar pruebas DEMO en Faregas.
4. Definir fecha y hora de congelamiento.
5. Impedir nuevas emisiones DMS Fact para las series migradas.
6. Obtener el último número real de cada serie.
7. Registrar el último número y el sistema origen en Faregas.
8. Validar que el siguiente número no exista en DMS Fact ni SUNAT.
9. Confirmar las series para producción.
10. Activar flags en una ventana controlada.
11. Emitir una boleta y una factura de piloto.
12. Verificar SUNAT, PDF, XML y CDR.
13. Conciliar números y autorizar continuidad.

## Retroceso

Si el piloto falla, cerrar emisión Faregas desactivando `NUBEFACT_ENABLED`. No volver a DMS Fact con la misma serie hasta conciliar cualquier solicitud incierta enviada durante el piloto.
