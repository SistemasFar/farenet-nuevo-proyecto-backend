const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getTablesFromMigrations() {
    const migrationsDir = path.join(__dirname, 'modules', 'faregas', 'database', 'migrations');
    const files = execSync(`dir /b "${migrationsDir}\\*.sql"`, { encoding: 'utf8' }).split('\r\n').filter(Boolean);
    
    let tablesList = [];
    for (const file of files) {
        const content = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        const regex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)/gi;
        let match;
        while ((match = regex.exec(content)) !== null) {
            tablesList.push(match[1].toLowerCase());
        }
    }
    return tablesList;
}

const tables = getTablesFromMigrations();
console.log(tables.join('\n'));
