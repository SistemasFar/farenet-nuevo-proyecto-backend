const db = require('../config/database');

// Mapeo de reglas de frenos hacia los campos del JSON `postdata`
const mapFrenos = {
    'EFICIENCIA-FRENOS DE SERVICIO': 'eficienciaServicio',
    'EFICIENCIA-FRENO DE ESTACIONAMIENTO': 'eficienciaEstacionamiento',
    'DESEQUILIBRIO-FRENOS DE SERVICIO EJE DELANTERO': 'desequilibroServicioEje1',
    'DESEQUILIBRIO-FRENOS DE SERVICIO EJE POSTERIOR': 'desequilibroServicioEje2',
    'DESEQUILIBRIO-FRENOS DE ESTACIONAMIENTO EJE DELANTERO': 'desequilibroEstacionamientoEje1',
    'DESEQUILIBRIO-FRENOS DE ESTACIONAMIENTO EJE POSTERIOR': 'desequilibroEstacionamientoEje2'
};

/**
 * Motor central de evaluación técnica. Reemplaza las lógicas manuales de Java.
 */
async function evaluarDefectosTecnicos(nrodocumentoinspeccion) {
    const defectosEncontrados = [];

    // 1. Obtener todas las máquinas que pasaron por la inspección y tienen postdata
    const qMaquinas = `
        SELECT rm.id, rm.postdata, m.tipomaquina_key
        FROM resultado_maquina rm
        JOIN maquina m ON rm.maquina_id = m.id
        WHERE rm.inspeccion_nrodocumentoinspeccion LIKE $1
          AND rm.postdata IS NOT NULL
    `;
    const resMaquinas = await db.query(qMaquinas, [`${nrodocumentoinspeccion}%`]);

    for (const rm of resMaquinas.rows) {
        const postdata = typeof rm.postdata === 'string' ? JSON.parse(rm.postdata) : rm.postdata;

        // --- MAQUINA DE FRENOS (tipomaquina_key = '3' o '15')
        if (rm.tipomaquina_key === '3' || rm.tipomaquina_key === '15') {
            const qReglas = `
                SELECT r.parametro, r.tipo, r.condicion1, r.valor1, r.condicion2, r.valor2, n.codigovalor, n.nombrevalor
                FROM reglafreno r
                JOIN norma n ON r.norma_id = n.id
                WHERE r.estado = true
            `;
            const resReglas = await db.query(qReglas);

            for (const regla of resReglas.rows) {
                const key = `${regla.parametro.toUpperCase()}-${regla.tipo.toUpperCase()}`;
                const fieldName = mapFrenos[key];
                // console.log(`Revisando regla: ${key}, mapped to: ${fieldName}, value in postdata: ${postdata[fieldName]}`);

                if (fieldName && postdata[fieldName] !== undefined && postdata[fieldName] !== null) {
                    const value = Number(postdata[fieldName]);
                    const v1 = Number(regla.valor1);
                    const v2 = Number(regla.valor2);

                    let falla = false;

                    // Lógica de evaluación basada en evaluarDesequilibrio() de Java
                    if (regla.condicion1 === '>=') {
                        if (regla.condicion2 === '<=') {
                            if (value >= v1 && value <= v2) {
                                falla = true;
                            }
                        }
                    } else if (regla.condicion1 === '>') {
                        if (value > v1) {
                            falla = true;
                        }
                    } else if (regla.condicion1 === '<') {
                        if (value < v1) {
                            falla = true;
                        }
                    } else if (regla.condicion1 === '<=') {
                        if (value <= v1) {
                            falla = true;
                        }
                    }

                    if (falla) {
                        defectosEncontrados.push(regla.codigovalor);
                    }
                }
            }
        }

        // Aquí se pueden ir agregando los IF para las demás máquinas (Gases, Luces, etc.)
    }

    return defectosEncontrados;
}

module.exports = {
    evaluarDefectosTecnicos
};
