#!/usr/bin/env node
const { spawnSync } = require('child_process');
const path = require('path');
const { ROOT } = require('../lib/paths');

function run(script, args) {
  return spawnSync('node', [path.join(ROOT, 'scripts', script), ...args], { stdio: 'inherit' });
}

function main() {
  const args = process.argv.slice(2);
  const withOffice = args.includes('--with-office');
  const filtered = args.filter((a) => a !== '--with-office');

  let r = run('check-deps.js', []);
  if (r.status) process.exit(r.status);

  if (withOffice) {
    r = run('office-import.js', filtered);
    if (r.status) process.exit(r.status);
  }

  r = run('compile.js', filtered);
  if (r.status) process.exit(r.status);
  r = run('build.js', filtered);
  process.exit(r.status ?? 0);
}
main();
