const VARIABLES_CATALOG = [
  {
    key: 'certificado.numero',
    label: 'Número del Certificado',
    grupo: 'Certificado',
    tipo: 'text',
    demo: 'DG-27-95740'
  },
  {
    key: 'certificado.fecha_emision',
    label: 'Fecha de Emisión',
    grupo: 'Certificado',
    tipo: 'date',
    demo: '10/09/2026'
  },
  {
    key: 'certificado.modalidad',
    label: 'Modalidad',
    grupo: 'Certificado',
    tipo: 'text',
    demo: 'Inicial'
  },
  {
    key: 'certificado.titulo',
    label: 'Título del Certificado',
    grupo: 'Certificado',
    tipo: 'text',
    demo: 'CERTIFICADO DE INSPECCIÓN DE TALLER'
  },
  {
    key: 'taller.nombre',
    label: 'Nombre del Taller',
    grupo: 'Taller',
    tipo: 'text',
    demo: 'TALLER DEMO S.A.C.'
  },
  {
    key: 'taller.direccion',
    label: 'Dirección',
    grupo: 'Taller',
    tipo: 'text',
    demo: 'AV. LOS INCAS 123'
  },
  {
    key: 'taller.telefono',
    label: 'Teléfono',
    grupo: 'Taller',
    tipo: 'text',
    demo: '999888777'
  },
  {
    key: 'taller.ciudad',
    label: 'Ciudad',
    grupo: 'Taller',
    tipo: 'text',
    demo: 'LIMA'
  },
  {
    key: 'taller.representante_legal',
    label: 'Representante Legal',
    grupo: 'Taller',
    tipo: 'text',
    demo: 'JUAN PEREZ'
  },
  {
    key: 'taller.numero_autorizacion',
    label: 'N° de Autorización',
    grupo: 'Taller',
    tipo: 'text',
    demo: 'AUT-001-2026'
  },
  {
    key: 'empresa.razon_social',
    label: 'Razón Social Empresa',
    grupo: 'Empresa',
    tipo: 'text',
    demo: 'EMPRESA CERTIFICADORA S.A.'
  },
  {
    key: 'empresa.ruc',
    label: 'RUC Empresa',
    grupo: 'Empresa',
    tipo: 'text',
    demo: '20123456789'
  },
  {
    key: 'empresa.resolucion',
    label: 'Resolución de Autorización',
    grupo: 'Empresa',
    tipo: 'text',
    demo: 'RES-050-2026-MTC'
  },
  {
    key: 'empresa.direccion',
    label: 'Dirección de la Empresa',
    grupo: 'Empresa',
    tipo: 'text',
    demo: 'AV. INDUSTRIAL 123, LIMA'
  },
  {
    key: 'empresa.telefono',
    label: 'Teléfono de la Empresa',
    grupo: 'Empresa',
    tipo: 'text',
    demo: '01 555-0101'
  },
  {
    key: 'inspeccion.observaciones',
    label: 'Observaciones',
    grupo: 'Inspección',
    tipo: 'text',
    demo: 'NINGUNA OBSERVACIÓN RELEVANTE.'
  },
  {
    key: 'inspeccion.fecha_proxima_inspeccion',
    label: 'Fecha Próxima Inspección',
    grupo: 'Inspección',
    tipo: 'date',
    demo: '10/09/2027'
  }
];

const CLAVE_PERSONALIZADA = /^personalizado\.[a-z0-9_]{1,60}$/;

const obtenerVariablesPersonalizadas = (configuracion = {}) => {
  const candidatas = Array.isArray(configuracion?.variables_personalizadas)
    ? configuracion.variables_personalizadas
    : [];
  const unicas = new Map();

  for (const variable of candidatas) {
    const key = String(variable?.key || '').trim();
    const label = String(variable?.label || '').trim().slice(0, 100);
    if (!CLAVE_PERSONALIZADA.test(key) || !label || unicas.has(key)) continue;
    unicas.set(key, {
      key,
      label,
      grupo: 'Personalizadas',
      tipo: 'text',
      demo: String(variable?.demo || `{{${key}}}`).slice(0, 150)
    });
  }
  return [...unicas.values()];
};

const obtenerCatalogoVariables = (configuracion = {}) => [
  ...VARIABLES_CATALOG,
  ...obtenerVariablesPersonalizadas(configuracion)
];

module.exports = {
  VARIABLES_CATALOG,
  obtenerVariablesPersonalizadas,
  obtenerCatalogoVariables
};
