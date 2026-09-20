/** Stable error codes for hosts. Never include submitted secret values in messages. */
export class ConfigGuideError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'ConfigGuideError';
    this.code = code;
    if (options.fields) this.fields = options.fields;
  }
}
export function fail(code, message) { throw new ConfigGuideError(code, message); }
export function expect(condition, message, code = 'INVALID_SPEC') {
  if (!condition) fail(code, message);
}
