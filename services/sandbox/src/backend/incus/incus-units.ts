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

const INCUS_SIZE_BYTES: Record<string, number> = {
  B: 1,
  kB: 1000,
  MB: 1000 ** 2,
  GB: 1000 ** 3,
  TB: 1000 ** 4,
  KiB: 1024,
  MiB: 1024 ** 2,
  GiB: 1024 ** 3,
  TiB: 1024 ** 4,
};

/** The bytes in a size, in Incus's syntax or a Docker quantity; undefined for
 * anything else (a percentage, zero, a unit this backend never writes). */
export function incusSizeBytes(size: string): number | undefined {
  const incus = toIncusSize(size);
  if (incus === undefined) return undefined;
  const match = INCUS_SIZE_RE.exec(incus);
  const unit = INCUS_SIZE_BYTES[match?.[2] ?? ''];
  return match === null || unit === undefined
    ? undefined
    : Number(match[1]) * unit;
}
