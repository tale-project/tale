/**
 * Minimal YAML emitter for a flat string→string map — enough for operator-
 * authored identity files (e.g. profile.yaml) without pulling a YAML library
 * into the Convex action bundle. Keys keep `Object.entries` order; values are
 * always double-quoted so spaces / colons / `#` stay literal.
 */

export class YamlMapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'YamlMapError';
  }
}

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function quoteYamlString(value: string): string {
  if (value.includes('\n') || value.includes('\r')) {
    throw new YamlMapError('YAML map values must be single-line');
  }
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Serialize `{ a: "x", b: "y" }` → `a: "x"\nb: "y"\n`. */
export function serializeYamlMap(map: Record<string, string>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(map)) {
    if (!KEY_RE.test(key)) {
      throw new YamlMapError(`Invalid YAML map key: ${key}`);
    }
    if (typeof value !== 'string') {
      throw new YamlMapError(`YAML map value for ${key} must be a string`);
    }
    lines.push(`${key}: ${quoteYamlString(value)}`);
  }
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}
