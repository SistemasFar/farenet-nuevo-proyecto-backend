const fs = require('fs');

const path = 'C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\views\\NuevoCertificado\\components\\NuevoCertificado\\CajaStep.tsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Initial State
content = content.replace(
  "const [categoriaActiva, setCategoriaActiva] = useState('TODOS');",
  "const [categoriaActiva, setCategoriaActiva] = useState('');"
);

// 2. Filter logic
content = content.replace(
  ".filter(() => categoriaActiva === 'TODOS' || categoria.codigo === categoriaActiva)",
  ".filter(() => categoriaActiva !== '' && categoria.codigo === categoriaActiva)"
);

// 3. useEffect auto-select
content = content.replace(
  "  useEffect(() => {\n    let cancelado = false;\n    faregasTarifasApi.obtenerCatalogo()",
`  useEffect(() => {
    if (catalogo && formCaja.tarifaCodigo && categoriaActiva === '') {
      const cat = catalogo.categorias.find((c) => 
        c.servicios.some((s) => s.tarifa.codigo === formCaja.tarifaCodigo)
      );
      if (cat) {
        setCategoriaActiva(cat.codigo);
      }
    }
  }, [catalogo, formCaja.tarifaCodigo, categoriaActiva]);

  useEffect(() => {
    let cancelado = false;
    faregasTarifasApi.obtenerCatalogo()`
);

// 4. Select dropdown
content = content.replace(
`              <select
                id="tipo-certificado"
                value={categoriaActiva}
                onChange={(event) => setCategoriaActiva(event.target.value)}
                aria-label="Tipo de certificado"
                className="h-10 w-full rounded-xl border-2 border-slate-200 bg-white px-3 text-sm font-semibold capitalize text-slate-800 transition-colors focus:border-[#f59e0b] focus:ring-0"
              >
                <option value="TODOS">Todos</option>
                {catalogo.categorias.map((categoria) => (
                  <option key={categoria.codigo} value={categoria.codigo}>{categoria.nombre}</option>
                ))}`,
`              <select
                id="tipo-certificado"
                value={categoriaActiva}
                onChange={(event) => {
                  const nuevaCategoria = event.target.value;
                  setCategoriaActiva(nuevaCategoria);
                  setBusqueda('');
                  if (formCaja.tarifaCodigo) {
                    const pertenece = catalogo.categorias
                      .find((c) => c.codigo === nuevaCategoria)
                      ?.servicios.some((s) => s.tarifa.codigo === formCaja.tarifaCodigo);
                    if (!pertenece) {
                      setFormCaja((actual) => ({
                        ...actual,
                        servicioCodigo: '',
                        tarifaCodigo: '',
                        tipoCertificado: '',
                        modalidadCertificado: '',
                        tipo_flujo: 'VEHICULAR_EXISTENTE',
                        requiere_certificado: true,
                      }));
                      onInvalidarConsulta();
                    }
                  }
                }}
                aria-label="Tipo de certificado"
                className="h-10 w-full rounded-xl border-2 border-slate-200 bg-white px-3 text-sm font-semibold capitalize text-slate-800 transition-colors focus:border-[#f59e0b] focus:ring-0"
              >
                <option value="" disabled hidden>Seleccione un tipo de certificado</option>
                {catalogo.categorias.map((categoria) => (
                  <option key={categoria.codigo} value={categoria.codigo}>{categoria.nombre}</option>
                ))}`
);

// 5. Grid layout
content = content.replace(
`        ) : !catalogo || catalogo.categorias.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-10 text-center">
            <p className="font-bold text-slate-700">No existen servicios configurados para esta sede.</p>
            <p className="mt-1 text-sm text-slate-500">Solicite al administrador asignar una tarifa activa.</p>
          </div>
        ) : servicios.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center text-sm font-semibold text-slate-600">No se encontraron servicios con los filtros seleccionados.</div>
        ) : (
          <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(280px,1fr))] lg:gap-5">`,
`        ) : !catalogo || catalogo.categorias.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-10 text-center">
            <p className="font-bold text-slate-700">No existen servicios configurados para esta sede.</p>
            <p className="mt-1 text-sm text-slate-500">Solicite al administrador asignar una tarifa activa.</p>
          </div>
        ) : categoriaActiva === '' ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center text-sm font-semibold text-slate-600">Seleccione un tipo de certificado para ver los servicios disponibles.</div>
        ) : servicios.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-8 text-center text-sm font-semibold text-slate-600">No hay servicios disponibles de este tipo para la sede actual.</div>
        ) : (
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 lg:gap-5">`
);

fs.writeFileSync(path, content, 'utf8');
console.log('Done safely.');
