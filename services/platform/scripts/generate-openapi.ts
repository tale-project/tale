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
      description: `Send messages to a model and receive a response. Fully compatible with the OpenAI Chat Completions API.

Use \`GET /api/v1/models\` to list available models. Supports tool calling via the \`tools\` parameter — the model returns \`tool_calls\` for client-side execution.`,
      operationId: 'createChatCompletion',
      security: [{ bearerAuth: [] }],
      parameters: [
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
      parameters: [],
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
        description:
          'Model ID (e.g., "claude-sonnet-4-20250514"). Use GET /api/v1/models to list available models.',
        example: 'claude-sonnet-4-20250514',
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
      stream_options: {
        type: 'object',
        nullable: true,
        properties: {
          include_usage: {
            type: 'boolean',
            description:
              'If set, an additional chunk will be streamed before the `[DONE]` message with token usage statistics.',
          },
        },
        description:
          'Options for streaming. Only applicable when `stream` is true.',
      },
    },
  };

  // Role-specific message schemas
  schemas.ChatMessageSystem = {
    type: 'object',
    required: ['role', 'content'],
    properties: {
      role: { type: 'string', enum: ['system'] },
      content: { type: 'string', description: 'System prompt content.' },
    },
  };

  schemas.ChatMessageUser = {
    type: 'object',
    required: ['role', 'content'],
    properties: {
      role: { type: 'string', enum: ['user'] },
      content: { type: 'string', description: 'User message content.' },
    },
  };

  schemas.ChatMessageAssistant = {
    type: 'object',
    required: ['role'],
    properties: {
      role: { type: 'string', enum: ['assistant'] },
      content: {
        type: 'string',
        nullable: true,
        description: 'Assistant message content.',
      },
      tool_calls: {
        type: 'array',
        items: { $ref: '#/components/schemas/ToolCall' },
        description: 'Tool calls made by the assistant.',
      },
    },
  };

  schemas.ChatMessageTool = {
    type: 'object',
    required: ['role', 'content', 'tool_call_id'],
    properties: {
      role: { type: 'string', enum: ['tool'] },
      content: {
        type: 'string',
        nullable: true,
        description: 'Tool result content.',
      },
      tool_call_id: {
        type: 'string',
        description: 'ID of the tool call this result is for.',
      },
    },
  };

  schemas.ChatMessage = {
    oneOf: [
      { $ref: '#/components/schemas/ChatMessageSystem' },
      { $ref: '#/components/schemas/ChatMessageUser' },
      { $ref: '#/components/schemas/ChatMessageAssistant' },
      { $ref: '#/components/schemas/ChatMessageTool' },
    ],
    discriminator: {
      propertyName: 'role',
      mapping: {
        system: '#/components/schemas/ChatMessageSystem',
        user: '#/components/schemas/ChatMessageUser',
        assistant: '#/components/schemas/ChatMessageAssistant',
        tool: '#/components/schemas/ChatMessageTool',
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
            message: { $ref: '#/components/schemas/ChatMessageAssistant' },
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
      citations: {
        type: 'array',
        items: { $ref: '#/components/schemas/Citation' },
        description:
          'Source citations referenced in the response text via [N] markers. Present when knowledge tools (RAG, web search) were used.',
      },
    },
  };

  schemas.Citation = {
    type: 'object',
    properties: {
      index: {
        type: 'integer',
        description: 'Citation index corresponding to [N] markers in text.',
      },
      type: {
        type: 'string',
        enum: ['rag', 'web'],
        description: 'Source type: RAG knowledge base or web search.',
      },
      source: {
        type: 'string',
        description: 'Source name or title.',
      },
      fileId: {
        type: 'string',
        description: 'File ID for RAG citations.',
      },
      url: {
        type: 'string',
        description: 'URL for web citations.',
      },
      page: {
        type: 'integer',
        description: 'Page number for document citations.',
      },
      relevance: {
        type: 'number',
        description: 'Relevance score (0-1).',
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
            id: { type: 'string', example: 'anthropic/claude-sonnet-4.6' },
            object: { type: 'string', enum: ['model'] },
            created: { type: 'integer' },
            owned_by: { type: 'string' },
          },
        },
      },
    },
  };
}

// ── Shared response helpers ──────────────────────────────────────────────────

const errorResponses = {
  '400': { description: 'Bad request' },
  '401': { description: 'Unauthorized' },
  '404': { description: 'Not found' },
  '500': { description: 'Internal server error' },
};

function jsonBody(schemaRef: string, required = true) {
  return {
    required,
    content: {
      'application/json': {
        schema: { $ref: `#/components/schemas/${schemaRef}` },
      },
    },
  };
}

function jsonResponse(description: string, schemaRef?: string) {
  if (!schemaRef) return { description };
  return {
    description,
    content: {
      'application/json': {
        schema: { $ref: `#/components/schemas/${schemaRef}` },
      },
    },
  };
}

function pathParam(name: string, description: string) {
  return {
    name,
    in: 'path' as const,
    required: true,
    schema: { type: 'string' },
    description,
  };
}

function queryParam(
  name: string,
  description: string,
  opts?: { type?: string; required?: boolean },
) {
  return {
    name,
    in: 'query' as const,
    required: opts?.required ?? false,
    schema: { type: opts?.type ?? 'string' },
    description,
  };
}

