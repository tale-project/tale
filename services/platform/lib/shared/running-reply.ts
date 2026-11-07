/**
 * The reply a running turn is still writing: its `pending` placeholder,
 * finalize not landed (a row carrying an error is settled whatever its
 * status says). It is the owner's alone (CHAT-R2): the messages read
 * leaves it out for a project reader, and a view that follows no live turn
 * leaves it out of what it shows — one rule for both.
 */
export interface MessageRowState {
  readonly status?: string;
  readonly error?: string;
}

export function isRunningReply(row: MessageRowState): boolean {
  return row.status === 'pending' && row.error === undefined;
}

/** All rows but the running reply. The array keeps its identity when
 * nothing is left out. */
export function withoutRunningReply<T extends MessageRowState>(
  rows: readonly T[],
): readonly T[] {
  return rows.some(isRunningReply)
    ? rows.filter((row) => !isRunningReply(row))
    : rows;
}
