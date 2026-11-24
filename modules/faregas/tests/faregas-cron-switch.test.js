const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  startCronJobs,
  stopCronJobs,
  esCronHabilitado,
  obtenerEstadoCronJobs
} = require('../../../cron_jobs');

describe('FAREGAS - Interruptor global de tareas automáticas (FAREGAS_CRON_ENABLED)', () => {
  const envOriginal = process.env.FAREGAS_CRON_ENABLED;

  beforeEach(() => {
    stopCronJobs();
    delete process.env.FAREGAS_CRON_ENABLED;
  });

  afterEach(() => {
    stopCronJobs();
    if (envOriginal !== undefined) {
      process.env.FAREGAS_CRON_ENABLED = envOriginal;
    } else {
      delete process.env.FAREGAS_CRON_ENABLED;
    }
  });

  it('1. Debe estar deshabilitado por defecto cuando FAREGAS_CRON_ENABLED no existe', () => {
    delete process.env.FAREGAS_CRON_ENABLED;
    assert.strictEqual(esCronHabilitado(), false);

    const resultado = startCronJobs();
    assert.strictEqual(resultado.habilitado, false);
    assert.strictEqual(resultado.tareasRegistradas, 0);

    const estado = obtenerEstadoCronJobs();
    assert.strictEqual(estado.habilitado, false);
    assert.strictEqual(estado.tareasRegistradas, 0);
  });

  it('2. Debe estar deshabilitado cuando FAREGAS_CRON_ENABLED es una cadena vacía o solo espacios', () => {
    process.env.FAREGAS_CRON_ENABLED = '';
    assert.strictEqual(esCronHabilitado(), false);
    assert.strictEqual(startCronJobs().habilitado, false);

    process.env.FAREGAS_CRON_ENABLED = '   ';
    assert.strictEqual(esCronHabilitado(), false);
    assert.strictEqual(startCronJobs().habilitado, false);
  });

  it('3. Debe estar deshabilitado cuando FAREGAS_CRON_ENABLED es "false" o "0"', () => {
    process.env.FAREGAS_CRON_ENABLED = 'false';
    assert.strictEqual(esCronHabilitado(), false);
    assert.strictEqual(startCronJobs().habilitado, false);

    process.env.FAREGAS_CRON_ENABLED = '0';
    assert.strictEqual(esCronHabilitado(), false);
    assert.strictEqual(startCronJobs().habilitado, false);
  });

  it('4. Debe rechazar valores no booleanos como "1", "si", "enabled", "true1"', () => {
    const valoresInvalidos = ['1', 'si', 'enabled', 'true1', 'null', 'undefined', 'off'];
    for (const val of valoresInvalidos) {
      process.env.FAREGAS_CRON_ENABLED = val;
      assert.strictEqual(esCronHabilitado(), false, `El valor '${val}' no debe habilitar los cron`);
      const res = startCronJobs();
      assert.strictEqual(res.habilitado, false, `El valor '${val}' no debe registrar tareas`);
      assert.strictEqual(res.tareasRegistradas, 0);
    }
  });

  it('5. Solo habilita los CRON cuando el valor es explícitamente "true" (insensible a mayúsculas y espacios)', () => {
    const valoresValidos = ['true', 'TRUE', 'True', ' true '];
    for (const val of valoresValidos) {
      process.env.FAREGAS_CRON_ENABLED = val;
      assert.strictEqual(esCronHabilitado(), true, `El valor '${val}' debe ser reconocido como true`);

      const res = startCronJobs();
      assert.strictEqual(res.habilitado, true);
      assert.ok(res.tareasRegistradas >= 2, 'Debe haber registrado al menos las 2 tareas principales');

      const estado = obtenerEstadoCronJobs();
      assert.strictEqual(estado.habilitado, true);
      assert.ok(estado.tareasRegistradas >= 2);

      stopCronJobs();
      const estadoDetenido = obtenerEstadoCronJobs();
      assert.strictEqual(estadoDetenido.tareasRegistradas, 0);
    }
  });

  it('6. stopCronJobs() detiene y limpia todas las tareas registradas de forma segura e idempotente', () => {
    process.env.FAREGAS_CRON_ENABLED = 'true';
    startCronJobs();

    assert.ok(obtenerEstadoCronJobs().tareasRegistradas > 0);
    stopCronJobs();
    assert.strictEqual(obtenerEstadoCronJobs().tareasRegistradas, 0);

    // Llamada idempotente repetida no debe arrojar error
    assert.doesNotThrow(() => stopCronJobs());
  });

  it('7. Al cambiar dinámicamente de "true" a "false", startCronJobs() cancela tareas previas y no registra nuevas', () => {
    process.env.FAREGAS_CRON_ENABLED = 'true';
    startCronJobs();
    assert.strictEqual(obtenerEstadoCronJobs().habilitado, true);

    process.env.FAREGAS_CRON_ENABLED = 'false';
    const resDeshabilitado = startCronJobs();
    assert.strictEqual(resDeshabilitado.habilitado, false);
    assert.strictEqual(resDeshabilitado.tareasRegistradas, 0);
    assert.strictEqual(obtenerEstadoCronJobs().tareasRegistradas, 0);
  });
});
