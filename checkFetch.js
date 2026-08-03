fetch('http://127.0.0.1:3000/api/inspecciones/proceso/INS-201-000160316')
  .then(r=>r.json())
  .then(j=>console.log(JSON.stringify(j, null, 2)))
