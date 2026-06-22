/**
 * Conservative layout codemod: rewrites raw `<div className="…flex…">` layout
 * containers to the `Stack` / `Row` primitives from `@tale/ui/layout`.
 *
 * SAFETY MODEL — every rewrite is DOM-NEUTRAL by construction:
 *   - Only `<div>` with a STRING-LITERAL `className` is touched (dynamic
 *     `className={…}` is left alone).
 *   - The class string is PARTITIONED: the layout tokens the primitive expresses
 *     (`flex`/`flex-col`/`flex-row`/`gap-N`/`items-*`/`justify-*`/`flex-wrap`) are
 *     consumed into props; every other token passes through unchanged in
 *     `className`, in source order.
 *   - The primitive re-emits exactly those layout classes (Stack = `flex-col`,
 *     Row = `flex-row`), and the neutrality rules below preserve the browser
 *     defaults a raw flex div relies on (align-items: stretch; justify: start;
 *     gap: 0). So the rendered class set is equivalent.
 *   - Anything ambiguous or outside the named scale is SKIPPED (left raw).
 *
 * This is a migration aid: run it, review the diff, run `bun run check`, and
 * spot-check the page. It is never wired into CI.
 *
 * Usage:
 *   bun tools/ui-sweep/codemod-layout.ts <path…>           # dry run (counts)
 *   bun tools/ui-sweep/codemod-layout.ts --write <path…>   # apply edits
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';

const GAP_SCALE = new Set([0, 1, 2, 3, 4, 5, 6, 8, 10, 12]);
const DEFAULT_GAP = 4;

const ALIGN: Record<string, string> = {
  'items-start': 'start',
  'items-center': 'center',
  'items-end': 'end',
  'items-stretch': 'stretch',
  'items-baseline': 'baseline',
};
const JUSTIFY: Record<string, string> = {
  'justify-start': 'start',
  'justify-center': 'center',
  'justify-end': 'end',
  'justify-between': 'between',
  'justify-around': 'around',
  'justify-evenly': 'evenly',
};

export type LayoutComp = 'Stack' | 'Row' | 'Grid';

export interface LayoutPlan {
  comp: LayoutComp;
  /** Rendered in attribute order: cols, sm, md, lg, xl, gap, align, justify, wrap. */
  props: {
    gap?: number;
    align?: string;
    justify?: string;
    wrap?: boolean;
    cols?: number;
    sm?: number;
    md?: number;
    lg?: number;
    xl?: number;
  };
  passthrough: string[];
}

const GRID_COLS = new Set([1, 2, 3, 4, 5, 6]);

/**
 * Plan a `grid` container → `Grid`. DOM-neutral, but SKIPS grids without an
 * explicit base `grid-cols-N` (N 1–6): `Grid` always emits `grid-cols-{cols}`
 * (default 1), whereas bare `grid` leaves columns implicit — not equivalent.
 */
function planGrid(tokens: string[]): LayoutPlan | null {
  if (
    tokens.some((t) =>
      /^(grid-rows-|grid-flow-|auto-cols-|auto-rows-|col-span-|row-span-)/.test(
        t,
      ),
    )
  )
    return null;

  const gapTokens = tokens.filter((t) => /^gap-/.test(t));
  if (gapTokens.length > 1) return null;
  if (tokens.some((t) => /^gap-[xy]-/.test(t))) return null;
  let gap = 0;
  const gapToken = gapTokens[0];
  if (gapToken) {
    const m = gapToken.match(/^gap-(\d+)$/);
    if (!m) return null;
    gap = Number(m[1]);
    if (!GAP_SCALE.has(gap)) return null;
  }

  const consumed = new Set(['grid']);
  if (gapToken) consumed.add(gapToken);

  const cols: Record<string, number> = {};
  for (const t of tokens) {
    const m = t.match(/^(?:(sm|md|lg|xl):)?grid-cols-(.+)$/);
    if (!m) continue;
    const bp = m[1] ?? 'base';
    if (!/^\d+$/.test(m[2])) return null; // arbitrary / none / subgrid → skip
    const n = Number(m[2]);
    if (!GRID_COLS.has(n)) return null;
    if (bp in cols) return null;
    cols[bp] = n;
    consumed.add(t);
  }
  if (cols.base === undefined) return null; // bare `grid` → not safely neutral

  const props: LayoutPlan['props'] = {};
  if (gap !== DEFAULT_GAP) props.gap = gap;
  if (cols.base !== 1) props.cols = cols.base; // Grid default cols=1
  for (const bp of ['sm', 'md', 'lg', 'xl'] as const)
    if (cols[bp] !== undefined) props[bp] = cols[bp];

  return {
    comp: 'Grid',
    props,
    passthrough: tokens.filter((t) => !consumed.has(t)),
  };
}

/**
 * Decide whether a `<div>`'s class string is a safe flex layout to convert, and
 * to what. Returns `null` to skip (leave raw). Pure + exported for unit tests.
 */
