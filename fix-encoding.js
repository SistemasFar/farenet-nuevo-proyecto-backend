const fs = require('fs');

const replacements = [
    // This looks like UTF-8 bytes read as Windows-1252
    ['Ã³', 'ó'], ['CÃ³', 'Có'], ['tÃ©', 'té'],
    ['configuraciÃ³n', 'configuración'], ['visualizaciÃ³n', 'visualización'],
    ['vehÃculo', 'vehículo'], ['DinÃ¡mico', 'Dinámico'], ['InspecciÃ³n', 'Inspección'],
    ['categorÃa', 'categoría'], ['CategorÃa', 'Categoría'],
    ['DescripciÃ³n', 'Descripción'], ['descripciÃ³n', 'descripción'],
    ['afectaciÃ³n', 'afectación'], ['operaciÃ³n', 'operación'],
    ['cÃ³digo', 'código'], ['CÃ³digo', 'Código'], ['tÃ©cnico', 'técnico'],
    ['utilizarǭ', 'utilizará'], ['vǭlido', 'válido'], ['Dinǭmico', 'Dinámico'],
    ['TǸcnico', 'Técnico'], ['tǸcnico', 'técnico'],
    ['cdigo', 'código'], ['categora', 'categoría'], ['Categora', 'Categoría'],
    ['CATEGOR?AS', 'CATEGORÍAS'], ['descripcin', 'descripción'], ['Descripcin', 'Descripción'],
    ['afectacin', 'afectación'], ['operacin', 'operación'], ['vehculo', 'vehículo'],
    ['visualizacin', 'visualización'], ['Inspeccin', 'Inspección'], ['tcnico', 'técnico'],
    ['Dinmico', 'Dinámico'], ['vlido', 'válido'], ['utilizar', 'utilizará']
];

const filesToFix = [
    "C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetFrontend\\src\\modules\\faregas\\views\\Configuracion\\components\\ServicioModal.tsx",
    "C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetBackend\\modules\\faregas\\services\\faregas-config.service.js"
];

for (const filePath of filesToFix) {
    let content = fs.readFileSync(filePath, 'utf8');
    let original = content;
    
    // Sometimes powershell actually replaced the invalid character with '' (U+FFFD)
    // We will do a regex replace for the known words
    content = content.replace(/cdigo/g, 'código');
    content = content.replace(/categora/g, 'categoría');
    content = content.replace(/Categora/g, 'Categoría');
    content = content.replace(/CATEGOR\?AS/g, 'CATEGORÍAS');
    content = content.replace(/descripcin/g, 'descripción');
    content = content.replace(/Descripcin/g, 'Descripción');
    content = content.replace(/afectacin/g, 'afectación');
    content = content.replace(/operacin/g, 'operación');
    content = content.replace(/vehculo/g, 'vehículo');
    content = content.replace(/visualizacin/g, 'visualización');
    content = content.replace(/Inspeccin/g, 'Inspección');
    content = content.replace(/tcnico/g, 'técnico');
    content = content.replace(/Dinmico/g, 'Dinámico');
    content = content.replace(/vlido/g, 'válido');
    content = content.replace(/utilizar/g, 'utilizará');
    content = content.replace(/Cdigo/g, 'Código');
    

    for (const [bad, good] of replacements) {
        content = content.split(bad).join(good);
    }
    
    if (content !== original) {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Fixed: ${filePath}`);
    }
}

