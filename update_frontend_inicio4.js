const fs = require('fs');
const apiFile = 'C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\views\\Inicio\\InicioView.tsx';
let apiContent = fs.readFileSync(apiFile, 'utf8');

const replacement = `
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

if (apiContent.includes('</button>\r\n                          )}')) {
    apiContent = apiContent.replace('</button>\r\n                          )}', '</button>\r\n' + replacement);
} else if (apiContent.includes('</button>\n                          )}')) {
    apiContent = apiContent.replace('</button>\n                          )}', '</button>\n' + replacement);
}

fs.writeFileSync(apiFile, apiContent);
console.log('Done');
