import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
await mkdir(new URL('../vendor/', import.meta.url), { recursive: true });
const files = [
  ['qrcode.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'],
  ['three.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.146.0/three.min.js'],
  ['rapier.es.js', 'https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.17.3/rapier.es.js'],
];
for (const [name, url] of files) {
  // curl respects the managed environment's proxy and CA configuration.
  execFileSync(
    'curl',
    [
      '--fail',
      '--show-error',
      '--location',
      url,
      '--output',
      fileURLToPath(new URL('../vendor/' + name, import.meta.url)),
    ],
    { stdio: 'inherit' }
  );
  console.log('Saved ' + name);
}
