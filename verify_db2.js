const { Pool } = require('pg');
const pool = new Pool({ user: 'postgres', host: '192.168.14.19', database: 'inspeccion', password: 'farenet2026**', port: 5432 });

async function verify() {
  try {
    const insp = await pool.query("SELECT nrodocumentoinspeccion, comprobante_id, vehiculo_nromotor, fechcreacion FROM inspeccion WHERE nrodocumentoinspeccion LIKE 'INS-_________' ORDER BY fechcreacion DESC LIMIT 1");
    const latestInsp = insp.rows[0];
    
    if (!latestInsp) {
      console.log("No se encontraron inspecciones generadas por el nuevo sistema (INS-123456789). ¿Hiciste click en Guardar y Finalizar?");
      return;
    }

    console.log("--- LATEST INSPECCION (NUEVO SISTEMA) ---");
    console.log(latestInsp);

    if (latestInsp) {
      const comp = await pool.query("SELECT id, nrocomprobante, placamotor, cliente_nrodocumentoidentidad, importetotal FROM comprobante WHERE id = $1", [latestInsp.comprobante_id]);
      console.log("\n--- RELATED COMPROBANTE ---");
      console.log(comp.rows[0]);

      if (comp.rows[0]) {
        const veh = await pool.query("SELECT nromotor, nroplacaantigua, marca_key, modelo_key, nrosoat FROM vehiculo WHERE nromotor = $1 OR nroplacaantigua = $2 ORDER BY fechcreacion DESC LIMIT 1", [latestInsp.vehiculo_nromotor, comp.rows[0].placamotor]);
        console.log("\n--- RELATED VEHICULO ---");
        console.log(veh.rows[0]);

        const per = await pool.query("SELECT nrodocumentoidentidad, nombres, apellidos, nombrerazonsocial FROM persona WHERE nrodocumentoidentidad = $1", [comp.rows[0].cliente_nrodocumentoidentidad]);
        console.log("\n--- RELATED PERSONA ---");
        console.log(per.rows[0]);
      }
    }
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
verify();
