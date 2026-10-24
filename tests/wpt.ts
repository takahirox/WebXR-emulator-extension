import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, mkdir, rm, writeFile, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

// These cases are independent of native browser fake-device infrastructure.
// Preserve upstream assertion bodies; only replace the constructor case's unused
// session setup and testharnessreport UI. See docs/webxr-conformance.md.
const revision = 'e1859580b5fcf74940a18d2f783296b4961035e3';
const cases = ['xrRigidTransform_constructor', 'xrRigidTransform_inverse', 'xrRigidTransform_matrix', 'xrRigidTransform_sameObject', 'navigator_xr_sameObject'];
const paths = ['resources/testharness.js', 'webxr/resources/webxr_test_constants.js', 'webxr/resources/webxr_test_asserts.js', 'webxr/resources/webxr_math_utils.js', ...cases.map(name => `webxr/${name}.https.html`)];
const manifest = JSON.parse(await readFile('tests/vendor/wpt/manifest.json', 'utf8'));
const files = new Map<string, string>();
for (const file of paths) {
  const retained = file.startsWith('webxr/xrRigidTransform_');
  const response = retained ? null : await fetch(`https://raw.githubusercontent.com/web-platform-tests/wpt/${revision}/${file}`);
  if (response && !response.ok) throw new Error(`WPT download ${file}: ${response.status}`);
  let body = retained ? await readFile(`tests/vendor/wpt/${file.slice(6)}`, 'utf8') : await response!.text();
  if (retained) assert.equal(createHash('sha256').update(body).digest('hex'), manifest[file].sha256, `Pinned WPT bytes: ${file}`);
  if (file.endsWith('.html')) {
    body = body.replace('/resources/testharnessreport.js', '/capture.js');
    body = body.replace('<script src="resources/webxr_util.js"></script>', '<script src="/session-adapter.js"></script>');
  }
  files.set(`/${file}`, body);
}
files.set('/session-adapter.js', `function xr_session_promise_test(name, body) {
  promise_test(async t => {
    const session = await navigator.xr.requestSession('inline');
    const canvas = document.createElement('canvas'); const gl = canvas.getContext('webgl');
    await gl.makeXRCompatible(); session.updateRenderState({baseLayer: new XRWebGLLayer(session, gl)});
    try { await body(session, null, t); } finally { await session.end(); }
  }, name);
}`);
files.set('/capture.js', 'add_completion_callback((tests, status) => { window.wptResults = {status: status.status, tests: tests.map(t => ({name: t.name, status: t.status, message: t.message}))}; });');
const server = createServer((request, response) => {
  const file = files.get(request.url ?? ''); if (!file) { response.statusCode = 404; response.end(); return; }
  response.setHeader('Content-Type', request.url?.endsWith('.html') ? 'text/html' : 'application/javascript'); response.end(file);
});
server.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
const address = server.address(); assert(address && typeof address !== 'string');
const profile = await mkdtemp(path.join(tmpdir(), 'webxr-wpt-'));
const root = process.cwd();
const context = await chromium.launchPersistentContext(profile, {
  ...(process.env.WEBXR_CHROMIUM_EXECUTABLE ? {executablePath: process.env.WEBXR_CHROMIUM_EXECUTABLE} : {channel: 'chromium'}),
  headless: false, ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--enable-unsafe-swiftshader'],
}).catch(async error => { server.close(); await rm(profile, {recursive: true, force: true}); throw error; });
try {
  const results: {file: string; status: number; tests: {name: string; status: number; message: string | null}[]}[] = [];
  for (const name of cases) {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/webxr/${name}.https.html`);
    await page.waitForFunction(() => !!(window as unknown as {wptResults?: unknown}).wptResults);
    results.push({file: `${name}.https.html`, ...await page.evaluate(() => (window as unknown as {wptResults: Omit<typeof results[number], 'file'>}).wptResults)});
    await page.close();
  }
  const report = {revision, browser: await context.browser()!.version(), node: process.version, playwright: JSON.parse(await readFile('node_modules/playwright/package.json', 'utf8')).version, bundleSHA256: createHash('sha256').update(await readFile('polyfill/webxr-polyfill.js')).digest('hex'), retained: manifest, results};
  await mkdir('test-results', {recursive: true}); await writeFile('test-results/webxr-wpt.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  assert(results.every(result => result.status === 0 && result.tests.length > 0 && result.tests.every(test => test.status === 0)), 'All selected WPT assertions pass');
} finally { await context.close(); server.close(); await rm(profile, {recursive: true, force: true}); }
