const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const PizZip = require('pizzip');
const { DOMParser } = require('@xmldom/xmldom');
const service = require('../modules/faregas/services/faregas-series-dms.service');
const db = require('../config/database');

const ARCHIVO_POR_DEFECTO = 'C:\\Users\\Sistemas2\\Downloads\\Series-2026-09-30T16_38_02.xlsx';
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

const textoNodos = (node) => Array.from(node?.getElementsByTagNameNS(NS, 't') || [])
    .map((item) => item.textContent || '')
    .join('');
const sinBom = (value) => String(value || '').replace(/^\uFEFF/, '');

const indiceColumna = (reference) => {
    const letters = String(reference || '').match(/^[A-Z]+/)?.[0] || '';
    return [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
};

const leerFilas = (archivo) => {
    const zip = new PizZip(readFileSync(archivo));
    const parser = new DOMParser();
    const sharedXml = zip.file('xl/sharedStrings.xml')?.asText();
    const shared = sharedXml
        ? Array.from(parser.parseFromString(sinBom(sharedXml), 'application/xml').getElementsByTagNameNS(NS, 'si')).map(textoNodos)
        : [];
    const sheetXml = zip.file('xl/worksheets/sheet1.xml')?.asText();
    if (!sheetXml) throw new Error('EXCEL_DMS_SIN_HOJA_1');
    const document = parser.parseFromString(sinBom(sheetXml), 'application/xml');
    const rows = Array.from(document.getElementsByTagNameNS(NS, 'row')).map((row) => {
        const result = Array(14).fill('');
        for (const cell of Array.from(row.getElementsByTagNameNS(NS, 'c'))) {
            const index = indiceColumna(cell.getAttribute('r'));
            if (index < 0 || index >= 14) continue;
            const type = cell.getAttribute('t');
            const raw = cell.getElementsByTagNameNS(NS, 'v')[0]?.textContent || '';
            if (type === 's') result[index] = shared[Number(raw)] || '';
            else if (type === 'inlineStr') result[index] = textoNodos(cell);
            else if (type === 'b') result[index] = raw === '1' ? 'Sí' : 'No';
            else result[index] = raw;
        }
        return result;
    });
    const headerIndex = rows.findIndex((row) => String(row[0]).trim().toLowerCase() === 'nombre');
    if (headerIndex < 0) throw new Error('EXCEL_DMS_SIN_ENCABEZADO');
    const headers = rows[headerIndex].map((value) => String(value).trim());
    const expected = service._private.CAMPOS_DMS;
    if (headers.length !== expected.length || headers.some((value, index) => value !== expected[index])) {
        throw new Error('EXCEL_DMS_COLUMNAS_INVALIDAS');
    }
    return rows.slice(headerIndex + 1)
        .filter((row) => row.some((value) => String(value).trim() !== ''))
        .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index]])));
};

