const { generarHtml } = require('../modules/faregas/services/faregas-comprobante-impreso.service');
const db = require('../config/database');

async function run() {
    try {
        const html = await generarHtml(763);
        const lines = html.split('\n');
        const start = lines.findIndex(l => l.includes('<table class="items-table">'));
        console.log(lines.slice(start, start + 70).join('\n'));
    } catch (err) {
        console.error(err);
    } finally {
        await db.end();
    }
}
run();
