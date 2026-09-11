const fs = require('fs');
const PizZip = require('pizzip');
const path = require('path');
const glob = require('glob');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');

function replaceTextAcrossRuns(xmlString, searchText, replacementText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, 'text/xml');
    
    // Get all <w:t> elements
    const wtElements = doc.getElementsByTagName('w:t');
    
    let fullText = '';
    const nodeMappings = []; // Maps character index in fullText to { node, offsetInNode }
    
    for (let i = 0; i < wtElements.length; i++) {
        const node = wtElements[i];
        const textContent = node.textContent || '';
        
        for (let j = 0; j < textContent.length; j++) {
            nodeMappings.push({
                node: node,
                nodeIndex: j
            });
        }
        fullText += textContent;
    }
    
    // Find searchText in fullText
    const startIndex = fullText.indexOf(searchText);
    if (startIndex === -1) {
        return { success: false, xml: xmlString };
    }
    
    const endIndex = startIndex + searchText.length - 1;
    
    // Get the nodes involved
    const startMapping = nodeMappings[startIndex];
    const endMapping = nodeMappings[endIndex];
    
    // We will place the replacementText in the start node.
    // And clear the matched text from all involved nodes.
    
    // Collect all unique nodes involved in the match
    const involvedNodes = new Set();
    for (let i = startIndex; i <= endIndex; i++) {
        involvedNodes.add(nodeMappings[i].node);
    }
    
    let replacementInserted = false;
    
    for (const node of involvedNodes) {
        let newNodeText = '';
        const originalText = node.textContent;
        
        // Build the new text for this node
        for (let j = 0; j < originalText.length; j++) {
            // Check if this character index is part of the match
            // Find its global index
            let isMatched = false;
            let globalIndex = -1;
            
            // This is naive, let's optimize:
            // Just find if there's a mapping that points to this node and offset, and is within [startIndex, endIndex]
        }
    }

    // Better approach:
    // We have the start node and end node.
    // Modify the start node to contain: [text before match] + replacementText + [text after match in same node if end node is the same]
    
    if (startMapping.node === endMapping.node) {
        // Simple case: all in one node
        const node = startMapping.node;
        const text = node.textContent;
        node.textContent = text.substring(0, startMapping.nodeIndex) + replacementText + text.substring(endMapping.nodeIndex + 1);
    } else {
        // Spans multiple nodes
        // 1. Modify start node
        const sNode = startMapping.node;
        sNode.textContent = sNode.textContent.substring(0, startMapping.nodeIndex) + replacementText;
        
        // 2. Modify middle nodes (clear them)
        let middleNodesStarted = false;
        for (let i = startIndex + 1; i < endIndex; i++) {
            const currentMapping = nodeMappings[i];
            if (currentMapping.node !== startMapping.node && currentMapping.node !== endMapping.node) {
                currentMapping.node.textContent = ''; // Or we can just set it empty once
            }
        }
        
        // 3. Modify end node
        const eNode = endMapping.node;
        eNode.textContent = eNode.textContent.substring(endMapping.nodeIndex + 1);
    }
    
    const serializer = new XMLSerializer();
    return { success: true, xml: serializer.serializeToString(doc) };
}

const files = glob.sync('C:/Users/Sistemas2/Downloads/CERTIFICADO DE INSPECC*GNV Arequipa.docx');
const filePath = files[0];
const content = fs.readFileSync(filePath, 'binary');
const zip = new PizZip(content);
const xml = zip.file('word/document.xml').asText();

console.log('Original has CONVERTIGAS S.A.C.:', xml.includes('CONVERTIGAS S.A.C.'));

// Let's artificially break it across runs to test the algorithm
let brokenXml = xml.replace('<w:t>CONVERTIGAS S.A.C.</w:t>', '<w:t>CONVER</w:t></w:r><w:r><w:t>TIGAS S.A.C.</w:t>');
console.log('Broken XML has CONVERTIGAS S.A.C. intact?:', brokenXml.includes('CONVERTIGAS S.A.C.'));

const result = replaceTextAcrossRuns(brokenXml, 'CONVERTIGAS S.A.C.', '{taller.nombre}');
console.log('Replacement success:', result.success);
if (result.success) {
    console.log('Result has {taller.nombre}:', result.xml.includes('{taller.nombre}'));
    console.log('Result has CONVERTIGAS S.A.C.:', result.xml.includes('CONVERTIGAS S.A.C.'));
}
