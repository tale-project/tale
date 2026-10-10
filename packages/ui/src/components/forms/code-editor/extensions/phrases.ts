import type { TFunction } from 'i18next';

/**
 * CodeMirror's own words (the completion list's name, the search panel,
 * fold markers, screen-reader announcements) in the reader's language,
 * keyed by the English phrase CodeMirror asks for. `$` stays: CodeMirror
 * puts a number there. `phrases.test.ts` fails when an upgrade brings a
 * phrase this list does not translate.
 */
export function editorPhrases(t: TFunction): Record<string, string> {
  return {
    'Control character': t('phrases.controlCharacter'),
    close: t('phrases.close'),
    'Selection deleted': t('phrases.selectionDeleted'),
    'folded code': t('phrases.foldedCode'),
    unfold: t('phrases.unfold'),
    to: t('phrases.to'),
    'Folded lines': t('phrases.foldedLines'),
    'Unfolded lines': t('phrases.unfoldedLines'),
    'Fold line': t('phrases.foldLine'),
    'Unfold line': t('phrases.unfoldLine'),
    Completions: t('phrases.completions'),
    Find: t('phrases.find'),
    Replace: t('phrases.replaceField'),
    next: t('phrases.next'),
    previous: t('phrases.previous'),
    all: t('phrases.all'),
    'match case': t('phrases.matchCase'),
    regexp: t('phrases.regexp'),
    'by word': t('phrases.byWord'),
    replace: t('phrases.replace'),
    'replace all': t('phrases.replaceAll'),
    'Go to line': t('phrases.goToLine'),
    go: t('phrases.go'),
    'current match': t('phrases.currentMatch'),
    'on line': t('phrases.onLine'),
    'replaced $ matches': t('phrases.replacedMatches'),
    'replaced match on line $': t('phrases.replacedMatchOnLine'),
  };
}
