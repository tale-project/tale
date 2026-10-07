/**
 * Authority rank of an organization role, for the strict-outrank rules —
 * who may reset whose credential, who may make an API key that acts as
 * whom. Higher is more authority. An unknown role ranks 0: it outranks
 * nobody (fail closed).
 */
const ROLE_RANK: Readonly<Record<string, number>> = {
  owner: 5,
  admin: 4,
  developer: 3,
  editor: 2,
  member: 1,
  disabled: 0,
};

export function roleRank(role: string): number {
  return ROLE_RANK[role.toLowerCase()] ?? 0;
}