export function planLayout(className: string): LayoutPlan | null {
  const tokens = className.split(/\s+/).filter(Boolean);
  if (tokens.includes('grid')) return planGrid(tokens);
  if (!tokens.includes('flex')) return null; // only plain `flex` (not inline-flex)

  // Bail on anything that single-axis props can't faithfully express.
  const single = (re: RegExp) => tokens.filter((t) => re.test(t)).length > 1;
  if (
    tokens.some((t) =>
      /^(sm|md|lg|xl):(flex-(row|col)|items-|justify-|gap-)/.test(t),
    )
  )
    return null; // responsive layout overrides
  if (tokens.some((t) => /^flex-(col|row)-reverse$/.test(t))) return null;
  if (tokens.includes('flex-wrap-reverse')) return null;
  if (tokens.some((t) => /^gap-[xy]-/.test(t))) return null; // directional gap
  if (tokens.some((t) => /^space-[xy]-/.test(t))) return null; // mixed spacing model
  if (single(/^gap-/) || single(/^items-/) || single(/^justify-/)) return null;

  const gapToken = tokens.find((t) => /^gap-/.test(t));
  let gap = 0;
  if (gapToken) {
    const m = gapToken.match(/^gap-(\d+)$/);
    if (!m) return null; // gap-[…] / arbitrary
    gap = Number(m[1]);
    if (!GAP_SCALE.has(gap)) return null;
  }

  const isCol = tokens.includes('flex-col');
  const comp: 'Stack' | 'Row' = isCol ? 'Stack' : 'Row';

  const consumed = new Set(['flex', 'flex-col', 'flex-row', 'flex-nowrap']);
  if (gapToken) consumed.add(gapToken);

  const alignToken = tokens.find((t) => t in ALIGN);
  if (alignToken) consumed.add(alignToken);
  const justifyToken = tokens.find((t) => t in JUSTIFY);
  if (justifyToken) consumed.add(justifyToken);
  const hasWrap = tokens.includes('flex-wrap');
  if (hasWrap) consumed.add('flex-wrap');

  const align = alignToken ? ALIGN[alignToken] : undefined;
  const justify = justifyToken ? JUSTIFY[justifyToken] : undefined;

  const props: LayoutPlan['props'] = {};
  // gap: omit when it equals the primitive default (4); otherwise emit. A raw
  // flex div with no gap is 0 → must emit gap={0} to override the default 4.
  if (gap !== DEFAULT_GAP) props.gap = gap;

  // align neutrality: a raw flex/flex-col div defaults to align-items: stretch.
  // Stack defaults to stretch (omit when stretch); Row defaults to center, so a
  // div with no items-* (or items-stretch) MUST carry align="stretch".
  if (comp === 'Stack') {
    if (align && align !== 'stretch') props.align = align;
  } else {
    const effective = align ?? 'stretch';
    if (effective !== 'center') props.align = effective;
  }

  // justify neutrality: raw default is flex-start === primitive default 'start'.
  if (justify && justify !== 'start') props.justify = justify;
  if (hasWrap) props.wrap = true;

  const passthrough = tokens.filter((t) => !consumed.has(t));
  return { comp, props, passthrough };
}

function renderProps(p: LayoutPlan['props']): string {
  const parts: string[] = [];
  if (p.cols !== undefined) parts.push(`cols={${p.cols}}`);
  for (const bp of ['sm', 'md', 'lg', 'xl'] as const)
    if (p[bp] !== undefined) parts.push(`${bp}={${p[bp]}}`);
  if (p.gap !== undefined) parts.push(`gap={${p.gap}}`);
  if (p.align !== undefined) parts.push(`align="${p.align}"`);
  if (p.justify !== undefined) parts.push(`justify="${p.justify}"`);
  if (p.wrap) parts.push('wrap');
  return parts.join(' ');
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

/**
 * Top-level names already bound in the file (imports + declarations), EXCLUDING
 * our own `@tale/ui/layout` import. Used to skip a rewrite that would shadow an
 * existing `Row`/`Stack` — most commonly TanStack Table's `Row<T>` type.
 */
function collectReserved(sf: ts.SourceFile): Set<string> {
  const reserved = new Set<string>();
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) {
      const mod = ts.isStringLiteral(stmt.moduleSpecifier)
        ? stmt.moduleSpecifier.text
        : '';
      if (mod === '@tale/ui/layout') continue;
      const clause = stmt.importClause;
      if (!clause) continue;
      if (clause.name) reserved.add(clause.name.text);
      const nb = clause.namedBindings;
      if (nb && ts.isNamedImports(nb))
        for (const el of nb.elements) reserved.add(el.name.text);
      if (nb && ts.isNamespaceImport(nb)) reserved.add(nb.name.text);
      continue;
    }
    if (
      (ts.isTypeAliasDeclaration(stmt) ||
        ts.isInterfaceDeclaration(stmt) ||
        ts.isClassDeclaration(stmt) ||
        ts.isFunctionDeclaration(stmt)) &&
      stmt.name
    ) {
      reserved.add(stmt.name.text);
    }
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations)
        if (ts.isIdentifier(d.name)) reserved.add(d.name.text);
    }
  }
  return reserved;
}

