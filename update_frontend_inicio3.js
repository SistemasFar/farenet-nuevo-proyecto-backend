const fs = require('fs');
const apiFile = 'C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\views\\Inicio\\InicioView.tsx';
let apiContent = fs.readFileSync(apiFile, 'utf8');

const target1 = `{(certificadoEditable || certificadoEmitido) && (
                            <button
                              type="button"
                              onClick={() => certificadoEmitido ? void verPreview(ins.id) : navigate(\`/faregas/certificados/\${ins.id}/continuar\`)}
                              className="rounded-md border border-gray-300 bg-white p-1.5 text-gray-600 transition-colors hover:bg-gray-100"
                              title={certificadoEmitido ? 'Ver Certificado' : 'Continuar editando'}
                            >
                              {certificadoEmitido ? <Eye size={16} /> : <Edit size={16} />}
                            </button>
                          )}`;

const replacement1 = `{(certificadoEditable || certificadoEmitido) && (
                            <button
                              type="button"
                              onClick={() => certificadoEmitido ? void verPreview(ins.id) : navigate(\`/faregas/certificados/\${ins.id}/continuar\`)}
                              className="rounded-md border border-gray-300 bg-white p-1.5 text-gray-600 transition-colors hover:bg-gray-100"
                              title={certificadoEmitido ? 'Ver Certificado' : 'Continuar editando'}
                            >
                              {certificadoEmitido ? <Eye size={16} /> : <Edit size={16} />}
                            </button>
                          )}
                          {certificadoEditable && (
                            <button
                              type="button"
                              onClick={() => void verPreview(ins.id)}
                              className="rounded-md border border-amber-200 bg-amber-50 p-1.5 text-amber-600 transition-colors hover:bg-amber-100"
                              title="Ver Previsualización"
                            >
                              <Eye size={16} />
                            </button>
                          )}`;

if (apiContent.includes(target1)) {
    apiContent = apiContent.replace(target1, replacement1);
    fs.writeFileSync(apiFile, apiContent);
    console.log('InicioView updated successfully');
} else {
    console.log('Target string not found');
}
