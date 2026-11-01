import { z } from 'zod/v4';

import { epochMsSchema } from './epoch-ms';

/**
 * Allowlist for project icons (lucide-react icon names).
 *
 * Server-enforced via Zod at the project routes (`backend/domains/projects/
 * routes.ts` parses every project body with the schemas below); the avatar
 * (`project-avatar.tsx`) falls back to the default for anything else.
 */
export const PROJECT_ICONS = [
  'FolderKanban',
  'Folder',
  'FolderOpen',
  'FolderTree',
  'FolderGit2',
  'Briefcase',
  'Building2',
  'Layers',
  'Box',
  'BookOpen',
  'GraduationCap',
  'Lightbulb',
  'Rocket',
  'Target',
  'Flag',
  'Compass',
  'Map',
  'Star',
  'Beaker',
  'FlaskConical',
  'Microscope',
  'Atom',
  'Cpu',
  'Code',
  'Heart',
  'Users',
  'MessageSquare',
  'Phone',
  'Mail',
  'Globe',
] as const;
export type ProjectIcon = (typeof PROJECT_ICONS)[number];
export const projectIconSchema = z.enum(PROJECT_ICONS);

/**
 * Allowlist for project colors (token names from the existing palette).
 *
 * Each token resolves to a 50/500/900 triple in the @tale/ui design tokens
 * via the theme resolver. No hex strings on the wire.
 */
export const PROJECT_COLORS = [
  'gray',
  'slate',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
] as const;
export type ProjectColor = (typeof PROJECT_COLORS)[number];
export const projectColorSchema = z.enum(PROJECT_COLORS);

/**
 * Hard caps — the ONE copy. The backend routes parse with the schemas below
 * and the projects service validates with these constants, so the editor's
 * counter and the server's refusal can never disagree again (they did: the
 * service once carried a private 6000-char instructions cap while the editor
 * counted to 20 000). Truncation to the token budget happens at chat time.
 */
export const PROJECT_NAME_MAX = 80;
export const PROJECT_DESCRIPTION_MAX = 500;
export const PROJECT_INSTRUCTIONS_MAX_CHARS = 20_000;
export const PROJECT_SHARED_TEAMS_MAX = 20;
export const PROJECT_AGENT_NAME_MAX = 120;
export const PROJECT_AGENT_MODEL_MAX = 200;
export const PROJECT_AGENT_BINDINGS_MAX = 25;
export const PROJECT_AGENT_INSTRUCTIONS_MAX = 20_000;

const projectNameSchema = z.string().trim().min(1).max(PROJECT_NAME_MAX);

const projectDescriptionSchema = z.string().trim().max(PROJECT_DESCRIPTION_MAX);

const projectInstructionsSchema = z
  .string()
  .max(PROJECT_INSTRUCTIONS_MAX_CHARS);

const teamIdSchema = z.string().min(1);
const sharedWithTeamIdsSchema = z
  .array(teamIdSchema)
  .max(PROJECT_SHARED_TEAMS_MAX);
/** The audience — every team the project is scoped to; empty = org-wide.
 * One more than the shared-teams cap: the former owning team folds in. */
const projectTeamIdsSchema = z
  .array(teamIdSchema)
  .max(PROJECT_SHARED_TEAMS_MAX + 1);

/** The longest name a connector credential carries — the connector
 * credentials' own limit. */
export const PROJECT_AGENT_CREDENTIAL_NAME_MAX = 100;
/** The longest commit author name and email an agent carries. */
export const PROJECT_AGENT_GIT_NAME_MAX = 200;
export const PROJECT_AGENT_GIT_EMAIL_MAX = 254;

/** A connector slug as the catalog names connectors. */
const connectorSlugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a connector slug');

/**
 * Which of the organization's credentials the agent acts as, per connector:
 * a connector slug to the name of one of that connector's credentials. A
 * connector left out uses the organization's default credential for it.
 */
export const projectAgentConnectorCredentialsSchema = z
  .record(
    connectorSlugSchema,
    z.string().trim().min(1).max(PROJECT_AGENT_CREDENTIAL_NAME_MAX),
  )
  .refine(
    (pins) => Object.keys(pins).length <= PROJECT_AGENT_BINDINGS_MAX,
    `An agent pins at most ${PROJECT_AGENT_BINDINGS_MAX} credentials`,
  );
