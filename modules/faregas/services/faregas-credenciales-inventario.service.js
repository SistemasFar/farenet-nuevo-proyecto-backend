'use strict';

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const PizZip = require('pizzip');

const EXCLUDED_USERNAME = 'gibarra';

let cachedInventory = null;
let lastLoadedTime = 0;
const CACHE_TTL_MS = 60000; // 1 minuto

const getDirectorioReciente = () => {
    const localAppData = process.env.LOCALAPPDATA || 'C:\\Users\\Sistemas2\\AppData\\Local';
    const root = path.join(localAppData, 'FAREGAS', 'RenovacionCredenciales');
    if (!fs.existsSync(root)) return null;

    const dirs = fs.readdirSync(root)
        .filter((dir) => {
            try {
                return fs.statSync(path.join(root, dir)).isDirectory();
            } catch {
                return false;
            }
        })
        .sort()
        .reverse();

    if (dirs.length === 0) return null;
    return path.join(root, dirs[0]);
};

const parsearXlsxCredenciales = (xlsxPath) => {
    if (!fs.existsSync(xlsxPath)) return new Map();
    try {
        const content = fs.readFileSync(xlsxPath);
        const zip = new PizZip(content);
        const sheetXml = zip.file('xl/worksheets/sheet1.xml')?.asText();
        if (!sheetXml) return new Map();

        const rowRegex = /<x:row r="(\d+)"[^>]*>([\s\S]*?)<\/x:row>/g;
        let match;
        const map = new Map();

        while ((match = rowRegex.exec(sheetXml)) !== null) {
            const rowNum = parseInt(match[1], 10);
            if (rowNum < 7) continue;

            const rowContent = match[2];
            const cellRegex = /<x:c r="([A-Z]+)\d+"[^>]*>(?:<x:is><x:t>([^<]*)<\/x:t><\/x:is>|<x:v>([^<]*)<\/x:v>)?<\/x:c>/g;
            let cMatch;
            const cells = {};
            while ((cMatch = cellRegex.exec(rowContent)) !== null) {
                cells[cMatch[1]] = cMatch[2] !== undefined ? cMatch[2] : (cMatch[3] !== undefined ? cMatch[3] : '');
            }

            const username = String(cells['C'] || '').trim().toLowerCase();
            if (username) {
                map.set(username, {
                    username,
                    nombre: cells['B'] || '',
                    perfil: cells['D'] || '',
                    sede: cells['E'] || '',
                    estado: cells['F'] || '',
                    password: cells['G'] || '',
                    resultado: cells['H'] || ''
                });
            }
        }
        return map;
    } catch (err) {
        console.error('Error al parsear faregas_credenciales_renovadas.xlsx:', err.message);
        return new Map();
    }
};

const cargarInventarioReciente = (forzar = false) => {
    const now = Date.now();
    if (!forzar && cachedInventory && (now - lastLoadedTime < CACHE_TTL_MS)) {
        return cachedInventory;
    }

    const runDir = getDirectorioReciente();
    if (!runDir) {
        cachedInventory = { disponible: false, runDir: null, executedAt: null, records: new Map() };
        lastLoadedTime = now;
        return cachedInventory;
    }

    let manifest = null;
    const manifestPath = path.join(runDir, 'resultado_renovacion.json');
    if (fs.existsSync(manifestPath)) {
        try {
            manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        } catch {
            manifest = null;
        }
    }

    const xlsxPath = path.join(runDir, 'faregas_credenciales_renovadas.xlsx');
    const records = parsearXlsxCredenciales(xlsxPath);

    cachedInventory = {
        disponible: fs.existsSync(xlsxPath),
        runDir,
        xlsxPath,
        executedAt: manifest?.executedAt || null,
        administrator: manifest?.administrator || null,
        updatedUsersCount: manifest?.updatedUsers || records.size,
        records
    };
    lastLoadedTime = now;
    return cachedInventory;
};

