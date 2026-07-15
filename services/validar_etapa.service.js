const db = require('../config/database');

class ValidarEtapaService {
  async detectarPruebasObligatorias(nrodocumentoinspeccion, clientParam = null) {
    let client = clientParam;
    let localClient = false;
    
    if (!client) {
      client = await db.connect();
      localClient = true;
    }
    
    try {
      // Obtener datos del vehiculo, inspeccion y linea
      const queryInfo = `
        SELECT 
          i.nrodocumentoinspeccion,
          i.posicion,
          v.nromotor AS placa,
          v.pesobruto,
          c.key AS categoria_key,
          c.nombre AS categoria_nombre,
          comb.key AS combustible_key,
          comb.nombre AS combustible_nombre,
          l.tipo AS linea_tipo
        FROM inspeccion i
        JOIN vehiculo v ON i.vehiculo_nromotor = v.nromotor
        JOIN categoria c ON v.categoria_key = c.key
        JOIN combustible comb ON v.combustible_key = comb.key
        LEFT JOIN comprobante comp ON comp.inspeccion_nrodocumentoinspeccion = i.nrodocumentoinspeccion
        LEFT JOIN linea l ON comp.linea_key = l.key
        WHERE i.nrodocumentoinspeccion = $1
        ORDER BY comp.fechcreacion DESC LIMIT 1
      `;
      const resInfo = await client.query(queryInfo, [nrodocumentoinspeccion]);
      
      if (resInfo.rows.length === 0) {
        throw new Error(`Inspección no encontrada: ${nrodocumentoinspeccion}`);
      }
      
      const info = resInfo.rows[0];

      // Diccionarios de tipos (basados en legacy UIUtils)
      const tiposCarreta = ['O2', 'O3', 'O4'];
      const tiposMoto = ['L1', 'L3'];
      const tiposMotoCarro = ['L2', 'L4', 'L5'];

      const catUpper = (info.categoria_key || '').toUpperCase();
      const esCarreta = tiposCarreta.includes(catUpper);
      const esMoto = tiposMoto.includes(catUpper);
      const esMotoCarro = tiposMotoCarro.includes(catUpper);
      const combustible = info.combustible_key; // string
      
      // La base de datos guarda '2' para MIXTA segun el ordinal de PESO_LINEA en Java
      const esLineaMixta = (info.linea_tipo === 2); 

      const obligatorias = [];
      const noAplicables = [];
      const advertencias = [];

      const agregarObligatoria = (codigo, key, nombre, motivo) => {
        obligatorias.push({ codigo, tipomaquinaKey: key, nombre, motivo });
      };
      const agregarNoAplicable = (codigo, key, nombre, motivo) => {
        noAplicables.push({ codigo, tipomaquinaKey: key, nombre, motivo });
      };

      // REGLAS LEGACY (Java AppLineaService.java)

      // 1. GASES / OPACIDAD
      if (combustible === '5' || combustible === '3') {
        // Diesel o Petroleo exigen Opacidad
        agregarObligatoria('OPACIDAD', '5', 'OPACIMETRO', 'Obligatorio por combustible (Diesel/Petróleo) según legacy');
        agregarNoAplicable('GASES', '4', 'ANALIZADOR DE GASES', 'No aplica para Diesel/Petróleo');
      } else if (combustible !== '34' && combustible !== '10') {
        // Excluimos Sin Combustible(34) y Eléctrico(10)
        agregarObligatoria('GASES', '4', 'ANALIZADOR DE GASES', 'Obligatorio por combustible (no excluido) según legacy');
        agregarNoAplicable('OPACIDAD', '5', 'OPACIMETRO', 'No aplica para este combustible');
      } else {
        // 34 (Sin combustible) y 10 (Eléctrico) están exentos
        agregarNoAplicable('GASES', '4', 'ANALIZADOR DE GASES', 'Exento por combustible eléctrico o sin combustible');
        agregarNoAplicable('OPACIDAD', '5', 'OPACIMETRO', 'Exento por combustible eléctrico o sin combustible');
      }

      // 2. LUCES y SONOMETRO
      if (!esCarreta) {
        agregarObligatoria('LUCES', '7', 'LUXOMETRO', 'Obligatorio porque no es carreta');
        agregarObligatoria('SONOMETRO', '6', 'SONOMETRO', 'Obligatorio porque no es carreta');
      } else {
        agregarNoAplicable('LUCES', '7', 'LUXOMETRO', 'No aplica para carreta');
        agregarNoAplicable('SONOMETRO', '6', 'SONOMETRO', 'No aplica para carreta');
      }

      // 3. PROFUNDIMETRO (Siempre obligatorio según validacion de norma general)
      agregarObligatoria('PROFUNDIMETRO', '10', 'PROFUNDIMETRO', 'Obligatorio general');

      // 4. FRENOMETRO (Siempre obligatorio)
      agregarObligatoria('FRENOMETRO', '3', 'FRENOMETRO', 'Obligatorio general');

      // 5. ALINEACION
      if (!esMoto && !esMotoCarro) {
        agregarObligatoria('ALINEACION', '1', 'ALINEAMIENTO AL PASO', 'Obligatorio porque no es moto ni motocarro');
      } else {
        agregarNoAplicable('ALINEACION', '1', 'ALINEAMIENTO AL PASO', 'No aplica para moto o motocarro');
      }

      // 6. INSPECCION VISUAL (Siempre obligatorio)
      agregarObligatoria('INSPECCION_VISUAL', '9', 'INSPECCION VISUAL', 'Obligatorio general');

      // 7. FOTOS GASES (11) y LUCES (12) (El legacy los pide independientemente del combustible o tipo)
      agregarObligatoria('GASESFOTO', '11', 'FOTOS GASES', 'Evidencia fotográfica obligatoria (Legacy)');
      agregarObligatoria('LUCESFOTO', '12', 'FOTOS LUCES', 'Evidencia fotográfica obligatoria (Legacy)');

      // 8. SUSPENSION
      const pesobruto = parseFloat(info.pesobruto) || 0;
      if (pesobruto <= 3500 && !esMoto && !esMotoCarro) {
        agregarObligatoria('SUSPENSION', '2', 'BANCO DE SUSPENSION', 'Obligatorio (<= 3500kg y no es moto/motocarro)');
      } else {
        agregarNoAplicable('SUSPENSION', '2', 'BANCO DE SUSPENSION', 'No aplica por peso o por ser moto');
      }

      // 9. FOTOS TESTLINE o FRENOS
      if (esLineaMixta) {
        agregarObligatoria('FRENOSFOTO', '15', 'FOTOS FRENOS', 'Evidencia fotográfica por ser línea mixta');
        agregarNoAplicable('TESTLINEFOTO', '13', 'FOTOS TESTLINE', 'No aplica en línea mixta');
      } else {
        agregarObligatoria('TESTLINEFOTO', '13', 'FOTOS TESTLINE', 'Evidencia fotográfica por ser línea regular');
        agregarNoAplicable('FRENOSFOTO', '15', 'FOTOS FRENOS', 'No aplica (solo línea mixta)');
      }

      return {
        ok: true,
        nrodocumentoinspeccion: info.nrodocumentoinspeccion,
        posicionActual: info.posicion,
        vehiculo: {
          placa: info.placa,
          categoriaKey: info.categoria_key,
          categoriaNombre: info.categoria_nombre,
          combustibleKey: info.combustible_key,
          combustibleNombre: info.combustible_nombre,
          pesoBruto: pesobruto,
          lineaTipo: info.linea_tipo
        },
        flags: {
          esCarreta,
          esMoto,
          esMotoCarro,
          esLineaMixta
        },
        obligatorias,
        noAplicables,
        advertencias
      };
    } catch (error) {
      throw error;
    } finally {
      if (localClient) {
        client.release();
      }
    }
  }

