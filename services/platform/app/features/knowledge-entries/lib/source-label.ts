/** The lanes a fact arrives through, as the `source.*` messages name them:
 * the assistant's capture, the form, the REST door and an agent granted the
 * write tool. */
type SourceLabel = 'chat' | 'manual' | 'api' | 'agent';

/** The message key under `source.*` for an entry's `source` column; an
 * unknown value reads as the form's, the column's historical default. */
export function sourceLabelKey(source: string): SourceLabel {
  return source === 'chat' || source === 'api' || source === 'agent'
    ? source
    : 'manual';
}
