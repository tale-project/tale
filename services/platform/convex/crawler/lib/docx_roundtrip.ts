'use node';

/**
 * DOCX round-trip — extract structured JSON from a DOCX and apply text
 * modifications back, optionally as tracked changes.
 *
 * Faithful port of `services/crawler/app/services/docx_roundtrip_service.py`
 * (python-docx + lxml) and `docx_track_changes.py`. python-docx mutated `w:t`
 * elements in-place to preserve bookmarks, comments, and non-run XML children;
 * here we parse `word/document.xml` with `fast-xml-parser` in `preserveOrder`
 * mode (the same reader the platform's OOXML extractor uses), mutate the parsed
 * tree, and re-serialise with `XMLBuilder`. preserveOrder keeps every child node
 * (pPr, bookmarks, hyperlinks, sdt, …) in position, so non-text structure is
 * preserved exactly as the python-docx in-place edit did.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FIDELITY ASSUMPTIONS / TODO(verify) — the track-changes path is the highest
 * fidelity risk and has NOT been validated against Word with a real fixture:
 *
 *   1. // TODO(verify): paragraph/table KEY generation is reproduced 1:1 from
 *      the Python iterator (`p_{n}` for body paragraphs incl. sdt paragraphs;
 *      `tbl_{n}_r{R}_c{C}_p{P}` for table-cell paragraphs; the `p_counter` is
 *      ALSO incremented for table-cell paragraphs, exactly as the Python does —
 *      a subtle off-by-one-shared-counter detail that MUST match or apply keys
 *      won't line up with extract keys). Covered by unit tests below.
 *
 *   2. // TODO(verify): the source-hash is `sha256(file_bytes)` hex, identical
 *      to Python's `_compute_hash`, so an extract→apply round-trip validates.
 *
 *   3. // TODO(verify): word-level diff uses a Myers/LCS opcode computation that
 *      reproduces `difflib.SequenceMatcher.get_opcodes()` semantics (equal/
 *      replace/delete/insert spans over whitespace-preserving word tokens) and
 *      the same `ratio() < 0.3` whole-paragraph del+ins fallback. The exact
 *      run-splitting on partial-overlap is ported; byte-identical OOXML revision
 *      markup vs python-lxml is NOT guaranteed (attribute order, rsid values are
 *      random). Word renders equivalent tracked changes; flag if a downstream
 *      consumer diffs the raw XML.
 *
 *   4. // TODO(verify): outline-level → heading detection reads `w:outlineLvl`
 *      from direct `w:pPr` only (NOT the style definition, which python-docx
 *      could also consult via the style part). Headings authored purely through
 *      a named style without a direct outlineLvl will not split semantic groups.
 *      Acceptable: grouping is a batching hint, not a correctness boundary.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createHash } from 'node:crypto';

import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import JSZip from 'jszip';

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
const MAX_PARAGRAPHS = 5000;
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

const RISKY_TAGS = new Set([
  'hyperlink',
  'fldChar',
  'fldSimple',
  'ins',
  'del',
  'sdt',
]);
const CAUTION_TAGS = new Set(['commentRangeStart', 'commentRangeEnd']);
const SAFE_TAGS = new Set(['bookmarkStart', 'bookmarkEnd']);

const MAX_GROUP_SIZE = 10;
const MIN_GROUP_SIZE = 5;
const MAX_OUTLINE_LEVEL = 2;

type XmlNode = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
  trimValues: false,
});

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  preserveOrder: true,
  suppressEmptyNode: false,
});

export interface LightweightParagraph {
  key: string;
  text: string;
  editable: boolean;
  style: string | null;
}

export interface ExtractStructuredMetadata {
  paragraph_count: number;
  table_count: number;
  group_count: number;
}

export interface ExtractDocxStructuredResult {
  source_hash: string;
  metadata: ExtractStructuredMetadata;
  lightweight: LightweightParagraph[];
  groups: LightweightParagraph[][];
}

export interface DocxModification {
  key: string;
  text: string;
}

export interface ApplyReport {
  total_modifications_requested: number;
  applied: number;
  success: boolean;
  skipped_not_editable: string[];
  skipped_unknown_key: string[];
  skipped_no_change: string[];
  skipped_non_text_content: string[];
  format_simplified: string[];
  errors: Array<{ key: string; error: string }>;
}

export interface ApplyDocxStructuredResult {
  bytes: Uint8Array<ArrayBuffer>;
  report: ApplyReport;
}

// ───────────────────────── XML node helpers ─────────────────────────

function localName(tag: string): string {
  const idx = tag.indexOf(':');
  return idx === -1 ? tag : tag.slice(idx + 1);
}

/** The tag name of a preserveOrder node (first non-meta key), or ''. */
function tagOf(node: XmlNode): string {
  for (const key of Object.keys(node)) {
    if (key !== ':@' && key !== '#text') {
      return key;
    }
  }
  return '';
}

