import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigGuideError, expect } from './errors.js';
import { cloneJSON, isObject, keys, object, own, parseJSON, readLimited, text } from './json.js';
import { overlaps, pointer, safeKey } from './pointers.js';

export const version = '0.1.0';
export const capabilities = Object.freeze(['file.json', 'ui.secret']);
const fieldKeys = ['type', 'title', 'description', 'default', 'enum', 'minLength', 'maxLength', 'minimum', 'maximum'];
export function valueError(prop, value) {
  if (prop.type === 'string' && typeof value !== 'string') return '必须是文本';
  if (prop.type === 'boolean' && typeof value !== 'boolean') return '必须是布尔值';
  if (['number', 'integer'].includes(prop.type)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '必须是有限数字';
    if (prop.type === 'integer' && !Number.isSafeInteger(value)) return '必须是安全范围内的整数';
    if (own(prop, 'minimum') && value < prop.minimum) return `不得小于 ${prop.minimum}`;
    if (own(prop, 'maximum') && value > prop.maximum) return `不得大于 ${prop.maximum}`;
  }
  if (prop.type === 'string') {
    const length = [...value].length;
    if (own(prop, 'minLength') && length < prop.minLength) return `至少 ${prop.minLength} 个字符`;
    if (own(prop, 'maxLength') && length > prop.maxLength) return `最多 ${prop.maxLength} 个字符`;
  }
  if (prop.enum && !prop.enum.some(v => v === value)) return '不在允许的选项中';
  return undefined;
}

