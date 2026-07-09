const db = require('../config/database');

class LineaService {
  async getInspeccionLinea(nroInspeccion) {
    const query = `
      SELECT nrodocumentoinspeccion as nroinspeccion, inspeccionestado_key,
             vehiculo_nromotor
      FROM inspeccion
      WHERE nrodocumentoinspeccion = $1
    `;
    const res = await db.query(query, [nroInspeccion]);
    return res.rows[0];
  }

  async updatePaso(nroInspeccion, paso, data) {
    // Update paso is removed as form_data is no longer used.
    // If needed, we just return the inspection
    const inspeccion = await this.getInspeccionLinea(nroInspeccion);
    if (!inspeccion) throw new Error('Inspección no encontrada');

    return inspeccion;
  }

  async consolidarInspeccion(nroInspeccion, payload) {
    const { ingenieroSeleccionado, tipoInspeccion, tipoCertificado, tipoAutorizacion, observacion, gas } = payload;
    
    // 1. Obtener la inspección
    const queryCheck = `SELECT nrodocumentoinspeccion FROM inspeccion WHERE nrodocumentoinspeccion = $1`;
    const check = await db.query(queryCheck, [nroInspeccion]);
    if (check.rows.length === 0) throw new Error('Inspección no encontrada');

    // 2. Modificamos el estado a 'CON' (Consolidado) y avanzamos la posición
    const queryUpdate = `
      UPDATE inspeccion 
      SET 
        usuarioconsolidado_id = $1,
        inspeccionestado_key = 'CON',
        posicion = 14,
        fechconsolidado = NOW()
      WHERE nrodocumentoinspeccion = $2
      RETURNING *
    `;
    
    // El ingenieroSeleccionado es el username del usuario
    const res = await db.query(queryUpdate, [ingenieroSeleccionado, nroInspeccion]);
    
    return res.rows[0];
  }
}

module.exports = new LineaService();
