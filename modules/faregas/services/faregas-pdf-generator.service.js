const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

let cachedBrowserPath = null;
const generacionesEnCurso = new Map();

function candidatosNavegador() {
    const nombresPath = process.platform === 'win32'
        ? ['chrome.exe', 'msedge.exe']
        : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
    const desdePath = String(process.env.PATH || '')
        .split(path.delimiter)
        .filter(Boolean)
        .flatMap(directorio => nombresPath.map(nombre => path.join(directorio, nombre)));

    return [...new Set([
        process.env.CHROME_BIN,
        process.env.PUPPETEER_EXECUTABLE_PATH,
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/snap/bin/chromium',
        ...desdePath
    ].filter(Boolean))];
}

function detectarNavegador() {
    if (cachedBrowserPath && fs.existsSync(cachedBrowserPath)) {
        return cachedBrowserPath;
    }
    cachedBrowserPath = candidatosNavegador().find(candidato => fs.existsSync(candidato)) || null;
    return cachedBrowserPath;
}

function ejecutarNavegador(browserPath, args, timeoutMs) {
    return new Promise((resolve, reject) => {
        const child = spawn(browserPath, args, {
            windowsHide: true,
            stdio: ['ignore', 'ignore', 'pipe']
        });
        let stderr = '';
        let agotado = false;
        let resuelto = false;
        let timer;

        const terminar = (error) => {
            if (resuelto) return;
            resuelto = true;
            clearTimeout(timer);
            if (error) reject(error);
            else resolve();
        };

        child.stderr.on('data', chunk => {
            if (stderr.length < 8000) stderr += chunk.toString();
        });
        child.once('error', error => terminar(
            new Error(`ERROR_GENERACION_PDF: No se pudo iniciar el navegador (${error.message}).`)
        ));
        child.once('close', code => {
            if (agotado) {
                terminar(new Error(`ERROR_GENERACION_PDF: El navegador excedió el tiempo límite de ${timeoutMs} ms.`));
                return;
            }
            if (code !== 0) {
                const detalle = stderr.trim().slice(-1200);
                terminar(new Error(`ERROR_GENERACION_PDF: El navegador terminó con código ${code}${detalle ? ` (${detalle})` : ''}.`));
                return;
            }
            terminar();
        });

        timer = setTimeout(() => {
            agotado = true;
            child.kill();
        }, timeoutMs);
    });
}

async function generarPdfSinColision(htmlContent, outputPath, options) {
    const browserPath = detectarNavegador();
    if (!browserPath) {
        throw new Error('MOTOR_PDF_NO_DISPONIBLE: Configure CHROME_BIN o instale Google Chrome, Chromium o Microsoft Edge en el servidor.');
    }

    const targetDir = path.dirname(outputPath);
    fs.mkdirSync(targetDir, { recursive: true });

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'faregas-pdf-'));
    const tempHtmlPath = path.join(tempDir, 'comprobante.html');
    const tempPdfPath = path.join(targetDir, `.${path.basename(outputPath)}.${crypto.randomUUID()}.tmp.pdf`);
    const profileDir = path.join(tempDir, 'browser-profile');
    fs.writeFileSync(tempHtmlPath, htmlContent, 'utf8');

    const args = [
        '--headless=new',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-extensions',
        '--no-first-run',
        '--no-default-browser-check',
        '--no-pdf-header-footer',
        '--run-all-compositor-stages-before-draw',
        `--user-data-dir=${profileDir}`,
        `--print-to-pdf=${tempPdfPath}`,
        pathToFileURL(tempHtmlPath).href
    ];
    if (String(process.env.FAREGAS_CHROME_NO_SANDBOX || '').toLowerCase() === 'true') {
        args.unshift('--no-sandbox');
    }

    try {
        await ejecutarNavegador(browserPath, args, options.timeoutMs || 45000);
        if (!fs.existsSync(tempPdfPath) || fs.statSync(tempPdfPath).size === 0) {
            throw new Error('ERROR_GENERACION_PDF: El navegador no produjo un PDF válido.');
        }

        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        fs.renameSync(tempPdfPath, outputPath);
        return outputPath;
    } finally {
        try {
            if (fs.existsSync(tempPdfPath)) fs.unlinkSync(tempPdfPath);
        } catch {}
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {}
    }
}

/**
 * Convierte un HTML a PDF mediante un navegador instalado. Las generaciones
 * del mismo comprobante se serializan y el archivo final se sustituye sólo
 * cuando el navegador terminó correctamente.
 */
async function generarPdfDesdeHtml(htmlContent, outputPath, options = {}) {
    const destino = path.resolve(outputPath);
    const anterior = generacionesEnCurso.get(destino) || Promise.resolve();
    const actual = anterior
        .catch(() => undefined)
        .then(() => generarPdfSinColision(htmlContent, destino, options));
    generacionesEnCurso.set(destino, actual);

    try {
        return await actual;
    } finally {
        if (generacionesEnCurso.get(destino) === actual) {
            generacionesEnCurso.delete(destino);
        }
    }
}

module.exports = {
    detectarNavegador,
    generarPdfDesdeHtml
};
