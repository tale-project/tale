/** The message key under `source.*` for an entry's `source` column — the
 * three lanes a fact arrives through (`chat`, `manual`, `api`); an unknown
 * value reads as the form's, the column's historical default. */
export function sourceLabelKey(source: string): 'chat' | 'manual' | 'api' {
  return source === 'chat' || source === 'api' ? source : 'manual';
}
