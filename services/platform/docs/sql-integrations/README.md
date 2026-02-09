# SQL Integration Feature

This feature extends the existing integration system to support direct SQL database connections alongside REST API integrations.

## Overview

The SQL integration feature allows you to:

- Connect to SQL databases (MS SQL Server, PostgreSQL, MySQL)
- Define reusable SQL queries as operations
- Use SQL integrations in workflows and agent tools
- Discover database schema with introspection operations
- Maintain all business logic in the database (not code)

## Architecture

### Design Decisions

1. **Native Placeholder Format**: SQL queries use engine-specific placeholders (`@param` for MS SQL, `$1` for Postgres, `?` for MySQL)
2. **Runtime Validation**: Query syntax validated by database engines, not parsers
3. **Connection Pooling**: Pools shared by `(server, database, user)` for efficiency
4. **Read-Only by Default**: Security enforced through keyword blocking
5. **Introspection Built-in**: Schema discovery operations automatically available

### Key Components

```
Integration Action
    ├── Type Discriminator (rest_api | sql)
    ├── REST API Path (existing)
    │   └── VM Sandbox Connector
    └── SQL Path (new)
        ├── SQL Query Executor (Node.js)
        │   ├── MS SQL Support (mssql package)
        │   ├── PostgreSQL Support (pg package)
        │   └── MySQL Support (mysql2 package)
        └── Introspection Operations
            ├── introspect_tables
            └── introspect_columns
```

## Implementation Files

### Core Types

- `convex/model/integrations/types.ts` - Added SQL validators and TypeScript types

### SQL Executor

- `convex/node_only/sql/types.ts` - SQL execution type definitions
- `convex/node_only/sql/execute_query.ts` - Generic SQL query executor (Node.js action)

### Integration Action Updates

- `convex/workflow/actions/integration/integration_action.ts` - Added SQL routing logic
- `convex/workflow/actions/integration/helpers/execute_sql_integration.ts` - SQL execution handler
- `convex/workflow/actions/integration/helpers/sql_introspection.ts` - Schema introspection queries

### Database Schema

- `convex/schema.ts` - Extended integrations table with SQL fields:
  - `type` - Integration type discriminator
  - `sqlConnectionConfig` - SQL connection settings
  - `sqlOperations` - SQL query definitions

### Documentation

- `docs/sql-integrations/README.md` - This file
- `docs/sql-integrations/protel-example.md` - Complete Protel PMS example

## Database Schema Extensions

### New Fields in `integrations` Table

```typescript
{
  // Integration type (backward compatible - defaults to 'rest_api')
  type?: "rest_api" | "sql",

  // SQL connection configuration (when type = 'sql')
  sqlConnectionConfig?: {
    engine: "mssql" | "postgres" | "mysql",
    server: string,
    port?: number,
    database: string,
    readOnly?: boolean, // Default: true
    options?: {
      encrypt?: boolean,
      trustServerCertificate?: boolean,
      connectionTimeout?: number,
      requestTimeout?: number,
    },
    security?: {
      maxResultRows?: number,        // Default: 10000
      queryTimeoutMs?: number,        // Default: 30000
      maxConnectionPoolSize?: number, // Default: 5
    },
  },

  // SQL operations (when type = 'sql')
  sqlOperations?: Array<{
    name: string,
    title?: string,
    description?: string,
    query: string, // SQL with native placeholders
    parametersSchema?: JSONSchema,
  }>,
}
```

## Usage Examples

### Creating a SQL Integration

```javascript
// In your database
await ctx.db.insert('integrations', {
  organizationId: 'org_123',
  name: 'protel',
  title: 'Protel PMS',
  type: 'sql',
  authMethod: 'basic_auth',
  basicAuth: {
    username: 'readonly_user',
    passwordEncrypted: await encryptPassword('password'),
  },
  sqlConnectionConfig: {
    engine: 'mssql',
    server: 'protel.hotel.local',
    database: 'protel_db',
    readOnly: true,
  },
  sqlOperations: [
    {
      name: 'get_reservations',
      query: 'SELECT * FROM buch WHERE status = @status',
      parametersSchema: {
        properties: { status: { type: 'number' } },
      },
    },
  ],
  status: 'active',
  isActive: true,
});
```

### Using in Workflows

```javascript
{
  type: "action",
  action: "integration",
  config: {
    name: "protel",
    operation: "get_reservations",
    params: { status: 0 },
  },
}
```

### Schema Discovery

