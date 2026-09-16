const fs = require('fs');
const p = 'modules/faregas/services/faregas-tarifas.service.js';
let t = fs.readFileSync(p, 'utf8');

const tOld1 = `
        categorias.get(row.categoria_codigo).servicios.push({
            id: Number(row.servicio_id),
            codigo: row.servicio_codigo,
            nombre: row.servicio_nombre,
            orden: Number(row.servicio_orden),
            tipo_flujo: row.tipo_flujo,
            requiere_certificado: Boolean(row.requiere_certificado),
            requiere_vehiculo: Boolean(row.requiere_vehiculo),
            tipo_certificado_clave: row.tipo_certificado_clave,
            modalidad: row.modalidad,
            tarifa: {
                id: Number(row.tarifa_id),
                codigo: row.tarifa_codigo,
                precio: Number(row.precio)
            }
        });
`;

const tNew1 = `
        const requiereChip = Boolean(row.requiere_chip);
        let chip = null;
        if (requiereChip) {
            chip = {
                productoInventariableId: row.producto_chip_id ? Number(row.producto_chip_id) : null,
                codigo: row.chip_codigo,
                nombre: row.chip_nombre,
                productoFacturacionId: row.chip_producto_facturacion_id ? Number(row.chip_producto_facturacion_id) : null,
                productoFiscalNombre: row.chip_fiscal_nombre,
                precio: row.chip_precio ? Number(row.chip_precio) : 0,
                fiscalActivo: Boolean(row.chip_fiscal_activo),
                fiscalVenta: Boolean(row.chip_fiscal_venta)
            };
        }

        const tarifa = {
            id: Number(row.tarifa_id),
            codigo: row.tarifa_codigo,
            precio: Number(row.precio),
            productoFacturacionId: row.tarifa_producto_facturacion_id ? Number(row.tarifa_producto_facturacion_id) : null
        };

        categorias.get(row.categoria_codigo).servicios.push({
            id: Number(row.servicio_id),
            codigo: row.servicio_codigo,
            nombre: row.servicio_nombre,
            orden: Number(row.servicio_orden),
            tipo_flujo: row.tipo_flujo,
            requiere_certificado: Boolean(row.requiere_certificado),
            requiere_vehiculo: Boolean(row.requiere_vehiculo),
            tipo_certificado_clave: row.tipo_certificado_clave,
            modalidad: row.modalidad,
            requiereChip,
            chip,
            total: tarifa.precio + (chip ? chip.precio : 0),
            tarifa
        });
`;
t = t.replace(tOld1.trim(), tNew1.trim());

const tOld2 = `            s.modalidad,
            t.id AS tarifa_id,
            t.codigo AS tarifa_codigo,
            t.precio
        FROM fg_tarifa t
        JOIN fg_servicio s ON s.id = t.servicio_id
        JOIN fg_categoria_servicio c ON c.id = s.categoria_id
        JOIN fg_planta p ON p.key = t.planta_key`;

const tNew2 = `            s.modalidad,
            t.id AS tarifa_id,
            t.codigo AS tarifa_codigo,
            t.precio,
            t.producto_facturacion_id AS tarifa_producto_facturacion_id,
            pf.requiere_chip,
            pf.producto_chip_id,
            pinv.codigo AS chip_codigo,
            pinv.nombre AS chip_nombre,
            pinv.producto_facturacion_id AS chip_producto_facturacion_id,
            pf_chip.descripcion AS chip_fiscal_nombre,
            pf_chip.precio_unitario AS chip_precio,
            pf_chip.activo AS chip_fiscal_activo,
            pf_chip.es_para_venta AS chip_fiscal_venta
        FROM fg_tarifa t
        JOIN fg_servicio s ON s.id = t.servicio_id
        JOIN fg_categoria_servicio c ON c.id = s.categoria_id
        JOIN fg_planta p ON p.key = t.planta_key
        LEFT JOIN fg_producto_facturacion pf ON pf.id = t.producto_facturacion_id
        LEFT JOIN fg_producto_inventariable pinv ON pinv.id = pf.producto_chip_id
        LEFT JOIN fg_producto_facturacion pf_chip ON pf_chip.id = pinv.producto_facturacion_id`;
t = t.replace(tOld2, tNew2);

const tOld3 = `            c.nombre AS categoria_nombre,
            pf.codigo_sku AS producto_sku,
            pf.descripcion AS producto_descripcion,
            pf.unidad AS producto_unidad,
            pf.tipo_afectacion_igv AS producto_afectacion_igv,
            pf.codigo_clasificacion_sunat AS producto_codigo_sunat
        FROM fg_tarifa t
        JOIN fg_servicio s ON s.id = t.servicio_id
        JOIN fg_planta p ON p.key = t.planta_key
        JOIN fg_categoria_servicio c ON c.id = s.categoria_id
        LEFT JOIN fg_producto_facturacion pf ON pf.id = t.producto_facturacion_id`;

const tNew3 = `            c.nombre AS categoria_nombre,
            pf.codigo_sku AS producto_sku,
            pf.descripcion AS producto_descripcion,
            pf.unidad AS producto_unidad,
            pf.tipo_afectacion_igv AS producto_afectacion_igv,
            pf.codigo_clasificacion_sunat AS producto_codigo_sunat,
            pf.requiere_chip,
            pf.producto_chip_id,
            pinv.codigo AS chip_codigo,
            pinv.nombre AS chip_nombre,
            pinv.producto_facturacion_id AS chip_producto_facturacion_id,
            pf_chip.descripcion AS chip_fiscal_nombre,
            pf_chip.precio_unitario AS chip_precio,
            pf_chip.activo AS chip_fiscal_activo,
            pf_chip.es_para_venta AS chip_fiscal_venta
        FROM fg_tarifa t
        JOIN fg_servicio s ON s.id = t.servicio_id
        JOIN fg_planta p ON p.key = t.planta_key
        JOIN fg_categoria_servicio c ON c.id = s.categoria_id
        LEFT JOIN fg_producto_facturacion pf ON pf.id = t.producto_facturacion_id
        LEFT JOIN fg_producto_inventariable pinv ON pinv.id = pf.producto_chip_id
        LEFT JOIN fg_producto_facturacion pf_chip ON pf_chip.id = pinv.producto_facturacion_id`;
t = t.replace(tOld3, tNew3);

fs.writeFileSync(p, t);
