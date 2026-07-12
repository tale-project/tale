// Human-readable labels for auto-detected elements: an ARIA role (explicit, or
// implicit from the tag and — for `<input>`/`<select>`/`<a>` — its type/state per
// the W3C HTML-AAM mapping) and an accessible name (the common cases of the W3C
// accname algorithm). Lets the report label an element `nav "Main"` or
// `button "Add to cart"` instead of a bare CSS path. Deliberately approximate —
// it covers the cases that matter for a label, not the whole spec.
//
// `computeRole`/`computeAccessibleName` read the DOM and run in the instrument;
// `elementLabel` is pure and runs offline in the report. Neither uses any
// Node/Bun API, so the whole module bundles cleanly into the browser IIFE.

/**
 * Implicit ARIA role for HTML tags whose role is fixed by the tag ALONE, by
 * upper-case tag name (per the W3C HTML-AAM mapping that MDN documents). Tags
 * whose implicit role is attribute- or context-dependent are handled in
 * `computeRole` instead: `<a>`/`<area>` (href), `<input>` (type), `<select>`
 * (multiple/size), `<th>` (scope). Deliberately approximate — it labels the
 * cases that matter and omits elements the spec leaves role-less or generic
 * (`<div>`/`<span>`/`<label>`/`<legend>`/`<figcaption>`/`<dl>`/`<dt>`/`<dd>`/
 * `<hgroup>`/`<summary>`…), which fall back to the accessible name or CSS path.
 */
const IMPLICIT_ROLE: Readonly<Record<string, string>> = {
  // Sectioning content & landmarks
  NAV: 'navigation',
  MAIN: 'main',
  HEADER: 'banner',
  FOOTER: 'contentinfo',
  ASIDE: 'complementary',
  SECTION: 'region',
  ARTICLE: 'article',
  SEARCH: 'search',
  FORM: 'form',
  ADDRESS: 'group',
  H1: 'heading',
  H2: 'heading',
  H3: 'heading',
  H4: 'heading',
  H5: 'heading',
  H6: 'heading',
  // Grouping & structure
  DIALOG: 'dialog',
  DETAILS: 'group',
  FIELDSET: 'group',
  FIGURE: 'figure',
  BLOCKQUOTE: 'blockquote',
  P: 'paragraph',
  HR: 'separator',
  // Lists
  UL: 'list',
  OL: 'list',
  MENU: 'list',
  LI: 'listitem',
  // Tables
  TABLE: 'table',
  CAPTION: 'caption',
  THEAD: 'rowgroup',
  TBODY: 'rowgroup',
  TFOOT: 'rowgroup',
  TR: 'row',
  TD: 'cell',
  // Form-associated widgets
  BUTTON: 'button',
  TEXTAREA: 'textbox',
  OUTPUT: 'status',
  PROGRESS: 'progressbar',
  METER: 'meter',
  OPTION: 'option',
  OPTGROUP: 'group',
  DATALIST: 'listbox',
  // Embedded media
  IMG: 'img',
  // Phrasing-level semantics — rarely a tracked component, kept for label
  // completeness so a discovered one is named by role, not just text.
  CODE: 'code',
  EM: 'emphasis',
  STRONG: 'strong',
  DEL: 'deletion',
  INS: 'insertion',
  SUB: 'subscript',
  SUP: 'superscript',
};

/** Longest accessible name kept; longer names are truncated with an ellipsis. */
const NAME_MAX = 80;

/** Collapse runs of whitespace and truncate to a label-sized string. */
function clean(raw: string): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= NAME_MAX) return collapsed;
  return `${collapsed.slice(0, NAME_MAX - 1)}…`;
}

/**
 * The implicit ARIA role of an `<input>`, which depends on its `type` (W3C
 * HTML-AAM): a missing or invalid type behaves as `text`, and a `list` attribute
 * (a bound `<datalist>`) upgrades a text-like input to a `combobox`. Several
 * types (`color`/`date`/`file`/`password`/`hidden`/the date-time family) have no
 * corresponding role, so they label by name/selector rather than as a `textbox`.
 */
