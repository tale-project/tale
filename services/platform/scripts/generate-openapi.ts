#!/usr/bin/env bun
/**
 * Generate OpenAPI spec with x-api-key authentication
 *
 * This script:
 * 1. Runs convex-helpers to generate the base OpenAPI spec
 * 2. Modifies the security scheme to use x-api-key header
 * 3. Updates server URL and metadata
 * 4. Outputs to public/openapi.json for serving
 */

import { execFileSync } from 'node:child_process';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

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

/**
 * Inject OpenAI-compatible Chat Completions API paths into the spec.
 * These are custom HTTP routes registered via httpRouter, not generated
 * by convex-helpers.
 */
function injectOpenAICompatPaths(spec: OpenApiSpec) {
  const bearerAuth = {
    bearerAuth: {
      type: 'http',
      scheme: 'bearer',
      description:
        'API key as Bearer token (e.g., "Bearer tale_..."). Create keys in Settings > API Keys.',
    },
  };
  Object.assign(spec.components.securitySchemes ?? {}, bearerAuth);

  const openaiTag = 'OpenAI Compatible';

  spec.paths['/api/v1/chat/completions'] = {
    post: {
      tags: [openaiTag],
      summary: 'Create chat completion',
      description: `Send messages to an agent and receive a response. Fully compatible with the OpenAI Chat Completions API.

**Two modes:**
- **Agent mode** (no \`tools\`): The agent uses server-side tools and auto-executes them.
- **Client tool mode** (\`tools\` provided): Only client-defined tools are used. Returns \`tool_calls\` for client execution.`,
      operationId: 'createChatCompletion',
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: 'X-Organization-Slug',
          in: 'header',
          required: false,
          schema: { type: 'string' },
          description:
            'Organization slug. Auto-resolved if user belongs to one org.',
        },
        {
          name: 'X-Thread-Id',
          in: 'header',
          required: false,
          schema: { type: 'string' },
          description: 'Reuse a conversation thread across requests.',
        },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ChatCompletionRequest' },
          },
        },
      },
      responses: {
        '200': {
          description:
            'Chat completion response (or SSE stream if stream=true)',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ChatCompletionResponse' },
            },
            'text/event-stream': {
              schema: {
                type: 'string',
                description:
                  'SSE stream of ChatCompletionChunk objects, terminated by `data: [DONE]`',
              },
            },
          },
        },
        '400': {
          description: 'Invalid request (missing model, messages, etc.)',
        },
        '401': { description: 'Invalid or missing API key' },
        '403': { description: 'Not a member of the organization' },
        '404': { description: 'Model (agent) not found' },
        '429': { description: 'Rate limit exceeded' },
        '500': { description: 'Generation failed' },
      },
    },
  };

  spec.paths['/api/v1/models'] = {
    get: {
      tags: [openaiTag],
      summary: 'List models',
      description:
        'List available agents as OpenAI-compatible models. Only agents with `visibleInChat: true` are returned.',
      operationId: 'listModels',
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: 'X-Organization-Slug',
          in: 'header',
          required: false,
          schema: { type: 'string' },
          description: 'Organization slug.',
        },
      ],
      responses: {
        '200': {
          description: 'List of models',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ModelList' },
            },
          },
        },
        '401': { description: 'Invalid or missing API key' },
      },
    },
  };

  // Add schemas
  const schemas = spec.components.schemas;

  schemas.ChatCompletionRequest = {
    type: 'object',
    required: ['model', 'messages'],
    properties: {
      model: {
        type: 'string',
        description: 'Agent slug (e.g., "chat-agent").',
        example: 'chat-agent',
      },
      messages: {
        type: 'array',
        description: 'Conversation messages.',
        items: { $ref: '#/components/schemas/ChatMessage' },
      },
      stream: {
        type: 'boolean',
        description: 'Enable SSE streaming.',
        default: false,
      },
      temperature: {
        type: 'number',
        minimum: 0,
        maximum: 2,
        description: 'Sampling temperature.',
      },
      max_tokens: {
        type: 'integer',
        description: 'Maximum tokens to generate.',
      },
      top_p: { type: 'number', description: 'Nucleus sampling.' },
      frequency_penalty: { type: 'number' },
      presence_penalty: { type: 'number' },
      stop: {
        oneOf: [
          { type: 'string' },
          { type: 'array', items: { type: 'string' } },
        ],
        description: 'Stop sequences.',
      },
      response_format: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['text', 'json_object'],
          },
        },
        description: 'Set to `{"type": "json_object"}` for JSON mode.',
      },
      tools: {
        type: 'array',
        items: { $ref: '#/components/schemas/ToolDefinition' },
        description:
          'Tool definitions for client-side tool calling. When provided, server-side agent tools are disabled.',
      },
      tool_choice: {
        oneOf: [
          { type: 'string', enum: ['auto', 'required', 'none'] },
          {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['function'] },
              function: {
                type: 'object',
                properties: { name: { type: 'string' } },
                required: ['name'],
              },
            },
          },
        ],
        description: 'Controls tool calling behavior.',
      },
    },
  };

  schemas.ChatMessage = {
    type: 'object',
    required: ['role'],
    properties: {
      role: {
        type: 'string',
        enum: ['system', 'user', 'assistant', 'tool'],
      },
      content: {
        oneOf: [{ type: 'string' }, { type: 'null' }],
        description: 'Message content.',
      },
      tool_calls: {
        type: 'array',
        items: { $ref: '#/components/schemas/ToolCall' },
        description: 'Tool calls (assistant messages only).',
      },
      tool_call_id: {
        type: 'string',
        description:
          'ID of the tool call this result is for (tool messages only).',
      },
    },
  };

  schemas.ToolDefinition = {
    type: 'object',
    required: ['type', 'function'],
    properties: {
      type: { type: 'string', enum: ['function'] },
      function: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          parameters: {
            type: 'object',
            description: 'JSON Schema for the function parameters.',
          },
        },
      },
    },
  };

  schemas.ToolCall = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      type: { type: 'string', enum: ['function'] },
      function: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          arguments: {
            type: 'string',
            description: 'JSON string of function arguments.',
          },
        },
      },
    },
  };

  schemas.ChatCompletionResponse = {
    type: 'object',
    properties: {
      id: { type: 'string', example: 'chatcmpl-abc123' },
      object: { type: 'string', enum: ['chat.completion'] },
      created: { type: 'integer' },
      model: { type: 'string' },
      choices: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer' },
            message: { $ref: '#/components/schemas/ChatMessage' },
            finish_reason: {
              type: 'string',
              enum: ['stop', 'length', 'tool_calls'],
            },
          },
        },
      },
      usage: {
        type: 'object',
        properties: {
          prompt_tokens: { type: 'integer' },
          completion_tokens: { type: 'integer' },
          total_tokens: { type: 'integer' },
        },
      },
    },
  };

  schemas.ModelList = {
    type: 'object',
    properties: {
      object: { type: 'string', enum: ['list'] },
      data: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'chat-agent' },
            object: { type: 'string', enum: ['model'] },
            created: { type: 'integer' },
            owned_by: { type: 'string' },
          },
        },
      },
    },
  };
}

