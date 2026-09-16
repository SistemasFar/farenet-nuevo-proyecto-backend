const fs = require('fs');
const p = 'modules/faregas/services/faregas-certificados.service.js';
let t = fs.readFileSync(p, 'utf8');

const tOld1 = `            INSERT INTO fg_certificado (
                tipo_certificado_clave, tarifa_codigo, cliente_id, planta_key,
                numero_certificado, fecha_emision, estado, paso_actual,
                observaciones, usuario_creacion, usuario_modificacion
            ) VALUES (
                $1, $2, $3, $4, NULL, NULL, 'BORRADOR', 'DATOS_INICIALES', $5, $6, $6
            ) RETURNING id, estado, paso_actual AS "pasoActual"
        \`, [tipoCertificadoClave, tarifaCodigo, clienteId || null, planta_key, observaciones || null, username]);`;

const tNew1 = `
        const productoFacturacionCertificadoId = tarifa.producto_facturacion_id || null;
        const precioCertificado = tarifa.precio;
        const requiereChip = tarifa.requiere_chip === true;
        const productoChipId = requiereChip ? (tarifa.producto_chip_id || null) : null;
        const productoFacturacionChipId = requiereChip ? (tarifa.chip_producto_facturacion_id || null) : null;
        const precioChip = requiereChip ? (tarifa.chip_precio ? Number(tarifa.chip_precio) : 0) : null;
        const importeTotal = precioCertificado + (precioChip || 0);

        const res = await client.query(\`
            INSERT INTO fg_certificado (
                tipo_certificado_clave, tarifa_codigo, cliente_id, planta_key,
                numero_certificado, fecha_emision, estado, paso_actual,
                observaciones, usuario_creacion, usuario_modificacion,
                producto_facturacion_certificado_id, precio_certificado,
                producto_chip_id, producto_facturacion_chip_id, precio_chip, importe_total
            ) VALUES (
                $1, $2, $3, $4, NULL, NULL, 'BORRADOR', 'DATOS_INICIALES', $5, $6, $6,
                $7, $8, $9, $10, $11, $12
            ) RETURNING id, estado, paso_actual AS "pasoActual"
        \`, [
            tipoCertificadoClave, tarifaCodigo, clienteId || null, planta_key, 
            observaciones || null, username,
            productoFacturacionCertificadoId, precioCertificado,
            productoChipId, productoFacturacionChipId, precioChip, importeTotal
        ]);`;
t = t.replace(tOld1.trim(), tNew1.trim());

const tOld2 = `        if (data.tarifaCodigo !== undefined) {
            if (data.tarifaCodigo !== cert.tarifa_codigo) {
                if (cert.numero_certificado) throw new Error('CORRELATIVO_YA_RESERVADO');
                const evidencia = await client.query(\`
                    SELECT 1 FROM fg_orden_pago WHERE certificado_id = $1 AND estado = 'PAGADO'
                    UNION ALL
                    SELECT 1 FROM fg_facturacion WHERE certificado_id = $1 AND estado IN ('PENDIENTE', 'PENDIENTE_SUNAT', 'ACEPTADO', 'ERROR')
                    LIMIT 1
                \`, [id]);
                if (evidencia.rowCount > 0) throw new Error('TARIFA_NO_MODIFICABLE_PAGADO');

                const newTarifa = tarifasService.validarTarifaCertificacion(
                    await tarifasService.obtenerTarifaOperativaPorCodigo(cert.planta_key, data.tarifaCodigo)
                );
                if (newTarifa.tipo_certificado_clave !== cert.tipo_certificado_clave) {
                    throw new Error('CAMBIO_TARIFA_INCOMPATIBLE');
                }
                campos.push(\`tarifa_codigo = $\${idx++}\`);
                values.push(data.tarifaCodigo);
            }
        }`;

const tNew2 = `        if (data.tarifaCodigo !== undefined) {
            if (data.tarifaCodigo !== cert.tarifa_codigo) {
                if (cert.numero_certificado) throw new Error('CORRELATIVO_YA_RESERVADO');
                const evidencia = await client.query(\`
                    SELECT 1 FROM fg_orden_pago WHERE certificado_id = $1 AND estado = 'PAGADO'
                    UNION ALL
                    SELECT 1 FROM fg_facturacion WHERE certificado_id = $1 AND estado IN ('PENDIENTE', 'PENDIENTE_SUNAT', 'ACEPTADO', 'ERROR')
                    LIMIT 1
                \`, [id]);
                if (evidencia.rowCount > 0) throw new Error('TARIFA_NO_MODIFICABLE_PAGADO');

                const newTarifa = tarifasService.validarTarifaCertificacion(
                    await tarifasService.obtenerTarifaOperativaPorCodigo(cert.planta_key, data.tarifaCodigo)
                );
                if (newTarifa.tipo_certificado_clave !== cert.tipo_certificado_clave) {
                    throw new Error('CAMBIO_TARIFA_INCOMPATIBLE');
                }
                campos.push(\`tarifa_codigo = $\${idx++}\`);
                values.push(data.tarifaCodigo);
                
                const productoFacturacionCertificadoId = newTarifa.producto_facturacion_id || null;
                const precioCertificado = newTarifa.precio;
                const requiereChip = newTarifa.requiere_chip === true;
                const productoChipId = requiereChip ? (newTarifa.producto_chip_id || null) : null;
                const productoFacturacionChipId = requiereChip ? (newTarifa.chip_producto_facturacion_id || null) : null;
                const precioChip = requiereChip ? (newTarifa.chip_precio ? Number(newTarifa.chip_precio) : 0) : null;
                const importeTotal = precioCertificado + (precioChip || 0);

                campos.push(\`producto_facturacion_certificado_id = $\${idx++}\`); values.push(productoFacturacionCertificadoId);
                campos.push(\`precio_certificado = $\${idx++}\`); values.push(precioCertificado);
                campos.push(\`producto_chip_id = $\${idx++}\`); values.push(productoChipId);
                campos.push(\`producto_facturacion_chip_id = $\${idx++}\`); values.push(productoFacturacionChipId);
                campos.push(\`precio_chip = $\${idx++}\`); values.push(precioChip);
                campos.push(\`importe_total = $\${idx++}\`); values.push(importeTotal);
            }
        }`;
t = t.replace(tOld2.trim(), tNew2.trim());

fs.writeFileSync(p, t);
