// `/` and `-` are escaped so `.source` stays valid when reused as an HTML
// `pattern` attribute: browsers compile that attribute with the RegExp `v`
// flag, which rejects both characters unescaped inside a character class.
// An invalid `pattern` is silently ignored per spec, disabling validation.
export const MODEL_ALIAS_PATTERN = /^[a-z0-9]([a-z0-9._\/\-]*[a-z0-9])?$/;
export const ADMIN_PASSWORD_PATTERN = /^[\x21-\x7e]+$/;

export function validateModelAlias(alias: string): boolean {
  if (!alias || alias.length < 1 || alias.length > 100) return false;
  return MODEL_ALIAS_PATTERN.test(alias);
}

export function validateAdminPassword(password: string): boolean {
  if (!password || password.length < 8 || password.length > 128) return false;
  return ADMIN_PASSWORD_PATTERN.test(password);
}

export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validateUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export const MODEL_TYPES = ["chat", "embedding", "rerank"] as const;
export type ModelType = (typeof MODEL_TYPES)[number];

export function validateModelType(type: string): boolean {
  return (MODEL_TYPES as readonly string[]).includes(type);
}
