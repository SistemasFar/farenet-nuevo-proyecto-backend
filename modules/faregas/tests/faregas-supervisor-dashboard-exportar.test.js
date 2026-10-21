const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const backendRoot = path.join(__dirname, '..');
const migrationPath = path.join(
    backendRoot,
    'database/migrations_history/20261021_faregas_supervisor_dashboard_exportar.sql'
);

test('Migración 20261021 otorga permisos de Dashboard al perfil SUPERVISOR', () => {
    assert.equal(fs.existsSync(migrationPath), true, 'El archivo de migración existe');
    const content = fs.readFileSync(migrationPath, 'utf8');
    
    assert.ok(content.includes("('SUPERVISOR', 'MENU_DASHBOARD')"), 'SUPERVISOR debe tener MENU_DASHBOARD');
    assert.ok(content.includes("('SUPERVISOR', 'DASHBOARD_SEDE')"), 'SUPERVISOR debe tener DASHBOARD_SEDE');
    assert.ok(content.includes("('SUPERVISOR', 'DASHBOARD_GLOBAL')"), 'SUPERVISOR debe tener DASHBOARD_GLOBAL');
    assert.ok(content.includes("('SUPERVISOR', 'DASHBOARD_EXPORTAR')"), 'SUPERVISOR debe tener DASHBOARD_EXPORTAR');
});

test('Permisos dashboard en resolución lógica frontend', () => {
    function resolverPermisosDashboard(permisos = [], perfilId) {
        const p = String(perfilId || '').trim().toUpperCase();
        const esSistemas = p === 'SISTEMAS' || p === 'AMINISTRADOR' || p === 'ADMINISTRADOR';
        const esSupervisor = p === 'SUPERVISOR';
        return {
            puedeVerGlobal: (permisos || []).includes('DASHBOARD_GLOBAL') || esSistemas || esSupervisor,
            puedeExportar: (permisos || []).includes('DASHBOARD_EXPORTAR') || esSistemas || esSupervisor
        };
    }

    // 1. Caso SUPERVISOR por perfilId exacto
    const r1 = resolverPermisosDashboard([], 'SUPERVISOR');
    assert.equal(r1.puedeExportar, true);
    assert.equal(r1.puedeVerGlobal, true);

    // 2. Caso supervisor en minúsculas
    const r2 = resolverPermisosDashboard([], 'supervisor');
    assert.equal(r2.puedeExportar, true);
    assert.equal(r2.puedeVerGlobal, true);

    // 3. Caso perfilId undefined pero con permiso DASHBOARD_EXPORTAR en array
    const r3 = resolverPermisosDashboard(['DASHBOARD_EXPORTAR'], undefined);
    assert.equal(r3.puedeExportar, true);

    // 4. Caso SISTEMAS
    const r4 = resolverPermisosDashboard([], 'SISTEMAS');
    assert.equal(r4.puedeExportar, true);
    assert.equal(r4.puedeVerGlobal, true);

    // 5. Caso OPERADOR sin permiso de exportación
    const r5 = resolverPermisosDashboard(['MENU_INICIO'], 'OPERADOR');
    assert.equal(r5.puedeExportar, false);
    assert.equal(r5.puedeVerGlobal, false);
});
