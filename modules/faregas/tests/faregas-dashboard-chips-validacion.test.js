const test = require('node:test');
const assert = require('node:assert/strict');
const ventaDirectaValidacionService = require('../services/faregas-venta-directa-validacion.service');
const authService = require('../services/faregas-auth.service');
const { tienePermisoFaregas } = require('../services/faregas-autorizacion-permisos.service');
const { resolverPlantasAutorizadas } = require('../services/faregas-dashboard-acceso.service');

// ============================================================================
// PARTE 1: PRUEBAS DE AUTORIZACIÓN DASHBOARD (PROBLEMA 1)
// ============================================================================

test('Dashboard: usuario OPERADOR sin MENU_DASHBOARD no puede consultar el dashboard', async () => {
    const mockDb = {
        async query(sql, params) {
            if (/FROM fg_usuario/.test(sql)) {
                return { rows: [{ username: 'mcastillo', perfil_id: 'OPERADOR', estado: true }], rowCount: 1 };
            }
            if (/FROM fg_perfil_permiso/.test(sql)) {
                // OPERADOR tiene permisos varios pero NO MENU_DASHBOARD
                return {
                    rows: [
                        { permiso_clave: 'MENU_INICIO' },
                        { permiso_clave: 'MENU_CHIPS' },
                        { permiso_clave: 'MENU_CHIPS_VENTAS' },
                        { permiso_clave: 'CHIPS_VER' },
                        { permiso_clave: 'CHIPS_VENDER' }
                    ],
                    rowCount: 5
                };
            }
            if (/fg_planta/.test(sql)) {
                return { rows: [{ key: '160', nombre: 'SURQUILLO' }], rowCount: 1 };
            }
            return { rows: [], rowCount: 0 };
        }
    };

    const req = {
        user: { username: 'mcastillo', planta_key: '160', faregas_flow: 'authenticated' },
        query: {}
    };

    await assert.rejects(
        () => resolverPlantasAutorizadas(req, mockDb),
        (err) => {
            assert.equal(err.status, 403);
            assert.equal(err.message, 'No tiene permiso para consultar el Dashboard.');
            return true;
        }
    );
});

test('Dashboard: DASHBOARD_GLOBAL o DASHBOARD_EXPORTAR por sí solos NO otorgan acceso al Dashboard sin MENU_DASHBOARD', async () => {
    const mockDb = {
        async query(sql) {
            if (/FROM fg_usuario/.test(sql)) {
                return { rows: [{ username: 'mcastillo', perfil_id: 'OPERADOR', estado: true }], rowCount: 1 };
            }
            if (/FROM fg_perfil_permiso/.test(sql)) {
                // Caso crítico: huérfanos DASHBOARD_GLOBAL y DASHBOARD_EXPORTAR sin MENU_DASHBOARD
                return {
                    rows: [
                        { permiso_clave: 'DASHBOARD_GLOBAL' },
                        { permiso_clave: 'DASHBOARD_EXPORTAR' }
                    ],
                    rowCount: 2
                };
            }
            return { rows: [], rowCount: 0 };
        }
    };

    const req = {
        user: { username: 'mcastillo', planta_key: '160', faregas_flow: 'authenticated' },
        query: {}
    };

    await assert.rejects(
        () => resolverPlantasAutorizadas(req, mockDb),
        (err) => {
            assert.equal(err.status, 403);
            assert.equal(err.message, 'No tiene permiso para consultar el Dashboard.');
            return true;
        }
    );
});

// ============================================================================
// PARTE 2: PRUEBAS DE VALIDACIÓN DE CHIPS EN VENTAS (PROBLEMA 2)
// ============================================================================

