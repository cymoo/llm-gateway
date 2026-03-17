export const MODEL_ALIAS_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export function validateModelAlias(alias: string): boolean {
  if (!alias || alias.length < 1 || alias.length > 100) return false;
  return MODEL_ALIAS_PATTERN.test(alias);
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
