# FUSIÓN DOCUMENTOS EMITIDOS — EXTENDIDO (sin pérdida)

Archivo único: `faregas_documentos_emitidos_extendido_{desde}_{hasta}.xlsx`
Hojas: extendido (Datos/Líneas/Trazabilidad por emisor) + `Consolidado_*`.

## Cobertura financiero consolidado → unificado
| Columna consolidado | Hoja unificada |
|---|---|
| Fecha emisión/op, Hora email certificado, Sede, Placa, Cliente, Doc limpia, Tipo op, Servicio, Descripción, Tipo cert, Código cert, Chip, Producto adicional, Cantidad, Precio unit, Subtotal, Bruto, Cortesía/Desc, Descuento, Neto, Tipo/Código comprobante, Tipo/forma pago, Pagado, Saldo, Estado cert/comprobante, TOTALES | Hoja Consolidado_* íntegra (28 cols) |

## Cobertura extendido → unificado
| Grupo | Estado |
|---|---|
| 56 columnas fiscales/comerciales | Intactas en Datos* |
| HORA DE EMISIÓN DEL CERTIFICADO / FECHA CERTIFICADO | NUEVAS (tras FECHA DE EMISIÓN) |
| Líneas productos/pagos divididos | Hoja Líneas_* íntegra |
| Trazabilidad, anulaciones, NC/ND, detracción, vehículo | Intactas |

## Reglas
- No se duplican importes: cada hoja mantiene sus totales.
- NC/anulaciones se identifican en columnas propias, no como ventas vigentes.
- Horas: HH:mm:ss America/Lima; DATE histórico → SIN REGISTRO.
