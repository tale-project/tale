import JSZip from 'jszip';
import { describe, it, expect } from 'vitest';

import { parseIntegrationFiles } from '../parse-integration-package';

const validConfig = {
  name: 'my-api',
  title: 'My Custom API',
  authMethod: 'api_key',
  secretBindings: ['apiKey'],
  operations: [{ name: 'list_items', title: 'List items' }],
};

const validConnector = `
const connector = {
  operations: ['list_items'],
  testConnection: function(ctx) { return { status: 'ok' }; },
  execute: function(ctx) { return ctx; }
};
`;

const connectorWithoutTestConnection = `
const connector = {
  operations: ['list_items'],
  execute: function(ctx) { return ctx; }
};
`;

const sqlConfig = {
  ...validConfig,
  type: 'sql',
  authMethod: 'basic_auth',
  secretBindings: ['username', 'password'],
  sqlConnectionConfig: { engine: 'mssql', port: 1433 },
};

function makeFile(name: string, content: string, type = 'text/plain') {
  return new File([content], name, { type });
}

async function makeZip(files: Record<string, string>) {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) {
    zip.file(name, content);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  return new File([blob], 'integration.zip', {
    type: 'application/zip',
  });
}

describe('parseIntegrationFiles', () => {
  describe('individual files', () => {
    it('should parse config.json and connector.js as individual files', async () => {
      const files = [
        makeFile('config.json', JSON.stringify(validConfig)),
        makeFile('connector.js', validConnector),
      ];
      const result = await parseIntegrationFiles(files);
      expect(result.success).toBe(true);
      expect(result.data?.config.name).toBe('my-api');
      expect(result.data?.connectorCode).toBe(validConnector);
    });

    it('should fail when config.json is missing', async () => {
      const files = [makeFile('connector.js', validConnector)];
      const result = await parseIntegrationFiles(files);
      expect(result.success).toBe(false);
      expect(result.error).toContain('config.json');
    });

    it('should fail when connector.js is missing', async () => {
      const files = [makeFile('config.json', JSON.stringify(validConfig))];
      const result = await parseIntegrationFiles(files);
      expect(result.success).toBe(false);
      expect(result.error).toContain('connector.js');
    });

    it('should fail with invalid JSON in config.json', async () => {
      const files = [
        makeFile('config.json', 'not json'),
        makeFile('connector.js', validConnector),
      ];
      const result = await parseIntegrationFiles(files);
      expect(result.success).toBe(false);
      expect(result.error).toContain('not valid JSON');
    });

    it('should fail with invalid config schema', async () => {
      const files = [
        makeFile('config.json', JSON.stringify({ name: '' })),
        makeFile('connector.js', validConnector),
      ];
      const result = await parseIntegrationFiles(files);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid config.json');
    });

    it('should fail with empty connector for non-SQL type', async () => {
      const files = [
        makeFile('config.json', JSON.stringify(validConfig)),
        makeFile('connector.js', '   '),
      ];
      const result = await parseIntegrationFiles(files);
      expect(result.success).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('should allow empty connector for SQL type', async () => {
      const files = [
        makeFile('config.json', JSON.stringify(sqlConfig)),
        makeFile('connector.js', ''),
      ];
      const result = await parseIntegrationFiles(files);
      expect(result.success).toBe(true);
    });

    it('should allow SQL without connector.js', async () => {
      const files = [makeFile('config.json', JSON.stringify(sqlConfig))];
      const result = await parseIntegrationFiles(files);
      expect(result.success).toBe(true);
      expect(result.data?.connectorCode).toBe('');
    });

    it('should fail REST connector without testConnection', async () => {
      const files = [
        makeFile('config.json', JSON.stringify(validConfig)),
        makeFile('connector.js', connectorWithoutTestConnection),
      ];
      const result = await parseIntegrationFiles(files);
      expect(result.success).toBe(false);
      expect(result.error).toContain('testConnection');
    });

    it('should accept testConnection with colon syntax', async () => {
      const code = `
        const connector = {
          testConnection: function(ctx) { return { status: 'ok' }; },
          execute: function(ctx) { return ctx; }
        };
      `;
      const files = [
        makeFile('config.json', JSON.stringify(validConfig)),
        makeFile('connector.js', code),
      ];
      const result = await parseIntegrationFiles(files);
      expect(result.success).toBe(true);
    });

    it('should accept testConnection with shorthand method syntax', async () => {
      const code = `
        const connector = {
          testConnection(ctx) { return { status: 'ok' }; },
          execute(ctx) { return ctx; }
        };
      `;
      const files = [
        makeFile('config.json', JSON.stringify(validConfig)),
        makeFile('connector.js', code),
      ];
      const result = await parseIntegrationFiles(files);
      expect(result.success).toBe(true);
    });
  });

  describe('zip package', () => {
    it('should parse a valid zip package', async () => {
      const zip = await makeZip({
        'config.json': JSON.stringify(validConfig),
        'connector.js': validConnector,
      });
      const result = await parseIntegrationFiles([zip]);
      expect(result.success).toBe(true);
      expect(result.data?.config.name).toBe('my-api');
    });

    it('should parse zip with files in a subfolder', async () => {
      const zipFile = new JSZip();
      zipFile.folder('my-integration');
      zipFile.file('my-integration/config.json', JSON.stringify(validConfig));
      zipFile.file('my-integration/connector.js', validConnector);
      const blob = await zipFile.generateAsync({ type: 'blob' });
      const file = new File([blob], 'package.zip', {
        type: 'application/zip',
      });

      const result = await parseIntegrationFiles([file]);
      expect(result.success).toBe(true);
    });

    it('should fail if zip is missing config.json', async () => {
      const zip = await makeZip({ 'connector.js': validConnector });
      const result = await parseIntegrationFiles([zip]);
      expect(result.success).toBe(false);
      expect(result.error).toContain('config.json');
    });

    it('should fail if REST zip is missing connector.js', async () => {
      const zip = await makeZip({
        'config.json': JSON.stringify(validConfig),
      });
      const result = await parseIntegrationFiles([zip]);
      expect(result.success).toBe(false);
      expect(result.error).toContain('connector.js');
    });

    it('should allow SQL zip without connector.js', async () => {
      const zip = await makeZip({
        'config.json': JSON.stringify(sqlConfig),
      });
      const result = await parseIntegrationFiles([zip]);
      expect(result.success).toBe(true);
      expect(result.data?.connectorCode).toBe('');
    });
  });

  describe('routing', () => {
    it('should route a single .zip file to zip parser', async () => {
      const zip = await makeZip({
        'config.json': JSON.stringify(validConfig),
        'connector.js': validConnector,
      });
      const result = await parseIntegrationFiles([zip]);
      expect(result.success).toBe(true);
    });

    it('should route multiple files to individual parser', async () => {
      const files = [
        makeFile('config.json', JSON.stringify(validConfig)),
        makeFile('connector.js', validConnector),
      ];
      const result = await parseIntegrationFiles(files);
      expect(result.success).toBe(true);
    });

    it('should route a single non-zip file to individual parser with error', async () => {
      const files = [makeFile('connector.js', validConnector)];
      const result = await parseIntegrationFiles(files);
      expect(result.success).toBe(false);
      expect(result.error).toContain('config.json');
    });
  });
});
