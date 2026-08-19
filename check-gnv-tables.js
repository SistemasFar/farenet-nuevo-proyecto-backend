const { Client } = require('pg');
const client = new Client({
  user: 'postgres', host: '192.168.14.19', database: 'inspeccion', password: 'farenet2026**', port: 5432
});

const ddl = `
ALTER TABLE public.fg_certificado_gnv_componente 
    ALTER COLUMN capacidad_litros TYPE VARCHAR(100);
`;

client.connect()
  .then(() => client.query(ddl))
  .then(() => console.log("DDL altered successfully"))
  .catch(err => console.error("Error executing DDL", err))
  .finally(() => client.end());
