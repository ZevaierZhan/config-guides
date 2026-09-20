import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { ConfigGuideError, expect } from './errors.js';
import { isObject, keys, MAX_BYTES, parseJSON } from './json.js';
import { validateSubmission, version } from './spec.js';
import { materializeCandidate, saveTarget } from './storage.js';

const csp = "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'";
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
function tokenMatches(header, token) {
  if (typeof header !== 'string') return false;
  const a = Buffer.from(header), b = Buffer.from(`Bearer ${token}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
async function readBody(req) {
  expect((req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() === 'application/json', '需要 application/json', 'CONTENT_TYPE');
  if (req.headers['content-length']) expect(Number(req.headers['content-length']) <= MAX_BYTES, '请求超过 2 MiB', 'TOO_LARGE');
  const chunks = []; let length = 0;
  // Events rather than async iteration: retain the socket long enough to return 413.
  const data = await new Promise((resolve, reject) => {
    const clean = () => { req.off('data', onData); req.off('end', onEnd); req.off('aborted', onAbort); req.off('error', onError); };
    const onError = error => { clean(); reject(error); };
    const onAbort = () => onError(new ConfigGuideError('INVALID_REQUEST', '请求已中断'));
    const onData = chunk => {
      length += chunk.length;
      if (length > MAX_BYTES) { clean(); req.resume(); reject(new ConfigGuideError('TOO_LARGE', '请求超过 2 MiB')); return; }
      chunks.push(chunk);
    };
    const onEnd = () => { clean(); resolve(Buffer.concat(chunks)); };
    req.on('data', onData); req.once('end', onEnd); req.once('aborted', onAbort); req.once('error', onError);
  });
  return parseJSON(data, 'INVALID_REQUEST');
}

export async function startSession({ spec, target, snapshot, timeoutMs, closeAfterMs, signal, verify, verificationTimeoutMs }) {
  const assets = new Map();
  for (const [route, file, type] of [
    ['/', 'index.html', 'text/html'], ['/app.js', 'app.js', 'text/javascript'], ['/style.css', 'style.css', 'text/css'], ['/rich.css', 'rich.css', 'text/css'],
  ]) assets.set(route, { bytes: await readFile(new URL(`../web/${file}`, import.meta.url)), type: `${type}; charset=utf-8` });
  const token = randomBytes(32).toString('hex');
  let host, origin, finished = false, finishingResult, timer, closePromise;
  let queue = Promise.resolve();
  const serialize = fn => { const job = queue.then(fn); queue = job.catch(() => {}); return job; };
  let resolveDone;
  const done = new Promise(resolve => { resolveDone = resolve; });
  const server = http.createServer({ maxHeaderSize: 16_384, requestTimeout: 15_000, headersTimeout: 10_000, keepAliveTimeout: 1_000 }, (req, res) => {
    dispatch(req, res).catch(error => {
      if (res.destroyed || res.headersSent) { res.destroy(); return; }
      const known = error instanceof ConfigGuideError;
      const status = ({ VALIDATION_FAILED: 422, INVALID_REQUEST: 400, CONTENT_TYPE: 415, TOO_LARGE: 413, SESSION_FINISHED: 409,
        CONFIG_CONFLICT: 409, CONFIG_LOCKED: 409, PATH_CONFLICT: 409, UNSAFE_PATH: 409, PERMISSION_FAILED: 500,
        VERIFICATION_FAILED: 422, VERIFICATION_TIMEOUT: 504 })[error.code] || 500;
      json(res, status, { error: known ? error.message : '操作失败，请检查配置位置及读写权限。', code: known ? error.code : 'IO_ERROR', ...(error.fields ? { fields: error.fields } : {}) });
    });
  });
  server.on('clientError', (_error, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); });
  function makeResult(status, reason, warnings = [], verificationMessage = '') {
    const saved = status === 'completed';
    return { protocolVersion: '1.0', pluginId: spec.plugin.id, status, persistence: saved ? 'saved' : 'unchanged',
      verification: saved && verify ? 'succeeded' : 'not-requested', changedTargets: saved ? [target.id] : [], path: target.path,
      ...(verificationMessage ? { verificationMessage } : {}),
      ...(reason ? { reason } : {}), ...(warnings.length ? { warnings } : {}) };
  }
  function finish(result) {
    if (closePromise) return closePromise;
    finished = true; finishingResult = result; clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    // Secrets are never returned. Release references (JS strings cannot be securely zeroed).
    for (const key of Object.keys(snapshot.savedSecrets)) delete snapshot.savedSecrets[key];
    closePromise = new Promise(resolve => {
      const force = setTimeout(() => server.closeAllConnections(), 2_000); force.unref();
      server.close(() => { clearTimeout(force); resolveDone(result); resolve(result); });
      server.closeIdleConnections();
    });
    return closePromise;
  }
  async function close(reason = 'closed') {
    await serialize(() => {
      if (!finished) { finished = true; finishingResult = makeResult('cancelled', reason); void finish(finishingResult); }
    });
    return done;
  }
  const abort = () => { void close('aborted'); };
  async function runVerification(config) {
    if (!verify) return { ok: true, message: '' };
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, verificationTimeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const aborted = new Promise((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(
        new ConfigGuideError(timedOut ? 'VERIFICATION_TIMEOUT' : 'VERIFICATION_FAILED',
          timedOut ? `连接验证超过 ${verificationTimeoutMs}ms` : '连接验证已取消'),
      ), { once: true }));
      let result;
      try { result = await Promise.race([Promise.resolve().then(() => verify({ config: structuredClone(config), signal: controller.signal })), aborted]); }
      catch (error) {
        if (error instanceof ConfigGuideError) throw error;
        const message = error instanceof Error && error.message ? error.message : '插件未提供可显示的失败原因';
        throw new ConfigGuideError('VERIFICATION_FAILED', `连接验证失败：${message.slice(0, 1000)}`, { cause: error });
      }
      expect(isObject(result), 'verify 必须返回对象', 'VERIFICATION_FAILED');
      keys(result, ['ok', 'message'], 'verify result', 'VERIFICATION_FAILED');
      expect(typeof result.ok === 'boolean', 'verify result.ok 必须是布尔值', 'VERIFICATION_FAILED');
      if (result.message !== undefined) expect(typeof result.message === 'string' && result.message.length <= 1000,
        'verify result.message 必须是不超过 1000 字符的文本', 'VERIFICATION_FAILED');
      if (!result.ok) throw new ConfigGuideError('VERIFICATION_FAILED', result.message || '连接验证失败');
      return { ok: true, message: result.message || '连接验证成功' };
    } finally {
      clearTimeout(timeout); signal?.removeEventListener('abort', onAbort); controller.abort();
    }
  }
  async function validateAndVerify(body) {
    const { values, secrets } = validateSubmission(spec, body, snapshot.savedSecrets);
    try {
      const candidate = await materializeCandidate(spec, target, snapshot.hash, values, secrets);
      const verification = await runVerification(candidate);
      return { values, secrets, verification };
    } catch (error) {
      for (const key of Object.keys(secrets)) delete secrets[key];
      throw error;
    }
  }
  async function dispatch(req, res) {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin'); res.setHeader('Content-Security-Policy', csp);
    if (req.headers.host !== host || req.headers['sec-fetch-site'] === 'cross-site') { json(res, 403, { error: '来源校验失败', code: 'FORBIDDEN' }); return; }
    const url = new URL(req.url, origin);
    if (!req.url.startsWith('/') || url.origin !== origin) { json(res, 403, { error: '来源校验失败' }); return; }
    const route = url.pathname;
    if (!route.startsWith('/api/')) {
      if (!['GET', 'HEAD'].includes(req.method)) { json(res, 405, { error: '不支持的方法' }); return; }
      const asset = assets.get(route);
      if (!asset) { json(res, 404, { error: '未找到' }); return; }
      res.writeHead(200, { 'Content-Type': asset.type }); res.end(req.method === 'HEAD' ? undefined : asset.bytes); return;
    }
    if (!tokenMatches(req.headers.authorization, token)) { json(res, 401, { error: '缺少或无效的会话凭证', code: 'UNAUTHORIZED' }); return; }
    const from = req.headers.origin;
    if ((from && from !== origin) || (req.method === 'POST' && from !== origin)) { json(res, 403, { error: '来源校验失败', code: 'FORBIDDEN' }); return; }
    if (route === '/api/session' && req.method === 'GET') {
      await serialize(() => {
        expect(!finished, '本次配置会话已结束', 'SESSION_FINISHED');
        json(res, 200, { version, plugin: spec.plugin, form: spec.form, values: snapshot.values,
          secretStates: Object.fromEntries(Object.keys(spec.form.secrets).map(key => [key, !!snapshot.savedSecrets[key]])),
          targetPath: target.path, submitLabel: spec.submit.label, plaintextSecrets: Object.keys(spec.form.secrets).length > 0,
          configurationExists: snapshot.hash !== 'missing', verification: { enabled: Boolean(verify), required: Boolean(verify) }, closeAfterMs });
      });
      return;
    }
    if ((route === '/api/save' || route === '/api/verify' || route === '/api/cancel') && req.method === 'POST') {
      const body = await readBody(req);
      await serialize(async () => {
        expect(!finished, '本次配置会话已结束', 'SESSION_FINISHED');
        if (route === '/api/verify') {
          expect(verify, '此向导未配置连接验证', 'INVALID_REQUEST');
          const { secrets, verification } = await validateAndVerify(body);
          for (const key of Object.keys(secrets)) delete secrets[key];
          json(res, 200, verification); return;
        }
        let result;
        if (route === '/api/save') {
          const { values, secrets, verification } = await validateAndVerify(body);
          try {
            const warnings = await saveTarget(spec, target, snapshot.hash, values, secrets);
            result = makeResult('completed', undefined, warnings, verification.message);
          } finally { for (const key of Object.keys(secrets)) delete secrets[key]; }
        } else {
          expect(body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 0, '取消请求应为空对象', 'INVALID_REQUEST');
          result = makeResult('cancelled', 'cancelled');
        }
        finished = true; finishingResult = result;
        // Register before end(): stop after the response is flushed, even when the client disconnects.
        const complete = () => { void finish(result); };
        res.once('finish', complete); res.once('close', complete);
        json(res, 200, result);
      });
      return;
    }
    json(res, 404, { error: '未知接口或方法' });
  }
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  host = `127.0.0.1:${address.port}`; origin = `http://${host}`;
  server.on('error', () => { void close('server-error'); });
  timer = setTimeout(() => { void close('timeout'); }, timeoutMs);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  return Object.freeze({ url: `${origin}/#session=${token}`, path: target.path, done, close });
}
