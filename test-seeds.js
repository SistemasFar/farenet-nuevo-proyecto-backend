const pool = require('./config/database');

async function runSeeds() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log("Iniciando inyección de datos de prueba...");

    // 1. Obtener plantillas
    const baseVehRes = await client.query('SELECT * FROM vehiculo LIMIT 1');
    const baseInsRes = await client.query('SELECT * FROM inspeccion LIMIT 1');
    const baseCompRes = await client.query('SELECT * FROM comprobante LIMIT 1');

    if(baseVehRes.rows.length === 0) throw new Error("No hay vehiculos");
    if(baseInsRes.rows.length === 0) throw new Error("No hay inspecciones");
    if(baseCompRes.rows.length === 0) throw new Error("No hay comprobantes");

    const baseVeh = baseVehRes.rows[0];
    const baseIns = baseInsRes.rows[0];
    const baseComp = baseCompRes.rows[0];

    // Get max IDs if they exist to prevent PK collisions
    let maxVehId = 0, maxInsId = 0, maxCompId = 0;
    if ('id' in baseVeh) {
      const r = await client.query('SELECT MAX(id) as m FROM vehiculo');
      maxVehId = r.rows[0].m || 1000000;
    }
    if ('id' in baseComp) {
      const r = await client.query('SELECT MAX(id) as m FROM comprobante');
      maxCompId = r.rows[0].m || 1000000;
    }

    const cloneVeh = async (placa) => {
      maxVehId++;
      const v = { ...baseVeh, nroplacaantigua: placa, nromotor: 'M-' + placa };
      if ('id' in v) v.id = maxVehId;
      if ('fechcreacion' in v) delete v.fechcreacion;
      
      const keys = Object.keys(v); const values = Object.values(v);
      const placeholders = keys.map((_, i) => '$' + (i + 1)).join(', ');
      await client.query(`INSERT INTO vehiculo (${keys.join(', ')}) VALUES (${placeholders})`, values);
    };

    const cloneIns = async (id, estado, resultado, daysAgo) => {
      const i = { ...baseIns, nrodocumentoinspeccion: id, inspeccionestado_key: estado, resultado: resultado };
      if ('id' in i) { maxInsId++; i.id = maxInsId; }
      
      const keys = Object.keys(i); const values = Object.values(i);
      const placeholders = keys.map((_, i) => '$' + (i + 1)).join(', ');
      await client.query(`INSERT INTO inspeccion (${keys.join(', ')}) VALUES (${placeholders})`, values);
      if(daysAgo) {
        await client.query(`UPDATE inspeccion SET fechcreacion = NOW() - INTERVAL '${daysAgo} days' WHERE nrodocumentoinspeccion = '${id}'`);
      } else {
        await client.query(`UPDATE inspeccion SET fechcreacion = NOW() WHERE nrodocumentoinspeccion = '${id}'`);
      }
    };

    const cloneComp = async (id, placa, insId) => {
      maxCompId++;
      const c = { ...baseComp, nrocomprobante: id, placamotor: placa, inspeccion_nrodocumentoinspeccion: insId };
      if ('id' in c) c.id = maxCompId;
      if ('fechcreacion' in c) delete c.fechcreacion;
      
      const keys = Object.keys(c); const values = Object.values(c);
      const placeholders = keys.map((_, i) => '$' + (i + 1)).join(', ');
      await client.query(`INSERT INTO comprobante (${keys.join(', ')}) VALUES (${placeholders})`, values);
    };

    // ==========================================
    // CASO 2: DUPLICIDAD (DUP-123)
    // ==========================================
    console.log("Inyectando DUP-123...");
    const dupExists = await client.query(`SELECT * FROM vehiculo WHERE nroplacaantigua = 'DUP-123'`);
    if(dupExists.rows.length === 0) await cloneVeh('DUP-123');

    const insDupExists = await client.query(`SELECT * FROM inspeccion WHERE nrodocumentoinspeccion = 'INS-DUP-999'`);
    if(insDupExists.rows.length === 0) {
      await cloneIns('INS-DUP-999', 'PROCESO', null, 0);
      await cloneComp('COMP-DUP-999', 'DUP-123', 'INS-DUP-999');
    }

    // ==========================================
    // CASO 3: BÚSQUEDA LOCAL (LOC-123)
    // ==========================================
    console.log("Inyectando LOC-123...");
    const locExists = await client.query(`SELECT * FROM vehiculo WHERE nroplacaantigua = 'LOC-123'`);
    if(locExists.rows.length === 0) await cloneVeh('LOC-123');

    // ==========================================
    // CASO 5: REINSPECCIÓN DESAPROBADA (REI-123)
    // ==========================================
    console.log("Inyectando REI-123...");
    const reiExists = await client.query(`SELECT * FROM vehiculo WHERE nroplacaantigua = 'REI-123'`);
    if(reiExists.rows.length === 0) await cloneVeh('REI-123');

    const insReiExists = await client.query(`SELECT * FROM inspeccion WHERE nrodocumentoinspeccion = 'INS-REI-999'`);
    if(insReiExists.rows.length === 0) {
      await cloneIns('INS-REI-999', 'DESAPROBADO', 'D', 3);
      await cloneComp('COMP-REI-999', 'REI-123', 'INS-REI-999');
    }

    // ==========================================
    // CASO 6: DESCUENTO CALL CENTER (DSC-123)
    // ==========================================
    console.log("Inyectando DSC-123...");
    const dscExists = await client.query(`SELECT * FROM vehiculo WHERE nroplacaantigua = 'DSC-123'`);
    if(dscExists.rows.length === 0) await cloneVeh('DSC-123');

    const dtoExists = await client.query(`SELECT * FROM descuentocomprobante WHERE nrodocumento = 'DSC-123'`);
    if(dtoExists.rows.length === 0) {
      let maxDtoId = 1000000;
      try {
        const res = await client.query('SELECT MAX(id) as m FROM descuentocomprobante');
        maxDtoId = (res.rows[0].m || 1000000) + 1;
      } catch (e) {}
      await client.query(`
        INSERT INTO descuentocomprobante (
          id, nrodocumento, tipo_descuento, nombre_campana, monto_descuento, 
          porcentaje_descuento, fechcreacion, estado, conceptoinspeccion_key
        ) VALUES (
          $1, 'DSC-123', 'CALL CENTER', 'PROMO VERANO', 20.00, 
          0, NOW(), 'A', (SELECT key FROM conceptoinspeccion LIMIT 1)
        )
      `, [maxDtoId]);
    }

    await client.query('COMMIT');
    console.log("¡Inyección exitosa en la DB REAL! Datos listos para probar.");
  } catch (e) {
    await client.query('ROLLBACK');
    console.error("Error al inyectar datos:", e.message);
  } finally {
    client.release();
    process.exit();
  }
}

runSeeds();
