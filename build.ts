import { rollup } from 'rollup';
import commonjs from '@rollup/plugin-commonjs';
import replace from '@rollup/plugin-replace';
import resolve from '@rollup/plugin-node-resolve';
import cleanup from 'rollup-plugin-cleanup';
import { cp, mkdir, rm } from 'node:fs/promises';

async function build() {
  await mkdir('licenses', {recursive: true});
  await cp('node_modules/three/LICENSE', 'licenses/three.txt');
  const threeNotice = '/*! Three.js, MIT license: see licenses/three.txt. */';
  for (const entry of ['polyfill/CustomWebXRPolyfill', 'extension/background', 'extension/main-world', 'extension/content-script', 'extension/devtools', 'app/panel']) {
    const polyfill = entry.startsWith('polyfill/');
    const bundle = await rollup({
      // Core and addons resolve to the same local npm release in each realm.
      input: `.build/${entry}.js`,
      plugins: [replace({ preventAssignment: true, 'process.env.NODE_ENV': JSON.stringify('production') }), resolve({browser: true, dedupe: ['three']}), commonjs(), cleanup({comments: 'none'})],
    });
    await bundle.write(polyfill ? {
      file: 'polyfill/webxr-polyfill.js', format: 'umd', name: 'CustomWebXRPolyfill',
      banner: `${threeNotice}\nfunction WebXRPolyfillInjection() {`, footer: '}',
    } : { file: `dist/${entry}.js`, format: 'iife', ...(entry === 'app/panel' ? {banner: threeNotice} : {}) });
    await bundle.close();
  }
  await rm('.build', { recursive: true, force: true });
}
build().catch(error => { console.error(error); process.exitCode = 1; });
