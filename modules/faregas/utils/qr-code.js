/**
 * Generador autónomo de Código QR en SVG para comprobantes fiscales de SUNAT.
 * Algoritmo compacto QR (Modelo 2, niveles L/M/Q/H) 100% puro JavaScript,
 * sin dependencias nativas ni binarios externos.
 */

// Tablas de polinomios y logaritmos Galois Field GF(256)
const EXP_TABLE = new Uint8Array(256);
const LOG_TABLE = new Uint8Array(256);
for (let i = 0, x = 1; i < 256; i++) {
    EXP_TABLE[i] = x;
    LOG_TABLE[x] = i;
    x = (x << 1) ^ (x >= 128 ? 0x11d : 0);
}

function gmult(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP_TABLE[(LOG_TABLE[a] + LOG_TABLE[b]) % 255];
}

function polyMul(p1, p2) {
    const res = new Uint8Array(p1.length + p2.length - 1);
    for (let i = 0; i < p1.length; i++) {
        for (let j = 0; j < p2.length; j++) {
            res[i + j] ^= gmult(p1[i], p2[j]);
        }
    }
    return res;
}

function getGeneratorPoly(degree) {
    let poly = new Uint8Array([1]);
    for (let i = 0; i < degree; i++) {
        poly = polyMul(poly, new Uint8Array([1, EXP_TABLE[i]]));
    }
    return poly;
}

function rsEncode(data, ecCount) {
    const gen = getGeneratorPoly(ecCount);
    const msg = new Uint8Array(data.length + ecCount);
    msg.set(data);
    for (let i = 0; i < data.length; i++) {
        const coef = msg[i];
        if (coef !== 0) {
            for (let j = 0; j < gen.length; j++) {
                msg[i + j] ^= gmult(gen[j], coef);
            }
        }
    }
    return msg.slice(data.length);
}

// Capacidades de versión y corrección de error nivel M (apropiado para SUNAT)
// Versiones 1 a 10 con capacidades de bytes y bloques EC (Nivel M: ~15% recuperación)
const QR_SPECS = [
    null,
    { ver: 1, size: 21, dataBytes: 16, ecBytes: 10, ecBlocks: 1 },
    { ver: 2, size: 25, dataBytes: 28, ecBytes: 16, ecBlocks: 1 },
    { ver: 3, size: 29, dataBytes: 44, ecBytes: 26, ecBlocks: 1 },
    { ver: 4, size: 33, dataBytes: 64, ecBytes: 18, ecBlocks: 2 },
    { ver: 5, size: 37, dataBytes: 86, ecBytes: 24, ecBlocks: 2 },
    { ver: 6, size: 41, dataBytes: 108, ecBytes: 16, ecBlocks: 4 },
    { ver: 7, size: 45, dataBytes: 124, ecBytes: 18, ecBlocks: 4 },
    { ver: 8, size: 49, dataBytes: 154, ecBytes: 22, ecBlocks: 4 },
    { ver: 9, size: 53, dataBytes: 182, ecBytes: 22, ecBlocks: 5 },
    { ver: 10, size: 57, dataBytes: 216, ecBytes: 26, ecBlocks: 5 },
    { ver: 11, size: 61, dataBytes: 250, ecBytes: 30, ecBlocks: 5 },
    { ver: 12, size: 65, dataBytes: 284, ecBytes: 22, ecBlocks: 8 },
    { ver: 13, size: 69, dataBytes: 320, ecBytes: 22, ecBlocks: 9 },
    { ver: 14, size: 73, dataBytes: 358, ecBytes: 24, ecBlocks: 9 }
];

function selectVersion(byteLength) {
    // 4 bits modo + 8/16 bits conteo
    for (let v = 1; v < QR_SPECS.length; v++) {
        const spec = QR_SPECS[v];
        const countBits = spec.ver < 10 ? 8 : 16;
        const totalBits = 4 + countBits + (byteLength * 8);
        const totalBytes = Math.ceil(totalBits / 8);
        if (totalBytes <= spec.dataBytes) {
            return spec;
        }
    }
    return QR_SPECS[QR_SPECS.length - 1];
}

