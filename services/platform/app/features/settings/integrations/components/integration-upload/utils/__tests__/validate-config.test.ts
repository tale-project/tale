import { describe, it, expect } from 'vitest';

import { validateConfig } from '../validate-config';

describe('validateConfig', () => {
  const validConfig = {
    name: 'my-api',
    title: 'My Custom API',
    authMethod: 'api_key',
    secretBindings: ['apiKey', 'baseUrl'],
    operations: [
      {
        name: 'list_users',
        title: 'List Users',
        description: 'Get all users',
      },
    ],
  };

  it('should validate a valid REST API config', () => {
    const result = validateConfig(validConfig);
    expect(result.success).toBe(true);
    expect(result.config).toBeDefined();
    expect(result.config?.name).toBe('my-api');
  });

  it('should validate a config with all optional fields', () => {
    const result = validateConfig({
      ...validConfig,
      description: 'A test integration',
      version: 1,
      allowedHosts: ['api.example.com'],
      connectionConfig: { timeout: 30000 },
    });
    expect(result.success).toBe(true);
    expect(result.config?.allowedHosts).toEqual(['api.example.com']);
  });

  it('should validate a SQL type config', () => {
    const result = validateConfig({
      name: 'my-sql-db',
      title: 'My SQL Database',
      type: 'sql',
      authMethod: 'basic_auth',
      secretBindings: ['username', 'password'],
      operations: [{ name: 'list_records' }],
      sqlConnectionConfig: {
        engine: 'mssql',
        server: 'db.example.com',
        port: 1433,
        database: 'my_database',
      },
    });
    expect(result.success).toBe(true);
    expect(result.config?.type).toBe('sql');
  });

  it('should accept SQL config without server and database', () => {
    const result = validateConfig({
      name: 'my-sql-db',
      title: 'My SQL Database',
      type: 'sql',
      authMethod: 'basic_auth',
      secretBindings: ['username', 'password'],
      operations: [{ name: 'list_records' }],
      sqlConnectionConfig: {
        engine: 'mssql',
      },
    });
    expect(result.success).toBe(true);
  });

  it('should accept SQL operations with query and parametersSchema', () => {
    const result = validateConfig({
      name: 'my-sql-db',
      title: 'My SQL Database',
      type: 'sql',
      authMethod: 'basic_auth',
      secretBindings: ['username', 'password'],
      operations: [
        {
          name: 'list_records',
          title: 'List Records',
          query: 'SELECT * FROM records WHERE status = @status',
          parametersSchema: {
            type: 'object',
            properties: {
              status: {
                type: 'number',
                description: 'Record status',
                required: false,
              },
            },
          },
        },
        {
          name: 'create_record',
          operationType: 'write',
          requiresApproval: true,
          query: 'INSERT INTO records (name) VALUES (@name)',
          parametersSchema: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Record name',
                required: true,
              },
            },
          },
        },
      ],
      sqlConnectionConfig: {
        engine: 'mssql',
        server: 'db.example.com',
        database: 'my_database',
      },
    });
    expect(result.success).toBe(true);
    expect(result.config?.operations[0].query).toBe(
      'SELECT * FROM records WHERE status = @status',
    );
    expect(
      result.config?.operations[0].parametersSchema?.properties,
    ).toBeDefined();
    expect(result.config?.operations[1].operationType).toBe('write');
  });

  it('should reject config with missing name', () => {
    const result = validateConfig({ ...validConfig, name: '' });
    expect(result.success).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors?.some((e) => e.includes('name'))).toBe(true);
  });

  it('should reject config with invalid name format', () => {
    const result = validateConfig({ ...validConfig, name: 'My API' });
    expect(result.success).toBe(false);
    expect(result.errors?.some((e) => e.includes('name'))).toBe(true);
  });

  it('should reject config with uppercase name', () => {
    const result = validateConfig({ ...validConfig, name: 'MyApi' });
    expect(result.success).toBe(false);
  });

  it('should reject config with empty secretBindings', () => {
    const result = validateConfig({ ...validConfig, secretBindings: [] });
    expect(result.success).toBe(false);
    expect(result.errors?.some((e) => e.includes('secretBindings'))).toBe(true);
  });

  it('should reject config with no operations', () => {
    const result = validateConfig({ ...validConfig, operations: [] });
    expect(result.success).toBe(false);
  });

  it('should reject config with invalid authMethod', () => {
    const result = validateConfig({ ...validConfig, authMethod: 'oauth2' });
    expect(result.success).toBe(false);
  });

  it('should reject config with missing title', () => {
    const result = validateConfig({ ...validConfig, title: '' });
    expect(result.success).toBe(false);
  });

  it('should reject non-object input', () => {
    const result = validateConfig('not an object');
    expect(result.success).toBe(false);
  });

  it('should reject null input', () => {
    const result = validateConfig(null);
    expect(result.success).toBe(false);
  });

  it('should accept operation with operationType', () => {
    const result = validateConfig({
      ...validConfig,
      operations: [
        { name: 'create_user', operationType: 'write', requiresApproval: true },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.config?.operations[0].operationType).toBe('write');
  });

  it('should accept valid name formats', () => {
    for (const name of ['api', 'my-api', 'my_api', 'api2', 'a123-test_v2']) {
      const result = validateConfig({ ...validConfig, name });
      expect(result.success).toBe(true);
    }
  });

  it('should reject names starting with number or dash', () => {
    for (const name of ['1api', '-api', '_api']) {
      const result = validateConfig({ ...validConfig, name });
      expect(result.success).toBe(false);
    }
  });
});
