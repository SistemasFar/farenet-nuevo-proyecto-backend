# Checklist de producción Nubefact

## Datos y responsables

- [ ] RUC, razón social y dirección verificados por cada empresa.
- [ ] Ruta y token productivos entregados mediante canal seguro.
- [ ] Cuenta Nubefact activa y conectada con SUNAT.
- [ ] Decisión de detracción documentada.
- [ ] Responsable de Sistemas y responsable administrativo identificados.

## Catálogo

- [ ] Todas las tarifas que saldrán a producción tienen producto fiscal.
- [ ] Productos activos y habilitados para venta.
- [ ] Unidad `ZZ` en servicios de certificación.
- [ ] Afectación `10 - Gravado, operación onerosa` confirmada.
- [ ] Código SUNAT vacío o de ocho dígitos; nunca incompleto.
- [ ] Precios y tratamiento del IGV confirmados.

## Series

- [ ] Serie por RUC, sede y tipo de documento.
- [ ] Último número de DMS Fact confirmado justo antes del corte.
- [ ] Próximo número revisado por dos personas.
- [ ] Fecha y hora de corte registrada.
- [ ] DMS Fact congelado para las series migradas.
- [ ] Migración `20260902_faregas_nubefact_preparacion.sql` revisada y aplicada.
- [ ] Series marcadas como confirmadas sólo después de la conciliación.

## Pruebas

- [ ] Boleta DEMO aceptada.
- [ ] Factura DEMO aceptada.
- [ ] Crédito y cuotas probados.
- [ ] Descuento probado.
- [ ] Timeout y recuperación probados.
- [ ] Nota de crédito y anulación probadas.
- [ ] PDF, XML y CDR verificados.

## Activación

- [ ] Backup verificado.
- [ ] Ventana de cambio comunicada.
- [ ] Monitoreo abierto.
- [ ] Primera boleta productiva controlada.
- [ ] Primera factura productiva controlada.
- [ ] Validación tributaria y conciliación completadas.
