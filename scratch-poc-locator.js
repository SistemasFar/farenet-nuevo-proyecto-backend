const fs = require('fs');
const PizZip = require('pizzip');
const path = require('path');
const glob = require('glob');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');

function getParagraphTextAndMappings(pNode) {
    const wtElements = pNode.getElementsByTagName('w:t');
    let text = '';
    const mappings = [];
    for (let i = 0; i < wtElements.length; i++) {
        const node = wtElements[i];
        const t = node.textContent || '';
        for (let j = 0; j < t.length; j++) {
            mappings.push({ node, offset: j });
        }
        text += t;
    }
    return { text, mappings };
}

function extractDocumentStructure(xmlString, partName) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, 'text/xml');
    const pElements = doc.getElementsByTagName('w:p');
    
    const paragraphs = [];
    for (let i = 0; i < pElements.length; i++) {
        const pNode = pElements[i];
        const { text } = getParagraphTextAndMappings(pNode);
        paragraphs.push({ part: partName, index: i, text });
    }
    return { paragraphs, doc };
}

function applyMapping(doc, pIndex, startOffset, endOffset, variable) {
    const pElements = doc.getElementsByTagName('w:p');
    const pNode = pElements[pIndex];
    if (!pNode) return false;
    
    const { text, mappings } = getParagraphTextAndMappings(pNode);
    if (startOffset < 0 || endOffset >= text.length || startOffset > endOffset) return false;
    
    const startMap = mappings[startOffset];
    const endMap = mappings[endOffset];
    
    // We keep the style of the start node. We will put '{' + variable + '}' in start node.
    const startNode = startMap.node;
    const endNode = endMap.node;
    
    if (startNode === endNode) {
        const t = startNode.textContent;
        startNode.textContent = t.substring(0, startMap.offset) + '{' + variable + '}' + t.substring(endMap.offset + 1);
    } else {
        startNode.textContent = startNode.textContent.substring(0, startMap.offset) + '{' + variable + '}';
        
        // clear middle nodes
        let started = false;
        for (let i = startOffset + 1; i < endOffset; i++) {
            const map = mappings[i];
            if (map.node !== startNode && map.node !== endNode) {
                map.node.textContent = '';
            }
        }
        
        endNode.textContent = endNode.textContent.substring(endMap.offset + 1);
    }
    return true;
}

function testDoc(filename) {
    const files = glob.sync('C:/Users/Sistemas2/Downloads/' + filename);
    if (!files.length) { console.log('Not found:', filename); return; }
    
    const content = fs.readFileSync(files[0], 'binary');
    const zip = new PizZip(content);
    
    // Find all xml files that might contain text
    const parts = ['word/document.xml'];
    for (let f in zip.files) {
        if (f.startsWith('word/header') || f.startsWith('word/footer')) {
            parts.push(f);
        }
    }
    
    console.log('Testing', filename);
    let foundTarget = null;
    
    for (const part of parts) {
        const xml = zip.file(part).asText();
        const { paragraphs, doc } = extractDocumentStructure(xml, part);
        
        // Find something to replace
        for (let i = 0; i < paragraphs.length; i++) {
            const p = paragraphs[i];
            if (p.text.includes('CONVERTIGAS S.A.C.') || p.text.includes('09/2026') || p.text.includes('DG-')) {
                // Just as an example, grab the first thing we can find
                let search = 'CONVERTIGAS S.A.C.';
                if (!p.text.includes(search)) search = '09/2026'; // fallback
                if (!p.text.includes(search)) search = 'DG-'; // fallback
                
                const idx = p.text.indexOf(search);
                if (idx !== -1 && !foundTarget) {
                    foundTarget = { part, index: i, start: idx, end: idx + search.length - 1, search };
                    console.log('Found target:', foundTarget.search, 'in part:', part, 'pIndex:', i);
                    
                    // Apply
                    applyMapping(doc, i, idx, idx + search.length - 1, 'taller.nombre');
                    const serializer = new XMLSerializer();
                    zip.file(part, serializer.serializeToString(doc));
                }
            }
        }
    }
    
    if (foundTarget) {
        const buf = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
        fs.writeFileSync('C:/Users/Sistemas2/Downloads/TEST_RESULT_' + filename.replace(/[*?]/g, ''), buf);
        console.log('Saved modified docx to Downloads/TEST_RESULT_...');
    }
}

testDoc('CERTIFICADO DE INSPECC*GNV Arequipa.docx');
testDoc('CERTIFICADO DE INSPECC*GLP SURQUILLO.docx');

