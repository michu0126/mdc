'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

test('configuration, model selection, and Deeplx translation contract', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdc-ai-'));
  const provider = http.createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer test-key');
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'model-b' }, { id: 'model-a' }] }));
    assert.equal(req.url, '/v1/chat/completions');
    const parts = [];
    for await (const part of req) parts.push(part);
    const request = JSON.parse(Buffer.concat(parts));
    assert.equal(request.model, 'model-a');
    assert.equal(request.messages[1].content, 'Hello, world!');
    res.end(JSON.stringify({ choices: [{ message: { content: '你好，世界！' } }] }));
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  const probe = http.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, MDC_AI_CONFIG_DIR: dir, MDC_AI_PORT: String(port) }, stdio: 'ignore'
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 50; i++) {
      try { if ((await fetch(base + '/health')).ok) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const token = fs.readFileSync(path.join(dir, 'mdc-ai-admin-token.txt'), 'utf8').trim();
    const auth = 'Basic ' + Buffer.from('admin:' + token).toString('base64');
    assert.equal((await fetch(base + '/api/config')).status, 401);
    const saved = await fetch(base + '/api/config', {
      method: 'PUT', headers: { authorization: auth, 'content-type': 'application/json' },
      body: JSON.stringify({ base_url: `http://127.0.0.1:${provider.address().port}/v1`, model: 'model-a', api_key: 'test-key' })
    });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).has_api_key, true);
    const config = await (await fetch(base + '/api/config', { headers: { authorization: auth } })).json();
    assert.equal(config.api_key, undefined);
    const models = await (await fetch(base + '/api/models', { headers: { authorization: auth } })).json();
    assert.deepEqual(models.models, ['model-a', 'model-b']);
    const translated = await (await fetch(base + '/translate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Hello, world!', source_lang: 'EN', target_lang: 'ZH' })
    })).json();
    assert.equal(translated.code, 200);
    assert.equal(translated.data, '你好，世界！');
    assert.equal(translated.target_lang, 'ZH');
  } finally {
    child.kill();
    await new Promise(resolve => provider.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
