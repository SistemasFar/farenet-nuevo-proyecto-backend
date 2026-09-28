/**
 * Unificación del maestro de clientes FAREGAS entre Nuevo Certificado y Venta
 * Directa de Chips.
 *
 * Contexto: la auditoría encontró que `fg_operacion_comercial.cliente_id`
 * estaba en NULL en las 166 operaciones, porque el INSERT de la venta directa
 * usaba un NULL literal, y que el correo/teléfono se anulaba antes de llegar a
 * `fg_facturacion`. Estos tests fijan el comportamiento corregido.
 *
 * Los tests de base de datos son opt-in (FAREGAS_TEST_DB=1) porque escriben y
 * restauran datos reales. Todos restauran el estado original en `finally`.
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
const clientesService = require('../services/faregas-clientes.service');

const fuenteClientes = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'faregas-clientes.service.js'), 'utf8');
const fuenteCanonica = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'faregas-venta-directa-canonica.service.js'), 'utf8');
const fuenteFase2 = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'faregas-venta-directa-fase2.service.js'), 'utf8');

const SIN_BASE = 'requiere FAREGAS_TEST_DB=1 y una base de datos disponible';
const USUARIO = { username: 'gibarra', perfil_id: 'SISTEMAS', planta_key: '201', ip_direccion: '127.0.0.1' };

/** El bloque fuente de un export concreto, acotado hasta el siguiente. */
const bloqueDe = (fuente, desde, hasta) => fuente.slice(
    fuente.indexOf(desde),
    fuente.indexOf(hasta)
);

// ===========================================================================
// 1. Estructura: no queda el NULL literal ni el descarte del contacto
// ===========================================================================

