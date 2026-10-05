const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const USA_BASE_DE_DATOS = process.env.FAREGAS_TEST_DB === '1';
// Antes de tocar el pool: con NODE_ENV=test la carga automática de .env se
// salta, y sin esto el pool intenta conectarse con el usuario del sistema.
if (USA_BASE_DE_DATOS) {
    require('../../../config/env-loader').loadEnv(true);
}

const db = require('../../../config/database');
const validacion = require('../services/faregas-usuarios-validacion.service');
const usuariosService = require('../services/faregas-usuarios.service');

const SERVICIO = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'faregas-usuarios-validacion.service.js'), 'utf8');
const USUARIOS = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'faregas-usuarios.service.js'), 'utf8');
const CONTROLLER = fs.readFileSync(
    path.join(__dirname, '..', 'controllers', 'faregas-usuarios.controller.js'), 'utf8');

/**
 * VALIDACIÓN DE DATOS DE USUARIO — capa autoritativa.
 *
 * El defecto que estos tests fijan: el formulario comparaba el tipo de documento
 * contra `'01'` (DNI) y `'06'` (RUC), pero el catálogo real de
 * `tipodocumentoidentidad` usa claves de texto:
 *
 *     dni · ruc · pasaporte · carnetextranjeria · sindni
 *
 * Esas claves nunca existieron, así que la condición jamás era verdadera y un
 * DNI de 12 dígitos pasaba. Y el backend no validaba nada: insertaba el
 * documento tal cual, así que una llamada directa a la API se saltaba todo.
 *
 * Los MISMOS casos están fijados en el frontend
 * (`usuariosValidacion.test.ts`): las dos capas no pueden divergir.
 */

const BASE = {
    username: 'jperez',
    tipoDocumentoKey: 'dni',
    nroDocumento: '74045612',
    nombres: 'José Luis',
    apellidos: 'Muñoz',
    password: 'Secreto123',
    confirmPassword: 'Secreto123',
    paisKey: 'PE',
    departamentoKey: '15',
    provinciaKey: '1501',
    distritoKey: '150101',
    direccion: 'Av. Javier Prado N° 123',
    telefono: '971653847',
    email: 'jperez@farenet.pe'
};

const crear = (cambios = {}) => ({ ...BASE, ...cambios });

const MARCA = `VALIDA_${Date.now()}`;

// ===========================================================================
// 1. Las reglas salen del catálogo real
// ===========================================================================

test('1. las reglas cubren exactamente los tipos del catálogo', () => {
    for (const tipo of ['dni', 'ruc', 'pasaporte', 'carnetextranjeria', 'sindni']) {
        assert.ok(validacion.REGLAS_DOCUMENTO[tipo], `falta la regla de ${tipo}`);
    }
    // Y no hay reglas inventadas para tipos que el catálogo no tiene.
    assert.equal(Object.keys(validacion.REGLAS_DOCUMENTO).length, 5);
});

test('2. DNI: 8 dígitos, y nada más', () => {
    assert.equal(validacion.validarDocumento('dni', '74045612'), null);
    assert.equal(validacion.validarDocumento('dni', '7404561'),
        'El DNI debe contener exactamente 8 dígitos.');
    assert.equal(validacion.validarDocumento('dni', '740456123'),
        'El DNI debe contener exactamente 8 dígitos.');
    // El caso reportado: 12 dígitos.
    assert.equal(validacion.validarDocumento('dni', '434344344344'),
        'El DNI debe contener exactamente 8 dígitos.');
    assert.equal(validacion.validarDocumento('dni', 'ABC45612'),
        'El DNI debe contener solamente dígitos.');
    assert.equal(validacion.validarDocumento('dni', '74 045612'),
        'El DNI debe contener solamente dígitos.');
});

test('3. RUC: 11 dígitos', () => {
    assert.equal(validacion.validarDocumento('ruc', '20600444531'), null);
    assert.equal(validacion.validarDocumento('ruc', '2060044453'),
        'El RUC debe contener exactamente 11 dígitos.');
    assert.equal(validacion.validarDocumento('ruc', '206004445311'),
        'El RUC debe contener exactamente 11 dígitos.');
    assert.equal(validacion.validarDocumento('ruc', '2060044453a'),
        'El RUC debe contener solamente dígitos.');
});