const paginationParams = [
  queryParam('cursor', 'Pagination cursor from a previous response'),
  queryParam('limit', 'Maximum number of items to return', { type: 'integer' }),
];

const sec = [{ bearerAuth: [] }];

// ── REST API endpoint definitions ───────────────────────────────────────────

function injectRestApiPaths(spec: OpenApiSpec) {
  const schemas = spec.components.schemas;

  // ── Documents ─────────────────────────────────────────────────────────────

  spec.paths['/api/v1/documents'] = {
    get: {
      tags: ['Documents'],
      summary: 'List documents',
      operationId: 'listDocuments',
      security: sec,
      parameters: [
        ...paginationParams,
        queryParam('sourceProvider', 'Filter by source provider'),
        queryParam('folderId', 'Filter by folder ID'),
      ],
      responses: {
        '200': jsonResponse('Paginated list of documents', 'DocumentList'),
        ...errorResponses,
      },
    },
    post: {
      tags: ['Documents'],
      summary: 'Create document',
      operationId: 'createDocument',
      security: sec,
      requestBody: jsonBody('CreateDocumentRequest'),
      responses: {
        '200': jsonResponse('Created document', 'Document'),
        ...errorResponses,
      },
    },
  };

  spec.paths['/api/v1/documents/{id}'] = {
    get: {
      tags: ['Documents'],
      summary: 'Get document',
      operationId: 'getDocument',
      security: sec,
      parameters: [pathParam('id', 'Document ID')],
      responses: {
        '200': jsonResponse('Document details', 'Document'),
        ...errorResponses,
      },
    },
    patch: {
      tags: ['Documents'],
      summary: 'Update document',
      operationId: 'updateDocument',
      security: sec,
      parameters: [pathParam('id', 'Document ID')],
      requestBody: jsonBody('UpdateDocumentRequest'),
      responses: {
        '200': jsonResponse('Updated document', 'Document'),
        ...errorResponses,
      },
    },
    delete: {
      tags: ['Documents'],
      summary: 'Delete document',
      operationId: 'deleteDocument',
      security: sec,
      parameters: [pathParam('id', 'Document ID')],
      responses: {
        '200': jsonResponse('Document deleted'),
        ...errorResponses,
      },
    },
  };

  spec.paths['/api/v1/documents/{id}/retry-indexing'] = {
    post: {
      tags: ['Documents'],
      summary: 'Retry RAG indexing',
      operationId: 'retryDocumentIndexing',
      security: sec,
      parameters: [pathParam('id', 'Document ID')],
      responses: {
        '200': jsonResponse('Indexing retried'),
        ...errorResponses,
      },
    },
  };

  schemas.Document = {
    type: 'object',
    properties: {
      _id: { type: 'string' },
      title: { type: 'string' },
      content: { type: 'string' },
      fileId: { type: 'string' },
      mimeType: { type: 'string' },
      extension: { type: 'string' },
      metadata: { type: 'object' },
      teamId: { type: 'string' },
      folderId: { type: 'string' },
      sourceProvider: { type: 'string' },
      _creationTime: { type: 'number' },
    },
  };

  schemas.DocumentList = {
    type: 'object',
    properties: {
      data: { type: 'array', items: { $ref: '#/components/schemas/Document' } },
      cursor: { type: 'string' },
      hasMore: { type: 'boolean' },
    },
  };

  schemas.CreateDocumentRequest = {
    type: 'object',
    required: ['title'],
    properties: {
      title: { type: 'string' },
      content: { type: 'string' },
      fileId: { type: 'string' },
      mimeType: { type: 'string' },
      extension: { type: 'string' },
      metadata: { type: 'object' },
      teamId: { type: 'string' },
      folderId: { type: 'string' },
    },
  };

  schemas.UpdateDocumentRequest = {
    type: 'object',
    properties: {
      title: { type: 'string' },
      content: { type: 'string' },
      metadata: { type: 'object' },
      mimeType: { type: 'string' },
      extension: { type: 'string' },
      teamId: { type: 'string' },
      folderId: { type: 'string' },
    },
  };

  // ── Websites ──────────────────────────────────────────────────────────────

  spec.paths['/api/v1/websites'] = {
    get: {
      tags: ['Websites'],
      summary: 'List websites',
      operationId: 'listWebsites',
      security: sec,
      parameters: [
        ...paginationParams,
        queryParam('status', 'Filter by status'),
        queryParam('scanInterval', 'Filter by scan interval'),
      ],
      responses: {
        '200': jsonResponse('Paginated list of websites', 'WebsiteList'),
        ...errorResponses,
      },
    },
    post: {
      tags: ['Websites'],
      summary: 'Create website',
      operationId: 'createWebsite',
      security: sec,
      requestBody: jsonBody('CreateWebsiteRequest'),
      responses: {
        '200': jsonResponse('Created website', 'Website'),
        ...errorResponses,
      },
    },
  };

  spec.paths['/api/v1/websites/{id}'] = {
    get: {
      tags: ['Websites'],
      summary: 'Get website',
      operationId: 'getWebsite',
      security: sec,
      parameters: [pathParam('id', 'Website ID')],
      responses: {
        '200': jsonResponse('Website details', 'Website'),
        ...errorResponses,
      },
    },
    patch: {
      tags: ['Websites'],
      summary: 'Update website',
      operationId: 'updateWebsite',
      security: sec,
      parameters: [pathParam('id', 'Website ID')],
      requestBody: jsonBody('UpdateWebsiteRequest'),
      responses: {
        '200': jsonResponse('Updated website', 'Website'),
        ...errorResponses,
      },
    },
    delete: {
      tags: ['Websites'],
      summary: 'Delete website',
      operationId: 'deleteWebsite',
      security: sec,
      parameters: [pathParam('id', 'Website ID')],
      responses: {
        '200': jsonResponse('Website deleted'),
        ...errorResponses,
      },
    },
  };

  spec.paths['/api/v1/websites/{id}/pages'] = {
    get: {
      tags: ['Websites'],
      summary: 'Fetch pages',
      operationId: 'listWebsitePages',
      security: sec,
      parameters: [
        pathParam('id', 'Website ID'),
        queryParam('offset', 'Pagination offset', { type: 'integer' }),
        queryParam('limit', 'Maximum number of pages to return', {
          type: 'integer',
        }),
      ],
      responses: {
        '200': jsonResponse('List of pages', 'WebsitePageList'),
        ...errorResponses,
      },
    },
  };

  spec.paths['/api/v1/websites/{id}/sync'] = {
    post: {
      tags: ['Websites'],
      summary: 'Sync statuses',
      operationId: 'syncWebsite',
      security: sec,
      parameters: [pathParam('id', 'Website ID')],
      responses: {
        '200': jsonResponse('Sync initiated'),
        ...errorResponses,
      },
    },
  };

  spec.paths['/api/v1/websites/{id}/search'] = {
    post: {
      tags: ['Websites'],
      summary: 'Search content',
      operationId: 'searchWebsite',
      security: sec,
      parameters: [pathParam('id', 'Website ID')],
      requestBody: jsonBody('WebsiteSearchRequest'),
      responses: {
        '200': jsonResponse('Search results', 'WebsiteSearchResults'),
        ...errorResponses,
      },
    },
  };

  schemas.Website = {
    type: 'object',
    properties: {
      _id: { type: 'string' },
      domain: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
      scanInterval: { type: 'string' },
      status: { type: 'string' },
      _creationTime: { type: 'number' },
    },
  };

  schemas.WebsiteList = {
    type: 'object',
    properties: {
      data: { type: 'array', items: { $ref: '#/components/schemas/Website' } },
      cursor: { type: 'string' },
      hasMore: { type: 'boolean' },
    },
  };

  schemas.CreateWebsiteRequest = {
    type: 'object',
    required: ['domain', 'scanInterval'],
    properties: {
      domain: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
      scanInterval: { type: 'string' },
    },
  };

  schemas.UpdateWebsiteRequest = {
    type: 'object',
    properties: {
      domain: { type: 'string' },
      title: { type: 'string' },
      description: { type: 'string' },
      scanInterval: { type: 'string' },
      status: { type: 'string' },
    },
  };

  schemas.WebsitePage = {
    type: 'object',
    properties: {
      url: { type: 'string' },
      title: { type: 'string' },
      status: { type: 'string' },
    },
  };

  schemas.WebsitePageList = {
    type: 'object',
    properties: {
      data: {
        type: 'array',
        items: { $ref: '#/components/schemas/WebsitePage' },
      },
      total: { type: 'integer' },
    },
  };

  schemas.WebsiteSearchRequest = {
    type: 'object',
    required: ['query'],
    properties: {
      query: { type: 'string' },
      limit: { type: 'integer' },
    },
  };

  schemas.WebsiteSearchResults = {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            url: { type: 'string' },
            title: { type: 'string' },
            snippet: { type: 'string' },
            score: { type: 'number' },
          },
        },
      },
    },
  };

  // ── Products ──────────────────────────────────────────────────────────────

  spec.paths['/api/v1/products'] = {
    get: {
      tags: ['Products'],
      summary: 'List products',
      operationId: 'listProducts',
      security: sec,
      parameters: [
        ...paginationParams,
        queryParam('status', 'Filter by status'),
        queryParam('category', 'Filter by category'),
      ],
      responses: {
        '200': jsonResponse('Paginated list of products', 'ProductList'),
        ...errorResponses,
      },
    },
    post: {
      tags: ['Products'],
      summary: 'Create product',
      operationId: 'createProduct',
      security: sec,
      requestBody: jsonBody('CreateProductRequest'),
      responses: {
        '200': jsonResponse('Created product', 'Product'),
        ...errorResponses,
      },
    },
  };

  spec.paths['/api/v1/products/{id}'] = {
    get: {
      tags: ['Products'],
      summary: 'Get product',
      operationId: 'getProduct',
      security: sec,
      parameters: [pathParam('id', 'Product ID')],
      responses: {
        '200': jsonResponse('Product details', 'Product'),
        ...errorResponses,
      },
    },
    patch: {
      tags: ['Products'],
      summary: 'Update product',
      operationId: 'updateProduct',
      security: sec,
      parameters: [pathParam('id', 'Product ID')],
      requestBody: jsonBody('UpdateProductRequest'),
      responses: {
        '200': jsonResponse('Updated product', 'Product'),
        ...errorResponses,
      },
    },
    delete: {
      tags: ['Products'],
      summary: 'Delete product',
      operationId: 'deleteProduct',
      security: sec,
      parameters: [pathParam('id', 'Product ID')],
      responses: {
        '200': jsonResponse('Product deleted'),
        ...errorResponses,
      },
    },
  };

  schemas.Product = {
    type: 'object',
    properties: {
      _id: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string' },
      price: { type: 'number' },
      currency: { type: 'string' },
      stock: { type: 'integer' },
      category: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      status: { type: 'string' },
      imageUrl: { type: 'string' },
      metadata: { type: 'object' },
      _creationTime: { type: 'number' },
    },
  };

  schemas.ProductList = {
    type: 'object',
    properties: {
      data: { type: 'array', items: { $ref: '#/components/schemas/Product' } },
      cursor: { type: 'string' },
      hasMore: { type: 'boolean' },
    },
  };

  schemas.CreateProductRequest = {
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string' },
      description: { type: 'string' },
      price: { type: 'number' },
      currency: { type: 'string' },
      stock: { type: 'integer' },
      category: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      status: { type: 'string' },
      imageUrl: { type: 'string' },
      metadata: { type: 'object' },
    },
  };

  schemas.UpdateProductRequest = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      description: { type: 'string' },
      price: { type: 'number' },
      currency: { type: 'string' },
      stock: { type: 'integer' },
      category: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      status: { type: 'string' },
      imageUrl: { type: 'string' },
      metadata: { type: 'object' },
    },
  };

  // ── Customers ─────────────────────────────────────────────────────────────

  spec.paths['/api/v1/customers'] = {
    get: {
      tags: ['Customers'],
      summary: 'List customers',
      operationId: 'listCustomers',
      security: sec,
      parameters: [
        ...paginationParams,
        queryParam('status', 'Filter by status'),
        queryParam('source', 'Filter by source'),
        queryParam('locale', 'Filter by locale'),
      ],
      responses: {
        '200': jsonResponse('Paginated list of customers', 'CustomerList'),
        ...errorResponses,
      },
    },
    post: {
      tags: ['Customers'],
      summary: 'Create customer',
      operationId: 'createCustomer',
      security: sec,
      requestBody: jsonBody('CreateCustomerRequest'),
      responses: {
        '200': jsonResponse('Created customer', 'Customer'),
        ...errorResponses,
      },
    },
  };

  spec.paths['/api/v1/customers/{id}'] = {
    get: {
      tags: ['Customers'],
      summary: 'Get customer',
      operationId: 'getCustomer',
      security: sec,
      parameters: [pathParam('id', 'Customer ID')],
      responses: {
        '200': jsonResponse('Customer details', 'Customer'),
        ...errorResponses,
      },
    },
    patch: {
      tags: ['Customers'],
      summary: 'Update customer',
      operationId: 'updateCustomer',
      security: sec,
      parameters: [pathParam('id', 'Customer ID')],
      requestBody: jsonBody('UpdateCustomerRequest'),
      responses: {
        '200': jsonResponse('Updated customer', 'Customer'),
        ...errorResponses,
      },
    },
    delete: {
      tags: ['Customers'],
      summary: 'Delete customer',
      operationId: 'deleteCustomer',
      security: sec,
      parameters: [pathParam('id', 'Customer ID')],
      responses: {
        '200': jsonResponse('Customer deleted'),
        ...errorResponses,
      },
    },
  };

  schemas.Address = {
    type: 'object',
    properties: {
      street: { type: 'string' },
      city: { type: 'string' },
      state: { type: 'string' },
      zip: { type: 'string' },
      country: { type: 'string' },
    },
  };

  schemas.Customer = {
    type: 'object',
    properties: {
      _id: { type: 'string' },
      email: { type: 'string' },
      name: { type: 'string' },
      status: { type: 'string' },
      source: { type: 'string' },
      locale: { type: 'string' },
      address: { $ref: '#/components/schemas/Address' },
      metadata: { type: 'object' },
      _creationTime: { type: 'number' },
    },
  };

  schemas.CustomerList = {
    type: 'object',
    properties: {
      data: { type: 'array', items: { $ref: '#/components/schemas/Customer' } },
      cursor: { type: 'string' },
      hasMore: { type: 'boolean' },
    },
  };

  schemas.CreateCustomerRequest = {
    type: 'object',
    required: ['email'],
    properties: {
      email: { type: 'string' },
      name: { type: 'string' },
      status: { type: 'string' },
      source: { type: 'string' },
      locale: { type: 'string' },
      address: { $ref: '#/components/schemas/Address' },
      metadata: { type: 'object' },
    },
  };

  schemas.UpdateCustomerRequest = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      email: { type: 'string' },
      status: { type: 'string' },
      source: { type: 'string' },
      locale: { type: 'string' },
      address: { $ref: '#/components/schemas/Address' },
      metadata: { type: 'object' },
    },
  };

  // ── Vendors ───────────────────────────────────────────────────────────────

  spec.paths['/api/v1/vendors'] = {
    get: {
      tags: ['Vendors'],
      summary: 'List vendors',
      operationId: 'listVendors',
      security: sec,
      parameters: [
        ...paginationParams,
        queryParam('source', 'Filter by source'),
        queryParam('locale', 'Filter by locale'),
      ],
      responses: {
        '200': jsonResponse('Paginated list of vendors', 'VendorList'),
        ...errorResponses,
      },
    },
    post: {
      tags: ['Vendors'],
      summary: 'Create vendor',
      operationId: 'createVendor',
      security: sec,
      requestBody: jsonBody('CreateVendorRequest'),
      responses: {
        '200': jsonResponse('Created vendor', 'Vendor'),
        ...errorResponses,
      },
    },
  };

  spec.paths['/api/v1/vendors/{id}'] = {
    get: {
      tags: ['Vendors'],
      summary: 'Get vendor',
      operationId: 'getVendor',
      security: sec,
      parameters: [pathParam('id', 'Vendor ID')],
      responses: {
        '200': jsonResponse('Vendor details', 'Vendor'),
        ...errorResponses,
      },
    },
    patch: {
      tags: ['Vendors'],
      summary: 'Update vendor',
      operationId: 'updateVendor',
      security: sec,
      parameters: [pathParam('id', 'Vendor ID')],
      requestBody: jsonBody('UpdateVendorRequest'),
      responses: {
        '200': jsonResponse('Updated vendor', 'Vendor'),
        ...errorResponses,
      },
    },
    delete: {
      tags: ['Vendors'],
      summary: 'Delete vendor',
      operationId: 'deleteVendor',
      security: sec,
      parameters: [pathParam('id', 'Vendor ID')],
      responses: {
        '200': jsonResponse('Vendor deleted'),
        ...errorResponses,
      },
    },
  };

  schemas.Vendor = {
    type: 'object',
    properties: {
      _id: { type: 'string' },
      name: { type: 'string' },
      email: { type: 'string' },
      source: { type: 'string' },
      locale: { type: 'string' },
      address: { $ref: '#/components/schemas/Address' },
      tags: { type: 'array', items: { type: 'string' } },
      metadata: { type: 'object' },
      _creationTime: { type: 'number' },
    },
  };

  schemas.VendorList = {
    type: 'object',
    properties: {
      data: { type: 'array', items: { $ref: '#/components/schemas/Vendor' } },
      cursor: { type: 'string' },
      hasMore: { type: 'boolean' },
    },
  };

  schemas.CreateVendorRequest = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      email: { type: 'string' },
      source: { type: 'string' },
      locale: { type: 'string' },
      address: { $ref: '#/components/schemas/Address' },
      tags: { type: 'array', items: { type: 'string' } },
      metadata: { type: 'object' },
    },
  };

  schemas.UpdateVendorRequest = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      email: { type: 'string' },
      source: { type: 'string' },
      locale: { type: 'string' },
      address: { $ref: '#/components/schemas/Address' },
      tags: { type: 'array', items: { type: 'string' } },
      metadata: { type: 'object' },
    },
  };

  // ── Agents ────────────────────────────────────────────────────────────────

  spec.paths['/api/v1/agents'] = {
    get: {
      tags: ['Agents'],
      summary: 'List agents',
      operationId: 'listAgents',
      security: sec,
      responses: {
        '200': jsonResponse('List of agents', 'AgentList'),
        ...errorResponses,
      },
    },
  };

  spec.paths['/api/v1/agents/tools'] = {
    get: {
      tags: ['Agents'],
      summary: 'List available tools',
      operationId: 'listAgentTools',
      security: sec,
      responses: {
        '200': jsonResponse('List of available tools'),
        ...errorResponses,
      },
    },
  };

  spec.paths['/api/v1/agents/integrations'] = {
    get: {
      tags: ['Agents'],
      summary: 'List available integrations',
      operationId: 'listAgentIntegrations',
      security: sec,
      responses: {
        '200': jsonResponse('List of available integrations'),
        ...errorResponses,
      },
    },
  };

  spec.paths['/api/v1/agents/{slug}'] = {
    get: {
      tags: ['Agents'],
      summary: 'Get agent config and binding',
      operationId: 'getAgent',
      security: sec,
      parameters: [pathParam('slug', 'Agent slug')],
      responses: {
        '200': jsonResponse('Agent configuration and binding', 'Agent'),
        ...errorResponses,
      },
    },
    patch: {
      tags: ['Agents'],
      summary: 'Update agent binding',
      operationId: 'updateAgentBinding',
      security: sec,
      parameters: [pathParam('slug', 'Agent slug')],
      requestBody: jsonBody('UpdateAgentBindingRequest'),
      responses: {
        '200': jsonResponse('Updated agent binding', 'Agent'),
        ...errorResponses,
      },
    },
  };

  schemas.Agent = {
    type: 'object',
    properties: {
      slug: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string' },
      teamId: { type: 'string' },
    },
  };

  schemas.AgentList = {
    type: 'object',
    properties: {
      data: { type: 'array', items: { $ref: '#/components/schemas/Agent' } },
    },
  };

  schemas.UpdateAgentBindingRequest = {
    type: 'object',
    properties: {
      teamId: { type: 'string' },
    },
  };

  // ── Workflows ─────────────────────────────────────────────────────────────

  // Schedules
  spec.paths['/api/v1/workflows/{slug}/schedules'] = {
    get: {
      tags: ['Workflows'],
      summary: 'List schedules',
      operationId: 'listWorkflowSchedules',
      security: sec,
      parameters: [pathParam('slug', 'Workflow slug')],
      responses: {
        '200': jsonResponse('List of schedules', 'ScheduleList'),
        ...errorResponses,
      },
    },
    post: {
      tags: ['Workflows'],
      summary: 'Create schedule',
      operationId: 'createWorkflowSchedule',
      security: sec,
      parameters: [pathParam('slug', 'Workflow slug')],
      requestBody: jsonBody('CreateScheduleRequest'),
      responses: {
        '200': jsonResponse('Created schedule', 'Schedule'),
        ...errorResponses,
      },
    },
  };

  spec.paths['/api/v1/workflows/schedules/{id}'] = {
    patch: {
      tags: ['Workflows'],
      summary: 'Update schedule',
      operationId: 'updateWorkflowSchedule',
      security: sec,
      parameters: [pathParam('id', 'Schedule ID')],
      requestBody: jsonBody('UpdateScheduleRequest'),
      responses: {
        '200': jsonResponse('Updated schedule', 'Schedule'),
        ...errorResponses,
      },
    },
    delete: {
      tags: ['Workflows'],
      summary: 'Delete schedule',
      operationId: 'deleteWorkflowSchedule',
      security: sec,
      parameters: [pathParam('id', 'Schedule ID')],
      responses: {
        '200': jsonResponse('Schedule deleted'),
        ...errorResponses,
      },
    },
  };

  schemas.Schedule = {
    type: 'object',
    properties: {
      _id: { type: 'string' },
      cronExpression: { type: 'string' },
      timezone: { type: 'string' },
      isActive: { type: 'boolean' },
      _creationTime: { type: 'number' },
    },
  };

  schemas.ScheduleList = {
    type: 'object',
    properties: {
      data: { type: 'array', items: { $ref: '#/components/schemas/Schedule' } },
    },
  };

  schemas.CreateScheduleRequest = {
    type: 'object',
    required: ['cronExpression', 'timezone'],
    properties: {
      cronExpression: { type: 'string' },
      timezone: { type: 'string' },
    },
  };

  schemas.UpdateScheduleRequest = {
    type: 'object',
    properties: {
      cronExpression: { type: 'string' },
      timezone: { type: 'string' },
      isActive: { type: 'boolean' },
    },
  };

  // Webhooks
  spec.paths['/api/v1/workflows/{slug}/webhooks'] = {
    get: {
      tags: ['Workflows'],
      summary: 'List webhooks',
      operationId: 'listWorkflowWebhooks',
      security: sec,
      parameters: [pathParam('slug', 'Workflow slug')],
      responses: {
        '200': jsonResponse('List of webhooks', 'WebhookList'),
        ...errorResponses,
      },
    },
    post: {
      tags: ['Workflows'],
      summary: 'Create webhook',
      operationId: 'createWorkflowWebhook',
      security: sec,
      parameters: [pathParam('slug', 'Workflow slug')],
      responses: {
        '200': jsonResponse('Created webhook', 'Webhook'),
        ...errorResponses,
      },
    },
  };

  spec.paths['/api/v1/workflows/webhooks/{id}'] = {
    delete: {
      tags: ['Workflows'],
      summary: 'Delete webhook',
      operationId: 'deleteWorkflowWebhook',
      security: sec,
      parameters: [pathParam('id', 'Webhook ID')],
      responses: {
        '200': jsonResponse('Webhook deleted'),
        ...errorResponses,
      },
    },
  };

  schemas.Webhook = {
    type: 'object',
    properties: {
      _id: { type: 'string' },
      url: { type: 'string' },
      _creationTime: { type: 'number' },
    },
  };

  schemas.WebhookList = {
    type: 'object',
    properties: {
      data: { type: 'array', items: { $ref: '#/components/schemas/Webhook' } },
    },
  };

  // Logs
  spec.paths['/api/v1/workflows/{slug}/logs'] = {
    get: {
      tags: ['Workflows'],
      summary: 'Get trigger logs',
      operationId: 'getWorkflowLogs',
      security: sec,
      parameters: [pathParam('slug', 'Workflow slug')],
      responses: {
        '200': jsonResponse('Trigger logs'),
        ...errorResponses,
      },
    },
  };

  // Executions
  spec.paths['/api/v1/workflows/{slug}/executions'] = {
    get: {
      tags: ['Workflows'],
      summary: 'List executions',
      operationId: 'listWorkflowExecutions',
      security: sec,
      parameters: [
        pathParam('slug', 'Workflow slug'),
        ...paginationParams,
        queryParam('status', 'Filter by execution status'),
        queryParam('dateFrom', 'Filter from date (ISO 8601)'),
        queryParam('dateTo', 'Filter to date (ISO 8601)'),
      ],
      responses: {
        '200': jsonResponse('Paginated list of executions', 'ExecutionList'),
        ...errorResponses,
      },
    },
  };

  spec.paths['/api/v1/workflows/executions/{id}'] = {
    get: {
      tags: ['Workflows'],
      summary: 'Get execution details',
      operationId: 'getWorkflowExecution',
      security: sec,
      parameters: [pathParam('id', 'Execution ID')],
      responses: {
        '200': jsonResponse('Execution details', 'Execution'),
        ...errorResponses,
      },
    },
  };

  spec.paths['/api/v1/workflows/executions/{id}/cancel'] = {
    post: {
      tags: ['Workflows'],
      summary: 'Cancel execution',
      operationId: 'cancelWorkflowExecution',
      security: sec,
      parameters: [pathParam('id', 'Execution ID')],
      responses: {
        '200': jsonResponse('Execution cancelled'),
        ...errorResponses,
      },
    },
  };

  // Run
  spec.paths['/api/v1/workflows/{slug}/run'] = {
    post: {
      tags: ['Workflows'],
      summary: 'Trigger workflow',
      operationId: 'triggerWorkflow',
      security: sec,
      parameters: [pathParam('slug', 'Workflow slug')],
      requestBody: jsonBody('TriggerWorkflowRequest', false),
      responses: {
        '200': jsonResponse('Workflow triggered', 'Execution'),
        ...errorResponses,
      },
    },
  };

  schemas.Execution = {
    type: 'object',
    properties: {
      _id: { type: 'string' },
      status: { type: 'string' },
      startedAt: { type: 'number' },
      completedAt: { type: 'number' },
      input: { type: 'object' },
      output: { type: 'object' },
      _creationTime: { type: 'number' },
    },
  };

  schemas.ExecutionList = {
    type: 'object',
    properties: {
      data: {
        type: 'array',
        items: { $ref: '#/components/schemas/Execution' },
      },
      cursor: { type: 'string' },
      hasMore: { type: 'boolean' },
    },
  };

  schemas.TriggerWorkflowRequest = {
    type: 'object',
    properties: {
      input: { type: 'object', description: 'Input data for the workflow' },
      triggerData: { type: 'object', description: 'Trigger-specific metadata' },
    },
  };

  // ── Threads ──────────────────────────────────────────────────────────────

  spec.paths['/api/v1/threads'] = {
    get: {
      tags: ['Threads'],
      summary: 'List threads',
      operationId: 'listThreads',
      security: sec,
      parameters: [
        ...paginationParams,
        queryParam('archived', 'Set to "true" to list archived threads'),
      ],
      responses: {
        '200': jsonResponse('Paginated thread list', 'ThreadList'),
        ...errorResponses,
      },
    },
    post: {
      tags: ['Threads'],
      summary: 'Create thread',
      operationId: 'createThread',
      security: sec,
      requestBody: jsonBody('CreateThreadRequest'),
      responses: {
        '201': jsonResponse('Created thread', 'CreatedResource'),
        ...errorResponses,
      },
    },
  };

  spec.paths['/api/v1/threads/{id}'] = {
    get: {
      tags: ['Threads'],
      summary: 'Get thread',
      operationId: 'getThread',
      security: sec,
      parameters: [pathParam('id', 'Thread ID')],
      responses: {
        '200': jsonResponse('Thread metadata', 'Thread'),
        ...errorResponses,
      },
    },
    patch: {
      tags: ['Threads'],
      summary: 'Update thread title',
      operationId: 'updateThread',
      security: sec,
      parameters: [pathParam('id', 'Thread ID')],
      requestBody: jsonBody('UpdateThreadRequest'),
      responses: { '204': { description: 'Updated' }, ...errorResponses },
    },
    delete: {
      tags: ['Threads'],
      summary: 'Delete thread',
      operationId: 'deleteThread',
      security: sec,
      parameters: [pathParam('id', 'Thread ID')],
      responses: { '204': { description: 'Deleted' }, ...errorResponses },
    },
  };

  spec.paths['/api/v1/threads/{id}/messages'] = {
    get: {
      tags: ['Threads'],
      summary: 'Get thread messages',
      operationId: 'getThreadMessages',
      security: sec,
      parameters: [pathParam('id', 'Thread ID')],
      responses: {
        '200': jsonResponse('Thread messages', 'ThreadMessages'),
        ...errorResponses,
      },
    },
  };

  spec.paths['/api/v1/threads/{id}/archive'] = {
    post: {
      tags: ['Threads'],
      summary: 'Archive thread',
      operationId: 'archiveThread',
      security: sec,
      parameters: [pathParam('id', 'Thread ID')],
      responses: {
        '200': jsonResponse('Thread archived'),
        ...errorResponses,
      },
    },
  };

  spec.paths['/api/v1/threads/{id}/unarchive'] = {
    post: {
      tags: ['Threads'],
      summary: 'Unarchive thread',
      operationId: 'unarchiveThread',
      security: sec,
      parameters: [pathParam('id', 'Thread ID')],
      responses: {
        '200': jsonResponse('Thread unarchived'),
        ...errorResponses,
      },
    },
  };

  schemas.Thread = {
    type: 'object',
    properties: {
      threadId: { type: 'string' },
      userId: { type: 'string' },
      title: { type: 'string' },
      status: { type: 'string', enum: ['active', 'archived', 'deleted'] },
      chatType: { type: 'string' },
      createdAt: { type: 'number' },
      updatedAt: { type: 'number' },
      generationStatus: { type: 'string' },
    },
  };
  schemas.ThreadList = {
    type: 'object',
    properties: {
      page: { type: 'array', items: { $ref: '#/components/schemas/Thread' } },
      isDone: { type: 'boolean' },
      continueCursor: { type: 'string' },
    },
  };
  schemas.CreateThreadRequest = {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Thread title (defaults to "New Chat")',
      },
    },
  };
  schemas.UpdateThreadRequest = {
    type: 'object',
    required: ['title'],
    properties: {
      title: { type: 'string' },
    },
  };
  schemas.CreatedResource = {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'ID of the created resource' },
    },
  };
  schemas.ThreadMessages = {
    type: 'object',
    properties: {
      messages: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            _creationTime: { type: 'number' },
            role: { type: 'string', enum: ['user', 'assistant'] },
            content: { type: 'string' },
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
      name: 'Agents',
      description: 'View and configure AI agents.',
    },
    {
      name: 'Customers',
      description: 'Manage customer records.',
    },
    {
      name: 'Documents',
      description: 'Manage documents for RAG knowledge base.',
    },
    {
      name: 'OpenAI Compatible',
      description:
        'OpenAI Chat Completions compatible API. Use any OpenAI SDK by pointing base_url to this server.',
    },
    {
      name: 'Products',
      description: 'Manage product catalog entries.',
    },
    {
      name: 'Threads',
      description:
        'Manage AI chat threads — create, list, archive, and retrieve messages.',
    },
    {
      name: 'Vendors',
      description: 'Manage vendor records.',
    },
    {
      name: 'Websites',
      description: 'Manage website sources for crawling and indexing.',
    },
    {
      name: 'Workflows',
      description:
        'Manage workflow schedules, webhooks, executions, and triggers.',
    },
    { name: 'query', description: 'Read-only functions that fetch data' },
    { name: 'mutation', description: 'Functions that modify data' },
    { name: 'action', description: 'Functions that can call external APIs' },
  ];

  // Inject OpenAI-compatible endpoints (custom HTTP routes not covered by convex-helpers)
  injectOpenAICompatPaths(spec);

  // Inject REST API endpoints
  injectRestApiPaths(spec);

  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // Output only the public-facing spec (curated endpoints for external use)
  const publicSpec = generatePublicSpec(spec);
  writeFileSync(outputPath, JSON.stringify(publicSpec, null, 2), 'utf-8');

  rmSync(tempYamlPath, { force: true });

  console.log(`OpenAPI spec written to ${outputPath}`);
}

