export const CUSTOM_INSTRUCTIONS_MAX_TOKENS = 800;
export const CUSTOM_INSTRUCTIONS_MAX_CHARS = CUSTOM_INSTRUCTIONS_MAX_TOKENS * 4;

export function normalizeCustomInstructions(text: string): string {
  return text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}
