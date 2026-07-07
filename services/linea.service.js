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
}

module.exports = new LineaService();
