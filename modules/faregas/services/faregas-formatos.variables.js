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

const variableConformidad = (key, label, grupo, demo) => ({ key, label, grupo, tipo: 'text', demo });

const VARIABLES_CONFORMIDAD = [
  variableConformidad('documento.clase_preview', 'Visibilidad de previsualización', 'Documento', ''),
  variableConformidad('documento.fecha_dia', 'Día de emisión', 'Documento', '10'),
  variableConformidad('documento.fecha_mes', 'Mes de emisión', 'Documento', 'septiembre'),
  variableConformidad('documento.fecha_anio', 'Año de emisión', 'Documento', '2026'),
  variableConformidad('titular.nombre', 'Razón social / Persona natural', 'Titular', 'JUAN PEREZ'),
  variableConformidad('titular.direccion', 'Dirección del titular', 'Titular', 'AV. LOS INCAS 123'),
  variableConformidad('vehiculo.placa', 'Placa de rodaje', 'Vehículo', 'ABC123'),
  variableConformidad('vehiculo.clase', 'Clase', 'Vehículo', 'M1'),
  variableConformidad('vehiculo.categoria', 'Categoría', 'Vehículo', 'M1'),
  variableConformidad('vehiculo.modelo', 'Modelo', 'Vehículo', 'YARIS'),
  variableConformidad('vehiculo.marca', 'Marca', 'Vehículo', 'TOYOTA'),
  variableConformidad('vehiculo.serie_chasis', 'Serie / Chasis', 'Vehículo', 'JTDBR32E123456789'),
  variableConformidad('vehiculo.motor', 'Motor', 'Vehículo', '1NZ1234567'),
  variableConformidad('vehiculo.color', 'Color', 'Vehículo', 'PLATA'),
  variableConformidad('vehiculo.carroceria', 'Carrocería', 'Vehículo', 'SEDAN'),
  variableConformidad('vehiculo.combustible', 'Combustible', 'Vehículo', 'GASOLINA'),
  variableConformidad('vehiculo.potencia', 'Potencia', 'Vehículo', '80 / 6000'),
  variableConformidad('vehiculo.asientos', 'Asientos', 'Vehículo', '5'),
  variableConformidad('vehiculo.pasajeros', 'Pasajeros', 'Vehículo', '4'),
  variableConformidad('vehiculo.cilindrada', 'Cilindrada', 'Vehículo', '1497'),
  variableConformidad('vehiculo.cilindros', 'Cilindros', 'Vehículo', '4'),
  variableConformidad('vehiculo.longitud', 'Longitud', 'Vehículo', '4.30'),
  variableConformidad('vehiculo.altura', 'Altura', 'Vehículo', '1.46'),
  variableConformidad('vehiculo.ancho', 'Ancho', 'Vehículo', '1.70'),
  variableConformidad('vehiculo.peso_bruto', 'Peso bruto', 'Vehículo', '1450'),
  variableConformidad('vehiculo.peso_neto', 'Peso neto', 'Vehículo', '1010'),
  variableConformidad('vehiculo.carga_util', 'Carga útil', 'Vehículo', '440'),
  variableConformidad('vehiculo.anio_fabricacion', 'Año de fabricación', 'Vehículo', '2025'),
  variableConformidad('vehiculo.anio_modelo', 'Año de modelo', 'Vehículo', '2026'),
  variableConformidad('vehiculo.formula_rodante', 'Fórmula rodante', 'Vehículo', '4x2'),
  variableConformidad('vehiculo.ejes', 'N° de ejes', 'Vehículo', '2'),
  variableConformidad('vehiculo.ruedas', 'N° de ruedas', 'Vehículo', '4'),
  variableConformidad('vehiculo.version', 'Versión', 'Vehículo', '1.5 GLI'),
  variableConformidad('vehiculo.vin', 'VIN', 'Vehículo', 'JTDBR32E123456789'),
  variableConformidad('conformidad.clase_modificacion', 'Clase activa Modificación', 'Conformidad', 'active'),
  variableConformidad('conformidad.clase_montaje', 'Clase activa Montaje', 'Conformidad', ''),
  variableConformidad('conformidad.clase_fabricacion', 'Clase activa Fabricación', 'Conformidad', ''),
  variableConformidad('conformidad.marca_modificacion', 'Marca Modificación', 'Conformidad', 'X'),
  variableConformidad('conformidad.marca_montaje', 'Marca Montaje', 'Conformidad', ''),
  variableConformidad('conformidad.marca_fabricacion', 'Marca Fabricación', 'Conformidad', ''),
  variableConformidad('conformidad.caracteristica_registrable', 'Característica registrable', 'Conformidad', 'MODIFICACIÓN DE CARACTERÍSTICAS'),
  variableConformidad('conformidad.uso_original_vehiculo', 'Uso original del vehículo', 'Conformidad', 'PERSONAS')
];

const VARIABLES_DISPONIBLES = [...VARIABLES_CATALOG, ...VARIABLES_CONFORMIDAD];

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
  ...VARIABLES_DISPONIBLES,
  ...obtenerVariablesPersonalizadas(configuracion)
];

module.exports = {
  VARIABLES_CATALOG: VARIABLES_DISPONIBLES,
  obtenerVariablesPersonalizadas,
  obtenerCatalogoVariables
};
