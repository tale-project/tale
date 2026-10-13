import {
  ACCESS_LEVELS,
  type AccessLevel,
  AGENT_SCOPES,
  type AgentScope,
  levelOf,
} from '@/lib/shared/agent-access';

/**
 * What a person can choose when they connect a coding agent, and what it
 * comes to: the levels and extras the app asked for and their role allows,
 * what is offered at first, the scopes a choice makes, and the lines that
 * say what it lets the agent do. The consent gate judges the same things
 * again when they connect (`backend/auth/agent-consent.ts`); this only keeps
 * the page from offering what the gate would refuse.
 */

/** The access levels in the order they grow, each adding to the one before. */
export const ACCESS_LEVEL_ORDER: readonly AccessLevel[] = [
  'read',
  'edit',
  'deploy',
];

/** The scopes that are a choice of their own, beside the level. */
export const EXTRA_SCOPES = [
  'tale:settings.read',
  'tale:settings.write',
  'tale:subscriptions.connect',
] as const satisfies readonly AgentScope[];

export type ExtraScope = (typeof EXTRA_SCOPES)[number];

/** Why a scope is not on offer: the app did not ask for it, or the person's
 * role there does not allow it. */
export type Unavailable = 'notRequested' | 'roleCannot';

/** What the app asked for and what the role allows, for one organization. */
export interface ConsentOffer {
  requested: ReadonlySet<string>;
  ceiling: ReadonlySet<string>;
}

export interface AccessChoice {
  level: AccessLevel;
  extras: ReadonlySet<ExtraScope>;
}

function missing(
  scopes: readonly string[],
  offer: ConsentOffer,
): Unavailable | null {
  if (scopes.some((scope) => !offer.requested.has(scope))) {
    return 'notRequested';
  }
  if (scopes.some((scope) => !offer.ceiling.has(scope))) return 'roleCannot';
  return null;
}

/** Whether a level is on offer, and why not when it is not. */
export function levelAvailability(
  level: AccessLevel,
  offer: ConsentOffer,
): Unavailable | null {
  return missing(ACCESS_LEVELS[level], offer);
}

/** The scopes an extra comes with: changing settings reads them too. */
function extraScopes(extra: ExtraScope): readonly AgentScope[] {
  return extra === 'tale:settings.write'
    ? ['tale:settings.read', 'tale:settings.write']
    : [extra];
}

/** Whether an extra is on offer, and why not when it is not. */
export function extraAvailability(
  extra: ExtraScope,
  offer: ConsentOffer,
): Unavailable | null {
  return missing(extraScopes(extra), offer);
}

/**
 * What is chosen when the page opens, or null when nothing can be: no
 * level is on offer (the app asked for less than reading and testing, or the
 * role allows nothing).
 *
 * An app that asks for less than everything is taken at its word, held to
 * the role: the most it asked for and the role allows. One that asks for
 * everything gets what the person chose here before, and for a first
 * connection editing, or reading and testing where editing is not allowed;
 * deploying is never offered unasked, and the extras start unchecked.
 */
export function initialChoice(
  offer: ConsentOffer,
  previous: readonly string[] | null,
): AccessChoice | null {
  const levels = ACCESS_LEVEL_ORDER.filter(
    (level) => levelAvailability(level, offer) === null,
  );
  const highest = levels.at(-1);
  if (highest === undefined) return null;
  const extras = EXTRA_SCOPES.filter(
    (extra) => extraAvailability(extra, offer) === null,
  );
  const asksEverything = AGENT_SCOPES.every((scope) =>
    offer.requested.has(scope),
  );
  if (!asksEverything) return { level: highest, extras: new Set(extras) };
  if (previous !== null) {
    const before = levelOf(previous);
    const held = before === null ? 'read' : before;
    const level = levels.includes(held) ? held : highest;
    return {
      level,
      extras: new Set(extras.filter((extra) => previous.includes(extra))),
    };
  }
  return {
    level: levels.includes('edit') ? 'edit' : highest,
    extras: new Set(),
  };
}

/** Whether a choice is still one the offer allows: its level and every extra
 * are on offer. */
export function isChoiceOnOffer(
  choice: AccessChoice,
  offer: ConsentOffer,
): boolean {
  return (
    levelAvailability(choice.level, offer) === null &&
    [...choice.extras].every(
      (extra) => extraAvailability(extra, offer) === null,
    )
  );
}

/** A choice with an extra switched on or off: changing settings brings
 * reading them along, and reading them stays on while they can be changed. */
export function withExtra(
  choice: AccessChoice,
  extra: ExtraScope,
  on: boolean,
): AccessChoice {
  const extras = new Set(choice.extras);
  if (on) {
    extras.add(extra);
    if (extra === 'tale:settings.write') extras.add('tale:settings.read');
  } else {
    // Reading settings stays while changing them is allowed.
    if (
      extra === 'tale:settings.read' &&
      choice.extras.has('tale:settings.write')
    ) {
      return choice;
    }
    extras.delete(extra);
  }
  return { level: choice.level, extras };
}

/** The scopes a choice allows, in the order the scopes are taught. */
export function chosenScopes(choice: AccessChoice): AgentScope[] {
  const held = new Set<AgentScope>(ACCESS_LEVELS[choice.level]);
  for (const extra of choice.extras) {
    for (const scope of extraScopes(extra)) held.add(scope);
  }
  return AGENT_SCOPES.filter((scope) => held.has(scope));
}

/** One line of what the choice lets the agent do. */
export interface ConsentSummaryLine {
  scope: AgentScope;
  allowed: boolean;
  /** Why not, when the role does not allow it; a scope left unchecked is
   * simply not allowed. */
  why?: 'roleCannot';
}

/** The lines for every scope the app asked for, in the order they are
 * taught: what the choice allows and what it does not. */
export function summaryOf(
  choice: AccessChoice,
  offer: ConsentOffer,
): ConsentSummaryLine[] {
  const chosen = new Set(chosenScopes(choice));
  return AGENT_SCOPES.filter((scope) => offer.requested.has(scope)).map(
    (scope): ConsentSummaryLine => {
      const allowed = chosen.has(scope);
      return !allowed && !offer.ceiling.has(scope)
        ? { scope, allowed, why: 'roleCannot' }
        : { scope, allowed };
    },
  );
}

/** An organization of the consent context, as far as the choice reads it. */
export interface OrganizationOption {
  id: string;
  allowed: boolean;
}

/** The organization to start on: the one the person is working in when they
 * may connect an agent there, else the first they may. Null when none. */
export function defaultOrganizationId(
  organizations: readonly OrganizationOption[],
  activeOrganizationId: string | null,
): string | null {
  const allowed = organizations.filter((organization) => organization.allowed);
  return (
    allowed.find((organization) => organization.id === activeOrganizationId)
      ?.id ??
    allowed[0]?.id ??
    null
  );
}
