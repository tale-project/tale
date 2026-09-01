/**
 * Audit log action constants for the projects feature.
 *
 * Every project mutation writes a `createAuditLog` entry in category `'data'`
 * with `resourceType: 'project'`. Centralizing the action strings here keeps
 * grep-ability tight and makes future i18n key generation deterministic.
 */
export const PROJECT_AUDIT_ACTIONS = {
  created: 'project.created',
  updated: 'project.updated',
  sharingChanged: 'project.sharing.changed',
  instructionsChanged: 'project.instructions.changed',
  knowledgeModeChanged: 'project.knowledge_mode.changed',
  agentsChanged: 'project.agents.changed',
  modelsChanged: 'project.models.changed',
  connectorsChanged: 'project.connectors.changed',
  fileAttached: 'project.file.attached',
  fileDetached: 'project.file.detached',
  threadShared: 'project.thread.shared',
  threadUnshared: 'project.thread.unshared',
  threadMoved: 'project.thread.moved',
  archived: 'project.archived',
  restored: 'project.restored',
  deleted: 'project.deleted',
} as const;

export type ProjectAuditAction =
  (typeof PROJECT_AUDIT_ACTIONS)[keyof typeof PROJECT_AUDIT_ACTIONS];

export const PROJECT_RESOURCE_TYPE = 'project';
