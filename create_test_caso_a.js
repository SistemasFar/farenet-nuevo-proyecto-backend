// Script de datos de prueba sintéticos para Caso A (Resultado Aprobado)
// Se crea una inspección completa con todas las pruebas en A, sin defectos graves.
// Datos usados:
//   Planta: 102 (SAN MIGUEL) | Linea: L1_COMBINADA_SANMIGUEL
//   Vehiculo: PJ19554 (N1, Gasolina, 2190kg, pesobruto<=3500)
//   Ingeniero: ylucero | Persona: 16457067

const pool = require('./config/database');

const NRO_INSPECCION_TEST = 'INS-102-TEST-CASO-A';
const PLANTA_KEY = '102';
const LINEA_KEY = 'L1_COMBINADA_SANMIGUEL';
const VEHICULO_NROMOTOR = 'PJ19554';
const PERSONA_NRODOC = '16457067';

// IDs de máquinas de L1_COMBINADA_SANMIGUEL:
// tipo 4=GASES, 7=LUCES, 6=SONOMETRO, 10=PROFUNDIMETRO, 3=FRENOMETRO
// 1=ALINEACION, 9=INSPECCION_VISUAL, 11=GASESFOTO, 12=LUCESFOTO
// 13=TESTLINEFOTO, 2=SUSPENSION
const MAQUINAS = [
  { id: '25381382', tipomaquina_key: '4',  nombre: 'ANALIZADOR DE GASES'  }, // Obligatorio por Gasolina
  { id: '25381387', tipomaquina_key: '7',  nombre: 'LUXOMETRO'             }, // Obligatorio (no carreta)
  { id: '25381386', tipomaquina_key: '6',  nombre: 'SONOMETRO'             }, // Obligatorio (no carreta)
  { id: '25381390', tipomaquina_key: '10', nombre: 'PROFUNDIMETRO'         }, // Siempre
  { id: '25381385', tipomaquina_key: '3',  nombre: 'FRENOMETRO'            }, // Siempre
  { id: '25381384', tipomaquina_key: '1',  nombre: 'ALINEAMIENTO AL PASO'  }, // No moto
  { id: '25381389', tipomaquina_key: '9',  nombre: 'INSPECCION VISUAL'     }, // Siempre
  { id: '25381388', tipomaquina_key: '11', nombre: 'GASESFOTO'             }, // Siempre
  { id: '25381391', tipomaquina_key: '12', nombre: 'LUCESFOTO'             }, // Siempre
  { id: '25381392', tipomaquina_key: '13', nombre: 'TESTLINEFOTO'          }, // Linea no mixta
  { id: '25381393', tipomaquina_key: '2',  nombre: 'BANCO DE SUSPENSION'   }, // pesobruto<=3500
];

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Limpiar si existe previamente
    await client.query(`DELETE FROM resultado_maquina WHERE inspeccion_nrodocumentoinspeccion = $1`, [NRO_INSPECCION_TEST]);
    await client.query(`DELETE FROM comprobante WHERE inspeccion_nrodocumentoinspeccion = $1`, [NRO_INSPECCION_TEST]);
    await client.query(`DELETE FROM inspeccion WHERE nrodocumentoinspeccion = $1`, [NRO_INSPECCION_TEST]);

    // 1. Insertar inspección
    await client.query(`
      INSERT INTO inspeccion (
        nrodocumentoinspeccion, vehiculo_nromotor, posicion,
        inspeccionestado_key, fechmodi, indicedesaprobado, resultado
      ) VALUES ($1, $2, $3, $4, NOW(), 0, 'A')
    `, [NRO_INSPECCION_TEST, VEHICULO_NROMOTOR, 14, 'PROCESO']);
    console.log('✅ Inspección insertada:', NRO_INSPECCION_TEST);

    // 2. Insertar comprobante
    const idComprobante = Math.floor(Math.random() * 1000000000);
    await client.query(`
      INSERT INTO comprobante (
        id,
        inspeccion_nrodocumentoinspeccion,
        linea_key,
        cliente_nrodocumentoidentidad,
        fechcreacion,
        nrocomprobante,
        importetotal,
        totaldscto,
        totalsindscto,
        comprobanteestado_key
      ) VALUES ($1, $2, $3, $4, NOW(), $5, 100, 0, 100, 'EMI')
    `, [idComprobante, NRO_INSPECCION_TEST, LINEA_KEY, PERSONA_NRODOC, 'CPT-TEST-CASO-A']);
    console.log('✅ Comprobante insertado');

    // 3. Insertar resultados de máquina en A (sin defectos)
    for (const maq of MAQUINAS) {
      const idRm = Math.floor(Math.random() * 1000000000);
      await client.query(`
        INSERT INTO resultado_maquina (
          id,
          inspeccion_nrodocumentoinspeccion,
          maquina_id,
          resultado,
          fechainicio,
          fechafin,
          fechcreacion
        ) VALUES ($1, $2, $3, 'A', NOW(), NOW(), NOW())
      `, [idRm, NRO_INSPECCION_TEST, maq.id]);
      console.log(`  ✅ ${maq.nombre} (tipo ${maq.tipomaquina_key}) → A`);
    }

    await client.query('COMMIT');
    console.log('\n✅ Datos de prueba CASO A creados correctamente.');
    console.log('Inspección:', NRO_INSPECCION_TEST);
    console.log('Planta:', PLANTA_KEY, '| Linea:', LINEA_KEY);
    console.log('Usar ingeniero: ylucero | Consolidador: dbrito');

  } catch(err) {
    await client.query('ROLLBACK');
    console.error('❌ ERROR:', err.message);
    throw err;
  } finally {
    client.release();
    process.exit(0);
  }
}

main().catch(() => process.exit(1));
