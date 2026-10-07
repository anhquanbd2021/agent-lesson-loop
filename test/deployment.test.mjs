import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from '../app/server.js';

async function withServer(fn) {
  const server = createStaticServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('/health returns ok for the render.yaml health check', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'ok');
  });
});

test('/version reports package name and version', async () => {
  const pkg = JSON.parse(readFileSync(
    fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
  await withServer(async (base) => {
    const res = await fetch(`${base}/version`);
    const body = await res.json();
    assert.equal(body.name, pkg.name);
    assert.equal(body.version, pkg.version);
  });
});

test('the lab page and shared module are served; unknown paths 404', async () => {
  await withServer(async (base) => {
    const index = await fetch(`${base}/`);
    assert.equal(index.status, 200);
    assert.ok((await index.text()).includes('Lesson Loop'));
    const mod = await fetch(`${base}/lessonloop.mjs`);
    assert.equal(mod.status, 200);
    assert.ok((await mod.text()).includes('runExperiment'));
    const missing = await fetch(`${base}/../../etc/passwd`);
    assert.equal(missing.status, 404);
  });
});

test('render.yaml healthCheckPath matches the implemented route', () => {
  const yaml = readFileSync(
    fileURLToPath(new URL('../render.yaml', import.meta.url)), 'utf8');
  assert.ok(yaml.includes('healthCheckPath: /health'));
});
