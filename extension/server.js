'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const configDir = process.env.MDC_AI_CONFIG_DIR || '/config';
const configPath = path.join(configDir, 'mdc-ai.json');
const tokenPath = path.join(configDir, 'mdc-ai-admin-token.txt');
const port = Number(process.env.MDC_AI_PORT || 9209);
const maxBody = 65536;

fs.mkdirSync(configDir, { recursive: true });
if (!fs.existsSync(tokenPath)) {
  fs.writeFileSync(tokenPath, crypto.randomBytes(24).toString('hex') + '\n', { mode: 0o600, flag: 'wx' });
}
const adminToken = fs.readFileSync(tokenPath, 'utf8').trim();
const sessionToken = crypto.randomBytes(24).toString('hex');

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { base_url: 'https://api.openai.com/v1', model: '', api_key: '' };
    throw error;
  }
}

function writeConfig(value) {
  const tmp = configPath + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, configPath);
}

function publicConfig(value) {
  return { base_url: value.base_url, model: value.model, has_api_key: Boolean(value.api_key) };
}

function validateBaseUrl(value) {
  if (typeof value !== 'string' || value.length > 500) throw new Error('接口地址无效');
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('接口地址必须是 HTTP(S) 地址，不能包含账号、查询参数或片段');
  }
  return value.replace(/\/+$/, '');
}

