const db = require('../../../config/database');
const generateGlpInicialHtml = require('../templates/glp-inicial.template');
const generateGlpAnualHtml = require('../templates/glp-anual.template');
const generateGnvInicialHtml = require('../templates/gnv-inicial.template');
const generateGnvAnualHtml = require('../templates/gnv-anual.template');
const generateConformidadHtml = require('../templates/conformidad.template');

const MOTOR_VERSION = 'SISTEMA';
const TIPO_CONFIGURACION = 'SISTEMA_VISUAL_V1';

const ALINEACIONES = new Set(['left', 'center', 'right', 'justify']);

const DISENO_PREDETERMINADO = Object.freeze({
  textos: {
    titulo: 'CERTIFICADO DE CONFORMIDAD DE CONVERSION GLP',
    certifica: 'CERTIFICA'
  },
  pagina: {
    paddingPx: 20,
    margins: {
      top: 20,
      right: 15,
      bottom: 15,
      left: 15
    }
  },
  titulo: {
    fontSizePx: 16,
    textAlign: 'center',
    marginTopPx: 10,
    marginBottomPx: 5
  },
  cuerpo: {
    fontSizePx: 10.5,
    lineHeight: 1.3
  },
  tablas: {
    fontSizePx: 10,
    cellPaddingPx: 2,
    borderWidthPx: 1
  },
  pie: {
    fontSizePx: 10,
    textAlign: 'center',
    marginTopPx: 10
  }
});

const vehiculoDemo = () => ({
  placa: 'ABC123', categoria: 'N1', clase: 'AUTOMOVIL', marca: 'TOYOTA', modelo: 'YARIS', version: '1222',
  ano_fabricacion: '2020', anio_fabricacion: '2020', anio_modelo: '2020', vin: 'H2I110WKR295C0031',
  serie: 'H2I110WKR295C0031', motor: 'H2I110WKR295C0031', cilindros: 4, cilindrada: 1110,
  combustible: 'GASOLINA', ejes: 2, ruedas: 4, asientos: 5, pasajeros: 4, longitud: 4.3,
  ancho: 1.69, altura: 1.48, peso_neto: 1301, peso_bruto: 1450, carga_util: 149,
  color: 'BLANCO', carroceria: 'SEDAN', potencia: '75 kW @ 4500 RPM', formula_rodante: '4x2'
});

const cabeceraDemo = () => ({
  numero_certificado: 'DG-41-0000000',
  fecha_emision: '2026-11-04',
  cliente_nombre: 'CLIENTE DE DEMOSTRACIÓN',
  observaciones: 'VEHÍCULO EN BUEN ESTADO',
  servicio_tipo_flujo: 'CERTIFICACION'
});

const componentesDemo = (combustible) => [
  { componente: combustible === 'GNV' ? 'REDUCTOR' : 'REGULADOR', marca: 'MARCA DEMO', modelo: 'MODELO R', numero_serie: `${combustible}-REG-0001` },
  { componente: 'CILINDRO', marca: 'MARCA DEMO', modelo: 'MODELO C', numero_serie: `${combustible}-CIL-0001`, capacidad_litros: 45, mes_fabricacion: '01', anio_fabricacion: 2026 }
];

const verificacionesDemo = (cantidad) => Array.from({ length: cantidad }, (_, indice) => ({
  codigo: String(indice + 1),
  descripcion: `Verificación técnica ${indice + 1}`,
  cumple: true
}));

const datosDemoGlpInicial = () => ({
  cabecera: cabeceraDemo(),
  vehiculo: vehiculoDemo(),
  glp: {
    modalidad: 'INICIAL', vigencia_hasta: '2027-11-04', combustible_posterior: 'BI-COMBUSTIBLE GLP',
    peso_neto_posterior: 1321, carga_util_posterior: 129
  },
  titulares: [{ nombre_razon_social: 'PROPIETARIO DE DEMOSTRACIÓN' }],
  componentes: componentesDemo('GLP'),
  verificaciones: verificacionesDemo(7)
});

