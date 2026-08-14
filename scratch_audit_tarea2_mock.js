require('dotenv').config();
const db = require('./config/database');
const certificadosController = require('./modules/faregas/controllers/faregas-certificados.controller');
const vehiculoController = require('./modules/faregas/controllers/faregas-vehiculos.controller'); // if it exists, or it's inside certificados?
// Wait, Vehiculo snapshot is PUT /borradores/:id/vehiculo -> faregas-certificados.controller.js
const titularesController = require('./modules/faregas/controllers/faregas-titulares.controller'); // wait, the titular endpoints are where?

