/**
 * Conversor determinista de números a letras para comprobantes fiscales de Perú.
 *
 * Formato oficial:
 * "Son: Setenta con 00/100 Soles"
 * "Son: Cincuenta con 00/100 Soles"
 * "Son: Mil doscientos cincuenta con 50/100 Soles"
 */

const UNIDADES = [
    '', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve',
    'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete',
    'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés',
    'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'
];

const DECENAS = [
    '', '', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'
];

const CENTENAS = [
    '', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos',
    'seiscientos', 'setecientos', 'ochocientos', 'novecientos'
];

function convertirSeccion(n) {
    if (n === 0) return '';
    if (n === 100) return 'cien';
    let output = '';

    const c = Math.floor(n / 100);
    const d = Math.floor((n % 100) / 10);
    const u = n % 10;
    const du = n % 100;

    if (c > 0) {
        output += CENTENAS[c] + ' ';
    }

    if (du > 0) {
        if (du < 30) {
            output += UNIDADES[du] + ' ';
        } else {
            output += DECENAS[d];
            if (u > 0) {
                output += ' y ' + UNIDADES[u];
            }
            output += ' ';
        }
    }

    return output.trim();
}

function convertirEntero(num) {
    if (num === 0) return 'cero';

    let letras = '';
    const millones = Math.floor(num / 1000000);
    const miles = Math.floor((num % 1000000) / 1000);
    const unidades = num % 1000;

    if (millones > 0) {
        if (millones === 1) {
            letras += 'un millón ';
        } else {
            letras += `${convertirSeccion(millones)} millones `;
        }
    }

    if (miles > 0) {
        if (miles === 1) {
            letras += 'mil ';
        } else {
            letras += `${convertirSeccion(miles)} mil `;
        }
    }

    if (unidades > 0) {
        letras += convertirSeccion(unidades);
    }

    return letras.trim();
}

/**
 * Convierte un importe numérico a texto formal para comprobante.
 * @param {number|string} monto
 * @param {string} moneda - Nombre de la moneda (por defecto 'Soles')
 * @returns {string} Ej: "Son: Setenta con 00/100 Soles"
 */
function numeroALetras(monto, moneda = 'Soles') {
    const valor = Number(monto || 0);
    if (!Number.isFinite(valor) || valor < 0) {
        return `Son: Cero con 00/100 ${moneda}`;
    }

    const centavosTotales = Math.round((valor + Number.EPSILON) * 100);
    const entero = Math.floor(centavosTotales / 100);
    const centavos = centavosTotales % 100;
    const centavosStr = String(centavos).padStart(2, '0');

    let textoEntero = convertirEntero(entero);
    // Capitalizar solo la primera letra
    textoEntero = textoEntero.charAt(0).toUpperCase() + textoEntero.slice(1);

    return `Son: ${textoEntero} con ${centavosStr}/100 ${moneda}`;
}

module.exports = {
    numeroALetras
};
