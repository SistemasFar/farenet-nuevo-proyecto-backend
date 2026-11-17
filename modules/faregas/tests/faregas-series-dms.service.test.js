const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../services/faregas-series-dms.service');

const documentos = [
    ['FE', '01', '', 'E', 'FACTURA'],
    ['BE', '03', '', 'E', 'BOLETA'],
    ['NCF', '07', '01', 'C', 'NOTA_CREDITO_FACTURA'],
    ['NCB', '07', '03', 'C', 'NOTA_CREDITO_BOLETA'],
    ['NDF', '08', '01', 'D', 'NOTA_DEBITO_FACTURA'],
    ['NDB', '08', '03', 'D', 'NOTA_DEBITO_BOLETA']
];

const filasJicamarca = () => Array.from({ length: 114 }, (_, index) => {
    const [nombre, tipo, referencia, letra] = documentos[Math.floor(index / 19)];
    const numero = `${letra}${String(index % 19).padStart(2, '0')}`;
    return {
        Nombre: nombre,
        Autogenerada: 'Sí',
        'Último Número Generado': '100',
        Activo: 'Sí',
        'Tipo de Documento': tipo,
        Número: numero,
        'Tipo de Documento de Referencia': referencia,
        'Código del Local': '0043',
        'Nombre del Local': 'FAREGAS - JICAMARCA',
        'Teléfono del Local': '',
        'Correo del Local': '',
        'Dirección Comercial': '',
        'Serie para POS': 'No',
        'Serie de Contingencia': 'No'
    };
});

const fakeQueryable = (empresaKey, calls, series = []) => ({
    async query(sql, params = []) {
        calls.push({ sql, params });
        if (sql === 'BEGIN' || sql === 'ROLLBACK' || sql === 'COMMIT') return { rows: [] };
        if (sql.includes('FROM fg_planta')) return { rows: [{ key: '43', empresa_key: empresaKey }] };
        if (sql.includes('FROM fg_serie_comprobante')) return { rows: series };
        throw new Error(`SQL inesperado en prueba: ${sql}`);
    }
});

test('una serie existente no se sobrescribe aunque el correlativo del Excel sea mayor', async () => {
    const calls = [];
    const actual = {
        id: 5,
        planta_key: '43',
        empresa_key: 'FAREGAS',
        tipo_comprobante: 'FACTURA',
        serie: 'F000',
        tipo_documento_referencia: null,
        ultimo_numero: 50,
        nombre_dms: 'FE',
        codigo_local_dms: '0043',
        nombre_local_dms: 'FAREGAS - JICAMARCA',
        autogenerada: true,
        activo: true,
        serie_pos: false,
        contingencia: false
    };
    const preview = await service.previsualizar(filasJicamarca(), fakeQueryable('FAREGAS', calls, [actual]));
    const matched = preview.filas.find((row) => row.serie === 'F000');

    assert.equal(matched.estado, 'YA_EXISTE');
    assert.equal(matched.ultimo_numero_faregas, 50);
    assert.equal(matched.ultimo_numero_final, 50);
    assert.ok(matched.diferencias.includes('ultimo_numero'));
});

test('la previsualización no considera una planta de otra empresa como FAREGAS', async () => {
    const calls = [];
    const preview = await service.previsualizar(filasJicamarca(), fakeQueryable('MALONGO', calls));

    assert.equal(preview.resumen.SEDE_NO_HOMOLOGADA, 114);
    assert.equal(preview.resumen.CREAR, 0);
    assert.equal(preview.filas[0].motivo, 'PLANTA_PERTENECE_A_OTRA_EMPRESA');
    assert.ok(calls[1].sql.includes('COALESCE(s.empresa_key, p.empresa_key) = $1'));
    assert.deepEqual(calls[1].params, ['FAREGAS']);
});

test('aplicar aborta en transacción cuando el Excel apunta a una sede de otra empresa', async () => {
    const calls = [];
    const client = fakeQueryable('CAMBRIDGE', calls);
    client.release = () => {};
    const pool = { connect: async () => client };

    await assert.rejects(
        service.aplicar(filasJicamarca(), { confirmar: true, username: 'test', ipDireccion: '127.0.0.1' }, { db: pool }),
        /HOMOLOGACION_DMS_REQUIERE_RESOLVER_HOMOLOGACIONES/
    );

    assert.equal(calls.filter((call) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(call.sql)).length, 0);
    assert.ok(calls.some((call) => call.sql === 'ROLLBACK'));
});