function inputRole(el: Element): string | null {
  const type = (el.getAttribute('type') ?? '').toLowerCase();
  switch (type) {
    case 'button':
    case 'submit':
    case 'reset':
    case 'image':
      return 'button';
    case 'checkbox':
      return 'checkbox';
    case 'radio':
      return 'radio';
    case 'range':
      return 'slider';
    case 'number':
      return 'spinbutton';
    case 'search':
      return el.hasAttribute('list') ? 'combobox' : 'searchbox';
    case 'color':
    case 'date':
    case 'datetime-local':
    case 'file':
    case 'hidden':
    case 'month':
    case 'password':
    case 'time':
    case 'week':
      return null;
    default:
      // text/email/tel/url, a missing type, or an invalid one (HTML treats it as
      // text); a bound <datalist> makes it a combobox.
      return el.hasAttribute('list') ? 'combobox' : 'textbox';
  }
}

/**
 * The element's ARIA role: an explicit `role` (first token) wins; otherwise the
 * implicit role for its tag. Tags whose role depends on attributes are resolved
 * here — `<a>`/`<area>` are links only with an `href`, `<input>` by its `type`,
 * `<select>` by `multiple`/`size`, `<th>` by `scope` — and the rest come from
 * `IMPLICIT_ROLE`. `null` when nothing maps.
 */
export function computeRole(el: Element): string | null {
  const explicit = el.getAttribute('role');
  if (explicit) {
    const first = explicit.trim().split(/\s+/)[0];
    if (first) return first;
  }
  // `<a>` and `<area>` expose as a link only when they carry an href; a bare
  // anchor/area is generic, so it has no useful role to report.
  if (el.tagName === 'A' || el.tagName === 'AREA') {
    return el.hasAttribute('href') ? 'link' : null;
  }
  if (el.tagName === 'INPUT') return inputRole(el);
  // A multi-select, or a dropdown sized to show ≥2 rows, exposes as a listbox;
  // the default single-line `<select>` is a combobox.
  if (el.tagName === 'SELECT') {
    const size = parseInt(el.getAttribute('size') ?? '', 10);
    return el.hasAttribute('multiple') || size > 1 ? 'listbox' : 'combobox';
  }
  // A `<th>`'s implicit role depends on its `scope`: a row header vs the default
  // column header. (Spec also allows an auto state computed from table position;
  // we approximate with the explicit scope, which is the common authored case.)
  if (el.tagName === 'TH') {
    const scope = el.getAttribute('scope');
    return scope === 'row' || scope === 'rowgroup'
      ? 'rowheader'
      : 'columnheader';
  }
  return IMPLICIT_ROLE[el.tagName] ?? null;
}

/** Trimmed text of the first direct child with the given (lower-case) tag. */
function childText(el: Element, tag: string): string | null {
  for (const child of Array.from(el.children)) {
    if (child.tagName.toLowerCase() === tag) {
      const text = child.textContent;
      if (text && text.trim()) return text;
    }
  }
  return null;
}

/** Text of the `<label>` associated with a form control, if any. */
function associatedLabelText(el: Element): string | null {
  const doc = el.ownerDocument;
  if (doc && el.id) {
    for (const label of Array.from(doc.getElementsByTagName('label'))) {
      if (label.getAttribute('for') === el.id) {
        const text = label.textContent;
        if (text && text.trim()) return text;
      }
    }
  }
  const wrapping = el.closest('label');
  const wrapText = wrapping?.textContent;
  return wrapText && wrapText.trim() ? wrapText : null;
}

/** An element node (nodeType 1), narrowed without `as`/`instanceof`. */
function isElementNode(node: Node): node is Element {
  return node.nodeType === 1;
}

/**
 * Hidden for name-from-content: a `display:none` / `visibility:hidden` /
 * `aria-hidden` / `[hidden]` subtree contributes nothing to the accessible name
 * (W3C accname step 2A — a node hidden and not directly referenced returns the
 * empty string). Prefers the computed style (a CSS-class hide in a real browser),
 * and falls back to the inline `style` attribute for environments whose computed
 * style does not reflect it (the happy-dom test harness).
 */
function isHiddenForName(el: Element): boolean {
  if (el.getAttribute('aria-hidden') === 'true') return true;
  if (el.hasAttribute('hidden')) return true;
  const computed = el.ownerDocument?.defaultView?.getComputedStyle?.(el);
  if (computed?.display === 'none' || computed?.visibility === 'hidden') {
    return true;
  }
  const inline = el.getAttribute('style') ?? '';
  if (/(?:^|;)\s*display\s*:\s*none/i.test(inline)) return true;
  if (/(?:^|;)\s*visibility\s*:\s*hidden/i.test(inline)) return true;
  return false;
}

