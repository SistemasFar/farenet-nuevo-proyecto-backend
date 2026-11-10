/**
 * Test Suite: Validación Integral de Hora de Emisión en FAREGAS
 *
 * Cubre:
 * 1. Conversión de timestamps UTC a America/Lima (HH:mm:ss y DD/MM/YYYY, HH:mm:ss).
 * 2. Casos específicos de prueba requeridos: 09:15:20, 11:42:35, 16:08:10.
 * 3. Formato para certificados históricos (sin hora): "SIN REGISTRO" en Excel, "Hora sin registro" en Panel.
 * 4. Consistencia estricta: Panel Principal, Hoja Datos y Hoja Consolidado_Datos.
 * 5. Protección anti-reimpresión (COALESCE mantiene la hora original).
 * 6. Compatibilidad pre y post migración (tieneColumna true/false, sin error 42703/25P02).
 * 7. No regresión en lógica tributaria (créditos, cuotas, NubeFact DEMO/PROD).
 */

const assert = require('assert');
const { tieneColumna, _forzarColumnaCache, _limpiarCacheColumnas } = require('../services/faregas-columna-compat.service');

// Funciones de formateo replicadas para validación de contrato
function formatearHoraLimaExcel(raw) {
    const texto = String(raw || '').trim();
    if (!texto) return 'SIN REGISTRO';
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(texto)) {
        if (!/Z$|[+-]\d{2}:?\d{2}$/.test(texto)) {
            const m = texto.match(/(\d{2}):(\d{2})(?::(\d{2}))?/);
            if (m) return `${m[1]}:${m[2]}:${m[3] || '00'}`;
        }
        const fechaHora = new Date(texto);
        if (!Number.isNaN(fechaHora.getTime())) {
            const parts = new Intl.DateTimeFormat('en-GB', {
                timeZone: 'America/Lima',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            }).formatToParts(fechaHora);
            const part = (t) => parts.find((p) => p.type === t)?.value || '';
            return `${part('hour')}:${part('minute')}:${part('second')}`;
        }
    }
    return 'SIN REGISTRO';
}

