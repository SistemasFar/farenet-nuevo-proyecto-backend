const test = require('node:test');
const assert = require('node:assert/strict');
const cheerio = require('cheerio');

const generateConformidadHtml = require('../templates/conformidad.template');
const { PLANTILLA_FAREGAS_HTML } = require('../services/faregas-formatos.templates');
const { renderizarHtml, aplicarLayoutOficialTaller } = require('../services/faregas-formatos-html');

const datosTaller = (tipoCombustible) => ({
  empresa: { resolucion: 'RD-PRUEBA', direccion: 'DIRECCIÓN DINÁMICA', telefono: '999999999', razon_social: 'EMPRESA DINÁMICA' },
  certificado: { titulo: 'CERTIFICADO DE INSPECCIÓN DE TALLER', modalidad: 'ANUAL', numero: 'DG-DINAMICO', fecha_emision: '05 del mes de noviembre del 2026' },
  taller: {
    nombre: 'TALLER DINÁMICO S.A.C.',
    direccion: 'DIRECCIÓN EXTENSA QUE DEBE CRECER SIN SUPERPONERSE CON LA SIGUIENTE FILA DEL DOCUMENTO',
    telefono: '--', ciudad: 'LIMA', representante_legal: 'REPRESENTANTE DINÁMICO', numero_autorizacion: 'AUTORIZACIÓN DINÁMICA'
  },
  inspeccion: { tipo_combustible: tipoCombustible, observaciones: 'OBSERVACIÓN DINÁMICA EXTENSA', fecha_proxima_inspeccion: '05/11/2027' }
});

test('layout Word de Taller aplica tamaño Carta, medidas oficiales y conserva valores dinámicos', () => {
  const data = datosTaller('Gas Licuado del Petróleo – GLP');
  const html = aplicarLayoutOficialTaller(renderizarHtml(PLANTILLA_FAREGAS_HTML, data), data);
  const $ = cheerio.load(html);

  assert.ok($('body').hasClass('faregas-taller-word'));
  assert.ok($('body').hasClass('taller-glp'));
  assert.match($('style#faregas-taller-word-oficial').text(), /size:\s*Letter portrait/);
  assert.match($('style#faregas-taller-word-oficial').text(), /width:\s*432\.1pt/);
  assert.match($('style#faregas-taller-word-oficial').text(), /@media screen[\s\S]*?justify-content:\s*safe center/);
  assert.match($('style#faregas-taller-word-oficial').text(), /flex:\s*0 0 612pt/);
  assert.match($('style#faregas-taller-word-oficial').text(), /@page\s*\{\s*size:\s*Letter portrait;\s*margin:\s*0;\s*\}/);
  assert.equal($('[data-faregas-var="taller.direccion"]').text(), data.taller.direccion);
  assert.equal($('.tabla-info tr').length, 6);
});

test('layout Word de Taller ordena próxima inspección, observaciones y expedición sin mezclar GLP/GNV', () => {
  for (const [combustible, clase] of [
    ['Gas Licuado del Petróleo – GLP', 'taller-glp'],
    ['Gas Natural Vehicular – GNV', 'taller-gnv']
  ]) {
    const data = datosTaller(combustible);
    const $ = cheerio.load(aplicarLayoutOficialTaller(renderizarHtml(PLANTILLA_FAREGAS_HTML, data), data));
    assert.ok($('body').hasClass(clase));
    assert.deepEqual(
      $('.seccion-final > p').map((_i, el) => $(el).attr('class')).get(),
      ['proxima-inspeccion', 'observaciones', 'fecha-expedicion']
    );
  }
});

