const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.join(__dirname, '..');
const folders = ['', 'overlay', 'settings', 'tests', 'scripts'];
let failed = false;
for (const folder of folders) {
  for (const name of fs.readdirSync(path.join(root, folder)).filter(name => name.endsWith('.js'))) {
    const relative = path.join(folder, name);
    const result = spawnSync(process.execPath, ['--check', path.join(root, relative)], { encoding: 'utf8' });
    if (result.status !== 0) { failed = true; console.error(result.stderr); }
  }
}
if (failed) process.exit(1);
console.log('JavaScript syntax checks passed.');