export type ProjectAgentConnectorCredentials = z.infer<
  typeof projectAgentConnectorCredentialsSchema
>;

/** A commit author name git keeps as written: no angle brackets, line
 * breaks or other control characters, which git drops or refuses. */
function isPlainGitName(value: string): boolean {
  // oxlint-disable-next-line no-control-regex -- control characters are exactly what is refused
  return !/[<>\x00-\x1f\x7f]/.test(value);
}

/** The name and email the agent's commits carry, as author and committer;
 * without one they carry Tale's. */
export const projectAgentGitIdentitySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(PROJECT_AGENT_GIT_NAME_MAX)
    .refine(isPlainGitName, 'must not contain <, > or control characters'),
  email: z
    .email()
    .max(PROJECT_AGENT_GIT_EMAIL_MAX)
    .refine(isPlainGitName, 'must not contain <, > or control characters'),
});
export type ProjectAgentGitIdentity = z.infer<
  typeof projectAgentGitIdentitySchema
>;

/** Project-agent saves share one input shape across the session and REST
 * doors. The domain owns harness eligibility, normalization and secret grants. */
export const projectAgentInputSchema = z.object({
  name: z.string().min(1).max(PROJECT_AGENT_NAME_MAX),
  harness: z.string().min(1).max(100),
  model: z.string().min(1).max(PROJECT_AGENT_MODEL_MAX),
  modelProvider: z.string().max(PROJECT_AGENT_MODEL_MAX).optional(),
  skills: z.array(z.string()).max(PROJECT_AGENT_BINDINGS_MAX),
  connectors: z.array(z.string()).max(PROJECT_AGENT_BINDINGS_MAX),
  tools: z.array(z.string()).max(PROJECT_AGENT_BINDINGS_MAX).optional(),
  secrets: z.array(z.string()).max(PROJECT_AGENT_BINDINGS_MAX).optional(),
  connectorCredentials: projectAgentConnectorCredentialsSchema.optional(),
  gitIdentity: projectAgentGitIdentitySchema.nullable().optional(),
  instructions: z.string().max(PROJECT_AGENT_INSTRUCTIONS_MAX).optional(),
});

export const updateProjectAgentInputSchema = projectAgentInputSchema.extend({
  expectedUpdatedAt: epochMsSchema.optional(),
});

export const createProjectInputSchema = z.object({
  organizationId: z.string().min(1),
  name: projectNameSchema,
  description: projectDescriptionSchema.optional(),
  icon: projectIconSchema.optional(),
  color: projectColorSchema.optional(),
  teamIds: projectTeamIdsSchema.optional(),
  /** @deprecated Legacy owning team — folds into `teamIds` first. */
  teamId: teamIdSchema.optional(),
  /** @deprecated Legacy shared teams — fold into `teamIds` after `teamId`. */
  sharedWithTeamIds: sharedWithTeamIdsSchema.optional(),
});

/** `null` clears description/icon/color; an absent field leaves it alone. */
export const updateProjectIdentitySchema = z
  .object({
    name: projectNameSchema,
    description: projectDescriptionSchema.nullable(),
    icon: projectIconSchema.nullable(),
    color: projectColorSchema.nullable(),
  })
  .partial();

export const updateProjectInstructionsSchema = z.object({
  instructions: projectInstructionsSchema,
});

export const updateProjectSharingSchema = z.object({
  teamIds: projectTeamIdsSchema.optional(),
  /** @deprecated Legacy owning team; `null` alone clears the audience. */
  teamId: teamIdSchema.nullable().optional(),
  /** @deprecated Legacy shared teams. */
  sharedWithTeamIds: sharedWithTeamIdsSchema.optional(),
});

export const deleteProjectInputSchema = z
  .object({
    mode: z.enum(['detach', 'cascade']),
    // The phrase must equal the project NAME to pass, so anything past the
    // name cap can never match — bound it before the compare.
    confirmPhrase: z.string().trim().max(PROJECT_NAME_MAX).optional(),
  })
  .refine(
    (value) => value.mode !== 'cascade' || !!value.confirmPhrase?.length,
    {
      message: 'confirmPhrase is required for cascade delete',
      path: ['confirmPhrase'],
    },
  );