/** Validates the deliberately limited 1.0 protocol subset. Not a full JSON Schema engine. */
export function defineGuide(input) {
  const spec = cloneJSON(input);
  keys(spec, ['protocolVersion', 'plugin', 'requires', 'form', 'targets', 'bindings', 'submit'], 'spec');
  expect(spec.protocolVersion === '1.0', '仅支持 protocolVersion: "1.0"');
  keys(spec.plugin, ['id', 'title'], 'plugin');
  text(spec.plugin.id, 'plugin.id'); text(spec.plugin.title, 'plugin.title');
  if (own(spec, 'requires')) {
    expect(Array.isArray(spec.requires), 'requires 必须是数组');
    for (const c of spec.requires) expect(capabilities.includes(c), `不支持能力: ${String(c)}`);
  }
  keys(spec.form, ['schema', 'secrets', 'ui'], 'form');
  const schema = spec.form.schema;
  keys(schema, ['$schema', 'type', 'properties', 'required', 'additionalProperties'], 'form.schema');
  if (own(schema, '$schema')) expect(typeof schema.$schema === 'string', '$schema 必须是文本');
  expect(schema.type === 'object' && schema.additionalProperties === false, 'schema 需要 object / additionalProperties: false');
  object(schema.properties, 'schema.properties');
  expect(Object.keys(schema.properties).length > 0, '至少需要一个普通字段');
  for (const [name, prop] of Object.entries(schema.properties)) {
    safeKey(name); expect(!name.startsWith('secret:'), '普通字段不能使用 secret: 前缀'); keys(prop, fieldKeys, `properties.${name}`);
    expect(['string', 'boolean', 'integer', 'number'].includes(prop.type), `字段 ${name} 类型不支持`);
    for (const k of ['title', 'description']) if (own(prop, k)) expect(typeof prop[k] === 'string', `${name}.${k} 必须是文本`);
    for (const k of ['minLength', 'maxLength']) if (own(prop, k)) {
      expect(prop.type === 'string' && Number.isSafeInteger(prop[k]) && prop[k] >= 0, `${name}.${k} 无效`);
    }
    for (const k of ['minimum', 'maximum']) if (own(prop, k)) {
      expect(['integer', 'number'].includes(prop.type) && typeof prop[k] === 'number', `${name}.${k} 无效`);
    }
    expect(!(prop.minLength > prop.maxLength) && !(prop.minimum > prop.maximum), `${name} 的最小限制大于最大限制`);
    if (own(prop, 'enum')) {
      expect(Array.isArray(prop.enum) && prop.enum.length > 0, `${name}.enum 需要非空数组`);
      expect(new Set(prop.enum).size === prop.enum.length, `${name}.enum 不允许重复值`);
      for (const v of prop.enum) expect(!valueError({ ...prop, enum: undefined }, v), `${name}.enum 中的值不符合类型或限制`);
    }
    if (own(prop, 'default')) expect(!valueError(prop, prop.default), `${name} 默认值无效`);
  }
  schema.required ??= [];
  expect(Array.isArray(schema.required) && new Set(schema.required).size === schema.required.length, 'required 必须是不重复的数组');
  for (const name of schema.required) expect(typeof name === 'string' && own(schema.properties, name), 'required 引用了未知字段');
  spec.form.secrets ??= {};
  object(spec.form.secrets, 'form.secrets');
  for (const [name, secret] of Object.entries(spec.form.secrets)) {
    safeKey(name); keys(secret, ['label', 'description', 'required'], `secrets.${name}`); text(secret.label, 'secret.label');
    if (own(secret, 'required')) expect(typeof secret.required === 'boolean', 'secret.required 必须是布尔值');
    if (own(secret, 'description')) expect(typeof secret.description === 'string', 'secret.description 必须是文本');
  }
  expect(Array.isArray(spec.form.ui), 'form.ui 必须是数组');
  const fields = new Set(), secrets = new Set();
  for (const control of spec.form.ui) {
    if (control?.kind === 'field') {
      keys(control, ['kind', 'path', 'widget'], 'ui.field');
      const parts = pointer(control.path);
      expect(parts.length === 1 && own(schema.properties, parts[0]) && !fields.has(parts[0]), 'UI 字段必须是单层字段且不重复');
      const prop = schema.properties[parts[0]];
      switch (control.widget) {
        case 'text': case 'textarea': case 'url': case 'email': expect(prop.type === 'string', '文本控件需要 string'); break;
        case 'number': expect(['number', 'integer'].includes(prop.type), 'number 控件需要数字类型'); break;
        case 'checkbox': expect(prop.type === 'boolean', 'checkbox 控件需要 boolean'); break;
        case 'select': expect(Array.isArray(prop.enum) && prop.enum.length > 0, 'select 控件需要 enum'); break;
        default: expect(false, '未支持的控件');
      }
      fields.add(parts[0]);
    } else if (control?.kind === 'secret') {
      keys(control, ['kind', 'key'], 'ui.secret');
      expect(own(spec.form.secrets, control.key) && !secrets.has(control.key), 'secret 控件引用无效或重复');
      secrets.add(control.key);
    } else expect(false, '未支持的 UI kind');
  }
  expect(fields.size === Object.keys(schema.properties).length && secrets.size === Object.keys(spec.form.secrets).length, '每个字段需要恰好一个 UI 控件');
  object(spec.targets, 'targets');
  expect(Object.keys(spec.targets).length === 1, '0.1.0 仅支持一个保存目标');
  const [targetId, target] = Object.entries(spec.targets)[0]; safeKey(targetId);
  keys(target, ['kind', 'path', 'format', 'writeMode', 'access', 'allowPlaintextSecrets'], 'target');
  expect(target.kind === 'file' && target.format === 'json' && target.writeMode === 'update-owned' && target.access === 'user-only', '仅支持 file / json / update-owned / user-only');
  keys(target.path, ['base', 'relative'], 'target.path');
  expect(['userHome', 'userConfigDir', 'pluginDir', 'workspaceDir'].includes(target.path.base), '未知 path.base');
  text(target.path.relative, 'path.relative');
  const segments = target.path.relative.split('/');
  // Portable paths: reject traversal, Windows device names, ADS and trailing dots/spaces.
  expect(segments.every(p => p && p !== '.' && p !== '..' && !/[\\:\x00-\x1f<>"|?*]/u.test(p)
    && !/[. ]$/u.test(p) && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/iu.test(p)), 'path.relative 必须是安全的跨平台相对文件路径（用 / 分隔）');
  if (own(target, 'allowPlaintextSecrets')) expect(typeof target.allowPlaintextSecrets === 'boolean', 'allowPlaintextSecrets 必须是布尔值');
  expect(!secrets.size || target.allowPlaintextSecrets === true, '敏感字段写入 JSON 需要显式 allowPlaintextSecrets: true');
  expect(Array.isArray(spec.bindings), 'bindings 必须是数组');
  const sources = new Set(), destinations = [];
  for (const binding of spec.bindings) {
    keys(binding, ['from', 'target', 'to'], 'binding');
    const from = pointer(binding.from), to = pointer(binding.to);
    expect(from.length === 2 && ['values', 'secrets'].includes(from[0]), 'binding.from 必须是 /values/字段 或 /secrets/字段');
    expect(own(from[0] === 'values' ? schema.properties : spec.form.secrets, from[1]), 'binding 引用了未知字段');
    const key = JSON.stringify(from);
    expect(!sources.has(key) && binding.target === targetId, 'binding 重复或 target 不匹配');
    expect(!destinations.some(other => overlaps(other, to)), 'binding 目标重复或父子冲突');
    sources.add(key); destinations.push(to);
  }
  expect(sources.size === fields.size + secrets.size, '每个字段需要恰好一个 binding');
  keys(spec.submit, ['label', 'apply'], 'submit'); text(spec.submit.label, 'submit.label');
  keys(spec.submit.apply, ['kind'], 'submit.apply'); expect(spec.submit.apply.kind === 'write-targets', '不支持的 submit.apply');
  return spec;
}

export function localFile(input, label = '文件') {
  if (input instanceof URL) {
    expect(input.protocol === 'file:', `${label} 仅接受 file: URL`, 'INVALID_OPTIONS');
    return fileURLToPath(input);
  }
  expect(typeof input === 'string' && input.length > 0, `${label} 路径无效`, 'INVALID_OPTIONS');
  return path.resolve(input);
}
export async function loadSpec(options) {
  expect(isObject(options), '需要 options 对象', 'INVALID_OPTIONS');
  expect((options.spec !== undefined) !== (options.specFile !== undefined), '必须且只能提供 spec 或 specFile', 'INVALID_OPTIONS');
  const specFile = options.specFile !== undefined ? localFile(options.specFile, 'specFile') : undefined;
  const spec = defineGuide(specFile ? parseJSON(await readLimited(specFile)) : options.spec);
  const context = options.context ? { ...options.context } : {};
  keys(context, ['pluginDir', 'workspaceDir'], 'context', 'INVALID_OPTIONS');
  for (const key of Object.keys(context)) context[key] = localFile(context[key], key);
  if (!context.pluginDir && specFile) context.pluginDir = path.dirname(specFile);
  return { spec, context, specFile };
}

/** Validates a complete form submission. Optional ordinary fields omitted here are deleted. */
export function validateSubmission(spec, input, savedSecrets) {
  const request = cloneJSON(input, 'INVALID_REQUEST');
  keys(request, ['values', 'secretUpdates'], '提交', 'INVALID_REQUEST');
  object(request.values, 'values', 'INVALID_REQUEST');
  const fields = Object.create(null), props = spec.form.schema.properties;
  for (const [key, value] of Object.entries(request.values)) {
    expect(own(props, key), '提交包含未知字段', 'INVALID_REQUEST');
    const error = valueError(props[key], value); if (error) fields[key] = error;
  }
  for (const key of spec.form.schema.required) {
    if (!own(request.values, key) || request.values[key] === '') fields[key] = '此项必填';
  }
  for (const control of spec.form.ui) {
    if (control.kind !== 'field' || !['url', 'email'].includes(control.widget)) continue;
    const key = pointer(control.path)[0], value = request.values[key];
    if (value === undefined || value === '') continue;
    if (typeof value !== 'string') { fields[key] = '必须是文本'; continue; }
    if (control.widget === 'url') {
      try { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw new Error(); }
      catch { fields[key] = '请输入 http:// 或 https:// 地址'; }
    } else if (!/^[^\s@]+@[^\s@]+$/u.test(value)) fields[key] = '请输入有效邮箱';
  }
  const secretUpdates = request.secretUpdates ?? {};
  object(secretUpdates, 'secretUpdates', 'INVALID_REQUEST');
  const secrets = Object.assign(Object.create(null), savedSecrets);
  for (const [key, change] of Object.entries(secretUpdates)) {
    expect(own(spec.form.secrets, key), '提交包含未知敏感字段', 'INVALID_REQUEST');
    keys(change, ['operation', 'value'], 'secretUpdate', 'INVALID_REQUEST');
    switch (change.operation) {
      case 'keep': case 'delete':
        expect(!own(change, 'value'), 'keep/delete 不应包含 value', 'INVALID_REQUEST');
        if (change.operation === 'delete') delete secrets[key];
        break;
      case 'replace': expect(typeof change.value === 'string', 'replace 需要文本 value', 'INVALID_REQUEST'); secrets[key] = change.value; break;
      default: expect(false, '未知敏感字段操作', 'INVALID_REQUEST');
    }
  }
  for (const [key, prop] of Object.entries(spec.form.secrets)) {
    if (prop.required && !secrets[key]) fields[`secret:${key}`] = '此项必填';
  }
  if (Object.keys(fields).length) throw new ConfigGuideError('VALIDATION_FAILED', '请检查表单内容', { fields });
  return { values: request.values, secrets };
}
