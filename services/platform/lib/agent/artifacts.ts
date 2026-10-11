/**
 * Artifact naming — what a file an agent produces may be called and which
 * media type it is served as.
 *
 * One rule set for every lane that stores a produced file: the file tool's
 * typed-out files, the light sandbox's output box, the image tool. A name is
 * shown to people (download dialogs, chips) and handed back to tools, so it
 * stays a plain file name: no folders, no control characters, no leading
 * dot, bounded length — and its extension decides the type, never the
 * content the model claims.
 *
 * Layer A: pure data.
 */

/** Longest file name kept, in characters (extension included). */
export const ARTIFACT_NAME_MAX_CHARS = 120;

/**
 * The text formats `create_file` writes as typed, keyed by extension. Each
 * is served with this media type; a name with any other extension is
 * refused, because a typed-out "PDF" or "DOCX" would be a corrupt file with
 * a trusted-looking name.
 */
export const TEXT_ARTIFACT_TYPES: Readonly<Record<string, string>> = {
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  json: 'application/json',
  jsonl: 'application/x-ndjson',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  xml: 'application/xml',
  html: 'text/html',
  htm: 'text/html',
  svg: 'image/svg+xml',
  ics: 'text/calendar',
  vcf: 'text/vcard',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  ts: 'text/plain',
  py: 'text/x-python',
  sql: 'application/sql',
  sh: 'text/x-shellscript',
  mmd: 'text/plain',
  tex: 'application/x-tex',
  log: 'text/plain',
  ini: 'text/plain',
  toml: 'application/toml',
};

/**
 * Media types of the files a light sandbox commonly delivers, by extension:
 * what a stored output is served as when the sandbox reports nothing more
 * specific. Text formats share {@link TEXT_ARTIFACT_TYPES}.
 */
const BINARY_ARTIFACT_TYPES: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  zip: 'application/zip',
  epub: 'application/epub+zip',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
};

/** The lower-cased extension of `name`, without the dot; `''` when none. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

/** The media type a produced file named `name` is served as. */
export function artifactMediaType(name: string): string {
  const extension = extensionOf(name);
  return (
    TEXT_ARTIFACT_TYPES[extension] ??
    BINARY_ARTIFACT_TYPES[extension] ??
    'application/octet-stream'
  );
}

/**
 * `raw` as a safe, plain file name, or `null` when nothing usable is left.
 * Folders are dropped (only the last segment counts), control and
 * reserved characters become `-`, runs of whitespace collapse, and a name
 * over {@link ARTIFACT_NAME_MAX_CHARS} keeps its extension and loses the
 * middle of its stem.
 */
export function safeArtifactName(raw: string): string | null {
  const last = raw.split(/[\\/]/).at(-1) ?? '';
  const cleaned = last
    // oxlint-disable-next-line no-control-regex -- the point is to replace control characters
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  if (cleaned === '' || cleaned === '-') return null;
  if (cleaned.length <= ARTIFACT_NAME_MAX_CHARS) return cleaned;
  const extension = extensionOf(cleaned);
  const tail = extension === '' ? '' : `.${extension}`;
  const stem = cleaned.slice(0, cleaned.length - tail.length);
  const room = ARTIFACT_NAME_MAX_CHARS - tail.length;
  if (room < 8) return cleaned.slice(0, ARTIFACT_NAME_MAX_CHARS);
  return `${stem.slice(0, room).trimEnd()}${tail}`;
}

/**
 * The name `wanted` would get among `taken` names: unchanged when free,
 * else `stem (2).ext`, `stem (3).ext`, … — the way a download folder names a
 * second file of the same name, so two outputs of one turn never shadow
 * each other.
 */
export function uniqueArtifactName(
  wanted: string,
  taken: ReadonlySet<string>,
): string {
  if (!taken.has(wanted)) return wanted;
  const extension = extensionOf(wanted);
  const tail = extension === '' ? '' : `.${extension}`;
  const stem = wanted.slice(0, wanted.length - tail.length);
  for (let index = 2; ; index++) {
    const candidate = `${stem} (${index})${tail}`;
    if (!taken.has(candidate)) return candidate;
  }
}
