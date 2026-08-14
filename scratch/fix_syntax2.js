const fs = require('fs');
const viewPath = 'c:/Users/Sistemas2/Desktop/farenet nuevo proyecto/farenetFrontend/src/modules/faregas/views/NuevoCertificado/NuevoCertificadoView.tsx';
let viewCode = fs.readFileSync(viewPath, 'utf8');

const badBlock = `              )}
            </div>
          ) : (
            <div className="flex gap-3">
              <button
                type="button"
                onClick={irSiguientePaso}
                className="bg-gold-3d hover:-translate-y-0.5 rounded-lg px-6 py-2.5 text-xs font-black transition shadow-sm"
              >
                FINALIZAR
              </button>
            </div>
          ) : (`;

const goodBlock = `              )}
            </div>
          ) : (`;

viewCode = viewCode.replace(badBlock, goodBlock);
fs.writeFileSync(viewPath, viewCode);
console.log('Fixed NuevoCertificadoView.tsx');
