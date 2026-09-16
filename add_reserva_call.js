const fs = require('fs');
const p = 'c:/Users/Sistemas2/Desktop/farenet nuevo proyecto/farenetBackend/modules/faregas/services/faregas-certificados.service.js';
let t = fs.readFileSync(p, 'utf8');

const oldMethod = `        // Volver a revisar una pantalla no reduce el progreso persistido.
        const pasoPersistido = destino > actual ? pasoDestino : certificado.paso_actual;
        await client.query(\`
            UPDATE fg_certificado
            SET paso_actual = $2, usuario_modificacion = $3, fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $1
        \`, [id, pasoPersistido, userContext.username]);
        await client.query('COMMIT');
        return { pasoActual: pasoPersistido };
    } catch (error) {`;

const newMethod = `        // Volver a revisar una pantalla no reduce el progreso persistido.
        const pasoPersistido = destino > actual ? pasoDestino : certificado.paso_actual;
        await client.query(\`
            UPDATE fg_certificado
            SET paso_actual = $2, usuario_modificacion = $3, fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $1
        \`, [id, pasoPersistido, userContext.username]);

        if (pasoDestino === 'FACTURACION') {
            await chipCertificadoService.reservarFisicamente(client, { certificadoId: id, username: userContext.username });
        }

        await client.query('COMMIT');
        return { pasoActual: pasoPersistido };
    } catch (error) {`;

t = t.replace(oldMethod, newMethod);
fs.writeFileSync(p, t);
console.log('faregas-certificados.service.js modified successfully');
