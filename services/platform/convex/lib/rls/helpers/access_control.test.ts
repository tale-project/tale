import { describe, expect, it } from 'vitest';

import { authorizeRls } from './access_control';

/**
 * Verify that the static permission table in access_control.ts
 * matches the role definitions previously in auth.ts.
 */

const ALL_TABLES = [
  'customAgents',
  'documents',
  'products',
  'customers',
  'vendors',
  'integrations',
  'onedriveSyncConfigs',
  'conversations',
  'conversationMessages',
  'wfDefinitions',
  'wfStepDefs',
  'wfStepAuditLogs',
  'wfExecutions',
  'approvals',
  'websites',
  'workflowProcessingRecords',
  'auditLogs',
] as const;

type Table = (typeof ALL_TABLES)[number];

describe('authorizeRls', () => {
  describe('admin role', () => {
    it('has full read/write access to all tables', () => {
      for (const table of ALL_TABLES) {
        expect(authorizeRls('admin', table, 'read')).toBe(true);
        expect(authorizeRls('admin', table, 'write')).toBe(true);
      }
    });
  });

  describe('developer role', () => {
    it('has full read/write access to all tables', () => {
      for (const table of ALL_TABLES) {
        expect(authorizeRls('developer', table, 'read')).toBe(true);
        expect(authorizeRls('developer', table, 'write')).toBe(true);
      }
    });
  });

  describe('editor role', () => {
    const fullAccess: Table[] = [
      'customAgents',
      'documents',
      'products',
      'customers',
      'vendors',
      'conversations',
      'conversationMessages',
      'approvals',
      'websites',
      'auditLogs',
    ];
    const readOnly: Table[] = [
      'integrations',
      'onedriveSyncConfigs',
      'wfDefinitions',
      'wfStepDefs',
      'wfStepAuditLogs',
      'wfExecutions',
      'workflowProcessingRecords',
    ];

    it('has read/write access to editable tables', () => {
      for (const table of fullAccess) {
        expect(authorizeRls('editor', table, 'read')).toBe(true);
        expect(authorizeRls('editor', table, 'write')).toBe(true);
      }
    });

    it('has read-only access to restricted tables', () => {
      for (const table of readOnly) {
        expect(authorizeRls('editor', table, 'read')).toBe(true);
        expect(authorizeRls('editor', table, 'write')).toBe(false);
      }
    });
  });

  describe('member role', () => {
    it('has read-only access to all tables', () => {
      for (const table of ALL_TABLES) {
        expect(authorizeRls('member', table, 'read')).toBe(true);
        expect(authorizeRls('member', table, 'write')).toBe(false);
      }
    });
  });

  describe('disabled role', () => {
    it('has no access to any table', () => {
      for (const table of ALL_TABLES) {
        expect(authorizeRls('disabled', table, 'read')).toBe(false);
        expect(authorizeRls('disabled', table, 'write')).toBe(false);
      }
    });
  });

  describe('role normalization', () => {
    it('defaults undefined role to member', () => {
      expect(authorizeRls(undefined, 'documents', 'read')).toBe(true);
      expect(authorizeRls(undefined, 'documents', 'write')).toBe(false);
    });

    it('normalizes to lowercase', () => {
      expect(authorizeRls('Admin', 'documents', 'write')).toBe(true);
      expect(authorizeRls('DEVELOPER', 'documents', 'write')).toBe(true);
    });

    it('falls back to member for unknown roles', () => {
      expect(authorizeRls('superadmin', 'documents', 'read')).toBe(true);
      expect(authorizeRls('superadmin', 'documents', 'write')).toBe(false);
    });
  });
});
