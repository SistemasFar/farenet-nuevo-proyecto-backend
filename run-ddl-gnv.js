const { Client } = require('pg');
const client = new Client({
  user: 'postgres', host: '192.168.14.19', database: 'inspeccion', password: 'farenet2026**', port: 5432
});

const ddl = `
ALTER TABLE public.fg_certificado_gnv 
    ADD COLUMN IF NOT EXISTS combustible_posterior VARCHAR(100),
    ADD COLUMN IF NOT EXISTS peso_neto_posterior NUMERIC(10,3);

CREATE TABLE IF NOT EXISTS public.fg_certificado_gnv_componente (
    id BIGSERIAL PRIMARY KEY,
    certificado_id BIGINT NOT NULL,
    orden INTEGER NOT NULL,
    componente VARCHAR(100) NOT NULL,
    marca VARCHAR(150),
    modelo VARCHAR(150),
    capacidad_litros NUMERIC(10,2),
    mes_fabricacion INTEGER CHECK (mes_fabricacion >= 1 AND mes_fabricacion <= 12),
    anio_fabricacion INTEGER,
    numero_serie VARCHAR(150),
    CONSTRAINT fg_certificado_gnv_componente_certificado_id_fkey FOREIGN KEY (certificado_id)
        REFERENCES public.fg_certificado_gnv (certificado_id) MATCH SIMPLE
        ON UPDATE NO ACTION
        ON DELETE CASCADE,
    CONSTRAINT fg_certificado_gnv_componente_certificado_id_orden_key UNIQUE (certificado_id, orden)
);
`;

client.connect()
  .then(() => client.query(ddl))
  .then(() => console.log("DDL executed successfully"))
  .catch(err => console.error("Error executing DDL", err))
  .finally(() => client.end());
