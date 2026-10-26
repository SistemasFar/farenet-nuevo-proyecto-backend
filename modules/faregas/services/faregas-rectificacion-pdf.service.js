const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const certificadoPdfService = require('./faregas-certificado-pdf.service');

const DIRECTORIO_VERSIONES = process.env.FAREGAS_RECTIFICACION_PDF_PATH
    || path.join(__dirname, '../../../uploads/faregas/certificados-versiones');

const limpiarSegmento = (valor) => String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

const rutaRelativa = (rutaAbsoluta) => path.relative(path.join(__dirname, '../../..'), rutaAbsoluta)
    .split(path.sep)
    .join('/');

const resolverRutaAlmacenada = (enlace) => {
    if (!enlace) return null;
    const valor = String(enlace).trim();
    if (!valor) return null;
    const absoluta = path.isAbsolute(valor)
        ? valor
        : path.join(__dirname, '../../..', valor);
    return path.resolve(absoluta);
};

/**
 * Genera un PDF persistente e inmutable para una versión de rectificación.
 * Cada llamada usa un nombre único; nunca sobrescribe un PDF histórico.
 */
const generarPdfVersionPersistente = async ({
    html,
    certificadoId,
    numeroCertificado,
    numeroVersion,
    tipo = 'RECTIFICACION'
}) => {
    let temporal = null;
    try {
        temporal = await certificadoPdfService.generarPdfTemporal({
            html,
            certificadoId,
            numeroCertificado
        });
        const carpeta = path.join(DIRECTORIO_VERSIONES, String(Number(certificadoId) || 'sin-id'));
        fs.mkdirSync(carpeta, { recursive: true });
        const referencia = limpiarSegmento(numeroCertificado || certificadoId) || 'CERTIFICADO';
        const version = limpiarSegmento(numeroVersion || 'v');
        const tipoArchivo = limpiarSegmento(tipo) || 'RECTIFICACION';
        const nombre = `${referencia}-${version}-${tipoArchivo}-${crypto.randomUUID()}.pdf`;
        const destino = path.join(carpeta, nombre);
        fs.copyFileSync(temporal.pdfPath, destino);
        return {
            pdfPath: destino,
            enlace: rutaRelativa(destino),
            filename: `CERTIFICADO-${referencia}-${tipoArchivo}.pdf`,
            limpiar: () => {
                try {
                    if (fs.existsSync(destino)) fs.unlinkSync(destino);
                } catch (error) {
                    console.error('[FAREGAS_RECTIFICACION_PDF_CLEANUP]', error.message);
                }
            }
        };
    } finally {
        temporal?.limpiar?.();
    }
};

const existePdf = (ruta) => Boolean(ruta) && fs.existsSync(ruta);

module.exports = {
    DIRECTORIO_VERSIONES,
    generarPdfVersionPersistente,
    resolverRutaAlmacenada,
    existePdf,
    rutaRelativa
};
