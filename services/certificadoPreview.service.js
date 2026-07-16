const fs = require('fs');
const path = require('path');
const db = require('../config/database');
const cheerio = require('cheerio');

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
        if (!rm.data) return;
        let parsedData = rm.data;
        if (typeof parsedData === 'string') {
          try {
            parsedData = JSON.parse(rm.data);
          } catch (e) {
            console.warn('[PREVISUALIZACION] Error parseando data de maquina tipo', rm.tipomaquina_key);
            return;
          }
        }

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

        if (prefix && typeof parsedData === 'object') {
          vm.resultadosMaquinaInfo = vm.resultadosMaquinaInfo || [];
          vm.resultadosMaquinaInfo.push({
            tipoMaquina: rm.tipomaquina_key,
            prefix,
            keys: Object.keys(parsedData)
          });
          
          Object.keys(parsedData).forEach(k => {
            vm.resultados[prefix + k] = parsedData[k];
          });
        }

        // Buscar Foto (tipo 15, 13 o 11)
        if (String(rm.tipomaquina_key) === '15' || String(rm.tipomaquina_key) === '13' || String(rm.tipomaquina_key) === '11') {
          if (typeof parsedData === 'object' && parsedData.foto) {
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
    const q = `
      SELECT DISTINCT d.codigovalor, d.nombrevalor, d.nivelpeligro 
      FROM resultado_maquina rm 
      JOIN resultado_maquina_defectos rmd ON rmd.resultado_maquina_id = rm.id 
      JOIN defecto d ON d.id = rmd.defectos_id 
      WHERE rm.inspeccion_nrodocumentoinspeccion = $1
      ORDER BY d.codigovalor ASC
    `;
    const res = await db.query(q, [nroInspeccion]);
    return res.rows;
  }

  async getResultadosMaquina(nroInspeccion) {
    if (!nroInspeccion) return [];
    const q = `
      SELECT rm.data, m.tipomaquina_key
      FROM resultado_maquina rm
      JOIN maquina m ON rm.maquina_id = m.id
      WHERE rm.inspeccion_nrodocumentoinspeccion = $1
    `;
    const res = await db.query(q, [nroInspeccion]);
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
      const mostrar2daCara = false;
      const hasCosto = false;
      
      // Lógica de Sello (Legacy)
      let hasSello = true;
      let hasSelloGZ = false;
      
      const nroDoc = insp.nrodocumentoinspeccion || '';
      const empresaKey = comp.empresacertificadora_key || '';

      if (viewModel.defectos && viewModel.defectos.length > 2) {
        hasSello = false;
        hasSelloGZ = false;
      }

      if (nroDoc.includes('INS-25')) {
        hasSelloGZ = true;
      }

      if (empresaKey === 'BUCK' || empresaKey === 'MALONGO') {
        hasSelloGZ = false;
      }

      if (empresaKey === 'BUCK') {
        hasSello = false;
      }

      const evaluateCondition = (htmlStr, flagName, value) => {
        const trueRegex = new RegExp(`<#if\\s+${flagName}\\s*==\\s*true\\s*>([\\s\\S]*?)<\\/#if>`, 'gi');
        const falseRegex = new RegExp(`<#if\\s+${flagName}\\s*==\\s*false\\s*>([\\s\\S]*?)<\\/#if>`, 'gi');

        if (value) {
            htmlStr = htmlStr.replace(trueRegex, '$1');
            htmlStr = htmlStr.replace(falseRegex, '');
        } else {
            htmlStr = htmlStr.replace(trueRegex, '');
            htmlStr = htmlStr.replace(falseRegex, '$1');
        }
        return htmlStr;
      };

      rawHtml = evaluateCondition(rawHtml, 'hasInspeccion', hasInspeccion);
      rawHtml = evaluateCondition(rawHtml, 'hasCertificado', hasInspeccion);
      rawHtml = evaluateCondition(rawHtml, 'mostrar2daCara', mostrar2daCara);
      rawHtml = evaluateCondition(rawHtml, 'hasCosto', hasCosto);
      rawHtml = evaluateCondition(rawHtml, 'hasSello', hasSello);
      rawHtml = evaluateCondition(rawHtml, 'hasSelloGZ', hasSelloGZ);

      // Inyectar Firma
      if (viewModel.imagenes && viewModel.imagenes.firmaCertificador) {
        rawHtml = rawHtml.replace(/\$\{firmaCertificador\}/g, viewModel.imagenes.firmaCertificador);
      }

      // Inyectar formato horizontal
      rawHtml = rawHtml.replace(/\$\{widthCertificado\}/g, "style='width: 100% !important; min-width: 100%; height: auto !important;'");
      // rawHtml = rawHtml.replace(/background:\s*url\([^)]+\)/g, "background: none !important");
      // rawHtml = rawHtml.replace(/background-image:\s*url\([^)]+\)/g, "background: none !important");

      // Inyectar imágenes locales como base64
      rawHtml = rawHtml.replace(/url\(\.\.\/img\/([^)]+)\)/g, (match, filename) => {
         const imgPath = path.resolve(process.cwd(), 'templates', 'img', filename);
         if (fs.existsSync(imgPath)) {
             const ext = path.extname(filename).substring(1);
             const b64 = fs.readFileSync(imgPath, 'base64');
             return `url(data:image/${ext};base64,${b64})`;
         }
         return 'none';
      });

      // Limpiar restos Freemarker
      rawHtml = rawHtml.replace(/<#assign[^>]*>/gi, '');
      rawHtml = rawHtml.replace(/<#list[^>]*>/gi, '');
      rawHtml = rawHtml.replace(/<\/#list>/gi, '');
      rawHtml = rawHtml.replace(/<#if[^>]*>/gi, '');
      rawHtml = rawHtml.replace(/<\/#if>/gi, '');
      rawHtml = rawHtml.replace(/\$\{[^}]+\}/g, '');

      const $ = cheerio.load(rawHtml);

      const safe = (value) => {
        if (value === null || value === undefined) return '';
        return String(value);
      };

      const setLocation = ($, location, value) => {
        const el = $(`[location="${location}"]`);
        if (el.length > 0) el.html(safe(value));
      };

      // Empresa
      setLocation($, 'empresa', comp.empresanombre);
      setLocation($, 'direccionPlLugar', comp.plantadireccion ? `Domicilio Local: ${comp.plantadireccion}` : '');
      setLocation($, 'telefonoEmpresa', comp.empresatelefono);

      // Fechas
      const formatHora = (d) => {
        if (!d) return '';
        const dt = new Date(d);
        let h = dt.getHours();
        const m = String(dt.getMinutes()).padStart(2, '0');
        const ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12;
        h = h ? h : 12;
        return `${String(h).padStart(2, '0')}:${m} ${ampm}`;
      };

      vm.cabecera.hora = formatHora(cert.fechcreacion);
      
      // Documentos
      const nroImpresion = hasInspeccion ? cert.nrodocumentocertificado : insp.nrodocumentoinforme;
      vm.cabecera.nroDocu = hasInspeccion ? `Certificado N°: ${safe(nroImpresion)}` : `Informe N°: ${safe(nroImpresion)}`;
      vm.cabecera.nroHojaValorada = (hasInspeccion && cert.nrohojavalorada) ? `Hoja Valorada: ${cert.nrohojavalorada}` : '';
      vm.cabecera.informeInspeccionNro = insp.nrodocumentoinforme;

      // Tipo (Usando tipoinspeccion por ahora como fallback)
      vm.cabecera.tipocertificado = insp.tipoinspeccionnombre || '';
      vm.cabecera.tipoautorizacion = insp.tipoautorizacion_key || '';
      vm.cabecera.fechaInspeccion = insp.fechiniciovigencia ? formatDate(insp.fechiniciovigencia) : 'Aún no se consolida';

      // I: CARACTERÍSTICAS DEL VEHÍCULO
      const veh = viewModel.vehiculo || {};
      setLocation($, 'propietario', veh.propietarionombre);
      setLocation($, 'fecha', formatDate(cert.fechcreacion));
      setLocation($, 'hora', vm.cabecera.hora);
      setLocation($, 'nroDocu', vm.cabecera.nroDocu);
      setLocation($, 'nroHojaValorada', vm.cabecera.nroHojaValorada);
      setLocation($, 'tipocertificado', vm.cabecera.tipocertificado);
      setLocation($, 'tipoautorizacion', vm.cabecera.tipoautorizacion);
      setLocation($, 'fechaInspeccion', vm.cabecera.fechaInspeccion);
      setLocation($, 'informeInspeccionNro', vm.cabecera.informeInspeccionNro);
      
      // Textos Legales y Cuerpo
      setLocation($, 'certificadoStr', 'CERTIFICADO DE INSPECCIÓN TÉCNICA VEHICULAR');
      setLocation($, 'informeStr', 'INFORME DE INSPECCIÓN TÉCNICA VEHICULAR');
      setLocation($, 'claseautorizacionText', 'CLASE DE AUTORIZACIÓN');
      
      const ambito = insp.tipoautorizacion_ambito || '';
      const cuerpo = insp.cuerpocertificado || '';
      const nroInforme = insp.nrodocumentoinforme || '';
      setLocation($, 'tipocertificadocuerpo', `${ambito} ${cuerpo} ${nroInforme}`);

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

      // IV: DEFECTOS
      const tbodyDefectos = $('.gridDefecto tbody');
      if (tbodyDefectos.length > 0) {
        tbodyDefectos.empty();
        if (viewModel.defectos && viewModel.defectos.length > 0) {
          viewModel.defectos.forEach(d => {
            tbodyDefectos.append(`
              <tr>
                <td align="center" style="width: 20%;">${safe(d.codigovalor)}</td>
                <td align="left" style="width: 60%;">${safe(d.nombrevalor)}</td>
                <td align="center" style="width: 20%;">${safe(d.nivelpeligro)}</td>
              </tr>
            `);
          });
        }
      }

      return $.html();
    } else {
      throw new Error(`La plantilla legacy no existe en la ruta: ${templatePath}`);
    }
  }

}

module.exports = new CertificadoPreviewService();