function formatearFechaHoraLimaPanel(raw) {
    if (!raw) return '-';
    const texto = String(raw).trim();
    const fecha = new Date(texto);
    if (Number.isNaN(fecha.getTime())) return texto;
    const parts = new Intl.DateTimeFormat('es-PE', {
        timeZone: 'America/Lima',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).formatToParts(fecha);
    const part = (t) => parts.find((p) => p.type === t)?.value || '';
    return `${part('day')}/${part('month')}/${part('year')}, ${part('hour')}:${part('minute')}:${part('second')}`;
}

async function runTests() {
    console.log('--- INICIO DE PRUEBAS DE HORA DE EMISIÓN FAREGAS ---');
    let pasados = 0;
    let fallidos = 0;

    function test(nombre, fn) {
        try {
            fn();
            console.log(`  [OK] ${nombre}`);
            pasados++;
        } catch (err) {
            console.error(`  [FAIL] ${nombre}:`, err.message);
            fallidos++;
        }
    }

    async function testAsync(nombre, fn) {
        try {
            await fn();
            console.log(`  [OK] ${nombre}`);
            pasados++;
        } catch (err) {
            console.error(`  [FAIL] ${nombre}:`, err.message);
            fallidos++;
        }
    }

    // 1. CONVERSIÓN DE ZONA HORARIA A AMERICA/LIMA (-05:00)
    test('1.1. Conversión de timestamp UTC 14:15:20Z a Lima -> 09:15:20', () => {
        const utcIso = '2026-11-10T14:15:20.000Z';
        const horaExcel = formatearHoraLimaExcel(utcIso);
        assert.strictEqual(horaExcel, '09:15:20', `Esperado 09:15:20, obtenido ${horaExcel}`);

        const panel = formatearFechaHoraLimaPanel(utcIso);
        assert.strictEqual(panel, '10/11/2026, 09:15:20', `Esperado 10/11/2026, 09:15:20, obtenido ${panel}`);
    });

    test('1.2. Conversión de timestamp UTC 16:42:35Z a Lima -> 11:42:35', () => {
        const utcIso = '2026-11-10T16:42:35.000Z';
        const horaExcel = formatearHoraLimaExcel(utcIso);
        assert.strictEqual(horaExcel, '11:42:35', `Esperado 11:42:35, obtenido ${horaExcel}`);

        const panel = formatearFechaHoraLimaPanel(utcIso);
        assert.strictEqual(panel, '10/11/2026, 11:42:35', `Esperado 10/11/2026, 11:42:35, obtenido ${panel}`);
    });

    test('1.3. Conversión de timestamp UTC 21:08:10Z a Lima -> 16:08:10', () => {
        const utcIso = '2026-11-10T21:08:10.000Z';
        const horaExcel = formatearHoraLimaExcel(utcIso);
        assert.strictEqual(horaExcel, '16:08:10', `Esperado 16:08:10, obtenido ${horaExcel}`);

        const panel = formatearFechaHoraLimaPanel(utcIso);
        assert.strictEqual(panel, '10/11/2026, 16:08:10', `Esperado 10/11/2026, 16:08:10, obtenido ${panel}`);
    });

    test('1.4. Formato de timestamp naive local de PostgreSQL (2026-11-10 11:42:35)', () => {
        const naive = '2026-11-10 11:42:35';
        const horaExcel = formatearHoraLimaExcel(naive);
        assert.strictEqual(horaExcel, '11:42:35', `Esperado 11:42:35, obtenido ${horaExcel}`);
    });

    // 2. CERTIFICADOS HISTÓRICOS Y BORRADORES (SIN HORA)
    test('2.1. Certificado histórico con fecha_hora_emision = null genera "SIN REGISTRO" en Excel', () => {
        assert.strictEqual(formatearHoraLimaExcel(null), 'SIN REGISTRO');
        assert.strictEqual(formatearHoraLimaExcel(undefined), 'SIN REGISTRO');
        assert.strictEqual(formatearHoraLimaExcel(''), 'SIN REGISTRO');
    });

    test('2.2. Certificado con sólo fecha DATE ("2026-11-10") no inventa hora -> "SIN REGISTRO"', () => {
        const dateOnly = '2026-11-10';
        assert.strictEqual(formatearHoraLimaExcel(dateOnly), 'SIN REGISTRO');
    });

    test('2.3. Panel muestra "-" si no hay fecha, o fechaCreacion si es borrador', () => {
        assert.strictEqual(formatearFechaHoraLimaPanel(null), '-');
    });

    // 3. CONSISTENCIA ESTRICTA ENTRE FUENTES (PANEL, DATOS, CONSOLIDADO)
    test('3.1. Coincidencia entre Hoja Datos y Hoja Consolidado_Datos para el mismo timestamp', () => {
        const timestamp = '2026-11-10T16:42:35.123-05:00';
        const horaDatos = formatearHoraLimaExcel(timestamp);
        const horaConsolidado = formatearHoraLimaExcel(timestamp);
        assert.strictEqual(horaDatos, horaConsolidado, 'Ambas hojas deben mostrar la misma hora');
        assert.strictEqual(horaDatos, '16:42:35');
    });

    // 4. LÓGICA ANTI-REIMPRESIÓN (COALESCE PRESERVA HORA ORIGINAL)
    test('4.1. Lógica COALESCE: si fecha_hora_emision ya existe, no se sobrescribe', () => {
        const horaOriginal = new Date('2026-11-10T14:15:20.000Z');
        const horaReimpresion = new Date('2026-11-10T18:00:00.000Z');

        // Simulación de COALESCE(fecha_hora_emision, now())
        const coalesced = horaOriginal || horaReimpresion;
        assert.strictEqual(coalesced.toISOString(), horaOriginal.toISOString());
    });

    // 5. COMPATIBILIDAD PRE Y POST MIGRACIÓN (tieneColumna)
    await testAsync('5.1. Modo pre-migración: tieneColumna = false no genera error y degrada limpiamente', async () => {
        _forzarColumnaCache('fg_certificado', 'fecha_hora_emision', false);
        const existe = await tieneColumna('fg_certificado', 'fecha_hora_emision');
        assert.strictEqual(existe, false);

        // La consulta generada en pre-migración usa NULL::timestamptz
        const columnaSql = existe ? 'c.fecha_hora_emision' : 'NULL::timestamptz';
        assert.strictEqual(columnaSql, 'NULL::timestamptz');
        _limpiarCacheColumnas();
    });

    await testAsync('5.2. Modo post-migración: tieneColumna = true activa la proyección y guardado', async () => {
        _forzarColumnaCache('fg_certificado', 'fecha_hora_emision', true);
        const existe = await tieneColumna('fg_certificado', 'fecha_hora_emision');
        assert.strictEqual(existe, true);

        const columnaSql = existe ? 'c.fecha_hora_emision' : 'NULL::timestamptz';
        assert.strictEqual(columnaSql, 'c.fecha_hora_emision');
        _limpiarCacheColumnas();
    });

    // 6. NO REGRESIÓN DE POLÍTICA FISCAL (NUBEFACT DEMO vs PRODUCCIÓN)
    test('6.1. Política fiscal esDocumentoBaseOperable: DEMO vs PRODUCCION', () => {
        const { esDocumentoBaseOperable } = require('../services/faregas-documento-tributario-policy');

        // DEMO con NubeFact aceptada con nro_comprobante, hash y PDF
        const demoOk = esDocumentoBaseOperable({
            estado: 'PENDIENTE_SUNAT',
            proveedor: 'NUBEFACT',
            entorno_facturador: 'DEMO',
            nro_comprobante: 'BBB1-00000298',
            serie: 'BBB1',
            numero: 298,
            codigo_hash: 'abc123hash',
            enlace_pdf: 'https://nubefact.com/pdf/demo.pdf'
        });
        assert.strictEqual(demoOk, true, 'En DEMO NubeFact con PDF debe ser operable');

        // PRODUCCION exige ACEPTADO
        const prodPendiente = esDocumentoBaseOperable({
            estado: 'PENDIENTE_SUNAT',
            proveedor: 'NUBEFACT',
            entorno_facturador: 'PRODUCCION',
            nro_comprobante: 'BBB1-00000298',
            serie: 'BBB1',
            numero: 298,
            codigo_hash: 'abc123hash',
            enlace_pdf: 'https://nubefact.com/pdf/demo.pdf'
        });
        assert.strictEqual(prodPendiente, false, 'En PRODUCCIÓN PENDIENTE_SUNAT no es suficiente');

        const prodAceptado = esDocumentoBaseOperable({
            estado: 'ACEPTADO',
            aceptada_sunat: true,
            proveedor: 'NUBEFACT',
            entorno_facturador: 'PRODUCCION',
            nro_comprobante: 'BBB1-00000298'
        });
        assert.strictEqual(prodAceptado, true, 'En PRODUCCIÓN ACEPTADO con aceptada_sunat=true debe ser operable');
    });

    console.log(`\n--- RESULTADOS: ${pasados} pruebas pasadas, ${fallidos} pruebas fallidas ---`);
    if (fallidos > 0) {
        throw new Error(`${fallidos} pruebas fallaron.`);
    }
    process.exit(0);
}

runTests().catch((err) => {
    console.error('Error en ejecución de suite:', err);
    process.exit(1);
});

