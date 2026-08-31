const { Client } = require('pg'); 
const c = new Client({user: 'postgres', host: '192.168.14.19', password: 'farenet2026**', database: 'inspeccion', port: 5432}); 
c.connect().then(() => {
    return c.query(`
        SELECT u.username, u.perfil_id, u.estado, u.user_type, u.persona_nrodocumentoidentidad,
               p.tipodocumentoidentidad_key as "tipoDocumentoKey", td.nombre as "tipoDocumentoNombre",
               p.nrodocumentoidentidad as "nroDocumento",
               p.nombres, p.apellidos, p.nombrerazonsocial as "nombreRazonSocial",
               p.pais_key as "paisKey", pais.nombre as "paisNombre",
               p.departamento_key as "departamentoKey", dep.nombre as "departamentoNombre",
               p.provincia_key as "provinciaKey", prov.nombre as "provinciaNombre",
               p.distrito_key as "distritoKey", dis.nombre as "distritoNombre",
               p.direccion, p.email, p.telefono, p.persona_contacto as "personaContacto",
               COALESCE(
                   (SELECT json_agg(json_build_object('key', up.plantas_key, 'nombre', pl.nombre))
                    FROM fg_usuario_planta up
                    JOIN fg_planta pl ON pl.key = up.plantas_key
                    WHERE up.usuario_username = u.username),
                   '[]'::json
               ) as sedes
        FROM fg_usuario u
        LEFT JOIN persona p ON u.persona_nrodocumentoidentidad = p.nrodocumentoidentidad
        LEFT JOIN tipodocumentoidentidad td ON p.tipodocumentoidentidad_key = td.key
        LEFT JOIN pais ON p.pais_key = pais.key
        LEFT JOIN departamento dep ON p.departamento_key = dep.key
        LEFT JOIN provincia prov ON p.provincia_key = prov.key
        LEFT JOIN distrito dis ON p.distrito_key = dis.key
        ORDER BY u.username;
    `);
}).then(r => { 
    console.log('obtenerUsuarios OK', r.rows.length); 
    return c.query("SELECT key, nombre FROM tipodocumentoidentidad WHERE estado = true ORDER BY nombre");
}).then(r => {
    console.log('tipodoc OK', r.rows.length);
    return c.query("SELECT key, nombre FROM pais WHERE estado = true ORDER BY nombre");
}).then(r => {
    console.log('pais OK', r.rows.length);
}).catch(e => { 
    console.error('ERROR:', e.message); 
}).finally(() => {
    c.end();
});