/** The child-array of a preserveOrder node. Mutating it mutates the tree. */
function childrenOf(node: XmlNode): XmlNode[] {
  for (const key of Object.keys(node)) {
    if (key === ':@' || key === '#text') {
      continue;
    }
    const value = node[key];
    if (Array.isArray(value)) {
      return value;
    }
  }
  return [];
}

/** Replace the child-array of a preserveOrder node in place. */
function setChildren(node: XmlNode, newChildren: XmlNode[]): void {
  for (const key of Object.keys(node)) {
    if (key === ':@' || key === '#text') {
      continue;
    }
    if (Array.isArray(node[key])) {
      node[key] = newChildren;
      return;
    }
  }
}

function attrs(node: XmlNode): Record<string, string> {
  const meta = node[':@'];
  if (meta !== null && typeof meta === 'object') {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(meta)) {
      out[k] = String(v);
    }
    return out;
  }
  return {};
}

function setAttr(node: XmlNode, name: string, value: string): void {
  const meta = node[':@'];
  if (meta !== null && typeof meta === 'object') {
    Reflect.set(meta, name, value);
  } else {
    node[':@'] = { [name]: value };
  }
}

/** Find direct children matching a local tag name. */
function childrenWithTag(node: XmlNode, local: string): XmlNode[] {
  return childrenOf(node).filter((c) => localName(tagOf(c)) === local);
}

/** Concatenate text from all `w:t` descendants of a node. */
function elementText(node: XmlNode): string {
  let text = '';
  const walk = (n: XmlNode): void => {
    if (localName(tagOf(n)) === 't') {
      for (const child of childrenOf(n)) {
        if (typeof child['#text'] === 'string') {
          text += child['#text'];
        }
      }
      return;
    }
    for (const child of childrenOf(n)) {
      walk(child);
    }
  };
  walk(node);
  return text;
}

// ───────────────────────── safety + hashing ─────────────────────────

function computeHash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function checkFileSafety(bytes: Uint8Array, filename?: string): void {
  if (bytes.length > MAX_FILE_SIZE) {
    throw new Error(
      `File too large: ${bytes.length} bytes (max ${MAX_FILE_SIZE})`,
    );
  }
  if (
    bytes.length >= OLE_MAGIC.length &&
    Buffer.from(bytes.subarray(0, OLE_MAGIC.length)).equals(OLE_MAGIC)
  ) {
    throw new Error(
      'Encrypted or legacy .doc file detected (OLE Compound Document)',
    );
  }
  if (filename && filename.toLowerCase().endsWith('.docm')) {
    throw new Error('Macro-enabled .docm files are not supported');
  }
}

// ───────────────────────── classification ─────────────────────────

/** Whether a run contains a drawing or a page break (non-text content). */
function runHasNonTextContent(runNode: XmlNode): boolean {
  for (const child of childrenOf(runNode)) {
    const local = localName(tagOf(child));
    if (local === 'drawing') {
      return true;
    }
    if (local === 'br' && attrs(child)['@_w:type'] === 'page') {
      return true;
    }
  }
  return false;
}

/** Classify a paragraph: returns whether it is safely editable. */
function classifyParagraph(paraNode: XmlNode): boolean {
  let hasRisky = false;
  for (const child of childrenOf(paraNode)) {
    const local = localName(tagOf(child));
    if (RISKY_TAGS.has(local)) {
      hasRisky = true;
    } else if (CAUTION_TAGS.has(local) || SAFE_TAGS.has(local)) {
      // Caution/safe tags are tolerated (detected but not blocking).
    }
  }
  for (const runNode of childrenWithTag(paraNode, 'r')) {
    if (runHasNonTextContent(runNode)) {
      hasRisky = true;
    }
  }
  return !hasRisky;
}