const resumenConEjemplos = (vista) => ({
    total: vista.total,
    resumen: vista.resumen,
    correlativos: {
        iguales: vista.filas.filter((row) => row.estado === 'YA_EXISTE' && row.ultimo_numero_faregas === row.ultimo_numero_dms).length,
        excel_mayor: vista.filas.filter((row) => row.estado === 'YA_EXISTE' && row.ultimo_numero_dms > row.ultimo_numero_faregas).length,
        faregas_mayor: vista.filas.filter((row) => row.estado === 'YA_EXISTE' && row.ultimo_numero_faregas > row.ultimo_numero_dms).length,
        diferencias_excel_mayor: vista.filas
            .filter((row) => row.estado === 'YA_EXISTE' && row.ultimo_numero_dms > row.ultimo_numero_faregas)
            .map((row) => ({
                fila: row.fila,
                local: row.nombre_local_dms,
                serie: row.serie,
                ultimoFaregas: row.ultimo_numero_faregas,
                ultimoExcel: row.ultimo_numero_dms
            }))
    },
    campos_distintos: vista.filas
        .filter((row) => row.estado === 'YA_EXISTE')
        .flatMap((row) => (row.diferencias || []).filter((campo) => campo !== 'ultimo_numero'))
        .reduce((resumen, campo) => ({ ...resumen, [campo]: (resumen[campo] || 0) + 1 }), {}),
    origenes_actuales: vista.filas
        .filter((row) => row.estado === 'YA_EXISTE')
        .reduce((resumen, row) => {
            const origen = `${row.proveedor_emision_actual}/${row.entorno_emision_actual}`;
            resumen[origen] = (resumen[origen] || 0) + 1;
            return resumen;
        }, {}),
    ejemplos: vista.filas
        .filter((row) => ['FAREGAS - SANTA ANITA', 'FAREGAS - SAN BORJA', 'FAREGAS - SURCO', 'FAREGAS - ICA'].includes(row.nombre_local_dms))
        .map((row) => ({
            fila: row.fila,
            nombre: row.nombre_dms,
            tipoDocumento: row.tipo_documento,
            numeroDms: row.numero_dms,
            serieInterna: row.serie,
            codigoLocal: row.codigo_local_dms,
            local: row.nombre_local_dms,
            plantaKey: row.planta_key,
            ultimoFaregas: row.ultimo_numero_faregas,
            ultimoDms: row.ultimo_numero_dms,
            ultimoFinal: row.ultimo_numero_final,
            accion: row.estado
        })),
    pendientes: vista.filas
        .filter((row) => ['SEDE_NO_HOMOLOGADA', 'REVISAR_MANUAL'].includes(row.estado))
        .map((row) => ({
            fila: row.fila,
            estado: row.estado,
            motivo: row.motivo,
            empresaReal: row.empresa_real,
            nombre: row.origen.Nombre,
            tipoDocumento: row.origen['Tipo de Documento'],
            referencia: row.origen['Tipo de Documento de Referencia'],
            numeroExcel: row.origen['Número'],
            serieInterna: row.serie,
            ultimoNumero: row.origen['Último Número Generado'],
            codigoLocal: row.origen['Código del Local'],
            local: row.origen['Nombre del Local']
        }))
});

const escaparCsv = (value) => {
    const texto = value === null || value === undefined ? '' : String(value);
    return `"${texto.replace(/"/g, '""')}"`;
};

