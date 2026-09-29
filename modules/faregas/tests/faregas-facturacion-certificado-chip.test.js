const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const chipCertificadoService = require('../services/faregas-chip-certificado.service');
const { esDocumentoBaseOperable } = require('../services/faregas-documento-tributario-policy');

const fuenteFacturacion = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'faregas-facturacion.service.js'),
    'utf8'
);

const certificado = (productoChipId = 34) => ({
    id: 50,
    estado: 'BORRADOR',
    planta_key: '201',
    producto_chip_id: productoChipId
});

const chip = (estado) => ({
    id: 501,
    numero_chip: 'CHIP-501',
    estado,
    planta_actual_key: '201',
    producto_inventariable_id: 34,
    producto_codigo: 'CHIP-TIPO-34',
    producto_nombre: 'Chip tipo 34'
});

const clienteFalso = ({ productoChipId = 34, estadoChip = 'RESERVADO', movimientoVenta = false } = {}) => {
    const consultas = [];
    const client = {
        query: async (sql, params) => {
            consultas.push({ sql, params });
            if (sql.includes('FROM fg_certificado\n')) {
                return { rowCount: 1, rows: [certificado(productoChipId)] };
            }
            if (sql.includes('FROM fg_certificado_chip cc')) {
                return productoChipId
                    ? { rowCount: 1, rows: [chip(estadoChip)] }
                    : { rowCount: 0, rows: [] };
            }
            if (sql.includes('SELECT 1 FROM fg_chip_movimiento')) {
                return { rowCount: movimientoVenta ? 1 : 0, rows: movimientoVenta ? [{ '?column?': 1 }] : [] };
            }
            if (sql.includes("UPDATE fg_chip\n        SET estado = 'VENDIDO'")) {
                return { rowCount: 1, rows: [{ id: 501 }] };
            }
            if (sql.includes('INSERT INTO fg_chip_movimiento')) {
                return { rowCount: 1, rows: [] };
            }
            throw new Error(`Consulta no contemplada en la prueba: ${sql}`);
        }
    };
    return { client, consultas };
};

test('DEMO generado por NubeFact es operable y PRODUCCIÓN sigue exigiendo aceptación SUNAT', () => {
    assert.equal(esDocumentoBaseOperable({
        estado: 'PENDIENTE_SUNAT',
        aceptada_sunat: false,
        entorno_facturador: 'DEMO',
        proveedor: 'NUBEFACT',
        nro_comprobante: 'BBB1-00000100',
        serie: 'BBB1',
        numero: 100,
        enlace_pdf: 'https://demo.test/100.pdf'
    }), true);
    assert.equal(esDocumentoBaseOperable({
        estado: 'PENDIENTE_SUNAT',
        aceptada_sunat: false,
        entorno_facturador: 'PRODUCCION',
        proveedor: 'NUBEFACT',
        nro_comprobante: 'B001-100',
        serie: 'B001',
        numero: 100,
        enlace_pdf: 'https://prod.test/100.pdf'
    }), false);
});

test('la persistencia ejecuta el consumo usando la puerta de documento operable', () => {
    assert.match(fuenteFacturacion, /esDocumentoBaseOperable\(facturacionActualizada\.rows\[0\]\)/);
    assert.match(fuenteFacturacion, /hooks\.onDocumentoOperable/);
    assert.doesNotMatch(fuenteFacturacion, /aceptada === true && hooks\.onAceptada/);
});

test('certificado sin chip no registra venta ni modifica inventario', async () => {
    const { client, consultas } = clienteFalso({ productoChipId: null });
    const resultado = await chipCertificadoService.consumirEnFacturacion(client, {
        certificadoId: 50,
        operacionId: 70,
        username: 'grace'
    });
    assert.equal(resultado, null);
    assert.equal(consultas.some(({ sql }) => sql.includes('UPDATE fg_chip')), false);
    assert.equal(consultas.some(({ sql }) => sql.includes('INSERT INTO fg_chip_movimiento')), false);
});

test('chip reservado se vende y registra un único movimiento ligado al certificado', async () => {
    const { client, consultas } = clienteFalso({ estadoChip: 'RESERVADO' });
    const resultado = await chipCertificadoService.consumirEnFacturacion(client, {
        certificadoId: 50,
        operacionId: 70,
        username: 'grace'
    });
    assert.equal(resultado.chip.estado, 'VENDIDO');
    assert.equal(consultas.filter(({ sql }) => sql.includes('UPDATE fg_chip')).length, 1);
    assert.equal(consultas.filter(({ sql }) => sql.includes('INSERT INTO fg_chip_movimiento')).length, 1);
});

test('reintento con chip vendido y movimiento existente no duplica consumo', async () => {
    const { client, consultas } = clienteFalso({ estadoChip: 'VENDIDO', movimientoVenta: true });
    const resultado = await chipCertificadoService.consumirEnFacturacion(client, {
        certificadoId: 50,
        operacionId: 70,
        username: 'grace'
    });
    assert.equal(resultado.chip.estado, 'VENDIDO');
    assert.equal(consultas.some(({ sql }) => sql.includes('UPDATE fg_chip')), false);
    assert.equal(consultas.some(({ sql }) => sql.includes('INSERT INTO fg_chip_movimiento')), false);
});

test('chip vendido sin movimiento no se acepta silenciosamente', async () => {
    const { client } = clienteFalso({ estadoChip: 'VENDIDO', movimientoVenta: false });
    await assert.rejects(
        chipCertificadoService.consumirEnFacturacion(client, {
            certificadoId: 50,
            operacionId: 70,
            username: 'grace'
        }),
        /CHIP_VENDIDO_SIN_TRAZABILIDAD/
    );
});
