const fs = require('fs');

const renderFreemarkerCondition = (html, conditionName, value) => {
  let result = '';
  let i = 0;
  let iterations = 0;
  while (i < html.length) {
    iterations++;
    if (iterations > 10000) {
      console.log('INFINITE LOOP DETECTED on ' + conditionName);
      process.exit(1);
    }
    const remaining = html.substring(i);
    const searchRegex = new RegExp('<#if\\\\s+' + conditionName + '(?:\\\\s*==\\\\s*(true|false))?\\\\s*>', 'i');
    const startMatch = remaining.match(searchRegex);
    
    if (!startMatch) {
      result += remaining;
      break;
    }
    
    const idx = i + startMatch.index;
    const endTagIdx = idx + startMatch[0].length - 1;
    
    const isCheckingFalse = startMatch[0].toLowerCase().includes('false');
    const conditionMatches = isCheckingFalse ? !value : !!value;
    
    let nestLevel = 1;
    let j = endTagIdx + 1;
    let elseIdx = -1;
    let endIfIdx = -1;
    let innerIters = 0;
    while (j < html.length) {
      innerIters++;
      if (innerIters > 10000) {
        console.log('INNER INFINITE LOOP on ' + conditionName);
        process.exit(1);
      }
      const nextIfMatch = html.substring(j).match(/<#if\\s/i);
      const nextIf = nextIfMatch ? j + nextIfMatch.index : -1;
      const nextElseMatch = html.substring(j).match(/<#else>/i);
      const nextElse = nextElseMatch ? j + nextElseMatch.index : -1;
      const nextEndMatch = html.substring(j).match(/<\\/#if>/i);
      const nextEnd = nextEndMatch ? j + nextEndMatch.index : -1;
      
      if (nextEnd === -1) break;
      
      const nextTags = [nextIf, nextElse, nextEnd].filter(x => x !== -1).sort((a,b) => a - b);
      const closest = nextTags[0];
      
      if (closest === nextIf) {
        nestLevel++;
        j = nextIf + 5;
      } else if (closest === nextEnd) {
        nestLevel--;
        if (nestLevel === 0) {
          endIfIdx = closest;
          break;
        }
        j = nextEnd + 6;
      } else if (closest === nextElse) {
        if (nestLevel === 1) {
          elseIdx = closest;
        }
        j = nextElse + 7;
      }
    }
    
    if (endIfIdx !== -1) {
      result += html.slice(i, idx);
      const trueContent = html.slice(endTagIdx + 1, elseIdx !== -1 ? elseIdx : endIfIdx);
      const falseContent = elseIdx !== -1 ? html.slice(elseIdx + 7, endIfIdx) : '';
      
      const chosenContent = conditionMatches ? trueContent : falseContent;
      result += renderFreemarkerCondition(chosenContent, conditionName, value);
      
      i = endIfIdx + 6;
    } else {
      result += html.slice(i, endTagIdx + 1);
      i = endTagIdx + 1;
    }
  }
  return result;
};

const html = fs.readFileSync('templates/certificado_inspeccion.html', 'utf8');
console.log('Testing hasInspeccion...');
let h1 = renderFreemarkerCondition(html, 'hasInspeccion', true);
console.log('hasInspeccion done.');
h1 = renderFreemarkerCondition(h1, 'mostrar2daCara', false);
console.log('mostrar2daCara done.');
h1 = renderFreemarkerCondition(h1, 'hasCosto', true);
console.log('hasCosto done.');
console.log('ALL DONE');