function authorized(req) {
  const cookie = /(?:^|;\s*)mdc_ai_session=([^;]+)/.exec(req.headers.cookie || '');
  if (cookie && cookie[1] === sessionToken) return true;
  const match = /^Basic (.+)$/i.exec(req.headers.authorization || '');
  if (!match) return false;
  let pair;
  try { pair = Buffer.from(match[1], 'base64').toString('utf8'); } catch { return false; }
  const expected = Buffer.from('admin:' + adminToken);
  const actual = Buffer.from(pair);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function localRequest(req) {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
}

function send(res, status, data, type = 'application/json; charset=utf-8') {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(status, { 'content-type': type, 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(body);
}

async function readJson(req) {
  let size = 0;
  const parts = [];
  for await (const part of req) {
    size += part.length;
    if (size > maxBody) throw new Error('请求内容过大');
    parts.push(part);
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}

async function providerRequest(config, route, method, body) {
  if (!config.api_key || !config.model) throw new Error('请先配置 API Key 和模型');
  const response = await fetch(config.base_url + route, {
    method,
    headers: { authorization: 'Bearer ' + config.api_key, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(90000)
  });
  if (!response.ok) throw new Error('AI 接口返回 HTTP ' + response.status);
  return response.json();
}

async function translate(config, text, source, target) {
  if (typeof text !== 'string' || !text.trim() || text.length > 20000) throw new Error('翻译文本必须为 1–20000 个字符');
  const result = await providerRequest(config, '/chat/completions', 'POST', {
    model: config.model,
    messages: [
      { role: 'system', content: `你是元数据翻译器。只将用户提供的文本从${source || '自动检测语言'}翻译成${target || '简体中文'}。保持人名、番号、HTML 标签和段落结构，不添加解释。` },
      { role: 'user', content: text }
    ]
  });
  const output = result?.choices?.[0]?.message?.content;
  if (typeof output !== 'string' || !output.trim()) throw new Error('AI 接口未返回翻译文本');
  return output.trim();
}

const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MDC AI 翻译设置</title><style>body{font:16px system-ui,sans-serif;max-width:650px;margin:40px auto;padding:0 18px;background:#f7f8fa;color:#1b2533}main{background:white;padding:28px;border-radius:14px;box-shadow:0 4px 20px #0001}label{display:block;margin:18px 0 6px;font-weight:600}input,select,button{box-sizing:border-box;font:inherit;padding:10px;border:1px solid #bbb;border-radius:7px}input,select{width:100%}button{cursor:pointer;background:#174ad4;color:white;border:0;margin:12px 8px 0 0}small{color:#596579}#message{white-space:pre-wrap}</style><main><h1>MDC AI 翻译设置</h1><p>配置 OpenAI 兼容接口后，在 MDC「设置 → 元数据」中选择 <b>Deeplx</b>，接口地址填 <code>http://127.0.0.1:9209/translate</code>。</p><label>API 基础地址</label><input id="base" placeholder="https://api.openai.com/v1"><label>API Key</label><input id="key" type="password" autocomplete="new-password" placeholder="留空则保留现有密钥"><small>密钥仅保存在 NAS 的 /config/mdc-ai.json，不回显。</small><label>模型</label><select id="models"><option value="">手动输入或获取模型列表</option></select><input id="model" placeholder="模型 ID，例如 gpt-4.1-mini"><div><button id="load">获取模型列表</button><button id="save">保存</button><button id="test">测试翻译</button></div><p id="message" role="status"></p></main><script>const $=id=>document.getElementById(id),msg=s=>$('message').textContent=s;async function api(path,method='GET',body){const r=await fetch(path,{method,headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});const x=await r.json();if(!r.ok)throw Error(x.message||'请求失败');return x}async function init(){try{const c=await api('/api/config');$('base').value=c.base_url;$('model').value=c.model;msg(c.has_api_key?'已保存 API Key':'请填写 API Key')}catch(e){msg(e.message)}}$('save').onclick=async()=>{try{const c=await api('/api/config','PUT',{base_url:$('base').value,model:$('model').value,api_key:$('key').value});$('key').value='';msg('已保存。'+(c.has_api_key?' API Key 已配置。':''))}catch(e){msg(e.message)}};$('load').onclick=async()=>{try{msg('正在获取模型…');const x=await api('/api/models');$('models').replaceChildren(new Option('请选择模型',''),...x.models.map(m=>new Option(m,m)));msg('已获取 '+x.models.length+' 个模型')}catch(e){msg(e.message)}};$('models').onchange=()=>{if($('models').value)$('model').value=$('models').value};$('test').onclick=async()=>{try{const x=await api('/api/test','POST',{});msg('测试结果：'+x.data)}catch(e){msg(e.message)}};init()</script></html>`;
const loginHtml = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MDC AI 登录</title><style>body{font:16px system-ui,sans-serif;max-width:440px;margin:60px auto;padding:0 20px}input,button{font:inherit;padding:10px;box-sizing:border-box}input{width:100%}button{margin-top:12px}</style><h1>MDC AI 设置</h1><p>请输入 /config/mdc-ai-admin-token.txt 文件中的密码。</p><input id="token" type="password" autocomplete="off" aria-label="设置密码"><button id="login">登录</button><p id="error" role="alert"></p><script>document.getElementById('login').onclick=async()=>{const r=await fetch('/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:document.getElementById('token').value})});if(r.ok)location.reload();else document.getElementById('error').textContent='密码错误'}</script></html>`;

const server = http.createServer(async (req, res) => {
  try {
    const route = new URL(req.url, 'http://localhost').pathname;
    if (route === '/health' && req.method === 'GET') return send(res, 200, { ok: true });
    if (route === '/translate' && req.method === 'POST') {
      if (!localRequest(req)) return send(res, 403, { code: 403, message: '仅供本机 MDC 调用' });
      const body = await readJson(req);
      const data = await translate(readConfig(), body.text, body.source_lang, body.target_lang);
      return send(res, 200, { code: 200, id: Date.now(), data, alternatives: [], source_lang: body.source_lang || 'auto', target_lang: body.target_lang || 'ZH', method: 'AI' });
    }
    if (route === '/login' && req.method === 'POST') {
      const body = await readJson(req);
      const actual = Buffer.from(typeof body.token === 'string' ? body.token : '');
      const expected = Buffer.from(adminToken);
      if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return send(res, 401, { message: '密码错误' });
      res.writeHead(204, { 'set-cookie': `mdc_ai_session=${sessionToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`, 'cache-control': 'no-store' });
      return res.end();
    }
    if (route === '/' && req.method === 'GET' && !authorized(req)) return send(res, 200, loginHtml, 'text/html; charset=utf-8');
    if (!authorized(req)) {
      return send(res, 401, { message: '请先登录' });
    }
    if (route === '/' && req.method === 'GET') return send(res, 200, html, 'text/html; charset=utf-8');
    if (route === '/api/config' && req.method === 'GET') return send(res, 200, publicConfig(readConfig()));
    if (route === '/api/config' && req.method === 'PUT') {
      const body = await readJson(req);
      const current = readConfig();
      const value = {
        base_url: validateBaseUrl(body.base_url),
        model: typeof body.model === 'string' ? body.model.trim().slice(0, 200) : '',
        api_key: typeof body.api_key === 'string' && body.api_key ? body.api_key.trim() : current.api_key
      };
      writeConfig(value);
      return send(res, 200, publicConfig(value));
    }
    if (route === '/api/models' && req.method === 'GET') {
      const c = readConfig();
      if (!c.api_key) throw new Error('请先保存 API Key');
      const result = await providerRequest({ ...c, model: c.model || 'unused' }, '/models', 'GET');
      return send(res, 200, { models: (result.data || []).map(x => x.id).filter(x => typeof x === 'string').sort() });
    }
    if (route === '/api/test' && req.method === 'POST') return send(res, 200, { data: await translate(readConfig(), 'Hello, world!', 'EN', 'ZH') });
    return send(res, 404, { message: '未找到页面' });
  } catch (error) {
    return send(res, 400, { code: 400, message: error.message || '请求失败' });
  }
});

server.listen(port, '0.0.0.0', () => console.log('MDC AI extension listening on port ' + port));
