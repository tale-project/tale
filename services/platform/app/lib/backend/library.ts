/**
 * The library verticals over the 0.5 backend: AGENTS (read surfaces — the
 * settings page edits ride later servers) and SKILLS (the full file-backed
 * CRUD + the bundle-upload lane). Both are org-config FILE families, so
 * every read is an ACTION_QUERY row; the staged skill zip travels the org
 * byte lane exactly like the automation pack.
 */

import type { ReturnsOf } from '@/app/lib/backend/contract';

import type {
  ActionQueryAdapter,
  AdapterContext,
  WriteAdapter,
} from './adapters';
import { backendFetch, backendUrl } from './api-client';

type AgentListingResult = ReturnsOf<'agents/actions:listAgents'>;
type AgentDocumentResult = ReturnsOf<'agents/actions:getAgent'>;
type SkillListingResult = ReturnsOf<'skills/actions:listSkills'>;
type SkillDocumentResult = ReturnsOf<'skills/actions:getSkill'>;
type SkillAssetResult = ReturnsOf<'skills/actions:getSkillAsset'>;
type SaveSkillResult = ReturnsOf<'skills/actions:saveSkill'>;
type UploadSkillBundleResult = ReturnsOf<'skills/actions:uploadSkillBundle'>;

function orgOf(
  args: Record<string, unknown>,
  ctx: AdapterContext,
): string | undefined {
  const fromArgs = args.organizationId;
  if (typeof fromArgs === 'string' && fromArgs.length > 0) return fromArgs;
  return ctx.organizationId;
}

function requireOrg(
  args: Record<string, unknown>,
  ctx: AdapterContext,
): string {
  const orgId = orgOf(args, ctx);
  if (orgId === undefined) {
    throw new Error('No active organization for adapted write');
  }
  return orgId;
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing ${key} for adapted write`);
  }
  return value;
}

export const libraryActionQueryAdapters: Record<string, ActionQueryAdapter> = {
  'agents/actions:listAgents': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return () => backendFetch<AgentListingResult>('/agents', { orgId });
  },
  'agents/actions:getAgent': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const slug = args.slug;
    if (orgId === undefined || typeof slug !== 'string' || slug === '') {
      return null;
    }
    return () =>
      backendFetch<{ agent: AgentDocumentResult }>(
        `/agents/${encodeURIComponent(slug)}`,
        { orgId },
      ).then(
        (body) => body.agent,
        (error: unknown) => {
          if (isNotFound(error)) return null;
          throw error;
        },
      );
  },
  'skills/actions:listSkills': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    if (orgId === undefined) return null;
    return () => backendFetch<SkillListingResult>('/skills', { orgId });
  },
  'skills/actions:getSkill': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const slug = args.slug;
    if (orgId === undefined || typeof slug !== 'string' || slug === '') {
      return null;
    }
    return () =>
      backendFetch<{ skill: SkillDocumentResult }>(
        `/skills/${encodeURIComponent(slug)}`,
        { orgId },
      ).then(
        (body) => body.skill,
        (error: unknown) => {
          if (isNotFound(error)) return null;
          throw error;
        },
      );
  },
  'skills/actions:getSkillAsset': (args, ctx) => {
    const orgId = orgOf(args, ctx);
    const slug = args.slug;
    const path = args.path;
    if (
      orgId === undefined ||
      typeof slug !== 'string' ||
      slug === '' ||
      typeof path !== 'string' ||
      path === ''
    ) {
      return null;
    }
    return () =>
      backendFetch<{ asset: SkillAssetResult }>(
        `/skills/${encodeURIComponent(slug)}/assets/${path
          .split('/')
          .map(encodeURIComponent)
          .join('/')}`,
        { orgId },
      ).then(
        (body) => body.asset,
        (error: unknown) => {
          if (isNotFound(error)) return null;
          throw error;
        },
      );
  },
};

function isNotFound(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'status' in error &&
    error.status === 404
  );
}

export const libraryWriteAdapters: Record<string, WriteAdapter> = {
  'skills/actions:saveSkill': {
    run: (args, ctx) =>
      backendFetch<{ skill: SaveSkillResult }>(
        `/skills/${encodeURIComponent(stringArg(args, 'slug'))}`,
        {
          orgId: requireOrg(args, ctx),
          method: 'PUT',
          body: {
            description: stringArg(args, 'description'),
            body: typeof args.body === 'string' ? args.body : '',
            ...(typeof args.visibility === 'string'
              ? { visibility: args.visibility }
              : {}),
            ...(Array.isArray(args.teams) ? { teams: args.teams } : {}),
            ...(typeof args.icon === 'string' ? { icon: args.icon } : {}),
            ...(Array.isArray(args.labels) ? { labels: args.labels } : {}),
          },
        },
      ).then((body) => body.skill),
  },
  'skills/actions:deleteSkill': {
    run: (args, ctx) =>
      backendFetch<{ deleted: boolean }>(
        `/skills/${encodeURIComponent(stringArg(args, 'slug'))}`,
        { orgId: requireOrg(args, ctx), method: 'DELETE' },
      ).then((body) => body.deleted),
  },
  'skills/upload_mutations:generateSkillUploadUrl': {
    // The pg byte lane IS the staging handshake: POST bytes → org blob ref.
    // The purpose scopes the upload intent the server records to the skill
    // bundle lane, which consumes it once.
    run: (args, ctx) =>
      Promise.resolve(
        backendUrl('/files/upload?purpose=skill_bundle', requireOrg(args, ctx)),
      ),
  },
  'skills/upload_mutations:recordSkillUploadIntent': {
    // The byte lane records the intent server-side — nothing to add here.
    run: () => Promise.resolve(null),
  },
  'skills/actions:uploadSkillBundle': {
    run: (args, ctx) =>
      backendFetch<UploadSkillBundleResult>('/skills/upload', {
        orgId: requireOrg(args, ctx),
        body: {
          storageId: stringArg(args, 'storageId'),
          ...(args.force === true ? { force: true } : {}),
        },
      }),
  },
};
