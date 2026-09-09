const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizarNumeroChip,esNumeroChipCertificadoValido,normalizarLoteScanner}=require('../services/faregas-chips.rules');

test('scanner normaliza Enter, espacios y mayusculas',()=>{
  assert.deepEqual(normalizarLoteScanner(' chip001\r\nCHIP002\n'),{validos:['CHIP001','CHIP002'],duplicados:[],errores:[]});
});
test('scanner detecta duplicados sin perder los validos',()=>{
  assert.deepEqual(normalizarLoteScanner('CHIP001\nchip001\nCHIP002'),{validos:['CHIP001','CHIP002'],duplicados:['CHIP001'],errores:[]});
});
test('numero chip conserva identificadores seguros',()=>assert.equal(normalizarNumeroChip(' ab-12/3 '),'AB-12/3'));
test('numero de certificado admite solo el identificador alfanumerico oficial',()=>{
  assert.equal(esNumeroChipCertificadoValido('chip001'),true);
  assert.equal(esNumeroChipCertificadoValido('CHIP-001'),false);
  assert.equal(esNumeroChipCertificadoValido('1234567890123456'),false);
});