test('Conformidad conserva datos variables y geometría A4 oficial compartida por sus modalidades', () => {
  const nombreLargo = 'TITULAR DINÁMICO CON RAZÓN SOCIAL EXTENSA S.A.C.';
  const html = generateConformidadHtml({
    cabecera: { numero_certificado: 'DG-39-DINAMICO', fecha_emision: '2026-11-05', placa_nueva: 'ABC123' },
    titulares: [{ nombre_razon_social: nombreLargo }],
    vehiculo: { placa: 'ABC123', clase: 'AUTOMOVIL', categoria: 'M1', serie: 'SERIE-DINAMICA', vin: 'VIN-DINAMICO' },
    conformidad: { tipo_conformidad: 'MONTAJE', marca_montaje: true, caracteristica_registrable: 'CARACTERÍSTICA DINÁMICA', uso_original_vehiculo: 'PERSONAS' }
  }, { modo: 'FINAL' });

  assert.match(html, /padding:\s*107\.45pt 56\.65pt 70\.9pt 84\.75pt/);
  assert.match(html, /width:\s*453\.9pt/);
  assert.match(html, /width:\s*480\.3pt/);
  assert.match(html, /margin:\s*14\.4pt 0 8\.85pt 98\.85pt/);
  assert.match(html, /table\.type-box td\.active \{[\s\S]*?background-color:\s*transparent/);
  assert.match(html, /margin:\s*0 0 11\.6pt -5\.4pt/);
  assert.match(html, /margin:\s*-0\.5pt 0 0 -5\.4pt/);
  assert.match(html, /tr:first-child td \{ height:\s*27\.35pt; \}/);
  assert.match(html, /tr:nth-child\(2\) td \{ height:\s*19\.7pt; \}/);
  assert.match(html, /table\.data-table td\.val \{[\s\S]*?font-size:\s*9pt/);
  assert.match(html, /table\.data-table td:nth-child\(4\)\.val \{ font-size:\s*10pt; \}/);
  assert.match(html, /<colgroup><col style="width:123\.15pt"><col style="width:123\.25pt"><col style="width:113\.4pt"><col style="width:120\.5pt"><\/colgroup>/);
  assert.match(html, /DG-39-DINAMICO/);
  assert.match(html, new RegExp(nombreLargo));
  assert.match(html, /RECTIFICACION DE CARACTERISTICAS REGISTRABLES: \/CARACTERÍSTICA DINÁMICA/);
  assert.match(html, /class="closing-block"/);
  const $ = cheerio.load(html);
  assert.equal($('.placa-certifica').text(), 'ABC123');
  assert.equal($('.grant-plate').text(), 'ABC123');
  assert.equal($('.footer-date strong').length, 0);
});

test('Conformidad normaliza el prefijo registrable y conserva un único slash unido al valor', () => {
  const html = generateConformidadHtml({
    cabecera: { numero_certificado: 'DG-39-SLASH', fecha_emision: '2026-11-05', placa_nueva: 'ABC123' },
    vehiculo: { placa: 'ABC123' },
    conformidad: {
      caracteristica_registrable: 'RECTIFICACIÓN DE CARACTERÍSTICAS REGISTRABLES: / CAMBIO DE MOTOR',
      uso_original_vehiculo: 'PERSONAS'
    }
  }, { modo: 'FINAL' });

  assert.match(html, /RECTIFICACION DE CARACTERISTICAS REGISTRABLES: \/CAMBIO DE MOTOR/);
  assert.doesNotMatch(html, /REGISTRABLES:\s*\/\s+CAMBIO/);
  assert.equal((html.match(/RECTIFICACION DE CARACTERISTICAS REGISTRABLES:/g) || []).length, 1);
});

test('Conformidad usa cabecera institucional configurada sin duplicar el prefijo de resolución', () => {
  const html = generateConformidadHtml({
    cabecera: {
      numero_certificado: 'DG-39-CABECERA',
      fecha_emision: '2026-11-05',
      entidad_certificadora_nombre: 'ENTIDAD CONFIGURADA S.A.C.',
      resolucion_directoral: 'R.D. N° 999-2026-MTC/17.03',
      domicilio_fiscal: 'AV. CONFIGURADA 123|DISTRITO CONFIGURADO - LIMA',
      telefono_certificadora: '999888777'
    },
    vehiculo: { placa: 'ABC123' },
    conformidad: { caracteristica_registrable: 'CAMBIO DE MOTOR', uso_original_vehiculo: 'PERSONAS' }
  }, { modo: 'FINAL' });

  assert.match(html, /R\.D\. N° 999-2026-MTC\/17\.03/);
  assert.doesNotMatch(html, /R\.D\. N° R\.D\./);
  assert.match(html, /Domicilio Fiscal: AV\. CONFIGURADA 123/);
  assert.match(html, /DISTRITO CONFIGURADO - LIMA/);
  assert.match(html, /Celular: 999888777/);
  assert.match(html, /La empresa <strong>ENTIDAD CONFIGURADA S\.A\.C\.<\/strong>/);
  assert.match(html, /<div class="cert-num">N\.º DG-39-CABECERA<\/div>/);
});

test('Conformidad usa la resolución oficial completa cuando la cabecera no trae una configurada', () => {
  const html = generateConformidadHtml({
    cabecera: { numero_certificado: 'DG-39-FALLBACK', fecha_emision: '2026-11-05' },
    vehiculo: { placa: 'ABC123' },
    conformidad: { caracteristica_registrable: 'CAMBIO DE MOTOR', uso_original_vehiculo: 'PERSONAS' }
  }, { modo: 'FINAL' });

  assert.match(html, /R\.D\. N° 282-2022-MTC\/17\.03/);
});
