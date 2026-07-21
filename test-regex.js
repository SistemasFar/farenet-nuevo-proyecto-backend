const html = `<#if hasInspeccion==true><div location="nroDocu"></div></#if>`;
const varName = 'hasInspeccion';
const regex = new RegExp(`<#if\\s+${varName}\\s*==\\s*true\\s*>([\\s\\S]*?)<\\/#if>`, 'gi');
console.log(html.match(regex));
