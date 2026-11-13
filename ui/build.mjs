import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
// Reuse the workspace's installed toolchain; a standalone install uses prototype/node_modules.
let require;
try { require = createRequire(root + 'package.json'); require.resolve('esbuild'); }
catch { require = createRequire(root + '../game-archive-service/package.json'); }
const { build } = require('esbuild');
await build({ entryPoints: [root + 'ui/game-selects.tsx'], bundle: true, minify: true, format: 'iife', platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' }, nodePaths: [require.resolve('react/package.json').replace(/react\/package.json$/, '')], outfile: root + 'dist/game-selects.js', legalComments: 'eof' });
