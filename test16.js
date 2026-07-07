const test = async () => {
  try {
    const body = {
      placa: 'SUN007',
      plantaKey: '201',
      concepto: '30',
      ruc: '20498456856'
    };
    const res = await fetch('http://127.0.0.1:3000/api/descuentos/validar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
  } catch(e) {
    console.log("ERROR:", e);
  }
};
test();
