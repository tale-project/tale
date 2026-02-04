import type { MutationCtx } from '../../_generated/server';

export interface EntraGroup {
  id: string;
  displayName: string;
}

export interface SyncTeamsFromGroupsArgs {
  ctx: MutationCtx;
  userId: string;
  accessToken: string;
  excludeGroups: string[];
}

export interface SyncTeamsResult {
  teamsCreated: number;
  membershipsAdded: number;
  membershipsRemoved: number;
  errors: string[];
}

export interface Team {
  _id: string;
  name: string;
  organizationId: string;
}
