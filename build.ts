import { rollup } from 'rollup';
import commonjs from '@rollup/plugin-commonjs';
import replace from '@rollup/plugin-replace';
import resolve from '@rollup/plugin-node-resolve';
import cleanup from 'rollup-plugin-cleanup';
import { rm } from 'node:fs/promises';

async function build() {
  for (const entry of ['polyfill/CustomWebXRPolyfill', 'extension/background', 'extension/main-world', 'extension/content-script', 'extension/devtools', 'app/panel']) {
    const polyfill = entry.startsWith('polyfill/');
    const bundle = await rollup({
      input: `.build/${entry}.js`,
      plugins: [replace({ preventAssignment: true, 'process.env.NODE_ENV': JSON.stringify('production') }), resolve(), commonjs(), cleanup({comments: 'none'})],
    });
    await bundle.write(polyfill ? {
      file: 'polyfill/webxr-polyfill.js', format: 'umd', name: 'CustomWebXRPolyfill',
      banner: 'function WebXRPolyfillInjection() {', footer: '}',
    } : { file: `dist/${entry}.js`, format: 'iife' });
    await bundle.close();
  }
  await rm('.build', { recursive: true, force: true });
}
build().catch(error => { console.error(error); process.exitCode = 1; });
