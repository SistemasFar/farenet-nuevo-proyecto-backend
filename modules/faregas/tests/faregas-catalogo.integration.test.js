const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../../config/database');
const service = require('../services/faregas-tarifas.service');

test.after(() => db.end());

const servicios = (catalogo) => catalogo.categorias.flatMap((categoria) => categoria.servicios);
const catalogo = (plantaKey, client) => service.obtenerCatalogoPorPlanta(plantaKey, client);

test('Configuración modifica inmediatamente el catálogo y rollback restaura los datos', async () => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const independencia = await catalogo('201', client);
        const colina = await catalogo('13', client);
        const derby = await catalogo('203', client);
        assert.equal(servicios(independencia).length, 4);
        assert.equal(servicios(colina).length, 7);
        assert.equal(servicios(derby).length, 0);

        await client.query(
            "UPDATE fg_tarifa SET precio = 65 WHERE planta_key = '201' AND codigo = 'GLP_ANUAL'"
        );
        let actualizado = await catalogo('201', client);
        assert.equal(servicios(actualizado).find((item) => item.codigo === 'GLP_ANUAL').tarifa.precio, 65);

        await client.query(
            "UPDATE fg_tarifa SET activo = FALSE WHERE planta_key = '201' AND codigo = 'GLP_ANUAL'"
        );
        actualizado = await catalogo('201', client);
        assert.equal(servicios(actualizado).some((item) => item.codigo === 'GLP_ANUAL'), false);

        await client.query("UPDATE fg_servicio SET activo = FALSE WHERE codigo = 'GLP_INICIAL'");
        actualizado = await catalogo('13', client);
        assert.equal(servicios(actualizado).some((item) => item.codigo === 'GLP_INICIAL'), false);

        await client.query("UPDATE fg_categoria_servicio SET activo = FALSE WHERE codigo = 'CONFORMIDAD'");
        actualizado = await catalogo('13', client);
        assert.equal(actualizado.categorias.some((item) => item.codigo === 'CONFORMIDAD'), false);
    } finally {
        await client.query('ROLLBACK');
        client.release();
    }

    const restaurado = await service.obtenerCatalogoPorPlanta('201');
    const glpAnual = servicios(restaurado).find((item) => item.codigo === 'GLP_ANUAL');
    assert.equal(servicios(restaurado).length, 4);
    assert.equal(glpAnual.tarifa.precio, 60);
});

test('TEST_COMPLEMENTARIO existe en Configuración pero queda fuera de Nuevo Certificado y del backend', async () => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        const estadoInicial = await client.query(`
            SELECT COUNT(*)::int AS total,
                   COUNT(*) FILTER (WHERE tipo_flujo = 'CERTIFICACION')::int AS certificaciones,
                   COUNT(*) FILTER (WHERE tipo_flujo IS NULL)::int AS sin_flujo
            FROM fg_servicio
        `);
        assert.deepEqual(estadoInicial.rows[0], { total: 8, certificaciones: 8, sin_flujo: 0 });

        const servicio = await client.query(`
            INSERT INTO fg_servicio (
                codigo, nombre, familia, categoria_id, tipo_flujo,
                tipo_certificado_clave, modalidad, requiere_certificado,
                requiere_vehiculo, activo, orden
            )
            SELECT 'TEST_COMPLEMENTARIO', 'Servicio complementario de prueba', c.codigo, c.id,
                   'SERVICIO_COMPLEMENTARIO', NULL, NULL, FALSE, TRUE, TRUE, 999
            FROM fg_categoria_servicio c
            WHERE c.codigo = 'COMPLEMENTARIOS'
            RETURNING id
        `);
        assert.equal(servicio.rowCount, 1);

        await client.query(`
            INSERT INTO fg_tarifa (
                planta_key, codigo, familia, nombre, tipo_certificado_clave,
                modalidad, precio, activo, orden, servicio_id
            ) VALUES (
                '201', 'TEST_COMPLEMENTARIO', 'COMPLEMENTARIOS',
                'Servicio complementario de prueba', NULL, NULL, 25, TRUE, 999, $1
            )
        `, [servicio.rows[0].id]);

        const catalogoIndependencia = await catalogo('201', client);
        assert.equal(servicios(catalogoIndependencia).some((item) => item.codigo === 'TEST_COMPLEMENTARIO'), false);

        const tarifa = await service.obtenerTarifaOperativaPorCodigo('201', 'TEST_COMPLEMENTARIO', client);
        assert.equal(tarifa.tipo_flujo, 'SERVICIO_COMPLEMENTARIO');
        assert.throws(() => service.validarTarifaCertificacion(tarifa), /SERVICIO_NO_CERTIFICACION/);
    } finally {
        await client.query('ROLLBACK');
        client.release();
    }

    const residuo = await db.query("SELECT 1 FROM fg_servicio WHERE codigo = 'TEST_COMPLEMENTARIO'");
    assert.equal(residuo.rowCount, 0);
});
