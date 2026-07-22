const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const cheerio = require('cheerio');
const reglasEvaluacionService = require('./reglasEvaluacion.service.js');

function formatDate(date) {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

class CertificadoPreviewService {
  
  async generarHtmlPrevisualizacion(nroInspeccion, user) {
    const viewModel = await this.buildCertificadoViewModel(nroInspeccion, user);
    return await this.renderCertificadoHtml(viewModel);
  }

  async buildCertificadoViewModel(nroInspeccion, user) {
    const vm = {
      flags: {
        hasCertificado: false,
        hasInforme: false,
        mostrar2daCara: false,
        hasSello: false,
        hasCosto: false,
        hasFoto: false,
        hasFirma: false
      },
      cabecera: {},
      vehiculo: {},
      equipos: {},
      resultados: {},
      defectos: [],
      imagenes: {
        fotoVehiculo: null,
        firmaIngeniero: null,
        selloResolucion: null
      },
      textoLegal: {}
    };

    try {
      const inspeccionBase = await this.getInspeccionBase(nroInspeccion);
      if (inspeccionBase) vm.cabecera.inspeccion = inspeccionBase;
    } catch (e) {
      console.warn('[PREVISUALIZACION WARNING] getInspeccionBase falló:', e.message);
    }

    try {
      const certificado = await this.getCertificado(nroInspeccion);
      if (certificado) vm.cabecera.certificado = certificado;
    } catch (e) {
      console.warn('[PREVISUALIZACION WARNING] getCertificado falló:', e.message);
    }

    try {
      const lineaEmpresa = await this.getComprobanteLineaPlantaEmpresa(nroInspeccion);
      if (lineaEmpresa) vm.cabecera.comprobante = lineaEmpresa;
    } catch (e) {
      console.warn('[PREVISUALIZACION WARNING] getComprobanteLineaPlantaEmpresa falló:', e.message);
    }

    try {
      const vehiculoData = await this.getVehiculoTarjetaPropietario(nroInspeccion);
      if (vehiculoData) vm.vehiculo = vehiculoData;
    } catch (e) {
      console.warn('[PREVISUALIZACION WARNING] getVehiculoTarjetaPropietario falló:', e.message);
    }

    try {
      if (vm.cabecera.comprobante && vm.cabecera.comprobante.linea_key) {
        const equipos = await this.getEquiposPorLinea(vm.cabecera.comprobante.linea_key);
        equipos.forEach(eq => {
          vm.equipos[eq.tipomaquina_key] = (eq.nombreequipo || '') + '/' + (eq.serie || '');
        });
      }
    } catch (e) {
      console.warn('[PREVISUALIZACION WARNING] getEquiposPorLinea falló:', e.message);
    }

    try {
      const resultados = await this.getResultadosMaquina(nroInspeccion);
      resultados.forEach(rm => {
        const safeParse = (str) => {
          if (!str) return null;
          if (typeof str === 'object') return str;
          try { return JSON.parse(str); } catch (e) { return null; }
        };

        const parsedData = safeParse(rm.data);
        const parsedPostdata = safeParse(rm.postdata);
        
        let prefix = null;
        switch(String(rm.tipomaquina_key)) {
          case '3': prefix = 'frenos-'; break;
          case '1': prefix = 'alineamiento-'; break;
          case '4': prefix = 'analizador-'; break;
          case '5': prefix = 'opacimetro-'; break;
          case '7': prefix = 'luxometro-'; break;
          case '2': prefix = 'suspension-'; break;
          case '6': prefix = 'sonometro-'; break;
          case '10': prefix = 'profundimetro-'; break;
        }

        if (prefix) {
          const processObj = (obj) => {
            if (!obj) return;
            Object.keys(obj).forEach(k => {
              let val = obj[k];
              if (val !== null && val !== undefined && String(val).trim() !== '') {
                 if (typeof val === 'number' || !isNaN(Number(val))) {
                    let num = Number(val);
                    // Reglas legacy
                    if (prefix === 'frenos-' && k.toLowerCase().includes('peso')) {
                       val = Math.round(num).toString();
                    } else if ((prefix === 'analizador-' || prefix === 'opacimetro-') && (k.toLowerCase().includes('tmp') || k.toLowerCase().includes('rpm'))) {
                       val = Math.round(num).toString();
                    } else {
                       const rounded = Math.round((num + Number.EPSILON) * 100) / 100;
                       val = String(rounded);
                    }
                 } else {
                    val = String(val);
                 }
                 vm.resultados[prefix + k] = val;
              }
            });
          };

          // Postdata sobrescribe a data según CertificadoLayout.java
          processObj(parsedData);
          processObj(parsedPostdata);
          
          if (rm.resultado) {
             vm.resultados[prefix + 'resultado-final'] = rm.resultado;
          }

        }

        // Buscar Foto (tipo 15, 13 o 11)
        if (String(rm.tipomaquina_key) === '15' || String(rm.tipomaquina_key) === '13' || String(rm.tipomaquina_key) === '11') {
          if (parsedData && typeof parsedData === 'object' && parsedData.foto) {
             vm.imagenes = vm.imagenes || {};
            vm.imagenes.fotoVehiculo = 'data:image/png;base64,' + Buffer.from(parsedData.foto, 'hex').toString('base64');
          }
        }
      });
    } catch (e) {
      console.warn('[PREVISUALIZACION WARNING] getResultadosMaquina falló:', e.message);
    }

    try {
      vm.defectos = await this.getDefectos(nroInspeccion);
      
      // Agregar observación manual segura, después de deduplicar y sin volver a deduplicar
      const observacion = vm.cabecera?.inspeccion?.observacion;
      const obs = observacion === null || observacion === undefined
        ? ''
        : String(observacion).trim();
      
      if (obs.length > 0) {
        vm.defectos.push({
          codigovalor: '',
          nombrevalor: obs,
          nivelpeligro: ''
        });
      }
    } catch (e) {
      console.warn('[PREVISUALIZACION WARNING] getDefectos falló:', e.message);
    }

    try {
      if (vm.cabecera.inspeccion && vm.cabecera.inspeccion.usuarioingcertificador_username) {
        const firma = await this.getFirmaUsuario(vm.cabecera.inspeccion.usuarioingcertificador_username);
        if (firma) {
          vm.imagenes = vm.imagenes || {};
          vm.imagenes.firmaCertificador = firma;
        }
      }
    } catch (e) {
      console.warn('[PREVISUALIZACION WARNING] getFirmaUsuario falló:', e.message);
    }

    return vm;
  }

  async getFirmaUsuario(username) {
    if (!username) return null;
    const q = `SELECT firmacertificador FROM usuario WHERE username = $1`;
    const res = await db.query(q, [username]);
    return res.rows[0] ? res.rows[0].firmacertificador : null;
  }

  async getDefectos(nroInspeccion) {
    if (!nroInspeccion) return [];
    
    // Obtener defectos vinculados directamente (resultado_maquina_defecto) conservando orden BD
    const qDefectos = `
      SELECT d.codigovalor, d.nombrevalor, d.nivelpeligro 
      FROM resultado_maquina rm 
      JOIN resultado_maquina_defecto rmd ON rmd.resultado_maquina_id = rm.id 
      JOIN defecto d ON d.id = rmd.defectos_id 
      WHERE rm.inspeccion_nrodocumentoinspeccion LIKE $1
    `;
    const res = await db.query(qDefectos, [`${nroInspeccion}%`]);
    const listaDefectos = res.rows || [];

    // Obtener defectos desde mapaNormas (solo data)
    const normalizarJson = (value) => {
      if (value == null) return {};
      if (typeof value === 'object' && !Array.isArray(value)) return value;
      if (typeof value === 'string' && value.trim() !== '') {
        try {
          const parsed = JSON.parse(value);
          return parsed && typeof parsed === 'object' ? parsed : {};
        } catch { return {}; }
      }
      return {};
    };

    const qResultados = `
      SELECT rm.data, rm.postdata, m.tipomaquina_key 
      FROM resultado_maquina rm
      JOIN maquina m ON rm.maquina_id = m.id
      WHERE rm.inspeccion_nrodocumentoinspeccion LIKE $1
    `;
    const resultados = await db.query(qResultados, [`${nroInspeccion}%`]);
    
    const normaIdsMap = new Map(); // id -> severidad
    
    for (const row of resultados.rows) {
       const parsedData = normalizarJson(row.data);
       if (parsedData.mapaNormas) {
           for (const [normaIdStr, severidad] of Object.entries(parsedData.mapaNormas)) {
               const nId = Number(normaIdStr);
               if (Number.isSafeInteger(nId) && nId > 0) {
                   normaIdsMap.set(nId, severidad);
               }
           }
       }
    }

    // --- MOTOR DE REGLAS DINÁMICAS (Cálculos matemáticos) ---
    const dynamicDefectCodes = await reglasEvaluacionService.evaluarDefectosTecnicos(nroInspeccion);



    // Resolver defectos visuales (mapaNormas)
    if (normaIdsMap.size > 0) {
       const ids = Array.from(normaIdsMap.keys());
       const qNormas = `SELECT id, codigovalor, nombrevalor FROM norma WHERE id = ANY($1::bigint[])`;
       const resNormas = await db.query(qNormas, [ids]);
       
       // Agregar a la lista conservando el orden original y asignando severidad
       for (const nId of ids) {
          const severidad = normaIdsMap.get(nId);
          const normaBD = resNormas.rows.find(n => n.id == nId);
          if (normaBD) {
              listaDefectos.push({
                 codigovalor: normaBD.codigovalor,
                 nombrevalor: normaBD.nombrevalor,
                 nivelpeligro: severidad ?? ''
              });
          }
       }
    }

    // Resolver defectos dinámicos calculados
    if (dynamicDefectCodes.length > 0) {
       // Obtenemos los textos reales de la base de datos para no hardcodearlos
       const qDynamic = `SELECT codigovalor, nombrevalor, nivelpeligro FROM defecto WHERE codigovalor = ANY($1) GROUP BY codigovalor, nombrevalor, nivelpeligro`;
       const resDynamic = await db.query(qDynamic, [dynamicDefectCodes]);
       
       for (const code of dynamicDefectCodes) {
           const defBD = resDynamic.rows.find(d => d.codigovalor === code);
           if (defBD) {
               listaDefectos.push({
                   codigovalor: defBD.codigovalor,
                   nombrevalor: defBD.nombrevalor,
                   nivelpeligro: defBD.nivelpeligro ?? ''
               });
           }
       }
    }

    // Deduplicación exacta replicando LinkedHashMap (último insertado sobreescribe anterior)
    const cleanMap = new Map();
    for (const d of listaDefectos) {
       cleanMap.set(d.codigovalor, d);
    }
    const deduplicados = Array.from(cleanMap.values());

    return deduplicados;
  }

  async getResultadosMaquina(nroInspeccion) {
    if (!nroInspeccion) return [];
    const q = `
      SELECT rm.id, rm.resultado, rm.data, rm.postdata, m.tipomaquina_key
      FROM resultado_maquina rm
      JOIN maquina m ON rm.maquina_id = m.id
      WHERE rm.inspeccion_nrodocumentoinspeccion LIKE $1
    `;
    const res = await db.query(q, [`${nroInspeccion}%`]);
    return res.rows;
  }

  async getEquiposPorLinea(lineaKey) {
    if (!lineaKey) return [];
    const q = `
      SELECT m.tipomaquina_key, m.nombreequipo, m.serie 
      FROM linea_etapa le 
      JOIN linea_etapa_maquina lem ON lem.linea_etapa_id = le.id 
      JOIN maquina m ON m.id = lem.maquinas_id 
      WHERE le.linea_key = $1
    `;
    const res = await db.query(q, [lineaKey]);
    return res.rows;
  }

  async getInspeccionBase(nroInspeccion) {
    const q = `
      SELECT i.*, 
             ti.nombre as tipoinspeccionnombre,
             tc.cuerpocertificado,
             ta.ambito as tipoautorizacion_ambito
      FROM inspeccion i
      LEFT JOIN tipoinspeccion ti ON i.tipoinspeccion_key = ti.key
      LEFT JOIN tipocertificado tc ON i.tipocertificado_key = tc.key
      LEFT JOIN tipoautorizacion ta ON i.tipoautorizacion_key = ta.key
      WHERE i.nrodocumentoinspeccion = $1
    `;
    const res = await db.query(q, [nroInspeccion]);
    return res.rows[0] || null;
  }

  async getCertificado(nroInspeccion) {
    const q = `
      SELECT * FROM certificado 
      WHERE inspeccion_nrodocumentoinspeccion = $1 
      ORDER BY fechcreacion DESC LIMIT 1
    `;
    const res = await db.query(q, [nroInspeccion]);
    return res.rows[0] || null;
  }

  async getComprobanteLineaPlantaEmpresa(nroInspeccion) {
    const q = `
      SELECT 
        comp.*, 
        l.nombre as lineanombre, 
        pl.direccion as plantadireccion, 
        emp.nombre as empresanombre, 
        emp.key as empresacertificadora_key,
        emp.telefono as empresatelefono
      FROM comprobante comp
      LEFT JOIN linea l ON l.key = comp.linea_key
      LEFT JOIN planta pl ON pl.key = l.planta_key
      LEFT JOIN empresa emp ON emp.key = pl.empresacertificadora_key
      WHERE comp.inspeccion_nrodocumentoinspeccion = $1
      ORDER BY comp.id DESC NULLS LAST LIMIT 1
    `;
    const res = await db.query(q, [nroInspeccion]);
    return res.rows[0] || null;
  }

  async getVehiculoTarjetaPropietario(nroInspeccion) {
    const q = `
      SELECT 
        v.*,
        cat.nombre as categorianombre,
        m.nombre as marcanombre,
        mod.nombre as modelonombre,
        comb.nombre as combustiblenombre,
        col.nombre as colornombre,
        carr.nombre as carrocerianombre,
        tp.nroplaca as nroplaca,
        COALESCE(prop.nombrerazonsocial, trim(COALESCE(prop.nombres,'') || ' ' || COALESCE(prop.apellidos,''))) as propietarionombre
      FROM inspeccion i
      JOIN vehiculo v ON v.nromotor = i.vehiculo_nromotor
      LEFT JOIN categoria cat ON v.categoria_key = cat.key
      LEFT JOIN marca m ON v.marca_key = m.key
      LEFT JOIN modelo mod ON v.modelo_key = mod.key
      LEFT JOIN combustible comb ON v.combustible_key = comb.key
      LEFT JOIN color col ON v.color_key = col.key
      LEFT JOIN carroceria carr ON v.carroceria_key = carr.key
      LEFT JOIN tarjetapropiedad tp ON v.tarjetapropiedad_id = tp.id
      LEFT JOIN persona prop ON tp.propietario_nrodocumentoidentidad = prop.nrodocumentoidentidad
      WHERE i.nrodocumentoinspeccion = $1
    `;
    const res = await db.query(q, [nroInspeccion]);
    return res.rows[0] || null;
  }

  async renderCertificadoHtml(viewModel) {
    const templatePath = path.resolve(process.cwd(), 'templates', 'certificado_inspeccion.html');
    
    if (fs.existsSync(templatePath)) {
      let rawHtml = fs.readFileSync(templatePath, 'utf8');

      const formatDate = (d) => {
        if (!d) return '';
        const dt = new Date(d);
        const dia = String(dt.getDate()).padStart(2, '0');
        const mes = String(dt.getMonth() + 1).padStart(2, '0');
        return `${dia}/${mes}/${dt.getFullYear()}`;
      };

      const vm = viewModel;
      vm.flags = vm.flags || {};
      if (vm.cabecera.inspeccion) {
        if (vm.cabecera.inspeccion.resultado === 'A' || vm.cabecera.inspeccion.resultado === 'Aprobado') {
          vm.flags.hasCertificado = true;
        }
        if (vm.cabecera.inspeccion.resultado === 'D' || vm.cabecera.inspeccion.resultado === 'Desaprobado') {
          vm.flags.hasInforme = true;
        }
        
        // Asignación de variables de vigencia
        const i = vm.cabecera.inspeccion;
        const c = vm.cabecera.certificado || {};

        let resCert = '';
        if (i.resultado === 'A') resCert = 'APROBADO';
        else if (i.resultado === 'D') resCert = 'DESAPROBADO';

        vm.cabecera.resultadoCertificado = resCert;
        vm.cabecera.vigenciaCertificado = i.vigencia ? i.vigencia + ' MESES' : '';
        vm.cabecera.fechaProximaInspeccion = formatDate(i.fechvencimiento);
        vm.cabecera.fechaInicioVigencia = formatDate(i.fechiniciovigencia);
        vm.cabecera.strFechInspeccion = formatDate(c.fechcreacion || i.fechiniciovigencia || i.fechcreacion);
      }

      const insp = viewModel.cabecera.inspeccion || {};
      const cert = viewModel.cabecera.certificado || {};
      const comp = viewModel.cabecera.comprobante || {};

      const hasInspeccion = (insp.resultado === 'A' || !!cert.nrodocumentocertificado);
      const tipoInspeccionNombre = (insp.tipoinspeccionnombre || '');
      
      const mostrar2daCara = (
        tipoInspeccionNombre.trim().toLowerCase().includes('complement') || 
        tipoInspeccionNombre.trim().toLowerCase().includes('extraordinari')
      );
      
      const empresaKey = comp.empresacertificadora_key || '';
      
      const hasSello = (mostrar2daCara === true && empresaKey !== 'BUCK');

      const safe = (value) => {
        if (value === null || value === undefined) return '';
        return String(value);
      };

      // Tarea 0 - Expansión manual de FreeMarker (cantEjes = 5)
      const cantEjes = 5;
      const regexRangeList = /<#assign\s+myRange\s*=\s*1\.\.cantEjes\s*>\s*<#list\s+myRange\s+as\s+i>([\s\S]*?)<\/#list>/gi;
      rawHtml = rawHtml.replace(regexRangeList, (match, innerContent) => {
        let expanded = '';
        for (let i = 1; i <= cantEjes; i++) {
          let row = innerContent.replace(/\$\{i\}/g, i).replace(/\$\{cantEjes\}/g, cantEjes);
          
          row = row.replace(/<#if\s+i\s*==\s*1\s*>([\s\S]*?)<\/#if>/gi, (_, content) => {
             return (i === 1) ? content : '';
          });
          
          expanded += row + '\n';
        }
        return expanded;
      });

      // Tarea 0.1 - Procesamiento de Defectos (Fase 2)
      
      const escapeHtml = (value) => {
          if (value === null || value === undefined) return '';
          return String(value)
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#39;');
      };

      const contieneListaContadora = /<#assign\s*i\s*=\s*0>\s*<#list\s*defectos\s*as\s*defecto>\s*<#assign\s*i\s*=\s*i\s*\+\s*1>\s*<\/#list>/i.test(rawHtml);
      const contieneSeccionDefectos = /<#if\s+i\s+gt\s+0\s*>/i.test(rawHtml);

      if (contieneListaContadora && contieneSeccionDefectos) {
         const regexListaContadora = /<#assign\s*i\s*=\s*0>\s*<#list\s*defectos\s*as\s*defecto>\s*<#assign\s*i\s*=\s*i\s*\+\s*1>\s*<\/#list>/gi;
         rawHtml = rawHtml.replace(regexListaContadora, '');

         rawHtml = rawHtml.replace(/<#if\s+i\s+gt\s+0\s*>([\s\S]*?)<\/#if>/gi, (match, sectionContent) => {
            if (!vm.defectos || vm.defectos.length === 0) {
               return '';
            }

            // Expandimos únicamente la lista que contiene ${defecto.codigovalor}
            const regexFilaDefectos = /<#assign\s*i\s*=\s*0>\s*<#list\s*defectos\s*as\s*defecto>([\s\S]*?)<#assign\s*i\s*=\s*i\s*\+\s*1>\s*<\/#list>/gi;
            const sectionContentProcesado = sectionContent.replace(regexFilaDefectos, (matchList, filaContent) => {
               let filas = '';
               vm.defectos.forEach(d => {
                  filas += filaContent.replace(/\$\{defecto\.codigovalor\}/g, escapeHtml(d.codigovalor))
                                      .replace(/\$\{defecto\.nombrevalor\}/g, escapeHtml(d.nombrevalor))
                                      .replace(/\$\{defecto\.nivelpeligro\}/g, escapeHtml(d.nivelpeligro));
               });
               return filas;
            });

            return sectionContentProcesado;
         });
      } else {
         console.warn('[PREVISUALIZACION WARNING] No se encontró la estructura esperada de defectos en la plantilla. Se ignora el procesamiento de observaciones.');
      }

      // Tarea 1 - Mapear texto crudo de Freemarker que no usaba location
      rawHtml = rawHtml.replace(/\$\{inspeccion\.tipoinspeccion\.nombre\}/g, (insp.tipoinspeccionnombre || ''));

      // Tarea 2 - Restaurar inyección de firma original sin lógica nueva
      if (viewModel.imagenes && viewModel.imagenes.firmaCertificador) {
        let firma = viewModel.imagenes.firmaCertificador;
        if (!firma.startsWith('data:image')) {
           firma = 'data:image/png;base64,' + firma; // Restaurando fallback
        }
        rawHtml = rawHtml.replace(/\$\{firmaCertificador\}/g, firma);
      }

      // Inyectar formato horizontal
      rawHtml = rawHtml.replace(/\$\{widthCertificado\}/g, "style='width: 100% !important; min-width: 100%; height: auto !important;'");

      // Inyectar imágenes locales como base64 (sello, logos, etc)
      rawHtml = rawHtml.replace(/url\(\.\.\/img\/([^)]+)\)/g, (match, filename) => {
         const imgPath = path.resolve(process.cwd(), 'templates', 'img', filename);
         if (fs.existsSync(imgPath)) {
             const ext = path.extname(filename).substring(1);
             const b64 = fs.readFileSync(imgPath, 'base64');
             return `url(data:image/${ext};base64,${b64})`;
         }
         return 'none';
      });

      // Evaluar tags estáticos de FreeMarker booleanos de forma robusta
      const evalTag = (html, varName, varValue) => {
          let res = html;
          if (varValue) {
             res = res.replace(new RegExp(`<#if\\s+${varName}\\s*==\\s*true\\s*>`, 'gi'), '');
             // Si es true, solo borramos la etiqueta de apertura. El </#if> de cierre quedará huérfano y se limpiará luego.
          } else {
             res = res.replace(new RegExp(`<#if\\s+${varName}\\s*==\\s*true\\s*>([\\s\\S]*?)<\\/#if>`, 'gi'), '');
          }
          
          if (!varValue) {
             res = res.replace(new RegExp(`<#if\\s+${varName}\\s*==\\s*false\\s*>`, 'gi'), '');
          } else {
             res = res.replace(new RegExp(`<#if\\s+${varName}\\s*==\\s*false\\s*>([\\s\\S]*?)<\\/#if>`, 'gi'), '');
          }
          return res;
      };

      rawHtml = evalTag(rawHtml, 'hasInspeccion', hasInspeccion);
      // YA NO evaluamos mostrar2daCara con evalTag porque Cheerio se encarga de eliminar la segunda cara usando .last().remove()
      // rawHtml = evalTag(rawHtml, 'mostrar2daCara', mostrar2daCara);
      rawHtml = evalTag(rawHtml, 'hasSello', hasSello);
      // Configurar costo basado en comprobante
      const importe = comp && comp.importetotal ? Number(comp.importetotal).toFixed(2) : '50.00';
      rawHtml = evalTag(rawHtml, 'hasCosto', true);
      rawHtml = evalTag(rawHtml, 'hasSelloGZ', false);
      rawHtml = evalTag(rawHtml, 'esExtraordinario', tipoInspeccionNombre.trim().toLowerCase().includes('extraordinari'));

      let $ = cheerio.load(rawHtml);

      // Limpieza estricta de valores predeterminados (ficticios) técnicos
      const technicalPrefixes = [
         'frenos-', 'alineamiento-', 'analizador-', 'opacimetro-',
         'luxometro-', 'suspension-', 'sonometro-', 'profundimetro-'
      ];
      $('[location]').each((idx, el) => {
         const loc = $(el).attr('location');
         if (loc && technicalPrefixes.some(p => loc.startsWith(p))) {
             $(el).empty();
         }
      });

      // Procesar mostrar2daCara
      if (mostrar2daCara) {
         // Conservar el bloque inferior completo
         // Borramos los sellos de resolucion de la 1ra cara para no duplicarlos si hay 2da cara
         const primeraCara = $('.certificado-inspeccion.page-breaker').first();
         primeraCara.find('[location="resolucion"]').closest('.pull-left').remove();
         // IMPORTANTE: NO eliminamos 'costo' de la primera cara porque no existe en la segunda cara
      } else {
         // La segunda cara (Foto y Firma) es la segunda instancia (índice 1)
         $('.certificado-inspeccion.page-breaker').eq(1).remove();
      }

      // Limpiar etiquetas FreeMarker residuales que quedaron huérfanas
      let finalHtml = $.html();
      finalHtml = finalHtml.replace(/&lt;#if[\s\S]*?&gt;/gi, '');
      finalHtml = finalHtml.replace(/&lt;\/#if&gt;/gi, '');
      finalHtml = finalHtml.replace(/<#if[\s\S]*?>/gi, '');
      finalHtml = finalHtml.replace(/<\/#if>/gi, '');
      $ = cheerio.load(finalHtml);

      // Procesar hasSello
      if (!hasSello) {
         $('[location="resolucion"]').parent().remove();
      }

      // No debe aparecer ícono roto para las imágenes pendientes
      $('img').each((i, el) => {
         const src = $(el).attr('src');
         if (src && src.includes('${')) {
             $(el).attr('src', '');
             $(el).css('display', 'none');
         }
      });

      const setLocation = ($, location, value) => {
        const el = $(`[location="${location}"]`);
        if (el.length > 0) el.html(safe(value));
      };

      // Empresa y Planta (fallback a ITV CAMBRIDGE si falta data, como pidió el user)
      const empNombre = comp.empresanombre || 'ITV CAMBRIDGE S.A.C.';
      const plDireccion = comp.plantadireccion || 'AV ALFREDO MENDIOLA NO. 5900 URB. HABILITACION INDUSTRIAL P - INDEPENDENCIA LIMA LIMA';
      const empTelefono = comp.empresatelefono || '717-3131';

      setLocation($, 'empresa', empNombre);
      setLocation($, 'direccionPlLugar', `Domicilio Local: ${plDireccion}`);
      setLocation($, 'telefonoEmpresa', empTelefono);
      setLocation($, 'linea', comp.lineanombre || '');

      // Inspección Info (Tipo, Nro Informe)
      setLocation($, 'informeInspeccionNro', insp.nrodocumentoinforme || '');
      // El tipo de inspección se llena por replace de texto directo en rawHtml más abajo,
      // pero también lo intentamos llenar por location si el layout cambió
      setLocation($, 'tipoInspeccion', insp.tipoinspeccionnombre || '');

      // Fechas
      const formatHora = (d) => {
        if (!d) return '';
        const dt = new Date(d);
        let h = dt.getHours();
        const m = String(dt.getMinutes()).padStart(2, '0');
        const s = String(dt.getSeconds()).padStart(2, '0');
        const ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12;
        h = h ? h : 12;
        return `${String(h).padStart(2, '0')}:${m}:${s} ${ampm}`;
      };

      const dateToUse = cert.fechcreacion || insp.fechiniciovigencia || insp.fechcreacion || new Date();
      setLocation($, 'fecha', formatDate(dateToUse));
      setLocation($, 'hora', formatHora(dateToUse));
      setLocation($, 'fechaInspeccion', formatDate(dateToUse));

      setLocation($, 'certificadoStr', 'CERTIFICADO DE INSPECCIÓN TÉCNICA VEHICULAR');
      setLocation($, 'informeStr', 'INFORME DE INSPECCIÓN TÉCNICA VEHICULAR');
      
      // Documentos
      const nroImpresion = hasInspeccion ? cert.nrodocumentocertificado : insp.nrodocumentoinforme;
      setLocation($, 'nroDocu', hasInspeccion ? `CERTIFICADO N°: ${nroImpresion || ''}` : `INFORME N°: ${nroImpresion || ''}`);
      vm.cabecera.nroHojaValorada = (hasInspeccion && cert.nrohojavalorada) ? `Hoja Valorada: ${cert.nrohojavalorada}` : '';
      vm.cabecera.informeInspeccionNro = insp.nrodocumentoinforme;

      // Tipo (Usando tipoinspeccion por ahora como fallback)
      vm.cabecera.tipocertificado = insp.tipoinspeccionnombre || '';
      vm.cabecera.tipoautorizacion = insp.tipoautorizacion_ambito || insp.tipoautorizacion_key || '';
      vm.cabecera.fechaInspeccion = insp.fechiniciovigencia ? formatDate(insp.fechiniciovigencia) : 'Aún no se consolida';

      // I: CARACTERÍSTICAS DEL VEHÍCULO
      const veh = viewModel.vehiculo || {};
      setLocation($, 'propietario', veh.propietarionombre);
      setLocation($, 'fecha', formatDate(cert.fechcreacion || insp.fechiniciovigencia));
      // NO SOBREESCRIBIR 'hora' AQUI, YA FUE SETEADA
      setLocation($, 'nroHojaValorada', vm.cabecera.nroHojaValorada);
      setLocation($, 'tipocertificado', vm.cabecera.tipocertificado);
      setLocation($, 'tipoautorizacion', vm.cabecera.tipoautorizacion);
      setLocation($, 'fechaInspeccion', vm.cabecera.fechaInspeccion);
      setLocation($, 'costo', `Precio<br>S/${importe}`);
      setLocation($, 'informeInspeccionNro', vm.cabecera.informeInspeccionNro);
      
      // Textos Legales y Cuerpo
      setLocation($, 'certificadoStr', 'CERTIFICADO DE INSPECCIÓN TÉCNICA VEHICULAR');
      setLocation($, 'informeStr', 'INFORME DE INSPECCIÓN TÉCNICA VEHICULAR');
      setLocation($, 'claseautorizacionText', 'CLASE DE AUTORIZACIÓN');
      
      const ambito = insp.tipoautorizacion_ambito || '';
      const cuerpo = insp.cuerpocertificado || '';
      const nroInforme = insp.nrodocumentoinforme || '';
      if (cuerpo && cuerpo !== '.') {
         setLocation($, 'tipocertificadocuerpo', `${ambito} ${cuerpo} ${nroInforme}`);
      } else {
         setLocation($, 'tipocertificadocuerpo', '');
      }

      // Resultados finales
      setLocation($, 'resultadoCertificado', vm.cabecera.resultadoCertificado);
      setLocation($, 'vigenciaCertificado', vm.cabecera.vigenciaCertificado);
      setLocation($, 'fechaProximaInspeccion', vm.cabecera.fechaProximaInspeccion);
      setLocation($, 'fechaInicioVigencia', vm.cabecera.fechaInicioVigencia);
      setLocation($, 'strFechInspeccion', vm.cabecera.strFechInspeccion);

      // Foto
      const fotoVehiculo = viewModel.imagenes ? viewModel.imagenes.fotoVehiculo : null;
      if (fotoVehiculo) {
        $('[location="image"]').html(`<img src="${fotoVehiculo}" style="max-width: 100%; max-height: 400px; display: block; margin: 0 auto;"/>`);
      }
      $('img').each((i, el) => {
        const src = $(el).attr('src');
        if (!src || src === '' || src.includes('${')) {
          $(el).remove();
        }
      });

      setLocation($, 'placa', veh.nroplaca);
      setLocation($, 'categoria', veh.categorianombre);
      setLocation($, 'marca', veh.marcanombre);
      setLocation($, 'modelo', veh.modelonombre);
      setLocation($, 'aniofabricacion', veh.aniofabricacion);
      setLocation($, 'kilometraje', veh.kilometraje);
      setLocation($, 'combustible', veh.combustiblenombre);
      setLocation($, 'nroserie', veh.nroserie);
      setLocation($, 'motor', veh.nromotor);
      setLocation($, 'carroceria', veh.carrocerianombre);
      setLocation($, 'marcacarroceria', veh.marcacarroceria);
      
      const ejesRuedas = (veh.nroejes || 0) + ' - ' + (veh.nroruedas || 0);
      setLocation($, 'nroejes-nroruedas', ejesRuedas);
      
      const asienPas = (veh.nroasientos || 0) + ' - ' + (veh.nropasajeros || 0);
      setLocation($, 'asientos-pasajeros', asienPas);
      
      const dim = (veh.longitud || 0) + ' / ' + (veh.ancho || 0) + ' / ' + (veh.alto || 0);
      setLocation($, 'dimensiones', dim);
      
      setLocation($, 'colores', veh.colornombre);
      setLocation($, 'pesoneto', veh.pesoseco);
      setLocation($, 'pesobruto', veh.pesobruto);
      setLocation($, 'cargautil', veh.cargautil);

      // II: DATOS DE LOS EQUIPOS
      const eq = viewModel.equipos || {};
      // Según legacy: 3=Frenómetro, 1=Alineador, 4=Analizador, 5=Opacímetro, 7=Luxómetro, 2=Suspensión
      setLocation($, 'frenometro', eq['3']);
      setLocation($, 'alineador', eq['1']);
      setLocation($, 'analizador', eq['4']);
      setLocation($, 'opacimetro', eq['5']);
      setLocation($, 'luxometro', eq['7']);
      setLocation($, 'suspension', eq['2']);

      // III: RESULTADOS TÉCNICOS
      const resData = viewModel.resultados || {};
      Object.keys(resData).forEach(key => {
        setLocation($, key, resData[key]);
      });

      // Limpieza final de spans que no encontraron match
      $('span[location]').each((i, el) => {
         if ($(el).html() === '') {
             // Dejar vacío, legacy ya lo dejó vacío
         }
      });

      // IV: DEFECTOS (Ya fueron expandidos antes de Cheerio)

      return $.html();
    } else {
      throw new Error(`La plantilla legacy no existe en la ruta: ${templatePath}`);
    }
  }


  async generarHtmlCertificadoOficial(nroInspeccion, user) {
      // 1. Obtener HTML técnico base e intacto
      const htmlTecnico = await this.generarHtmlPrevisualizacion(nroInspeccion, user);
      const $ = cheerio.load(htmlTecnico);

      const $paginas = $('.certificado-inspeccion.page-breaker');
      if ($paginas.length < 1 || $paginas.length > 2) {
          throw new Error("Estructura de documento inesperada. Páginas detectadas: " + $paginas.length);
      }

      // -- 2.1 Inspeccionar elementos fuera de las páginas --
      const estructuraBodyOriginal = $('body').children().map((index, element) => ({
          index,
          tag: element.tagName,
          id: $(element).attr('id') || null,
          class: $(element).attr('class') || null,
          contienePagina: $(element).find('.certificado-inspeccion.page-breaker').length > 0 || $(element).is('.certificado-inspeccion.page-breaker'),
          tablas: $(element).find('table').length,
          locations: $(element).find('[location]').length,
          imagenes: $(element).find('img').length
      })).get();
      console.log('[CERTIFICADO A4] Estructura original del body:', estructuraBodyOriginal);

      // -- 2.2 Listar locations de resultado --
      const locationsResultado = $('body').find('[location]').map((_, element) => $(element).attr('location')).get().filter(location => String(location || '').toLowerCase().includes('resultado'));
      console.log('[CERTIFICADO A4] Locations de resultado:', [...new Set(locationsResultado)]);

      // -- 2.3 Capturar Scope Antes --
      const $scopeAntes = $('<div data-validation-scope="antes"></div>');
      $scopeAntes.append($paginas.clone());

      const capturarMetricas = ($scope) => ({
          tablas: $scope.find('table').length,
          locations: $scope.find('[location]').length,
          imagenes: $scope.find('img').length,
          pageBreakers: $scope.find('.certificado-inspeccion.page-breaker').length,
          filasFrenos: $scope.find('[location^="frenos-pesoEje"]').length,
          filasDefectos: $scope.find('.gridDefecto tbody tr').length
      });

      const obtenerTextos = ($scope, selector) => {
          return $scope.find(selector).map((_, element) => $(element).text().trim()).get();
      };

      const capturarTextos = ($scope) => ({
          placa: obtenerTextos($scope, '[location="placa"]'),
          frenosPesoEje1: obtenerTextos($scope, '[location="frenos-pesoEje1"]'),
          frenosFuerzaDerechaEje1: obtenerTextos($scope, '[location="frenos-fuerzaFrenadoEjeDerecho1"]'),
          eficienciaFrenos: obtenerTextos($scope, '[location="frenos-eficienciaServicio"]'),
          alineamientoEje1: obtenerTextos($scope, '[location="alineamiento-resultadoEje1"]'),
          profundimetroEje1: obtenerTextos($scope, '[location="profundimetro-eje1"]'),
          luxometroBajas: obtenerTextos($scope, '[location="luxometro-resultadoBajas"]'),
          analizadorRpm: obtenerTextos($scope, '[location="analizador-rpm"]'),
          resultadoFinal: obtenerTextos($scope, '[location="resultado"]')
      });

      const metricasAntes = capturarMetricas($scopeAntes);
      const textAntes = capturarTextos($scopeAntes);

      // 3. Determinar fondo principal vía SELECT seguro de solo lectura
      const queryCertificado = `
        SELECT nrodocumentocertificado, empresacertificadora_key 
        FROM certificado 
        WHERE inspeccion_nrodocumentoinspeccion = $1 
        ORDER BY fechcreacion DESC LIMIT 1
      `;
      const resCertificado = await db.query(queryCertificado, [nroInspeccion]);
      const certData = resCertificado.rows[0];

      if (!certData) {
          const error = new Error(`No existe certificado para la inspección ${nroInspeccion}`);
          error.statusCode = 404;
          throw error;
      }

      const empresaKey = String(certData.empresacertificadora_key || '').trim().toUpperCase();
      const esGuiza = empresaKey === 'GUIZA' && String(nroInspeccion).includes('INS-25');
      const claseEmpresa = esGuiza ? 'guiza' : 'farenet';

      // 4. Clonar nodos originales (Preservación completa del OuterHTML y atributos)
      const $paginaPrincipal = $paginas.eq(0).clone();
      const $paginaComplementaria = $paginas.length === 2 ? $paginas.eq(1).clone() : null;

      // 5. Inyectar CSS estricto A4 en el <head> original si no existe
      if ($('#certificado-oficial-a4').length === 0) {
          $('head').append(`
              <style id="certificado-oficial-a4">
                html, body { margin: 0; padding: 0; background: #525659; }
                .cert-document-viewer {
                  display: flex; flex-direction: column; align-items: center; gap: 24px;
                  padding: 24px; min-width: max-content; box-sizing: border-box;
                }
                .a4-page {
                  width: 210mm; height: 297mm; min-width: 210mm; max-width: 210mm;
                  min-height: 297mm; max-height: 297mm; box-sizing: border-box; position: relative;
                  flex: 0 0 auto; background-color: white; box-shadow: 0 4px 16px rgba(0,0,0,.45);
                  overflow: visible; /* Mantener visible hasta comprobación manual en navegador */
                  -webkit-print-color-adjust: exact; print-color-adjust: exact;
                }
                .a4-page-principal.farenet {
                  background-image: url('/img/fondocert_U.png'); background-size: 100% auto;
                  background-position: top center; background-repeat: no-repeat;
                }
                .a4-page-principal.guiza {
                  background-image: url('/img/fondo_cert2.png'); background-size: 100% auto;
                  background-position: top center; background-repeat: no-repeat;
                }
                
                .legacy-page-positioner {
                  position: absolute; inset: 0; display: flex; justify-content: center; align-items: flex-start;
                }
                .legacy-page-canvas {
                  flex: 0 0 auto; display: flow-root;
                  transform-origin: top center;
                }
                .cert-document-viewer .legacy-page-canvas .certificado-inspeccion.page-breaker {
                  page-break-before: auto !important; break-before: auto !important;
                }
                
                @page { size: A4 portrait; margin: 0; }
                @media print {
                  html, body { background: white !important; }
                  .cert-document-viewer { padding: 0; background: white !important; }
                  .a4-page { margin: 0; box-shadow: none; break-after: page; page-break-after: always; }
                  .a4-page:last-child { break-after: auto; page-break-after: auto; }
                }
              </style>
          `);
      }

      // 6. Vaciar y reconstruir ÚNICAMENTE el <body> (preservando el <head>)
      $('body').empty();
      $('body').append('<main class="cert-document-viewer"></main>');

      const $seccionPrincipal = $(`
          <section class="a4-page a4-page-principal ${claseEmpresa}" data-page-type="principal">
              <div class="legacy-page-positioner">
                  <div class="legacy-page-canvas"></div>
              </div>
          </section>
      `);
      $seccionPrincipal.find('.legacy-page-canvas').append($paginaPrincipal);
      $('.cert-document-viewer').append($seccionPrincipal);

      if ($paginaComplementaria) {
          const $seccionComplementaria = $(`
              <section class="a4-page a4-page-complementaria" data-page-type="complementaria">
                  <div class="legacy-page-positioner">
                      <div class="legacy-page-canvas"></div>
                  </div>
              </section>
          `);
          $seccionComplementaria.find('.legacy-page-canvas').append($paginaComplementaria);
          $('.cert-document-viewer').append($seccionComplementaria);
      }

      // 7. Validación Rigurosa Post-Empaquetado (Seguro Anti-Regresiones)
      const $scopeDespues = $('.cert-document-viewer');
      const metricasDespues = capturarMetricas($scopeDespues);
      const textDespues = capturarTextos($scopeDespues);

      const diferenciasMetricas = Object.fromEntries(
          Object.keys(metricasAntes)
              .filter(key => metricasAntes[key] !== metricasDespues[key])
              .map(key => [key, { antes: metricasAntes[key], despues: metricasDespues[key] }])
      );

      const diferenciasTextos = Object.fromEntries(
          Object.keys(textAntes)
              .filter(key => JSON.stringify(textAntes[key]) !== JSON.stringify(textDespues[key]))
              .map(key => [key, { antes: textAntes[key], despues: textDespues[key] }])
      );

      if (Object.keys(diferenciasMetricas).length > 0 || Object.keys(diferenciasTextos).length > 0) {
          console.error('[CERTIFICADO A4] Validación fallida', { diferenciasMetricas, diferenciasTextos });
          throw new Error(`El empaquetado A4 produjo diferencias: ${JSON.stringify({ diferenciasMetricas, diferenciasTextos })}`);
      }

      // 8. Script inyectado para el cálculo dinámico de escala basado en el ancho real
      $('body').append(`
        <script>
          window.addEventListener('load', function() {
            document.querySelectorAll('.a4-page').forEach(function(pagina) {
              var canvas = pagina.querySelector('.legacy-page-canvas');
              if (!canvas) return;
              var contenido = canvas.firstElementChild;
              if (!contenido) return;

              var anchoNatural = Math.max(contenido.scrollWidth, contenido.offsetWidth);
              var altoNatural = Math.max(contenido.scrollHeight, contenido.offsetHeight);

              var escala = Math.min(
                pagina.clientWidth / anchoNatural,
                pagina.clientHeight / altoNatural,
                1
              );

              canvas.style.width = anchoNatural + 'px';
              canvas.style.height = altoNatural + 'px';
              canvas.style.transform = 'scale(' + escala + ')';
            });
          });
        </script>
      `);

      return $.html();
  }
}

module.exports = new CertificadoPreviewService();
