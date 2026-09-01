import {
  AbilityBuilder,
  createMongoAbility,
  type MongoAbility,
} from '@casl/ability';

/**
 * Platform resource subjects — matches the server-side access keys in backend/auth/access.ts.
 */
export type PlatformResource =
  | 'approvals'
  | 'auditLogs'
  | 'conversationMessages'
  | 'conversations'
  | 'agents'
  | 'contacts'
  | 'documents'
  | 'connectors'
  | 'onedriveSyncConfigs'
  | 'googleDriveSyncConfigs'
  | 'products'
  | 'projects'
  | 'websites'
  | 'wfDefinitions' // file-based workflows UI permission subject (relic id — DB-backed workflows removed)
  | 'wfExecutions'
  | 'workflowProcessingRecords';

/**
 * UI-level subjects that gate access to specific sections of the app.
 * These are not Convex resources — they represent frontend route/section access.
 */
export type UiSubject =
  /** Admin-only sections: organization settings, teams, branding, audit logs */
  | 'orgSettings'
  /** Admin + developer sections: connectors, API keys */
  | 'developerSettings'
  /** All roles except disabled: can view knowledge resources (documents, products, etc.) */
  | 'knowledgeRead'
  /** Editor + admin + developer: can write knowledge resources (documents, products, etc.) */
  | 'knowledgeWrite'
  /** Admin only: can manage (add/edit/delete) org members */
  | 'members';

export type AppSubject = PlatformResource | UiSubject | 'all';
export type AppAction = 'read' | 'write';
export type AppAbility = MongoAbility<[AppAction, AppSubject]>;

/**
 * Builds a CASL ability instance for the given platform role.
 * Mirrors the permission matrix defined in backend/auth/access.ts.
 */
export function defineAbilityFor(role: string | null): AppAbility {
  const { can, cannot, build } = new AbilityBuilder<AppAbility>(
    createMongoAbility,
  );
  const normalized = (role ?? '').toLowerCase();

  switch (normalized) {
    case 'owner':
    case 'admin': {
      // 'all' covers every subject including orgSettings, developerSettings, members, etc.
      can('read', 'all');
      can('write', 'all');
      break;
    }
    case 'developer': {
      can('read', 'all');
      can('write', 'all');
      can('read', 'developerSettings');
      can('write', 'knowledgeWrite');
      // developers cannot manage org settings or members
      cannot('read', 'orgSettings');
      cannot('write', 'orgSettings');
      cannot('write', 'members');
      // audit-log reads are admin-only (#1505)
      cannot('read', 'auditLogs');
      break;
    }
    case 'editor': {
      // read + write on content resources
      const contentResources: PlatformResource[] = [
        'approvals',
        'conversationMessages',
        'conversations',
        'agents',
        'contacts',
        'documents',
        'products',
        'projects',
        'websites',
      ];
      for (const resource of contentResources) {
        can('read', resource);
        can('write', resource);
      }
      // read-only on workflow/connector resources;
      // audit-log reads are admin-only (#1505)
      const readOnlyResources: PlatformResource[] = [
        'connectors',
        'onedriveSyncConfigs',
        'googleDriveSyncConfigs',
        'wfDefinitions',
        'wfExecutions',
        'workflowProcessingRecords',
      ];
      for (const resource of readOnlyResources) {
        can('read', resource);
      }
      can('read', 'knowledgeRead');
      can('write', 'knowledgeWrite');
      break;
    }
    case 'member': {
      can('read', 'all');
      can('read', 'knowledgeRead');
      cannot('read', 'orgSettings');
      cannot('read', 'developerSettings');
      // audit-log reads are admin-only (#1505)
      cannot('read', 'auditLogs');
      break;
    }
    default: {
      // 'disabled' and unknown roles: no permissions
      break;
    }
  }

  return build();
}