const datosDemoGlpAnual = () => ({
  cabecera: cabeceraDemo(),
  vehiculo: { ...vehiculoDemo(), combustible: 'GLP' },
  glp: { modalidad: 'ANUAL', vigencia_hasta: '2027-11-04' },
  titulares: [{ nombre_razon_social: 'PROPIETARIO DE DEMOSTRACIÓN' }],
  componentes: componentesDemo('GLP'),
  verificaciones: verificacionesDemo(7)
});

const datosDemoGnvInicial = () => ({
  cabecera: cabeceraDemo(),
  vehiculo: vehiculoDemo(),
  propietario: { nombre_razon_social: 'PROPIETARIO DE DEMOSTRACIÓN' },
  taller: { nombre: 'TALLER AUTORIZADO DE DEMOSTRACIÓN' },
  gnv: { modalidad: 'INICIAL', combustible_posterior: 'BI-COMBUSTIBLE GNV', peso_neto_posterior: 1321 },
  componentes: componentesDemo('GNV')
});

const datosDemoGnvAnual = () => ({
  cabecera: cabeceraDemo(),
  vehiculo: { ...vehiculoDemo(), combustible: 'BI-COMBUSTIBLE GNV' },
  taller: { nombre: 'TALLER AUTORIZADO DE DEMOSTRACIÓN' },
  gnv: { modalidad: 'ANUAL', vigencia_hasta: '2027-11-04' },
  titulares: [{ nombre_razon_social: 'PROPIETARIO DE DEMOSTRACIÓN' }],
  verificaciones: verificacionesDemo(8)
});

const datosDemoConformidad = () => ({
  cabecera: cabeceraDemo(),
  vehiculo: vehiculoDemo(),
  conformidad: {
    marca_modificacion: true,
    marca_montaje: false,
    marca_fabricacion: false,
    caracteristica_registrable: 'RECTIFICACIÓN DE CARACTERÍSTICAS REGISTRABLES',
    uso_original_vehiculo: 'MERCANCÍAS'
  },
  titulares: [{ nombre_razon_social: 'PROPIETARIO DE DEMOSTRACIÓN' }]
});

const disenoPredeterminadoPara = ({ titulo, certifica = 'CERTIFICA' }) => ({
  ...JSON.parse(JSON.stringify(DISENO_PREDETERMINADO)),
  textos: { titulo, certifica }
});

const REGISTRO_FORMATOS_SISTEMA = Object.freeze({
  GLP_INICIAL: {
    nombre: 'Certificado GLP Inicial',
    generador: generateGlpInicialHtml,
    datosDemo: datosDemoGlpInicial,
    disenoPredeterminado: disenoPredeterminadoPara({ titulo: 'CERTIFICADO DE CONFORMIDAD DE CONVERSION GLP' }),
    textos: { titulo: true, certifica: true }
  },
  GLP_ANUAL: {
    nombre: 'Certificado GLP Anual',
    generador: generateGlpAnualHtml,
    datosDemo: datosDemoGlpAnual,
    disenoPredeterminado: disenoPredeterminadoPara({ titulo: 'CERTIFICADO DE INSPECCION DEL VEHICULO A GLP', certifica: '' }),
    textos: { titulo: true, certifica: false }
  },
  GNV_INICIAL: {
    nombre: 'Certificado GNV Inicial',
    generador: generateGnvInicialHtml,
    datosDemo: datosDemoGnvInicial,
    disenoPredeterminado: disenoPredeterminadoPara({ titulo: 'CERTIFICADO DE CONFORMIDAD DE CONVERSIÓN A GNV', certifica: 'CERTIFICA:' }),
    textos: { titulo: true, certifica: true }
  },
  GNV_ANUAL: {
    nombre: 'Certificado GNV Anual',
    generador: generateGnvAnualHtml,
    datosDemo: datosDemoGnvAnual,
    disenoPredeterminado: disenoPredeterminadoPara({ titulo: 'CERTIFICADO DE INSPECCION ANUAL DEL VEHICULO A GNV' }),
    textos: { titulo: true, certifica: true }
  },
  CONFORMIDAD: {
    nombre: 'Certificado de Conformidad',
    generador: generateConformidadHtml,
    datosDemo: datosDemoConformidad,
    disenoPredeterminado: disenoPredeterminadoPara({ titulo: 'CERTIFICADO DE CONFORMIDAD', certifica: 'CERTIFICA:' }),
    textos: { titulo: true, certifica: true }
  }
});