test('4. pasaporte, CE y SIN DNI no reciben la regla del DNI', () => {
    // El modelo no define longitud para ellos, así que no se inventa ninguna.
    for (const tipo of ['pasaporte', 'carnetextranjeria', 'sindni']) {
        assert.equal(validacion.REGLAS_DOCUMENTO[tipo].longitud, null, `${tipo} no debe tener longitud fija`);
        assert.equal(validacion.validarDocumento(tipo, 'AB1234'), null);
        assert.equal(validacion.validarDocumento(tipo, 'X1'), null);
    }
    // La columna es la cota superior, no una regla del tipo.
    assert.equal(validacion.DOCUMENTO_MAXIMO, 20);
    assert.equal(validacion.validarDocumento('pasaporte', 'A'.repeat(21)),
        'El Pasaporte no puede superar los 20 caracteres.');
});

test('5. nombres: letras, tildes, ñ, apóstrofo y guion; nada más', () => {
    assert.equal(validacion.validarNombre('José Luis', 'nombre'), null);
    assert.equal(validacion.validarNombre('García-López', 'apellido'), null);
    assert.equal(validacion.validarNombre("O'Connor", 'apellido'), null);
    assert.equal(validacion.validarNombre('De la Cruz', 'apellido'), null);
    assert.match(validacion.validarNombre('12345', 'nombre'), /sólo admite letras/);
    assert.match(validacion.validarNombre('@@@', 'nombre'), /sólo admite letras/);
    assert.match(validacion.validarNombre('fff123', 'nombre'), /sólo admite letras/);
    assert.equal(validacion.validarNombre('   ', 'nombre'), 'El nombre es obligatorio.');
    // El trim es de ida y vuelta: "  Bruno  " vale.
    assert.equal(validacion.validarNombre('  Bruno  ', 'nombre'), null);
});

test('6. username: trim y rechazo de sólo espacios', () => {
    assert.equal(validacion.validarDatosUsuario(crear({ username: '' }), { modo: 'crear' }).ok, false);
    assert.equal(validacion.validarDatosUsuario(crear({ username: '   ' }), { modo: 'crear' }).ok, false);
    assert.equal(validacion.validarDatosUsuario(crear({ username: '  jperez  ' }), { modo: 'crear' }).ok, true);
});

// ===========================================================================
// 2. Validación de un formulario completo
// ===========================================================================

test('7. un usuario válido pasa sin errores', () => {
    const resultado = validacion.validarDatosUsuario(crear(), { modo: 'crear' });
    assert.deepEqual(resultado.errores, {});
    assert.equal(resultado.ok, true);
});

test('8. email: formato real, y sigue siendo opcional', () => {
    assert.equal(validacion.validarDatosUsuario(crear({ email: 'usuario@empresa.com' }), { modo: 'crear' }).ok, true);
    assert.equal(validacion.validarDatosUsuario(crear({ email: 'd@gmail.com' }), { modo: 'crear' }).ok, true);
    assert.equal(validacion.validarDatosUsuario(crear({ email: '' }), { modo: 'crear' }).ok, true,
        'el email es opcional en el modelo');
    for (const malo of ['d@gmail', '@@gmail.com', 'usuario']) {
        assert.equal(validacion.validarDatosUsuario(crear({ email: malo }), { modo: 'crear' }).errores.email,
            'El email no tiene un formato válido.', `debería rechazar ${malo}`);
    }
});

test('9. teléfono: sin letras, sin fijar 9 dígitos', () => {
    assert.equal(validacion.validarDatosUsuario(crear({ telefono: '971653847' }), { modo: 'crear' }).ok, true);
    assert.equal(validacion.validarDatosUsuario(crear({ telefono: '01-3456789' }), { modo: 'crear' }).ok, true,
        'un fijo con prefijo es válido: no se imponen 9 dígitos');
    assert.match(validacion.validarDatosUsuario(crear({ telefono: '97165abc' }), { modo: 'crear' }).errores.telefono,
        /sólo admite/);
});

test('10. dirección: trim, obligatoria, sin regex absurda', () => {
    for (const direccion of ['Av. Javier Prado N° 123', 'Mz. A Lt. 4', 'Jr. Los Próceres 450']) {
        assert.equal(validacion.validarDatosUsuario(crear({ direccion }), { modo: 'crear' }).ok, true, direccion);
    }
    assert.equal(validacion.validarDatosUsuario(crear({ direccion: '' }), { modo: 'crear' }).errores.direccion,
        'La dirección es obligatoria.');
    assert.equal(validacion.validarDatosUsuario(crear({ direccion: '     ' }), { modo: 'crear' }).errores.direccion,
        'La dirección es obligatoria.');
});