  async validarEtapa(nrodocumentoinspeccion, clientParam = null) {
    let client = clientParam;
    let localClient = false;
    if (!client) {
      client = await db.connect();
      localClient = true;
    }

    try {
      // 1. Obtener obligatorias
      const pruebas = await this.detectarPruebasObligatorias(nrodocumentoinspeccion, client);
      const { obligatorias, noAplicables, vehiculo, advertencias } = pruebas;

      // 2. Obtener recibidas
      const queryRecibidas = `
        SELECT
          rm.id,
          rm.resultado,
          rm.maquina_id,
          m.tipomaquina_key,
          tm.descripcion AS nombre,
        rm.fechcreacion,
        rm.fechainicio,
        rm.fechafin,
        rm.foto,
        rm.data
      FROM resultado_maquina rm
      JOIN maquina m ON m.id = rm.maquina_id
      JOIN tipomaquina tm ON tm.key = m.tipomaquina_key
      WHERE rm.inspeccion_nrodocumentoinspeccion LIKE $1 || '%'
    `;
    const resRecibidas = await client.query(queryRecibidas, [nrodocumentoinspeccion]);
    const recibidas = resRecibidas.rows;

    // 3. Comparar y calcular faltantes
    const faltantes = [];
    const recibidasObligatorias = [];
    
    // Agrupamos recibidas por tipomaquina_key para facilitar busqueda
    const mapRecibidas = {};
    for (const r of recibidas) {
      if (!mapRecibidas[r.tipomaquina_key]) {
        mapRecibidas[r.tipomaquina_key] = [];
      }
      mapRecibidas[r.tipomaquina_key].push(r);
    }

    let resultadoPreliminar = 'A'; // Base es A
    
    for (const req of obligatorias) {
      const match = mapRecibidas[req.tipomaquinaKey];
      if (!match || match.length === 0) {
        faltantes.push(req);
      } else {
        // Encontramos la prueba
        const r = match[0]; // tomamos la primera
        recibidasObligatorias.push({
          codigo: req.codigo,
          tipomaquinaKey: req.tipomaquinaKey,
          resultado: r.resultado
        });
        if (r.resultado === 'D') {
          resultadoPreliminar = 'D'; // Si alguna falla, todo D
        }
      }
    }

    const etapaCompleta = (faltantes.length === 0);

      return {
        etapaCompleta,
        resultadoPreliminar,
        recibidas: recibidasObligatorias,
        faltantes,
        noAplicables,
        obligatorias,
        vehiculo,
        advertencias
      };
    } finally {
      if (localClient) {
        client.release();
      }
    }
  }
}

module.exports = new ValidarEtapaService();
