const fs = require('fs');
const cheerio = require('cheerio');
const html = fs.readFileSync('test-html.html', 'utf8');
const $ = cheerio.load(html);

console.log("=== HTML ANALYSIS ===");
console.log("Total divs:", $('div').length);
console.log("Total tables:", $('table').length);
console.log("Total images:", $('img').length);

const $main = $('.certificado-inspeccion');
console.log(".certificado-inspeccion width:", $main.css('width'), "style:", $main.attr('style'));

$('*').each((i, el) => {
    const style = $(el).attr('style') || '';
    if (style.match(/margin-[a-z]+:\s*-[0-9]+px/)) {
        console.log(`Element with negative margin found (tag: ${el.name}, id: ${$(el).attr('id')}, class: ${$(el).attr('class')}):`, style);
    }
    if (style.includes('absolute')) {
        console.log(`Element with absolute position found (tag: ${el.name}, id: ${$(el).attr('id')}, class: ${$(el).attr('class')}):`, style);
    }
    if (style.match(/height:\s*[0-9]+px/) && !style.includes('height: auto')) {
        console.log(`Element with fixed height found (tag: ${el.name}, class: ${$(el).attr('class')}):`, style);
    }
});

// Check where the photo is
const $imgs = $('img');
$imgs.each((i, el) => {
   console.log('Image', i, 'src length:', $(el).attr('src')?.length, 'style:', $(el).attr('style'), 'parent class:', $(el).parent().attr('class')); 
});
