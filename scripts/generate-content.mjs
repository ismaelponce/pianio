import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateContent } from './lib/content-pipeline.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
generateContent({ rootDir }).then(({ catalogs }) => {
  console.log(`Generated content: ${Object.keys(catalogs).join(', ')} plus English legacy URLs.`);
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