const obtenerRegistroFormato = (codigo) => REGISTRO_FORMATOS_SISTEMA[String(codigo || '').trim().toUpperCase()] || null;

const clonar = (valor) => JSON.parse(JSON.stringify(valor));

const esObjetoPlano = (valor) => valor && typeof valor === 'object' && !Array.isArray(valor);

const validarClaves = (objeto, permitidas, contexto) => {
  if (!esObjetoPlano(objeto)) throw new Error(`${contexto} debe ser un objeto`);
  const desconocidas = Object.keys(objeto).filter((clave) => !permitidas.includes(clave));
  if (desconocidas.length > 0) {
    throw new Error(`${contexto} contiene propiedades no permitidas: ${desconocidas.join(', ')}`);
  }
};

const numeroEnRango = (valor, minimo, maximo, nombre) => {
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero < minimo || numero > maximo) {
    throw new Error(`${nombre} debe estar entre ${minimo} y ${maximo}`);
  }
  return Math.round(numero * 100) / 100;
};

const textoSeguro = (valor, maximo, nombre) => {
  const texto = String(valor ?? '').trim();
  if (!texto || texto.length > maximo || /[<>]/.test(texto)) {
    throw new Error(`${nombre} no es válido`);
  }
  return texto;
};

const alineacionSegura = (valor, nombre) => {
  const alineacion = String(valor || '').toLowerCase();
  if (!ALINEACIONES.has(alineacion)) throw new Error(`${nombre} no es válida`);
  return alineacion;
};

