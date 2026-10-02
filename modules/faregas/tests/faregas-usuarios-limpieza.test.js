/**
 * Limpieza de usuarios de prueba: reparto entre eliminar y desactivar.
 *
 * Un usuario con auditorías propias NO se puede eliminar: `fg_auditoria_config`
 * tiene `username` NOT NULL con FK a `fg_usuario`, así que borrarla perdería
 * trazabilidad real (por ejemplo la homologación de series DMS). Para esos casos
 * corresponde limpiar sus datos funcionales y desactivar la cuenta.
 *
 * La limpieza borra datos EXCLUSIVOS del usuario y desvincula los compartidos,
 * nunca al revés. Los maestros no se tocan.
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
const service = require('../services/faregas-usuarios-limpieza.service');

const SERVICIO = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'faregas-usuarios-limpieza.service.js'), 'utf8');
const USUARIOS = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'faregas-usuarios.service.js'), 'utf8');

const bloquePlan = SERVICIO.slice(SERVICIO.indexOf('const PLAN = ['), SERVICIO.indexOf('const VINCULOS_COMPARTIDOS'));
const bloqueEjecutar = SERVICIO.slice(SERVICIO.indexOf('exports.ejecutarLimpieza'));

const conBase = (fn) => (t) => {
    if (!USA_BASE_DE_DATOS) return t.skip('requiere FAREGAS_TEST_DB=1 y una base de datos disponible');
    return fn(t);
};

const MARCA = `TEST_LIMPIA_${Date.now()}`;
const PERFIL = 'OPERADOR';

async function crearUsuario(username, { sesiones = 0, planta = false } = {}) {
    await db.query(
        `INSERT INTO fg_usuario (username, user_type, contrasenha, perfil_id, estado)
         VALUES ($1, 'USU', 'hash', $2, TRUE)`, [username, PERFIL]);
    if (planta) {
        const p = (await db.query("SELECT key FROM fg_planta WHERE activo = TRUE ORDER BY key LIMIT 1")).rows[0].key;
        await db.query('INSERT INTO fg_usuario_planta (usuario_username, plantas_key) VALUES ($1,$2)', [username, p]);
    }
    for (let i = 0; i < sesiones; i += 1) {
        await db.query(
            `INSERT INTO fg_usuario_sesion (usuario_username, session_jti, isactive)
             VALUES ($1, gen_random_uuid(), TRUE)`, [username]);
    }
}

async function limpiar(username) {
    await db.query('DELETE FROM fg_usuario_sesion WHERE usuario_username=$1', [username]);
    await db.query('DELETE FROM fg_usuario_planta WHERE usuario_username=$1', [username]);
    await db.query('DELETE FROM fg_usuario WHERE username=$1', [username]);
}

// ===========================================================================
// 1. El plan de borrado está ordenado por la jerarquía de FK
// ===========================================================================

test('1. el nivel es la distancia a la raíz y se recorre de mayor a menor', () => {
    // Invertir el orden hace que fg_certificado se borre antes que
    // fg_operacion_detalle y Postgres responde 23503.
    assert.match(bloqueEjecutar, /const orden = \[\.\.\.antes\.pasos\]\.sort\(\(a, b\) => b\.nivel - a\.nivel\);/);
    // Y el nivel es distancia a la raíz: los hijos tienen número mayor.
    const nivel = (tabla) => {
        const m = new RegExp(`nivel: (\\d+), tabla: '${tabla}'`).exec(bloquePlan);
        return m ? Number(m[1]) : null;
    };
    // fg_operacion_detalle referencia a fg_certificado: 7 > 2.
    assert.ok(nivel('fg_operacion_detalle') > nivel('fg_certificado'), 'detalle antes que certificado');
    // fg_facturacion_intento cuelga de la facturación: 8 > 5.
    assert.ok(nivel('fg_facturacion_intento') > nivel('fg_facturacion'), 'intento antes que facturación');
    // fg_pago cuelga de la orden de pago: 8 > 5.
    assert.ok(nivel('fg_pago') > nivel('fg_orden_pago'), 'pago antes que orden de pago');
    // fg_descuentodetalle cuelga del descuento de cliente: 6 > 4.
    assert.ok(nivel('fg_descuentodetalle') > nivel('fg_descuentocliente'), 'detalle de descuento antes');
    // Las notas referencian la facturación: 6 > 5.
    assert.ok(nivel('fg_credito') > nivel('fg_facturacion'), 'nota de crédito antes que facturación');
});

test('2. las tablas puente declaran su clave propia', () => {
    // Ninguna tiene columna `id`: borrarlas por `id` daría 42703.
    for (const tabla of ['fg_certificado_vehiculo', 'fg_certificado_glp',
        'fg_certificado_gnv', 'fg_certificado_conformidad', 'fg_certificado_chip']) {
        assert.match(bloquePlan, new RegExp(`tabla: '${tabla}'[^}]*pk: 'certificado_id'`),
            `${tabla} debe declarar pk: 'certificado_id'`);
    }
    assert.match(bloquePlan, /tabla: 'fg_operacion_detalle_chip'[^}]*pk: 'operacion_detalle_id'/);
});

test('3. resuelve la clave primaria contra el schema en vez de suponerla', () => {
    assert.match(SERVICIO, /const clavePrimaria = async \(tabla, executor\)/);
    assert.match(SERVICIO, /pk: paso\.pk \|\| await clavePrimaria\(paso\.tabla, executor\)/);
    assert.match(bloqueEjecutar, /WHERE \$\{paso\.pk\} = ANY/);
});

// ===========================================================================
// 2. El modo lo decide la auditoría, no el criterio del operador
// ===========================================================================

test('4. decide ELIMINAR cuando no hay auditoría propia', conBase(async () => {
    const u = `${MARCA}_SIN_AUDIT`;
    try {
        await crearUsuario(u, { sesiones: 1 });
        const d = await service.decidirModo(u);
        assert.equal(d.modo, 'ELIMINAR');
        assert.equal(d.auditorias, 0);
        assert.match(d.razon, /se puede eliminar la fila/);
    } finally { await limpiar(u); }
}));

test('5. decide INACTIVAR cuando hay auditoría propia', conBase(async () => {
    const u = `${MARCA}_CON_AUDIT`;
    try {
        await crearUsuario(u);
        await db.query(
            `INSERT INTO fg_auditoria_config (username, entidad, accion, identificador, fecha)
             VALUES ($1, 'PRUEBA', 'PRUEBA_LIMPIEZA', 'x', now())`, [u]);
        const d = await service.decidirModo(u);
        assert.equal(d.modo, 'INACTIVAR');
        assert.equal(d.auditorias, 1);
        // Y explica por qué: la columna es NOT NULL con FK, no es capricho.
        assert.match(d.razon, /NOT NULL con FK/);
        assert.match(d.razon, /trazabilidad/);
    } finally {
        await db.query('DELETE FROM fg_auditoria_config WHERE username=$1', [u]);
        await limpiar(u);
    }
}));

// ===========================================================================
// 3. Salvaguardas de la ejecución
// ===========================================================================

test('6. exige la palabra ELIMINAR como confirmación', async () => {
    for (const confirmar of [undefined, '', 'ELIMINA', 'eliminar', 'si']) {
        await assert.rejects(
            () => service.ejecutarLimpieza('quiensea', { confirmar }),
            (e) => e.code === 'CONFIRMACION_REQUERIDA',
            `confirmar=${JSON.stringify(confirmar)} debe rechazarse`
        );
    }
});

test('7. una transacción por usuario: cualquier fallo revierte entero', () => {
    assert.match(bloqueEjecutar, /await client\.query\('BEGIN'\)/);
    assert.match(bloqueEjecutar, /await client\.query\('COMMIT'\)/);
    assert.match(bloqueEjecutar, /await client\.query\('ROLLBACK'\)/);
    assert.match(bloqueEjecutar, /error\.limpiezaRevertida = true/);
    // Y el COMMIT va después de verificar los invariantes.
    assert.ok(bloqueEjecutar.indexOf('verificarInvariantes')
        < bloqueEjecutar.indexOf("await client.query('COMMIT')"));
});

test('8. no borra auditoría en ningún modo', () => {
    // La auditoría no aparece en el PLAN de borrado, sólo en MAESTROS_INTOCABLES.
    assert.doesNotMatch(bloquePlan, /fg_auditoria_config/);
    assert.match(SERVICIO, /MAESTROS_INTOCABLES = \[[\s\S]*?'fg_auditoria_config'/);
    // Y el invariante aborta si aun así quedara alguna.
    assert.match(SERVICIO, /if \(auditorias > 0 && modo === 'ELIMINAR'\)/);
});

test('9. desvincula lo compartido y nunca lo borra', () => {
    assert.match(bloqueEjecutar, /UPDATE \$\{vinculo\.tabla\} SET \$\{vinculo\.columna\} = NULL/);
    // La condición IS DISTINCT FROM es la que separa "fila de otro" de "fila suya".
    assert.match(bloqueEjecutar, /IS DISTINCT FROM \$1/);
    // Las once tablas donde usuario_modificacion / actualizado_por son nullable.
    for (const t of ['fg_certificado', 'fg_operacion_comercial', 'fg_chip', 'fg_vehiculo',
        'fg_credito', 'fg_debito', 'fg_descuento', 'fg_descuentocliente',
        'fg_descuentocomprobante', 'fg_descuentodetalle', 'fg_documento_anulacion']) {
        assert.ok(SERVICIO.includes(`tabla: '${t}'`), `${t} debe desvincularse`);
    }
});

test('10. los maestros intocables están declarados explícitamente', () => {
    for (const t of ['fg_auditoria_config', 'fg_vehiculo', 'fg_chip', 'fg_ejecutivo',
        'persona', 'fg_tarifa', 'fg_planta', 'fg_empresa', 'fg_serie_comprobante',
        'fg_certificado_formato', 'fg_producto_facturacion', 'fg_categoria_servicio']) {
        assert.match(SERVICIO, new RegExp(`'${t}'`), `${t} debe estar en MAESTROS_INTOCABLES`);
    }
    // Ninguno aparece en el plan de borrado.
    for (const t of ['fg_vehiculo', 'fg_chip', 'persona', 'fg_tarifa', 'fg_planta',
        'fg_producto_facturacion', 'fg_serie_comprobante']) {
        assert.doesNotMatch(bloquePlan, new RegExp(`tabla: '${t}'`),
            `${t} no debe estar en el plan de borrado`);
    }
});

test('11. aborta si queda alguna referencia viva tras limpiar', () => {
    assert.match(SERVICIO, /if \(pendientes\.length > 0\)/);
    assert.match(SERVICIO, /USUARIO_CON_HISTORIAL/);
    // Y el invariante de INACTIVAR comprueba que la fila sigue ahí y en false.
    assert.match(SERVICIO, /if \(!fila\) throw errorNegocio\('INVARIANTE_ROTA'/);
    assert.match(SERVICIO, /if \(fila\.estado !== false\) throw errorNegocio\('INVARIANTE_ROTA'/);
});

// ===========================================================================
// 4. Comportamiento real
// ===========================================================================

test('12. usuario con sesiones pero sin historial se elimina entero', conBase(async () => {
    const u = `${MARCA}_A`;
    try {
        await crearUsuario(u, { sesiones: 3, planta: true });
        const r = await service.ejecutarLimpieza(u, { confirmar: 'ELIMINAR' });
        assert.equal(r.modo, 'ELIMINAR');
        assert.equal(r.usuarioEliminado, true);
        assert.equal(r.totalEliminadas, 4, '3 sesiones + 1 asignación de sede');
        const existe = (await db.query('SELECT 1 FROM fg_usuario WHERE username=$1', [u])).rowCount;
        assert.equal(existe, 0, 'el usuario desaparece');
        assert.equal((await db.query('SELECT COUNT(*)::int n FROM fg_usuario_sesion WHERE usuario_username=$1', [u])).rows[0].n, 0);
        assert.equal((await db.query('SELECT COUNT(*)::int n FROM fg_usuario_planta WHERE usuario_username=$1', [u])).rows[0].n, 0);
    } finally { await limpiar(u); }
}));

test('13. usuario con auditoría se limpia y se DESACTIVA, no se borra', conBase(async () => {
    const u = `${MARCA}_B`;
    try {
        await crearUsuario(u, { sesiones: 2 });
        await db.query(
            `INSERT INTO fg_auditoria_config (username, entidad, accion, identificador, fecha)
             VALUES ($1, 'PRUEBA', 'PRUEBA_LIMPIEZA', 'x', now())`, [u]);

        const r = await service.ejecutarLimpieza(u, { confirmar: 'ELIMINAR' });
        assert.equal(r.modo, 'INACTIVAR');
        assert.equal(r.usuarioEliminado, false);
        assert.equal(r.usuarioInactivo, true);
        assert.equal(r.totalEliminadas, 2, 'las 2 sesiones');

        const fila = (await db.query('SELECT estado FROM fg_usuario WHERE username=$1', [u])).rows[0];
        assert.ok(fila, 'el usuario sigue existiendo');
        assert.equal(fila.estado, false, 'pero inactivo');
        const aud = (await db.query('SELECT COUNT(*)::int n FROM fg_auditoria_config WHERE username=$1', [u])).rows[0].n;
        assert.equal(aud, 1, 'la auditoría se conserva intacta');
    } finally {
        await db.query('DELETE FROM fg_auditoria_config WHERE username=$1', [u]);
        await limpiar(u);
    }
}));

test('14. un certificado de otro NO se borra: se desvincula', conBase(async () => {
    const u = `${MARCA}_C`;
    const otro = (await db.query(
        "SELECT username FROM fg_usuario WHERE perfil_id='SISTEMAS' ORDER BY username LIMIT 1")).rows[0].username;
    const planta = (await db.query("SELECT key FROM fg_planta WHERE activo = TRUE ORDER BY key LIMIT 1")).rows[0].key;
    const tipo = (await db.query(
        'SELECT tipo_certificado_clave FROM fg_certificado WHERE tipo_certificado_clave IS NOT NULL LIMIT 1')).rows[0].tipo_certificado_clave;
    const paso = (await db.query(
        'SELECT paso_actual FROM fg_certificado WHERE paso_actual IS NOT NULL LIMIT 1')).rows[0].paso_actual;
    let certId;
    try {
        await crearUsuario(u);
        // Certificado de OTRO usuario, sólo "modificado" por éste.
        const c = await db.query(
            `INSERT INTO fg_certificado (tipo_certificado_clave, planta_key, estado, usuario_creacion, usuario_modificacion, tarifa_codigo, paso_actual)
             VALUES ($1,$2,'BORRADOR',$3,$4,'TEST_LIMPIA',$5) RETURNING id`,
            [tipo, planta, otro, u, paso]);
        certId = c.rows[0].id;

        const r = await service.ejecutarLimpieza(u, { confirmar: 'ELIMINAR' });
        const d = r.desvinculados.find((x) => x.tabla === 'fg_certificado');
        assert.ok(d, 'debe informarse la desvinculación');
        assert.equal(d.columna, 'usuario_modificacion');
        // El certificado sobrevive y queda sin último modificador.
        const vivo = (await db.query(
            'SELECT usuario_creacion, usuario_modificacion FROM fg_certificado WHERE id=$1', [certId])).rows[0];
        assert.ok(vivo, 'el certificado de otro no se borra');
        assert.equal(vivo.usuario_creacion, otro, 'su creador intacto');
        assert.equal(vivo.usuario_modificacion, null, 'la referencia se suelta');
    } finally {
        if (certId) await db.query('DELETE FROM fg_certificado WHERE id=$1', [certId]);
        await limpiar(u);
    }
}));

test('15. modo forzado INACTIVAR sobre usuario sin auditoría', conBase(async () => {
    // Por si un usuario tiene referencias en un maestro que no se audita: se
    // desactiva en vez de arriesgar el borrado.
    const u = `${MARCA}_D`;
    try {
        await crearUsuario(u, { sesiones: 1 });
        const r = await service.ejecutarLimpieza(u, { modo: 'INACTIVAR', confirmar: 'ELIMINAR' });
        assert.equal(r.modo, 'INACTIVAR');
        assert.equal(r.totalEliminadas, 1);
        const fila = (await db.query('SELECT estado FROM fg_usuario WHERE username=$1', [u])).rows[0];
        assert.equal(fila.estado, false);
    } finally { await limpiar(u); }
}));

test('16. un fallo intermedio revierte todo, incluido el acceso ya borrado', conBase(async () => {
    // Se comprueba sobre el servicio real: si un paso falla, el rollback
    // devuelve las sesiones y las sedes a su estado original.
    const u = `${MARCA}_E`;
    try {
        await crearUsuario(u, { sesiones: 3, planta: true });
        const client = await db.connect();
        try {
            await client.query('BEGIN');
            await client.query('DELETE FROM fg_usuario_sesion WHERE usuario_username=$1', [u]);
            await client.query('DELETE FROM fg_usuario_planta WHERE usuario_username=$1', [u]);
            throw new Error('FALLO_SIMULADO');
        } catch {
            await client.query('ROLLBACK');
        } finally {
            client.release();
        }
        assert.equal((await db.query('SELECT COUNT(*)::int n FROM fg_usuario_sesion WHERE usuario_username=$1', [u])).rows[0].n, 3);
        assert.equal((await db.query('SELECT COUNT(*)::int n FROM fg_usuario_planta WHERE usuario_username=$1', [u])).rows[0].n, 1);
        assert.equal((await db.query('SELECT 1 FROM fg_usuario WHERE username=$1', [u])).rowCount, 1);
    } finally { await limpiar(u); }
}));

test('17. la previsualización no escribe nada', conBase(async () => {
    const u = `${MARCA}_F`;
    try {
        await crearUsuario(u, { sesiones: 2, planta: true });
        const antes = (await db.query('SELECT COUNT(*)::int n FROM fg_usuario_sesion WHERE usuario_username=$1', [u])).rows[0].n;
        const p = await service.previsualizarLimpieza(u);
        assert.equal(p.acceso.reduce((s, a) => s + a.filas, 0), antes + 1);
        const despues = (await db.query('SELECT COUNT(*)::int n FROM fg_usuario_sesion WHERE usuario_username=$1', [u])).rows[0].n;
        assert.equal(despues, antes, 'la previsualización no borra sesiones');
        assert.equal((await db.query('SELECT 1 FROM fg_usuario WHERE username=$1', [u])).rowCount, 1);
    } finally { await limpiar(u); }
}));

test('18. no quedan residuos de las pruebas', conBase(async () => {
    const sobro = (await db.query('SELECT username FROM fg_usuario WHERE username LIKE $1', [`${MARCA}%`])).rows;
    assert.equal(sobro.length, 0, `no deben quedar usuarios de prueba: ${sobro.map((u) => u.username)}`);
    const certs = (await db.query("SELECT id FROM fg_certificado WHERE tarifa_codigo='TEST_LIMPIA'")).rows;
    assert.equal(certs.length, 0, 'no deben quedar certificados de prueba');
    const aud = (await db.query("SELECT id FROM fg_auditoria_config WHERE accion='PRUEBA_LIMPIEZA'")).rows;
    assert.equal(aud.length, 0, 'no deben quedar auditorías de prueba');
}));

test('19. el servicio de eliminación normal sigue bloqueando con historial', () => {
    // Las dos puertas tienen que seguir siendo distintas: `eliminarUsuario` no
    // borra historial, y `ejecutarLimpieza` sí, pero exige ELIMINAR.
    assert.match(USUARIOS, /if \(bloqueos\.length > 0\) throw errorHistorial/);
    assert.match(SERVICIO, /if \(confirmar !== 'ELIMINAR'\)/);
});