#!/usr/bin/env npx tsx
/**
 * Generate OpenAPI spec with x-api-key authentication
 *
 * This script:
 * 1. Runs convex-helpers to generate the base OpenAPI spec
 * 2. Modifies the security scheme to use x-api-key header
 * 3. Updates server URL and metadata
 * 4. Outputs to public/openapi.json for serving
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { parse } from 'yaml';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const platformDir = join(__dirname, '..');

interface OpenApiSpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  servers: Array<{ url: string; description?: string }>;
  security?: Array<Record<string, string[]>>;
  paths: Record<string, unknown>;
  components: {
    securitySchemes?: Record<string, unknown>;
    schemas: Record<string, unknown>;
  };
  tags?: Array<{ name: string; description: string }>;
}

function main() {
  const tempYamlPath = join(platformDir, 'convex-openapi-temp.yaml');
  const outputPath = join(platformDir, 'public', 'openapi.json');

  console.log('Generating OpenAPI spec from Convex...');

  try {
    execSync(`npx convex-helpers open-api-spec --output-file ${tempYamlPath}`, {
      cwd: platformDir,
      stdio: 'inherit',
    });
  } catch {
    console.error('Failed to generate OpenAPI spec. Make sure Convex is running.');
    process.exit(1);
  }

  console.log('Transforming spec for x-api-key authentication...');

  const yamlContent = readFileSync(tempYamlPath, 'utf-8');
  const spec = parse(yamlContent) as OpenApiSpec;

  spec.info = {
    title: 'Tale Platform API',
    version: '1.0.0',
    description: `
Tale Platform API - Access your Convex backend via REST API.

## Authentication

All API requests require an \`x-api-key\` header with your API key.

\`\`\`
x-api-key: your-api-key-here
\`\`\`

You can create API keys in Settings > API Keys.

## Request Format

All endpoints accept POST requests with JSON body containing an \`args\` object:

\`\`\`json
{
  "args": {
    "param1": "value1",
    "param2": "value2"
  }
}
\`\`\`
`.trim(),
  };

  // Use empty string for same-origin requests - this allows cookie-based auth
  // via the Vite proxy which routes /api/run/* to our HTTP routes
  spec.servers = [
    {
      url: '',
      description: 'API Gateway (same origin)',
    },
  ];

  spec.security = [{ apiKeyAuth: [] }];

  spec.components.securitySchemes = {
    apiKeyAuth: {
      type: 'apiKey',
      in: 'header',
      name: 'x-api-key',
      description: 'API key for authentication. Create one in Settings > API Keys.',
    },
  };

  spec.tags = [
    { name: 'query', description: 'Read-only functions that fetch data' },
    { name: 'mutation', description: 'Functions that modify data' },
    { name: 'action', description: 'Functions that can call external APIs' },
  ];

  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  writeFileSync(outputPath, JSON.stringify(spec, null, 2), 'utf-8');

  execSync(`rm -f ${tempYamlPath}`, { cwd: platformDir });

  console.log(`OpenAPI spec written to ${outputPath}`);
}

main();
