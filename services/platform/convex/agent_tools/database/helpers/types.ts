/**
 * Type definitions for database schema introspection tool
 */

/**
 * Field definition with type information
 */
export interface FieldDefinition {
  field: string;
  type:
    | 'string'
    | 'number'
    | 'boolean'
    | 'datetime'
    | 'enum'
    | 'object'
    | 'array';
  values?: string[]; // For enum types, the valid values
  note?: string; // Additional hints for the AI
}

/**
 * Table schema definition
 */
export interface TableSchemaDefinition {
  tableName: string;
  description: string;
  filterableFields: FieldDefinition[];
  examples: string[];
}

/**
 * Result type for list_tables operation
 */
export interface DatabaseSchemaListTablesResult {
  operation: 'list_tables';
  tables: Array<{
    name: string;
    description: string;
  }>;
  jexlTransforms: string[];
}

/**
 * Result type for get_table_schema operation
 */
export interface DatabaseSchemaGetTableResult {
  operation: 'get_table_schema';
  tableName: string;
  description: string;
  filterableFields: FieldDefinition[];
  jexlTransforms: string[];
  examples: string[];
}

/**
 * Available JEXL transforms for filterExpressions
 */
export const JEXL_TRANSFORMS = [
  'daysAgo',
  'hoursAgo',
  'minutesAgo',
  'parseDate',
  'isBefore',
  'isAfter',
] as const;
