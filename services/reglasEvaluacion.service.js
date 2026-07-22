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

    // 0. Obtener datos del vehículo
    const qVehiculo = `
        SELECT v.aniofabricacion, v.combustible_key, v.categoria_key
        FROM inspeccion i
        JOIN vehiculo v ON i.vehiculo_nromotor = v.nromotor
        WHERE i.nrodocumentoinspeccion LIKE $1
        LIMIT 1
    `;
    const resVehiculo = await db.query(qVehiculo, [`${nrodocumentoinspeccion}%`]);
    const vehiculo = resVehiculo.rows[0] || { aniofabricacion: 2000, combustible_key: '', categoria_key: '' };

    // 1. Obtener todas las máquinas que pasaron por la inspección y tienen postdata/data
    const qMaquinas = `
        SELECT rm.id, rm.data, rm.postdata, m.tipomaquina_key
        FROM resultado_maquina rm
        JOIN maquina m ON rm.maquina_id = m.id
        WHERE rm.inspeccion_nrodocumentoinspeccion LIKE $1
    `;
    const resMaquinas = await db.query(qMaquinas, [`${nrodocumentoinspeccion}%`]);

    for (const rm of resMaquinas.rows) {
        const postdata = typeof rm.postdata === 'string' && rm.postdata ? JSON.parse(rm.postdata) : (rm.postdata || {});
        const data = typeof rm.data === 'string' && rm.data ? JSON.parse(rm.data) : (rm.data || {});

        // --- MAQUINA DE FRENOS (tipomaquina_key = '3')
        if (rm.tipomaquina_key === '3') {
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

        // --- MAQUINA DE LUCES (tipomaquina_key = '7')
        if (rm.tipomaquina_key === '7') {
            const qReglas = `
                SELECT r.lux, n.codigovalor, n.nombrevalor
                FROM reglaluces r
                JOIN norma n ON r.norma_id = n.id
                WHERE r.estado = true
            `;
            const resReglas = await db.query(qReglas);
            
            let fallaAltas = false;
            let fallaBajas = false;
            let defectoAltas = null;
            let defectoBajas = null;

            for (const regla of resReglas.rows) {
                const luxRegla = Number(regla.lux);
                
                // Altas
                if (!fallaAltas) {
                    const altaD = Number(data.altaDerecha || 0);
                    const altaI = Number(data.altaIzquierda || 0);
                    // Legacy LucesService.java: if (luxometroBean.altaDerecha < reglaLuces.getLux() || ...)
                    if (altaD < luxRegla || altaI < luxRegla) {
                        fallaAltas = true;
                        defectoAltas = regla.codigovalor;
                    }
                }
                
                // Bajas
                if (!fallaBajas) {
                    const bajaD = Number(data.bajaDerecha || 0);
                    const bajaI = Number(data.bajaIzquierda || 0);
                    if (bajaD < luxRegla || bajaI < luxRegla) {
                        fallaBajas = true;
                        defectoBajas = regla.codigovalor;
                    }
                }
            }
            if (fallaAltas && defectoAltas) defectosEncontrados.push(defectoAltas);
            if (fallaBajas && defectoBajas) defectosEncontrados.push(defectoBajas);
        }

        // --- MAQUINA DE GASES (tipomaquina_key = '4') Y OPACIMETRO (tipomaquina_key = '5')
        if (rm.tipomaquina_key === '4' || rm.tipomaquina_key === '5') {
            if (vehiculo.combustible_key === '2' || vehiculo.combustible_key === '5') {
                // DIESEL (Opacímetro)
                const qReglas = `
                    SELECT r.aniofabricacion, r.opacidad, r.opacidadf, r.condicion_anio, n.codigovalor
                    FROM reglaopacidad r
                    JOIN norma n ON r.norma_id = n.id
                    WHERE r.estado = true AND r.combustible_key = $1
                    ORDER BY r.aniofabricacion DESC
                `;
                const resReglas = await db.query(qReglas, [vehiculo.combustible_key]);
                
                const opaProm = Number(postdata.opaProm || 0);
                for (const regla of resReglas.rows) {
                    let aplicar = false;
                    if (regla.condicion_anio === '>=' && vehiculo.aniofabricacion >= regla.aniofabricacion) aplicar = true;
                    if (regla.condicion_anio === '<=' && vehiculo.aniofabricacion <= regla.aniofabricacion) aplicar = true;
                    
                    if (aplicar) {
                        if (opaProm > regla.opacidad && opaProm > regla.opacidadf) {
                            defectosEncontrados.push(regla.codigovalor);
                        }
                        break; // Java break tras evaluar la primera regla que cumple el rango de años
                    }
                }
            } else {
                // GASOLINA (Gases)
                const qReglas = `
                    SELECT r.aniofabricacion, r.valor, r.valorf, r.condicion_anio, r.key, n.codigovalor
                    FROM reglagas r
                    JOIN norma n ON r.norma_id = n.id
                    WHERE r.estado = true AND r.combustible_key = $1
                    ORDER BY r.aniofabricacion DESC
                `;
                const resReglas = await db.query(qReglas, [vehiculo.combustible_key]);
                
                let anhioRango = 0;
                for (const regla of resReglas.rows) {
                    if (anhioRango !== 0 && regla.aniofabricacion !== anhioRango) continue;
                    
                    let aplicar = false;
                    if (regla.condicion_anio === '>=' && vehiculo.aniofabricacion >= regla.aniofabricacion) aplicar = true;
                    if (regla.condicion_anio === '<=' && vehiculo.aniofabricacion <= regla.aniofabricacion) aplicar = true;
                    
                    if (aplicar) {
                        anhioRango = regla.aniofabricacion;
                        const key = (regla.key || '').toLowerCase();
                        
                        if (key === 'co') {
                            const co_c = Number(data.co_c || 0);
                            const co_r = Number(data.co_r || 0);
                            if (co_c > regla.valor || co_r > regla.valor) {
                                if (co_c > regla.valorf || co_r > regla.valorf) {
                                    defectosEncontrados.push(regla.codigovalor);
                                }
                            }
                        } else if (key === 'hc') {
                            const hc_c = Number(data.hc_c || 0);
                            const hc_r = Number(data.hc_r || 0);
                            if (hc_c > regla.valor || hc_r > regla.valor) {
                                if (hc_c > regla.valorf || hc_r > regla.valorf) {
                                    defectosEncontrados.push(regla.codigovalor);
                                }
                            }
                        } else if (key === 'coco2') {
                            const coco2_c = Number(data.coco2_c || 0);
                            const coco2_r = Number(data.coco2_r || 0);
                            if (coco2_c < regla.valor || coco2_r < regla.valor) {
                                if (coco2_c < regla.valorf || coco2_r < regla.valorf) {
                                    defectosEncontrados.push(regla.codigovalor);
                                }
                            }
                        }
                    }
                }
            }
        }

        // --- MAQUINA DE SUSPENSION (tipomaquina_key = '2')
        if (rm.tipomaquina_key === '2') {
            const qReglas = `
                SELECT r.valor1, r.valor1f, r.valor2, r.valor2f, r.condicion1, r.condicion2, n.codigovalor
                FROM reglasuspencion r
                JOIN norma n ON r.norma_id = n.id
                WHERE r.estado = true
            `;
            const resReglas = await db.query(qReglas);

            let fallaDel = false;
            let fallaPost = false;
            let defectoDel = null;
            let defectoPost = null;

            const delD = Number(data.delanteraDerecha || 0);
            const delI = Number(data.delanteraIzquierda || 0);
            const postD = Number(data.posteriorDerecha || 0);
            const postI = Number(data.posteriorIzquierda || 0);

            for (const regla of resReglas.rows) {
                const v1 = regla.valor1;
                const v1f = regla.valor1f;
                const v2 = regla.valor2;
                const v2f = regla.valor2f;

                // Check Delantera
                if (!fallaDel) {
                    if (regla.condicion1 === '>=' && regla.condicion2 === '<=') {
                        if ((delD >= v1 && delD <= v2) || (delI >= v1 && delI <= v2)) {
                            if ((delD >= v1f && delD <= v2f) || (delI >= v1f && delI <= v2f)) {
                                fallaDel = true;
                                defectoDel = regla.codigovalor;
                            }
                        }
                    } else if (regla.condicion1 === '<') {
                        if (delD < v1 || delI < v1) {
                            if (delD < v1f || delI < v1f) {
                                fallaDel = true;
                                defectoDel = regla.codigovalor;
                            }
                        }
                    }
                }

                // Check Posterior
                if (!fallaPost) {
                    if (regla.condicion1 === '>=' && regla.condicion2 === '<=') {
                        if ((postD >= v1 && postD <= v2) || (postI >= v1 && postI <= v2)) {
                            if ((postD >= v1f && postD <= v2f) || (postI >= v1f && postI <= v2f)) {
                                fallaPost = true;
                                defectoPost = regla.codigovalor;
                            }
                        }
                    } else if (regla.condicion1 === '<') {
                        if (postD < v1 || postI < v1) {
                            if (postD < v1f || postI < v1f) {
                                fallaPost = true;
                                defectoPost = regla.codigovalor;
                            }
                        }
                    }
                }
            }
            if (fallaDel && defectoDel) defectosEncontrados.push(defectoDel);
            if (fallaPost && defectoPost) defectosEncontrados.push(defectoPost);
        }

        // --- MAQUINA DE ALINEACION (tipomaquina_key = '1')
        if (rm.tipomaquina_key === '1') {
            const qReglas = `
                SELECT r.valor1, r.valor1f, r.valor2, r.valor2f, r.condicion1, r.condicion2, n.codigovalor
                FROM reglaalineacion r
                JOIN norma n ON r.norma_id = n.id
                WHERE r.estado = true
            `;
            const resReglas = await db.query(qReglas);

            let fallas = [false, false, false, false, false, false];
            let defectos = [null, null, null, null, null, null];
            
            const ejes = [
                Number(data.eje1 || 0),
                Number(data.eje2 || 0),
                Number(data.eje3 || 0),
                Number(data.eje4 || 0),
                Number(data.eje5 || 0),
                Number(data.eje6 || 0)
            ];

            for (const regla of resReglas.rows) {
                const v1 = regla.valor1;
                const v1f = regla.valor1f;
                const v2 = regla.valor2;
                const v2f = regla.valor2f;

                for (let i = 0; i < 6; i++) {
                    if (data[`eje${i+1}`] === undefined || data[`eje${i+1}`] === null) continue;

                    if (!fallas[i]) {
                        if (regla.condicion1 === '>=' && (regla.condicion2 === '<=' || !regla.condicion2)) {
                            if (ejes[i] >= v1 && (regla.condicion2 ? ejes[i] <= v2 : true)) {
                                if (ejes[i] >= v1f && (regla.condicion2 ? ejes[i] <= v2f : true)) {
                                    fallas[i] = true;
                                    defectos[i] = regla.codigovalor;
                                }
                            }
                        } else if (regla.condicion1 === '<') {
                            if (ejes[i] < v1) {
                                if (ejes[i] < v1f) {
                                    fallas[i] = true;
                                    defectos[i] = regla.codigovalor;
                                }
                            }
                        }
                    }
                }
            }

            for (let i = 0; i < 6; i++) {
                if (fallas[i] && defectos[i]) defectosEncontrados.push(defectos[i]);
            }
        }

        // --- MAQUINA DE PROFUNDIMETRO (tipomaquina_key = '10')
        if (rm.tipomaquina_key === '10') {
            const qReglas = `
                SELECT r.profundidad, n.codigovalor
                FROM reglaprofundidad r
                JOIN norma n ON r.norma_id = n.id
                WHERE r.estado = true AND r.categoria_key = $1
            `;
            const resReglas = await db.query(qReglas, [vehiculo.categoria_key]);

            let fallas = [false, false, false, false, false, false];
            let defectos = [null, null, null, null, null, null];

            const ejes = [
                Number(data.eje1 || 0),
                Number(data.eje2 || 0),
                Number(data.eje3 || 0),
                Number(data.eje4 || 0),
                Number(data.eje5 || 0),
                Number(data.eje6 || 0)
            ];

            for (const regla of resReglas.rows) {
                const prof = regla.profundidad;

                for (let i = 0; i < 6; i++) {
                    if (data[`eje${i+1}`] === undefined || data[`eje${i+1}`] === null) continue;

                    if (!fallas[i]) {
                        if (ejes[i] < prof) {
                            fallas[i] = true;
                            defectos[i] = regla.codigovalor;
                        }
                    }
                }
            }

            for (let i = 0; i < 6; i++) {
                if (fallas[i] && defectos[i]) defectosEncontrados.push(defectos[i]);
            }
        }

        // --- MAQUINA DE SONOMETRO (tipomaquina_key = '6')
        if (rm.tipomaquina_key === '6') {
            const qReglas = `
                SELECT r.decibel, n.codigovalor
                FROM reglasonora r
                JOIN norma n ON r.norma_id = n.id
                WHERE r.estado = true
            `;
            const resReglas = await db.query(qReglas);

            let falla = false;
            let defecto = null;
            const dbVal = Number(data.db || 0);

            for (const regla of resReglas.rows) {
                if (dbVal > regla.decibel) {
                    falla = true;
                    defecto = regla.codigovalor;
                    break;
                }
            }

            if (falla && defecto) defectosEncontrados.push(defecto);
        }
    }

    return defectosEncontrados;
}

module.exports = {
    evaluarDefectosTecnicos
};
