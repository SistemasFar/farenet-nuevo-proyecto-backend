const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const db = require('../../../config/database');
const descuentos = require('../services/faregas-descuentos.service');
const helpers = descuentos._private;

test('administración usa precio_referencia y nunca fg_tarifa.precio', () => {
    const precio = helpers.resolverPrecioServicio({
        producto_facturacion_id: 10,
        producto_precio_referencia: 80,
        producto_precio_unitario: 67.80,
        precio: 67.80
    });
    assert.equal(precio, 80);
});

test('precio_unitario es sólo el fallback histórico', () => {
    assert.equal(helpers.resolverPrecioServicio({
        producto_facturacion_id: 10,
        producto_precio_referencia: null,
        producto_precio_unitario: 67.80
    }), 67.80);
});

test('MONTO 20 sobre P. venta 80 produce importe final 60', () => {
    assert.equal(helpers.calcularImporteFinal(80, 'MONTO', 20), 60);
});

test('PORCENTAJE 100 continúa produciendo importe final cero', () => {
    assert.equal(helpers.calcularImporteFinal(80, 'PORCENTAJE', 100), 0);
});

test('vigencia heredada conserva NULL/NULL', () => {
    assert.deepEqual(helpers.validarVigenciaCodigos({}, {
        fecha_inicio: '2026-10-12T00:00:00', fecha_fin: '2026-11-12T23:59:59.999'
    }), { fechaInicio: null, fechaFin: null });
});

test('vigencia personalizada dentro de campaña conserva las dos fechas', () => {
    assert.deepEqual(helpers.validarVigenciaCodigos({ fechaInicio: '2026-10-13', fechaFin: '2026-11-11' }, {
        fecha_inicio: '2026-10-12T00:00:00', fecha_fin: '2026-11-12T23:59:59.999'
    }), { fechaInicio: '2026-10-13T00:00:00', fechaFin: '2026-11-11T23:59:59.999' });
});

test('una sola fecha personalizada se rechaza', () => {
    assert.throws(() => helpers.validarVigenciaCodigos({ fechaInicio: '2026-10-13' }, {
        fecha_inicio: '2026-10-12T00:00:00', fecha_fin: '2026-11-12T23:59:59.999'
    }), { message: 'VIGENCIA_CODIGO_INVALIDA' });
});

test('genera lote determinista de 100 códigos', () => {
    const items = helpers.generarItemsLote({ prefijo: 'empresa', cantidad: 100, maxUsos: 1 });
    assert.equal(items.length, 100);
    assert.equal(items[0].codigo, 'EMPRESA-000001');
    assert.equal(items[99].codigo, 'EMPRESA-000100');
});

test('importación detecta duplicados de archivo y filas inválidas', () => {
    const resultado = helpers.prepararItemsCodigos([
        { codigo: 'UNO', maxUsos: 1 },
        { codigo: 'UNO', maxUsos: 1 },
        { codigo: '', maxUsos: 1 },
        { codigo: 'DOS', maxUsos: 0 }
    ]);
    assert.equal(resultado.validos.length, 1);
    assert.equal(resultado.duplicadosArchivo, 1);
    assert.ok(resultado.errores.some(error => error.motivo === 'CODIGO_VACIO'));
    assert.ok(resultado.errores.some(error => error.motivo === 'MAX_USOS_INVALIDO'));
});

test('batch detecta duplicados BD e inserta los restantes en una sola operación masiva', async () => {
    const consultas = [];
    const client = {
        query: async (sql, params) => {
            consultas.push({ sql, params });
            if (sql.includes('FROM fg_descuento WHERE id=$1 FOR UPDATE')) return { rowCount: 1, rows: [{ fecha_inicio: '2026-10-01', fecha_fin: '2026-12-01' }] };
            if (sql.includes('FROM fg_descuentodetalle')) return { rowCount: 1, rows: [{ '?column?': 1 }] };
            if (sql.includes('UPPER(BTRIM(codigo)) = ANY')) return { rowCount: 1, rows: [{ codigo: 'UNO' }] };
            return { rowCount: 1, rows: [] };
        }
    };
    const resultado = await helpers.procesarCodigosMasivos(client, 7, [
        { codigo: 'UNO', maxUsos: 1 }, { codigo: 'DOS', maxUsos: 1 }
    ], {}, { username: 'tester' });
    assert.equal(resultado.creados, 1);
    assert.equal(resultado.duplicados, 1);
    const insercion = consultas.find(item => item.sql.includes('FROM UNNEST'));
    assert.ok(insercion);
    assert.deepEqual(insercion.params[4], ['DOS']);
    assert.equal(insercion.params[1], null);
    assert.equal(insercion.params[2], null);
});

test('preview de importación consulta duplicados pero no inserta', async () => {
    const consultas = [];
    const client = {
        query: async (sql) => {
            consultas.push(sql);
            if (sql.includes('FROM fg_descuento WHERE id=$1 FOR UPDATE')) return { rowCount: 1, rows: [{ fecha_inicio: '2026-10-01', fecha_fin: '2026-12-01' }] };
            if (sql.includes('FROM fg_descuentodetalle')) return { rowCount: 1, rows: [{}] };
            if (sql.includes('UPPER(BTRIM(codigo)) = ANY')) return { rowCount: 0, rows: [] };
            return { rowCount: 0, rows: [] };
        }
    };
    const resultado = await helpers.procesarCodigosMasivos(client, 7, [{ codigo: 'NUEVO', maxUsos: 1 }], { validarSolo: true }, { username: 'tester' });
    assert.equal(resultado.validos, 1);
    assert.equal(resultado.creados, 0);
    assert.equal(consultas.some(sql => sql.includes('INSERT INTO fg_descuentocliente')), false);
});

test('listado pagina en servidor y busca antes de LIMIT/OFFSET', async () => {
    const original = db.query;
    const llamadas = [];
    db.query = async (sql, params) => {
        llamadas.push({ sql, params });
        if (sql.includes('COUNT(*)')) return { rows: [{ total: 41 }] };
        return { rows: [{ id: 99, codigo: 'FUERA-PAGINA', activo: true }] };
    };
    try {
        const respuesta = await descuentos.listarCodigosAdministracion(3, { search: 'fuera', estado: 'ACTIVO', limit: 20, offset: 20 });
        assert.equal(respuesta.total, 41);
        assert.equal(respuesta.limit, 20);
        assert.equal(respuesta.offset, 20);
        assert.equal(respuesta.items[0].codigo, 'FUERA-PAGINA');
        assert.match(llamadas[0].sql, /UPPER\(BTRIM\(dc\.codigo\)\) LIKE/);
        assert.doesNotMatch(llamadas[0].sql, /LIMIT/);
        assert.match(llamadas[1].sql, /ORDER BY[\s\S]+LIMIT[\s\S]+OFFSET/);
    } finally { db.query = original; }
});
