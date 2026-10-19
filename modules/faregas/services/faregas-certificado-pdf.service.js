const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { generarPdfDesdeHtml } = require('./faregas-pdf-generator.service');

const limpiarNombre = (valor) => String(valor || 'CERTIFICADO')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'CERTIFICADO';

const generarPdfTemporal = async ({ html, certificadoId, numeroCertificado }) => {
    if (!html) {
        const error = new Error('CERTIFICADO_SIN_CONTENIDO');
        error.statusCode = 409;
        throw error;
    }

    const directorio = path.join(os.tmpdir(), 'faregas-certificados');
    fs.mkdirSync(directorio, { recursive: true });
    const pdfPath = path.join(directorio, `${crypto.randomUUID()}.pdf`);
    const referencia = limpiarNombre(numeroCertificado || certificadoId);
    await generarPdfDesdeHtml(html, pdfPath, { printBackground: true });

    return {
        pdfPath,
        filename: `CERTIFICADO-${referencia}.pdf`,
        limpiar: () => {
            try {
                if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
            } catch (error) {
                console.error('[FAREGAS_CERTIFICADO_PDF_CLEANUP]', error.message);
            }
        }
    };
};

module.exports = { limpiarNombre, generarPdfTemporal };
