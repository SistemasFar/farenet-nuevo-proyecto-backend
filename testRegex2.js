const fs = require('fs');
const cheerio = require('cheerio');
let text = fs.readFileSync('templates/certificado_inspeccion.html', 'utf8');

const evalTag = (html, varName, varValue) => {
    let res = html.replace(new RegExp(`<#if\\s+${varName}\\s*==\\s*true\\s*>([\\s\\S]*?)<\\/#if>`, 'gi'), (match, content) => varValue ? content : '');
    res = res.replace(new RegExp(`<#if\\s+${varName}\\s*==\\s*false\\s*>([\\s\\S]*?)<\\/#if>`, 'gi'), (match, content) => !varValue ? content : '');
    return res;
};

const hasInspeccion = false;
const mostrar2daCara = false;
const hasSello = false;

text = evalTag(text, 'hasInspeccion', hasInspeccion);
text = evalTag(text, 'mostrar2daCara', mostrar2daCara);
text = evalTag(text, 'hasSello', hasSello);
text = evalTag(text, 'hasCosto', true);
text = evalTag(text, 'hasSelloGZ', false);
text = evalTag(text, 'esExtraordinario', false);

console.log("Before cheerio:", text.indexOf("CARACTERISTICAS"));

const $ = cheerio.load(text);
if (mostrar2daCara) {
   const primeraCara = $('.certificado-inspeccion.page-breaker').first();
   primeraCara.find('[location="resolucion"]').closest('.pull-left').remove();
} else {
   $('.certificado-inspeccion.page-breaker').last().remove();
}

console.log("After cheerio:", $.html().indexOf("CARACTERISTICAS"));