test('Chips: Caso A — Chip inexistente en el inventario registrado', async () => {
    const validarAccesoOriginal = authService.validarAccesoPlanta;
    authService.validarAccesoPlanta = async () => ({ nombre: 'SURQUILLO' });

    const mockDb = {
        async query(sql) {
            if (sql.includes('COUNT(*) FILTER')) {
                // Stock sede SURQUILLO: 15 disponibles, 2 reservados, 5 vendidos, total 22
                return {
                    rowCount: 1,
                    rows: [{ total: 22, disponible: 15, reservado: 2, vendido: 5, baja: 0 }]
                };
            }
            // Chip query no devuelve filas (chip no existe)
            return { rowCount: 0, rows: [] };
        }
    };

    try {
        const resultado = await ventaDirectaValidacionService.validarVentaDirecta(
            { chips: ['CHIP222'] },
            { username: 'mcastillo', perfil_id: 'OPERADOR', planta_key: '160' },
            mockDb
        );

        assert.equal(resultado.items.length, 1);
        const item = resultado.items[0];
        assert.equal(item.numeroChip, 'CHIP222');
        assert.equal(item.existe, false);
        assert.equal(item.validoParaVenta, false);
        assert.equal(item.codigo, 'CHIP_INEXISTENTE');
        assert.equal(item.motivo, 'CHIP222 — No existe en el inventario registrado.');
        assert.ok(item.mensajeStockSede.includes('CHIP222 no está disponible en SURQUILLO'));
        assert.ok(item.mensajeStockSede.includes('15 chips disponibles'));
        assert.equal(resultado.stockSedeActual.disponible, 15);
        assert.equal(resultado.stockSedeActual.total, 22);
    } finally {
        authService.validarAccesoPlanta = validarAccesoOriginal;
    }
});

test('Chips: Caso B — Chip disponible en otra sede (SURCO) no puede venderse desde SURQUILLO', async () => {
    const validarAccesoOriginal = authService.validarAccesoPlanta;
    authService.validarAccesoPlanta = async () => ({ nombre: 'SURQUILLO' });

    const chipEnSurco = {
        id: 50,
        numero_chip: 'CHIP999',
        estado: 'DISPONIBLE',
        planta_actual_key: '98',
        planta_nombre: 'SURCO',
        producto_inventariable_id: 1,
        producto_codigo: 'CHIP',
        producto_nombre: 'Chip y porta chip',
        producto_activo: true,
        sede_activa: true,
        precio_legacy: 180,
        stock_permitido: true,
        venta_habilitada: true,
        producto_facturacion_id: 25,
        precio_venta_fiscal: 180,
        codigo_sku: 'CHIP + PORTA CHIP - SURCO',
        descripcion: 'CHIP + PORTA CHIP',
        unidad: 'NIU',
        tipo_afectacion_igv: '10',
        codigo_clasificacion_sunat: '26121600',
        fiscal_activo: true,
        es_para_venta: true,
        sujeto_detraccion: false
    };

    const mockDb = {
        async query(sql) {
            if (sql.includes('COUNT(*) FILTER')) {
                return {
                    rowCount: 1,
                    rows: [{ total: 1, disponible: 0, reservado: 0, vendido: 1, baja: 0 }]
                };
            }
            return { rowCount: 1, rows: [chipEnSurco] };
        }
    };

    try {
        const resultado = await ventaDirectaValidacionService.validarVentaDirecta(
            { chips: ['CHIP999'] },
            { username: 'mcastillo', perfil_id: 'OPERADOR', planta_key: '160' },
            mockDb
        );

        assert.equal(resultado.items.length, 1);
        const item = resultado.items[0];
        assert.equal(item.numeroChip, 'CHIP999');
        assert.equal(item.existe, true);
        assert.equal(item.validoParaVenta, false);
        assert.equal(item.codigo, 'CHIP_OTRA_SEDE');
        assert.equal(item.motivo, 'CHIP999 — Disponible en la sede SURCO. No puede venderse desde SURQUILLO.');
        assert.ok(item.mensajeStockSede.includes('CHIP999 no está disponible en SURQUILLO'));
        assert.ok(item.mensajeStockSede.includes('Esta sede no tiene chips disponibles para venta'));
    } finally {
        authService.validarAccesoPlanta = validarAccesoOriginal;
    }
});

