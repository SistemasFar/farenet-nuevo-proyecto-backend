/**
 * Reintento de emisión de un comprobante de venta de chips.
 *
 * Contexto: en la operación #294 la venta se registró y el comprobante
 * BBB1-00000089 quedó reservado, pero la emisión terminó en ERROR/TIMEOUT.
 * El backend ya tenía la ruta `POST /operaciones/:id/facturacion/reintentar`
 * y la guarda que impide reservar otro correlativo; lo que faltaba era poder
 * invocarla desde la UI. Estos tests fijan que el reintento:
 *
 *   - reutiliza la MISMA factura, la MISMA serie y el MISMO número;
 *   - no crea otra fg_facturacion ni avanza el correlativo de la serie;
 *   - no crea otra operacion comercial, ni otro pago, ni detalle de venta;
 *   - no altera el estado del chip.
 *
 * El proveedor Nubefact se inyecta simulado: este archivo NUNCA sale a la red.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const USA_BASE_DE_DATOS = process.env.FAREGAS_TEST_DB === '1';
if (USA_BASE_DE_DATOS) {
    require('../../../config/env-loader').loadEnv(true);
}

const db = require('../../../config/database');

const fuenteFacturacion = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'faregas-facturacion.service.js'), 'utf8');
const fuenteOperaciones = fs.readFileSync(
    path.join(__dirname, '..', 'routes', 'faregas-operaciones.routes.js'), 'utf8');
const fuenteController = fs.readFileSync(
    path.join(__dirname, '..', 'controllers', 'faregas-facturacion.controller.js'), 'utf8');

const SIN_BASE = 'requiere FAREGAS_TEST_DB=1 y una base de datos disponible';
const USUARIO = { username: 'gibarra', perfil_id: 'SISTEMAS', planta_key: '201', ip_direccion: '127.0.0.1' };

/** Numero alto y jamás usado, para no chocar con comprobantes reales. */
const NUMERO_DE_PRUEBA = 99999;

/** Proveedor simulado: vuelve a fallar por timeout, como la cuenta DEMO. */
const proveedorConTimeout = () => ({
    estadoConfiguracion: { enabled: true },
    emitirComprobante: async () => ({
        status: 'ERROR', reason: 'TIMEOUT', provider: 'NUBEFACT',
        httpStatus: null, data: null, error: 'timeout of 10000ms exceeded'
    }),
    consultarComprobante: async () => ({
        status: 'REJECTED', reason: 'REJECTED_BY_PROVIDER', provider: 'NUBEFACT',
        httpStatus: 200, data: { codigo: 24, errors: 'Documento no existe' }
    })
});

// ===========================================================================
// 1. Estructura: la ruta existe y no se inventó otra
// ===========================================================================

test('1. la ruta de reintento de operaciones ya existía y es la que se usa', () => {
    assert.match(fuenteOperaciones,
        /router\.post\('\/:operacionId\/facturacion\/reintentar', facturacionController\.reintentarPorOperacion\)/);
    assert.match(fuenteController, /reintentarFacturacionOperacion\(req\.params\.operacionId, req\.user\)/);
});

test('2. el reintento reutiliza la reserva; no crea una emission nueva desde cero', () => {
    const bloque = fuenteFacturacion.slice(
        fuenteFacturacion.indexOf('exports.reintentarFacturacionOperacion'));
    assert.match(bloque, /reservarEmisionOperacion\(operacionId, userContext, \{\s*reintentarRechazada: true\s*\}\)/);
    assert.match(bloque, /ejecutarEmisionOperacion\(reserva, userContext, dependencies\)/);
    // No toca venta, pago ni inventario.
    assert.doesNotMatch(bloque, /fg_pago|fg_orden_pago|fg_operacion_detalle|fg_chip\b/);
});

