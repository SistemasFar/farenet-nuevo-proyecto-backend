const fs = require('fs');

const path = 'c:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\views\\NuevoCertificado\\components\\NuevoCertificado\\CajaStep.tsx';
let content = fs.readFileSync(path, 'utf8');

// The file was mangled by PowerShell, some sequences are:
// "CatÇŸlogo" -> "CatÃ¡logo"
// "categorÇŸa" -> "categorÃ­a"
// "CategorÇŸa" -> "CategorÃ­a"
// "cambiÇŸ" -> "cambiÃ³"
// "estÇ­" -> "estÃ¡"
// "Previsualizacin" -> "PrevisualizaciÃ³n" (Wait, in the output I saw "Previsualizacin", maybe the replacement can just look for known words)

// Let's just fix the specific words we know are in CajaStep.tsx
content = content.replace(/CatÇŸlogo/g, 'CatÃ¡logo');
content = content.replace(/catÇŸlogo/g, 'catÃ¡logo');
content = content.replace(/CategorÇŸa/g, 'CategorÃ­a');
content = content.replace(/categorÇŸa/g, 'categorÃ­a');
content = content.replace(/cambiÇŸ/g, 'cambiÃ³');
content = content.replace(/estÇ­/g, 'estÃ¡');
content = content.replace(/Previsualizacin/g, 'PrevisualizaciÃ³n');

// Other common words in CajaStep.tsx that might be mangled:
content = content.replace(/vehÇŸculo/g, 'vehÃ­culo');
content = content.replace(/VehÇŸculo/g, 'VehÃ­culo');
content = content.replace(/tÇ¸cnico/g, 'tÃ©cnico');
content = content.replace(/TÇ¸cnico/g, 'TÃ©cnico');
content = content.replace(/Validacin/g, 'ValidaciÃ³n');
content = content.replace(/validacin/g, 'validaciÃ³n');
content = content.replace(/facturacin/g, 'facturaciÃ³n');
content = content.replace(/Facturacin/g, 'FacturaciÃ³n');
content = content.replace(/emisin/g, 'emisiÃ³n');
content = content.replace(/Emisin/g, 'EmisiÃ³n');
content = content.replace(/Ç­/g, 'Ã¡');
content = content.replace(/Ç¸/g, 'Ã©');
content = content.replace(/ÇŸ/g, 'Ã­');
content = content.replace(//g, 'Ã³');
content = content.replace(/Ç§/g, 'Ãº');

fs.writeFileSync(path, content, 'utf8');
console.log('Encoding fixed.');
