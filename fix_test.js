const fs = require('fs');
const p = 'modules/faregas/tests/faregas-nubefact-readiness.test.js';
let t = fs.readFileSync(p, 'utf8');

const tOld = `    const queryable = {
        query: async (sql) => sql.includes('information_schema.columns')
            ? { rows: [{ pendiente_sunat_aplicado: true, chips_aplicado: false }] }
            : { rows: [{ pendiente_sunat_aplicado: true, chips_aplicado: false }] }
    };`;

const tNew = `    const queryable = {
        query: async (sql) => {
            return { rows: [{ pendiente_sunat_aplicado: true, chips_aplicado: false, columnas: 6 }] };
        }
    };`;

if(t.includes(tOld)) {
    t = t.replace(tOld, tNew);
} else {
    // try the original mock if it's there
    const tOld2 = `    const queryable = {
        query: async (sql) => sql.includes('information_schema.columns')
            ? { rows: [{ columnas: 6 }] }
            : { rows: [{ pendiente_sunat_aplicado: true }] }
    };`;
    t = t.replace(tOld2, tNew);
}

fs.writeFileSync(p, t);