/** Layout-capable tags the primitives can render via `as` (DOM-neutral). */
const AS_TAGS = new Set([
  'section',
  'header',
  'footer',
  'nav',
  'main',
  'aside',
  'ul',
  'ol',
  'article',
]);

export function transformSource(src: string): {
  code: string;
  changed: number;
  needs: Set<LayoutComp>;
} {
  const sf = ts.createSourceFile(
    'f.tsx',
    src,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const reserved = collectReserved(sf);
  const edits: Edit[] = [];
  const needs = new Set<LayoutComp>();

  const handle = (
    opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
    closing?: ts.JsxClosingElement,
  ) => {
    if (!ts.isIdentifier(opening.tagName)) return;
    const tag = opening.tagName.text;
    const isDiv = tag === 'div';
    if (!isDiv && !AS_TAGS.has(tag)) return;
    const classAttr = opening.attributes.properties.find(
      (a): a is ts.JsxAttribute =>
        ts.isJsxAttribute(a) && a.name.getText(sf) === 'className',
    );
    if (!classAttr?.initializer || !ts.isStringLiteral(classAttr.initializer))
      return;
    const plan = planLayout(classAttr.initializer.text);
    if (!plan) return;
    // Don't shadow an existing binding of the same name (e.g. TanStack `Row`).
    if (reserved.has(plan.comp)) return;
    needs.add(plan.comp);

    // A non-div tag is preserved via `as` so the rendered element is identical.
    const asText = isDiv ? '' : `as="${tag}"`;
    const propsText = renderProps(plan.props);
    const passthrough = plan.passthrough.join(' ');
    const classText = passthrough ? `className="${passthrough}"` : '';
    const replacement = [asText, propsText, classText]
      .filter(Boolean)
      .join(' ');

    edits.push({
      start: opening.tagName.getStart(sf),
      end: opening.tagName.getEnd(),
      text: plan.comp,
    });
    edits.push({
      start: classAttr.getStart(sf),
      end: classAttr.getEnd(),
      text: replacement,
    });
    if (closing)
      edits.push({
        start: closing.tagName.getStart(sf),
        end: closing.tagName.getEnd(),
        text: plan.comp,
      });
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node)) handle(node.openingElement, node.closingElement);
    else if (ts.isJsxSelfClosingElement(node)) handle(node);
    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (!edits.length) return { code: src, changed: 0, needs };
  edits.sort((a, b) => b.start - a.start);
  let code = src;
  for (const e of edits)
    code = code.slice(0, e.start) + e.text + code.slice(e.end);
  return { code, changed: needs.size ? edits.length : 0, needs };
}

/** Add/merge `import { … } from '@tale/ui/layout'` for the needed primitives. */
export function ensureLayoutImport(
  src: string,
  needs: Set<LayoutComp>,
): string {
  if (!needs.size) return src;
  const wanted = [...needs];
  const importRe = /import\s*\{([^}]*)\}\s*from\s*'@tale\/ui\/layout'\s*;?/;
  const match = src.match(importRe);
  if (match) {
    const existing = match[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const merged = [...new Set([...existing, ...wanted])].sort();
    return src.replace(
      importRe,
      `import { ${merged.join(', ')} } from '@tale/ui/layout';`,
    );
  }
  // Insert after the END of the last import declaration (handles multi-line
  // imports, which a line-based scan would corrupt by inserting mid-block).
  const sf = ts.createSourceFile(
    'f.tsx',
    src,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let insertPos = 0;
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) insertPos = stmt.getEnd();
  }
  const stmt = `import { ${wanted.sort().join(', ')} } from '@tale/ui/layout';`;
  if (insertPos > 0)
    return `${src.slice(0, insertPos)}\n${stmt}${src.slice(insertPos)}`;
  return `${stmt}\n${src}`;
}

function listTsx(dir: string): string[] {
  let out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) {
      if (e !== 'node_modules') out = out.concat(listTsx(full));
    } else if (
      e.endsWith('.tsx') &&
      !e.endsWith('.test.tsx') &&
      !e.endsWith('.stories.tsx')
    ) {
      out.push(full);
    }
  }
  return out;
}

function runCli() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const paths = args.filter((a) => a !== '--write');
  if (!paths.length) {
    console.error('usage: codemod-layout.ts [--write] <path…>');
    process.exit(1);
  }
  const files = paths.flatMap((p) =>
    statSync(p).isDirectory() ? listTsx(p) : [p],
  );
  let changedFiles = 0;
  let changedNodes = 0;
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const { code, changed, needs } = transformSource(src);
    if (!changed) continue;
    changedFiles += 1;
    changedNodes += changed;
    const out = ensureLayoutImport(code, needs);
    if (write) writeFileSync(file, out);
    console.log(`${write ? 'wrote' : 'would change'} ${file} (+${changed})`);
  }
  console.log(
    `\n${changedNodes} div(s) in ${changedFiles} file(s)${write ? ' rewritten' : ' (dry run)'}.`,
  );
}

if (import.meta.main) runCli();