/**
 * `textContent`, but excluding any descendant hidden per `isHiddenForName`, so a
 * `display:none` caption never becomes the element's reported accessible name.
 * This is the name-FROM-CONTENT path only; a node DIRECTLY referenced by
 * `aria-labelledby` is intentionally still read in full (W3C 2A keeps a directly-
 * referenced hidden node), so that path keeps using raw `textContent`.
 */
function visibleTextContent(el: Element): string {
  if (isHiddenForName(el)) return '';
  let out = '';
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 3) out += child.textContent ?? '';
    else if (isElementNode(child)) out += visibleTextContent(child);
  }
  return out;
}

/**
 * Text of a node DIRECTLY referenced by `aria-labelledby`: the referenced node is
 * kept even when itself hidden (W3C accname step 2A keeps a directly-referenced
 * node), but its hidden DESCENDANTS — reached only by recursion — are still
 * excluded. So this skips the node's own hidden check but uses `visibleTextContent`
 * for its element children.
 */
function referencedNameText(node: Element): string {
  let out = '';
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) out += child.textContent ?? '';
    else if (isElementNode(child)) out += visibleTextContent(child);
  }
  return out;
}

/**
 * The element's accessible name via the common accname cases, in priority order:
 * `aria-labelledby` → `aria-label` → tag-specific (img `alt`; control `<label>`/
 * `placeholder`) → text content → `title`. `null` when none apply.
 */
export function computeAccessibleName(el: Element): string | null {
  // aria-labelledby (W3C accname step 2B) is resolved BEFORE aria-label (2C):
  // when an element carries both, screen readers announce the referenced text.
  // A labelledby that resolves to nothing (dangling/empty ids) falls through to
  // aria-label below, so that fallback is preserved.
  const labelledby = el.getAttribute('aria-labelledby');
  if (labelledby) {
    const doc = el.ownerDocument;
    const text = labelledby
      .split(/\s+/)
      .map((id) => {
        const ref = doc?.getElementById(id);
        return ref ? referencedNameText(ref) : '';
      })
      .join(' ')
      .trim();
    if (text) return clean(text);
  }

  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) return clean(ariaLabel);

  if (el.tagName === 'IMG') {
    const alt = el.getAttribute('alt');
    if (alt && alt.trim()) return clean(alt);
  }

  // A captioning child names its host (HTML-AAM / accname): a `<fieldset>` by its
  // `<legend>`, a `<figure>` by its `<figcaption>`, a `<table>` by its
  // `<caption>`, an `<svg>` by its `<title>` — so the host is named by the
  // caption, not by concatenating all of its content below.
  const CAPTION_CHILD: Readonly<Record<string, string>> = {
    FIELDSET: 'legend',
    FIGURE: 'figcaption',
    TABLE: 'caption',
    SVG: 'title',
  };
  // HTML tagNames are upper-case, but a namespaced inline `<svg>` reports the
  // lower-case 'svg' — normalise before the lookup, as the media-set checks in
  // instrument.ts/select.ts do, so the SVG key matches.
  const captionTag = CAPTION_CHILD[el.tagName.toUpperCase()];
  if (captionTag) {
    const caption = childText(el, captionTag);
    if (caption) return clean(caption);
  }

  if (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT'
  ) {
    const labelText = associatedLabelText(el);
    if (labelText) return clean(labelText);
    const placeholder = el.getAttribute('placeholder');
    if (placeholder && placeholder.trim()) return clean(placeholder);
  }

  const text = visibleTextContent(el);
  if (text && text.trim()) return clean(text);

  const title = el.getAttribute('title');
  if (title && title.trim()) return clean(title);

  return null;
}

/**
 * The display label from a role and accessible name: `role "name"` when both are
 * known, else whichever exists (a bare name is quoted), else `null` so the caller
 * can fall back to the CSS selector.
 */
export function elementLabel(
  role: string | null,
  name: string | null,
): string | null {
  if (role && name) return `${role} "${name}"`;
  if (role) return role;
  if (name) return `"${name}"`;
  return null;
}
