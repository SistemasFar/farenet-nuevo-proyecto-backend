const data = {
  currentStepIndex: 1,
  plantaKey: '201',
  formCaja: { placa: 'ABC-123', linea: 'L1' }
};
fetch('http://127.0.0.1:3000/api/inspecciones/borrador', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data)
}).then(res => res.json()).then(console.log).catch(console.error);
