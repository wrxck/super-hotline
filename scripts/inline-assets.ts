import { readFileSync, writeFileSync } from 'fs';

const html = readFileSync('src/client/index.html', 'utf-8');
const css = readFileSync('src/client/style.css', 'utf-8');
const authJs = readFileSync('src/client/auth.js', 'utf-8');
const appJs = readFileSync('src/client/app.js', 'utf-8');

let worker = readFileSync('src/worker/index.ts', 'utf-8');
worker = worker.replace("const HTML = `<!-- placeholder -->`;", `const HTML = ${JSON.stringify(html)};`);
worker = worker.replace("const CSS = `/* placeholder */`;", `const CSS = ${JSON.stringify(css)};`);
worker = worker.replace("const AUTH_JS = `// placeholder`;", `const AUTH_JS = ${JSON.stringify(authJs)};`);
worker = worker.replace("const APP_JS = `// placeholder`;", `const APP_JS = ${JSON.stringify(appJs)};`);

writeFileSync('src/worker/index.ts', worker);
console.log('Assets inlined into worker/index.ts');