test('11. ubicación: los cuatro niveles son obligatorios', () => {
    for (const campo of ['paisKey', 'departamentoKey', 'provinciaKey', 'distritoKey']) {
        const resultado = validacion.validarDatosUsuario(crear({ [campo]: '' }), { modo: 'crear' });
        assert.ok(resultado.errores[campo], `${campo} debe ser obligatorio`);
    }
});

test('12. contraseña: la política real del sistema, que no tiene ninguna', () => {
    // El login sólo compara bcrypt: no se inventa un mínimo ni una complejidad.
    assert.equal(validacion.validarDatosUsuario(
        crear({ password: 'a', confirmPassword: 'a' }), { modo: 'crear' }).ok, true);
    assert.equal(validacion.validarDatosUsuario(
        crear({ password: '', confirmPassword: '' }), { modo: 'crear' }).errores.password,
        'La contraseña es obligatoria.');
    assert.equal(validacion.validarDatosUsuario(
        crear({ password: 'Secreto123', confirmPassword: 'Otra' }), { modo: 'crear' }).errores.confirmPassword,
        'Las contraseñas no coinciden.');
    // En editar, vacía significa "no cambiar": el comportamiento previo.
    assert.equal(validacion.validarDatosUsuario(
        crear({ password: '', confirmPassword: '' }), { modo: 'editar' }).errores.password, undefined);
});

test('13. con RUC se pide razón social; con documento personal, nombres', () => {
    const conRuc = crear({ tipoDocumentoKey: 'ruc', nroDocumento: '20600444531', nombreRazonSocial: 'FAREGAS SAC' });
    assert.equal(validacion.validarDatosUsuario(conRuc, { modo: 'crear' }).ok, true);
    // Sin razón social no pasa, aunque mande nombres.
    assert.equal(validacion.validarDatosUsuario(
        crear({ tipoDocumentoKey: 'ruc', nroDocumento: '20600444531' }), { modo: 'crear' }).errores.nombreRazonSocial,
        'La razón social es obligatoria.');
});

test('14. el primer error es el más arriba de la pantalla', () => {
    const resultado = validacion.validarDatosUsuario(
        crear({ username: '', nroDocumento: '1', direccion: '' }), { modo: 'crear' });
    assert.equal(resultado.primerCampo, 'username');
    assert.ok(validacion.ORDEN_ERRORES.indexOf('username')
        < validacion.ORDEN_ERRORES.indexOf('nroDocumento'));
    assert.ok(validacion.ORDEN_ERRORES.indexOf('nroDocumento')
        < validacion.ORDEN_ERRORES.indexOf('direccion'));
});

test('15. los datos normalizados son los que se guardan', () => {
    const { datos } = validacion.validarDatosUsuario(
        crear({ username: '  jperez  ', nroDocumento: '74 045 612', nombres: '  Bruno  ' }), { modo: 'crear' });
    assert.equal(datos.username, 'jperez');
    assert.equal(datos.nroDocumento, '74045612');
    assert.equal(datos.nombres, 'Bruno');
});

// ===========================================================================
// 3. La escritura no se puede saltar por API
// ===========================================================================

test('16. crearUsuario rechaza un DNI de 12 dígitos sin tocar la base', async () => {
    const original = db.connect;
    let abrioTransaccion = false;
    db.connect = async () => { abrioTransaccion = true; throw new Error('no debe llegar a la base'); };
    try {
        await assert.rejects(
            () => usuariosService.crearUsuario(crear({ nroDocumento: '434344344344', username: MARCA }), 'SISTEMAS'),
            (error) => {
                assert.equal(error.code, 'DATOS_USUARIO_INVALIDOS');
                assert.equal(error.statusCode, 400);
                assert.equal(error.message, 'El DNI debe contener exactamente 8 dígitos.');
                assert.equal(error.errores.nroDocumento, 'El DNI debe contener exactamente 8 dígitos.');
                return true;
            }
        );
        assert.equal(abrioTransaccion, false, 'la validación ocurre antes de abrir la transacción');
    } finally { db.connect = original; }
});

test('17. actualizarUsuario rechaza lo mismo que crearUsuario', async () => {
    const original = db.connect;
    db.connect = async () => { throw new Error('no debe llegar a la base'); };
    try {
        await assert.rejects(
            () => usuariosService.actualizarUsuario('bruno',
                crear({ nroDocumento: '434344344344', password: '', confirmPassword: '' }), 'SISTEMAS'),
            (error) => error.code === 'DATOS_USUARIO_INVALIDOS'
        );
    } finally { db.connect = original; }
});

