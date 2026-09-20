import { expect } from './errors.js';
import { isObject, own } from './json.js';
const blocked = new Set(['__proto__', 'prototype', 'constructor']);
export function safeKey(key) {
  expect(typeof key === 'string' && key.length > 0 && !blocked.has(key), '字段名为空或使用了保留键');
}
export function pointer(value) {
  expect(typeof value === 'string' && value.startsWith('/') && !/~(?![01])/u.test(value), '需要有效的非空 JSON Pointer');
  const result = value.slice(1).split('/').map(k => k.replaceAll('~1', '/').replaceAll('~0', '~'));
  result.forEach(safeKey);
  return result;
}
export function getAt(root, parts) {
  let current = root;
  for (const key of parts) {
    if (!isObject(current) || !own(current, key)) return { exists: false };
    current = current[key];
  }
  return { exists: true, value: current };
}
export function setAt(root, parts, value, remove = false) {
  let current = root;
  for (const key of parts.slice(0, -1)) {
    if (!own(current, key)) {
      if (remove) return;
      current[key] = Object.create(null);
    }
    expect(isObject(current[key]), '目标路径中已有非对象值，拒绝覆盖', 'PATH_CONFLICT');
    current = current[key];
  }
  if (remove) delete current[parts.at(-1)];
  else current[parts.at(-1)] = value;
}
export function overlaps(left, right) {
  return left.slice(0, Math.min(left.length, right.length)).every((key, i) => key === right[i]);
}
