const db = require('../config/database');
const operacionModel = require('../models/operacion.model');

const listarInspecciones = async ({
  plantaKey,
  fechaInicio,
  fechaFin,
  placa,
  estado,
  numeroInspeccion,
  cliente,
  lineaKey,
  page = 1,
  pageSize = 5
}) => {
  const values = [];
  const conditions = [];

  values.push(plantaKey);
  conditions.push(`(l.planta_key = $${values.length} OR SPLIT_PART(i.nrodocumentoinspeccion, '-', 2) = $${values.length})`);
  conditions.push(`DATE(i.fechcreacion) = CURRENT_DATE`);

  if (lineaKey && lineaKey.trim() !== '' && lineaKey.trim().toUpperCase() !== 'TODOS') {
    values.push(lineaKey.trim());
    conditions.push(`l.key = $${values.length}`);
  }

  if (placa && placa.trim() !== '') {
    values.push(`%${placa.trim().toUpperCase()}%`);
    conditions.push(`
      UPPER(COALESCE(c.placamotor, ''))
      LIKE $${values.length}
    `);
  }

  if (cliente && cliente.trim() !== '') {
    values.push(`%${cliente.trim().toUpperCase()}%`);

    conditions.push(`
    (
      UPPER(COALESCE(c.placamotor, '')) LIKE $${values.length}
      OR UPPER(COALESCE(c.cliente_nrodocumentoidentidad, '')) LIKE $${values.length}
      OR UPPER(COALESCE(p.nombres, '')) LIKE $${values.length}
      OR UPPER(COALESCE(p.apellidos, '')) LIKE $${values.length}
      OR UPPER(COALESCE(p.nombrerazonsocial, '')) LIKE $${values.length}
      OR UPPER(
        TRIM(
          COALESCE(p.nombres, '') || ' ' || COALESCE(p.apellidos, '')
        )
      ) LIKE $${values.length}
    )
  `);
  }


  if (estado && estado.trim() !== '') {
    const estadoNormalizado =
      estado.trim().toUpperCase() === 'EN_PROCESO'
        ? 'PROCESO'
        : estado.trim().toUpperCase();

    values.push(estadoNormalizado);

    conditions.push(`
      UPPER(
        COALESCE(
          i.inspeccionestado_key,
          ''
        )
      ) = $${values.length}
    `);
  } else {
    conditions.push(`
    UPPER(
      COALESCE(
        i.inspeccionestado_key,
        ''
      )
    ) = 'PROCESO'
  `);
  }

  if (
    numeroInspeccion &&
    numeroInspeccion.trim() !== ''
  ) {
    values.push(
      `%${numeroInspeccion.trim().toUpperCase()}%`
    );

    conditions.push(`
      UPPER(i.nrodocumentoinspeccion)
      LIKE $${values.length}
    `);
  }

  const { total, data } = await operacionModel.listarInspecciones(values, conditions, page, pageSize);
  const totalPages = Math.ceil(total / Number(pageSize));

  return {
    data,
    total,
    page: Number(page),
    pageSize: Number(pageSize),
    totalPages
  };
};

const listarLineas = async (plantaKey) => {
  return await operacionModel.listarLineas(plantaKey);
};

module.exports = {
  listarInspecciones,
  listarLineas
};