import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

// A separate package avoids MV2-only Chrome keys and Firefox's unsupported
// background.service_worker. The same stateless listener runs as an event page.
const destination = 'build/firefox';
await rm(destination, {recursive: true, force: true});
await mkdir(destination, {recursive: true});
for (const entry of ['dist', 'polyfill', 'src', 'assets', 'icons', 'licenses']) {
  await cp(entry, `${destination}/${entry}`, {recursive: true, filter: source => !source.endsWith('.ts')});
}
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
delete manifest.minimum_chrome_version;
manifest.background = {scripts: ['dist/extension/background.js']};
manifest.browser_specific_settings = {gecko: {
  id: 'webxr-emulator@takahirox.github.io', strict_min_version: '128.0',
  data_collection_permissions: {required: ['none']},
}};
await writeFile(`${destination}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