/** Read a paragraph's outline level from direct pPr, or null. */
function outlineLevel(paraNode: XmlNode): number | null {
  for (const child of childrenOf(paraNode)) {
    if (localName(tagOf(child)) === 'pPr') {
      for (const prop of childrenOf(child)) {
        if (localName(tagOf(prop)) === 'outlineLvl') {
          const val = attrs(prop)['@_w:val'];
          if (val !== undefined) {
            const n = Number(val);
            return Number.isNaN(n) ? null : n;
          }
        }
      }
    }
  }
  return null;
}

/** Read a paragraph's style id from direct pPr's pStyle, or null. */
function paragraphStyle(paraNode: XmlNode): string | null {
  for (const child of childrenOf(paraNode)) {
    if (localName(tagOf(child)) === 'pPr') {
      for (const prop of childrenOf(child)) {
        if (localName(tagOf(prop)) === 'pStyle') {
          const val = attrs(prop)['@_w:val'];
          return val ?? null;
        }
      }
    }
  }
  return null;
}

// ───────────────────────── body iteration ─────────────────────────

interface BodyEntry {
  tag: 'p' | 'sdt_p' | 'tbl' | 'sdt_tbl';
  element: XmlNode;
}

/** Find the `w:body` node's children array. */
function findBodyChildren(tree: XmlNode[]): XmlNode[] {
  let result: XmlNode[] = [];
  const walk = (nodes: XmlNode[]): void => {
    for (const node of nodes) {
      if (localName(tagOf(node)) === 'body') {
        result = childrenOf(node);
        return;
      }
      walk(childrenOf(node));
    }
  };
  walk(tree);
  return result;
}

/** Iterate body elements, yielding p/tbl + sdt-nested p/tbl. Mirrors `_iter_body_elements`. */
function iterBodyElements(body: XmlNode[]): BodyEntry[] {
  const out: BodyEntry[] = [];
  for (const element of body) {
    const tag = localName(tagOf(element));
    if (tag === 'p') {
      out.push({ tag: 'p', element });
    } else if (tag === 'tbl') {
      out.push({ tag: 'tbl', element });
    } else if (tag === 'sdt') {
      for (const child of childrenOf(element)) {
        if (localName(tagOf(child)) === 'sdtContent') {
          for (const inner of childrenOf(child)) {
            const innerTag = localName(tagOf(inner));
            if (innerTag === 'p') {
              out.push({ tag: 'sdt_p', element: inner });
            } else if (innerTag === 'tbl') {
              out.push({ tag: 'sdt_tbl', element: inner });
            }
          }
        }
      }
    }
  }
  return out;
}

// ───────────────────────── semantic grouping ─────────────────────────

/** Group editable paragraphs into semantic batches. Mirrors `compute_semantic_groups`. */
function computeSemanticGroups(
  lightweight: LightweightParagraph[],
  headingLevels: Map<string, number>,
): LightweightParagraph[][] {
  const groups: LightweightParagraph[][] = [];
  let current: LightweightParagraph[] = [];

  for (const entry of lightweight) {
    if (!entry.editable) {
      continue;
    }
    const level = headingLevels.get(entry.key);
    const isSplitHeading = level !== undefined && level <= MAX_OUTLINE_LEVEL;

    if (isSplitHeading && current.length >= MIN_GROUP_SIZE) {
      groups.push(current);
      current = [];
    }
    current.push(entry);
    if (current.length >= MAX_GROUP_SIZE) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length > 0) {
    groups.push(current);
  }
  return groups;
}

// ───────────────────────── extract ─────────────────────────

