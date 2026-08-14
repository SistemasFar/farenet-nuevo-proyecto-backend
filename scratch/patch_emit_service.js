const fs = require('fs');

const file = 'C:/Users/Sistemas2/Desktop/farenet nuevo proyecto/farenetBackend/modules/faregas/services/faregas-certificados.service.js';
let content = fs.readFileSync(file, 'utf8');

if (!content.includes('exports.emitirCertificado = async')) {
    const serviceFunction = `
exports.emitirCertificado = async (id, userContext) => {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        // Bloquear certificado FOR UPDATE
        const rCert = await client.query(\`
            SELECT c.*, t.clave as tipo_clave, t.codigo as tipo_codigo
            FROM fg_certificado c
            JOIN fg_tipo_certificado t ON c.tipo_certificado_clave = t.clave
            WHERE c.id = $1 FOR UPDATE
        \`, [id]);
        
        if (rCert.rowCount === 0) throw new Error('CERTIFICADO_NOT_FOUND');
        const cert = rCert.rows[0];

        // Validar acceso
        const { validarAccesoCertificado } = require('./faregas-auth.service');
        if(typeof validarAccesoCertificado === 'function') {
            await validarAccesoCertificado(userContext.username, userContext.perfil_id, cert.planta_key);
        } else {
           // fallback auth check
           const { getPlantasPorUsuario } = require('./faregas-auth.service');
           const pRes = await getPlantasPorUsuario(userContext.username, userContext.perfil_id);
           const pKeys = pRes.map(p => p.key);
           if(!pKeys.includes(cert.planta_key)) throw new Error('PLANTA_NO_AUTORIZADA');
        }

        if (cert.estado !== 'BORRADOR') throw new Error('ESTADO_INVALIDO');

        // Validar emisión internamente
        const valRes = await exports.validarEmision(id, userContext);
        if (!valRes.valido) throw new Error('NO_VALIDO_PARA_EMISION');

        // Seleccionar rango activo FOR UPDATE
        const rCorrelativo = await client.query(\`
            SELECT * FROM fg_correlativo_certificado
            WHERE planta_key = $1 AND tipo_certificado_clave = $2 AND activo = true
            FOR UPDATE
        \`, [cert.planta_key, cert.tipo_clave]);

        if (rCorrelativo.rowCount === 0) {
            throw new Error('NO_EXISTE_RANGO_ACTIVO');
        }

        const rango = rCorrelativo.rows[0];
        
        if (rango.nro_actual >= rango.nro_maximo) {
            throw new Error('RANGO_AGOTADO');
        }

        const siguiente = parseInt(rango.nro_actual) + 1;
        if (siguiente > rango.nro_maximo) {
            throw new Error('RANGO_AGOTADO');
        }

        let ancho = 0;
        if (cert.tipo_clave === 'GNV_ANUAL') ancho = 7;
        else if (cert.tipo_clave === 'GLP_ANUAL') ancho = 6;
        else if (cert.tipo_clave === 'CONFORMIDAD') ancho = 6;
        else throw new Error('FORMATO_NUMERO_NO_CONFIGURADO');

        const numeroFormateado = String(siguiente).padStart(ancho, '0');
        const numero_certificado = \`DG-\${cert.tipo_codigo}-\${numeroFormateado}\`;

        // Update correlativo
        await client.query(\`
            UPDATE fg_correlativo_certificado
            SET nro_actual = $1, fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $2
        \`, [siguiente, rango.id]);

        // Update certificado
        await client.query(\`
            UPDATE fg_certificado
            SET estado = 'EMITIDO',
                numero_certificado = $1,
                fecha_emision = CURRENT_TIMESTAMP,
                usuario_modificacion = $2,
                fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $3
        \`, [numero_certificado, userContext.username, id]);

        await client.query('COMMIT');
        
        return {
            numero_certificado
        };

    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
};
`;
    content += serviceFunction;
    fs.writeFileSync(file, content);
    console.log('Service emitirCertificado updated');
}