test('18. el controller traduce el rechazo a 400 con el detalle por campo', () => {
    // Sin esto el frontend recibiría un 500 y el mensaje se perdería.
    assert.match(CONTROLLER, /if \(e\.code === 'DATOS_USUARIO_INVALIDOS'\)[\s\S]{0,120}res\.status\(400\)\.json\(\{ message: e\.message, errores: e\.errores \}\)/g);
});

test('19. el servicio usa los datos validados, no los que llegaron', () => {
    // Si se guardara `data.nroDocumento` sin pasar por la validación, el trim y
    // la normalización a dígitos no se aplicarían nunca.
    assert.match(USUARIOS, /validacion\.exigirDatosValidos\(data, \{ modo: 'crear' \}\)/);
    assert.match(USUARIOS, /validacion\.exigirDatosValidos\(data, \{ modo: 'editar' \}\)/);
    assert.doesNotMatch(USUARIOS, /INSERT INTO persona[\s\S]{0,900}?\], \[\s*nroDocumento, tipoDocumentoKey, nombres/,
        'el insert debe usar los valores ya normalizados');
});

// ===========================================================================
// 4. Coherencia con el frontend y con el modelo
// ===========================================================================

test('20. las dos capas declaran las mismas reglas y el mismo texto', () => {
    const frontend = fs.readFileSync(
        path.join(__dirname, '..', '..', '..', '..', 'farenetFrontend', 'src', 'modules', 'faregas',
            'views', 'Usuarios', 'usuariosValidacion.ts'), 'utf8');

    // Los mensajes se arman con la misma plantilla en las dos capas; lo que se
    // compara es el texto que sale, no la línea de código.
    assert.equal(validacion.validarDocumento('dni', '1'),
        'El DNI debe contener exactamente 8 dígitos.');
    assert.equal(validacion.validarDocumento('ruc', '1'),
        'El RUC debe contener exactamente 11 dígitos.');
    assert.equal(validacion.validarDatosUsuario(crear({ password: 'a', confirmPassword: 'b' }), { modo: 'crear' })
        .errores.confirmPassword, 'Las contraseñas no coinciden.');
    assert.equal(validacion.validarDatosUsuario(crear({ email: 'd@gmail' }), { modo: 'crear' }).errores.email,
        'El email no tiene un formato válido.');
    assert.equal(validacion.validarDatosUsuario(crear({ direccion: '' }), { modo: 'crear' }).errores.direccion,
        'La dirección es obligatoria.');

    // Y el frontend declara las mismas longitudes y el mismo textobase, para
    // que el mensaje que ve el operador sea el mismo venga de donde venga.
    assert.match(frontend, /dni:\s*\{\s*longitud:\s*8,/);
    assert.match(frontend, /ruc:\s*\{\s*longitud:\s*11,/);
    assert.match(frontend, /longitud:\s*null,\s*soloDigitos:\s*false/);
    assert.match(frontend, /debe contener exactamente \$\{regla\.longitud\} dígitos\./);
    assert.match(frontend, /Las contraseñas no coinciden\./);
    assert.match(frontend, /El email no tiene un formato válido\./);
    assert.match(frontend, /La dirección es obligatoria\./);
});

test('21. las longitudes coinciden con el ancho real de las columnas', () => {
    // No son números inventados: salen de persona y fg_usuario.
    assert.equal(validacion.NOMBRE_MAXIMO, 200);      // persona.nombres / apellidos
    assert.equal(validacion.DOCUMENTO_MAXIMO, 20);    // persona.nrodocumentoidentidad
    assert.equal(validacion.TELEFONO_MAXIMO, 100);    // persona.telefono
    assert.match(SERVICIO, /persona\.nrodocumentoidentidad.*varchar\(20\)/);
});

test('22. no se toca autenticación, permisos, perfiles ni sedes', () => {
    // La validación vive en su propio archivo y sólo se invoca desde
    // crear/editar usuario. No aparece en el login ni en los perfiles.
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'services', 'faregas-auth.service.js'), 'utf8'),
        /faregas-usuarios-validacion/);
    assert.doesNotMatch(SERVICIO, /perfil|permiso|fg_perfil_planta|MENU_/i,
        'la validación de datos no debe conocer permisos ni perfiles');
    // El perfil y las sedes se siguen usando exactamente igual.
    assert.match(USUARIOS, /fg_perfil_planta/);
    assert.match(USUARIOS, /INSERT INTO fg_usuario_planta/);
});

test.after(() => db.end());