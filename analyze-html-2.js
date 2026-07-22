const fs = require('fs');
const cheerio = require('cheerio');
const html = fs.readFileSync('test-html.html', 'utf8');
const $ = cheerio.load(html);

console.log('Tables:');
$('table').each((i, el) => {
    console.log(`Table ${i}: width = ${$(el).attr('width') || 'none'}, style = ${$(el).attr('style') || 'none'}`);
});

console.log('\nDivs with fixed heights:');
$('div').each((i, el) => {
    const style = $(el).attr('style');
    if (style && style.includes('height:')) {
        console.log(`Div height style: ${style}`);
    }
});

// Check if any element overlaps by having absolute positioning or negative margins
console.log('\nElements with possible overlapping styles:');
$('*').each((i, el) => {
    const style = $(el).attr('style');
    if (style && (style.includes('position: absolute') || style.includes('margin-top: -') || style.includes('margin-bottom: -') || style.includes('float'))) {
        console.log(`Tag: ${el.name}, id: ${$(el).attr('id') || ''}, class: ${$(el).attr('class') || ''} -> style: ${style}`);
    }
});