const emitirReporteCsv = async (vista, archivo) => {
    const client = await db.connect();
    let emisiones;
    try {
        await client.query('BEGIN READ ONLY');
        const result = await client.query(`
            SELECT f.empresa_key, f.planta_key, f.tipo_comprobante, f.serie,
                   COUNT(*)::int AS documentos,
                   MAX(f.numero)::bigint AS max_numero,
                   MAX(f.fecha_hora_emision) AS ultima_emision
            FROM fg_facturacion f
            LEFT JOIN fg_planta p ON p.key::text = f.planta_key::text
            WHERE COALESCE(f.empresa_key, p.empresa_key) = 'FAREGAS'
            GROUP BY f.empresa_key, f.planta_key, f.tipo_comprobante, f.serie
        `);
        emisiones = result.rows;
        await client.query('ROLLBACK');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }

    const emisionesPorSerie = new Map(emisiones.map((item) => [
        `${item.planta_key}|${item.tipo_comprobante}|${item.serie}`,
        item
    ]));
    const headers = [
        'fila_excel', 'local_excel', 'codigo_local', 'empresa_real_planta', 'planta_key',
        'tipo_documento', 'tipo_referencia', 'numero_excel', 'serie_interna', 'estado', 'motivo',
        'ultimo_numero_excel', 'ultimo_numero_postgres', 'diferencia_excel_menos_postgres',
        'proveedor_postgres', 'entorno_postgres', 'documentos_emitidos_faregas',
        'max_numero_emitido_faregas', 'ultima_emision_faregas', 'nubefact_remoto_verificado'
    ];
    const rows = vista.filas.map((row) => {
        let identidad = row;
        if (!row.serie) {
            try {
                identidad = service._private.identidadDocumento(
                    row.origen.Nombre,
                    row.origen['Tipo de Documento'],
                    row.origen['Tipo de Documento de Referencia'],
                    row.origen['Número'],
                    row.fila
                );
            } catch { /* La fila queda sin serie inferible y requiere revisión. */ }
        }
        const emision = row.planta_key && identidad.tipo_comprobante && identidad.serie
            ? emisionesPorSerie.get(`${row.planta_key}|${identidad.tipo_comprobante}|${identidad.serie}`)
            : null;
        const actual = row.ultimo_numero_faregas;
        const dms = row.ultimo_numero_dms ?? Number(row.origen['Último Número Generado']);
        return [
            row.fila,
            row.origen['Nombre del Local'],
            row.codigo_local_dms ?? row.origen['Código del Local'],
            row.empresa_real ?? row.empresa_key ?? '',
            row.planta_key ?? '',
            row.tipo_documento ?? row.origen['Tipo de Documento'],
            row.tipo_documento_referencia ?? row.origen['Tipo de Documento de Referencia'],
            row.origen['Número'],
            identidad.serie ?? '',
            row.estado,
            row.motivo ?? '',
            dms,
            actual,
            Number.isFinite(Number(dms)) && actual !== null && actual !== undefined ? Number(dms) - Number(actual) : '',
            row.proveedor_emision_actual ?? '',
            row.entorno_emision_actual ?? '',
            emision?.documentos ?? 0,
            emision?.max_numero ?? '',
            emision?.ultima_emision?.toISOString?.() ?? '',
            'NO CONSULTADO: API pública de NubeFact no documenta administración/consulta de series'
        ].map(escaparCsv).join(',');
    });
    const target = path.resolve(archivo);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, `${[headers, ...rows].map((row) => Array.isArray(row) ? row.map(escaparCsv).join(',') : row).join('\r\n')}\r\n`, 'utf8');
    return target;
};

const main = async () => {
    const apply = process.argv.includes('--apply');
    const fileArg = process.argv.find((arg) => arg.startsWith('--file='));
    const archivo = path.resolve(fileArg ? fileArg.slice('--file='.length) : ARCHIVO_POR_DEFECTO);
    const filas = leerFilas(archivo);
    const previa = await service.previsualizar(filas);
    const vista = resumenConEjemplos(previa);
    const compacta = process.argv.includes('--summary-only');
    const reportArg = process.argv.find((arg) => arg.startsWith('--report='));
    const reportPath = reportArg ? await emitirReporteCsv(previa, reportArg.slice('--report='.length)) : null;
    console.log(JSON.stringify(apply
        ? { fase: 'PREVISUALIZACION', archivo, total: previa.total, resumen: previa.resumen }
        : compacta
            ? {
                fase: 'PREVISUALIZACION', archivo, total: vista.total, resumen: vista.resumen,
                correlativos: {
                    iguales: vista.correlativos.iguales,
                    excel_mayor: vista.correlativos.excel_mayor,
                    faregas_mayor: vista.correlativos.faregas_mayor
                },
                campos_distintos: vista.campos_distintos,
                origenes_actuales: vista.origenes_actuales,
                reporte_fila_a_fila: reportPath,
                pendientes: vista.pendientes
            }
            : { fase: 'PREVISUALIZACION', archivo, ...vista, reporte_fila_a_fila: reportPath }, null, 2));
    if (!apply) return;
    const resultado = await service.aplicar(filas, {
        confirmar: true,
        username: 'grace',
        ipDireccion: '127.0.0.1'
    });
    console.log(JSON.stringify({
        fase: 'APLICADA',
        antes: resultado.antes.resumen,
        despues: resultado.despues.resumen
    }, null, 2));
};

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => { await db.end(); });
