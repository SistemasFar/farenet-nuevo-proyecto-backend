const db = require('../config/database');

async function run() {
    const client = await db.connect();
    
    try {
        await client.query('BEGIN');
        
        console.log("Creando 1. fg_cliente");
        await client.query(`
            CREATE TABLE fg_cliente (
                id BIGSERIAL PRIMARY KEY,
                tipo_documento VARCHAR(10) NOT NULL,
                nro_documento VARCHAR(20) NOT NULL,
                nombre_razon_social VARCHAR(300) NOT NULL,
                direccion VARCHAR(500) NULL,
                telefono VARCHAR(30) NULL,
                correo VARCHAR(200) NULL,
                estado BOOLEAN NOT NULL DEFAULT true,
                fecha_creacion TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                fecha_modificacion TIMESTAMP WITHOUT TIME ZONE NULL,
                UNIQUE(tipo_documento, nro_documento)
            );
        `);
        
        console.log("Creando 2. fg_tipo_certificado");
        await client.query(`
            CREATE TABLE fg_tipo_certificado (
                clave VARCHAR(30) PRIMARY KEY,
                nombre VARCHAR(100) NOT NULL,
                descripcion VARCHAR(300) NULL,
                activo BOOLEAN NOT NULL DEFAULT true,
                entidad_certificadora_nombre VARCHAR(300) NULL,
                resolucion_directoral VARCHAR(150) NULL,
                domicilio_fiscal VARCHAR(500) NULL,
                telefono VARCHAR(30) NULL,
                lugar_emision VARCHAR(150) NULL
            );
        `);
        
        console.log("Insertando tipos iniciales...");
        await client.query(`
            INSERT INTO fg_tipo_certificado (clave, nombre, descripcion) VALUES
            ('GNV_ANUAL', 'Certificado de Inspección Anual GNV', NULL),
            ('GLP_ANUAL', 'Certificado de Inspección GLP', NULL),
            ('CONFORMIDAD', 'Certificado de Conformidad', NULL);
        `);
        
        console.log("Creando 3. fg_correlativo_certificado");
        await client.query(`
            CREATE TABLE fg_correlativo_certificado (
                id BIGSERIAL PRIMARY KEY,
                tipo_certificado_clave VARCHAR(30) NOT NULL,
                serie VARCHAR(30) NOT NULL,
                ultimo_numero BIGINT NOT NULL DEFAULT 0,
                activo BOOLEAN NOT NULL DEFAULT true,
                fecha_modificacion TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT fk_correlativo_tipo FOREIGN KEY (tipo_certificado_clave) REFERENCES fg_tipo_certificado(clave) ON UPDATE CASCADE ON DELETE NO ACTION,
                UNIQUE(tipo_certificado_clave, serie)
            );
        `);
        
        console.log("Creando 4. fg_certificado");
        await client.query(`
            CREATE TABLE fg_certificado (
                id BIGSERIAL PRIMARY KEY,
                tipo_certificado_clave VARCHAR(30) NOT NULL,
                numero_certificado VARCHAR(50) NULL,
                cliente_id BIGINT NULL,
                planta_key VARCHAR(20) NOT NULL,
                fecha_emision DATE NULL,
                estado VARCHAR(30) NULL,
                observaciones TEXT NULL,
                usuario_creacion VARCHAR(255) NOT NULL,
                fecha_creacion TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                usuario_modificacion VARCHAR(255) NULL,
                fecha_modificacion TIMESTAMP WITHOUT TIME ZONE NULL,
                entidad_certificadora_nombre VARCHAR(300) NULL,
                resolucion_directoral VARCHAR(150) NULL,
                domicilio_fiscal VARCHAR(500) NULL,
                telefono_certificadora VARCHAR(30) NULL,
                lugar_emision VARCHAR(150) NULL,
                CONSTRAINT fk_certificado_tipo FOREIGN KEY (tipo_certificado_clave) REFERENCES fg_tipo_certificado(clave) ON UPDATE CASCADE ON DELETE NO ACTION,
                CONSTRAINT fk_certificado_cliente FOREIGN KEY (cliente_id) REFERENCES fg_cliente(id) ON UPDATE CASCADE ON DELETE NO ACTION,
                CONSTRAINT fk_certificado_planta FOREIGN KEY (planta_key) REFERENCES fg_planta(key) ON UPDATE CASCADE ON DELETE NO ACTION,
                CONSTRAINT fk_certificado_usuarioc FOREIGN KEY (usuario_creacion) REFERENCES fg_usuario(username) ON UPDATE CASCADE ON DELETE NO ACTION,
                CONSTRAINT fk_certificado_usuariom FOREIGN KEY (usuario_modificacion) REFERENCES fg_usuario(username) ON UPDATE CASCADE ON DELETE NO ACTION,
                UNIQUE(numero_certificado)
            );
            CREATE INDEX idx_fg_certificado_nro ON fg_certificado(numero_certificado);
            CREATE INDEX idx_fg_certificado_tipo ON fg_certificado(tipo_certificado_clave);
            CREATE INDEX idx_fg_certificado_cli ON fg_certificado(cliente_id);
            CREATE INDEX idx_fg_certificado_planta ON fg_certificado(planta_key);
            CREATE INDEX idx_fg_certificado_fecha ON fg_certificado(fecha_emision);
            CREATE INDEX idx_fg_certificado_estado ON fg_certificado(estado);
        `);

        console.log("Creando 5. fg_certificado_vehiculo");
        await client.query(`
            CREATE TABLE fg_certificado_vehiculo (
                certificado_id BIGINT PRIMARY KEY,
                placa VARCHAR(255) NULL,
                categoria VARCHAR(255) NULL,
                clase VARCHAR(255) NULL,
                marca VARCHAR(255) NULL,
                modelo VARCHAR(255) NULL,
                version VARCHAR(255) NULL,
                anio_fabricacion VARCHAR(10) NULL,
                anio_modelo VARCHAR(10) NULL,
                vin VARCHAR(255) NULL,
                serie_chasis VARCHAR(255) NULL,
                numero_motor VARCHAR(255) NULL,
                combustible VARCHAR(255) NULL,
                color VARCHAR(255) NULL,
                carroceria VARCHAR(255) NULL,
                numero_cilindros INTEGER NULL,
                cilindrada NUMERIC(10,3) NULL,
                numero_ejes INTEGER NULL,
                numero_ruedas INTEGER NULL,
                numero_asientos INTEGER NULL,
                numero_pasajeros INTEGER NULL,
                longitud NUMERIC(10,3) NULL,
                ancho NUMERIC(10,3) NULL,
                alto NUMERIC(10,3) NULL,
                peso_neto NUMERIC(10,3) NULL,
                peso_bruto NUMERIC(10,3) NULL,
                carga_util NUMERIC(10,3) NULL,
                potencia VARCHAR(100) NULL,
                formula_rodante VARCHAR(50) NULL,
                CONSTRAINT fk_cert_vehiculo_cert FOREIGN KEY (certificado_id) REFERENCES fg_certificado(id) ON UPDATE CASCADE ON DELETE CASCADE
            );
        `);

        console.log("Creando 6. fg_certificado_titular");
        await client.query(`
            CREATE TABLE fg_certificado_titular (
                id BIGSERIAL PRIMARY KEY,
                certificado_id BIGINT NOT NULL,
                cliente_id BIGINT NULL,
                orden SMALLINT NOT NULL,
                tipo_documento VARCHAR(10) NULL,
                nro_documento VARCHAR(20) NULL,
                nombre_razon_social VARCHAR(300) NOT NULL,
                direccion VARCHAR(500) NULL,
                CONSTRAINT fk_cert_titular_cert FOREIGN KEY (certificado_id) REFERENCES fg_certificado(id) ON UPDATE CASCADE ON DELETE CASCADE,
                CONSTRAINT fk_cert_titular_cliente FOREIGN KEY (cliente_id) REFERENCES fg_cliente(id) ON UPDATE CASCADE ON DELETE NO ACTION,
                UNIQUE(certificado_id, orden)
            );
            CREATE INDEX idx_fg_cert_titular_cert ON fg_certificado_titular(certificado_id);
            CREATE INDEX idx_fg_cert_titular_cli ON fg_certificado_titular(cliente_id);
        `);

        console.log("Creando 7. fg_taller_autorizado");
        await client.query(`
            CREATE TABLE fg_taller_autorizado (
                id BIGSERIAL PRIMARY KEY,
                ruc VARCHAR(11) NULL,
                razon_social VARCHAR(300) NOT NULL,
                nombre_comercial VARCHAR(300) NULL,
                sede VARCHAR(200) NULL,
                direccion VARCHAR(500) NULL,
                codigo_autorizacion VARCHAR(100) NULL,
                estado BOOLEAN NOT NULL DEFAULT true,
                fecha_creacion TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                fecha_modificacion TIMESTAMP WITHOUT TIME ZONE NULL
            );
        `);

        console.log("Creando 8. fg_certificado_gnv");
        await client.query(`
            CREATE TABLE fg_certificado_gnv (
                certificado_id BIGINT PRIMARY KEY,
                taller_autorizado_id BIGINT NULL,
                vigencia_hasta DATE NULL,
                taller_razon_social VARCHAR(300) NULL,
                taller_sede VARCHAR(200) NULL,
                taller_direccion VARCHAR(500) NULL,
                taller_codigo_autorizacion VARCHAR(100) NULL,
                CONSTRAINT fk_cert_gnv_cert FOREIGN KEY (certificado_id) REFERENCES fg_certificado(id) ON UPDATE CASCADE ON DELETE CASCADE,
                CONSTRAINT fk_cert_gnv_taller FOREIGN KEY (taller_autorizado_id) REFERENCES fg_taller_autorizado(id) ON UPDATE CASCADE ON DELETE NO ACTION
            );
        `);

        console.log("Creando 9. fg_certificado_gnv_verificacion");
        await client.query(`
            CREATE TABLE fg_certificado_gnv_verificacion (
                id BIGSERIAL PRIMARY KEY,
                certificado_id BIGINT NOT NULL,
                codigo VARCHAR(5) NOT NULL,
                orden SMALLINT NOT NULL,
                descripcion TEXT NOT NULL,
                cumple BOOLEAN NOT NULL,
                observacion TEXT NULL,
                CONSTRAINT fk_cert_gnv_verif_cert FOREIGN KEY (certificado_id) REFERENCES fg_certificado_gnv(certificado_id) ON UPDATE CASCADE ON DELETE CASCADE,
                UNIQUE(certificado_id, codigo),
                UNIQUE(certificado_id, orden)
            );
            CREATE INDEX idx_fg_cert_gnv_verif_cert ON fg_certificado_gnv_verificacion(certificado_id);
        `);

        console.log("Creando 10. fg_certificado_glp");
        await client.query(`
            CREATE TABLE fg_certificado_glp (
                certificado_id BIGINT PRIMARY KEY,
                taller_autorizado_id BIGINT NULL,
                expediente_tecnico VARCHAR(100) NULL,
                vigencia_hasta DATE NULL,
                taller_razon_social VARCHAR(300) NULL,
                taller_sede VARCHAR(200) NULL,
                taller_direccion VARCHAR(500) NULL,
                taller_codigo_autorizacion VARCHAR(100) NULL,
                CONSTRAINT fk_cert_glp_cert FOREIGN KEY (certificado_id) REFERENCES fg_certificado(id) ON UPDATE CASCADE ON DELETE CASCADE,
                CONSTRAINT fk_cert_glp_taller FOREIGN KEY (taller_autorizado_id) REFERENCES fg_taller_autorizado(id) ON UPDATE CASCADE ON DELETE NO ACTION
            );
        `);

        console.log("Creando 11. fg_certificado_glp_componente");
        await client.query(`
            CREATE TABLE fg_certificado_glp_componente (
                id BIGSERIAL PRIMARY KEY,
                certificado_id BIGINT NOT NULL,
                orden SMALLINT NOT NULL,
                componente VARCHAR(100) NOT NULL,
                marca VARCHAR(150) NULL,
                modelo VARCHAR(150) NULL,
                capacidad_litros NUMERIC(10,2) NULL,
                mes_fabricacion SMALLINT NULL CHECK (mes_fabricacion IS NULL OR (mes_fabricacion >= 1 AND mes_fabricacion <= 12)),
                anio_fabricacion SMALLINT NULL,
                numero_serie VARCHAR(200) NULL,
                CONSTRAINT fk_cert_glp_comp_cert FOREIGN KEY (certificado_id) REFERENCES fg_certificado_glp(certificado_id) ON UPDATE CASCADE ON DELETE CASCADE,
                UNIQUE(certificado_id, orden)
            );
            CREATE INDEX idx_fg_cert_glp_comp_cert ON fg_certificado_glp_componente(certificado_id);
        `);

        console.log("Creando 12. fg_certificado_glp_verificacion");
        await client.query(`
            CREATE TABLE fg_certificado_glp_verificacion (
                id BIGSERIAL PRIMARY KEY,
                certificado_id BIGINT NOT NULL,
                codigo VARCHAR(5) NOT NULL,
                orden SMALLINT NOT NULL,
                descripcion TEXT NOT NULL,
                cumple BOOLEAN NOT NULL,
                observacion TEXT NULL,
                CONSTRAINT fk_cert_glp_verif_cert FOREIGN KEY (certificado_id) REFERENCES fg_certificado_glp(certificado_id) ON UPDATE CASCADE ON DELETE CASCADE,
                UNIQUE(certificado_id, codigo),
                UNIQUE(certificado_id, orden)
            );
            CREATE INDEX idx_fg_cert_glp_verif_cert ON fg_certificado_glp_verificacion(certificado_id);
        `);

        console.log("Creando 13. fg_certificado_conformidad");
        await client.query(`
            CREATE TABLE fg_certificado_conformidad (
                certificado_id BIGINT PRIMARY KEY,
                tipo_conformidad VARCHAR(30) NOT NULL,
                tipo_tramite VARCHAR(200) NULL,
                caracteristica_registrable VARCHAR(300) NULL,
                motivo TEXT NULL,
                descripcion TEXT NULL,
                uso_original_vehiculo VARCHAR(200) NULL,
                CONSTRAINT fk_cert_conf_cert FOREIGN KEY (certificado_id) REFERENCES fg_certificado(id) ON UPDATE CASCADE ON DELETE CASCADE
            );
        `);

        await client.query('COMMIT');
        console.log("✅ TRANSACCIÓN EXITOSA.");

        // Mostrar validación
        const tb = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name LIKE 'fg_%'
            ORDER BY table_name;
        `);
        console.log("\\nTABLAS FG_ ACTUALES:", tb.rows.map(r => r.table_name).join(', '));
        
        for (let t of ['fg_tipo_certificado', 'fg_cliente', 'fg_taller_autorizado', 'fg_certificado']) {
            const count = await client.query("SELECT COUNT(*) FROM " + t);
            console.log(t + " rows:", count.rows[0].count);
        }

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("❌ ERROR EN TRANSACCIÓN, ROLLBACK EJECUTADO:", error);
    } finally {
        client.release();
    }
}
run();
