export const MODEL_ALIAS_PATTERN = /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/;
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