/**
 * Curated list of public-facing endpoint path prefixes to include in the
 * Swagger UI. Only endpoints matching these prefixes are shown.
 */
const PUBLIC_ENDPOINT_PREFIXES = [
  // All manually maintained REST API endpoints live under /api/v1/
  '/api/v1/',
];

/**
 * Generate a lightweight public-facing OpenAPI spec for the Swagger UI.
 *
 * Only includes curated endpoints that external integrators need.
 */
function generatePublicSpec(fullSpec: OpenApiSpec): OpenApiSpec {
  const publicPaths: Record<string, unknown> = {};

  for (const [path, def] of Object.entries(fullSpec.paths)) {
    if (PUBLIC_ENDPOINT_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      publicPaths[path] = def;
    }
  }

  // Collect referenced schemas
  const referencedSchemas = new Set<string>();
  const json = JSON.stringify(publicPaths);
  const refPattern = /#\/components\/schemas\/([^"]+)/g;
  let match;
  while ((match = refPattern.exec(json)) !== null) {
    referencedSchemas.add(match[1]);
  }

  // Recursively resolve nested schema refs
  let prevSize = 0;
  while (referencedSchemas.size !== prevSize) {
    prevSize = referencedSchemas.size;
    for (const name of Array.from(referencedSchemas)) {
      const schema = fullSpec.components.schemas[name];
      if (!schema) continue;
      const schemaJson = JSON.stringify(schema);
      let nested;
      while ((nested = refPattern.exec(schemaJson)) !== null) {
        referencedSchemas.add(nested[1]);
      }
    }
  }

  const publicSchemas: Record<string, unknown> = {};
  for (const name of referencedSchemas) {
    if (fullSpec.components.schemas[name]) {
      publicSchemas[name] = fullSpec.components.schemas[name];
    }
  }

  return {
    openapi: fullSpec.openapi,
    info: {
      title: 'Tale Public API',
      version: '1.0.0',
      description: `
Tale Platform REST API.

## Authentication

All endpoints require a Bearer token:

\`\`\`
Authorization: Bearer tale_...
\`\`\`

Create API keys in **Settings > API Keys**.

## Quick start — REST API

\`\`\`bash
# List documents
curl -H "Authorization: Bearer tale_..." https://your-instance.com/api/v1/documents

# Create a product
curl -X POST -H "Authorization: Bearer tale_..." \\
  -H "Content-Type: application/json" \\
  -d '{"name": "New Product", "price": 9.99}' \\
  https://your-instance.com/api/v1/products

# List chat threads
curl -H "Authorization: Bearer tale_..." https://your-instance.com/api/v1/threads
\`\`\`

## Quick start — OpenAI Compatible

Use any OpenAI-compatible SDK. List available models with \`GET /api/v1/models\`.

\`\`\`python
from openai import OpenAI

client = OpenAI(
    base_url="https://your-instance.com/api/v1",
    api_key="tale_...",
)

# List available models
models = client.models.list()
for m in models.data:
    print(m.id, m.owned_by)

# Chat completion
response = client.chat.completions.create(
    model="anthropic/claude-sonnet-4.6",  # Use a model ID from the list above
    messages=[{"role": "user", "content": "Hello!"}],
)
print(response.choices[0].message.content)
\`\`\`
`.trim(),
    },
    servers: fullSpec.servers,
    security: [{ bearerAuth: [] }],
    paths: publicPaths,
    components: {
      securitySchemes: {
        bearerAuth: fullSpec.components.securitySchemes?.bearerAuth ?? {
          type: 'http',
          scheme: 'bearer',
          description: 'API key as Bearer token.',
        },
      },
      schemas: publicSchemas,
    },
    tags: (fullSpec.tags ?? []).filter((t) =>
      [
        'OpenAI Compatible',
        'Documents',
        'Websites',
        'Products',
        'Customers',
        'Vendors',
        'Agents',
        'Threads',
        'Workflows',
      ].includes(t.name),
    ),
  };
}

main();
