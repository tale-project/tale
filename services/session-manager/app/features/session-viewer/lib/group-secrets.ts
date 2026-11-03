import type {
  SecretKind,
  SecretKindInfo,
  SecretSummary,
} from '@/lib/api/schemas';

/**
 * The secrets of one kind. What the group is called is the person's language
 * to word (`useSecretLabels`), not the server's, which names the kinds in
 * English only.
 */
export interface SecretGroup {
  kind: SecretKind;
  secrets: SecretSummary[];
}

/**
 * The secrets in groups by kind, in the order the server lists its kinds, the
 * newest first within a group as the server sent them. A kind without a secret
 * has no group; one the list does not name comes last.
 */
export function groupSecrets(
  secrets: readonly SecretSummary[],
  kinds: readonly SecretKindInfo[],
): SecretGroup[] {
  const groups = new Map<SecretKind, SecretGroup>();
  for (const kind of kinds) {
    groups.set(kind.key, { kind: kind.key, secrets: [] });
  }
  for (const secret of secrets) {
    let group = groups.get(secret.kind);
    if (group === undefined) {
      group = { kind: secret.kind, secrets: [] };
      groups.set(secret.kind, group);
    }
    group.secrets.push(secret);
  }
  return [...groups.values()].filter((group) => group.secrets.length > 0);
}

/**
 * The first line of a value and how many more it has. A value is typed whole,
 * but only its first line fits a line of the list: the count says that the rest
 * is there. A line break at the end is no line.
 */
export function splitLines(value: string): { first: string; more: number } {
  const [first = '', ...rest] = value.trimEnd().split(/\r?\n/);
  return { first, more: rest.length };
}
