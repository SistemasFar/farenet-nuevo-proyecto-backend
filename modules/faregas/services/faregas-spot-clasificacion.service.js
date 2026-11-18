// La naturaleza fiscal es independiente de tipo_producto y de la etiqueta comercial.
const resolverClasificacion = (producto = {}, servicio = {}) => {
    const usaProducto = producto.sujeto_detraccion != null;
    const fuente = usaProducto ? producto : servicio;
    return {
        sujeto_detraccion: fuente.sujeto_detraccion ?? null,
        detraccion_codigo: fuente.detraccion_codigo || null,
        detraccion_porcentaje: fuente.detraccion_porcentaje ?? null,
        naturaleza_spot: usaProducto ? producto.naturaleza_spot || null : servicio.sujeto_detraccion != null ? 'SERVICIO' : null
    };
};
const clasificarLinea = row => {
    const producto = row.productoSpot || row;
    const naturaleza = producto.naturaleza_spot;
    return { ...row, tipo_item: naturaleza === 'SERVICIO' ? 'SERVICIO'
        : naturaleza === 'BIEN' ? 'PRODUCTO' : String(row.tipo_item || row.tipoItem || '').toUpperCase() };
};
module.exports = { resolverClasificacion, clasificarLinea };
