/**
 * VALIDACIÓN DE DATOS DE USUARIO — autoritativa.
 *
 * El formulario ya tenía una comprobación de longitud para el documento, pero
 * comparaba contra claves que no existen: el catálogo real de
 * `tipodocumentoidentidad` usa `dni`, `ruc`, `pasaporte`, `carnetextranjeria` y
 * `sindni`, no `01` ni `06`. La condición nunca era verdadera, así que un DNI de
 * 12 dígitos pasaba. Aquí está la regla real, y el mismo juego de casos está
 * fijado en el frontend para que las dos capas coincidan.
 *
 * Reglas por tipo de documento, derivadas del catálogo real:
 *
 *   dni                 -> exactamente 8 dígitos, sólo numéricos.
 *   ruc                 -> exactamente 11 dígitos, sólo numéricos.
 *   pasaporte           -> el modelo NO fija longitud (en `persona` hay de 2 a 18
 *                          caracteres), así que no se inventa una: se exige
 *                          documento presente y se limita al ancho de la columna.
 *   carnetextranjeria   -> igual que pasaporte: sin longitud fija.
 *   sindni              -> igual, sin longitud fija.
 *
 * Las longitudes salen de `persona.nrodocumentoidentidad`, que es varchar(20).
 *
 * Contraseña: NO se inventa una política. El sistema no tiene ninguna —el login
 * sólo compara bcrypt— así que aquí sólo se exige que al crear haya contraseña y
 * que la confirmación coincida. En edición, vacía significa "no cambiar", que es
 * lo que ya hacía el formulario.
 */

const db = require('../../../config/database');

/** Ancho real de `persona.nrodocumentoidentidad` (varchar 20). */
const DOCUMENTO_MAXIMO = 20;
const NOMBRE_MAXIMO = 200; // persona.nombres / persona.apellidos
const DIRECCION_MAXIMA = 500;
const EMAIL_MAXIMO = 120;      // mas estricto que el varchar(150) de persona.email
const TELEFONO_MAXIMO = 9;    // exactamente 9 digitos, sin signos ni espacios
const USERNAME_MAXIMO = 255;  // fg_usuario.username

/**
 * Reglas de documento. `longitud` es null cuando el sistema no la define: en ese
 * caso no se impone ninguna, y el mensaje lo dice para que no parezca un olvido.
 */
const REGLAS_DOCUMENTO = Object.freeze({
    dni: { longitud: 8, soloDigitos: true, etiqueta: 'DNI' },
    ruc: { longitud: 11, soloDigitos: true, etiqueta: 'RUC' },
    pasaporte: { longitud: null, soloDigitos: false, etiqueta: 'Pasaporte' },
    carnetextranjeria: { longitud: null, soloDigitos: false, etiqueta: 'Carnet de extranjería' },
    sindni: { longitud: null, soloDigitos: false, etiqueta: 'Sin DNI' }
});