test('Chips: Caso C — Chip ya vendido', async () => {
    const validarAccesoOriginal = authService.validarAccesoPlanta;
    authService.validarAccesoPlanta = async () => ({ nombre: 'SURQUILLO' });

    const chipVendido = {
        id: 177,
        numero_chip: 'CHIPX1',
        estado: 'VENDIDO',
        planta_actual_key: '160',
        planta_nombre: 'SURQUILLO',
        fecha_venta: new Date('2026-11-18T17:23:49.323Z'),
        sede_venta_nombre: 'SURQUILLO'
    };

    const mockDb = {
        async query(sql) {
            if (sql.includes('COUNT(*) FILTER')) {
                return {
                    rowCount: 1,
                    rows: [{ total: 1, disponible: 0, reservado: 0, vendido: 1, baja: 0 }]
                };
            }
            return { rowCount: 1, rows: [chipVendido] };
        }
    };

    try {
        const resultado = await ventaDirectaValidacionService.validarVentaDirecta(
            { chips: ['CHIPX1'] },
            { username: 'mcastillo', perfil_id: 'OPERADOR', planta_key: '160' },
            mockDb
        );

        const item = resultado.items[0];
        assert.equal(item.numeroChip, 'CHIPX1');
        assert.equal(item.validoParaVenta, false);
        assert.equal(item.codigo, 'CHIP_VENDIDO');
        assert.ok(item.motivo.includes('CHIPX1 — Este chip ya fue vendido'));
        assert.ok(item.motivo.includes('SURQUILLO'));
    } finally {
        authService.validarAccesoPlanta = validarAccesoOriginal;
    }
});

test('Chips: Caso D — Chip reservado', async () => {
    const validarAccesoOriginal = authService.validarAccesoPlanta;
    authService.validarAccesoPlanta = async () => ({ nombre: 'SURQUILLO' });

    const chipReservado = {
        id: 180,
        numero_chip: 'CHIPRES',
        estado: 'RESERVADO',
        planta_actual_key: '160',
        planta_nombre: 'SURQUILLO'
    };

    const mockDb = {
        async query(sql) {
            if (sql.includes('COUNT(*) FILTER')) {
                return {
                    rowCount: 1,
                    rows: [{ total: 5, disponible: 2, reservado: 1, vendido: 2, baja: 0 }]
                };
            }
            return { rowCount: 1, rows: [chipReservado] };
        }
    };

    try {
        const resultado = await ventaDirectaValidacionService.validarVentaDirecta(
            { chips: ['CHIPRES'] },
            { username: 'mcastillo', perfil_id: 'OPERADOR', planta_key: '160' },
            mockDb
        );

        const item = resultado.items[0];
        assert.equal(item.numeroChip, 'CHIPRES');
        assert.equal(item.validoParaVenta, false);
        assert.equal(item.codigo, 'CHIP_RESERVADO');
        assert.equal(item.motivo, 'CHIPRES — Actualmente reservado. No está disponible para venta.');
    } finally {
        authService.validarAccesoPlanta = validarAccesoOriginal;
    }
});

test('Chips: Caso E — Chip disponible en sede actual con configuración fiscal válida', async () => {
    const validarAccesoOriginal = authService.validarAccesoPlanta;
    authService.validarAccesoPlanta = async () => ({ nombre: 'SURQUILLO' });

    const chipValido = {
        id: 200,
        numero_chip: 'CHIPOK1',
        estado: 'DISPONIBLE',
        planta_actual_key: '160',
        planta_nombre: 'SURQUILLO',
        producto_inventariable_id: 1,
        producto_codigo: 'CHIP',
        producto_nombre: 'Chip y porta chip',
        producto_activo: true,
        sede_activa: true,
        precio_legacy: 180,
        stock_permitido: true,
        venta_habilitada: true,
        producto_facturacion_id: 25,
        precio_venta_fiscal: 180,
        codigo_sku: 'CHIP + PORTA CHIP - SURQUILLO',
        descripcion: 'CHIP + PORTA CHIP',
        unidad: 'NIU',
        tipo_afectacion_igv: '10',
        codigo_clasificacion_sunat: '26121600',
        fiscal_activo: true,
        es_para_venta: true,
        sujeto_detraccion: false
    };

    const mockDb = {
        async query(sql) {
            if (sql.includes('COUNT(*) FILTER')) {
                return {
                    rowCount: 1,
                    rows: [{ total: 10, disponible: 10, reservado: 0, vendido: 0, baja: 0 }]
                };
            }
            return { rowCount: 1, rows: [chipValido] };
        }
    };

    try {
        const resultado = await ventaDirectaValidacionService.validarVentaDirecta(
            { chips: ['CHIPOK1'] },
            { username: 'mcastillo', perfil_id: 'OPERADOR', planta_key: '160' },
            mockDb
        );

        const item = resultado.items[0];
        assert.equal(item.numeroChip, 'CHIPOK1');
        assert.equal(item.validoParaVenta, true);
        assert.equal(item.codigo, null);
        assert.equal(item.motivo, 'CHIPOK1 — Disponible para venta.');
        assert.equal(resultado.cantidadValidos, 1);
        assert.equal(resultado.totalEstimado, 180);
    } finally {
        authService.validarAccesoPlanta = validarAccesoOriginal;
    }
});

