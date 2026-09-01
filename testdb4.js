const { Client } = require('pg'); 
const c = new Client({user: 'postgres', host: '192.168.14.19', password: 'farenet2026**', database: 'inspeccion', port: 5432}); 
c.connect().then(() => {
    return c.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'fg_usuario_planta'`);
}).then(r => { 
    console.log('fg_usuario_planta cols:', r.rows); 
}).catch(e => { 
    console.error('ERROR:', e.message); 
}).finally(() => {
    c.end();
});
