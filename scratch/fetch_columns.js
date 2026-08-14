const pool = require('../config/database');
require('dotenv').config();
pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'fg_certificado_conformidad'").then(r => console.log(r.rows)).finally(() => process.exit(0));