test('Chips: Caso F — Chip dado de baja o transferido', async () => {
    const validarAccesoOriginal = authService.validarAccesoPlanta;
    authService.validarAccesoPlanta = async () => ({ nombre: 'SURQUILLO' });

    const chipBaja = {
        id: 201,
        numero_chip: 'CHIPBAJA',
        estado: 'BAJA',
        planta_actual_key: '160',
        planta_nombre: 'SURQUILLO'
    };

    const mockDb = {
        async query(sql) {
            if (sql.includes('COUNT(*) FILTER')) {
                return {
                    rowCount: 1,
                    rows: [{ total: 10, disponible: 5, reservado: 0, vendido: 4, baja: 1 }]
                };
            }
            return { rowCount: 1, rows: [chipBaja] };
        }
    };

    try {
        const resultado = await ventaDirectaValidacionService.validarVentaDirecta(
            { chips: ['CHIPBAJA'] },
            { username: 'mcastillo', perfil_id: 'OPERADOR', planta_key: '160' },
            mockDb
        );

        const item = resultado.items[0];
        assert.equal(item.validoParaVenta, false);
        assert.equal(item.codigo, 'CHIP_BAJA');
        assert.equal(item.motivo, 'CHIPBAJA — Chip dado de baja. No disponible para venta.');
    } finally {
        authService.validarAccesoPlanta = validarAccesoOriginal;
    }
});

test('Chips: Validación por lote con múltiples estados simultáneos', async () => {
    const validarAccesoOriginal = authService.validarAccesoPlanta;
    authService.validarAccesoPlanta = async () => ({ nombre: 'SURQUILLO' });

    const chipEnSurco = {
        id: 10,
        numero_chip: 'CHIP-SURCO',
        estado: 'DISPONIBLE',
        planta_actual_key: '98',
        planta_nombre: 'SURCO'
    };
    const chipVendido = {
        id: 11,
        numero_chip: 'CHIP-VENDIDO',
        estado: 'VENDIDO',
        planta_actual_key: '160',
        planta_nombre: 'SURQUILLO',
        fecha_venta: new Date('2026-11-10T12:00:00Z'),
        sede_venta_nombre: 'SURQUILLO'
    };

    const mockDb = {
        async query(sql, params) {
            if (sql.includes('COUNT(*) FILTER')) {
                return {
                    rowCount: 1,
                    rows: [{ total: 15, disponible: 3, reservado: 2, vendido: 10, baja: 0 }]
                };
            }
            // Retorna sólo los 2 que existen en BD
            return {
                rowCount: 2,
                rows: [chipEnSurco, chipVendido]
            };
        }
    };

    try {
        // Se envían 3 chips: uno de otra sede, uno vendido, uno inexistente
        const resultado = await ventaDirectaValidacionService.validarVentaDirecta(
            { chips: ['CHIP-SURCO', 'CHIP-VENDIDO', 'CHIP-NOEXISTE'] },
            { username: 'mcastillo', perfil_id: 'OPERADOR', planta_key: '160' },
            mockDb
        );

        assert.equal(resultado.items.length, 3);
        assert.equal(resultado.cantidadValidos, 0);

        const itemSurco = resultado.items.find(i => i.numeroChip === 'CHIP-SURCO');
        assert.equal(itemSurco.codigo, 'CHIP_OTRA_SEDE');
        assert.ok(itemSurco.motivo.includes('Disponible en la sede SURCO. No puede venderse desde SURQUILLO.'));

        const itemVendido = resultado.items.find(i => i.numeroChip === 'CHIP-VENDIDO');
        assert.equal(itemVendido.codigo, 'CHIP_VENDIDO');
        assert.ok(itemVendido.motivo.includes('Este chip ya fue vendido'));

        const itemNoExiste = resultado.items.find(i => i.numeroChip === 'CHIP-NOEXISTE');
        assert.equal(itemNoExiste.codigo, 'CHIP_INEXISTENTE');
        assert.equal(itemNoExiste.motivo, 'CHIP-NOEXISTE — No existe en el inventario registrado.');
    } finally {
        authService.validarAccesoPlanta = validarAccesoOriginal;
    }
});

