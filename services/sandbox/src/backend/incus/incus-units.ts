// Sizes as Incus reads them. The spawner's own limits are Docker quantities
// ('4g', '1500m'); Incus wants `4GiB`, `1500MiB`.

const INCUS_SIZE_RE = /^([1-9][0-9]*)(B|kB|MB|GB|TB|KiB|MiB|GiB|TiB)$/;
const DOCKER_SIZE_RE = /^([1-9][0-9]*)([bkmg]?)$/i;

const DOCKER_UNITS: Record<string, string> = {
  '': 'B',
  b: 'B',
  k: 'KiB',
  m: 'MiB',
  g: 'GiB',
};

/**
 * A size Incus accepts (`10GiB`, `512MiB`), from either its own syntax or a
 * Docker quantity (`10g`, `512m`, plain bytes); undefined for anything else,
 * zero included. A Docker `g` is a gibibyte, as it is for `docker run`.
 */
export function toIncusSize(quantity: string): string | undefined {
  const text = quantity.trim();
  if (INCUS_SIZE_RE.test(text)) return text;
  const docker = DOCKER_SIZE_RE.exec(text);
  if (docker === null) return undefined;
  const unit = DOCKER_UNITS[(docker[2] ?? '').toLowerCase()];
  return unit === undefined ? undefined : `${docker[1]}${unit}`;
}