/** Extract structured paragraph data from DOCX bytes. Mirrors `extract_structured`. */
export async function extractStructured(
  bytes: Uint8Array,
  filename?: string,
): Promise<ExtractDocxStructuredResult> {
  checkFileSafety(bytes, filename);

  const sourceHash = computeHash(bytes);
  const zip = await JSZip.loadAsync(bytes);
  const docFile = zip.file('word/document.xml');
  if (!docFile) {
    throw new Error('Invalid DOCX: missing word/document.xml');
  }
  const documentXml = await docFile.async('string');
  const tree: XmlNode[] = parser.parse(documentXml);
  const body = findBodyChildren(tree);

  const lightweight: LightweightParagraph[] = [];
  const headingLevels = new Map<string, number>();
  let pCounter = 0;
  let tblCounter = 0;

  for (const { tag, element } of iterBodyElements(body)) {
    if (tag === 'p' || tag === 'sdt_p') {
      const key = `p_${pCounter}`;
      pCounter += 1;

      const text = elementText(element);
      const style = paragraphStyle(element);

      const level = outlineLevel(element);
      if (level !== null) {
        headingLevels.set(key, level);
      }

      if (tag === 'sdt_p' || text.trim().length === 0) {
        lightweight.push({ key, text, editable: false, style });
      } else {
        lightweight.push({
          key,
          text,
          editable: classifyParagraph(element),
          style,
        });
      }
    } else {
      const tblKey = `tbl_${tblCounter}`;
      tblCounter += 1;
      const trs = childrenWithTag(element, 'tr');
      trs.forEach((tr, rowIdx) => {
        const tcs = childrenWithTag(tr, 'tc');
        tcs.forEach((tc, colIdx) => {
          const ps = childrenWithTag(tc, 'p');
          ps.forEach((pEl, pIdx) => {
            const cellKey = `${tblKey}_r${rowIdx}_c${colIdx}_p${pIdx}`;
            pCounter += 1;
            const text = elementText(pEl);
            const style = paragraphStyle(pEl);
            if (text.trim().length === 0) {
              lightweight.push({ key: cellKey, text, editable: false, style });
            } else {
              lightweight.push({
                key: cellKey,
                text,
                editable: classifyParagraph(pEl),
                style,
              });
            }
          });
        });
      });
    }
  }

  if (pCounter > MAX_PARAGRAPHS) {
    throw new Error(
      `Document has ${pCounter} paragraphs (max ${MAX_PARAGRAPHS}). Consider splitting the document.`,
    );
  }

  const groups = computeSemanticGroups(lightweight, headingLevels);

  return {
    source_hash: sourceHash,
    metadata: {
      paragraph_count: pCounter,
      table_count: tblCounter,
      group_count: groups.length,
    },
    lightweight,
    groups,
  };
}

// ───────────────────────── apply ─────────────────────────

function emptyReport(total: number): ApplyReport {
  return {
    total_modifications_requested: total,
    applied: 0,
    success: false,
    skipped_not_editable: [],
    skipped_unknown_key: [],
    skipped_no_change: [],
    skipped_non_text_content: [],
    format_simplified: [],
    errors: [],
  };
}

/** Runs (`w:r`) directly under a paragraph. */
function paragraphRuns(paraNode: XmlNode): XmlNode[] {
  return childrenWithTag(paraNode, 'r');
}

/** Replace a run's text via its first `w:t`, mirroring run.text setter. */
function setRunText(runNode: XmlNode, text: string): void {
  for (const child of childrenOf(runNode)) {
    if (localName(tagOf(child)) === 't') {
      setChildren(child, [{ '#text': text }]);
      if (
        text.length > 0 &&
        (text[0] === ' ' || text[text.length - 1] === ' ')
      ) {
        setAttr(child, '@_xml:space', 'preserve');
      }
      return;
    }
  }
}

/**
 * Replace paragraph text in-place: set new text on first run, clear remaining
 * runs' text. Preserves all XML structure. Mirrors `_replace_paragraph_text`.
 */
function replaceParagraphText(paraNode: XmlNode, newText: string): void {
  const runs = paragraphRuns(paraNode);
  if (runs.length === 0) {
    return;
  }
  setRunText(runs[0], newText);
  for (let i = 1; i < runs.length; i += 1) {
    setRunText(runs[i], '');
  }
}

interface ParaApplyOutcome {
  result:
    | 'applied'
    | 'not_editable'
    | 'no_change'
    | 'non_text_content'
    | 'error'
    | 'no_runs';
  formatSimplified?: boolean;
  errorMessage?: string;
}

