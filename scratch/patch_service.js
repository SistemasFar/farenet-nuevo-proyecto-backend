const fs = require('fs');

const file = 'C:/Users/Sistemas2/Desktop/farenet nuevo proyecto/farenetBackend/modules/faregas/services/faregas-certificados.service.js';
let content = fs.readFileSync(file, 'utf8');

if (!content.includes('exports.validarEmision = async')) {
    const serviceFunction = `
exports.validarEmision = async (id, userContext) => {
    const rCert = await db.query(\`
        SELECT c.*, t.clave as tipo_clave 
        FROM fg_certificado c
        JOIN fg_tipo_certificado t ON c.tipo_certificado_clave = t.clave
        WHERE c.id = $1
    \`, [id]);
    
    if (rCert.rowCount === 0) throw new Error('CERTIFICADO_NOT_FOUND');
    const cert = rCert.rows[0];

    await validarAccesoCertificado(userContext.username, userContext.perfil_id, cert.planta_key);

    if (cert.estado !== 'BORRADOR') {
        return { valido: false, errores: [{ seccion: 'general', campo: 'estado', codigo: 'ESTADO_INVALIDO', mensaje: 'El certificado no está en estado BORRADOR' }] };
    }

    const errores = [];
    const pushError = (seccion, campo, codigo, mensaje) => errores.push({ seccion, campo, codigo, mensaje });

    // Vehículo base
    const rVeh = await db.query('SELECT * FROM fg_certificado_vehiculo WHERE certificado_id = $1', [id]);
    const veh = rVeh.rows[0];
    if (!veh) {
        pushError('vehiculo', 'general', 'SECCION_FALTANTE', 'Falta el snapshot de vehículo');
    } else {
        if (!veh.placa) pushError('vehiculo', 'placa', 'CAMPO_REQUERIDO', 'Placa requerida');
        
        const checkCampos = (campos) => {
            campos.forEach(c => {
                if (veh[c] === null || veh[c] === undefined || veh[c] === '') {
                    pushError('vehiculo', c, 'CAMPO_REQUERIDO', \`Campo vehiculo requerido: \${c}\`);
                }
            });
        };

        if (!veh.vin && !veh.serie_chasis) {
            pushError('vehiculo', 'vin', 'CAMPO_REQUERIDO', 'Se requiere VIN o Serie de Chasis');
        }

        if (cert.tipo_clave === 'GNV_ANUAL') {
            checkCampos([
                'categoria', 'marca', 'modelo', 'version', 'anio_fabricacion', 'numero_motor',
                'numero_cilindros', 'cilindrada', 'combustible', 'numero_ejes', 'numero_ruedas',
                'numero_asientos', 'numero_pasajeros', 'longitud', 'ancho', 'alto', 'color',
                'peso_neto', 'peso_bruto'
            ]);
        } else if (cert.tipo_clave === 'GLP_ANUAL') {
            checkCampos([
                'categoria', 'marca', 'modelo', 'version', 'anio_fabricacion', 'numero_motor',
                'numero_cilindros', 'cilindrada', 'combustible', 'numero_ejes', 'numero_ruedas',
                'numero_asientos', 'numero_pasajeros', 'longitud', 'ancho', 'alto', 
                'peso_neto', 'peso_bruto', 'carga_util'
            ]);
        } else if (cert.tipo_clave === 'CONFORMIDAD') {
            checkCampos([
                'clase', 'categoria', 'modelo', 'marca', 'numero_motor', 'color', 'carroceria',
                'combustible', 'longitud', 'ancho', 'alto', 'peso_bruto', 'peso_neto', 'carga_util',
                'anio_fabricacion', 'anio_modelo', 'formula_rodante', 'potencia', 'numero_ejes',
                'numero_ruedas', 'numero_asientos', 'numero_pasajeros', 'cilindrada', 'numero_cilindros', 'version'
            ]);
        }
    }

    // Titulares
    const rTit = await db.query('SELECT * FROM fg_certificado_titular WHERE certificado_id = $1 ORDER BY orden', [id]);
    const titulares = rTit.rows;
    
    if (cert.tipo_clave === 'GLP_ANUAL' || cert.tipo_clave === 'CONFORMIDAD') {
        if (titulares.length === 0) {
            pushError('titular', 'general', 'TITULAR_REQUERIDO', 'Se requiere al menos 1 titular');
        } else {
            titulares.forEach(t => {
                if (!t.tipo_documento) pushError('titular', 'tipo_documento', 'CAMPO_REQUERIDO', 'Tipo documento requerido');
                if (!t.nro_documento) pushError('titular', 'nro_documento', 'CAMPO_REQUERIDO', 'Nro documento requerido');
                if (!t.nombre_razon_social) pushError('titular', 'nombre_razon_social', 'CAMPO_REQUERIDO', 'Nombre requerido');
                
                if (cert.tipo_clave === 'CONFORMIDAD' && !t.direccion) {
                    pushError('titular', 'direccion', 'CAMPO_REQUERIDO', 'Dirección requerida para titular de conformidad');
                }
            });
        }
    }

    // GNV Especifico
    if (cert.tipo_clave === 'GNV_ANUAL') {
        const rGnv = await db.query('SELECT * FROM fg_certificado_gnv WHERE certificado_id = $1', [id]);
        if (rGnv.rowCount === 0) {
            pushError('gnv', 'general', 'SECCION_FALTANTE', 'Faltan datos de GNV');
        } else {
            const g = rGnv.rows[0];
            if (!g.taller_autorizado_id) pushError('gnv', 'taller_autorizado_id', 'CAMPO_REQUERIDO', 'Taller autorizado requerido');
            if (!g.vigencia_hasta) pushError('gnv', 'vigencia_hasta', 'CAMPO_REQUERIDO', 'Vigencia requerida');
        }

        const rVer = await db.query('SELECT * FROM fg_certificado_gnv_verificacion WHERE certificado_id = $1', [id]);
        const verifCodes = rVer.rows.map(v => v.codigo);
        const reqCodes = ['a','b','c','d','e','f','g','h'];
        const missing = reqCodes.filter(c => !verifCodes.includes(c));
        if (missing.length > 0) {
            pushError('gnv', 'verificaciones', 'VERIFICACIONES_INCOMPLETAS', 'Faltan verificaciones GNV: ' + missing.join(', '));
        }

        rVer.rows.forEach(v => {
            if (v.cumple === null) {
                pushError('gnv', 'verificaciones', 'VERIFICACION_NO_EVALUADA', \`Verificación \${v.codigo} no evaluada\`);
            } else if (v.cumple === false) {
                pushError('gnv', 'verificaciones', 'VERIFICACION_NO_CUMPLE', \`Verificación \${v.codigo} NO CUMPLE\`);
                const obs = (v.observacion || '').trim();
                if (!obs) {
                    pushError('gnv', 'observaciones', 'CAMPO_REQUERIDO', \`Verificación \${v.codigo} NO CUMPLE pero no tiene observación\`);
                }
            }
        });
    }

    // GLP Especifico
    if (cert.tipo_clave === 'GLP_ANUAL') {
        const rGlp = await db.query('SELECT * FROM fg_certificado_glp WHERE certificado_id = $1', [id]);
        if (rGlp.rowCount === 0) {
            pushError('glp', 'general', 'SECCION_FALTANTE', 'Faltan datos de GLP');
        } else {
            const g = rGlp.rows[0];
            if (!g.taller_autorizado_id) pushError('glp', 'taller_autorizado_id', 'CAMPO_REQUERIDO', 'Taller autorizado requerido');
            if (!g.vigencia_hasta) pushError('glp', 'vigencia_hasta', 'CAMPO_REQUERIDO', 'Vigencia requerida');
            if (!g.expediente_tecnico) pushError('glp', 'expediente_tecnico', 'CAMPO_REQUERIDO', 'Expediente técnico requerido');
        }

        const rComp = await db.query('SELECT * FROM fg_certificado_glp_componente WHERE certificado_id = $1', [id]);
        const compTypes = rComp.rows.map(c => c.componente);
        if (!compTypes.includes('CILINDRO')) pushError('glp', 'componentes', 'COMPONENTE_REQUERIDO', 'Se requiere al menos 1 CILINDRO');
        if (!compTypes.includes('REGULADOR')) pushError('glp', 'componentes', 'COMPONENTE_REQUERIDO', 'Se requiere al menos 1 REGULADOR');
        
        rComp.rows.forEach(c => {
            if (!c.marca) pushError('glp', 'componentes', 'CAMPO_REQUERIDO', \`Marca requerida para componente \${c.componente}\`);
            if (!c.modelo) pushError('glp', 'componentes', 'CAMPO_REQUERIDO', \`Modelo requerido para componente \${c.componente}\`);
            if (c.componente === 'CILINDRO') {
                if (!c.serie) pushError('glp', 'componentes', 'CAMPO_REQUERIDO', 'Serie requerida para CILINDRO');
                if (!c.capacidad) pushError('glp', 'componentes', 'CAMPO_REQUERIDO', 'Capacidad requerida para CILINDRO');
                if (!c.mes_fabricacion) pushError('glp', 'componentes', 'CAMPO_REQUERIDO', 'Mes fabricación requerido para CILINDRO');
                if (!c.anio_fabricacion) pushError('glp', 'componentes', 'CAMPO_REQUERIDO', 'Año fabricación requerido para CILINDRO');
            }
        });

        const rVer = await db.query('SELECT * FROM fg_certificado_glp_verificacion WHERE certificado_id = $1', [id]);
        const verifCodes = rVer.rows.map(v => v.codigo);
        const reqCodes = ['1','2','3','4','5','6','7'];
        const missing = reqCodes.filter(c => !verifCodes.includes(c));
        if (missing.length > 0) {
            pushError('glp', 'verificaciones', 'VERIFICACIONES_INCOMPLETAS', 'Faltan verificaciones GLP: ' + missing.join(', '));
        }

        rVer.rows.forEach(v => {
            if (v.cumple === null) {
                pushError('glp', 'verificaciones', 'VERIFICACION_NO_EVALUADA', \`Verificación \${v.codigo} no evaluada\`);
            } else if (v.cumple === false) {
                pushError('glp', 'verificaciones', 'VERIFICACION_NO_CUMPLE', \`Verificación \${v.codigo} NO CUMPLE\`);
                const obs = (v.observacion || '').trim();
                if (!obs) {
                    pushError('glp', 'observaciones', 'CAMPO_REQUERIDO', \`Verificación \${v.codigo} NO CUMPLE pero no tiene observación\`);
                }
            }
        });
    }

    // Conformidad Especifico
    if (cert.tipo_clave === 'CONFORMIDAD') {
        const rConf = await db.query('SELECT * FROM fg_certificado_conformidad WHERE certificado_id = $1', [id]);
        if (rConf.rowCount === 0) {
            pushError('conformidad', 'general', 'SECCION_FALTANTE', 'Faltan datos de Conformidad');
        } else {
            const c = rConf.rows[0];
            const validTipos = ['MODIFICACION', 'MONTAJE', 'FABRICACION'];
            if (!validTipos.includes(c.tipo_conformidad)) pushError('conformidad', 'tipo_conformidad', 'TIPO_INVALIDO', 'Tipo de conformidad inválido');
            if (!c.tipo_tramite) pushError('conformidad', 'tipo_tramite', 'CAMPO_REQUERIDO', 'Tipo trámite requerido');
            if (!c.caracteristica_registrable) pushError('conformidad', 'caracteristica_registrable', 'CAMPO_REQUERIDO', 'Característica registrable requerida');
            if (!c.motivo) pushError('conformidad', 'motivo', 'CAMPO_REQUERIDO', 'Motivo requerido');
            if (!c.descripcion) pushError('conformidad', 'descripcion', 'CAMPO_REQUERIDO', 'Descripción requerida');
            if (!c.uso_original_vehiculo) pushError('conformidad', 'uso_original_vehiculo', 'CAMPO_REQUERIDO', 'Uso original requerido');
        }
    }

    return {
        valido: errores.length === 0,
        errores
    };
};
`;
    content += serviceFunction;
    fs.writeFileSync(file, content);
    console.log('Service updated');
}
