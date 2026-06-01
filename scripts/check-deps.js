#!/usr/bin/env node
const { checkEcosystem } = require('../lib/ecosystem');

try {
  const deps = checkEcosystem({ requirePolarDesign: false });
  console.log('[deps] OK');
  console.log(`  KnowLever:  ${deps.knowLever}`);
  console.log(`  AutoOffice: ${deps.autoOffice} (Office/PDF → Markdown)`);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