const formatearFecha = (fechaIso) => {
    if (!fechaIso) return null;
    try {
        const d = new Date(fechaIso);
        if (isNaN(d.getTime())) return String(fechaIso);
        return d.toLocaleString('es-PE', {
            timeZone: 'America/Lima',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    } catch {
        return String(fechaIso);
    }
};

const escapeXml = (str) => String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/**
 * Garantiza la existencia de la tabla fg_usuario_credencial.
 */
const asegurarTablaCredenciales = async (dbClient) => {
    try {
        await dbClient.query(`
            CREATE TABLE IF NOT EXISTS public.fg_usuario_credencial (
                id SERIAL PRIMARY KEY,
                username VARCHAR(100) NOT NULL UNIQUE,
                estado_credencial VARCHAR(50) NOT NULL,
                tipo_operacion VARCHAR(50) NOT NULL,
                fecha_modificacion TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
                responsable VARCHAR(100) NOT NULL,
                cambiada_posteriormente BOOLEAN DEFAULT FALSE,
                necesita_restablecimiento BOOLEAN DEFAULT FALSE,
                observaciones TEXT,
                CONSTRAINT fk_fg_usuario_credencial_user FOREIGN KEY (username) REFERENCES public.fg_usuario(username) ON DELETE CASCADE
            )
        `);
        await dbClient.query(`
            CREATE INDEX IF NOT EXISTS idx_fg_usuario_credencial_username
            ON public.fg_usuario_credencial(LOWER(username))
        `);
    } catch (err) {
        if (err.code === '42501') return;
        throw err;
    }
};

/**
 * Actualiza el registro de credencial dentro de la transacción activa (transaccional).
 */
const registrarActualizacionCredencial = async (client, {
    username,
    estadoCredencial = 'Contraseña actualizada / Vigente',
    tipoOperacion = 'ACTUALIZACION_PASSWORD',
    responsable = 'gibarra',
    cambiadaPosteriormente = true,
    necesitaRestablecimiento = false,
    observaciones = null
}) => {
    const cleanUsername = String(username || '').trim().toLowerCase();
    if (!cleanUsername) throw new Error('Username requerido para registrar credencial.');

    if (cleanUsername === EXCLUDED_USERNAME) {
        const err = new Error('El usuario gibarra es una cuenta administrativa protegida y su credencial no puede ser modificada.');
        err.code = 'USUARIO_PROTEGIDO';
        err.statusCode = 403;
        throw err;
    }

    const obs = observaciones || `Contraseña actualizada por ${responsable}; credencial anterior invalidada.`;

    await client.query(`
        INSERT INTO public.fg_usuario_credencial (
            username, estado_credencial, tipo_operacion, fecha_modificacion,
            responsable, cambiada_posteriormente, necesita_restablecimiento, observaciones
        ) VALUES (
            $1, $2, $3, CURRENT_TIMESTAMP, $4, $5, $6, $7
        )
        ON CONFLICT (username) DO UPDATE SET
            estado_credencial = EXCLUDED.estado_credencial,
            tipo_operacion = EXCLUDED.tipo_operacion,
            fecha_modificacion = EXCLUDED.fecha_modificacion,
            responsable = EXCLUDED.responsable,
            cambiada_posteriormente = EXCLUDED.cambiada_posteriormente,
            necesita_restablecimiento = EXCLUDED.necesita_restablecimiento,
            observaciones = EXCLUDED.observaciones
    `, [
        username,
        estadoCredencial,
        tipoOperacion,
        responsable,
        cambiadaPosteriormente,
        necesitaRestablecimiento,
        obs
    ]);
};

/**
 * Enriquece la lista de usuarios con los metadatos dinámicos de credenciales desde PostgreSQL.
 */
const enriquecerUsuariosConCredenciales = async (usuarios, dbClient) => {
    if (!Array.isArray(usuarios) || usuarios.length === 0) return usuarios;

    const usernames = usuarios.map(u => String(u.username || '').toLowerCase());

    // Consultar tabla dinámica de credenciales
    let credencialesDb = new Map();
    try {
        const resCred = await dbClient.query(`
            SELECT username, estado_credencial, tipo_operacion, fecha_modificacion,
                   responsable, cambiada_posteriormente, necesita_restablecimiento, observaciones
            FROM public.fg_usuario_credencial
            WHERE LOWER(username) = ANY($1)
        `, [usernames]);

        for (const row of resCred.rows) {
            credencialesDb.set(String(row.username).toLowerCase(), row);
        }
    } catch (e) {
        // En caso de que la tabla aún se esté creando o mock en tests
    }

    // Consultar auditoría como respaldo complementario si falta algún registro
    let ultimosEventos = new Map();
    try {
        const resAudit = await dbClient.query(`
            SELECT DISTINCT ON (LOWER(documento_referencia))
                LOWER(documento_referencia) AS username,
                fecha_evento,
                username AS responsable,
                evento
            FROM fg_auditoria_acceso
            WHERE evento IN ('PASSWORD_ACTUALIZADO', 'USUARIO_ACTUALIZADO')
              AND entidad = 'fg_usuario'
              AND LOWER(documento_referencia) = ANY($1)
            ORDER BY LOWER(documento_referencia),
                     CASE WHEN evento = 'PASSWORD_ACTUALIZADO' THEN 1 ELSE 2 END,
                     fecha_evento DESC
        `, [usernames]);

        for (const row of resAudit.rows) {
            ultimosEventos.set(row.username, row);
        }
    } catch (e) {
        // fg_auditoria_acceso puede no tener eventos aún
    }

    return usuarios.map((user) => {
        const uname = String(user.username || '').toLowerCase();
        const isGibarra = uname === EXCLUDED_USERNAME;

        if (isGibarra) {
            return {
                ...user,
                fechaUltimoRestablecimiento: null,
                responsableRestablecimiento: null,
                estadoCredencial: 'Protegida (Excluida)',
                tipoOperacion: 'PROTEGIDA',
                cambiadaPosteriormente: false,
                necesitaRestablecimiento: false,
                observacionesCredencial: 'Cuenta administrativa protegida — excluida de renovaciones masivas.'
            };
        }

        const cred = credencialesDb.get(uname);
        if (cred) {
            return {
                ...user,
                fechaUltimoRestablecimiento: formatearFecha(cred.fecha_modificacion),
                responsableRestablecimiento: cred.responsable,
                estadoCredencial: cred.estado_credencial,
                tipoOperacion: cred.tipo_operacion,
                cambiadaPosteriormente: cred.cambiada_posteriormente,
                necesitaRestablecimiento: cred.necesita_restablecimiento || user.estado === false,
                observacionesCredencial: cred.observaciones
            };
        }

        // Si no está aún en fg_usuario_credencial, usar auditoría o valores por defecto
        const audit = ultimosEventos.get(uname);
        const fechaCambio = audit ? formatearFecha(audit.fecha_evento) : null;
        const responsable = audit?.responsable || 'ADMINISTRADOR';

        return {
            ...user,
            fechaUltimoRestablecimiento: fechaCambio,
            responsableRestablecimiento: responsable,
            estadoCredencial: 'Individual',
            tipoOperacion: 'CREACION',
            cambiadaPosteriormente: false,
            necesitaRestablecimiento: user.estado === false,
            observacionesCredencial: `Contraseña asignada individualmente${responsable ? ` por ${responsable}` : ''}.`
        };
    });
};

/**
 * Consulta de forma segura la credencial asignada para entrega administrativa.
 * La fuente primaria es la base de datos dinámica. Si la credencial fue modificada,
 * NUNCA depende del Excel histórico ni expone contraseñas obsoletas.
 */
const consultarCredencialAsignada = async (username, dbClient) => {
    const cleanUsername = String(username || '').trim().toLowerCase();
    if (!cleanUsername) {
        throw new Error('Username requerido.');
    }

    if (cleanUsername === EXCLUDED_USERNAME) {
        return {
            disponible: false,
            disponibleTextoPlano: false,
            vigente: false,
            esProtegida: true,
            puedeRestablecer: false,
            username: cleanUsername,
            motivo: 'Usuario gibarra es una cuenta administrativa protegida y fue excluida de la renovación masiva.',
            estadoCredencial: 'Protegida (Excluida)'
        };
    }

    // 1. Consultar usuario en PostgreSQL
    let dbUser = null;
    try {
        const userRes = await dbClient.query(`
            SELECT 
                u.username,
                u.contrasenha,
                u.estado,
                u.perfil_id,
                CASE 
                    WHEN up.tipo_documento_key = 'ruc' THEN up.nombre_razon_social
                    ELSE NULLIF(TRIM(CONCAT(up.nombres, ' ', up.apellidos)), '')
                END AS nombre_completo,
                STRING_AGG(p.nombre, ', ' ORDER BY p.nombre) AS sedes
            FROM fg_usuario u
            LEFT JOIN fg_usuario_perfil up ON LOWER(up.usuario_username) = LOWER(u.username)
            LEFT JOIN fg_usuario_planta upk ON LOWER(upk.usuario_username) = LOWER(u.username)
            LEFT JOIN fg_planta p ON p.key = upk.plantas_key
            WHERE LOWER(u.username) = $1
            GROUP BY u.username, u.contrasenha, u.estado, u.perfil_id, up.tipo_documento_key, up.nombre_razon_social, up.nombres, up.apellidos
            LIMIT 1
        `, [cleanUsername]);

        if (userRes.rowCount > 0) {
            dbUser = userRes.rows[0];
        }
    } catch {
        // En caso de mock o error de BD
    }

    if (!dbUser) {
        return {
            disponible: false,
            disponibleTextoPlano: false,
            vigente: false,
            puedeRestablecer: false,
            username: cleanUsername,
            motivo: 'El usuario no existe en la base de datos.'
        };
    }

    const tienePassword = Boolean(dbUser.contrasenha && dbUser.contrasenha.length > 0);
    const estaActivo = dbUser.estado !== false;
    const vigenteEnPostgres = tienePassword && estaActivo;

    // 2. Consultar estado dinámico en PostgreSQL (fg_usuario_credencial)
    let cred = null;
    try {
        const credRes = await dbClient.query(
            'SELECT * FROM public.fg_usuario_credencial WHERE LOWER(username) = $1 LIMIT 1',
            [cleanUsername]
        );
        if (credRes.rowCount > 0) {
            cred = credRes.rows[0];
        }
    } catch (e) {
        // En caso de mock en tests o tabla en inicialización
    }

    // 3. Revisar si coincide con la credencial en texto plano del inventario inicial reciente
    const inventario = cargarInventarioReciente();
    if (inventario.disponible && inventario.records.has(cleanUsername)) {
        const record = inventario.records.get(cleanUsername);
        if (record.password) {
            const hashCoincide = bcrypt.compareSync(record.password, dbUser.contrasenha);
            if (hashCoincide) {
                return {
                    disponible: true,
                    disponibleTextoPlano: true,
                    vigente: true,
                    cuentaActiva: estaActivo,
                    puedeRestablecer: true,
                    username: cleanUsername,
                    nombreCompleto: dbUser.nombre_completo || record.nombre || cleanUsername,
                    perfil: dbUser.perfil_id || record.perfil || '-',
                    sede: dbUser.sedes || record.sede || '-',
                    password: record.password,
                    fechaAsignacion: cred ? formatearFecha(cred.fecha_modificacion) : (record.fechaRenovacion || formatearFecha(inventario.executedAt)),
                    fechaUltimoRestablecimiento: cred ? formatearFecha(cred.fecha_modificacion) : (record.fechaRenovacion || formatearFecha(inventario.executedAt)),
                    responsableRestablecimiento: cred ? cred.responsable : (record.generadoPor || 'ADMINISTRADOR'),
                    estadoCredencial: cred?.estado_credencial || 'Vigente (Administrada)',
                    tipoOperacion: cred?.tipo_operacion || 'RENOVACION_MASIVA',
                    mensaje: 'Credencial administrada vigente asignada en la última renovación masiva.'
                };
            }
        }
    }

    // 4. Consultar si tiene credencial bajo custodia cifrada (AES-256-GCM)
    let estadoCustodia = { custodiada: false };
    try {
        const custRes = await dbClient.query(`
            SELECT origen, creado_por, fecha_actualizacion, version_clave
            FROM public.fg_credencial_custodia
            WHERE LOWER(username) = $1
            LIMIT 1
        `, [cleanUsername]);
        if (custRes.rowCount > 0) {
            estadoCustodia = {
                custodiada: true,
                origen: custRes.rows[0].origen,
                creadoPor: custRes.rows[0].creado_por,
                fechaActualizacion: custRes.rows[0].fecha_actualizacion,
                versionClave: custRes.rows[0].version_clave
            };
        }
    } catch {
        // En caso de mock en tests o tabla en inicialización
    }

    if (estadoCustodia.custodiada) {
        return {
            disponible: false,
            disponibleTextoPlano: false,
            custodiada: true,
            puedeRevelar: true,
            vigente: vigenteEnPostgres,
            cuentaActiva: estaActivo,
            tieneContrasenha: tienePassword,
            puedeRestablecer: true,
            username: cleanUsername,
            nombreCompleto: dbUser.nombre_completo || cleanUsername,
            perfil: dbUser.perfil_id || '-',
            sede: dbUser.sedes || '-',
            fechaUltimoRestablecimiento: formatearFecha(estadoCustodia.fechaActualizacion) || (cred ? formatearFecha(cred.fecha_modificacion) : 'No registrada'),
            responsableRestablecimiento: estadoCustodia.creadoPor || cred?.responsable || 'ADMINISTRADOR',
            estadoCredencial: cred?.estado_credencial || 'Contraseña actualizada / Vigente',
            tipoOperacion: cred?.tipo_operacion || 'ACTUALIZACION_PASSWORD',
            observaciones: cred?.observaciones || null,
            motivo: 'La credencial administrada vigente se encuentra bajo custodia cifrada (AES-256-GCM). Puede revelarla previa reautenticación de administrador para su entrega.'
        };
    }

    // 5. Si la contraseña no está en texto plano ni bajo custodia:
    // La contraseña actual en PostgreSQL está VIGENTE y ACTIVA.
    // Solo que su valor en texto plano está protegido por hash irreversible (bcrypt).
    return {
        disponible: false,
        disponibleTextoPlano: false,
        custodiada: false,
        puedeRevelar: false,
        vigente: vigenteEnPostgres,
        cuentaActiva: estaActivo,
        tieneContrasenha: tienePassword,
        puedeRestablecer: true,
        username: cleanUsername,
        nombreCompleto: dbUser.nombre_completo || cleanUsername,
        perfil: dbUser.perfil_id || '-',
        sede: dbUser.sedes || '-',
        fechaUltimoRestablecimiento: cred ? formatearFecha(cred.fecha_modificacion) : 'No registrada',
        responsableRestablecimiento: cred ? cred.responsable : 'gibarra',
        estadoCredencial: cred?.estado_credencial || 'Contraseña actualizada / Vigente',
        tipoOperacion: cred?.tipo_operacion || 'ACTUALIZACION_PASSWORD',
        observaciones: cred?.observaciones || null,
        motivo: 'La contraseña actual está activa y vigente en el sistema de autenticación. Por motivos de seguridad y confidencialidad, su valor se resguarda mediante un hash criptográfico unidireccional (bcrypt). Si requiere entregar una clave al usuario, genere una contraseña temporal con 1 clic.'
    };
};

/**
 * Genera dinámicamente el buffer XLSX del Inventario de Credenciales desde PostgreSQL.
 */
const generarBufferExcelInventario = async (dbClient, metadata = {}) => {
    const res = await dbClient.query(`
        SELECT 
            u.username,
            u.estado AS cuenta_activa,
            COALESCE(p.nombre, u.perfil_id, '-') AS perfil,
            CASE 
                WHEN up.tipo_documento_key = 'ruc' THEN up.nombre_razon_social
                ELSE NULLIF(TRIM(CONCAT(up.nombres, ' ', up.apellidos)), '')
            END AS nombre_completo,
            CASE 
                WHEN up.nro_documento IS NOT NULL AND TRIM(up.nro_documento) != '' THEN 
                    CONCAT(UPPER(COALESCE(up.tipo_documento_key, 'DOC')), ' ', up.nro_documento)
                ELSE '-'
            END AS documento,
            COALESCE(c.estado_credencial, CASE WHEN LOWER(u.username) = 'gibarra' THEN 'Protegida (Excluida)' ELSE 'Individual' END) AS estado_credencial,
            COALESCE(c.tipo_operacion, CASE WHEN LOWER(u.username) = 'gibarra' THEN 'PROTEGIDA' ELSE 'CREACION' END) AS tipo_operacion,
            c.fecha_modificacion,
            COALESCE(c.responsable, CASE WHEN LOWER(u.username) = 'gibarra' THEN 'SISTEMA' ELSE 'ADMINISTRADOR' END) AS responsable,
            COALESCE(c.cambiada_posteriormente, FALSE) AS cambiada_posteriormente,
            COALESCE(c.necesita_restablecimiento, u.estado = FALSE) AS necesita_restablecimiento,
            COALESCE(c.observaciones, '') AS observaciones
        FROM public.fg_usuario u
        LEFT JOIN public.fg_usuario_credencial c ON LOWER(c.username) = LOWER(u.username)
        LEFT JOIN public.fg_perfil p ON p.clave = u.perfil_id
        LEFT JOIN public.fg_usuario_perfil up ON LOWER(up.usuario_username) = LOWER(u.username)
        ORDER BY 
            CASE WHEN LOWER(u.username) = 'gibarra' THEN 1 ELSE 2 END,
            u.username ASC
    `);

    const filas = res.rows.map((row) => ({
        username: row.username,
        nombreCompleto: row.nombre_completo || row.username,
        documento: row.documento || '-',
        perfil: row.perfil || '-',
        cuentaActiva: Boolean(row.cuenta_activa),
        estadoCredencial: row.estado_credencial,
        tipoOperacion: row.tipo_operacion,
        fechaModificacion: formatearFecha(row.fecha_modificacion) || '-',
        responsable: row.responsable || '-',
        cambiadaPosteriormente: row.cambiada_posteriormente === true,
        observaciones: row.observaciones || '-'
    }));

    const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

    const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

    const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

    const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Inventario Credenciales" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="3">
    <font><sz val="10"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="14"/><color rgb="FF052A79"/><name val="Calibri"/><family val="2"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF052A79"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFD1D5DB"/></left>
      <right style="thin"><color rgb="FFD1D5DB"/></right>
      <top style="thin"><color rgb="FFD1D5DB"/></top>
      <bottom style="thin"><color rgb="FFD1D5DB"/></bottom>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="4">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center" wrapText="1"/>
    </xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">
      <alignment vertical="center"/>
    </xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
  </cellXfs>
</styleSheet>`;

    const headers = [
        { col: 'A', name: 'N.º', width: 8 },
        { col: 'B', name: 'Nombre completo', width: 32 },
        { col: 'C', name: 'Username', width: 20 },
        { col: 'D', name: 'Documento', width: 18 },
        { col: 'E', name: 'Perfil FAREGAS', width: 22 },
        { col: 'F', name: 'Estado cuenta', width: 14 },
        { col: 'G', name: 'Estado credencial', width: 28 },
        { col: 'H', name: 'Tipo de operación', width: 26 },
        { col: 'I', name: 'Fecha último restablecimiento', width: 28 },
        { col: 'J', name: 'Responsable último cambio', width: 24 },
        { col: 'K', name: 'Contraseña cambiada posteriormente', width: 32 },
        { col: 'L', name: 'Observaciones', width: 50 },
    ];

    let sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cols>`;
    headers.forEach((h, idx) => {
        sheetXml += `<col min="${idx + 1}" max="${idx + 1}" width="${h.width}" customWidth="1"/>`;
    });
    sheetXml += `</cols>
  <sheetData>
    <row r="1">
      <c r="A1" s="3" t="inlineStr"><is><t>FAREGAS — INVENTARIO DINÁMICO DE CREDENCIALES</t></is></c>
    </row>
    <row r="2">
      <c r="A2" t="inlineStr"><is><t>Fecha de exportación: ${escapeXml(metadata.fechaGeneracion || new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' }))}</t></is></c>
    </row>
    <row r="3">
      <c r="A3" t="inlineStr"><is><t>Generado por: ${escapeXml(metadata.solicitante || 'ADMINISTRADOR')}</t></is></c>
    </row>
    <row r="4">
      <c r="A4" t="inlineStr"><is><t>Registros exportados: ${filas.length}</t></is></c>
    </row>
    <row r="5">
      <c r="A5" t="inlineStr"><is><t>Aviso de seguridad: Este inventario refleja el estado dinámico actual. Por seguridad no almacena ni expone contraseñas en texto plano ni hashes.</t></is></c>
    </row>
    <row r="7">`;

    headers.forEach(h => {
        sheetXml += `<c r="${h.col}7" s="1" t="inlineStr"><is><t>${escapeXml(h.name)}</t></is></c>`;
    });
    sheetXml += `</row>`;

    filas.forEach((f, idx) => {
        const rowNum = 8 + idx;
        sheetXml += `<row r="${rowNum}">
          <c r="A${rowNum}" s="2" t="inlineStr"><is><t>${idx + 1}</t></is></c>
          <c r="B${rowNum}" s="2" t="inlineStr"><is><t>${escapeXml(f.nombreCompleto || '-')}</t></is></c>
          <c r="C${rowNum}" s="2" t="inlineStr"><is><t>${escapeXml(f.username || '-')}</t></is></c>
          <c r="D${rowNum}" s="2" t="inlineStr"><is><t>${escapeXml(f.documento || '-')}</t></is></c>
          <c r="E${rowNum}" s="2" t="inlineStr"><is><t>${escapeXml(f.perfil || '-')}</t></is></c>
          <c r="F${rowNum}" s="2" t="inlineStr"><is><t>${escapeXml(f.cuentaActiva ? 'Activo' : 'Inactivo')}</t></is></c>
          <c r="G${rowNum}" s="2" t="inlineStr"><is><t>${escapeXml(f.estadoCredencial || '-')}</t></is></c>
          <c r="H${rowNum}" s="2" t="inlineStr"><is><t>${escapeXml(f.tipoOperacion || '-')}</t></is></c>
          <c r="I${rowNum}" s="2" t="inlineStr"><is><t>${escapeXml(f.fechaModificacion || '-')}</t></is></c>
          <c r="J${rowNum}" s="2" t="inlineStr"><is><t>${escapeXml(f.responsable || '-')}</t></is></c>
          <c r="K${rowNum}" s="2" t="inlineStr"><is><t>${escapeXml(f.cambiadaPosteriormente ? 'Sí' : 'No')}</t></is></c>
          <c r="L${rowNum}" s="2" t="inlineStr"><is><t>${escapeXml(f.observaciones || '-')}</t></is></c>
        </row>`;
    });

    sheetXml += `</sheetData>
  <autoFilter ref="A7:L${7 + filas.length}"/>
</worksheet>`;

    const zip = new PizZip();
    zip.file('[Content_Types].xml', contentTypesXml);
    zip.file('_rels/.rels', relsXml);
    zip.file('xl/_rels/workbook.xml.rels', workbookRelsXml);
    zip.file('xl/workbook.xml', workbookXml);
    zip.file('xl/styles.xml', stylesXml);
    zip.file('xl/worksheets/sheet1.xml', sheetXml);

    return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
};

const getRutaArchivoInventario = () => {
    const inventario = cargarInventarioReciente();
    if (inventario.disponible && fs.existsSync(inventario.xlsxPath)) {
        return inventario.xlsxPath;
    }
    return null;
};

module.exports = {
    cargarInventarioReciente,
    asegurarTablaCredenciales,
    registrarActualizacionCredencial,
    enriquecerUsuariosConCredenciales,
    consultarCredencialAsignada,
    generarBufferExcelInventario,
    getRutaArchivoInventario,
    EXCLUDED_USERNAME
};
