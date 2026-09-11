const fs = require('fs');
const PizZip = require('pizzip');
const path = require('path');
const glob = require('glob');

// Use glob to find the file regardless of encoding issues
const files = glob.sync('C:/Users/Sistemas2/Downloads/CERTIFICADO DE INSPECC*GNV Arequipa.docx');
if (files.length === 0) {
  console.log('File not found using glob');
  process.exit(1);
}
const filePath = files[0];
console.log('Using file:', filePath);

const content = fs.readFileSync(filePath, 'binary');
const zip = new PizZip(content);
const xml = zip.file('word/document.xml').asText();

console.log('Total XML length:', xml.length);
// Check if "CONVERTIGAS S.A.C." exists intact
console.log('Exists intact?', xml.includes('CONVERTIGAS S.A.C.'));
if (!xml.includes('CONVERTIGAS S.A.C.')) {
  // Let's print the part of XML around CONVERTIGAS to see how it's split
  const match = xml.match(/.{0,50}CONVERTIGAS.{0,50}/);
  if(match) console.log('Found CONVERTIGAS:', match[0]);
  else console.log('CONVERTIGAS not found at all');
}
