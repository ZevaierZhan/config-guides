import { open } from 'node:fs/promises';
import { ConfigGuideError, expect, fail } from './errors.js';

export const MAX_BYTES = 2 * 1024 * 1024;
export const own = (obj, key) => Object.hasOwn(obj, key);
export const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

export function object(value, label, code = 'INVALID_SPEC') {
  expect(isObject(value), `${label} 必须是 JSON 对象`, code);
}
export function keys(value, allowed, label, code = 'INVALID_SPEC') {
  object(value, label, code);
  for (const k of Object.keys(value)) expect(allowed.includes(k), `${label} 含未支持的字段: ${k}`, code);
}
export function text(value, label) {
  expect(typeof value === 'string' && value.trim().length > 0, `${label} 必须是非空字符串`);
}

// Walk explicitly so undefined, accessors, prototypes, cycles, and non-JSON values
// cannot be silently transformed when a caller passes an in-memory specification.
export function checkJSON(value, code = 'INVALID_SPEC', seen = new Set(), depth = 0) {
  expect(depth <= 64, 'JSON 嵌套超过 64 层', code);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    expect(Number.isFinite(value), 'JSON 数值必须有限', code);
    expect(!Number.isInteger(value) || Number.isSafeInteger(value), 'JSON 整数超过 JavaScript 安全范围；请改用字符串', code);
    return;
  }
  expect(Array.isArray(value) || isObject(value), '仅接受 JSON 数据，不接受函数或类实例', code);
  expect(!seen.has(value), 'JSON 不允许循环引用', code);
  seen.add(value);
  const entries = Object.getOwnPropertyDescriptors(value);
  for (const [k, descriptor] of Object.entries(entries)) {
    if (Array.isArray(value) && k === 'length') continue;
    expect(own(descriptor, 'value'), 'JSON 对象不允许 getter/setter', code);
    checkJSON(descriptor.value, code, seen, depth + 1);
  }
  seen.delete(value);
}
export function cloneJSON(value, code = 'INVALID_SPEC') {
  checkJSON(value, code);
  const raw = JSON.stringify(value);
  expect(Buffer.byteLength(raw) <= MAX_BYTES, 'JSON 超过 2 MiB 限制', code);
  return JSON.parse(raw);
}
export function parseJSON(raw, code = 'INVALID_JSON') {
  let value;
  try { value = JSON.parse((typeof raw === 'string' ? raw : new TextDecoder('utf-8', { fatal: true }).decode(raw)).replace(/^\uFEFF/, '')); }
  catch { fail(code, '无法解析 JSON（支持 UTF-8，可含 BOM）；拒绝继续'); }
  checkJSON(value, code);
  return value;
}
export async function readLimited(file) {
  const handle = await open(file, 'r');
  try {
    const info = await handle.stat();
    expect(info.isFile(), '输入不是普通文件', 'INVALID_FILE');
    expect(info.size <= MAX_BYTES, '文件超过 2 MiB 限制', 'TOO_LARGE');
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let total = 0;
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, null);
      if (!bytesRead) break;
      total += bytesRead;
    }
    expect(total <= MAX_BYTES, '文件超过 2 MiB 限制', 'TOO_LARGE');
    return buffer.subarray(0, total);
  } finally { await handle.close(); }
}
export function ioError(error, message) {
  if (error instanceof ConfigGuideError) return error;
  return new ConfigGuideError('IO_ERROR', `${message}${error?.code ? ` (${error.code})` : ''}`, { cause: error });
}