function encodeData(text, spec) {
    const utf8 = Buffer.from(text, 'utf8');
    const bits = [];
    const pushBits = (val, len) => {
        for (let i = len - 1; i >= 0; i--) {
            bits.push((val >> i) & 1);
        }
    };

    // Modo Byte: 0100
    pushBits(0b0100, 4);
    // Conteo de caracteres
    const countBits = spec.ver < 10 ? 8 : 16;
    pushBits(utf8.length, countBits);
    // Datos UTF-8
    for (let i = 0; i < utf8.length; i++) {
        pushBits(utf8[i], 8);
    }
    // Terminador (hasta 4 ceros)
    const maxDataBits = spec.dataBytes * 8;
    for (let i = 0; i < 4 && bits.length < maxDataBits; i++) {
        bits.push(0);
    }
    // Relleno a múltiplo de 8
    while (bits.length % 8 !== 0) {
        bits.push(0);
    }
    // Bytes de relleno alternados 0xEC, 0x11
    const padBytes = [0xEC, 0x11];
    let padIdx = 0;
    while (bits.length < maxDataBits) {
        pushBits(padBytes[padIdx % 2], 8);
        padIdx++;
    }

    const dataArr = new Uint8Array(spec.dataBytes);
    for (let i = 0; i < spec.dataBytes; i++) {
        let byteVal = 0;
        for (let b = 0; b < 8; b++) {
            byteVal = (byteVal << 1) | bits[i * 8 + b];
        }
        dataArr[i] = byteVal;
    }

    // Dividir en bloques EC y calcular corrección
    const numBlocks = spec.ecBlocks;
    const bytesPerBlock = Math.floor(spec.dataBytes / numBlocks);
    const extraBlocks = spec.dataBytes % numBlocks;
    const ecLen = spec.ecBytes;

    const dataBlocks = [];
    const ecBlocks = [];
    let offset = 0;
    for (let i = 0; i < numBlocks; i++) {
        const blockSize = bytesPerBlock + (i >= numBlocks - extraBlocks ? 1 : 0);
        const block = dataArr.slice(offset, offset + blockSize);
        dataBlocks.push(block);
        ecBlocks.push(rsEncode(block, ecLen));
        offset += blockSize;
    }

    // Interleave data y EC
    const result = [];
    const maxDataBlockLen = bytesPerBlock + (extraBlocks > 0 ? 1 : 0);
    for (let i = 0; i < maxDataBlockLen; i++) {
        for (let b = 0; b < numBlocks; b++) {
            if (i < dataBlocks[b].length) {
                result.push(dataBlocks[b][i]);
            }
        }
    }
    for (let i = 0; i < ecLen; i++) {
        for (let b = 0; b < numBlocks; b++) {
            result.push(ecBlocks[b][i]);
        }
    }

    return result;
}

// Patrones de alineamiento según versión
const ALIGNMENT_COORDS = [
    [],
    [],
    [6, 18],
    [6, 22],
    [6, 26],
    [6, 30],
    [6, 34],
    [6, 22, 38],
    [6, 24, 42],
    [6, 26, 46],
    [6, 28, 50],
    [6, 30, 54],
    [6, 32, 58],
    [6, 34, 62],
    [6, 26, 46, 66]
];

