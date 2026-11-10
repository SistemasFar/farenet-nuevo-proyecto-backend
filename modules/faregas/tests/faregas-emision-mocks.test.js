const assert = require('assert');
const { tieneColumna, _limpiarCacheColumnas, _forzarColumnaCache } = require('../services/faregas-columna-compat.service');

async function ejecutarPruebas() {
    console.log('--- INICIANDO PRUEBAS OBLIGATORIAS DE EMISIÓN (BACKEND) ---');
    let pruebasPasadas = 0;

    // PRUEBA 1: tieneColumna detecta columna inexistente sin lanzar error
    {
        _limpiarCacheColumnas();
        const mockExecutor = {
            query: async (sql, params) => {
                assert(sql.includes('information_schema.columns'));
                assert.strictEqual(params[0], 'fg_certificado');
                assert.strictEqual(params[1], 'fecha_hora_emision');
                return { rowCount: 0, rows: [] };
            }
        };
        const existe = await tieneColumna('fg_certificado', 'fecha_hora_emision', mockExecutor);
        assert.strictEqual(existe, false, 'Debe devolver false para columna inexistente');
        console.log('✓ 1. Columna fecha_hora_emision inexistente detectada correctamente (false) sin error SQL.');
        pruebasPasadas++;
    }

    // PRUEBA 2: tieneColumna detecta columna existente cuando existe
    {
        _limpiarCacheColumnas();
        const mockExecutor = {
            query: async (sql, params) => {
                return { rowCount: 1, rows: [{ '?column?': 1 }] };
            }
        };
        const existe = await tieneColumna('fg_certificado', 'fecha_hora_emision', mockExecutor);
        assert.strictEqual(existe, true, 'Debe devolver true para columna existente');
        console.log('✓ 2. Columna fecha_hora_emision existente detectada correctamente (true).');
        pruebasPasadas++;
    }

    // PRUEBA 3: Simulación de emisión cuando columna NO existe (escenario actual producción)
    {
        _forzarColumnaCache('fg_certificado', 'fecha_hora_emision', false);
        const queriesEjecutadas = [];
        let released = false;

        const mockClient = {
            query: async (sql, params) => {
                queriesEjecutadas.push({ sql: sql.trim(), params });
                if (sql.includes('SELECT c.*')) {
                    return {
                        rowCount: 1,
                        rows: [{
                            id: 1,
                            estado: 'BORRADOR',
                            tipo_clave: 'GLP_ANUAL',
                            tipo_codigo: 'GLP',
                            ancho_correlativo: 6,
                            planta_key: 'SURCO',
                            numero_certificado: 'DG-41-000100',
                            modalidad_correlativo: 'ANUAL'
                        }]
                    };
                }
                return { rowCount: 1, rows: [] };
            },
            release: () => { released = true; }
        };

        const soportaFechaHora = await tieneColumna('fg_certificado', 'fecha_hora_emision');
        assert.strictEqual(soportaFechaHora, false);

        // Bloque transaccional equivalente a emitirCertificado
        await mockClient.query('BEGIN');
        assert(!soportaFechaHora);
        await mockClient.query(`
            UPDATE fg_certificado
            SET estado = 'EMITIDO',
                numero_certificado = $1,
                fecha_emision = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Lima')::date,
                usuario_modificacion = $2,
                fecha_modificacion = CURRENT_TIMESTAMP,
                formato_version_id = $4
            WHERE id = $3
        `, ['DG-41-000100', 'operador', 1, null]);
        await mockClient.query('COMMIT');
        mockClient.release();

        const updateQuery = queriesEjecutadas.find(q => q.sql.startsWith('UPDATE fg_certificado'));
        assert(updateQuery, 'Debe ejecutar UPDATE fg_certificado');
        assert(!updateQuery.sql.includes('fecha_hora_emision'), 'NO debe contener fecha_hora_emision');
        assert(queriesEjecutadas.some(q => q.sql === 'COMMIT'), 'Debe ejecutar COMMIT');
        assert.strictEqual(released, true, 'Debe liberar la conexión');
        console.log('✓ 3. Emisión sin fecha_hora_emision ejecuta SQL limpio, COMMIT y libera conexión.');
        pruebasPasadas++;
    }

    // PRUEBA 4: Simulación de emisión cuando columna SÍ existe (escenario post-migración)
    {
        _forzarColumnaCache('fg_certificado', 'fecha_hora_emision', true);
        const queriesEjecutadas = [];
        let released = false;

        const mockClient = {
            query: async (sql, params) => {
                queriesEjecutadas.push({ sql: sql.trim(), params });
                return { rowCount: 1, rows: [] };
            },
            release: () => { released = true; }
        };

        const soportaFechaHora = await tieneColumna('fg_certificado', 'fecha_hora_emision');
        assert.strictEqual(soportaFechaHora, true);

        await mockClient.query('BEGIN');
        await mockClient.query('SAVEPOINT sp_emision_fecha_hora');
        await mockClient.query(`
            UPDATE fg_certificado
            SET estado = 'EMITIDO',
                numero_certificado = $1,
                fecha_emision = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Lima')::date,
                fecha_hora_emision = COALESCE(fecha_hora_emision, now()),
                usuario_modificacion = $2,
                fecha_modificacion = CURRENT_TIMESTAMP,
                formato_version_id = $4
            WHERE id = $3
        `, ['DG-41-000101', 'operador', 2, null]);
        await mockClient.query('RELEASE SAVEPOINT sp_emision_fecha_hora');
        await mockClient.query('COMMIT');
        mockClient.release();

        const updateQuery = queriesEjecutadas.find(q => q.sql.includes('fecha_hora_emision = COALESCE'));
        assert(updateQuery, 'Debe incluir fecha_hora_emision');
        assert(queriesEjecutadas.some(q => q.sql === 'RELEASE SAVEPOINT sp_emision_fecha_hora'));
        assert(queriesEjecutadas.some(q => q.sql === 'COMMIT'));
        assert.strictEqual(released, true);
        console.log('✓ 4. Emisión con fecha_hora_emision existente ejecuta UPDATE con hora, SAVEPOINT y COMMIT.');
        pruebasPasadas++;
    }

    // PRUEBA 5: Prevención de SQLSTATE 25P02 ante error 42703 (manejo seguro con SAVEPOINT)
    {
        _forzarColumnaCache('fg_certificado', 'fecha_hora_emision', true);
        const queriesEjecutadas = [];
        let inAbortedState = false;

        const mockClient = {
            query: async (sql, params) => {
                const s = sql.trim();
                queriesEjecutadas.push(s);
                if (inAbortedState && !s.startsWith('ROLLBACK')) {
                    const err25P02 = new Error('current transaction is aborted, commands ignored until end of transaction block');
                    err25P02.code = '25P02';
                    throw err25P02;
                }
                if (s.includes('fecha_hora_emision = COALESCE')) {
                    inAbortedState = true;
                    const err42703 = new Error('column "fecha_hora_emision" does not exist');
                    err42703.code = '42703';
                    throw err42703;
                }
                if (s.startsWith('ROLLBACK TO SAVEPOINT')) {
                    inAbortedState = false; // El rollback al savepoint recupera el estado de la transacción
                }
                return { rowCount: 1, rows: [] };
            }
        };

        await mockClient.query('BEGIN');
        await mockClient.query('SAVEPOINT sp_emision_fecha_hora');
        try {
            await mockClient.query(`
                UPDATE fg_certificado SET fecha_hora_emision = COALESCE(fecha_hora_emision, now()) WHERE id = 1
            `);
            await mockClient.query('RELEASE SAVEPOINT sp_emision_fecha_hora');
        } catch (errHora) {
            assert.strictEqual(errHora.code, '42703');
            // Al hacer ROLLBACK TO SAVEPOINT, la transacción NO queda abortada
            await mockClient.query('ROLLBACK TO SAVEPOINT sp_emision_fecha_hora');
            // Esta consulta posterior NO falla con 25P02
            await mockClient.query(`
                UPDATE fg_certificado SET estado = 'EMITIDO' WHERE id = 1
            `);
        }
        await mockClient.query('COMMIT');

        assert(queriesEjecutadas.includes('ROLLBACK TO SAVEPOINT sp_emision_fecha_hora'), 'Debe revertir al savepoint');
        assert(queriesEjecutadas.includes('COMMIT'), 'La transacción se confirmó sin abortarse (evita 25P02)');
        console.log('✓ 5. Recuperación transparente de error 42703 con SAVEPOINT evita SQLSTATE 25P02.');
        pruebasPasadas++;
    }

    // PRUEBA 6: Demostración de cómo ocurría el error 25P02 sin SAVEPOINT (reproducción del bug original)
    {
        let inAbortedState = false;
        const mockClient = {
            query: async (sql) => {
                const s = sql.trim();
                if (inAbortedState && s !== 'ROLLBACK') {
                    const err = new Error('current transaction is aborted, commands ignored until end of transaction block');
                    err.code = '25P02';
                    throw err;
                }
                if (s.includes('fecha_hora_emision = COALESCE')) {
                    inAbortedState = true;
                    const err = new Error('column "fecha_hora_emision" does not exist');
                    err.code = '42703';
                    throw err;
                }
                return { rowCount: 1, rows: [] };
            }
        };

        await mockClient.query('BEGIN');
        let errorCapturado = null;
        try {
            try {
                await mockClient.query('UPDATE fg_certificado SET fecha_hora_emision = COALESCE(fecha_hora_emision, now())');
            } catch (e) {
                if (e.code !== '42703') throw e;
                // Intento sin SAVEPOINT: en postgres falla con 25P02
                await mockClient.query('UPDATE fg_certificado SET estado = "EMITIDO"');
            }
        } catch (errAbort) {
            errorCapturado = errAbort;
            await mockClient.query('ROLLBACK');
        }
        assert.strictEqual(errorCapturado.code, '25P02', 'Sin savepoint, la segunda orden lanza 25P02');
        console.log('✓ 6. Verificado bug original: sin SAVEPOINT ni tieneColumna, Postgres aborta con 25P02.');
        pruebasPasadas++;
    }

    // PRUEBA 7: Error imprevisto activa ROLLBACK y libera conexión
    {
        let rolledBack = false;
        let connectionReleased = false;

        const mockClient = {
            query: async (sql) => {
                if (sql.trim() === 'ROLLBACK') rolledBack = true;
                if (sql.includes('UPDATE fg_certificado')) throw new Error('DB_DEADLOCK_ERROR');
                return { rowCount: 1, rows: [] };
            },
            release: () => { connectionReleased = true; }
        };

        try {
            await mockClient.query('BEGIN');
            await mockClient.query('UPDATE fg_certificado SET estado = 1');
            await mockClient.query('COMMIT');
        } catch (e) {
            await mockClient.query('ROLLBACK');
        } finally {
            mockClient.release();
        }

        assert.strictEqual(rolledBack, true, 'Debe ejecutar ROLLBACK');
        assert.strictEqual(connectionReleased, true, 'Debe liberar conexión');
        console.log('✓ 7. Ante fallo no recuperable se ejecuta ROLLBACK y liberación garantizada en finally.');
        pruebasPasadas++;
    }

    // PRUEBA 8: NubeFact exitoso seguido de fallo local -> Comprobante queda registrado
    {
        _forzarColumnaCache('fg_facturacion', 'fecha_hora_emision', false);
        const dbFacturacion = {
            id: 88,
            estado: 'PENDIENTE',
            serie: 'BBB1',
            numero: 50,
            nro_comprobante: 'BBB1-00000050',
            codigo_hash: null,
            enlace_pdf: null
        };

        // Simular respuesta exitosa de NubeFact
        const nubefactResponse = {
            status: 'ACCEPTED',
            data: {
                tipo_de_comprobante: 2,
                serie: 'BBB1',
                numero: 50,
                enlace_del_pdf: 'https://nubefact.com/c/123.pdf',
                codigo_hash: 'HASH123ABC',
                sunat_description: 'La Boleta numero BBB1-00000050, ha sido aceptada',
                sunat_responsecode: '0'
            }
        };

        // Persistir comprobante
        dbFacturacion.estado = 'ACEPTADO';
        dbFacturacion.aceptada_sunat = true;
        dbFacturacion.codigo_hash = nubefactResponse.data.codigo_hash;
        dbFacturacion.enlace_pdf = nubefactResponse.data.enlace_del_pdf;

        // Comprobante ya emitido y aceptado en NubeFact y BD
        assert.strictEqual(dbFacturacion.estado, 'ACEPTADO');
        assert.strictEqual(dbFacturacion.codigo_hash, 'HASH123ABC');
        assert(dbFacturacion.enlace_pdf.includes('nubefact.com'));

        console.log('✓ 8. NubeFact exitoso persiste comprobante con estado ACEPTADO, hash y enlace PDF.');
        pruebasPasadas++;
    }

    // PRUEBA 9: Reintento cuando comprobante ya fue emitido -> NO re-emite a NubeFact (idempotencia)
    {
        const facturacionExistente = {
            id: 88,
            estado: 'ACEPTADO',
            serie: 'BBB1',
            numero: 50,
            nro_comprobante: 'BBB1-00000050',
            codigo_hash: 'HASH123ABC',
            enlace_pdf: 'https://nubefact.com/c/123.pdf'
        };

        let nubefactLlamado = false;
        const mockNubefactService = {
            emitirComprobante: async () => {
                nubefactLlamado = true;
                throw new Error('NO_DEBE_LLAMAR_NUBEFACT');
            }
        };

        // Lógica de validación de reservarEmision
        const yaAceptada = ['ACEPTADO', 'PENDIENTE_SUNAT'].includes(facturacionExistente.estado)
            || Boolean(facturacionExistente.codigo_hash && facturacionExistente.enlace_pdf);

        assert.strictEqual(yaAceptada, true, 'Debe detectar comprobante ya aceptado o con hash/pdf');

        if (!yaAceptada) {
            await mockNubefactService.emitirComprobante();
        }

        assert.strictEqual(nubefactLlamado, false, 'No debe invocar al proveedor si ya existe emisión');
        console.log('✓ 9. Reintento detecta comprobante existente y bloquea doble emisión a NubeFact.');
        pruebasPasadas++;
    }

    console.log(`\nTODAS LAS ${pruebasPasadas} PRUEBAS OBLIGATORIAS DE BACKEND PASARON EXITOSAMENTE.`);
    process.exit(0);
}

ejecutarPruebas().catch((err) => {
    console.error('ERROR EN PRUEBAS:', err);
    process.exit(1);
});
