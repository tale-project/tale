/**
 * `projects` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../projects.ts` are what
 * actually serve them.
 */

export interface ProjectsContract {
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
  'projects/mutations:moveThreadToProject': {
    kind: 'mutation';
    args: { projectId: null | string; threadId: string };
    returns: null;
  };
  'projects/mutations:restoreProject': {
    kind: 'mutation';
    args: { projectId: string };
    returns: null;
  };
  'projects/mutations:setProjectPinned': {
    kind: 'mutation';
    args: { projectId: string; pinned: boolean };
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
  'projects/mutations:updateProjectAgentSettings': {
    kind: 'mutation';
    args: {
      recommendedAgentSlugs?: string[];
      allowedAgentSlugs?: string[];
      projectId: string;
      agentMode: 'all' | 'recommended' | 'restricted';
    };
    returns: null;
  };
  'projects/mutations:updateProjectConnectorSettings': {
    kind: 'mutation';
    args: {
      allowedConnectorSlugs?: string[];
      projectId: string;
      connectorsMode: 'all' | 'restricted';
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
  'projects/mutations:updateProjectKnowledgeMode': {
    kind: 'mutation';
    args: {
      projectId: string;
      knowledgeMode: 'context' | 'tool' | 'off' | 'both';
    };
    returns: null;
  };
  'projects/mutations:updateProjectModelSettings': {
    kind: 'mutation';
    args: {
      recommendedModels?: string[];
      allowedModels?: string[];
      projectId: string;
      modelMode: 'all' | 'recommended' | 'restricted';
    };
    returns: null;
  };
  'projects/mutations:updateProjectSharing': {
    kind: 'mutation';
    args: {
      teamId?: null | string;
      sharedWithTeamIds?: string[];
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
      taskCounter?: number;
      openTaskCount?: number;
      doneTaskCount?: number;
      projectAgentCount?: number;
      taskLabelColors?: Record<string, string>;
      sharedWithTeamIds?: string[];
      knowledgeMode?: 'context' | 'tool' | 'off' | 'both';
      agentMode?: 'all' | 'recommended' | 'restricted';
      recommendedAgentSlugs?: string[];
      allowedAgentSlugs?: string[];
      agentCapabilities?: Record<
        string,
        { connectors: string[]; skills: string[] }
      >;
      modelMode?: 'all' | 'recommended' | 'restricted';
      recommendedModels?: string[];
      allowedModels?: string[];
      connectorsMode?: 'all' | 'restricted';
      allowedConnectorSlugs?: string[];
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
    }>;
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
        taskCounter?: number;
        openTaskCount?: number;
        doneTaskCount?: number;
        projectAgentCount?: number;
        taskLabelColors?: Record<string, string>;
        sharedWithTeamIds?: string[];
        knowledgeMode?: 'context' | 'tool' | 'off' | 'both';
        agentMode?: 'all' | 'recommended' | 'restricted';
        recommendedAgentSlugs?: string[];
        allowedAgentSlugs?: string[];
        agentCapabilities?: Record<
          string,
          { connectors: string[]; skills: string[] }
        >;
        modelMode?: 'all' | 'recommended' | 'restricted';
        recommendedModels?: string[];
        allowedModels?: string[];
        connectorsMode?: 'all' | 'restricted';
        allowedConnectorSlugs?: string[];
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
          taskCounter?: number;
          openTaskCount?: number;
          doneTaskCount?: number;
          projectAgentCount?: number;
          taskLabelColors?: Record<string, string>;
          sharedWithTeamIds?: string[];
          knowledgeMode?: 'context' | 'tool' | 'off' | 'both';
          agentMode?: 'all' | 'recommended' | 'restricted';
          recommendedAgentSlugs?: string[];
          allowedAgentSlugs?: string[];
          agentCapabilities?: Record<
            string,
            { connectors: string[]; skills: string[] }
          >;
          modelMode?: 'all' | 'recommended' | 'restricted';
          recommendedModels?: string[];
          allowedModels?: string[];
          connectorsMode?: 'all' | 'restricted';
          allowedConnectorSlugs?: string[];
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