const normalizarDiseno = (entrada = {}, predeterminado = DISENO_PREDETERMINADO) => {
  validarClaves(entrada, ['textos', 'pagina', 'titulo', 'cuerpo', 'tablas', 'pie'], 'El diseño');
  const base = clonar(predeterminado);

  if (entrada.textos !== undefined) {
    validarClaves(entrada.textos, ['titulo', 'certifica'], 'textos');
    if (entrada.textos.titulo !== undefined) base.textos.titulo = textoSeguro(entrada.textos.titulo, 160, 'El título');
    if (entrada.textos.certifica !== undefined) {
      const certifica = String(entrada.textos.certifica ?? '').trim();
      base.textos.certifica = certifica === '' && base.textos.certifica === ''
        ? ''
        : textoSeguro(certifica, 40, 'El subtítulo');
    }
  }
  if (entrada.pagina !== undefined) {
    validarClaves(entrada.pagina, ['paddingPx', 'margins'], 'pagina');
    if (entrada.pagina.paddingPx !== undefined) {
      base.pagina.paddingPx = numeroEnRango(entrada.pagina.paddingPx, 8, 60, 'El margen de página');
    }
    if (entrada.pagina.margins !== undefined) {
      validarClaves(entrada.pagina.margins, ['top', 'right', 'bottom', 'left'], 'pagina.margins');
      const margins = { ...base.pagina.margins };
      for (const side of ['top', 'right', 'bottom', 'left']) {
        if (entrada.pagina.margins[side] !== undefined) {
          margins[side] = numeroEnRango(entrada.pagina.margins[side], 0, 60, `El margen ${side}`);
        }
      }
      base.pagina.margins = margins;
    }
  }
  if (entrada.titulo !== undefined) {
    validarClaves(entrada.titulo, ['fontSizePx', 'textAlign', 'marginTopPx', 'marginBottomPx'], 'titulo');
    if (entrada.titulo.fontSizePx !== undefined) base.titulo.fontSizePx = numeroEnRango(entrada.titulo.fontSizePx, 10, 28, 'El tamaño del título');
    if (entrada.titulo.textAlign !== undefined) base.titulo.textAlign = alineacionSegura(entrada.titulo.textAlign, 'La alineación del título');
    if (entrada.titulo.marginTopPx !== undefined) base.titulo.marginTopPx = numeroEnRango(entrada.titulo.marginTopPx, 0, 40, 'El margen superior del título');
    if (entrada.titulo.marginBottomPx !== undefined) base.titulo.marginBottomPx = numeroEnRango(entrada.titulo.marginBottomPx, 0, 40, 'El margen inferior del título');
  }
  if (entrada.cuerpo !== undefined) {
    validarClaves(entrada.cuerpo, ['fontSizePx', 'lineHeight'], 'cuerpo');
    if (entrada.cuerpo.fontSizePx !== undefined) base.cuerpo.fontSizePx = numeroEnRango(entrada.cuerpo.fontSizePx, 8, 14, 'El tamaño del cuerpo');
    if (entrada.cuerpo.lineHeight !== undefined) base.cuerpo.lineHeight = numeroEnRango(entrada.cuerpo.lineHeight, 1, 2, 'El interlineado');
  }
  if (entrada.tablas !== undefined) {
    validarClaves(entrada.tablas, ['fontSizePx', 'cellPaddingPx', 'borderWidthPx'], 'tablas');
    if (entrada.tablas.fontSizePx !== undefined) base.tablas.fontSizePx = numeroEnRango(entrada.tablas.fontSizePx, 7, 13, 'El tamaño de las tablas');
    if (entrada.tablas.cellPaddingPx !== undefined) base.tablas.cellPaddingPx = numeroEnRango(entrada.tablas.cellPaddingPx, 0, 10, 'El espaciado de las celdas');
    if (entrada.tablas.borderWidthPx !== undefined) base.tablas.borderWidthPx = numeroEnRango(entrada.tablas.borderWidthPx, 0, 3, 'El borde de las tablas');
  }
  if (entrada.pie !== undefined) {
    validarClaves(entrada.pie, ['fontSizePx', 'textAlign', 'marginTopPx'], 'pie');
    if (entrada.pie.fontSizePx !== undefined) base.pie.fontSizePx = numeroEnRango(entrada.pie.fontSizePx, 7, 14, 'El tamaño del pie');
    if (entrada.pie.textAlign !== undefined) base.pie.textAlign = alineacionSegura(entrada.pie.textAlign, 'La alineación del pie');
    if (entrada.pie.marginTopPx !== undefined) base.pie.marginTopPx = numeroEnRango(entrada.pie.marginTopPx, 0, 40, 'El margen del pie');
  }
  return base;
};

const escaparHtml = (valor) => String(valor)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const reemplazarTextoEstatico = (html, marcador, texto) => {
  const patron = new RegExp(`(<[^>]+data-sistema-edicion=["']${marcador}["'][^>]*>)([\\s\\S]*?)(<\\/[^>]+>)`);
  return html.replace(patron, `$1${escaparHtml(texto)}$3`);
};

