const db = require('./config/database');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

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

    // HTML Part
    const templatePath = path.resolve(process.cwd(), 'templates', 'certificado_inspeccion.html');
    let rawHtml = fs.readFileSync(templatePath, 'utf8');

    const cantEjes = 5;
    const regexRangeList = /<#assign myRange = 1\.\.cantEjes\s*>\s*<#list myRange as i>([\s\S]*?)<\/#list>/gi;
    rawHtml = rawHtml.replace(regexRangeList, (match, innerContent) => {
      let expanded = '';
      for (let i = 1; i <= cantEjes; i++) {
        let row = innerContent.replace(/\$\{i\}/g, i).replace(/\$\{cantEjes\}/g, cantEjes);
        expanded += row + '\n';
      }
      return expanded;
    });

    rawHtml = rawHtml.replace(/<#assign[^>]*>/gi, '');
    rawHtml = rawHtml.replace(/<#list[^>]*>/gi, '');
    rawHtml = rawHtml.replace(/<\/#list>/gi, '');
    rawHtml = rawHtml.replace(/<#if[^>]*>/gi, '');
    rawHtml = rawHtml.replace(/<\/#if>/gi, '');

    const $ = cheerio.load(rawHtml);
    
    const safe = (value) => {
      if (value === null || value === undefined) return '';
      return String(value);
    };

    const setLocation = ($, location, value) => {
      const el = $(`[location="${location}"]`);
      if (el.length > 0) {
          el.html(safe(value));
      }
    };

    Object.keys(resultados).forEach(key => {
      setLocation($, key, resultados[key]);
    });

    console.log('--- HTML Output for frenos-pesoEje1 ---');
    console.log($.html($('[location="frenos-pesoEje1"]').parent()));

  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
run();