test('3. la serie solo se reserva si falta: por eso un reintento no avanza el correlativo', () => {
    const guarda = /if \(!facturacion\.serie \|\| facturacion\.numero === null\) \{/g;
    const apariciones = fuenteFacturacion.match(guarda) || [];
    // Una en el flujo de certificado y otra en el de operaciones.
    assert.equal(apariciones.length, 2, 'ambos flujos deben tener la guarda');
});

test('4. el reintento exige que la factura rechazada ya tenga serie y numero', () => {
    assert.match(fuenteFacturacion,
        /if \(facturacion\.estado === 'RECHAZADO'\)[\s\S]{0,700}REINTENTO_CORRELATIVO_INVALIDO/);
});

// ===========================================================================
// 2. Idempotencia real contra la base
// ===========================================================================

/**
 * Monta una venta de chips de prueba completa (operacion + detalle + chip +
 * orden de pago + pago) y su facturación con un correlativo ya reservado en
 * estado ERROR, que es exactamente el escenario de la operación #294.
 */
const montarEscenario = async () => {
    const canonic = require('../services/faregas-venta-directa-canonica.service');
    const facturacion = require('../services/faregas-facturacion.service');

    const chip = (await db.query(`
        SELECT ch.id, ch.numero_chip
        FROM fg_chip ch
        JOIN fg_producto_inventariable pi ON pi.id = ch.producto_inventariable_id
        JOIN fg_producto_inventariable_sede pis
          ON pis.producto_inventariable_id = pi.id AND pis.planta_key = $1 AND pis.activo
        WHERE ch.estado = 'DISPONIBLE' AND ch.planta_actual_key = $1
          AND pis.stock_permitido = TRUE AND pis.venta_habilitada = TRUE
        ORDER BY ch.id LIMIT 1
    `, [USUARIO.planta_key])).rows[0] || null;
    if (!chip) return { disponible: false };

    const precio = Number((await db.query(
        `SELECT pis.precio FROM fg_producto_inventariable_sede pis
         WHERE pis.planta_key = $1 AND pis.activo
           AND pis.producto_inventariable_id =
               (SELECT producto_inventariable_id FROM fg_chip WHERE id = $2)`,
        [USUARIO.planta_key, chip.id]
    )).rows[0].precio);

    const estadoChipPrevio = (await db.query(
        'SELECT estado FROM fg_chip WHERE id = $1', [chip.id])).rows[0].estado;

    const venta = await canonic.crearVentaDirecta({
        tipoComprobante: 'BOLETA',
        tipoDocumentoCliente: 'DNI',
        nroDocumento: '73000001',
        nombreRazonSocial: 'REINTENTO PRUEBA',
        direccion: 'CALLE REINTENTO',
        email: 'reintento@correo.com',
        telefono: '999888777',
        condicionPago: 'CONTADO',
        medioPago: 'EFECTIVO',
        pagosAgregados: [{ tipo: 'efectivo', importe: precio.toFixed(2) }],
        chips: [chip.numero_chip]
    }, USUARIO);

    await facturacion.guardarFacturacionOperacion(venta.operacionId, {
        tipoComprobante: 'BOLETA',
        nroDocumento: '73000001',
        nombreRazonSocial: 'REINTENTO PRUEBA',
        direccion: 'CALLE REINTENTO',
        email: 'reintento@correo.com',
        telefono: '999888777',
        condicionPago: 'CONTADO',
        medioPago: null,
        cuotas: []
    }, USUARIO);

    // Se simula el correlativo ya reservado y el timeout que lo dejó en ERROR,
    // con su intento nº1 registrado: es exactamente la forma de la operación 294.
    const serie = (await db.query(
        `SELECT id, serie FROM fg_serie_comprobante
         WHERE planta_key = $1 AND tipo_comprobante = 'BOLETA' AND activo
         ORDER BY es_predeterminada DESC, id LIMIT 1`, [USUARIO.planta_key])).rows[0];
    await db.query(
        `UPDATE fg_facturacion
         SET serie = $2, numero = $3, nro_comprobante = $4, serie_comprobante_id = $5,
             estado = 'ERROR', intentos = 1, sunat_description = 'TIMEOUT',
             sunat_soap_error = 'timeout of 10000ms exceeded',
             fecha_ultimo_intento = CURRENT_TIMESTAMP
         WHERE operacion_id = $1`,
        [venta.operacionId, serie.serie, NUMERO_DE_PRUEBA,
            `${serie.serie}-${String(NUMERO_DE_PRUEBA).padStart(8, '0')}`, serie.id]);

    const factura = (await db.query(
        'SELECT * FROM fg_facturacion WHERE operacion_id = $1', [venta.operacionId])).rows[0];
    await db.query(
        `INSERT INTO fg_facturacion_intento
            (facturacion_id, numero_intento, estado, solicitud, error, fecha_creacion, fecha_finalizacion)
         VALUES ($1, 1, 'ERROR', '{}'::jsonb, 'timeout of 10000ms exceeded',
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [factura.id]);

    return {
        disponible: true,
        facturacionService: facturacion,
        operacionId: venta.operacionId,
        factura,
        serieId: serie.id,
        numeroSeriePrevio: (await db.query(
            'SELECT ultimo_numero FROM fg_serie_comprobante WHERE id = $1', [serie.id]
        )).rows[0].ultimo_numero,
        chipId: chip.id,
        estadoChipPrevio
    };
};

const desmontar = async (esc) => {
    const borrarOperacion = async (operacionId) => {
        const fac = await db.query('SELECT id FROM fg_facturacion WHERE operacion_id = $1', [operacionId]);
        for (const f of fac.rows) {
            await db.query('DELETE FROM fg_facturacion_intento WHERE facturacion_id = $1', [f.id]);
        }
        await db.query('DELETE FROM fg_facturacion WHERE operacion_id = $1', [operacionId]);
        const ordenes = await db.query('SELECT id FROM fg_orden_pago WHERE operacion_id = $1', [operacionId]);
        for (const o of ordenes.rows) {
            await db.query('DELETE FROM fg_pago WHERE orden_pago_id = $1', [o.id]);
        }
        await db.query('DELETE FROM fg_orden_pago WHERE operacion_id = $1', [operacionId]);
        const detalles = await db.query('SELECT id FROM fg_operacion_detalle WHERE operacion_id = $1', [operacionId]);
        for (const d of detalles.rows) {
            await db.query('DELETE FROM fg_operacion_detalle_chip WHERE operacion_detalle_id = $1', [d.id]);
        }
        await db.query('DELETE FROM fg_operacion_detalle WHERE operacion_id = $1', [operacionId]);
        await db.query('DELETE FROM fg_chip_movimiento WHERE operacion_comercial_id = $1', [operacionId]);
        await db.query('DELETE FROM fg_operacion_comercial WHERE id = $1', [operacionId]);
    };

    await borrarOperacion(esc.operacionId);
    await db.query(
        'UPDATE fg_chip SET estado = $2, operacion_reserva_id = NULL, reservado_en = NULL WHERE id = $1',
        [esc.chipId, esc.estadoChipPrevio]);
    const cliente = await db.query(
        "SELECT id FROM fg_cliente WHERE tipo_documento = 'DNI' AND nro_documento = '73000001'");
    for (const fila of cliente.rows) {
        const usos = await db.query(
            `SELECT
                (SELECT count(*) FROM fg_operacion_comercial WHERE cliente_id = $1)
              + (SELECT count(*) FROM fg_certificado_titular WHERE cliente_id = $1) AS n`,
            [fila.id]);
        if (Number(usos.rows[0].n) === 0) {
            await db.query('DELETE FROM fg_cliente WHERE id = $1', [fila.id]);
        }
    }
};

test('5. el reintento reutiliza la misma factura, serie y numero, y no crea nada nuevo',
    async (t) => {
        if (!USA_BASE_DE_DATOS) return t.skip(SIN_BASE);
        const esc = await montarEscenario();
        if (!esc.disponible) return t.skip('no hay chips disponibles en la sede');

        try {
            const antes = {
                facturas: (await db.query('SELECT count(*)::int n FROM fg_facturacion')).rows[0].n,
                operaciones: (await db.query('SELECT count(*)::int n FROM fg_operacion_comercial')).rows[0].n,
                pagos: (await db.query('SELECT count(*)::int n FROM fg_pago')).rows[0].n,
                ordenes: (await db.query('SELECT count(*)::int n FROM fg_orden_pago')).rows[0].n,
                detalles: (await db.query('SELECT count(*)::int n FROM fg_operacion_detalle')).rows[0].n,
                vinculosChip: (await db.query('SELECT count(*)::int n FROM fg_operacion_detalle_chip')).rows[0].n,
                chipEstado: (await db.query('SELECT estado FROM fg_chip WHERE id = $1', [esc.chipId])).rows[0].estado
            };

            // El reintento que vuelve a fallar lanza NUBEFACT_ERROR (502) DESPUÉS
            // de persistir, y adjunta la factura ya actualizada.
            let errorEmitido = null;
            try {
                await esc.facturacionService.reintentarFacturacionOperacion(
                    esc.operacionId, USUARIO, { nubefactService: proveedorConTimeout() });
            } catch (error) {
                errorEmitido = error;
            }
            assert.ok(errorEmitido, 'un timeout vuelve a terminar en error');
            assert.equal(errorEmitido.message, 'NUBEFACT_ERROR');
            assert.equal(errorEmitido.statusCode, 502);
            assert.equal(Number(errorEmitido.detalles.facturacion.id), Number(esc.factura.id),
                'el error adjunta la misma factura');
            assert.equal(errorEmitido.detalles.facturacion.estado, 'ERROR');
            assert.equal(errorEmitido.detalles.motivo, 'TIMEOUT', 'el motivo sigue siendo TIMEOUT');

            const despues = {
                facturas: (await db.query('SELECT count(*)::int n FROM fg_facturacion')).rows[0].n,
                operaciones: (await db.query('SELECT count(*)::int n FROM fg_operacion_comercial')).rows[0].n,
                pagos: (await db.query('SELECT count(*)::int n FROM fg_pago')).rows[0].n,
                ordenes: (await db.query('SELECT count(*)::int n FROM fg_orden_pago')).rows[0].n,
                detalles: (await db.query('SELECT count(*)::int n FROM fg_operacion_detalle')).rows[0].n,
                vinculosChip: (await db.query('SELECT count(*)::int n FROM fg_operacion_detalle_chip')).rows[0].n,
                chipEstado: (await db.query('SELECT estado FROM fg_chip WHERE id = $1', [esc.chipId])).rows[0].estado
            };

            // 1. Misma factura, misma serie, mismo numero.
            const fila = (await db.query(
                'SELECT * FROM fg_facturacion WHERE operacion_id = $1', [esc.operacionId])).rows[0];
            assert.equal(Number(fila.id), Number(esc.factura.id), 'misma facturacion_id');
            assert.equal(fila.serie, esc.factura.serie, 'misma serie');
            assert.equal(Number(fila.numero), NUMERO_DE_PRUEBA, 'mismo numero');
            assert.equal(fila.nro_comprobante, esc.factura.nro_comprobante, 'mismo nro_comprobante');


            // 2. El correlativo de la serie NO avanza.
            const numeroSerie = (await db.query(
                'SELECT ultimo_numero FROM fg_serie_comprobante WHERE id = $1', [esc.serieId]
            )).rows[0].ultimo_numero;
            assert.equal(String(numeroSerie), String(esc.numeroSeriePrevio),
                'el correlativo de la serie no se movió');

            // 3. No se creó ninguna fila de venta, pago, detalle ni vínculo de chip.
            assert.equal(despues.facturas, antes.facturas, 'no se crea otra fg_facturacion');
            assert.equal(despues.operaciones, antes.operaciones, 'no se crea otra operacion');
            assert.equal(despues.pagos, antes.pagos, 'no se registra otro pago');
            assert.equal(despues.ordenes, antes.ordenes, 'no se crea otra orden de pago');
            assert.equal(despues.detalles, antes.detalles, 'no se crea otro detalle de venta');
            assert.equal(despues.vinculosChip, antes.vinculosChip, 'no se revende el chip');
            assert.equal(despues.chipEstado, antes.chipEstado, 'el chip conserva su estado');
            assert.equal(despues.chipEstado, 'VENDIDO', 'el chip sigue VENDIDO');

            // 4. El reintento añade su intento nº2 sobre la misma factura, sin
            //    crear otra fg_facturacion ni otro intento huerfano.
            const intentos = await db.query(
                'SELECT numero_intento, estado FROM fg_facturacion_intento WHERE facturacion_id = $1 ORDER BY numero_intento',
                [esc.factura.id]);
            assert.equal(intentos.rowCount, 2, 'el intento original mas el del reintento');
            assert.deepEqual(intentos.rows.map((r) => Number(r.numero_intento)), [1, 2]);
            assert.equal(intentos.rows[1].estado, 'ERROR', 'vuelve a fallar por timeout');

            // 5. El contador de intentos avanza 1 -> 2: por eso una cadena de
            //    reintentos no es infinita (maxAttempts = 5).
            const reintentos = (await db.query(
                'SELECT intentos FROM fg_facturacion WHERE id = $1', [esc.factura.id])).rows[0].intentos;
            assert.equal(Number(reintentos), 2, 'intentos 1 -> 2');
        } finally {
            await desmontar(esc);
        }
    });

test('6. el payload reenviado conserva la MISMA serie y numero', async (t) => {
    if (!USA_BASE_DE_DATOS) return t.skip(SIN_BASE);
    const esc = await montarEscenario();
    if (!esc.disponible) return t.skip('no hay chips disponibles en la sede');

    try {
        const capturado = {};
        try {
            await esc.facturacionService.reintentarFacturacionOperacion(esc.operacionId, USUARIO, {
                nubefactService: {
                    ...proveedorConTimeout(),
                    emitirComprobante: async (payload) => {
                        capturado.payload = payload;
                        return { status: 'ERROR', reason: 'TIMEOUT', data: null, error: 'timeout of 10000ms exceeded' };
                    }
                }
            });
        } catch {
            // El timeout vuelve a terminar en NUBEFACT_ERROR; lo que importa es
            // qué payload se envió antes de persistir el fallo.
        }

        assert.equal(capturado.payload.serie, esc.factura.serie, 'el payload reenvía la misma serie');
        assert.equal(Number(capturado.payload.numero), NUMERO_DE_PRUEBA, 'el payload reenvía el mismo numero');
        assert.equal(capturado.payload.codigo_unico, `FG-${esc.factura.id}`,
            'y el mismo codigo_unico, que es la identidad ante el proveedor');
    } finally {
        await desmontar(esc);
    }
});

test('7. una factura ya ACEPTADA no se reemite: responde yaAceptada sin tocar el proveedor',
    async (t) => {
        if (!USA_BASE_DE_DATOS) return t.skip(SIN_BASE);
        const esc = await montarEscenario();
        if (!esc.disponible) return t.skip('no hay chips disponibles en la sede');

        try {
            await db.query(
                "UPDATE fg_facturacion SET estado = 'ACEPTADO' WHERE id = $1", [esc.factura.id]);
            let llamado = false;
            const respuesta = await esc.facturacionService.reintentarFacturacionOperacion(
                esc.operacionId, USUARIO, {
                    nubefactService: {
                        ...proveedorConTimeout(),
                        emitirComprobante: async () => { llamado = true; throw new Error('no deberia emitir'); }
                    }
                });
            assert.equal(llamado, false, 'no se llama a Nubefact si ya está aceptada');
            assert.equal(respuesta.estado, 'ACEPTADO');
            // Sigue having sólo el intento original del fixture: el reintento no
            // añadió ninguno, porque ni siquiera llegó a preparar la emisión.
            const intentos = await db.query(
                'SELECT count(*)::int n FROM fg_facturacion_intento WHERE facturacion_id = $1',
                [esc.factura.id]);
            assert.equal(intentos.rows[0].n, 1, 'no se crea ningún intento nuevo');
        } finally {
            await desmontar(esc);
        }
    });

// ===========================================================================
// 3. La operación real #294 cumple las precondiciones del reintento
//    (comprobación de sólo lectura, sin tocarla)
// ===========================================================================

test('8. una venta en ERROR con serie y numero reservados es reintentable', async (t) => {
    if (!USA_BASE_DE_DATOS) return t.skip(SIN_BASE);

    const r = await db.query(`
        SELECT f.id, f.operacion_id, f.estado, f.serie, f.numero, f.nro_comprobante,
               f.intentos, f.sunat_description
        FROM fg_facturacion f
        WHERE f.certificado_id IS NULL AND f.estado = 'ERROR' AND f.operacion_id IS NOT NULL
        ORDER BY f.id DESC
    `);
    if (r.rowCount === 0) return t.skip('no hay ventas de chips en ERROR');

    for (const fila of r.rows) {
        // Mismas precondiciones que aplica la regla del frontend.
        assert.ok(['ERROR', 'PENDIENTE'].includes(fila.estado));
        assert.ok(fila.serie, 'tiene serie reservada');
        assert.notEqual(fila.numero, null, 'tiene numero reservado');
        assert.ok(fila.nro_comprobante, 'tiene comprobante asignado');
        // Y el backend efectivamente no reservaria otro numero.
        const serie = (await db.query(
            'SELECT ultimo_numero FROM fg_serie_comprobante WHERE serie = $1', [fila.serie]
        )).rows[0];
        assert.ok(serie, 'la serie existe y su correlativo esta registrado');
    }
});

test.after(() => db.end());
