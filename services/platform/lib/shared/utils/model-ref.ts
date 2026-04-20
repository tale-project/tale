interface ParsedModelRef {
  providerName?: string;
  modelId: string;
}

const PROVIDER_PREFIX_RE = /^[a-z0-9_-]{1,64}$/;

export function parseModelRef(ref: string): ParsedModelRef {
  const trimmed = ref.trim();
  if (!trimmed) {
    throw new Error('Model ref must be non-empty');
  }
  if (trimmed.startsWith(':') || trimmed.endsWith(':')) {
    throw new Error(`Invalid model ref "${ref}": cannot start or end with ":"`);
  }
  const colon = trimmed.indexOf(':');
  if (colon > 0) {
    const prefix = trimmed.slice(0, colon).toLowerCase();
    const modelId = trimmed.slice(colon + 1);
    if (PROVIDER_PREFIX_RE.test(prefix) && modelId) {
      return { providerName: prefix, modelId };
    }
  }
  return { modelId: trimmed };
}

export function formatModelRef({
  providerName,
  modelId,
}: ParsedModelRef): string {
  return providerName ? `${providerName}:${modelId}` : modelId;
}

export function stripModelRefQualifier(ref: string): string {
  return parseModelRef(ref).modelId;
}

export function isValidModelRef(ref: string): boolean {
  try {
    parseModelRef(ref);
    return true;
  } catch {
    return false;
  }
}
