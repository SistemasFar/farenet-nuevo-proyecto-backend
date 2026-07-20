const db = require('./config/database');

async function run() {
  try {
    const q = `
      SELECT rm.id, m.tipomaquina_key, rm.data, rm.postdata
      FROM resultado_maquina rm
      JOIN maquina m ON rm.maquina_id = m.id
      WHERE m.tipomaquina_key = '3' AND rm.data IS NOT NULL
      ORDER BY rm.id DESC
      LIMIT 1
    `;
    const res = await db.query(q);
    const rm = res.rows[0];
    const data = typeof rm.data === 'string' ? JSON.parse(rm.data) : rm.data;
    
    let prefix = 'frenos-';
    let resultados = {};
    
    const processObj = (obj) => {
      if (!obj) return;
      Object.keys(obj).forEach(k => {
        let val = obj[k];
        if (val !== null && val !== undefined) {
           if (typeof val === 'number' || (!isNaN(Number(val)) && String(val).trim() !== '')) {
              let num = Number(val);
              if (prefix === 'frenos-' && k.toLowerCase().includes('peso')) {
                 val = Math.round(num).toString();
              } else if ((prefix === 'analizador-' || prefix === 'opacimetro-') && (k.toLowerCase().includes('tmp') || k.toLowerCase().includes('rpm'))) {
                 val = Math.round(num).toString();
              } else {
                 val = num.toFixed(2);
              }
           } else {
              val = String(val);
           }
           resultados[prefix + k] = val;
        }
      });
    };
    
    processObj(data);
    console.log('--- GENERATED resData ---');
    console.log(resultados);
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
run();
