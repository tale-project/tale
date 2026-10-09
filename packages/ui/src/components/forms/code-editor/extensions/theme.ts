import { EditorView } from '@codemirror/view';

/** Inter's x-height as a share of its size (1118 of 2048 units). */
export const PROSE_X_HEIGHT = 0.546;

/** `shadow-md` under a `ring-1 ring-border`: the app's popover, as one
 *  `box-shadow` (CodeMirror's tooltips take no utility classes). */
const POPOVER_SHADOW =
  '0 0 0 1px hsl(var(--border)), 0 4px 6px -1px var(--tw-shadow-color, rgb(0 0 0 / 0.1)), 0 2px 4px -2px var(--tw-shadow-color, rgb(0 0 0 / 0.1))';

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
  // scaled so its lowercase letters stand exactly as tall as the prose's:
  // `font-size-adjust` holds any monospace font to Inter's x-height (0.546
  // of its size), whichever one the reader's system supplies.
  '.cm-template': {
    backgroundColor: 'var(--code-template-tint)',
    borderRadius: '3px',
    boxDecorationBreak: 'clone',
    WebkitBoxDecorationBreak: 'clone',
  },
  '&.cm-prose .cm-template': {
    fontFamily: 'var(--font-mono)',
    fontSizeAdjust: String(PROSE_X_HEIGHT),
  },
  '.cm-tale-object': { color: 'var(--code-token-constant)' },
  // Problems: the underline's style says the severity (wavy for an error or
  // a warning, dotted for a note), so it never reads by colour alone.
  '.cm-diagnostic': {
    textUnderlineOffset: '3px',
    textDecorationSkipInk: 'none',
  },
  '.cm-diagnostic-error': {
    textDecoration: 'underline wavy var(--code-squiggle-error) 1.5px',
  },
  '.cm-diagnostic-warning': {
    textDecoration: 'underline wavy var(--code-squiggle-warning) 1px',
  },
  '.cm-diagnostic-info': {
    textDecoration: 'underline dotted var(--code-squiggle-info) 1px',
  },
  // While a check runs, the last answer's underlines fade to 60 %.
  '&.cm-diagnostics-pending .cm-diagnostic-error': {
    textDecorationColor:
      'color-mix(in srgb, var(--code-squiggle-error) 60%, transparent)',
  },
  '&.cm-diagnostics-pending .cm-diagnostic-warning': {
    textDecorationColor:
      'color-mix(in srgb, var(--code-squiggle-warning) 60%, transparent)',
  },
  '&.cm-diagnostics-pending .cm-diagnostic-info': {
    textDecorationColor:
      'color-mix(in srgb, var(--code-squiggle-info) 60%, transparent)',
  },
  '.cm-diagnostic-gutter .cm-gutterElement': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '1.25rem',
    paddingLeft: '0.25rem',
  },
  // Tooltips and the completion list look like the app's popovers: a 1 px
  // ring in the border colour over `shadow-md`, whose layers the dark theme
  // recolours through `--tw-shadow-color` (globals.css).
  '.cm-tooltip': {
    backgroundColor: 'hsl(var(--popover))',
    color: 'hsl(var(--popover-foreground))',
    border: 'none',
    borderRadius: '0.5rem',
    boxShadow: POPOVER_SHADOW,
    fontFamily: 'var(--font-sans)',
    fontSize: '0.75rem',
    lineHeight: '1.4',
  },
  '.dark & .cm-tooltip': { backgroundColor: 'hsl(var(--muted))' },
  '.cm-tooltip.cm-tooltip-autocomplete': {
    padding: '0.25rem 0',
    minWidth: '14rem',
    maxWidth: '24rem',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': {
    fontFamily: 'var(--font-mono)',
    maxHeight: 'calc(8 * 1.75rem + 2rem)',
    maxWidth: '24rem',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    minHeight: '1.75rem',
    padding: '0 0.5rem',
    lineHeight: '1.75rem',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'hsl(var(--accent))',
    color: 'hsl(var(--accent-foreground))',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > completion-section': {
    display: 'block',
    padding: '0.5rem 0.5rem 0.25rem',
    fontFamily: 'var(--font-sans)',
    fontSize: '0.75rem',
    fontWeight: '500',
    color: 'hsl(var(--muted-foreground))',
    borderBottom: 'none',
    opacity: '1',
  },
  '.cm-completionLabel': { color: 'hsl(var(--foreground))' },
  '.cm-completionMatchedText': { textDecoration: 'none', fontWeight: '600' },
  '.cm-completionDetail': {
    marginLeft: 'auto',
    paddingLeft: '0.75rem',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontStyle: 'normal',
    color: 'hsl(var(--muted-foreground))',
  },
  '.cm-tooltip.cm-completionInfo': { padding: '0', maxWidth: '20rem' },
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