const aplicarDisenoAHtml = (htmlBase, entrada = {}, codigoFormato = 'GLP_INICIAL') => {
  const registro = obtenerRegistroFormato(codigoFormato);
  if (!registro) throw new Error(`El formato ${codigoFormato} no posee un generador visual autorizado`);
  const diseno = normalizarDiseno(entrada, registro.disenoPredeterminado);
  let html = String(htmlBase || '');
  if (!html.includes('data-sistema-edicion="titulo"')) {
    throw new Error(`La plantilla real ${codigoFormato} no contiene los marcadores visuales esperados`);
  }
  html = reemplazarTextoEstatico(html, 'titulo', diseno.textos.titulo);
  if (registro.textos.certifica) {
    html = reemplazarTextoEstatico(html, 'titulo-certifica', diseno.textos.certifica);
  }
  const margins = diseno.pagina.margins || {};
  const paddingCss = Object.keys(margins).length
    ? `${margins.top}px ${margins.right}px ${margins.bottom}px ${margins.left}px`
    : `${diseno.pagina.paddingPx}px`;
  const css = `
<style id="faregas-diseno-sistema-visual">
  body { padding: ${paddingCss} !important; font-size: ${diseno.cuerpo.fontSizePx}px !important; line-height: ${diseno.cuerpo.lineHeight} !important; }
  [data-sistema-edicion="titulo"] { font-size: ${diseno.titulo.fontSizePx}px !important; text-align: ${diseno.titulo.textAlign} !important; margin-top: ${diseno.titulo.marginTopPx}px !important; margin-bottom: ${diseno.titulo.marginBottomPx}px !important; }
  table { font-size: ${diseno.tablas.fontSizePx}px !important; }
  table td, table th { padding: ${diseno.tablas.cellPaddingPx}px !important; border-width: ${diseno.tablas.borderWidthPx}px !important; }
  [data-sistema-edicion="pie"] { font-size: ${diseno.pie.fontSizePx}px !important; text-align: ${diseno.pie.textAlign} !important; margin-top: ${diseno.pie.marginTopPx}px !important; }
</style>`;
  return html.includes('</head>') ? html.replace('</head>', `${css}\n</head>`) : `${css}${html}`;
};

const parsearConfiguracion = (valor) => {
  if (!valor) return {};
  if (typeof valor === 'string') {
    try { return JSON.parse(valor); } catch (_error) { return {}; }
  }
  return esObjetoPlano(valor) ? valor : {};
};

const esConfiguracionVisualSistema = (valor) => parsearConfiguracion(valor).tipo === TIPO_CONFIGURACION;

const debeAplicarDisenoVisual = ({ estado, versionAsignadaId, versionResueltaId, configuracion, codigoFormato = null }) => {
  if (!esConfiguracionVisualSistema(configuracion)) return false;
  const configuracionParseada = parsearConfiguracion(configuracion);
  if (codigoFormato && configuracionParseada.codigoFormato !== codigoFormato) return false;
  if (estado !== 'EMITIDO') return true;
  return Boolean(versionAsignadaId)
    && Number(versionAsignadaId) === Number(versionResueltaId);
};

const disenoDesdeConfiguracion = (valor, codigoFormato = 'GLP_INICIAL') => {
  const configuracion = parsearConfiguracion(valor);
  const registro = obtenerRegistroFormato(codigoFormato);
  if (!registro) throw new Error(`El formato ${codigoFormato} no posee un generador visual autorizado`);
  return normalizarDiseno(configuracion.tipo === TIPO_CONFIGURACION ? configuracion.diseno : {}, registro.disenoPredeterminado);
};

const configuracionParaGuardar = (codigoFormato, diseno) => {
  const registro = obtenerRegistroFormato(codigoFormato);
  if (!registro) throw new Error(`El formato ${codigoFormato} no posee un generador visual autorizado`);
  return ({
  tipo: TIPO_CONFIGURACION,
  codigoFormato,
  diseno: normalizarDiseno(diseno, registro.disenoPredeterminado)
  });
};

const comprobarFormato = async (cliente, formatoId, bloquear = false) => {
  const resultado = await cliente.query(
    `SELECT id, codigo, motor, es_protegido, activo
     FROM fg_certificado_formato
     WHERE id = $1${bloquear ? ' FOR UPDATE' : ''}`,
    [formatoId]
  );
  if (resultado.rowCount === 0) throw new Error('Formato no encontrado');
  const formato = resultado.rows[0];
  const registro = obtenerRegistroFormato(formato.codigo);
  if (!registro || formato.motor !== 'SISTEMA' || !formato.es_protegido) {
    throw new Error(`El formato ${formato.codigo} no posee un generador visual seguro registrado`);
  }
  if (!formato.activo) throw new Error(`El formato ${formato.codigo} está inactivo`);
  return { ...formato, registro };
};

