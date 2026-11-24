import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { TOKEN_ART, TOKEN_FONT } from '../dist/token-assets.js';

const require = createRequire(import.meta.url);
const sharp = require(require.resolve('sharp', {
  paths: [fileURLToPath(new URL('../', import.meta.url)), fileURLToPath(new URL('../../game-archive-service/', import.meta.url))],
}));

const brand = [
  ['logo', 'bitva-znamen.png', 200],
  ['team-red', 'team-red.png', 64],
  ['team-blue', 'team-blue.png', 64],
  ['advisor', 'advisor.webp', 131],
  ['advisor-still', 'advisor.png', 131],
];

// WebP may discard RGB under fully transparent pixels. All visible RGB and every
// alpha value must match the resized reference, including every animation frame.
function samePixels(reference, decoded) {
  if (reference.length !== decoded.length) return false;
  for (let i = 0; i < reference.length; i += 4) {
    if (reference[i + 3] !== decoded[i + 3]) return false;
    if (reference[i + 3] && (reference[i] !== decoded[i] || reference[i+1] !== decoded[i+1] || reference[i+2] !== decoded[i+2])) return false;
  }
  return true;
}

async function encodeVariant(input, meta, width) {
  const pipeline = sharp(input, { animated: true }).resize({ width, withoutEnlargement: true });
  const webp = await pipeline.clone().webp({ lossless: true, effort: 5 }).toBuffer();
  const animated = meta.pages > 1;
  const png = animated ? null : await pipeline.clone().png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
  const format = png && png.length < webp.length ? 'png' : 'webp';
  const encoded = format === 'png' ? png : webp;
  const decoder = sharp(encoded, { animated: true });
  const output = await decoder.metadata();
  if (animated && (output.pages !== meta.pages || output.loop !== meta.loop || String(output.delay) !== String(meta.delay))) {
    throw new Error('Animation timing changed during encoding');
  }
  const reference = await pipeline.ensureAlpha().raw().toBuffer();
  const decoded = await decoder.ensureAlpha().raw().toBuffer();
  if (!samePixels(reference, decoded)) throw new Error('Lossless pixel verification failed at width ' + width);
  return { encoded, format };
}

export async function buildWebArt(root) {
  // Both the module-based development server and the published Pages directory
  // serve their own root. Asset URLs stay relative to the document in both.
  const directories = ['dist/art', 'docs/art'].map(dir => path.join(root, dir));
  await Promise.all(directories.map(dir => fs.mkdir(dir, { recursive: true })));
  async function write(name, ext, bytes) {
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
    const filename = name + '-' + hash + '.' + ext;
    await Promise.all(directories.map(dir => fs.writeFile(path.join(dir, filename), bytes)));
    return './art/' + filename;
  }
  async function variants(name, input, cssWidth, firstDensity) {
    const meta = await sharp(input, { animated: true }).metadata();
    const urls = [], seen = new Map();
    if (firstDensity) seen.set(cssWidth, await write(name + '-' + cssWidth, 'png', firstDensity));
    for (const density of [1, 2, 3]) {
      const width = Math.min(meta.width, cssWidth * density);
      if (!seen.has(width)) {
        const { encoded, format } = await encodeVariant(input, meta, width);
        seen.set(width, await write(name + '-' + width, format, encoded));
      }
      urls.push(seen.get(width));
    }
    return urls;
  }
  const brands = {};
  const logoAtOneDensity = await fs.readFile(path.join(root, 'mobile/art/logo.png'));
  for (const [name, filename, cssWidth] of brand) {
    brands[name] = await variants(name, await fs.readFile(path.join(root, 'dist/brand', filename)), cssWidth, name === 'logo' ? logoAtOneDensity : undefined);
  }
  const tokens = {};
  for (const [name, source] of Object.entries(TOKEN_ART)) {
    const bytes = Buffer.from(source.split(',')[1], 'base64');
    // 160 CSS pixels also covers the enlarged examples in the rules overlay.
    tokens[name] = source.startsWith('data:image/png;') ? await variants(name, bytes, 160) : await write(name, 'svg', bytes);
  }
  const font = await write('belwe', 'ttf', Buffer.from(TOKEN_FONT.split(',')[1], 'base64'));
  const tokenModule = 'export const TOKEN_ART = ' + JSON.stringify(tokens) + ';\nexport const TOKEN_FONT = ' + JSON.stringify(font) + ';\n';
  const tokenModuleUrl = await write('tokens', 'js', tokenModule);
  const resultFlags = Object.fromEntries(await Promise.all(['draw-left', 'draw-right'].map(async name => {
    const file = './desktop-icons/' + name + '.png';
    return [file, await write(name, 'png', await fs.readFile(path.join(root, 'dist', file)))];
  })));
  const logo = brands.logo.map((url, i) => url + ' ' + (i+1) + 'x').join(', ');
  const backgrounds = Object.entries(brands).filter(([name]) => name !== 'logo')
    .map(([name, urls]) => '--' + name + ':image-set(' + urls.map((url,i) => 'url("' + url + '") ' + (i+1) + 'x').join(',') + ')').join(';');
  const teamFlags = { 'team-red': brands['team-red'][2], 'team-blue': brands['team-blue'][2] };
  return { logo, logoVariants: brands.logo, logoFallback: brands.logo[0], backgrounds, resultFlags, teamFlags, tokenModule, tokenModuleUrl, favicon: tokens.bullseye };
}
