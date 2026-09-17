const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('Regresión de Aislamiento de Entorno (app.js)', async (t) => {
    const appJsPath = path.join(__dirname, '../../../app.js');
    const content = fs.readFileSync(appJsPath, 'utf8');

    await t.test('Contiene require("./config/env-loader")', () => {
        assert.ok(content.includes("require('./config/env-loader')"), 'app.js no carga env-loader');
    });

    await t.test('Contiene validateEnvironment()', () => {
        assert.ok(content.includes("validateEnvironment()"), 'app.js no llama a validateEnvironment');
    });

    await t.test('validateEnvironment() aparece ANTES de importar database', () => {
        const validateIndex = content.indexOf("validateEnvironment()");
        const dbIndex = content.indexOf("require('./config/database')");
        assert.ok(validateIndex > -1, 'validateEnvironment() no encontrado');
        assert.ok(dbIndex > -1, 'require("./config/database") no encontrado');
        assert.ok(validateIndex < dbIndex, 'Se inicializó la base de datos ANTES de validar el entorno');
    });

    await t.test('NO contiene require("dotenv").config()', () => {
        assert.ok(!content.includes("require('dotenv').config()"), 'app.js sigue usando dotenv directamente');
    });

    await t.test('Contiene getSwaggerOptions(PORT)', () => {
        assert.ok(content.includes("getSwaggerOptions(PORT)"), 'app.js no usa Swagger dinámico');
    });

    await t.test('NO contiene una URL Swagger fija con puerto 3000', () => {
        assert.ok(!content.includes("http://127.0.0.1:3000/api"), 'app.js tiene una URL Swagger fija (producción quemada)');
    });
});
