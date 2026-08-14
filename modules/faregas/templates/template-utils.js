function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatDateLong(dateInput) {
    if (!dateInput) {
        const now = new Date();
        const diaNum = now.getDate();
        const dia = diaNum < 10 ? `0${diaNum}` : `${diaNum}`;
        const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        const mes = meses[now.getMonth()];
        const anio = now.getFullYear();
        return { dia, mes, anio };
    }
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) {
        return { dia: '___', mes: '___________', anio: '______' };
    }
    const diaNum = d.getUTCDate();
    const dia = diaNum < 10 ? `0${diaNum}` : `${diaNum}`;
    const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    const mes = meses[d.getUTCMonth()];
    const anio = d.getUTCFullYear();
    return { dia, mes, anio };
}

function formatDateShort(dateInput) {
    if (!dateInput) return 'PREVISUALIZACIÓN';
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return 'PREVISUALIZACIÓN';
    const dia = String(d.getUTCDate()).padStart(2, '0');
    const mes = String(d.getUTCMonth() + 1).padStart(2, '0');
    const anio = d.getUTCFullYear();
    return `${dia}/${mes}/${anio}`;
}

module.exports = {
    escapeHtml,
    formatDateLong,
    formatDateShort
};
