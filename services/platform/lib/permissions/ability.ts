import {
  AbilityBuilder,
  createMongoAbility,
  type MongoAbility,
} from '@casl/ability';

/**
 * Platform resource subjects — matches the Convex RLS table keys in convex/auth.ts.
 */
export type PlatformResource =
  | 'approvals'
  | 'auditLogs'
  | 'conversationMessages'
  | 'conversations'
  | 'customAgents'
  | 'customers'
  | 'documents'
  | 'integrations'
  | 'onedriveSyncConfigs'
  | 'products'
  | 'vendors'
  | 'websites'
  | 'wfDefinitions'
  | 'wfExecutions'
  | 'wfStepAuditLogs'
  | 'wfStepDefs'
  | 'workflowProcessingRecords';

/**
 * UI-level subjects that gate access to specific sections of the app.
 * These are not Convex resources — they represent frontend route/section access.
 */
export type UiSubject =
  /** Admin-only sections: organization settings, teams, branding, audit logs */
  | 'orgSettings'
  /** Admin + developer sections: integrations, API keys */
  | 'developerSettings'
  /** Editor + admin + developer: can write knowledge resources (documents, products, etc.) */
  | 'knowledgeWrite'
  /** Admin only: can manage (add/edit/delete) org members */
  | 'members';

export type AppSubject = PlatformResource | UiSubject | 'all';
export type AppAction = 'read' | 'write';
export type AppAbility = MongoAbility<[AppAction, AppSubject]>;

/**
 * Builds a CASL ability instance for the given platform role.
 * Mirrors the permission matrix defined in convex/auth.ts.
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
      cannot('write', 'members');
      break;
    }
    case 'editor': {
      // read + write on content resources
      const contentResources: PlatformResource[] = [
        'approvals',
        'conversationMessages',
        'conversations',
        'customAgents',
        'customers',
        'documents',
        'products',
        'vendors',
        'websites',
      ];
      for (const resource of contentResources) {
        can('read', resource);
        can('write', resource);
      }
      // read-only on workflow/integration resources
      const readOnlyResources: PlatformResource[] = [
        'auditLogs',
        'integrations',
        'onedriveSyncConfigs',
        'wfDefinitions',
        'wfExecutions',
        'wfStepAuditLogs',
        'wfStepDefs',
        'workflowProcessingRecords',
      ];
      for (const resource of readOnlyResources) {
        can('read', resource);
      }
      can('write', 'knowledgeWrite');
      break;
    }
    case 'member': {
      can('read', 'all');
      cannot('read', 'orgSettings');
      cannot('read', 'developerSettings');
      break;
    }
    default: {
      // 'disabled' and unknown roles: no permissions
      break;
    }
  }

  return build();
}