/** Nombres: letras (con tilde y ñ), espacios, apóstrofo y guion. Nada más. */
const RE_NOMBRE = /^[\p{L}\s'’-]+$/u;
/** Email opcional: un arroba, un dominio con punto y sin espacios. */
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/**
 * Teléfono de ESTE formulario: exactamente 9 dígitos. Sin letras, sin espacios
 * y sin signos: es el número celular que se guarda en `persona.telefono`.
 */
const RE_TELEFONO = /^\d{9}$/;
/** Username: lo que el formulario ya permitía; no se cambia la regla de acceso. */
const RE_USERNAME = /^[a-zA-Z0-9_.-]+$/;

const texto = (valor) => String(valor === null || valor === undefined ? '' : valor).trim();
const soloDigitos = (valor) => /^[0-9]+$/.test(valor);

/** Quita todo lo que no sea dígito. Se usa para el campo, no para validar. */
const normalizarSoloDigitos = (valor) => texto(valor).replace(/\D/g, '');

/**
 * Normalización del campo Teléfono: deja sólo dígitos y corta a 9, para que el
 * operador no pueda escribir de más. Guardar igual exige 9 exactos.
 */
const normalizarTelefono = (valor) => normalizarSoloDigitos(valor).slice(0, TELEFONO_MAXIMO);

/**
 * Valida el número de documento contra la regla de su tipo.
 * `sindni` no tiene documento que validar: se acepta cualquier texto presente.
 */
const validarDocumento = (tipoKey, valor) => {
    const documento = texto(valor);
    if (!documento) return 'Seleccione el número de documento.';
    const regla = REGLAS_DOCUMENTO[texto(tipoKey).toLowerCase()];
    if (!regla) return null; // tipo desconocido: no se inventa una regla
    if (regla.soloDigitos && !soloDigitos(documento)) {
        return `El ${regla.etiqueta} debe contener solamente dígitos.`;
    }
    if (regla.longitud !== null && documento.length !== regla.longitud) {
        return `El ${regla.etiqueta} debe contener exactamente ${regla.longitud} dígitos.`;
    }
    if (documento.length > DOCUMENTO_MAXIMO) {
        return `El ${regla.etiqueta} no puede superar los ${DOCUMENTO_MAXIMO} caracteres.`;
    }
    return null;
};

/** Nombre o apellido. Trim, no vacío, no sólo espacios, caracteres y largo. */
const validarNombre = (valor, etiqueta) => {
    const nombre = texto(valor);
    if (!nombre) return `El ${etiqueta} es obligatorio.`;
    if (!RE_NOMBRE.test(nombre)) {
        return `El ${etiqueta} sólo admite letras, espacios, apóstrofos y guiones.`;
    }
    if (nombre.length < 2) return `El ${etiqueta} debe tener al menos 2 caracteres.`;
    if (nombre.length > NOMBRE_MAXIMO) {
        return `El ${etiqueta} no puede superar los ${NOMBRE_MAXIMO} caracteres.`;
    }
    return null;
};

/**
 * Valida el cuerpo de creación o edición.
 *
 * Devuelve `{ ok, errores, datos }`:
 *  - `errores` es un objeto campo -> mensaje. El primer campo según el orden de
 *    `ORDEN_ERRORES` es al que la interfaz debe llevar el foco.
 *  - `datos` son los valores ya normalizados (trim, documento sin espacios).
 *
 * `modo` es 'crear' u 'editar'. En edición la contraseña vacía significa "no
 * cambiar", que es el comportamiento que ya tenía el formulario.
 */
const validarDatosUsuario = (data, { modo = 'crear' } = {}) => {
    const errores = {};
    const esCrear = modo !== 'editar';

    const username = texto(data.username);
    if (!username) errores.username = 'El username es obligatorio.';
    else if (!RE_USERNAME.test(username)) {
        errores.username = 'El username admite letras, números, punto, guion y guion bajo.';
    } else if (username.length < 3) {
        errores.username = 'El username debe tener al menos 3 caracteres.';
    } else if (username.length > USERNAME_MAXIMO) {
        errores.username = `El username no puede superar los ${USERNAME_MAXIMO} caracteres.`;
    }

    const tipoDocumentoKey = texto(data.tipoDocumentoKey);
    if (!tipoDocumentoKey) {
        errores.tipoDocumentoKey = 'Seleccione el tipo de documento.';
    }

    const documentoCrudo = texto(data.nroDocumento);
    const esRuc = tipoDocumentoKey.toLowerCase() === 'ruc';
    const documento = REGLAS_DOCUMENTO[tipoDocumentoKey.toLowerCase()]?.soloDigitos
        ? normalizarSoloDigitos(documentoCrudo)
        : documentoCrudo;
    const errorDocumento = validarDocumento(tipoDocumentoKey, documento);
    if (errorDocumento) errores.nroDocumento = errorDocumento;

    // Con RUC se pide razón social; con documento personal, nombres y apellidos.
    // Es la misma condición que usa el formulario para mostrar los campos.
    if (esRuc) {
        const razon = texto(data.nombreRazonSocial);
        if (!razon) errores.nombreRazonSocial = 'La razón social es obligatoria.';
        else if (razon.length > 500) {
            errores.nombreRazonSocial = 'La razón social no puede superar los 500 caracteres.';
        }
    } else {
        const errorNombres = validarNombre(data.nombres, 'nombre');
        if (errorNombres) errores.nombres = errorNombres;
        const errorApellidos = validarNombre(data.apellidos, 'apellido');
        if (errorApellidos) errores.apellidos = errorApellidos;
    }

    const direccion = texto(data.direccion);
    if (!direccion) errores.direccion = 'La dirección es obligatoria.';
    else if (direccion.length < 5) {
        errores.direccion = 'La dirección debe tener al menos 5 caracteres.';
    } else if (direccion.length > DIRECCION_MAXIMA) {
        errores.direccion = `La dirección no puede superar los ${DIRECCION_MAXIMA} caracteres.`;
    }

    // Teléfono: exactamente 9 dígitos. Ni letras, ni espacios, ni signos.
    const telefono = texto(data.telefono);
    if (!telefono) errores.telefono = 'El teléfono es obligatorio.';
    else if (!RE_TELEFONO.test(telefono)) {
        errores.telefono = 'El teléfono debe contener exactamente 9 dígitos.';
    }

    // Email sigue siendo opcional en el modelo: vacío es válido. Si trae
    // contenido, tiene que tener formato de correo.
    const email = texto(data.email);
    if (email) {
        if (!RE_EMAIL.test(email) || email.length > EMAIL_MAXIMO) {
            errores.email = 'Ingresa un correo electrónico válido.';
        }
    }

    const personaContacto = texto(data.personaContacto);

    for (const campo of ['paisKey', 'departamentoKey', 'provinciaKey', 'distritoKey']) {
        if (!texto(data[campo])) errores[campo] = 'Seleccione una opción.';
    }

    // Contraseña. Sin política propia: el sistema no tiene ninguna.
    const password = String(data.password ?? '');
    const confirmPassword = String(data.confirmPassword ?? '');
    if (esCrear && !password) {
        errores.password = 'La contraseña es obligatoria.';
    }
    if (password && password !== confirmPassword) {
        errores.confirmPassword = 'Las contraseñas no coinciden.';
    }

    return {
        ok: Object.keys(errores).length === 0,
        errores,
        primerCampo: ORDEN_ERRORES.find((campo) => errores[campo]) || null,
        datos: {
            username,
            tipoDocumentoKey,
            nroDocumento: documento || null,
            nombres: esRuc ? null : texto(data.nombres),
            apellidos: esRuc ? null : texto(data.apellidos),
            nombreRazonSocial: esRuc ? texto(data.nombreRazonSocial) : null,
            direccion,
            telefono,
            email: email || null,
            personaContacto: personaContacto || null,
            paisKey: texto(data.paisKey) || null,
            departamentoKey: texto(data.departamentoKey) || null,
            provinciaKey: texto(data.provinciaKey) || null,
            distritoKey: texto(data.distritoKey) || null
        }
    };
};

/** Orden en que la interfaz debe llevar el foco: el más arriba de la pantalla. */
const ORDEN_ERRORES = [
    'username',
    'tipoDocumentoKey',
    'nroDocumento',
    'nombres',
    'apellidos',
    'nombreRazonSocial',
    'password',
    'confirmPassword',
    'paisKey',
    'departamentoKey',
    'provinciaKey',
    'distritoKey',
    'direccion',
    'telefono',
    'email'
];

const errorNegocio = (mensaje, errores) => {
    const error = new Error(mensaje);
    error.code = 'DATOS_USUARIO_INVALIDOS';
    error.statusCode = 400;
    error.status = 400;
    error.errores = errores;
    return error;
};

/**
 * Valida y devuelve los datos normalizados, o lanza con 400 y el detalle campo a
 * campo. Es el punto único de entrada de `crearUsuario` y `actualizarUsuario`.
 */
const exigirDatosValidos = (data, opciones) => {
    const resultado = validarDatosUsuario(data, opciones);
    if (!resultado.ok) {
        const primero = resultado.errores[resultado.primerCampo];
        throw errorNegocio(primero, resultado.errores);
    }
    return resultado.datos;
};

/** El tipo de documento debe existir en el catálogo antes de confiar en él. */
const existeTipoDocumento = async (tipoKey) => {
    if (!texto(tipoKey)) return false;
    const { rows } = await db.query(
        'SELECT 1 FROM tipodocumentoidentidad WHERE key = $1', [texto(tipoKey)]);
    return rows.length > 0;
};

exports.DOCUMENTO_MAXIMO = DOCUMENTO_MAXIMO;
exports.NOMBRE_MAXIMO = NOMBRE_MAXIMO;
exports.DIRECCION_MAXIMA = DIRECCION_MAXIMA;
exports.EMAIL_MAXIMO = EMAIL_MAXIMO;
exports.TELEFONO_MAXIMO = TELEFONO_MAXIMO;
exports.USERNAME_MAXIMO = USERNAME_MAXIMO;
exports.REGLAS_DOCUMENTO = REGLAS_DOCUMENTO;
exports.ORDEN_ERRORES = ORDEN_ERRORES;
exports.RE_NOMBRE = RE_NOMBRE;
exports.RE_EMAIL = RE_EMAIL;
exports.RE_TELEFONO = RE_TELEFONO;
exports.RE_USERNAME = RE_USERNAME;
exports.normalizarSoloDigitos = normalizarSoloDigitos;
exports.normalizarTelefono = normalizarTelefono;
exports.validarDocumento = validarDocumento;
exports.validarNombre = validarNombre;
exports.validarDatosUsuario = validarDatosUsuario;
exports.exigirDatosValidos = exigirDatosValidos;
exports.existeTipoDocumento = existeTipoDocumento;
exports.errorNegocio = errorNegocio;
exports._db = db;