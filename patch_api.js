const fs = require('fs');

const path = 'c:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\types\\faregas-api.ts';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(/export interface CampoFormatoDinamicoFaregas \{([\s\S]*?)\}/, 
`export interface CampoFormatoDinamicoFaregas {
  key: string;
  label: string;
  grupo: string;
  optionalGroup?: string;
  tipo: 'text' | 'date';
  requerido: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  patternError?: string;
  inputMode?: string;
  soloDigitos?: boolean;
  valor: string;
}`);

fs.writeFileSync(path, content, 'utf8');
console.log('faregas-api.ts patched successfully.');
