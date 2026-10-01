const { readFileSync } = require('node:fs');
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
        .map((row) => ({ fila: row.fila, estado: row.estado, motivo: row.motivo, nombre: row.origen.Nombre, local: row.origen['Nombre del Local'] }))
});

const main = async () => {
    const apply = process.argv.includes('--apply');
    const fileArg = process.argv.find((arg) => arg.startsWith('--file='));
    const archivo = path.resolve(fileArg ? fileArg.slice('--file='.length) : ARCHIVO_POR_DEFECTO);
    const filas = leerFilas(archivo);
    const previa = await service.previsualizar(filas);
    console.log(JSON.stringify(apply
        ? { fase: 'PREVISUALIZACION', archivo, total: previa.total, resumen: previa.resumen }
        : { fase: 'PREVISUALIZACION', archivo, ...resumenConEjemplos(previa) }, null, 2));
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
