async function run() {
  try {
    const res = await fetch('http://localhost:3000/api/inspecciones/borrador/nuevo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentStepIndex: 1,
        formCaja: { tipoPlaca: 'ORDINARIA', placa: 'XYZ123', categoria: '10' },
        formVehiculo: { inicioSoat: '2024-01-01', finSoat: '2025-01-01' }
      })
    });
    const data = await res.json();
    console.log(data);
  } catch (err) {
    console.error(err);
  }
}
run();