const mapearVersion = (fila, codigoFormato) => fila ? ({
  id: Number(fila.id),
  version: Number(fila.version),
  estado: fila.estado,
  motor: fila.motor,
  diseno: disenoDesdeConfiguracion(fila.configuracion, codigoFormato),
  creadoEn: fila.creado_en || null,
  vigenteDesde: fila.vigente_desde || null
}) : null;

const consultarVersionesVisuales = async (cliente, formatoId) => {
  const resultado = await cliente.query(
    `SELECT id, version, estado, motor, configuracion, creado_en, vigente_desde
     FROM fg_certificado_formato_version
     WHERE formato_id = $1
       AND motor = $2
       AND configuracion->>'tipo' = $3
     ORDER BY version DESC`,
    [formatoId, MOTOR_VERSION, TIPO_CONFIGURACION]
  );
  return resultado.rows;
};

const obtenerEstadoDiseno = async (formatoId) => {
  const formato = await comprobarFormato(db, formatoId);
  const versiones = await consultarVersionesVisuales(db, formatoId);
  return {
    formatoId: Number(formatoId),
    codigo: formato.codigo,
    nombre: formato.registro.nombre,
    capacidades: { textos: { ...formato.registro.textos } },
    borrador: mapearVersion(versiones.find((version) => version.estado === 'BORRADOR'), formato.codigo),
    vigente: mapearVersion(versiones.find((version) => version.estado === 'VIGENTE'), formato.codigo),
    historial: versiones.filter((version) => version.estado === 'RETIRADA').map((version) => mapearVersion(version, formato.codigo)),
    disenoPredeterminado: clonar(formato.registro.disenoPredeterminado)
  };
};

const crearBorrador = async (formatoId) => {
  const cliente = await db.connect();
  try {
    await cliente.query('BEGIN');
    const formato = await comprobarFormato(cliente, formatoId, true);
    const existentes = await consultarVersionesVisuales(cliente, formatoId);
    const borradorExistente = existentes.find((version) => version.estado === 'BORRADOR');
    if (borradorExistente) {
      await cliente.query('COMMIT');
      return { version: mapearVersion(borradorExistente, formato.codigo), reutilizada: true };
    }
    const vigente = existentes.find((version) => version.estado === 'VIGENTE');
    const siguiente = await cliente.query(
      'SELECT COALESCE(MAX(version), 0) + 1 AS numero FROM fg_certificado_formato_version WHERE formato_id = $1',
      [formatoId]
    );
    const configuracion = configuracionParaGuardar(
      formato.codigo,
      vigente ? disenoDesdeConfiguracion(vigente.configuracion, formato.codigo) : {}
    );
    const insertado = await cliente.query(
      `INSERT INTO fg_certificado_formato_version
        (formato_id, version, archivo_ruta, configuracion, estado, motor)
       VALUES ($1, $2, 'SISTEMA_VISUAL', $3::jsonb, 'BORRADOR', $4)
       RETURNING id, version, estado, motor, configuracion, creado_en, vigente_desde`,
      [formatoId, siguiente.rows[0].numero, JSON.stringify(configuracion), MOTOR_VERSION]
    );
    await cliente.query('COMMIT');
    return { version: mapearVersion(insertado.rows[0], formato.codigo), reutilizada: false };
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  } finally {
    cliente.release();
  }
};

const guardarBorrador = async (formatoId, versionId, diseno) => {
  const formato = await comprobarFormato(db, formatoId);
  const configuracion = configuracionParaGuardar(formato.codigo, diseno);
  const actualizado = await db.query(
    `UPDATE fg_certificado_formato_version
     SET configuracion = $1::jsonb
     WHERE id = $2 AND formato_id = $3 AND estado = 'BORRADOR' AND motor = $4
       AND configuracion->>'tipo' = $5
     RETURNING id, version, estado, motor, configuracion, creado_en, vigente_desde`,
    [JSON.stringify(configuracion), versionId, formatoId, MOTOR_VERSION, TIPO_CONFIGURACION]
  );
  if (actualizado.rowCount === 0) throw new Error('El borrador visual no existe o ya no es editable');
  return mapearVersion(actualizado.rows[0], formato.codigo);
};

