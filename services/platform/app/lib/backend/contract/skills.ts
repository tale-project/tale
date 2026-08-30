/**
 * `skills` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../skills.ts` are what
 * actually serve them.
 */

export interface SkillsContract {
  'skills/actions:deleteSkill': {
    kind: 'action';
    args: { organizationId: string; slug: string };
    returns: boolean;
  };
  'skills/actions:getSkill': {
    kind: 'action';
    args: { organizationId: string; slug: string };
    returns: null | {
      body: string;
      files: Array<{ path: string; size: number }>;
      slug: string;
      description: string;
      visibility: 'org' | 'team' | 'private';
      teams?: string[];
      owner?: string;
      icon?: string;
      labels?: string[];
      disableModelInvocation?: boolean;
      canEdit: boolean;
    };
  };
  'skills/actions:getSkillAsset': {
    kind: 'action';
    args: { organizationId: string; slug: string; path: string };
    returns: null | { path: string; contentBase64: string };
  };
  'skills/actions:listSkills': {
    kind: 'action';
    args: { organizationId: string };
    returns: {
      skills: Array<{
        slug: string;
        description: string;
        visibility: 'org' | 'team' | 'private';
        teams?: string[];
        owner?: string;
        icon?: string;
        labels?: string[];
        disableModelInvocation?: boolean;
        canEdit: boolean;
      }>;
      failures: Array<{ slug: string; path: string; message: string }>;
    };
  };
  'skills/actions:saveSkill': {
    kind: 'action';
    args: {
      visibility?: 'org' | 'team' | 'private';
      icon?: string;
      labels?: string[];
      teams?: string[];
      organizationId: string;
      description: string;
      slug: string;
      body: string;
    };
    returns: {
      body: string;
      files: Array<{ path: string; size: number }>;
      slug: string;
      description: string;
      visibility: 'org' | 'team' | 'private';
      teams?: string[];
      owner?: string;
      icon?: string;
      labels?: string[];
      disableModelInvocation?: boolean;
      canEdit: boolean;
    };
  };
  'skills/actions:uploadSkillBundle': {
    kind: 'action';
    args: { force?: boolean; organizationId: string; storageId: string };
    returns:
      | { ok: true; slug: string }
      | { ok: false; status: 'needs_confirm'; slug: string };
  };
  'skills/upload_mutations:generateSkillUploadUrl': {
    kind: 'mutation';
    args: { organizationId: string };
    returns: string;
  };
  'skills/upload_mutations:recordSkillUploadIntent': {
    kind: 'mutation';
    args: { organizationId: string; storageId: string };
    returns: null;
  };
}
