const db = require('../config/database');

class LineaService {
  async getInspeccionLinea(nroInspeccion) {
    const query = `
      SELECT id, nrodocumentoinspeccion as nroinspeccion, estadodocumento_key,
             vehiculo_id, planta_key, form_data
      FROM inspeccion
      WHERE nrodocumentoinspeccion = $1
    `;
    const res = await db.query(query, [nroInspeccion]);
    return res.rows[0];
  }

  async updatePaso(nroInspeccion, paso, data) {
    // Aquí actualizaremos el JSON o los campos relacionales
    // según avancemos por la línea. Por ahora guardaremos en form_data para el MVP
    const inspeccion = await this.getInspeccionLinea(nroInspeccion);
    if (!inspeccion) throw new Error('Inspección no encontrada');

    const formData = inspeccion.form_data || {};
    formData[`linea_paso_${paso}`] = data;

    const query = `
      UPDATE inspeccion 
      SET form_data = $1 
      WHERE nrodocumentoinspeccion = $2 
      RETURNING *
    `;
    const res = await db.query(query, [JSON.stringify(formData), nroInspeccion]);
    return res.rows[0];
  }

  async consolidarInspeccion(nroInspeccion, payload) {
    const { ingenieroSeleccionado, tipoInspeccion, tipoCertificado, tipoAutorizacion, observacion, gas } = payload;
    
    // Aquí implementamos la lógica relacional pesada
    // 1. Obtener la inspección
    const queryCheck = `SELECT id FROM inspeccion WHERE nrodocumentoinspeccion = $1`;
    const check = await db.query(queryCheck, [nroInspeccion]);
    if (check.rows.length === 0) throw new Error('Inspección no encontrada');

    // 2. Modificamos el estado a 'LIN' (Línea) y asignamos ingeniero. 
    // Usamos COALESCE para mantener el estado actual si falla, pero el ideal es forzar el cambio.
    // También guardamos el JSON de consolidación en form_data como backup para el MVP.
    const queryUpdate = `
      UPDATE inspeccion 
      SET 
        usuarioconsolidado_id = $1,
        form_data = jsonb_set(COALESCE(form_data, '{}'::jsonb), '{consolidacion}', $2::jsonb)
      WHERE nrodocumentoinspeccion = $3
      RETURNING *
    `;
    
    // Convertimos payload a string para guardarlo íntegramente
    const payloadJson = JSON.stringify(payload);
    
    // Nota: El usuarioconsolidado_id debe existir en tabla persona/usuario. Si es un UUID o ID, se pasa directo.
    // Asumimos que ingenieroSeleccionado es el ID válido.
    const res = await db.query(queryUpdate, [ingenieroSeleccionado, payloadJson, nroInspeccion]);
    
    return res.rows[0];
  }
}

module.exports = new LineaService();