const obtenerDisenoVersion = async (formatoId, versionId, codigoFormato) => {
  const resultado = await db.query(
    `SELECT configuracion
     FROM fg_certificado_formato_version
     WHERE id = $1 AND formato_id = $2 AND motor = $3 AND configuracion->>'tipo' = $4`,
    [versionId, formatoId, MOTOR_VERSION, TIPO_CONFIGURACION]
  );
  if (resultado.rowCount === 0) throw new Error('Versión visual no encontrada');
  const configuracion = parsearConfiguracion(resultado.rows[0].configuracion);
  if (configuracion.codigoFormato !== codigoFormato) throw new Error('La versión visual pertenece a otro formato');
  return disenoDesdeConfiguracion(configuracion, codigoFormato);
};

const generarPreview = async (formatoId, { versionId = null, diseno = null } = {}) => {
  const formato = await comprobarFormato(db, formatoId);
  const disenoAplicable = diseno !== null
    ? normalizarDiseno(diseno, formato.registro.disenoPredeterminado)
    : (versionId
      ? await obtenerDisenoVersion(formatoId, versionId, formato.codigo)
      : clonar(formato.registro.disenoPredeterminado));
  const htmlBase = formato.registro.generador(formato.registro.datosDemo(), { modo: 'PREVIEW' });
  return {
    html: aplicarDisenoAHtml(htmlBase, disenoAplicable, formato.codigo),
    diseno: disenoAplicable,
    codigo: formato.codigo,
    nombre: formato.registro.nombre,
    capacidades: { textos: { ...formato.registro.textos } }
  };
};

const activarBorrador = async (formatoId, versionId) => {
  const cliente = await db.connect();
  try {
    await cliente.query('BEGIN');
    const formato = await comprobarFormato(cliente, formatoId, true);
    const version = await cliente.query(
      `SELECT id, version, estado, motor, configuracion, creado_en, vigente_desde
       FROM fg_certificado_formato_version
       WHERE id = $1 AND formato_id = $2
       FOR UPDATE`,
      [versionId, formatoId]
    );
    if (version.rowCount === 0 || version.rows[0].estado !== 'BORRADOR'
      || version.rows[0].motor !== MOTOR_VERSION || !esConfiguracionVisualSistema(version.rows[0].configuracion)) {
      throw new Error('La versión seleccionada no es un borrador visual activable');
    }
    await cliente.query(
      `UPDATE fg_certificado_formato_version
       SET estado = 'RETIRADA'
       WHERE formato_id = $1 AND estado = 'VIGENTE'`,
      [formatoId]
    );
    const activada = await cliente.query(
      `UPDATE fg_certificado_formato_version
       SET estado = 'VIGENTE', vigente_desde = CURRENT_TIMESTAMP
       WHERE id = $1 AND formato_id = $2
       RETURNING id, version, estado, motor, configuracion, creado_en, vigente_desde`,
      [versionId, formatoId]
    );
    await cliente.query('COMMIT');
    return mapearVersion(activada.rows[0], formato.codigo);
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  } finally {
    cliente.release();
  }
};

module.exports = {
  CODIGOS_FORMATO_SOPORTADOS: Object.freeze(Object.keys(REGISTRO_FORMATOS_SISTEMA)),
  REGISTRO_FORMATOS_SISTEMA,
  MOTOR_VERSION,
  TIPO_CONFIGURACION,
  DISENO_PREDETERMINADO,
  obtenerRegistroFormato,
  normalizarDiseno,
  aplicarDisenoAHtml,
  esConfiguracionVisualSistema,
  debeAplicarDisenoVisual,
  disenoDesdeConfiguracion,
  datosDemoGlpInicial,
  datosDemoGlpAnual,
  datosDemoGnvInicial,
  datosDemoGnvAnual,
  datosDemoConformidad,
  obtenerEstadoDiseno,
  crearBorrador,
  guardarBorrador,
  generarPreview,
  activarBorrador
};