function main() {
  const tempYamlPath = join(platformDir, 'convex-openapi-temp.yaml');
  const outputPath = join(platformDir, 'public', 'openapi.json');

  console.log('Generating OpenAPI spec from Convex...');

  try {
    execFileSync(
      'bunx',
      ['convex-helpers', 'open-api-spec', '--output-file', tempYamlPath],
      {
        cwd: platformDir,
        stdio: 'inherit',
        shell: true,
      },
    );
  } catch {
    console.error(
      'Failed to generate OpenAPI spec. Make sure Convex is running.',
    );
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
      description:
        'API key for authentication. Create one in Settings > API Keys.',
    },
  };

  spec.tags = [
    {
      name: 'OpenAI Compatible',
      description:
        'OpenAI Chat Completions compatible API. Use any OpenAI SDK by pointing base_url to this server.',
    },
    { name: 'query', description: 'Read-only functions that fetch data' },
    { name: 'mutation', description: 'Functions that modify data' },
    { name: 'action', description: 'Functions that can call external APIs' },
  ];

  // Inject OpenAI-compatible endpoints (custom HTTP routes not covered by convex-helpers)
  injectOpenAICompatPaths(spec);

  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  writeFileSync(outputPath, JSON.stringify(spec, null, 2), 'utf-8');

  rmSync(tempYamlPath, { force: true });

  console.log(`OpenAPI spec written to ${outputPath}`);
}

main();