```javascript
// List all tables
{
  type: "action",
  action: "integration",
  config: {
    name: "protel",
    operation: "introspect_tables",
  },
}

// List columns in a table
{
  type: "action",
  action: "integration",
  config: {
    name: "protel",
    operation: "introspect_columns",
    params: {
      schemaName: "proteluser",
      tableName: "buch",
    },
  },
}
```

## Security Features

### 1. Read-Only Enforcement

```typescript
// Blocks: INSERT, UPDATE, DELETE, DROP, TRUNCATE, ALTER, CREATE, EXEC
validateQuery(query, readOnly: true);
```

### 2. Encrypted Credentials

```typescript
// Passwords stored encrypted, decrypted just-in-time
passwordEncrypted: await ctx.runAction(internal.oauth2.encryptStringInternal);
```

### 3. Connection Limits

- Maximum 5 connections per pool
- Pools keyed by (server, database, user) for isolation

### 4. Query Timeouts

- Default 30-second timeout per query
- Configurable per integration

### 5. Result Size Limits

- Maximum 10,000 rows per query
- Prevents memory exhaustion

### 6. Parameterized Queries

- All user inputs passed as parameters
- SQL injection prevention

## Supported SQL Engines

### MS SQL Server (mssql)

- Placeholder syntax: `@paramName`
- Default port: 1433
- Package: `mssql`

### PostgreSQL (pg)

- Placeholder syntax: `$1, $2, $3` (positional)
- Default port: 5432
- Package: `pg`

### MySQL (mysql2)

- Placeholder syntax: `?` (positional)
- Default port: 3306
- Package: `mysql2`

## System Operations

Every SQL integration automatically includes these operations:

### introspect_tables

Lists all tables in the database.

**Returns:**

```javascript
[
  { schemaName: 'dbo', tableName: 'customers', tableType: 'BASE TABLE' },
  { schemaName: 'proteluser', tableName: 'buch', tableType: 'BASE TABLE' },
];
```

### introspect_columns

Lists columns in a specific table.

**Parameters:**

- `schemaName` (string, required)
- `tableName` (string, required)

**Returns:**

```javascript
[
  { columnName: 'id', dataType: 'int', isNullable: 'NO' },
  {
    columnName: 'name',
    dataType: 'varchar',
    isNullable: 'YES',
    maxLength: 255,
  },
];
```

## Migration Guide

### Backward Compatibility

Existing REST API integrations continue to work unchanged:

- `type` field defaults to `"rest_api"`
- No changes required to existing integrations
- SQL-specific fields are optional

### Adding SQL Support to Existing System

1. Database schema includes new SQL fields (already added)
2. Integration action routes based on `type` field
3. Create SQL integrations alongside REST integrations

## Future Enhancements

Potential future additions (not implemented yet):

1. **Transaction Support**: Multi-query transactions
2. **Write Operations**: Configurable write access with audit logging
3. **Query Builder UI**: Visual query builder in dashboard
4. **Caching Layer**: Query result caching with TTL
5. **Monitoring Dashboard**: Query performance metrics
6. **Connection Health Checks**: Automatic connection testing
7. **Query Templates**: Reusable query fragments

## Testing

### Manual Testing

1. Create a test SQL integration
2. Test introspection operations
3. Test custom queries
4. Verify security (try forbidden keywords)
5. Test in workflows
6. Test with agent tools

### Example Test Integration

See `docs/sql-integrations/protel-example.md` for a complete working example.

## Dependencies

New npm packages installed:

- `mssql` - MS SQL Server client
- `pg` - PostgreSQL client
- `mysql2` - MySQL client (promise-based)

## Performance Considerations

### Connection Pooling

- Pools reused across invocations
- Lazy initialization
- Automatic cleanup

### Query Optimization

- Row limits prevent large result sets
- Timeout enforcement
- Connection limits per integration

### Memory Management

- Result sets limited to 10,000 rows
- Streaming not implemented (future enhancement)

## Troubleshooting

### Common Issues

**"Query contains forbidden keyword"**

- Integration has `readOnly: true`
- Remove write operations or set `readOnly: false`

**"Connection timeout"**

- Check server accessibility
- Verify firewall rules
- Increase `connectionTimeout`

**"Query timeout"**

- Optimize query
- Increase `queryTimeoutMs`
- Add indexes to database

**"Operation not found"**

- Verify operation name matches `sqlOperations`
- Check for typos
- Remember introspection ops are auto-available

## Support

For questions or issues:

1. Check the Protel example in `protel-example.md`
2. Review integration logs in Convex dashboard
3. Test connection with introspection operations
4. Verify credentials and connection config
