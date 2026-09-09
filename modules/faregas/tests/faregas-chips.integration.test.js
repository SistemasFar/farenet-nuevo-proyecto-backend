const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../../../config/database');
const service = require('../services/faregas-chips.service');

const user = { username: 'ramirez', perfil_id: 'OPERADOR' };

test.after(async () => db.end());

test('inventario chip: ingreso, concurrencia, transferencia, liberación y guards de venta', async (t) => {
    const marker = `CX${Date.now().toString(36).toUpperCase()}`;
    const chipA = `${marker}A`;
    const chipB = `${marker}B`;
    const operaciones = [];
    try {
        await t.test('ingreso y numero único', async () => {
            const creados = await service.ingresar({ plantaKey: '201', numeros: [chipA, chipB], referencia: marker }, user);
            assert.equal(creados.length, 2);
            await assert.rejects(
                service.ingresar({ plantaKey: '201', numeros: [chipA] }, user),
                error => error.message === 'CHIP_DUPLICADO'
            );
        });

        await t.test('stock por sede', async () => {
            const stock = await service.resumen('201', user);
            assert.ok(stock.disponibles >= 2);
            assert.equal(stock.precio, 180);
            assert.equal(stock.stockPermitido, true);
            assert.equal(stock.ventaHabilitada, false);
            assert.equal(stock.mappingFiscalCompleto, false);
        });

        await t.test('consulta de escáner reconoce un chip disponible en la sede', async () => {
            const disponibilidad = await service.consultarDisponibilidad({
                plantaKey: '201',
                numeroChip: chipA
            }, user);
            assert.equal(disponibilidad.encontrado, true);
            assert.equal(disponibilidad.disponible, true);
            assert.equal(disponibilidad.codigo, 'DISPONIBLE');
        });

        await t.test('transferencia y rechazo desde sede incorrecta', async () => {
            assert.equal(await service.transferir({ origenKey: '201', destinoKey: '190', numeros: [chipB], referencia: marker }, user), 1);
            await assert.rejects(
                service.transferir({ origenKey: '201', destinoKey: '190', numeros: [chipB] }, user),
                error => error.message === 'CHIP_OTRA_SEDE'
            );
            assert.equal(await service.transferir({ origenKey: '190', destinoKey: '201', numeros: [chipB], referencia: marker }, user), 1);
        });

        const crearOperacion = async () => {
            const r = await db.query(`INSERT INTO fg_operacion_comercial
                (planta_key,moneda_key,base_imponible,igv,importe_total,estado,usuario_creacion)
                VALUES('201','sol',152.54,27.46,180,'BORRADOR',$1) RETURNING id`, [user.username]);
            operaciones.push(r.rows[0].id); return r.rows[0].id;
        };

        await t.test('doble reserva concurrente entrega el chip a una sola operación', async () => {
            const op1 = await crearOperacion(); const op2 = await crearOperacion();
            const resultados = await Promise.allSettled([
                service.reservar({ plantaKey:'201', numeroChip:chipA, operacionId:op1 }, user),
                service.reservar({ plantaKey:'201', numeroChip:chipA, operacionId:op2 }, user)
            ]);
            assert.equal(resultados.filter(r => r.status === 'fulfilled').length, 1);
            assert.equal(resultados.filter(r => r.status === 'rejected' && r.reason.message === 'CHIP_NO_DISPONIBLE').length, 1);
            const ganador = resultados[0].status === 'fulfilled' ? op1 : op2;
            await service.liberar({ plantaKey:'201', numeroChip:chipA, operacionId:ganador, referencia:marker }, user);
        });

        await t.test('venta queda bloqueada mientras la sede no está habilitada para vender', async () => {
            const op = await crearOperacion();
            await service.reservar({ plantaKey:'201', numeroChip:chipA, operacionId:op }, user);
            await db.query("UPDATE fg_operacion_comercial SET estado='PAGADO' WHERE id=$1", [op]);
            await assert.rejects(
                service.vender({ plantaKey:'201', numeroChip:chipA, operacionId:op, detalleId:999999999 }, user),
                error => error.message === 'VENTA_CHIP_NO_HABILITADA'
            );
            await service.liberar({ plantaKey:'201', numeroChip:chipA, operacionId:op, referencia:marker }, user);
        });

        await t.test('TEST_P1 conserva registro pero no operación ni configuración Chip activa', async () => {
            const estado = await db.query(`
                SELECT p.activo AS planta_activa,
                       COALESCE(pis.activo, FALSE) AS configuracion_activa,
                       COALESCE(pis.stock_permitido, FALSE) AS stock_permitido,
                       COALESCE(pis.venta_habilitada, FALSE) AS venta_habilitada
                FROM fg_planta p
                LEFT JOIN fg_producto_inventariable pi ON pi.codigo = 'CHIP'
                LEFT JOIN fg_producto_inventariable_sede pis
                  ON pis.producto_inventariable_id = pi.id AND pis.planta_key = p.key
                WHERE p.key = 'TEST_P1'
            `);
            assert.equal(estado.rowCount, 1);
            assert.equal(estado.rows[0].planta_activa, false);
            assert.equal(estado.rows[0].configuracion_activa, false);
            assert.equal(estado.rows[0].stock_permitido, false);
            assert.equal(estado.rows[0].venta_habilitada, false);
        });

        await t.test('un chip vendido no se puede transferir y uno disponible sí puede darse de baja', async () => {
            await db.query("UPDATE fg_chip SET estado='VENDIDO' WHERE numero_chip=$1", [chipA]);
            await assert.rejects(
                service.transferir({ origenKey:'201', destinoKey:'190', numeros:[chipA] }, user),
                error => error.message === 'CHIP_NO_DISPONIBLE'
            );
            await db.query("UPDATE fg_chip SET estado='DISPONIBLE' WHERE numero_chip=$1", [chipA]);
            await service.baja({ plantaKey:'201', numeroChip:chipA, referencia:marker }, user);
            const fila = await db.query('SELECT estado FROM fg_chip WHERE numero_chip=$1', [chipA]);
            assert.equal(fila.rows[0].estado, 'BAJA');
        });
    } finally {
        const chips = await db.query('SELECT id FROM fg_chip WHERE numero_chip LIKE $1', [`${marker}%`]);
        const ids = chips.rows.map(r => r.id);
        if (ids.length) {
            await db.query('DELETE FROM fg_certificado_chip WHERE chip_id=ANY($1::bigint[])', [ids]);
            await db.query('DELETE FROM fg_operacion_detalle_chip WHERE chip_id=ANY($1::bigint[])', [ids]);
            await db.query('DELETE FROM fg_chip_movimiento WHERE chip_id=ANY($1::bigint[])', [ids]);
            await db.query('DELETE FROM fg_chip WHERE id=ANY($1::bigint[])', [ids]);
        }
        if (operaciones.length) await db.query('DELETE FROM fg_operacion_comercial WHERE id=ANY($1::bigint[])', [operaciones]);
    }
});
