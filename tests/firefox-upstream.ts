import {createServer} from 'node:http';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import ts from 'typescript';

export const revisions = {samples: 'fb41c3416496974672e2c766a41c6febcba2d07e', three: '9b4a2ac29c63ccb43fd51c5661f2f873ac2c39b8', wpt: 'e1859580b5fcf74940a18d2f783296b4961035e3'};
export async function serveFirefoxFixtures() {
  const provenance = new Map<string, {url: string; sha256: string; bytes: number}>();
  const fixture = ts.transpileModule(await readFile('tests/fixture.ts', 'utf8'), {compilerOptions: {target: ts.ScriptTarget.ES2018, module: ts.ModuleKind.None}}).outputText;
  async function upstream(url: string) {
    const key = createHash('sha256').update(url).digest('hex');
    const file = path.join('test-results/firefox-cache', key);
    let bytes: Buffer;
    try { bytes = await readFile(file); }
    catch {
      const response = await fetch(url, {signal: AbortSignal.timeout(60000)});
      if (!response.ok) throw new Error(`${response.status}: ${url}`);
      bytes = Buffer.from(await response.arrayBuffer());
      await mkdir(path.dirname(file), {recursive: true}); await writeFile(file, bytes);
    }
    provenance.set(url, {url, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length});
    return bytes;
  }
  const server = createServer((request, response) => { void (async () => {
    const pathname = new URL(request.url!, 'http://localhost').pathname;
    if (pathname.startsWith('/samples/') || pathname.startsWith('/three/')) {
      const [group, ...parts] = pathname.slice(1).split('/');
      if (parts.some(part => part === '..')) throw new Error('Invalid path');
      const url = group === 'samples' ? `https://raw.githubusercontent.com/immersive-web/webxr-samples/${revisions.samples}/${parts.join('/')}` : `https://raw.githubusercontent.com/mrdoob/three.js/${revisions.three}/${parts.join('/')}`;
      const data = await upstream(url);
      const extension = path.extname(pathname);
      const types: Record<string, string> = {'.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.gltf': 'model/gltf+json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm'};
      response.setHeader('Content-Type', types[extension] ?? 'application/octet-stream'); response.end(data);
    } else if (pathname.startsWith('/wpt/') || pathname === '/resources/testharness.js' || pathname === '/resources/testharnessreport.js') {
      response.setHeader('Content-Type', pathname.endsWith('.html') ? 'text/html' : 'application/javascript');
      if (pathname.endsWith('/webxr_util.js')) response.end(`function xr_session_promise_test(name, body) { promise_test(async t => {const s=await navigator.xr.requestSession('inline');const c=document.createElement('canvas'),g=c.getContext('webgl');await g.makeXRCompatible();s.updateRenderState({baseLayer:new XRWebGLLayer(s,g)});try{await body(s,null,t);}finally{await s.end();}},name);}`);
      else if (pathname === '/resources/testharnessreport.js') response.end(`add_completion_callback((tests,status)=>{window.wptResults={status:status.status,tests:tests.map(t=>({name:t.name,status:t.status,message:t.message}))};});`);
      else response.end(await upstream(`https://raw.githubusercontent.com/web-platform-tests/wpt/${revisions.wpt}/${pathname.replace(/^\/wpt\//, '').replace(/^\//, '')}`));
    } else if (pathname === '/transform-sloppy.js') {
      response.setHeader('Content-Type', 'application/javascript'); response.end('window.assignTransformSloppy = function(t, name, value) { t[name] = value; };');
    } else if (pathname === '/fixture.js') {
      response.setHeader('Content-Type', 'application/javascript'); response.end(fixture);
    } else if (pathname === '/favicon.ico') { response.statusCode = 204; response.end(); }
    else {
      response.setHeader('Content-Type', 'text/html');
      response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' blob: data:; frame-src 'self' http://localhost:*; style-src 'self' 'unsafe-inline'; object-src 'none'");
      response.end('<!doctype html><script src="/fixture.js"></script><body>Firefox WebXR fixture</body>');
    }
  })().catch(error => { console.error(String(error)); response.statusCode = 502; response.end(String(error)); }); });
  server.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No server address');
  return {origin: `http://127.0.0.1:${address.port}`, server, upstream, provenance};
}
