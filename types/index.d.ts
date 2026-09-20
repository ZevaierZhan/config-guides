export type Scalar = string | number | boolean;
export interface FieldSchema {
  type: 'string' | 'number' | 'integer' | 'boolean';
  title?: string; description?: string; default?: Scalar; enum?: Scalar[];
  minLength?: number; maxLength?: number; minimum?: number; maximum?: number;
}
export type Control =
  | { kind: 'field'; path: string; widget: 'text' | 'textarea' | 'url' | 'email' | 'number' | 'checkbox' | 'select' }
  | { kind: 'secret'; key: string };
/** Implemented protocol subset, not the full JSON Schema specification. */
export interface GuideSpec {
  protocolVersion: '1.0';
  plugin: { id: string; title: string };
  requires?: ('file.json' | 'ui.secret')[];
  form: {
    schema: { $schema?: string; type: 'object'; properties: Record<string, FieldSchema>; required?: string[]; additionalProperties: false };
    secrets?: Record<string, { label: string; description?: string; required?: boolean }>;
    ui: Control[];
  };
  targets: Record<string, {
    kind: 'file'; format: 'json'; writeMode: 'update-owned'; access: 'user-only';
    path: { base: 'userHome' | 'userConfigDir' | 'pluginDir' | 'workspaceDir'; relative: string };
    allowPlaintextSecrets?: boolean;
  }>;
  bindings: { from: string; target: string; to: string }[];
  submit: { label: string; apply: { kind: 'write-targets' } };
}
export interface GuideContext { pluginDir?: string | URL; workspaceDir?: string | URL }
export type SpecSource =
  | { spec: GuideSpec; specFile?: never; context?: GuideContext }
  | { specFile: string | URL; spec?: never; context?: GuideContext };
export interface VerificationContext { config: Record<string, unknown>; signal: AbortSignal }
export interface VerificationResult { ok: boolean; message?: string }
export type CreateGuideOptions = SpecSource & {
  timeoutMs?: number; closeAfterMs?: number; signal?: AbortSignal;
  verify?: (context: VerificationContext) => VerificationResult | Promise<VerificationResult>;
  verification?: { timeoutMs?: number };
};
export type RunGuideOptions = CreateGuideOptions & {
  openBrowser?: boolean;
  /** Contains the secret-bearing session URL. Show only to the local user. */
  onReady?: (ready: { url: string; path: string }) => void | Promise<void>;
  onWarning?: (message: string) => void | Promise<void>;
};
export interface GuideResult {
  protocolVersion: '1.0'; pluginId: string;
  status: 'completed' | 'cancelled'; persistence: 'saved' | 'unchanged';
  verification: 'not-requested' | 'succeeded'; verificationMessage?: string; changedTargets: string[]; path: string;
  reason?: string; warnings?: string[];
}
export interface GuideSession {
  /** A short-lived bearer credential is in the fragment. Never share/log to an agent. */
  readonly url: string;
  readonly path: string;
  readonly done: Promise<GuideResult>;
  /** Idempotent. Waits for active writes and complete server cleanup. */
  close(reason?: string): Promise<GuideResult>;
}
export class ConfigGuideError extends Error {
  readonly code: string;
  readonly fields?: Record<string, string>;
  constructor(code: string, message: string, options?: { cause?: unknown; fields?: Record<string, string> });
}
export const version: '0.2.0';
export const capabilities: readonly string[];
/** Validates immediately, returns an independent normalized copy. */
export function defineGuide(spec: GuideSpec): GuideSpec;
export function createGuide(options: CreateGuideOptions): Promise<GuideSession>;
export function runGuide(options: RunGuideOptions): Promise<GuideResult>;
export function getConfigPath(options: SpecSource): Promise<string>;
/** Explicit access to saved config INCLUDING secrets. Undefined if file is absent.
 * Never output the whole result to a log, model, or public command response.
 */
export function readConfig<T extends Record<string, unknown> = Record<string, unknown>>(options: SpecSource): Promise<T | undefined>;
