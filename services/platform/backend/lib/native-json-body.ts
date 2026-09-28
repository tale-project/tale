import { parseYaml } from '../../lib/shared/config/yaml';

/**
 * A request body as a door that writes native configuration takes it: JSON,
 * refused when a key repeats. `JSON.parse` keeps the last of two same-named
 * keys, so the document a reviewer read could differ from the one written;
 * the native YAML parser (JSON is YAML) refuses the pair. `undefined` for a
 * body that is not JSON or repeats a key.
 */
export function parseNativeJsonBody(raw: string): unknown {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  return parseYaml(raw).ok ? value : undefined;
}
