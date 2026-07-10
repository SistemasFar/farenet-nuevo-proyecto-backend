const pool = require('./config/database');
const lineaService = require('./services/linea.service');

async function main() {
  const NRO = 'INS-102-TEST-CASO-A';

  // 1. Resetear la inspeccion
  await pool.query(`
    UPDATE inspeccion 
    SET inspeccionestado_key = 'PROCESO', fechconsolidado = NULL, 
        nrodocumentoinforme = NULL, usuarioconsolidado_username = NULL, usuarioingcertificador_username = NULL
    WHERE nrodocumentoinspeccion = $1`, [NRO]);
  
  await pool.query(`DELETE FROM certificado WHERE inspeccion_nrodocumentoinspeccion = $1`, [NRO]);

  console.log('✅ Inspección reseteada a PROCESO');

  // 2. Probar ingeniero falso
  try {
    await lineaService.guardarConsolidacion(NRO, {
      ingenieroCertificadorUsername: 'ingeniero_falso',
      usuarioConsolidadorUsername: 'dbrito',
      observacion: 'Prueba error'
    });
    console.log('❌ Debería haber fallado con ingeniero falso');
  } catch (err) {
    console.log('✅ Falló correctamente con ingeniero falso:', err.message);
  }

  // 3. Probar usuario consolidador falso
  try {
    await lineaService.guardarConsolidacion(NRO, {
      ingenieroCertificadorUsername: 'ylucero',
      usuarioConsolidadorUsername: 'usuario_consolidador_falso',
      observacion: 'Prueba error 2'
    });
    console.log('❌ Debería haber fallado con consolidador falso');
  } catch (err) {
    console.log('✅ Falló correctamente con consolidador falso:', err.message);
  }

  // 4. Validar integridad (rollback)
  const res = await pool.query(`SELECT inspeccionestado_key FROM inspeccion WHERE nrodocumentoinspeccion = $1`, [NRO]);
  console.log('✅ Estado actual tras errores (debe ser PROCESO):', res.rows[0].inspeccionestado_key);

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
