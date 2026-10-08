import { EditorView } from '@codemirror/view';

/**
 * The editor's chrome, all through CSS variables (`--code-*` and the app's
 * tokens), so one theme serves light and dark. Sizes come from the frame:
 * the font size is inherited (`text-base md:text-xs` or `md:text-sm`), a
 * line is 1.6 em like a read-only code block, and the frame sets
 * `--ce-min-rows` / `--ce-max-rows`.
 */
export const codeEditorTheme = EditorView.theme({
  '&': {
    color: 'var(--code-foreground)',
    backgroundColor: 'transparent',
    fontSize: 'inherit',
    borderRadius: 'inherit',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.6',
    overflow: 'auto',
    overscrollBehavior: 'contain',
    maxHeight: 'calc(var(--ce-max-rows, 14) * 1.6em + 1rem)',
    borderRadius: 'inherit',
  },
  '&.cm-fill': { height: '100%' },
  '&.cm-fill .cm-scroller': { maxHeight: 'none', height: '100%' },
  '&.cm-prose .cm-scroller': { fontFamily: 'var(--font-sans)' },
  '.cm-content': {
    padding: '0.5rem 0',
    minHeight: 'calc(var(--ce-min-rows, 3) * 1.6em + 1rem)',
    caretColor: 'var(--code-foreground)',
  },
  '.cm-line': { padding: '0 0.75rem' },
  '.cm-placeholder': { color: 'hsl(var(--muted-foreground))' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--code-foreground)' },
  '&.cm-readonly .cm-cursor': { display: 'none' },
  '.cm-selectionLayer .cm-selectionBackground': {
    background: 'var(--code-selection-inactive)',
  },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    background: 'var(--code-selection)',
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '&.cm-focused:not(.cm-readonly) .cm-activeLine': {
    backgroundColor: 'var(--code-active-line)',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    border: 'none',
    color: 'var(--code-line-number)',
  },
  '.cm-gutterElement': { userSelect: 'none' },
  '.cm-lineNumbers .cm-gutterElement': {
    minWidth: '1.75rem',
    padding: '0 0 0 0.75rem',
    textAlign: 'right',
  },
  '.cm-activeLineGutter': { backgroundColor: 'transparent' },
  '&.cm-focused .cm-activeLineGutter': {
    color: 'var(--code-line-number-active)',
  },
  '.cm-foldGutter .cm-gutterElement': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0 0.125rem',
    color: 'hsl(var(--muted-foreground))',
  },
  '.cm-foldGutter .cm-fold-open': { opacity: '0' },
  '.cm-gutters:hover .cm-foldGutter .cm-fold-open, .cm-foldGutter .cm-fold-open:focus-visible':
    { opacity: '1' },
  '.cm-foldPlaceholder': {
    backgroundColor: 'hsl(var(--muted))',
    border: '1px solid hsl(var(--border))',
    color: 'hsl(var(--muted-foreground))',
    borderRadius: '0.25rem',
    padding: '0 0.25rem',
    margin: '0 0.125rem',
  },
  '&.cm-focused .cm-matchingBracket': {
    backgroundColor: 'var(--code-match)',
  },
  '&.cm-focused .cm-nonmatchingBracket': {
    backgroundColor: 'transparent',
    textDecoration: 'underline wavy var(--code-squiggle-error) 1.5px',
    textUnderlineOffset: '3px',
    textDecorationSkipInk: 'none',
  },
  '.cm-searchMatch': { backgroundColor: 'var(--code-match)' },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'var(--code-selection)',
    outline: '1px solid var(--code-squiggle-info)',
  },
  '.cm-selectionMatch': { backgroundColor: 'var(--code-match)' },
  // A `{{ … }}` template reads as one chip; in prose it keeps the code font,
  // a little smaller so it sits on the text's x-height.
  '.cm-template': {
    backgroundColor: 'var(--code-template-tint)',
    borderRadius: '3px',
    boxDecorationBreak: 'clone',
    WebkitBoxDecorationBreak: 'clone',
  },
  '&.cm-prose .cm-template': {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.92em',
  },
  '.cm-tale-object': { color: 'var(--code-token-constant)' },
  // Search and go-to-line panels, in the app's control styles.
  '.cm-panels': {
    backgroundColor: 'hsl(var(--card))',
    color: 'hsl(var(--card-foreground))',
    fontFamily: 'var(--font-sans)',
  },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid hsl(var(--border))' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid hsl(var(--border))' },
  '.cm-panel.cm-search, .cm-panel.cm-gotoLine': {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '0.25rem 0.5rem',
    padding: '0.375rem 2rem 0.375rem 0.5rem',
    fontSize: '0.75rem',
  },
  '.cm-panel.cm-search br': { flexBasis: '100%', height: '0' },
  '.cm-panel .cm-textfield': {
    height: '1.75rem',
    margin: '0',
    padding: '0 0.5rem',
    border: '1px solid var(--color-border-input)',
    borderRadius: '0.375rem',
    backgroundColor: 'hsl(var(--background))',
    color: 'hsl(var(--foreground))',
    fontSize: '0.75rem',
  },
  '.cm-panel .cm-textfield:focus-visible': {
    outline:
      '2px solid color-mix(in srgb, var(--color-accent-base) 30%, transparent)',
    borderColor: 'var(--color-accent-base)',
  },
  '.cm-panel .cm-button': {
    height: '1.75rem',
    margin: '0',
    padding: '0 0.5rem',
    border: '1px solid hsl(var(--border))',
    borderRadius: '0.375rem',
    backgroundImage: 'none',
    backgroundColor: 'hsl(var(--background))',
    color: 'hsl(var(--foreground))',
    fontSize: '0.75rem',
    cursor: 'pointer',
  },
  '.cm-panel .cm-button:hover': { backgroundColor: 'hsl(var(--muted))' },
  '.cm-panel label': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.25rem',
    fontSize: '0.75rem',
    color: 'hsl(var(--foreground))',
  },
  '.cm-panel button[name=close]': {
    top: '0.375rem',
    right: '0.375rem',
    width: '1.5rem',
    height: '1.5rem',
    borderRadius: '0.375rem',
    color: 'hsl(var(--muted-foreground))',
    fontSize: '1rem',
  },
  '.cm-panel button[name=close]:hover': {
    backgroundColor: 'hsl(var(--muted))',
    color: 'hsl(var(--foreground))',
  },
});
