const PROVIDER_NAME_REGEX = /^[a-z0-9][a-z0-9_-]*$/;

export function validateProviderName(name: string): boolean {
  return PROVIDER_NAME_REGEX.test(name);
}
