const test = require('node:test');
const assert = require('node:assert/strict');

const {
    validarEnlaceNubefact,
    descargarPdfNubefact,
    nombreArchivoNubefact
} = require('../services/faregas-descarga-nubefact.service');
const { limpiarNombre } = require('../services/faregas-certificado-pdf.service');

test('descarga NubeFact: sólo admite enlaces HTTPS del dominio NubeFact con extensión PDF', () => {
    assert.equal(
        validarEnlaceNubefact('https://www.nubefact.com/cpe/archivo.pdf').hostname,
        'www.nubefact.com'
    );
    assert.throws(
        () => validarEnlaceNubefact('http://www.nubefact.com/cpe/archivo.pdf'),
        (error) => error.code === 'ENLACE_NUBEFACT_INVALIDO'
    );
    assert.throws(
        () => validarEnlaceNubefact('https://nubefact.com.ejemplo.com/archivo.pdf'),
        (error) => error.code === 'ENLACE_NUBEFACT_INVALIDO'
    );
});

test('descarga NubeFact: acepta únicamente una respuesta que realmente sea PDF', async () => {
    const fetchPdf = async () => new Response(Buffer.from('%PDF-1.7 prueba'), {
        status: 200,
        headers: { 'content-type': 'application/pdf' }
    });
    const pdf = await descargarPdfNubefact('https://www.nubefact.com/cpe/archivo.pdf', fetchPdf);
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');

    const fetchHtml = async () => new Response('<html>Error</html>', { status: 200 });
    await assert.rejects(
        descargarPdfNubefact('https://www.nubefact.com/cpe/archivo.pdf', fetchHtml),
        (error) => error.code === 'PDF_NUBEFACT_INVALIDO'
    );
});

test('descarga NubeFact: permite redirecciones sólo si permanecen dentro de NubeFact', async () => {
    const fetchSeguro = async (url) => String(url).includes('inicio.pdf')
        ? new Response(null, { status: 302, headers: { location: 'https://cdn.nubefact.com/cpe/final.pdf' } })
        : new Response(Buffer.from('%PDF-1.7 final'), { status: 200 });
    const pdf = await descargarPdfNubefact('https://www.nubefact.com/cpe/inicio.pdf', fetchSeguro);
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');

    const fetchInseguro = async () => new Response(null, {
        status: 302,
        headers: { location: 'https://ejemplo.com/archivo.pdf' }
    });
    await assert.rejects(
        descargarPdfNubefact('https://www.nubefact.com/cpe/inicio.pdf', fetchInseguro),
        (error) => error.code === 'ENLACE_NUBEFACT_INVALIDO'
    );
});

test('descargas: genera nombres de archivo seguros y reconocibles', () => {
    assert.equal(nombreArchivoNubefact({ serie: 'FFF1', numero: 12 }), 'NUBEFACT-FFF1-12.pdf');
    assert.equal(limpiarNombre('DG-41/012488'), 'DG-41-012488');
});
