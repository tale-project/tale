/**
 * Index Registry for Smart Index Selection
 *
 * Maps tables to their available indexes for automatic query optimization.
 * This registry enables the find_unprocessed operation to automatically
 * select the most efficient index based on filter expressions.
 */

import type { TableName } from './types';

/**
 * Configuration for a database index
 */
export interface IndexConfig {
  /** Index name as defined in schema */
  name: string;
  /** Fields covered by this index (in order) */
  fields: string[];
}

/**
 * Registry of available indexes per table.
 *
 * Important notes:
 * - All indexes must include 'organizationId' as the first field for multi-tenant filtering
 * - Indexes are listed in priority order (more specific indexes first)
 * - The 'by_organizationId' index is always available as fallback
 */
export const TABLE_INDEXES: Record<TableName, IndexConfig[]> = {
  conversations: [
    {
      name: 'by_organizationId_and_status',
      fields: ['organizationId', 'status'],
    },
    {
      name: 'by_organizationId_and_priority',
      fields: ['organizationId', 'priority'],
    },
    {
      name: 'by_organizationId_and_type',
      fields: ['organizationId', 'type'],
    },
    {
      name: 'by_organizationId_and_channel',
      fields: ['organizationId', 'channel'],
    },
    {
      name: 'by_organizationId_and_direction',
      fields: ['organizationId', 'direction'],
    },
    {
      name: 'by_organizationId_and_customerId',
      fields: ['organizationId', 'customerId'],
    },
    { name: 'by_organizationId', fields: ['organizationId'] },
  ],

  customers: [
    {
      name: 'by_organizationId_and_status',
      fields: ['organizationId', 'status'],
    },
    {
      name: 'by_organizationId_and_source',
      fields: ['organizationId', 'source'],
    },
    {
      name: 'by_organizationId_and_locale',
      fields: ['organizationId', 'locale'],
    },
    { name: 'by_organizationId', fields: ['organizationId'] },
  ],

  products: [
    {
      name: 'by_organizationId_and_status',
      fields: ['organizationId', 'status'],
    },
    {
      name: 'by_organizationId_and_category',
      fields: ['organizationId', 'category'],
    },
    { name: 'by_organizationId', fields: ['organizationId'] },
  ],

  documents: [{ name: 'by_organizationId', fields: ['organizationId'] }],

  approvals: [
    {
      name: 'by_org_status_resourceType',
      fields: ['organizationId', 'status', 'resourceType'],
    },
    { name: 'by_org_status', fields: ['organizationId', 'status'] },
    { name: 'by_organizationId', fields: ['organizationId'] },
  ],

  onedriveSyncConfigs: [
    {
      name: 'by_organizationId_and_status',
      fields: ['organizationId', 'status'],
    },
    { name: 'by_organizationId', fields: ['organizationId'] },
  ],

  websitePages: [
    {
      name: 'by_organizationId_and_status',
      fields: ['organizationId', 'status'],
    },
    {
      name: 'by_organizationId_and_websiteId',
      fields: ['organizationId', 'websiteId'],
    },
    { name: 'by_organizationId', fields: ['organizationId'] },
  ],

  exampleMessages: [
    { name: 'by_organizationId', fields: ['organizationId'] },
  ],
};

/**
 * Get available indexes for a table
 */
export function getTableIndexes(tableName: TableName): IndexConfig[] {
  return TABLE_INDEXES[tableName] || [
    { name: 'by_organizationId', fields: ['organizationId'] },
  ];
}
