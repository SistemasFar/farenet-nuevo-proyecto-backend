const fs = require('fs');
const path = require('path');
const p = path.join('C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetBackend\\modules\\faregas\\services\\faregas-ventas.service.js');
let c = fs.readFileSync(p, 'utf8');

const newMethod = `
const listarVentas = async (plantaKey) => {
    const client = await db.getClient();
    try {
        const query = \`
            SELECT v.id, v.creado_en, v.cliente_nombre, v.cliente_nro_documento,
                   v.importe_total, v.estado as venta_estado,
                   f.id as facturacion_id, f.nro_comprobante, f.estado as facturacion_estado,
                   f.enlace_pdf, f.enlace_xml,
                   (
                       SELECT json_agg(json_build_object('numero_chip', c.numero_chip, 'producto', pi.nombre))
                       FROM fg_venta_detalle vd
                       JOIN fg_chip c ON vd.chip_id = c.id
                       JOIN fg_producto_inventariable pi ON vd.producto_inventariable_id = pi.id
                       WHERE vd.venta_id = v.id
                   ) as chips
            FROM fg_venta v
            LEFT JOIN fg_facturacion f ON f.venta_id = v.id
            WHERE v.planta_key = $1
            ORDER BY v.id DESC
            LIMIT 100
        \`;
        const { rows } = await client.query(query, [plantaKey]);
        return rows;
    } finally {
        client.release();
    }
};
`;

c = c.replace('module.exports = {', newMethod + '\nmodule.exports = {\n    listarVentas,');
fs.writeFileSync(p, c);
console.log('Added listarVentas');
