const fs = require('fs');
const path = require('path');

const backendPath = 'C:\\Users\\Sistemas2\\Desktop\\farenet nuevo proyecto\\farenetBackend';
const modulesPath = path.join(backendPath, 'modules', 'faregas');

const controllersDir = path.join(modulesPath, 'controllers');
const routesDir = path.join(modulesPath, 'routes');
const servicesDir = path.join(modulesPath, 'services');

[controllersDir, routesDir, servicesDir].forEach(d => {
    if (!fs.existsSync(d)) {
        fs.mkdirSync(d, { recursive: true });
    }
});

const moves = [
    { src: 'auth/faregas-auth.controller.js', dest: 'controllers/faregas-auth.controller.js' },
    { src: 'auth/faregas-auth.routes.js', dest: 'routes/faregas-auth.routes.js' },
    { src: 'auth/faregas-auth.service.js', dest: 'services/faregas-auth.service.js' },
    { src: 'usuarios/faregas-usuarios.controller.js', dest: 'controllers/faregas-usuarios.controller.js' },
    { src: 'usuarios/faregas-usuarios.routes.js', dest: 'routes/faregas-usuarios.routes.js' },
    { src: 'usuarios/faregas-usuarios.service.js', dest: 'services/faregas-usuarios.service.js' }
];

moves.forEach(m => {
    const srcPath = path.join(modulesPath, m.src);
    const destPath = path.join(modulesPath, m.dest);
    if (fs.existsSync(srcPath)) {
        fs.renameSync(srcPath, destPath);
    }
});

const replacements = [
    {
        file: path.join(modulesPath, 'controllers', 'faregas-auth.controller.js'),
        find: /require\(['"]\.\/faregas-auth\.service['"]\)/g,
        replace: "require('../services/faregas-auth.service')"
    },
    {
        file: path.join(modulesPath, 'routes', 'faregas-auth.routes.js'),
        find: /require\(['"]\.\/faregas-auth\.controller['"]\)/g,
        replace: "require('../controllers/faregas-auth.controller')"
    },
    {
        file: path.join(modulesPath, 'controllers', 'faregas-usuarios.controller.js'),
        find: /require\(['"]\.\/faregas-usuarios\.service['"]\)/g,
        replace: "require('../services/faregas-usuarios.service')"
    },
    {
        file: path.join(modulesPath, 'routes', 'faregas-usuarios.routes.js'),
        find: /require\(['"]\.\/faregas-usuarios\.controller['"]\)/g,
        replace: "require('../controllers/faregas-usuarios.controller')"
    },
    {
        file: path.join(modulesPath, 'routes', 'faregas.routes.js'),
        find: /require\(['"]\.\.\/usuarios\/faregas-usuarios\.routes['"]\)/g,
        replace: "require('./faregas-usuarios.routes')"
    },
    {
        file: path.join(backendPath, 'app.js'),
        find: /require\(['"]\.\/modules\/faregas\/auth\/faregas-auth\.routes['"]\)/g,
        replace: "require('./modules/faregas/routes/faregas-auth.routes')"
    }
];

replacements.forEach(r => {
    if (fs.existsSync(r.file)) {
        let content = fs.readFileSync(r.file, 'utf8');
        content = content.replace(r.find, r.replace);
        fs.writeFileSync(r.file, content, 'utf8');
    }
});

const authDir = path.join(modulesPath, 'auth');
const usuariosDir = path.join(modulesPath, 'usuarios');

if (fs.existsSync(authDir) && fs.readdirSync(authDir).length === 0) {
    fs.rmdirSync(authDir);
}
if (fs.existsSync(usuariosDir) && fs.readdirSync(usuariosDir).length === 0) {
    fs.rmdirSync(usuariosDir);
}

console.log("Migration complete.");