/** Apply a single modification to a paragraph node. Returns the outcome. */
function applyToParagraph(
  paraNode: XmlNode,
  newText: string,
  trackChanges: TrackChangesWriter | null,
): ParaApplyOutcome {
  const oldText = elementText(paraNode);
  if (oldText.trim().length === 0) {
    return { result: 'not_editable' };
  }
  if (!classifyParagraph(paraNode)) {
    return { result: 'not_editable' };
  }
  if (oldText === newText) {
    return { result: 'no_change' };
  }
  const runs = paragraphRuns(paraNode);
  if (runs.length === 0) {
    return { result: 'error', errorMessage: 'paragraph has no runs' };
  }
  for (const run of runs) {
    if (runHasNonTextContent(run)) {
      return { result: 'non_text_content' };
    }
  }
  try {
    if (trackChanges) {
      trackChanges.applyParagraphChange(paraNode, oldText, newText);
      return { result: 'applied' };
    }
    const formatSimplified = runs.length > 1;
    replaceParagraphText(paraNode, newText);
    return { result: 'applied', formatSimplified };
  } catch (err) {
    return {
      result: 'error',
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

function recordOutcome(
  report: ApplyReport,
  key: string,
  outcome: ParaApplyOutcome,
): void {
  switch (outcome.result) {
    case 'applied':
      if (outcome.formatSimplified) {
        report.format_simplified.push(key);
      }
      report.applied += 1;
      break;
    case 'not_editable':
      report.skipped_not_editable.push(key);
      break;
    case 'no_change':
      report.skipped_no_change.push(key);
      break;
    case 'non_text_content':
      report.skipped_non_text_content.push(key);
      break;
    case 'no_runs':
    case 'error':
      report.errors.push({
        key,
        error: outcome.errorMessage ?? 'paragraph has no runs',
      });
      break;
    default:
      break;
  }
}

/** Apply text modifications to a DOCX template. Mirrors `apply_structured`. */
export async function applyStructured(
  templateBytes: Uint8Array,
  sourceHash: string,
  modifications: DocxModification[],
  options: { trackChanges?: boolean; author?: string } = {},
): Promise<ApplyDocxStructuredResult> {
  const actualHash = computeHash(templateBytes);
  if (actualHash !== sourceHash) {
    throw new Error(
      `Source hash mismatch: expected ${sourceHash.slice(0, 16)}..., got ${actualHash.slice(0, 16)}.... The template file may have been modified.`,
    );
  }

  const zip = await JSZip.loadAsync(templateBytes);
  const docFile = zip.file('word/document.xml');
  if (!docFile) {
    throw new Error('Invalid DOCX: missing word/document.xml');
  }
  const documentXml = await docFile.async('string');
  const tree: XmlNode[] = parser.parse(documentXml);
  const body = findBodyChildren(tree);

  const modLookup = new Map<string, string>();
  for (const mod of modifications) {
    if (
      typeof mod.key === 'string' &&
      mod.key.length > 0 &&
      typeof mod.text === 'string'
    ) {
      modLookup.set(mod.key, mod.text);
    }
  }

  const report = emptyReport(modifications.length);
  const seenKeys = new Set<string>();

  const trackWriter = options.trackChanges
    ? new TrackChangesWriter(tree, options.author ?? 'AI Assistant')
    : null;

  let pCounter = 0;
  let tblCounter = 0;

  for (const { tag, element } of iterBodyElements(body)) {
    if (tag === 'p' || tag === 'sdt_p') {
      const key = `p_${pCounter}`;
      pCounter += 1;
      if (!modLookup.has(key)) {
        continue;
      }
      seenKeys.add(key);
      if (tag === 'sdt_p') {
        report.skipped_not_editable.push(key);
        continue;
      }
      const newText = modLookup.get(key) ?? '';
      recordOutcome(
        report,
        key,
        applyToParagraph(element, newText, trackWriter),
      );
    } else {
      const tblKey = `tbl_${tblCounter}`;
      tblCounter += 1;
      const trs = childrenWithTag(element, 'tr');
      trs.forEach((tr, rowIdx) => {
        const tcs = childrenWithTag(tr, 'tc');
        tcs.forEach((tc, colIdx) => {
          const ps = childrenWithTag(tc, 'p');
          ps.forEach((pEl, pIdx) => {
            const cellKey = `${tblKey}_r${rowIdx}_c${colIdx}_p${pIdx}`;
            pCounter += 1;
            if (!modLookup.has(cellKey)) {
              return;
            }
            seenKeys.add(cellKey);
            const newText = modLookup.get(cellKey) ?? '';
            recordOutcome(
              report,
              cellKey,
              applyToParagraph(pEl, newText, trackWriter),
            );
          });
        });
      });
    }
  }

  for (const key of modLookup.keys()) {
    if (!seenKeys.has(key)) {
      report.skipped_unknown_key.push(key);
    }
  }

  report.success = report.applied > 0 || modLookup.size === 0;

  const newDocumentXml = builder.build(tree);
  zip.file('word/document.xml', newDocumentXml);

  if (trackWriter && report.applied > 0) {
    await trackWriter.registerRsid(zip);
  }

  // ArrayBuffer-backed Uint8Array — see `docx_generate.ts` for rationale.
  const outBuffer = await zip.generateAsync({ type: 'arraybuffer' });
  return { bytes: new Uint8Array(outBuffer), report };
}

// ───────────────────────── track changes ─────────────────────────

/** Split text into word tokens, preserving whitespace runs as tokens. */
function tokenizeWords(text: string): string[] {
  const tokens: string[] = [];
  const re = /\S+|\s+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    tokens.push(match[0]);
  }
  return tokens;
}

type Opcode = [
  'equal' | 'replace' | 'delete' | 'insert',
  number,
  number,
  number,
  number,
];

/**
 * Compute difflib-style opcodes over two token arrays via LCS. Produces the
 * same equal/replace/delete/insert spans `SequenceMatcher.get_opcodes()` yields
 * (grouping adjacent delete+insert into a single `replace`).
 */
function getOpcodes(a: string[], b: string[]): Opcode[] {
  const n = a.length;
  const m = b.length;
  // LCS length table.
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  // Backtrack into matching blocks (i, j) pairs that are equal.
  const matches: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      matches.push([i, j]);
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }

  // Convert matching blocks into opcodes.
  const ops: Opcode[] = [];
  let ai = 0;
  let bj = 0;
  let k = 0;
  while (k < matches.length) {
    const [ms, ns] = matches[k];
    // Coalesce a contiguous run of matches into one equal block.
    let me = ms;
    let ne = ns;
    let k2 = k;
    while (
      k2 + 1 < matches.length &&
      matches[k2 + 1][0] === me + 1 &&
      matches[k2 + 1][1] === ne + 1
    ) {
      k2 += 1;
      me = matches[k2][0];
      ne = matches[k2][1];
    }
    // Gap before the equal block.
    if (ai < ms || bj < ns) {
      pushGapOp(ops, ai, ms, bj, ns);
    }
    ops.push(['equal', ms, me + 1, ns, ne + 1]);
    ai = me + 1;
    bj = ne + 1;
    k = k2 + 1;
  }
  if (ai < n || bj < m) {
    pushGapOp(ops, ai, n, bj, m);
  }
  return ops;
}

function pushGapOp(
  ops: Opcode[],
  i1: number,
  i2: number,
  j1: number,
  j2: number,
): void {
  if (i2 > i1 && j2 > j1) {
    ops.push(['replace', i1, i2, j1, j2]);
  } else if (i2 > i1) {
    ops.push(['delete', i1, i2, j1, j2]);
  } else if (j2 > j1) {
    ops.push(['insert', i1, i2, j1, j2]);
  }
}

/**
 * SequenceMatcher.ratio() — 2*M/T where M is the number of matched characters
 * (LCS length over the two character sequences) and T is the combined length.
 */
function similarityRatio(a: string, b: string): number {
  const total = a.length + b.length;
  if (total === 0) {
    return 1;
  }
  const n = a.length;
  const m = b.length;
  const dp = new Array<number>(m + 1).fill(0);
  for (let i = 0; i < n; i += 1) {
    let prev = 0;
    for (let j = 0; j < m; j += 1) {
      const tmp = dp[j + 1];
      dp[j + 1] = a[i] === b[j] ? prev + 1 : Math.max(dp[j + 1], dp[j]);
      prev = tmp;
    }
  }
  return (2 * dp[m]) / total;
}

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** Generates OOXML Track Changes markup for modified paragraphs. */
class TrackChangesWriter {
  private readonly author: string;
  private readonly date: string;
  private nextId: number;
  private readonly rsid: string;

  constructor(tree: XmlNode[], author: string) {
    this.author = author;
    this.date = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    this.nextId = this.scanMaxId(tree) + 1;
    this.rsid = createHash('sha256')
      .update(`${Date.now()}-${Math.random()}`)
      .digest('hex')
      .slice(0, 8)
      .toUpperCase();
  }

  private scanMaxId(nodes: XmlNode[]): number {
    let maxId = 0;
    const walk = (list: XmlNode[]): void => {
      for (const node of list) {
        const val = attrs(node)['@_w:id'];
        if (val !== undefined) {
          const n = Number(val);
          if (!Number.isNaN(n)) {
            maxId = Math.max(maxId, n);
          }
        }
        walk(childrenOf(node));
      }
    };
    walk(nodes);
    return maxId;
  }

  private allocId(): string {
    const id = String(this.nextId);
    this.nextId += 1;
    return id;
  }

  /** Copy a run's rPr node (or null). */
  private rprCopy(runNode: XmlNode): XmlNode | null {
    for (const child of childrenOf(runNode)) {
      if (localName(tagOf(child)) === 'rPr') {
        return structuredClone(child);
      }
    }
    return null;
  }

  /** Build a `w:r` with optional rPr + text (as w:t or w:delText). */
  private makeRun(text: string, rpr: XmlNode | null, isDel: boolean): XmlNode {
    const tNode: XmlNode = isDel
      ? { 'w:delText': [{ '#text': text }] }
      : { 'w:t': [{ '#text': text }] };
    if (text.length > 0 && (text[0] === ' ' || text[text.length - 1] === ' ')) {
      setAttr(tNode, '@_xml:space', 'preserve');
    }
    const runChildren: XmlNode[] = [];
    if (rpr) {
      runChildren.push(rpr);
    }
    runChildren.push(tNode);
    const run: XmlNode = { 'w:r': runChildren };
    setAttr(run, '@_w:rsidR', this.rsid);
    return run;
  }

  /** Wrap a run in `w:del`, converting w:t → w:delText. */
  private wrapDel(runNode: XmlNode): XmlNode {
    const copy = structuredClone(runNode);
    const convert = (n: XmlNode): void => {
      for (const child of childrenOf(n)) {
        if (localName(tagOf(child)) === 't') {
          const text = (() => {
            let t = '';
            for (const c of childrenOf(child)) {
              if (typeof c['#text'] === 'string') {
                t += c['#text'];
              }
            }
            return t;
          })();
          delete child['w:t'];
          child['w:delText'] = [{ '#text': text }];
          if (
            text.length > 0 &&
            (text[0] === ' ' || text[text.length - 1] === ' ')
          ) {
            setAttr(child, '@_xml:space', 'preserve');
          }
        } else {
          convert(child);
        }
      }
    };
    convert(copy);
    const del: XmlNode = { 'w:del': [copy] };
    setAttr(del, '@_w:id', this.allocId());
    setAttr(del, '@_w:author', this.author);
    setAttr(del, '@_w:date', this.date);
    return del;
  }

  /** Wrap a run in `w:ins`. */
  private wrapIns(runNode: XmlNode): XmlNode {
    const ins: XmlNode = { 'w:ins': [runNode] };
    setAttr(ins, '@_w:id', this.allocId());
    setAttr(ins, '@_w:author', this.author);
    setAttr(ins, '@_w:date', this.date);
    return ins;
  }

  /** Apply a tracked change to a paragraph using word-level diff. */
  applyParagraphChange(
    paraNode: XmlNode,
    oldText: string,
    newText: string,
  ): void {
    const originalRuns = paragraphRuns(paraNode);
    if (originalRuns.length === 0) {
      return;
    }
    const defaultRpr = this.rprCopy(originalRuns[0]);

    const ratio = similarityRatio(oldText, newText);
    if (ratio < 0.3) {
      this.applyWholeParagraphChange(
        paraNode,
        originalRuns,
        newText,
        defaultRpr,
      );
      return;
    }

    const oldTokens = tokenizeWords(oldText);
    const newTokens = tokenizeWords(newText);
    const opcodes = getOpcodes(oldTokens, newTokens);

    // Preserve non-run, non-pPr children in original relative order.
    const preserved: XmlNode[] = [];
    let pPrNode: XmlNode | null = null;
    for (const child of childrenOf(paraNode)) {
      const local = localName(tagOf(child));
      if (local === 'pPr') {
        pPrNode = child;
      } else if (local !== 'r') {
        preserved.push(child);
      }
    }

    // Character ranges covered by each original run's w:t text.
    const runRanges: Array<{ start: number; end: number; run: XmlNode }> = [];
    let charPos = 0;
    for (const run of originalRuns) {
      const runText = elementText(run);
      runRanges.push({ start: charPos, end: charPos + runText.length, run });
      charPos += runText.length;
    }

    // Token → character start map.
    const tokenStarts: number[] = [];
    let pos = 0;
    for (const tok of oldTokens) {
      tokenStarts.push(pos);
      pos += tok.length;
    }

    const newChildren: XmlNode[] = [];
    const emitOldRange = (
      startChar: number,
      endChar: number,
      wrap: 'keep' | 'del',
    ): void => {
      for (const { start, end, run } of runRanges) {
        if (end > startChar && start < endChar) {
          const overlapStart = Math.max(start, startChar);
          const overlapEnd = Math.min(end, endChar);
          const fullText = elementText(run);
          if (overlapStart === start && overlapEnd === end) {
            const node = structuredClone(run);
            newChildren.push(wrap === 'del' ? this.wrapDel(node) : node);
          } else {
            const localStart = overlapStart - start;
            const localEnd = overlapEnd - start;
            const partial = fullText.slice(localStart, localEnd);
            if (partial) {
              const rpr = this.rprCopy(run);
              const partialRun = this.makeRun(partial, rpr, false);
              newChildren.push(
                wrap === 'del' ? this.wrapDel(partialRun) : partialRun,
              );
            }
          }
        }
      }
    };

    for (const [op, i1, i2, j1, j2] of opcodes) {
      if (op === 'equal') {
        if (i2 > i1) {
          const startChar = tokenStarts[i1];
          const endChar = tokenStarts[i2 - 1] + oldTokens[i2 - 1].length;
          emitOldRange(startChar, endChar, 'keep');
        }
      } else if (op === 'replace') {
        if (i2 > i1) {
          const startChar = tokenStarts[i1];
          const endChar = tokenStarts[i2 - 1] + oldTokens[i2 - 1].length;
          emitOldRange(startChar, endChar, 'del');
        }
        if (j2 > j1) {
          const insText = newTokens.slice(j1, j2).join('');
          newChildren.push(
            this.wrapIns(this.makeRun(insText, defaultRpr, false)),
          );
        }
      } else if (op === 'delete') {
        if (i2 > i1) {
          const startChar = tokenStarts[i1];
          const endChar = tokenStarts[i2 - 1] + oldTokens[i2 - 1].length;
          emitOldRange(startChar, endChar, 'del');
        }
      } else if (op === 'insert' && j2 > j1) {
        const insText = newTokens.slice(j1, j2).join('');
        newChildren.push(
          this.wrapIns(this.makeRun(insText, defaultRpr, false)),
        );
      }
    }

    this.rebuildParagraph(paraNode, pPrNode, newChildren, preserved);
  }

  private applyWholeParagraphChange(
    paraNode: XmlNode,
    originalRuns: XmlNode[],
    newText: string,
    defaultRpr: XmlNode | null,
  ): void {
    const preserved: XmlNode[] = [];
    let pPrNode: XmlNode | null = null;
    for (const child of childrenOf(paraNode)) {
      const local = localName(tagOf(child));
      if (local === 'pPr') {
        pPrNode = child;
      } else if (local !== 'r') {
        preserved.push(child);
      }
    }
    const newChildren: XmlNode[] = [];
    for (const run of originalRuns) {
      newChildren.push(this.wrapDel(structuredClone(run)));
    }
    newChildren.push(this.wrapIns(this.makeRun(newText, defaultRpr, false)));
    this.rebuildParagraph(paraNode, pPrNode, newChildren, preserved);
  }

  private rebuildParagraph(
    paraNode: XmlNode,
    pPrNode: XmlNode | null,
    newChildren: XmlNode[],
    preserved: XmlNode[],
  ): void {
    const rebuilt: XmlNode[] = [];
    if (pPrNode) {
      rebuilt.push(pPrNode);
    }
    rebuilt.push(...newChildren);
    rebuilt.push(...preserved);
    setChildren(paraNode, rebuilt);
  }

  /** Register the rsid + ensure revisions are visible in settings.xml. */
  async registerRsid(zip: JSZip): Promise<void> {
    try {
      const settingsFile = zip.file('word/settings.xml');
      if (!settingsFile) {
        // No settings part — Word still renders revisions; skip best-effort.
        return;
      }
      const settingsXml = await settingsFile.async('string');
      const tree: XmlNode[] = parser.parse(settingsXml);
      // Find w:settings root.
      let settingsRoot: XmlNode | null = null;
      const findRoot = (nodes: XmlNode[]): void => {
        for (const node of nodes) {
          if (localName(tagOf(node)) === 'settings') {
            settingsRoot = node;
            return;
          }
        }
      };
      findRoot(tree);
      if (!settingsRoot) {
        return;
      }
      const rootChildren = childrenOf(settingsRoot);
      let rsids = rootChildren.find((c) => localName(tagOf(c)) === 'rsids');
      if (!rsids) {
        rsids = { 'w:rsids': [] };
        rootChildren.push(rsids);
      }
      const rsidNode: XmlNode = { 'w:rsid': [] };
      setAttr(rsidNode, '@_w:val', this.rsid);
      childrenOf(rsids).push(rsidNode);

      const rebuilt = builder.build(tree);
      zip.file('word/settings.xml', rebuilt);
    } catch (err) {
      console.warn(
        `[docx_roundtrip] failed to register rsid: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    void W_NS;
  }
}
