const { Client } = require('pg'); 
const c = new Client({user: 'postgres', host: '192.168.14.19', password: 'farenet2026**', database: 'inspeccion', port: 5432}); 
c.connect().then(() => {
    return c.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'tipodocumentoidentidad'`);
}).then(r => { 
    console.log('tipodoc cols:', r.rows); 
    return c.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'pais'`);
}).then(r => {
    console.log('pais cols:', r.rows);
    return c.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'departamento'`);
}).then(r => {
    console.log('departamento cols:', r.rows);
    return c.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'provincia'`);
}).then(r => {
    console.log('provincia cols:', r.rows);
    return c.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'distrito'`);
}).then(r => {
    console.log('distrito cols:', r.rows);
}).catch(e => { 
    console.error('ERROR:', e.message); 
}).finally(() => {
    c.end();
});
