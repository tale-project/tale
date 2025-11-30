/**
 * Stringify and formatting utilities for workflow modules
 * - No try/catch; implementations are defensive by design
 */

export const safeStringify = (value: unknown, maxLen = 1800): string => {
  const seen = new WeakSet<object>();
  const text =
    JSON.stringify(value, (key, val) => {
      if (typeof val === 'bigint') return val.toString();
      if (typeof val === 'object' && val !== null) {
        const obj = val as object;
        if (seen.has(obj)) return '[Circular]';
        seen.add(obj);
      }
      return val as unknown;
    }) ?? '<unserializable>';
  return text.length > maxLen ? text.slice(0, maxLen) : text;
};
