const fs = require('fs');
const p = 'c:/Users/Sistemas2/Desktop/farenet nuevo proyecto/farenetBackend/modules/faregas/services/faregas-chip-certificado.service.js';
let t = fs.readFileSync(p, 'utf8');

const oldQuery = `    await client.query(\`
        INSERT INTO fg_chip_movimiento (
            chip_id, tipo_movimiento, planta_origen_key, usuario,
            certificado_id, operacion_comercial_id, referencia, detalles
        ) VALUES ($1, 'RESERVA', $2, $3, $4, NULL, 'FACTURACION', 'Reserva automática al ingresar a Facturación de certificado')
    \`, [chip.id, certificado.planta_key, username, certificado.id]);`;

const newQuery = `    await client.query(\`
        INSERT INTO fg_chip_movimiento (
            chip_id, tipo_movimiento, planta_origen_key, usuario,
            certificado_id, operacion_comercial_id, referencia, detalles
        ) VALUES ($1, 'RESERVA', $2, $3, $4, NULL, 'FACTURACION', $5)
    \`, [chip.id, certificado.planta_key, username, certificado.id, JSON.stringify({ nota: 'Reserva automática al ingresar a Facturación de certificado' })]);`;

t = t.replace(oldQuery, newQuery);

fs.writeFileSync(p, t);
console.log('faregas-chip-certificado.service.js modified successfully');
