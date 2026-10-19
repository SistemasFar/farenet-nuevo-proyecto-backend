const MAX_PDF_BYTES = 15 * 1024 * 1024;

const errorConCodigo = (codigo, statusCode) => {
    const error = new Error(codigo);
    error.code = codigo;
    error.statusCode = statusCode;
    return error;
};

const validarEnlaceNubefact = (enlace) => {
    let url;
    try {
        url = new URL(String(enlace || ''));
    } catch {
        throw errorConCodigo('ENLACE_NUBEFACT_INVALIDO', 409);
    }

    const host = url.hostname.toLowerCase();
    const hostPermitido = host === 'nubefact.com' || host.endsWith('.nubefact.com');
    if (url.protocol !== 'https:' || !hostPermitido || !/\.pdf$/i.test(url.pathname)) {
        throw errorConCodigo('ENLACE_NUBEFACT_INVALIDO', 409);
    }
    return url;
};

const descargarPdfNubefact = async (enlace, fetchImpl = global.fetch) => {
    let url = validarEnlaceNubefact(enlace);
    let response = null;
    for (let redireccion = 0; redireccion <= 3; redireccion += 1) {
        try {
            response = await fetchImpl(url, {
                method: 'GET',
                redirect: 'manual',
                signal: AbortSignal.timeout(20_000),
                headers: { Accept: 'application/pdf' }
            });
        } catch {
            throw errorConCodigo('DESCARGA_NUBEFACT_FALLIDA', 502);
        }
        if (response.status < 300 || response.status >= 400) break;
        const destino = response.headers.get('location');
        if (!destino || redireccion === 3) throw errorConCodigo('DESCARGA_NUBEFACT_FALLIDA', 502);
        url = validarEnlaceNubefact(new URL(destino, url).toString());
    }

    if (!response?.ok) throw errorConCodigo('DESCARGA_NUBEFACT_FALLIDA', 502);
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_PDF_BYTES) throw errorConCodigo('PDF_NUBEFACT_INVALIDO', 502);

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0 || buffer.length > MAX_PDF_BYTES || buffer.subarray(0, 5).toString() !== '%PDF-') {
        throw errorConCodigo('PDF_NUBEFACT_INVALIDO', 502);
    }
    return buffer;
};

const nombreArchivoNubefact = (facturacion) => {
    const referencia = [facturacion?.serie, facturacion?.numero]
        .filter(Boolean)
        .join('-')
        .replace(/[^A-Za-z0-9_-]/g, '');
    return `NUBEFACT-${referencia || facturacion?.id || 'COMPROBANTE'}.pdf`;
};

module.exports = {
    MAX_PDF_BYTES,
    validarEnlaceNubefact,
    descargarPdfNubefact,
    nombreArchivoNubefact
};
