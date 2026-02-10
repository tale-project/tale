/**
 * Stringify and formatting utilities for workflow modules
 * - No try/catch; implementations are defensive by design
 */

export const safeStringify = (value: unknown, maxLen = 1800): string => {
  const seen = new WeakSet();
  const text =
    JSON.stringify(value, (_key, val) => {
      if (typeof val === 'bigint') return val.toString();
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val)) return '[Circular]';
        seen.add(val);
      }
      return val;
    }) ?? '<unserializable>';
  return text.length > maxLen ? text.slice(0, maxLen) : text;
};