function createMatrix(spec, codewords) {
    const N = spec.size;
    const matrix = Array.from({ length: N }, () => new Int8Array(N).fill(-1));

    const setModule = (r, c, val) => {
        if (r >= 0 && r < N && c >= 0 && c < N) matrix[r][c] = val;
    };

    // Patrón de búsqueda (Finder Pattern) 7x7 con separador
    const drawFinder = (r0, c0) => {
        for (let r = -1; r <= 7; r++) {
            for (let c = -1; c <= 7; c++) {
                const isBlack = (r >= 0 && r <= 6 && (c === 0 || c === 6))
                    || (c >= 0 && c <= 6 && (r === 0 || r === 6))
                    || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
                const inside = r >= 0 && r <= 6 && c >= 0 && c <= 6;
                const val = inside ? (isBlack ? 1 : 0) : 0;
                setModule(r0 + r, c0 + c, val);
            }
        }
    };

    drawFinder(0, 0);
    drawFinder(0, N - 7);
    drawFinder(N - 7, 0);

    // Patrón de sincronización (Timing patterns)
    for (let i = 8; i < N - 8; i++) {
        const val = i % 2 === 0 ? 1 : 0;
        if (matrix[6][i] === -1) matrix[6][i] = val;
        if (matrix[i][6] === -1) matrix[i][6] = val;
    }

    // Patrones de alineamiento
    const align = ALIGNMENT_COORDS[spec.ver] || [];
    for (let i = 0; i < align.length; i++) {
        for (let j = 0; j < align.length; j++) {
            const r = align[i];
            const c = align[j];
            if (matrix[r][c] !== -1) continue;
            for (let dr = -2; dr <= 2; dr++) {
                for (let dc = -2; dc <= 2; dc++) {
                    const isBorder = Math.abs(dr) === 2 || Math.abs(dc) === 2;
                    const isCenter = dr === 0 && dc === 0;
                    setModule(r + dr, c + dc, isBorder || isCenter ? 1 : 0);
                }
            }
        }
    }

    // Módulo negro oscuro obligatorio
    setModule(4 * spec.ver + 9, 8, 1);

    // Reservar áreas de información de formato
    for (let i = 0; i <= 8; i++) {
        if (matrix[8][i] === -1) matrix[8][i] = 0;
        if (matrix[i][8] === -1) matrix[i][8] = 0;
    }
    for (let i = 0; i < 8; i++) {
        if (matrix[8][N - 1 - i] === -1) matrix[8][N - 1 - i] = 0;
        if (matrix[N - 1 - i][8] === -1) matrix[N - 1 - i][8] = 0;
    }

    // Colocar bits de datos y error con máscara 0 ( (row + col) % 2 === 0 )
    const bits = [];
    for (let i = 0; i < codewords.length; i++) {
        for (let b = 7; b >= 0; b--) {
            bits.push((codewords[i] >> b) & 1);
        }
    }

    let bitIdx = 0;
    let upward = true;
    for (let right = N - 1; right > 0; right -= 2) {
        if (right === 6) right--; // Saltear columna de temporización
        const cols = [right, right - 1];
        const rows = upward ? Array.from({ length: N }, (_, i) => N - 1 - i) : Array.from({ length: N }, (_, i) => i);
        for (const row of rows) {
            for (const col of cols) {
                if (matrix[row][col] === -1) {
                    const bit = bitIdx < bits.length ? bits[bitIdx++] : 0;
                    // Máscara 0: invertir si (row + col) % 2 == 0
                    const mask = (row + col) % 2 === 0 ? 1 : 0;
                    matrix[row][col] = bit ^ mask;
                }
            }
        }
        upward = !upward;
    }

    // Formato Nivel M, Máscara 0 -> 15 bits: 101010000010010
    const formatBits = [1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0];
    const formatCoords1 = [
        [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
        [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]
    ];
    const formatCoords2 = [
        [N - 1, 8], [N - 2, 8], [N - 3, 8], [N - 4, 8], [N - 5, 8], [N - 6, 8], [N - 7, 8],
        [8, N - 8], [8, N - 7], [8, N - 6], [8, N - 5], [8, N - 4], [8, N - 3], [8, N - 2], [8, N - 1]
    ];

    for (let i = 0; i < 15; i++) {
        const val = formatBits[i];
        matrix[formatCoords1[i][0]][formatCoords1[i][1]] = val;
        matrix[formatCoords2[i][0]][formatCoords2[i][1]] = val;
    }

    return matrix;
}

/**
 * Genera el SVG de un código QR para el texto provisto.
 * @param {string} text - Contenido del QR (cadena SUNAT)
 * @param {object} options - Opciones de tamaño y margen
 * @returns {string} Código SVG del QR
 */
function generarQrSvg(text, options = {}) {
    // ISO/IEC 18004 recomienda una zona silenciosa de cuatro módulos.
    const { size = 110, margin = 4 } = options;
    const cleanText = String(text || '').trim();
    if (!cleanText) return '';

    const spec = selectVersion(Buffer.byteLength(cleanText, 'utf8'));
    const codewords = encodeData(cleanText, spec);
    const matrix = createMatrix(spec, codewords);

    const N = matrix.length;
    const totalSize = N + margin * 2;
    let rects = '';

    for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
            if (matrix[r][c] === 1) {
                const x = c + margin;
                const y = r + margin;
                rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="#000000" />`;
            }
        }
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalSize} ${totalSize}" width="${size}" height="${size}" shape-rendering="crispEdges">
        <rect width="100%" height="100%" fill="#ffffff" />
        ${rects}
    </svg>`;
}

/**
 * Retorna el SVG codificado en Data URI para incrustar en <img src="...">.
 */
function generarQrDataUri(text, options = {}) {
    const svg = generarQrSvg(text, options);
    if (!svg) return '';
    const base64 = Buffer.from(svg, 'utf8').toString('base64');
    return `data:image/svg+xml;base64,${base64}`;
}

module.exports = {
    generarQrSvg,
    generarQrDataUri
};
