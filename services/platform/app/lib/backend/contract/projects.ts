/**
 * `projects` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../projects.ts` are what
 * actually serve them.
 */

import type { SetProjectTaskReviewerInput } from '@tale/shared/schemas/task-review';

export interface ProjectsContract {
  'projects/mutations:setProjectTaskReviewer': {
    kind: 'mutation';
    args: SetProjectTaskReviewerInput & { projectId: string };
    returns: null;
  };
  'projects/mutations:archiveProject': {
    kind: 'mutation';
    args: { projectId: string };
    returns: null;
  };
  'projects/mutations:createProject': {
    kind: 'mutation';
    args: {
      key?: string;
      description?: string;
      teamId?: string;
      externalItemId?: string;
      icon?: string;
      color?: string;
      sharedWithTeamIds?: string[];
      /** The audience — every team the project is scoped to; [] = org-wide. */
      teamIds?: string[];
      organizationId: string;
      name: string;
    };
    returns: string;
  };
  'projects/mutations:createProjectAgent': {
    kind: 'mutation';
    args: {
      secrets?: string[];
      modelProvider?: string;
      tools?: string[];
      instructions?: string;
      connectors: string[];
      skills: string[];
      name: string;
      projectId: string;
      harness: string;
      model: string;
    };
    returns: string;
  };
  'projects/mutations:deleteProject': {
    kind: 'mutation';
    args: {
      confirmPhrase?: string;
      projectId: string;
      mode: 'detach' | 'cascade';
    };
    returns: {
      detachedDocCount: number;
      detachedThreadCount: number;
      cascadedDocCount: number;
      cascadedThreadCount: number;
    };
  };
  'projects/mutations:deleteProjectAgent': {
    kind: 'mutation';
    args: { agentId: string };
    returns: null;
  };
  'projects/mutations:ensureStandardAgent': {
    kind: 'mutation';
    /** The project's standard agent, created when the project has no agents
     * of its own yet. */
    args: { projectId: string };
    returns: { agentId: string; created: boolean };
  };
  'projects/mutations:detachDocumentFromProject': {
    kind: 'mutation';
    args: { documentId: string; destination: 'organization' };
    returns: null;
  };
  'projects/mutations:duplicateProject': {
    kind: 'mutation';
    args: { name?: string; projectId: string };
    returns: string;
  };
  'projects/mutations:restoreProject': {
    kind: 'mutation';
    args: { projectId: string };
    returns: null;
  };
  'projects/mutations:updateProjectAgent': {
    kind: 'mutation';
    args: {
      secrets?: string[];
      modelProvider?: string;
      tools?: string[];
      instructions?: string;
      connectors: string[];
      skills: string[];
      name: string;
      harness: string;
      model: string;
      agentId: string;
    };
    returns: null;
  };
  'projects/mutations:updateProjectIdentity': {
    kind: 'mutation';
    args: {
      name?: string;
      description?: null | string;
      icon?: null | string;
      color?: null | string;
      projectId: string;
    };
    returns: null;
  };
  'projects/mutations:updateProjectInstructions': {
    kind: 'mutation';
    args: { projectId: string; instructions: string };
    returns: null;
  };
  'projects/mutations:updateProjectSharing': {
    kind: 'mutation';
    args: {
      teamId?: null | string;
      sharedWithTeamIds?: string[];
      /** The audience — every team the project is scoped to; [] = org-wide. */
      teamIds?: string[];
      projectId: string;
    };
    returns: null;
  };
  'projects/queries:getProject': {
    kind: 'query';
    args: { organizationId: string; projectId: string };
    returns: null | {
      isOrgWide: boolean;
      canEdit: boolean;
      canAdminister: boolean;
      _id: string;
      _creationTime: number;
      pinnedAt?: number;
      key?: string;
      description?: string;
      teamId?: string;
      externalItemId?: string;
      instructions?: string;
      icon?: string;
      color?: string;
      defaultTaskReviewerAgentId?: string;
      taskCounter?: number;
      openTaskCount?: number;
      doneTaskCount?: number;
      projectAgentCount?: number;
      taskLabelColors?: Record<string, string>;
      sharedWithTeamIds?: string[];
      /** The audience — every team the project is scoped to; [] = org-wide. */
      teamIds?: string[];
      agentCapabilities?: Record<
        string,
        { connectors: string[]; skills: string[] }
      >;
      archivedAt?: number;
      organizationId: string;
      name: string;
      createdBy: string;
      createdAt: number;
      updatedAt: number;
    };
  };
  'projects/queries:listAccessibleUserIds': {
    kind: 'query';
    args: { organizationId: string; projectId: string };
    returns: { orgWide: boolean; userIds: string[] };
  };
  'projects/queries:listProjectAgents': {
    kind: 'query';
    args: { organizationId: string; projectId: string };
    returns: Array<{
      secrets?: string[];
      model?: string;
      modelProvider?: string;
      tools?: string[];
      instructions?: string;
      connectors: string[];
      skills: string[];
      organizationId: string;
      name: string;
      projectId: string;
      createdBy: string;
      createdAt: number;
      _creationTime: number;
      updatedAt: number;
      harness: string;
      _id: string;
      /** The organization's standard agent: its settings follow the
       * `standard_agent` policy, so it is never edited here. */
      managed: boolean;
    }>;
  };
  'projects/queries:getStandardAgent': {
    kind: 'query';
    args: { organizationId: string };
    /** Whether the caller can hand work to the organization's standard
     * agent now, and what it would run on. */
    returns: {
      enabled: boolean;
      available: boolean;
      refusal?:
        | 'off'
        | 'unreadable'
        | 'harness-invalid'
        | 'no-model'
        | 'pin-unavailable';
      harness?: string;
      harnessLabel?: string;
      model?: string;
      modelLabel?: string;
      modelProvider?: string;
      source?: 'pinned' | 'preferred' | 'cheapest';
    };
  };
  'projects/queries:listProjectDocuments': {
    kind: 'query';
    args: { organizationId: string; projectId: string };
    returns: Array<{
      _id: string;
      _creationTime: number;
      title: undefined | string;
      fileId: undefined | string;
      mimeType: undefined | string;
      extension: undefined | string;
      folderId: undefined | string;
      indexed: boolean;
      ragStatus:
        | null
        | 'queued'
        | 'running'
        | 'failed'
        | 'completed'
        | 'unsupported';
      createdBy: undefined | string;
      sourceProvider: undefined | string;
      record:
        | undefined
        | {
            reviewerUserId?: string;
            currentFileId?: string;
            reviewerName?: string;
            hasApprovedVersions?: boolean;
            version: number;
            state: 'approved' | 'draft' | 'in_review';
          };
    }>;
  };
  'projects/queries:listProjectFolders': {
    kind: 'query';
    args: { organizationId: string; projectId: string };
    returns: Array<{ _id: string; name: string; parentId: undefined | string }>;
  };
  'projects/queries:listProjects': {
    kind: 'query';
    args: { includeArchived?: boolean; organizationId: string };
    returns: Array<
      {
        _id: string;
        _creationTime: number;
        pinnedAt?: number;
        key?: string;
        description?: string;
        teamId?: string;
        externalItemId?: string;
        instructions?: string;
        icon?: string;
        color?: string;
        defaultTaskReviewerAgentId?: string;
        taskCounter?: number;
        openTaskCount?: number;
        doneTaskCount?: number;
        projectAgentCount?: number;
        taskLabelColors?: Record<string, string>;
        sharedWithTeamIds?: string[];
        /** The audience — every team the project is scoped to; [] = org-wide. */
        teamIds?: string[];
        agentCapabilities?: Record<
          string,
          { connectors: string[]; skills: string[] }
        >;
        archivedAt?: number;
        organizationId: string;
        name: string;
        createdBy: string;
        createdAt: number;
        updatedAt: number;
      } & { isOrgWide: boolean; canEdit: boolean; canAdminister: boolean }
    >;
  };
  'projects/queries:listProjectsOverview': {
    kind: 'query';
    args: { includeArchived?: boolean; asOf?: number; organizationId: string };
    returns: {
      projects: Array<
        {
          _id: string;
          _creationTime: number;
          pinnedAt?: number;
          key?: string;
          description?: string;
          teamId?: string;
          externalItemId?: string;
          instructions?: string;
          icon?: string;
          color?: string;
          defaultTaskReviewerAgentId?: string;
          taskCounter?: number;
          openTaskCount?: number;
          doneTaskCount?: number;
          projectAgentCount?: number;
          taskLabelColors?: Record<string, string>;
          sharedWithTeamIds?: string[];
          /** The audience — every team the project is scoped to; [] = org-wide. */
          teamIds?: string[];
          agentCapabilities?: Record<
            string,
            { connectors: string[]; skills: string[] }
          >;
          archivedAt?: number;
          organizationId: string;
          name: string;
          createdBy: string;
          createdAt: number;
          updatedAt: number;
        } & { isOrgWide: boolean; canEdit: boolean; canAdminister: boolean } & {
          openTaskCount: number;
          doneTaskCount: number;
          projectAgentCount: number;
          overdueTaskCount: number;
        }
      >;
      overdueTruncated: boolean;
    };
  };
  'projects/queries:listSidebarProjects': {
    kind: 'query';
    args: { limit?: number; organizationId: string };
    returns: Array<{
      _id: string;
      name: string;
      icon?: string;
      color?: string;
      updatedAt: number;
    }>;
  };
  'projects/queries:searchProjects': {
    kind: 'query';
    args: { limit?: number; organizationId: string; query: string };
    returns: Array<{
      _id: string;
      name: string;
      icon: undefined | string;
      color: undefined | string;
    }>;
  };
  'projects/search:searchProjects': {
    kind: 'query';
    args: { organizationId: string; query: string };
    returns: Array<{
      projectId: string;
      name: string;
      key?: string;
      snippet: string;
      updatedAt: number;
      archived?: true;
    }>;
  };
  'projects/secrets/actions:deleteProjectSecret': {
    kind: 'action';
    args: { organizationId: string; name: string; projectId: string };
    returns: null;
  };
  'projects/secrets/actions:setProjectSecret': {
    kind: 'action';
    args: {
      description?: string;
      organizationId: string;
      name: string;
      projectId: string;
      value: string;
    };
    returns: null;
  };
  'projects/secrets/actions:setProjectSecretPair': {
    kind: 'action';
    args: {
      description?: string;
      organizationId: string;
      projectId: string;
      password: string;
      username: string;
      baseName: string;
    };
    returns: null;
  };
  'projects/secrets/queries:listProjectSecrets': {
    kind: 'query';
    args: { projectId: string };
    returns: Array<{
      name: string;
      description?: string;
      updatedAt: number;
      updatedBy: string;
    }>;
  };
}
