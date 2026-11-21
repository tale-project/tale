// How an answer travelled through the edge, for the container smoke test:
// the coding of its body and the length it declared, read from the headers
// `curl --dump-header -` prints.

/** What one answer said about its body. */
export interface Delivery {
  status: number;
  /** `Content-Encoding`, lower-cased; null when the body carries no coding. */
  coding: string | null;
  /** `Content-Length`; null when the answer streams without one. */
  length: number | null;
  /** `ETag`, as sent; null when the answer carries none. */
  etag: string | null;
}

/**
 * The answer in what `curl --dump-header -` wrote. The last block counts: an
 * interim `100 Continue` comes before the answer itself. Header names are
 * compared without case, since HTTP/2 writes them in lower case. Null when
 * the text holds no status line.
 */
export function parseDelivery(headers: string): Delivery | null {
  let delivery: Delivery | null = null;
  for (const raw of headers.split('\n')) {
    const line = raw.trimEnd();
    const status = /^HTTP\/[0-9.]+ (\d{3})\b/.exec(line);
    if (status) {
      delivery = {
        status: Number(status[1]),
        coding: null,
        length: null,
        etag: null,
      };
      continue;
    }
    if (delivery === null) continue;
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (name === 'content-encoding') delivery.coding = value.toLowerCase();
    if (name === 'content-length' && /^\d+$/.test(value))
      delivery.length = Number(value);
    if (name === 'etag') delivery.etag = value;
  }
  return delivery;
}

/** What an answer is held to. */
export interface ExpectedDelivery {
  /** The coding the body must carry; null for a body sent as it is. */
  coding: string | null;
  /** The length the answer must declare, where the test knows it. */
  length?: number;
}

/**
 * Where an answer differs from what it is held to, in words a failed check
 * prints; empty when it is as expected.
 */
export function deliveryFaults(
  delivery: Delivery | null,
  expected: ExpectedDelivery,
): string[] {
  if (delivery === null) return ['no answer'];
  const faults: string[] = [];
  if (delivery.status !== 200) faults.push(`status ${delivery.status}`);
  if (delivery.coding !== expected.coding)
    faults.push(
      `coding ${delivery.coding ?? 'none'}, expected ${expected.coding ?? 'none'}`,
    );
  if (expected.length !== undefined && delivery.length !== expected.length)
    faults.push(
      `length ${delivery.length ?? 'none'}, expected ${expected.length}`,
    );
  return faults;
}

/** One bundle of the built app with the sizes of its precompressed
 * neighbours, and one file no coding would shrink. */
export interface AppFiles {
  bundle: { name: string; bytes: number; br: number; gzip: number };
  packed: { name: string; bytes: number };
}

/**
 * A node program that prints {@link AppFiles} for the app in an image, as one
 * line of JSON: the first script that has both neighbours, and the first
 * font that is packed already. `node -e <program> [directory]`: the assets
 * of the image's own app unless a directory is named.
 */
export const APP_FILES_PROGRAM = `
const fs = require('node:fs');
const dir = process.argv[1] ?? '/app/dist/assets';
const names = fs.readdirSync(dir).sort();
const size = (name) => fs.statSync(dir + '/' + name).size;
const bundle = names.find(
  (name) =>
    name.endsWith('.js') &&
    names.includes(name + '.br') &&
    names.includes(name + '.gz'),
);
const packed = names.find((name) => name.endsWith('.woff2'));
console.log(
  JSON.stringify({
    bundle: bundle && {
      name: bundle,
      bytes: size(bundle),
      br: size(bundle + '.br'),
      gzip: size(bundle + '.gz'),
    },
    packed: packed && { name: packed, bytes: size(packed) },
  }),
);
`;

function sized(value: unknown, keys: readonly string[]): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const record: Record<string, unknown> = { ...value };
  return (
    typeof record.name === 'string' &&
    /^[A-Za-z0-9._-]+$/.test(record.name) &&
    keys.every((key) => Number.isSafeInteger(record[key]))
  );
}

/** What {@link APP_FILES_PROGRAM} printed, or null when either file is
 * missing or the line is not what the program writes. */
export function parseAppFiles(output: string): AppFiles | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output.trim());
  } catch (error) {
    console.warn('The app files program printed no JSON:', error);
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const record: Record<string, unknown> = { ...parsed };
  if (
    !sized(record.bundle, ['bytes', 'br', 'gzip']) ||
    !sized(record.packed, ['bytes'])
  )
    return null;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- both members were checked field by field above
  return record as unknown as AppFiles;
}