test('1. la venta directa ya no inserta cliente_id = NULL literal', () => {
    assert.match(fuenteCanonica, /clientesService\.asegurarCliente\(/);
    assert.match(fuenteCanonica, /VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, 'sol'/);
    // La línea que fijaba cliente_id a NULL debe haber desaparecido.
    assert.doesNotMatch(fuenteCanonica, /VALUES \(\$1, NULL, \$2, \$3, \$4, \$5, 'sol'/);
});

test('2. la venta directa reutiliza el service de clientes (no duplica SQL)', () => {
    assert.match(fuenteCanonica, /require\('\.\/faregas-clientes\.service'\)/);
    // El maestro se resuelve a través del service, no con un SELECT propio.
    assert.doesNotMatch(fuenteCanonica, /FROM fg_cliente/);
});

test('3. la facturación de operaciones ya no anula correo ni teléfono', () => {
    assert.match(fuenteFase2, /email: texto\(contacto\.email\) \|\| null/);
    assert.match(fuenteFase2, /telefono: texto\(contacto\.telefono\) \|\| null/);
    assert.doesNotMatch(fuenteFase2, /^\s+email: null,\s*$/m);
    assert.doesNotMatch(fuenteFase2, /^\s+telefono: null,\s*$/m);
});

test('4. la fase canónica devuelve el maestro resuelto para no re-consultar', () => {
    assert.match(fuenteCanonica, /cliente: clienteMaestro/);
    assert.match(fuenteFase2, /venta\.cliente\?\.correo/);
    assert.match(fuenteFase2, /venta\.cliente\?\.telefono/);
});

test('5. asegurarCliente es no destructivo: sólo completa columnas vacías', () => {
    const bloque = bloqueDe(fuenteClientes, 'exports.asegurarCliente', 'exports.crearCliente');
    // Nunca asigna un valor entrante sobre un campo ya poblado del maestro.
    assert.match(bloque, /!texto\(cliente\.direccion\) && direccion/);
    assert.match(bloque, /!texto\(cliente\.correo\) && correo/);
    assert.match(bloque, /!texto\(cliente\.telefono\) && telefono/);
    // El nombre y la identidad del maestro no se tocan en el UPDATE.
    assert.doesNotMatch(bloque, /nombre_razon_social = \$/);
});

test('6. asegurarCliente respeta la UNIQUE (tipo_documento, nro_documento)', () => {
    const bloque = bloqueDe(fuenteClientes, 'exports.asegurarCliente', 'exports.crearCliente');
    assert.match(bloque, /e\.code === '23505'/);
    // Ante la carrera de dos ventas simultáneas, reutiliza el registro ganador.
    assert.match(bloque, /const ganador = await leer\(\);/);
});

// ===========================================================================
// 2. Persistencia real del maestro de clientes
// ===========================================================================

/**
 * Aísla un documento de cliente, ejecuta la acción y restaura el maestro a su
 * estado exacto. Si el documento no existía, lo crea para la prueba y lo borra
 * al terminar; si ya existía, restaura la fila tal como estaba.
 */
const conClienteAislado = async (nroDocumento, accion) => {
    const leer = async () => (await db.query(
        'SELECT * FROM fg_cliente WHERE tipo_documento = $1 AND nro_documento = $2',
        ['DNI', nroDocumento]
    )).rows[0] || null;
    const original = await leer();

    try {
        return await accion(original);
    } finally {
        const actual = await leer();
        if (!original && actual) {
            const usos = await db.query(
                `SELECT
                    (SELECT count(*) FROM fg_operacion_comercial WHERE cliente_id = $1)
                  + (SELECT count(*) FROM fg_certificado_titular WHERE cliente_id = $1) AS n`,
                [actual.id]
            );
            if (Number(usos.rows[0].n) === 0) {
                await db.query('DELETE FROM fg_cliente WHERE id = $1', [actual.id]);
            }
        } else if (original && actual) {
            await db.query(
                `UPDATE fg_cliente
                 SET nombre_razon_social = $2, direccion = $3, telefono = $4, correo = $5
                 WHERE id = $1`,
                [original.id, original.nombre_razon_social, original.direccion,
                    original.telefono, original.correo]
            );
        }
    }
};

// TEST 1 — cliente existente: reutiliza el maestro, no crea otro
test('7. con cliente existente reutiliza su id y no crea otro registro', async (t) => {
    if (!USA_BASE_DE_DATOS) return t.skip(SIN_BASE);

    const DOC = '74045612';
    const resultado = await conClienteAislado(DOC, async (original) => {
        if (!original) return { sinMaestro: true };
        const antes = (await db.query('SELECT count(*)::int n FROM fg_cliente')).rows[0].n;
        const cliente = await clientesService.asegurarCliente({
            tipoDocumento: 'DNI',
            nroDocumento: DOC,
            nombreRazonSocial: 'GRACE',
            direccion: 'dasso 123 miraflores',
            correo: 'nuevo@correo.com',
            telefono: '999888777'
        });
        return {
            maestroId: Number(original.id),
            cliente,
            antes,
            despues: (await db.query('SELECT count(*)::int n FROM fg_cliente')).rows[0].n,
            totalConEseDoc: (await db.query(
                'SELECT count(*)::int n FROM fg_cliente WHERE tipo_documento = $1 AND nro_documento = $2',
                ['DNI', DOC]
            )).rows[0].n
        };
    });

    if (resultado.sinMaestro) return t.skip('el DNI de prueba no esta en el maestro');
    assert.equal(resultado.cliente.id, resultado.maestroId, 'reutiliza el id del maestro');
    assert.equal(resultado.cliente.creado, false, 'no crea un cliente nuevo');
    assert.equal(resultado.totalConEseDoc, 1, 'sigue habiendo un solo fg_cliente para ese documento');
    assert.equal(resultado.despues, resultado.antes, 'no agrega filas a fg_cliente');
});

// TEST 2 — cliente nuevo: se crea uno solo y queda completo
test('8. con cliente nuevo crea un único registro con los datos de la venta', async (t) => {
    if (!USA_BASE_DE_DATOS) return t.skip(SIN_BASE);

    const DOC = '12345678';
    const resultado = await conClienteAislado(DOC, async () => {
        const antes = (await db.query('SELECT count(*)::int n FROM fg_cliente')).rows[0].n;
        const cliente = await clientesService.asegurarCliente({
            tipoDocumento: 'DNI',
            nroDocumento: DOC,
            nombreRazonSocial: 'CLIENTE PRUEBA',
            direccion: 'CALLE TEST',
            correo: 'test@example.com',
            telefono: '999999999'
        });
        return {
            antes,
            cliente,
            fila: (await db.query('SELECT * FROM fg_cliente WHERE id = $1', [cliente.id])).rows[0],
            total: (await db.query(
                'SELECT count(*)::int n FROM fg_cliente WHERE tipo_documento = $1 AND nro_documento = $2',
                ['DNI', DOC]
            )).rows[0].n
        };
    });

    assert.equal(resultado.total, 1, 'no se duplica');
    assert.equal(resultado.fila.nombre_razon_social, 'CLIENTE PRUEBA');
    assert.equal(resultado.fila.direccion, 'CALLE TEST');
    assert.equal(resultado.fila.correo, 'test@example.com');
    assert.equal(resultado.fila.telefono, '999999999');
});

// TEST 3 — idempotencia: dos ventas del mismo documento reutilizan el mismo id
test('9. dos ventas del mismo documento reutilizan el mismo cliente_id', async (t) => {
    if (!USA_BASE_DE_DATOS) return t.skip(SIN_BASE);

    const DOC = '12345678';
    const resultado = await conClienteAislado(DOC, async () => {
        const primero = await clientesService.asegurarCliente({
            tipoDocumento: 'DNI', nroDocumento: DOC,
            nombreRazonSocial: 'PRIMERO', direccion: 'DIR UNO',
            correo: 'uno@correo.com', telefono: '111111111'
        });
        const segundo = await clientesService.asegurarCliente({
            tipoDocumento: 'DNI', nroDocumento: DOC,
            nombreRazonSocial: 'SEGUNDO', direccion: 'DIR DOS',
            correo: 'dos@correo.com', telefono: '222222333'
        });
        return {
            primero,
            segundo,
            total: (await db.query(
                'SELECT count(*)::int n FROM fg_cliente WHERE tipo_documento = $1 AND nro_documento = $2',
                ['DNI', DOC]
            )).rows[0].n
        };
    });

    assert.equal(resultado.total, 1, 'NO se crea un segundo fg_cliente');
    assert.equal(resultado.primero.id, resultado.segundo.id, 'mismo cliente_id');
    assert.equal(resultado.primero.creado, true);
    assert.equal(resultado.segundo.creado, false, 'la segunda venta sólo reutiliza');
});

// TEST 5 — no destructivo: completa vacíos, nunca sobreescribe ni borra
test('10. completa los campos vacíos del maestro y nunca los sobreescribe', async (t) => {
    if (!USA_BASE_DE_DATOS) return t.skip(SIN_BASE);

    const DOC = '71000001';
    const creado = await db.query(
        `INSERT INTO fg_cliente (tipo_documento, nro_documento, nombre_razon_social, estado)
         VALUES ('DNI', $1, 'MAESTRO VACIO', true) RETURNING id`,
        [DOC]
    );
    const id = creado.rows[0].id;

    try {
        const antes = (await db.query(
            'SELECT direccion, correo, telefono FROM fg_cliente WHERE id = $1', [id]
        )).rows[0];
        assert.equal(antes.direccion, null, 'precondición: dirección vacía');
        assert.equal(antes.correo, null, 'precondición: correo vacío');

        // (a) una venta con datos rellena lo que falta
        await clientesService.asegurarCliente({
            tipoDocumento: 'DNI', nroDocumento: DOC, nombreRazonSocial: 'MAESTRO VACIO',
            direccion: 'CALLE COMPLETADA', correo: 'completado@correo.com', telefono: '777666555'
        });
        const completado = (await db.query(
            'SELECT direccion, correo, telefono FROM fg_cliente WHERE id = $1', [id]
        )).rows[0];
        assert.equal(completado.direccion, 'CALLE COMPLETADA', 'completa la dirección vacía');
        assert.equal(completado.correo, 'completado@correo.com', 'completa el correo vacío');
        assert.equal(completado.telefono, '777666555', 'completa el teléfono vacío');

        // (b) otra venta con datos distintos NO sobreescribe lo ya válido
        await clientesService.asegurarCliente({
            tipoDocumento: 'DNI', nroDocumento: DOC, nombreRazonSocial: 'MAESTRO VACIO',
            direccion: 'OTRA DIRECCION', correo: 'otro@correo.com', telefono: '111222333'
        });
        const intacto = (await db.query(
            'SELECT direccion, correo, telefono FROM fg_cliente WHERE id = $1', [id]
        )).rows[0];
        assert.equal(intacto.direccion, 'CALLE COMPLETADA', 'no sobreescribe la dirección válida');
        assert.equal(intacto.correo, 'completado@correo.com', 'no sobreescribe el correo válido');
        assert.equal(intacto.telefono, '777666555', 'no sobreescribe el teléfono válido');

        // (c) una venta sin contacto no borra nada
        await clientesService.asegurarCliente({
            tipoDocumento: 'DNI', nroDocumento: DOC,
            nombreRazonSocial: 'MAESTRO VACIO', direccion: 'x', correo: null, telefono: null
        });
        const sobrevive = (await db.query(
            'SELECT direccion, correo, telefono FROM fg_cliente WHERE id = $1', [id]
        )).rows[0];
        assert.equal(sobrevive.correo, 'completado@correo.com', 'un vacío NO borra el correo');
        assert.equal(sobrevive.telefono, '777666555', 'un vacío NO borra el teléfono');
        assert.equal(sobrevive.direccion, 'CALLE COMPLETADA', 'un vacío NO borra la dirección');
    } finally {
        await db.query('DELETE FROM fg_cliente WHERE id = $1', [id]);
    }
});

test('11. el maestro se identifica por la UNIQUE real de la base', async (t) => {
    if (!USA_BASE_DE_DATOS) return t.skip(SIN_BASE);
    const r = await db.query(`
        SELECT pg_get_constraintdef(oid) AS def
        FROM pg_constraint
        WHERE conrelid = 'fg_cliente'::regclass AND contype = 'u'
    `);
    assert.ok(r.rowCount > 0, 'fg_cliente debe tener una restricción de unicidad');
    const defs = r.rows.map((x) => x.def).join(' ');
    assert.match(defs, /tipo_documento/);
    assert.match(defs, /nro_documento/);
});

// ===========================================================================
// 3. Orquestación de fase 2: el contacto llega a la facturación
//    (con dependencias inyectadas: no toca la base ni Nubefact)
// ===========================================================================

const ejecutarFase2 = async (payload, maestro) => {
    const fase2 = require('../services/faregas-venta-directa-fase2.service');
    let recibido = null;
    const resultado = await fase2.crearVentaDirectaYEmitir(payload, USUARIO, {
        ventaDirectaService: {
            crearVentaDirecta: async () => ({
                operacionId: 999999, cliente: maestro, estado: 'PAGADO'
            })
        },
        facturacionService: {
            evaluarDatosFacturacion: () => ({ datos: {}, errores: [] }),
            guardarFacturacionOperacion: async (_id, datos) => {
                recibido = datos;
                return { id: 1, estado: 'BORRADOR' };
            },
            emitirFacturacionOperacion: async () => ({ id: 1, estado: 'BORRADOR' })
        },
        db: {
            query: async () => ({
                rowCount: 1,
                rows: [{
                    id: 999999, planta_key: '201', estado: 'PAGADO',
                    tipo_documento_cliente_snapshot: 'DNI',
                    documento_cliente_snapshot: payload.nroDocumento,
                    nombre_cliente_snapshot: payload.nombreRazonSocial,
                    direccion_cliente_snapshot: payload.direccion
                }]
            })
        }
    });
    return { recibido, resultado };
};

test('16. fase 2 lleva el contacto del payload a la facturación de la operación',
    async () => {
        const { recibido } = await ejecutarFase2({
            tipoComprobante: 'BOLETA',
            tipoDocumentoCliente: 'DNI',
            nroDocumento: '74045612',
            nombreRazonSocial: 'GRACE',
            direccion: 'CALLE X',
            email: 'del-operador@correo.com',
            telefono: '999888777',
            condicionPago: 'CONTADO'
        }, { id: 79, correo: 'del-maestro@correo.com', telefono: '111222333' });

        assert.equal(recibido.email, 'del-operador@correo.com', 'el dato de la venta manda');
        assert.equal(recibido.telefono, '999888777');
    });

test('17. fase 2 cae al maestro cuando el payload no trae contacto', async () => {
    const { recibido } = await ejecutarFase2({
        tipoComprobante: 'BOLETA',
        tipoDocumentoCliente: 'DNI',
        nroDocumento: '74045612',
        nombreRazonSocial: 'GRACE',
        direccion: 'CALLE X',
        email: null,
        telefono: null,
        condicionPago: 'CONTADO'
    }, { id: 79, correo: 'del-maestro@correo.com', telefono: '111222333' });

    assert.equal(recibido.email, 'del-maestro@correo.com', 'usa el maestro ya resuelto');
    assert.equal(recibido.telefono, '111222333');
});

test('18. fase 2 deja NULL si ni la venta ni el maestro tienen contacto', async () => {
    const { recibido } = await ejecutarFase2({
        tipoComprobante: 'BOLETA',
        tipoDocumentoCliente: 'DNI',
        nroDocumento: '74045612',
        nombreRazonSocial: 'GRACE',
        direccion: 'CALLE X',
        email: null,
        telefono: null,
        condicionPago: 'CONTADO'
    }, { id: 79, correo: null, telefono: null });

    assert.equal(recibido.email, null, 'no se inventa un correo');
    assert.equal(recibido.telefono, null);
});

test('19. fase 2 no vuelve a consultar el maestro para el contacto', () => {
    // El maestro viaja en el resultado de la fase 1; no hay SELECT extra.
    const bloque = fuenteFase2.slice(
        fuenteFase2.indexOf('const venta = await ventaService.crearVentaDirecta'),
        fuenteFase2.indexOf('let facturacionGuardada')
    );
    assert.doesNotMatch(bloque, /SELECT/i);
    assert.match(bloque, /venta\.cliente\?\.correo/);
});

// ===========================================================================
// 4. Integración: operación comercial y facturación con el maestro enlazado
// ===========================================================================

const borrarOperacionDePrueba = async (operacionId) => {
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

/** Un chip DISPONIBLE de la sede, sin depender de un número concreto. */
const obtenerChipLibre = async () => {
    const r = await db.query(`
        SELECT ch.id, ch.numero_chip
        FROM fg_chip ch
        JOIN fg_producto_inventariable pi ON pi.id = ch.producto_inventariable_id
        JOIN fg_producto_inventariable_sede pis
          ON pis.producto_inventariable_id = pi.id AND pis.planta_key = $1 AND pis.activo
        WHERE ch.estado = 'DISPONIBLE' AND ch.planta_actual_key = $1
          AND pis.stock_permitido = TRUE AND pis.venta_habilitada = TRUE
        ORDER BY ch.id LIMIT 1
    `, [USUARIO.planta_key]);
    return r.rows[0] || null;
};

test('12. la venta directa enlaza la operacion al maestro y guarda el contacto en fg_facturacion',
    async (t) => {
        if (!USA_BASE_DE_DATOS) return t.skip(SIN_BASE);

        const canonic = require('../services/faregas-venta-directa-canonica.service');
        const facturacion = require('../services/faregas-facturacion.service');
        const chip = await obtenerChipLibre();
        if (!chip) return t.skip('no hay chips disponibles en la sede');

        const DOC = '72000002';
        let operacionId = null;
        const estadoChipPrevio = (await db.query(
            'SELECT estado FROM fg_chip WHERE id = $1', [chip.id]
        )).rows[0].estado;

        try {
            const precio = Number((await db.query(
                `SELECT pis.precio FROM fg_producto_inventariable_sede pis
                 WHERE pis.planta_key = $1 AND pis.activo
                   AND pis.producto_inventariable_id =
                       (SELECT producto_inventariable_id FROM fg_chip WHERE id = $2)`,
                [USUARIO.planta_key, chip.id]
            )).rows[0].precio);

            const venta = await canonic.crearVentaDirecta({
                tipoComprobante: 'BOLETA',
                tipoDocumentoCliente: 'DNI',
                nroDocumento: DOC,
                nombreRazonSocial: 'INTEGRACION CLIENTE',
                direccion: 'CALLE INTEGRACION',
                email: 'integracion@correo.com',
                telefono: '999888777',
                condicionPago: 'CONTADO',
                medioPago: 'EFECTIVO',
                pagosAgregados: [{ tipo: 'efectivo', importe: precio.toFixed(2) }],
                chips: [chip.numero_chip]
            }, USUARIO);
            operacionId = venta.operacionId;

            // La operación queda relacionada con el maestro, no con NULL.
            const op = (await db.query(
                `SELECT cliente_id, documento_cliente_snapshot, nombre_cliente_snapshot,
                        direccion_cliente_snapshot
                 FROM fg_operacion_comercial WHERE id = $1`,
                [operacionId]
            )).rows[0];
            assert.notEqual(op.cliente_id, null, 'fg_operacion_comercial.cliente_id ya no es NULL');
            assert.equal(Number(op.cliente_id), Number(venta.cliente.id));
            // Y los snapshots se conservan como histórico de la venta.
            assert.equal(op.documento_cliente_snapshot, DOC);
            assert.equal(op.nombre_cliente_snapshot, 'INTEGRACION CLIENTE');
            assert.equal(op.direccion_cliente_snapshot, 'CALLE INTEGRACION');

            // El maestro se creó con el contacto de la venta.
            const maestro = (await db.query(
                'SELECT * FROM fg_cliente WHERE id = $1', [op.cliente_id]
            )).rows[0];
            assert.equal(maestro.correo, 'integracion@correo.com');
            assert.equal(maestro.telefono, '999888777');

            // La facturación guarda el contacto (sin emitir: no se toca Nubefact).
            const fact = await facturacion.guardarFacturacionOperacion(operacionId, {
                tipoComprobante: 'BOLETA',
                nroDocumento: DOC,
                nombreRazonSocial: 'INTEGRACION CLIENTE',
                direccion: 'CALLE INTEGRACION',
                email: 'integracion@correo.com',
                telefono: '999888777',
                condicionPago: 'CONTADO',
                medioPago: null,
                cuotas: []
            }, USUARIO);
            assert.equal(fact.email, 'integracion@correo.com', 'fg_facturacion.email');
            assert.equal(fact.telefono, '999888777', 'fg_facturacion.telefono');
            assert.equal(fact.estado, 'BORRADOR', 'no se emitio: el test no llama a Nubefact');
        } finally {
            if (operacionId) await borrarOperacionDePrueba(operacionId);
            await db.query(
                'UPDATE fg_chip SET estado = $2, operacion_reserva_id = NULL, reservado_en = NULL WHERE id = $1',
                [chip.id, estadoChipPrevio]
            );
            // Sólo se borra el maestro si lo creó este test y no quedó en uso.
            const ids = await db.query(
                'SELECT id FROM fg_cliente WHERE tipo_documento = $1 AND nro_documento = $2',
                ['DNI', DOC]
            );
            for (const fila of ids.rows) {
                const usos = await db.query(
                    `SELECT
                        (SELECT count(*) FROM fg_operacion_comercial WHERE cliente_id = $1)
                      + (SELECT count(*) FROM fg_certificado_titular WHERE cliente_id = $1) AS n`,
                    [fila.id]
                );
                if (Number(usos.rows[0].n) === 0) {
                    await db.query('DELETE FROM fg_cliente WHERE id = $1', [fila.id]);
                }
            }
        }
    });

// ===========================================================================
// 4. TEST 6 — el certificado se enlaza al maestro por su titular principal
// ===========================================================================

test('13. guardar un borrador con clienteId enlaza fg_certificado al maestro',
    async (t) => {
        if (!USA_BASE_DE_DATOS) return t.skip(SIN_BASE);
        const certificados = require('../services/faregas-certificados.service');

        const r = await db.query(`
            SELECT c.id FROM fg_certificado c
            WHERE c.estado = 'BORRADOR'
              AND EXISTS (SELECT 1 FROM fg_certificado_titular tt
                          WHERE tt.certificado_id = c.id AND tt.cliente_id IS NOT NULL)
            ORDER BY c.id DESC LIMIT 1
        `);
        if (r.rowCount === 0) return t.skip('no hay un borrador con titular enlazado');

        const certId = Number(r.rows[0].id);
        // El titular principal es el de menor `orden`, la misma definicion que
        // usa el wizard en el cliente.
        const principal = (await db.query(
            'SELECT cliente_id FROM fg_certificado_titular WHERE certificado_id = $1 ORDER BY orden ASC LIMIT 1',
            [certId]
        )).rows[0];
        const previo = (await db.query(
            'SELECT cliente_id FROM fg_certificado WHERE id = $1', [certId]
        )).rows[0].cliente_id;

        try {
            await certificados.actualizarBorrador(
                certId, { clienteId: Number(principal.cliente_id) }, USUARIO);
            const despues = (await db.query(
                'SELECT cliente_id FROM fg_certificado WHERE id = $1', [certId]
            )).rows[0];
            assert.equal(Number(despues.cliente_id), Number(principal.cliente_id),
                'fg_certificado.cliente_id toma el cliente del titular principal');

            // El snapshot histórico de titulares no se toca.
            const titulares = await db.query(
                'SELECT cliente_id FROM fg_certificado_titular WHERE certificado_id = $1 AND cliente_id IS NOT NULL',
                [certId]
            );
            assert.ok(titulares.rowCount > 0, 'fg_certificado_titular.cliente_id se mantiene');
        } finally {
            await db.query(
                'UPDATE fg_certificado SET cliente_id = $2 WHERE id = $1', [certId, previo]);
        }
    });

// TEST 7 — el flujo del certificado copia el maestro a su operación
test('14. el servicio de pagos sigue copiando certificado.cliente_id a la operacion', () => {
    // No se modifico: la correccion es que deje de recibir NULL, no cambiar esta
    // linea. Se fija para que nadie la rompa al refactorizar.
    const fuente = fs.readFileSync(
        path.join(__dirname, '..', 'services', 'faregas-pagos.service.js'), 'utf8');
    assert.match(fuente, /certificado\.cliente_id \|\| null/);
});

test('15. fg_operacion_comercial.cliente_id sigue siendo FK al maestro', async (t) => {
    if (!USA_BASE_DE_DATOS) return t.skip(SIN_BASE);
    const r = await db.query(`
        SELECT pg_get_constraintdef(oid) AS def
        FROM pg_constraint
        WHERE conrelid = 'fg_operacion_comercial'::regclass
          AND contype = 'f' AND confrelid = 'fg_cliente'::regclass
          AND array_length(conkey, 1) = 1
    `);
    assert.equal(r.rowCount, 1, 'debe existir la FK cliente_id -> fg_cliente');
    assert.match(r.rows[0].def, /fg_cliente/);
});

test.after(() => db.end());
