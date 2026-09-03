/**
 * The OpenAPI document behind the Swagger UI at `/docs` — built statically,
 * with no side effects, so `scripts/openapi/spec.test.ts` can hold it against
 * the `/api/v1` router (every path+method here is a registered route and
 * vice versa) and against the handlers' real response shapes. When you add,
 * move, or remove a `/api/v1` route, or change what one answers, this file
 * changes in the same commit; `bun run generate:openapi` rewrites
 * `public/openapi.json` from it.
 *
 * Every description below is the handler's contract as implemented (the
 * backend/rest/* adapters over the domain services), not an aspiration.
 */

// ── Small builders ───────────────────────────────────────────────────────────

export type Json = Record<string, unknown>;

const sec = [{ bearerAuth: [] }];

/** The flat error envelope every non-2xx response carries. */
function errorResponse(description: string) {
  return {
    description,
    content: {
      'application/json': { schema: { $ref: '#/components/schemas/Error' } },
    },
  };
}

const standardErrors = {
  '400': errorResponse('Invalid request (malformed body or parameters)'),
  '401': errorResponse('Missing or invalid API key'),
  '429': errorResponse('Rate limit exceeded (Retry-After names the wait)'),
};

function jsonBody(schema: Json, required = true) {
  return { required, content: { 'application/json': { schema } } };
}

function jsonResponse(description: string, schema?: Json) {
  if (!schema) return { description };
  return { description, content: { 'application/json': { schema } } };
}

/** A `201 {id}` answer — what every create route in the knowledge families
 * returns (read the resource back with its GET). */
function createdId(description: string) {
  return jsonResponse(description, {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' } },
  });
}

function noContent(description: string) {
  return { description };
}

function ref(name: string): Json {
  return { $ref: `#/components/schemas/${name}` };
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
  opts?: { type?: string },
) {
  return {
    name,
    in: 'query' as const,
    required: false,
    schema: { type: opts?.type ?? 'string' },
    description,
  };
}

/** `cursor` + `limit` for the keyset-paginated families. */
function paginationParams(max: number, fallback: number) {
  return [
    queryParam(
      'cursor',
      'The previous page’s `continueCursor` — opaque; omit for the first page',
    ),
    queryParam(
      'limit',
      `Page size, 1..${max} (default ${fallback}; out-of-range values are clamped)`,
      { type: 'integer' },
    ),
  ];
}

/** A paginated envelope: `{page: [...], isDone, continueCursor}`. */
function pageOf(item: Json): Json {
  return {
    type: 'object',
    required: ['page', 'isDone', 'continueCursor'],
    properties: {
      page: { type: 'array', items: item },
      isDone: { type: 'boolean' },
      continueCursor: {
        type: 'string',
        description:
          'Pass back as `cursor` for the next page; empty when `isDone`',
      },
    },
  };
}

/** A named-array envelope: `{<name>: [...]}` — a bounded window or a
 * complete set, never a cursor walk. */
function listOf(name: string, item: Json, extra: Json = {}): Json {
  return {
    type: 'object',
    required: [name, ...Object.keys(extra)],
    properties: { [name]: { type: 'array', items: item }, ...extra },
  };
}

const nullable = (schema: Json): Json => ({ ...schema, nullable: true });
const str: Json = { type: 'string' };
const num: Json = { type: 'number' };
const int: Json = { type: 'integer' };
const bool: Json = { type: 'boolean' };
const obj: Json = { type: 'object', additionalProperties: true };
const strArray: Json = { type: 'array', items: str };

const automationNameParam = pathParam(
  'name',
  'The automation name — a `/`-separated slug written with `__` in place of ' +
    'each `/` (`billing/dunning` travels as `billing__dunning`). Responses ' +
    'always carry the real slug.',
);

/** The tenant header the write-capable project endpoints demand of
 * multi-org keys. */
const orgSlugHeaderParam = {
  name: 'X-Organization-Slug',
  in: 'header' as const,
  required: false,
  schema: { type: 'string' },
  description:
    'The organization to operate on. STRICTLY REQUIRED when the key holder ' +
    'belongs to more than one organization — without it such requests are ' +
    'refused with 400 (the last-active-org fallback is never used here). ' +
    'Single-organization keys may omit it.',
};

// ── The spec ─────────────────────────────────────────────────────────────────

export function buildSpec(): Json {
  const paths: Record<string, Json> = {};

  // ── Documents (the Knowledge-Hub lane) ────────────────────────────────────

  paths['/api/v1/documents'] = {
    get: {
      tags: ['Documents'],
      summary: 'List documents',
      description:
        'Knowledge-hub documents the key holder can see, newest first — ' +
        'project files never appear here (the Projects family owns them). ' +
        '`content` is not carried in the listing; read one document for it.',
      operationId: 'listDocuments',
      security: sec,
      parameters: [
        ...paginationParams(100, 25),
        queryParam('sourceProvider', 'Only documents from this source'),
        queryParam('folderId', 'Only documents inside this folder'),
      ],
      responses: {
        '200': jsonResponse('Paginated documents', pageOf(ref('Document'))),
        ...standardErrors,
      },
    },
    post: {
      tags: ['Documents'],
      summary: 'Create document',
      description:
        'Requires a documents-write role. Either inline `content` or a ' +
        '`fileId` (an uploaded blob reference) backs the document.',
      operationId: 'createDocument',
      security: sec,
      requestBody: jsonBody(ref('DocumentInput')),
      responses: {
        '201': createdId('Created — the new document’s id'),
        '403': errorResponse('The key holder’s role cannot write documents'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/documents/{id}'] = {
    get: {
      tags: ['Documents'],
      summary: 'Get document',
      description:
        'A document with its `content`. A project file, a foreign document ' +
        'and a nonexistent id all answer the same opaque 404.',
      operationId: 'getDocument',
      security: sec,
      parameters: [pathParam('id', 'Document ID')],
      responses: {
        '200': jsonResponse('The document', ref('Document')),
        '404': errorResponse('Document not found'),
        ...standardErrors,
      },
    },
    patch: {
      tags: ['Documents'],
      summary: 'Update document',
      description:
        'Partial update; a `null` clears an optional field. Requires a ' +
        'documents-write role; a controlled record under review, approval or ' +
        'legal hold refuses the change.',
      operationId: 'updateDocument',
      security: sec,
      parameters: [pathParam('id', 'Document ID')],
      requestBody: jsonBody(ref('DocumentPatch')),
      responses: {
        '204': noContent('Updated'),
        '403': errorResponse('The key holder’s role cannot write documents'),
        '404': errorResponse('Document not found'),
        '409': errorResponse('The record is protected'),
        ...standardErrors,
      },
    },
    delete: {
      tags: ['Documents'],
      summary: 'Delete document',
      description:
        'The permanent delete: role gate, controlled-record protection, ' +
        'legal holds, sync stop and the audit row, then the purge.',
      operationId: 'deleteDocument',
      security: sec,
      parameters: [pathParam('id', 'Document ID')],
      responses: {
        '204': noContent('Deleted'),
        '403': errorResponse('The key holder’s role cannot write documents'),
        '404': errorResponse('Document not found'),
        '409': errorResponse(
          'A protected record (`DOCUMENT_RECORD_PROTECTED`) or a legal hold',
        ),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/documents/{id}/retry-indexing'] = {
    post: {
      tags: ['Documents'],
      summary: 'Retry RAG indexing',
      description:
        'Re-queues the document’s blob for knowledge indexing. Requires a ' +
        'documents-write role. Answers `skipped` — honestly — for a ' +
        'content-only document, a blob the platform does not track, or a ' +
        'file whose RAG opt-out is persisted.',
      operationId: 'retryDocumentIndexing',
      security: sec,
      parameters: [pathParam('id', 'Document ID')],
      responses: {
        '200': jsonResponse('Whether indexing was queued', {
          type: 'object',
          required: ['status'],
          properties: {
            status: { type: 'string', enum: ['indexing', 'skipped'] },
          },
        }),
        '403': errorResponse('The key holder’s role cannot write documents'),
        '404': errorResponse('Document not found'),
        ...standardErrors,
      },
    },
  };

  // ── Websites ──────────────────────────────────────────────────────────────

  paths['/api/v1/websites'] = {
    get: {
      tags: ['Websites'],
      summary: 'List websites',
      operationId: 'listWebsites',
      security: sec,
      parameters: [
        ...paginationParams(200, 25),
        queryParam('status', 'Only websites in this crawl status'),
        queryParam('scanInterval', 'Only websites on this scan interval'),
      ],
      responses: {
        '200': jsonResponse('Paginated websites', pageOf(ref('Website'))),
        ...standardErrors,
      },
    },
    post: {
      tags: ['Websites'],
      summary: 'Create website',
      description:
        'Registers a domain for crawling and schedules the first crawl. ' +
        'With `urls`, registers (or, for an existing domain, extends) a ' +
        'curated URL list instead of a whole-site crawl.',
      operationId: 'createWebsite',
      security: sec,
      requestBody: jsonBody(ref('WebsiteInput')),
      responses: {
        '201': createdId('Created — the website’s id'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/websites/{id}'] = {
    get: {
      tags: ['Websites'],
      summary: 'Get website',
      operationId: 'getWebsite',
      security: sec,
      parameters: [pathParam('id', 'Website ID')],
      responses: {
        '200': jsonResponse('The website', ref('Website')),
        '404': errorResponse('Website not found'),
        ...standardErrors,
      },
    },
    patch: {
      tags: ['Websites'],
      summary: 'Update website',
      operationId: 'updateWebsite',
      security: sec,
      parameters: [pathParam('id', 'Website ID')],
      requestBody: jsonBody(ref('WebsitePatch')),
      responses: {
        '204': noContent('Updated'),
        '404': errorResponse('Website not found'),
        ...standardErrors,
      },
    },
    delete: {
      tags: ['Websites'],
      summary: 'Delete website',
      description: 'Deregisters the crawl and removes the website.',
      operationId: 'deleteWebsite',
      security: sec,
      parameters: [pathParam('id', 'Website ID')],
      responses: {
        '204': noContent('Deleted'),
        '404': errorResponse('Website not found'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/websites/{id}/pages'] = {
    get: {
      tags: ['Websites'],
      summary: 'Fetch pages',
      description:
        'The crawled pages of a website — OFFSET-paginated (`offset` + ' +
        '`limit`, default 100), answering `{pages, total, offset, hasMore}`.',
      operationId: 'listWebsitePages',
      security: sec,
      parameters: [
        pathParam('id', 'Website ID'),
        queryParam('offset', 'Rows to skip (default 0)', { type: 'integer' }),
        queryParam('limit', 'Rows to return (default 100)', {
          type: 'integer',
        }),
      ],
      responses: {
        '200': jsonResponse('The pages window', ref('WebsitePageList')),
        '404': errorResponse('Website not found'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/websites/{id}/sync'] = {
    post: {
      tags: ['Websites'],
      summary: 'Sync statuses',
      description:
        'Schedules the per-site corpus → row status sync and answers ' +
        'immediately; `syncing` means the job is queued, not finished.',
      operationId: 'syncWebsite',
      security: sec,
      parameters: [pathParam('id', 'Website ID')],
      responses: {
        '200': jsonResponse('Sync scheduled', {
          type: 'object',
          required: ['status'],
          properties: { status: { type: 'string', enum: ['syncing'] } },
        }),
        '404': errorResponse('Website not found'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/websites/{id}/search'] = {
    post: {
      tags: ['Websites'],
      summary: 'Search content',
      description:
        'A POST because it carries a body, not because it writes: semantic ' +
        'search over this website’s crawled content.',
      operationId: 'searchWebsite',
      security: sec,
      parameters: [pathParam('id', 'Website ID')],
      requestBody: jsonBody({
        type: 'object',
        required: ['query'],
        properties: { query: str, limit: int },
      }),
      responses: {
        '200': jsonResponse('Matches', ref('WebsiteSearchResults')),
        '404': errorResponse('Website not found'),
        ...standardErrors,
      },
    },
  };

  // ── Products ──────────────────────────────────────────────────────────────

  paths['/api/v1/products'] = {
    get: {
      tags: ['Products'],
      summary: 'List products',
      description: 'Most recently updated first.',
      operationId: 'listProducts',
      security: sec,
      parameters: [
        ...paginationParams(200, 25),
        queryParam('status', 'Only products in this status'),
        queryParam('category', 'Only products in this category'),
      ],
      responses: {
        '200': jsonResponse('Paginated products', pageOf(ref('Product'))),
        ...standardErrors,
      },
    },
    post: {
      tags: ['Products'],
      summary: 'Create product',
      operationId: 'createProduct',
      security: sec,
      requestBody: jsonBody(ref('ProductInput')),
      responses: {
        '201': createdId('Created — the product’s id'),
        '409': errorResponse('Duplicate external id'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/products/{id}'] = {
    get: {
      tags: ['Products'],
      summary: 'Get product',
      operationId: 'getProduct',
      security: sec,
      parameters: [pathParam('id', 'Product ID')],
      responses: {
        '200': jsonResponse('The product', ref('Product')),
        '404': errorResponse('Product not found'),
        ...standardErrors,
      },
    },
    patch: {
      tags: ['Products'],
      summary: 'Update product',
      operationId: 'updateProduct',
      security: sec,
      parameters: [pathParam('id', 'Product ID')],
      requestBody: jsonBody(ref('ProductInput')),
      responses: {
        '200': jsonResponse('The updated product', ref('Product')),
        '404': errorResponse('Product not found'),
        '409': errorResponse('Duplicate external id'),
        ...standardErrors,
      },
    },
    delete: {
      tags: ['Products'],
      summary: 'Delete product',
      operationId: 'deleteProduct',
      security: sec,
      parameters: [pathParam('id', 'Product ID')],
      responses: {
        '204': noContent('Deleted'),
        '404': errorResponse('Product not found'),
        ...standardErrors,
      },
    },
  };

  // ── Contacts ──────────────────────────────────────────────────────────────

  paths['/api/v1/contacts'] = {
    get: {
      tags: ['Contacts'],
      summary: 'List contacts',
      description: 'Most recently updated first; trashed contacts are hidden.',
      operationId: 'listContacts',
      security: sec,
      parameters: [
        ...paginationParams(200, 25),
        queryParam('source', 'Only contacts from this source'),
      ],
      responses: {
        '200': jsonResponse('Paginated contacts', pageOf(ref('Contact'))),
        ...standardErrors,
      },
    },
    post: {
      tags: ['Contacts'],
      summary: 'Create contact',
      description: '`source` defaults to `api_import`.',
      operationId: 'createContact',
      security: sec,
      requestBody: jsonBody(ref('ContactInput')),
      responses: {
        '201': createdId('Created — the contact’s id'),
        '409': errorResponse('Duplicate email or external id'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/contacts/bulk'] = {
    post: {
      tags: ['Contacts'],
      summary: 'Create contacts in bulk',
      description:
        'Up to 500 contacts per call, each needing an `email`. Rows are ' +
        'created independently: the result counts successes and failures ' +
        'and names each failed row with its reason.',
      operationId: 'bulkCreateContacts',
      security: sec,
      requestBody: jsonBody({
        type: 'object',
        required: ['contacts'],
        properties: {
          contacts: {
            type: 'array',
            maxItems: 500,
            items: ref('ContactInput'),
          },
        },
      }),
      responses: {
        '201': jsonResponse('Bulk creation result', ref('BulkCreateResult')),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/contacts/{id}'] = {
    get: {
      tags: ['Contacts'],
      summary: 'Get contact',
      operationId: 'getContact',
      security: sec,
      parameters: [pathParam('id', 'Contact ID')],
      responses: {
        '200': jsonResponse('The contact', ref('Contact')),
        '404': errorResponse('Contact not found'),
        ...standardErrors,
      },
    },
    patch: {
      tags: ['Contacts'],
      summary: 'Update contact',
      operationId: 'patchContact',
      security: sec,
      parameters: [pathParam('id', 'Contact ID')],
      requestBody: jsonBody(ref('ContactInput')),
      responses: {
        '200': jsonResponse('The updated contact', ref('Contact')),
        '404': errorResponse('Contact not found'),
        '409': errorResponse('Duplicate email or external id'),
        ...standardErrors,
      },
    },
    delete: {
      tags: ['Contacts'],
      summary: 'Delete contact',
      operationId: 'deleteContact',
      security: sec,
      parameters: [pathParam('id', 'Contact ID')],
      responses: {
        '204': noContent('Deleted'),
        '404': errorResponse('Contact not found'),
        ...standardErrors,
      },
    },
  };

  // ── Projects ──────────────────────────────────────────────────────────────

  paths['/api/v1/projects'] = {
    get: {
      tags: ['Projects'],
      summary: 'Look up a project by external item id',
      description:
        'A lookup door, not a list-all: `externalItemId` is REQUIRED (400 ' +
        'without it). Answers at most one project — the key is unique per ' +
        'organization. A project the key holder cannot see answers the same ' +
        'empty list as no match. The row carries `archivedAt` when the match ' +
        'is archived, so callers can detect an archived project holding the ' +
        'key. Shares the general REST bucket (120/min, keyed on the key ' +
        'holder).',
      operationId: 'lookupProjects',
      security: sec,
      parameters: [
        orgSlugHeaderParam,
        {
          ...queryParam(
            'externalItemId',
            'The caller-owned external key the project was created with',
          ),
          required: true,
        },
      ],
      responses: {
        '200': jsonResponse(
          'Zero or one matching project',
          listOf('projects', ref('Project')),
        ),
        ...standardErrors,
      },
    },
    post: {
      tags: ['Projects'],
      summary: 'Create a project',
      description:
        'Requires the org editor role. `externalItemId` is an opaque ' +
        'caller-owned key, stored trimmed, unique per organization ' +
        'regardless of lifecycle — a conflict against an archived project ' +
        'is still a 409. A blank or over-long value is a 400. `key` (the ' +
        'task-identifier prefix) is derived from the name when omitted; a ' +
        'derived key that collides gets a numeric suffix, and a name no key ' +
        'can be derived from creates the project keyless — only an EXPLICIT ' +
        '`key` conflict answers 409.',
      operationId: 'createProject',
      security: sec,
      parameters: [orgSlugHeaderParam],
      requestBody: jsonBody({
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', maxLength: 80 },
          externalItemId: { type: 'string', maxLength: 256 },
          key: {
            type: 'string',
            description:
              'Immutable 2-6 char task-key prefix. Omitted: derived from ' +
              'the name, suffixed on collision, keyless when underivable. ' +
              'Explicit: a collision is a 409.',
          },
          description: { type: 'string', maxLength: 500 },
        },
      }),
      responses: {
        '201': jsonResponse('Created project', {
          type: 'object',
          required: ['project'],
          properties: { project: ref('Project') },
        }),
        '403': errorResponse('The key holder is not an org editor'),
        '409': errorResponse('Duplicate externalItemId or project key'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/projects/{id}'] = {
    get: {
      tags: ['Projects'],
      summary: 'Get a project',
      description:
        'Answers an opaque 404 for a project that is cross-organization, ' +
        'invisible to the key holder, or does not exist — the three are ' +
        'indistinguishable.',
      operationId: 'getProject',
      security: sec,
      parameters: [orgSlugHeaderParam, pathParam('id', 'Project ID')],
      responses: {
        '200': jsonResponse('The project', {
          type: 'object',
          required: ['project'],
          properties: { project: ref('Project') },
        }),
        '404': errorResponse('Project not found'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/projects/{id}/folders'] = {
    get: {
      tags: ['Projects'],
      summary: 'List the project’s root folders',
      description:
        'Top-level folders only, NOT paginated — a project holds a handful ' +
        'of period folders, not an unbounded tree.',
      operationId: 'listProjectFolders',
      security: sec,
      parameters: [orgSlugHeaderParam, pathParam('id', 'Project ID')],
      responses: {
        '200': jsonResponse(
          'The root folders',
          listOf('folders', ref('ProjectFolder')),
        ),
        '404': errorResponse('Project not found'),
        ...standardErrors,
      },
    },
    post: {
      tags: ['Projects'],
      summary: 'Get or create a folder',
      description:
        'GET-OR-CREATE semantics: an exact-name match under the same parent ' +
        'answers 200 with `created: false`; otherwise the folder is created ' +
        'and answered 201 with `created: true`. `parentId` must name a ' +
        'folder of THIS project (an opaque 404 otherwise); omit it for a ' +
        'root folder. Requires the org editor role and project edit access. ' +
        'Charged against the general REST bucket (120/min) and the per-org ' +
        '`folder:mutate` budget the in-app folder actions share.',
      operationId: 'getOrCreateProjectFolder',
      security: sec,
      parameters: [orgSlugHeaderParam, pathParam('id', 'Project ID')],
      requestBody: jsonBody({
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', maxLength: 255 },
          parentId: {
            type: 'string',
            description: 'Parent folder id (a folder of this project)',
          },
        },
      }),
      responses: {
        '200': jsonResponse('The existing folder', ref('ProjectFolderResult')),
        '201': jsonResponse('The created folder', ref('ProjectFolderResult')),
        '403': errorResponse('No project edit access'),
        '404': errorResponse('Project or parent folder not found'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/projects/{id}/uploads'] = {
    post: {
      tags: ['Projects'],
      summary: 'Mint an upload handoff',
      description:
        'Answers where to send the bytes: `method: "PUT"` is a presigned ' +
        'URL for the organization’s own bucket (bind the returned `s3Ref` ' +
        'afterwards) — a declared `contentType` is signed into the URL, so ' +
        'the PUT must carry that exact `Content-Type` header (omit ' +
        '`contentType` and the PUT has no header requirement); ' +
        '`method: "POST"` targets platform storage and answers ' +
        '`{"storageId": …}` — bind that id. The `uploadId` is a single-use ' +
        'intent valid until `expiresAt` (60 minutes); complete the upload ' +
        'with `POST /api/v1/projects/{id}/files`. Requires the org editor ' +
        'role and project edit access. Uses the upload lane bucket ' +
        '(240/min — one logical upload is several calls; keyed on the key ' +
        'holder like every REST budget).',
      operationId: 'createProjectUpload',
      security: sec,
      parameters: [orgSlugHeaderParam, pathParam('id', 'Project ID')],
      requestBody: jsonBody(
        {
          type: 'object',
          properties: {
            fileName: { type: 'string' },
            contentType: { type: 'string' },
          },
        },
        false,
      ),
      responses: {
        '200': jsonResponse('The upload handoff', ref('ProjectUploadHandoff')),
        '403': errorResponse('No project edit access'),
        '404': errorResponse('Project not found'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/projects/{id}/files/{documentId}/content'] = {
    get: {
      tags: ['Projects'],
      summary: 'Download a project file',
      description:
        'The result lane: fetch the bytes of a file in the project — ' +
        'including what an automation filed back (a prepared return, a ' +
        'report). Every blob is object-storage backed, so the answer is a ' +
        '**302** to a short-lived presigned URL — follow redirects. ' +
        'Visibility is the minting user’s; a cross-project, ' +
        'cross-organization, trashed, or absent file answers the same ' +
        'opaque 404.',
      operationId: 'downloadProjectFile',
      security: sec,
      parameters: [
        orgSlugHeaderParam,
        pathParam('id', 'Project ID'),
        pathParam('documentId', 'File (document) ID'),
      ],
      responses: {
        '302': {
          description: 'Redirect to a short-lived presigned URL',
        },
        '404': errorResponse('File not found'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/projects/{id}/files'] = {
    get: {
      tags: ['Projects'],
      summary: 'List the project’s files',
      description:
        'Paginated (`cursor` + `limit`, answering `{files, cursor?}` — no ' +
        '`cursor` in the response means the listing is complete). ' +
        '`folderId` narrows to one folder of this project. Project files ' +
        'never appear in `GET /api/v1/documents` — that is the knowledge ' +
        'hub’s surface.',
      operationId: 'listProjectFiles',
      security: sec,
      parameters: [
        orgSlugHeaderParam,
        pathParam('id', 'Project ID'),
        queryParam('folderId', 'Only files inside this project folder'),
        ...paginationParams(100, 25),
      ],
      responses: {
        '200': jsonResponse('The files', {
          type: 'object',
          required: ['files'],
          properties: {
            files: { type: 'array', items: ref('ProjectFile') },
            cursor: {
              type: 'string',
              description: 'Present while more pages remain',
            },
          },
        }),
        '404': errorResponse('Project or folder not found'),
        ...standardErrors,
      },
    },
    post: {
      tags: ['Projects'],
      summary: 'Bind an uploaded blob as a project file',
      description:
        'Consumes the single-use `uploadId` minted by `POST …/uploads` and ' +
        'creates the document. `fileId` is the `s3Ref` for a PUT handoff, or ' +
        'the `storageId` the platform-storage POST answered. `folderId` is ' +
        'REQUIRED and must belong to this project. `skipRagIndexing` ' +
        'DEFAULTS TO TRUE — project ledger files are working material, not ' +
        'organization knowledge; pass `false` explicitly to index the file ' +
        'into the knowledge corpus. Upload policy applies (authoritative ' +
        'size cap → 413, MIME allowlist → 415). Uses the upload lane bucket ' +
        '(240/min, keyed on the key holder).',
      operationId: 'bindProjectFile',
      security: sec,
      parameters: [orgSlugHeaderParam, pathParam('id', 'Project ID')],
      requestBody: jsonBody({
        type: 'object',
        required: ['uploadId', 'fileId', 'folderId', 'fileName'],
        properties: {
          uploadId: { type: 'string' },
          fileId: { type: 'string' },
          folderId: { type: 'string' },
          fileName: { type: 'string' },
          contentType: { type: 'string' },
          skipRagIndexing: { type: 'boolean', default: true },
        },
      }),
      responses: {
        '201': jsonResponse('The bound file', {
          type: 'object',
          required: ['file'],
          properties: {
            file: {
              type: 'object',
              required: ['id', 'fileName', 'folderId', 'projectId'],
              properties: {
                id: { type: 'string' },
                fileName: { type: 'string' },
                folderId: { type: 'string' },
                projectId: { type: 'string' },
              },
            },
          },
        }),
        '403': errorResponse('No project edit access'),
        '404': errorResponse('Project or folder not found'),
        '413': errorResponse('File exceeds the size cap'),
        '415': errorResponse('Unsupported file type'),
        ...standardErrors,
        // Richer than the standard 400: the handshake refusals land here too.
        '400': errorResponse(
          'Malformed body, or the upload intent is unknown, expired, ' +
            'already consumed, or does not match `fileId`',
        ),
      },
    },
  };

  // ── Tasks ─────────────────────────────────────────────────────────────────

  paths['/api/v1/tasks'] = {
    post: {
      tags: ['Tasks'],
      summary: 'Create a task from an external ref (idempotent)',
      description:
        'Materializes an external item as a task of one project, keyed by ' +
        '`(projectId, externalSystem, externalId)`: the first call creates ' +
        '(201, `created: true`), any repeat answers the SAME task (200, ' +
        '`created: false`) instead of a duplicate — safe for a worker that ' +
        'retries after a crash. `projectId` is REQUIRED: this door never ' +
        'falls back to the org-wide project, and the project must exist AND ' +
        'be visible to the key’s minting user (an opaque 404 otherwise). ' +
        '`externalId` is a caller-owned opaque key the platform never ' +
        'interprets; `externalUrl` is stored verbatim. The task is created ' +
        'by the minting user; over-long titles are truncated to the board ' +
        'cap rather than refused. When `runWorkflowSlug` names a deployed ' +
        'automation, a NEWLY created task also schedules that workflow on ' +
        'itself — the response then carries `executionId: null` (the start ' +
        'is scheduled, no run identity yet). To recover the run identity, ' +
        'call `POST /api/v1/tasks/{id}/start` ONCE — it answers ' +
        '`already_running` with the live run’s executionId while the run is ' +
        'in flight — then poll `GET /api/v1/runs/{runId}`. Do NOT poll ' +
        '`/start` itself: once the run settles, another call starts a fresh ' +
        'run. Skipped on an idempotent re-pick. Shares the general REST ' +
        'bucket (120/min, keyed on the key holder).',
      operationId: 'createTask',
      security: sec,
      parameters: [orgSlugHeaderParam],
      requestBody: jsonBody({
        type: 'object',
        required: ['projectId', 'externalSystem', 'externalId', 'title'],
        properties: {
          projectId: {
            type: 'string',
            description: 'The destination project — required, never defaulted',
          },
          externalSystem: {
            type: 'string',
            maxLength: 100,
            description: 'The external system the ref belongs to',
          },
          externalId: {
            type: 'string',
            maxLength: 500,
            description:
              'Caller-owned natural key, opaque to the platform; the ' +
              'idempotency key within the project (per externalSystem)',
          },
          title: { type: 'string', maxLength: 2000 },
          description: { type: 'string', maxLength: 20000 },
          labels: {
            type: 'array',
            items: { type: 'string', maxLength: 50 },
            maxItems: 50,
            description:
              'Label names, resolved against (and added to) the project’s ' +
              'label catalog',
          },
          externalUrl: {
            type: 'string',
            maxLength: 2048,
            description: 'Generic external reference, stored verbatim',
          },
          runWorkflowSlug: {
            type: 'string',
            maxLength: 200,
            description:
              'Deployed automation to schedule on the task when (and only ' +
              'when) this call CREATES it',
          },
          automationSlug: {
            type: 'string',
            maxLength: 200,
            description:
              'Attribute the task to this automation WITHOUT starting ' +
              'anything: it becomes the assignee, which the task modal’s ' +
              'work panel (Start, run progress, operator questions) keys ' +
              'on. Send it when creating tasks an automation will operate. ' +
              'A re-pick fills a missing attribution but never overwrites ' +
              'an existing assignee.',
          },
        },
      }),
      responses: {
        '201': jsonResponse('Created', ref('TaskUpsertResult')),
        '200': jsonResponse(
          'The task already existed (idempotent re-pick)',
          ref('TaskUpsertResult'),
        ),
        '404': errorResponse('Project not found (or not visible to the key)'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/tasks/{id}/comments'] = {
    get: {
      tags: ['Tasks'],
      summary: 'List the task’s comments',
      description:
        'The discussion read lane: what automations reported back (prepared ' +
        'figures, operator questions, setup summaries) and what people ' +
        'replied — chronological, capped at the same bound the app renders. ' +
        '`authorType` separates `user` and `agent` voices. Visibility is ' +
        'the minting user’s, like every task read.',
      operationId: 'listTaskComments',
      security: sec,
      parameters: [orgSlugHeaderParam, pathParam('id', 'Task ID')],
      responses: {
        '200': jsonResponse(
          'The discussion, oldest first',
          listOf('comments', {
            type: 'object',
            required: ['id', 'authorType', 'authorId', 'body', 'createdAt'],
            properties: {
              id: { type: 'string' },
              authorType: { type: 'string', enum: ['user', 'agent'] },
              authorId: { type: 'string' },
              body: { type: 'string' },
              createdAt: { type: 'number' },
              editedAt: { type: 'number' },
            },
          }),
        ),
        '404': errorResponse('Task not found'),
        ...standardErrors,
      },
    },
    post: {
      tags: ['Tasks'],
      summary: 'Comment on the task as the key’s user',
      description:
        'Posts into the task’s discussion AS THE MINTING USER (author and ' +
        'actor type `user`) — indistinguishable from the same person ' +
        'commenting in the app, @mention behaviour included. Commenting is ' +
        'a READ-level action: any member who can see the task may post. ' +
        'The body is capped at 10000 characters and charged against the ' +
        'same per-user `task:comment` budget as in-app comments (429 with ' +
        'Retry-After beyond it).',
      operationId: 'addTaskComment',
      security: sec,
      parameters: [orgSlugHeaderParam, pathParam('id', 'Task ID')],
      requestBody: jsonBody({
        type: 'object',
        required: ['body'],
        properties: {
          body: {
            type: 'string',
            maxLength: 10000,
            description: 'The comment text',
          },
        },
      }),
      responses: {
        '201': jsonResponse('The posted comment', {
          type: 'object',
          required: ['comment'],
          properties: {
            comment: {
              type: 'object',
              required: ['id'],
              properties: { id: { type: 'string' } },
            },
          },
        }),
        '404': errorResponse('Task not found'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/tasks/{id}'] = {
    get: {
      tags: ['Tasks'],
      summary: 'Get a task',
      description:
        'The task’s state for a polling worker. Visibility is the minting ' +
        'user’s (a task inherits its project’s access): a cross-organization ' +
        'id, an invisible task, and a nonexistent one all answer the same ' +
        'opaque 404. The task row carries NO live-run linkage — to follow a ' +
        'workflow run, keep the `executionId` answered by `POST ' +
        '/api/v1/tasks/{id}/start` and poll `GET /api/v1/runs/{runId}`.',
      operationId: 'getTask',
      security: sec,
      parameters: [orgSlugHeaderParam, pathParam('id', 'Task ID')],
      responses: {
        '200': jsonResponse('The task', {
          type: 'object',
          required: ['task'],
          properties: { task: ref('Task') },
        }),
        '404': errorResponse('Task not found'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/tasks/{id}/start'] = {
    post: {
      tags: ['Tasks'],
      summary: 'Start a deployed workflow on the task',
      description:
        'Starts a fresh, subject-linked run of `workflowSlug` carrying the ' +
        'task as its input — the REST twin of the task board’s Start. RBAC ' +
        'is deliberately the session action’s: org membership plus the ' +
        'task’s READ visibility, NOT the developer gate `POST ' +
        '/api/v1/automations/{name}/runs` applies — that endpoint starts a ' +
        'run with arbitrary input, while this one is task-subject-bound ' +
        '(its input IS the task), which narrows the blast radius; deploying ' +
        'the workflow was the privileged act. The run is attributed ' +
        '`api-key:<userId>` in the run log, so machine starts stay ' +
        'distinguishable from human UI starts. Answers the session shape: ' +
        '`started: true` with the new run’s `executionId` (poll `GET ' +
        '/api/v1/runs/{runId}`); `already_running` with the in-flight run’s ' +
        'id instead of racing a duplicate over the same task; `not_started` ' +
        'when the slug names no deployed automation (or the start failed) — ' +
        'the task itself is untouched either way. Work-starting lane: ' +
        'charged against the execute bucket (20/min) on top of the general ' +
        'one (120/min); both keyed on the key holder.',
      operationId: 'startTaskWorkflow',
      security: sec,
      parameters: [orgSlugHeaderParam, pathParam('id', 'Task ID')],
      requestBody: jsonBody({
        type: 'object',
        required: ['workflowSlug'],
        properties: {
          workflowSlug: {
            type: 'string',
            maxLength: 200,
            description: 'The deployed automation to run on this task',
          },
        },
      }),
      responses: {
        '200': jsonResponse('The start outcome', {
          type: 'object',
          required: ['started', 'executionId'],
          properties: {
            started: { type: 'boolean' },
            reason: {
              type: 'string',
              enum: ['already_running', 'not_started'],
              description: 'Present only when `started` is false',
            },
            executionId: {
              type: 'string',
              nullable: true,
              description:
                'The run to poll via GET /api/v1/runs/{runId} — the new ' +
                'run’s id, the in-flight one’s for `already_running`, null ' +
                'for `not_started`',
            },
          },
        }),
        '404': errorResponse('Task not found'),
        ...standardErrors,
      },
    },
  };

  // ── Automations ───────────────────────────────────────────────────────────

  paths['/api/v1/automations'] = {
    get: {
      tags: ['Automations'],
      summary: 'List automations',
      description:
        'Every automation of the organization, by name — a complete set, ' +
        'not paginated (an organization holds tens of automations, not ' +
        'thousands). `projectIds` is the binding set: empty means ' +
        'org-level.',
      operationId: 'listAutomations',
      security: sec,
      responses: {
        '200': jsonResponse(
          'The organization’s automations',
          listOf('automations', ref('AutomationSummary')),
        ),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/automations/{name}'] = {
    get: {
      tags: ['Automations'],
      summary: 'Get one automation version',
      operationId: 'getAutomation',
      security: sec,
      parameters: [
        automationNameParam,
        queryParam('version', 'A specific version (the latest when omitted)', {
          type: 'integer',
        }),
      ],
      responses: {
        '200': jsonResponse('The automation version', ref('Automation')),
        '404': errorResponse('Automation not found'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/automations/{name}/versions'] = {
    get: {
      tags: ['Automations'],
      summary: 'List an automation’s versions',
      description: 'The immutable version history, complete — not paginated.',
      operationId: 'listAutomationVersions',
      security: sec,
      parameters: [automationNameParam],
      responses: {
        '200': jsonResponse(
          'Immutable version history',
          listOf('versions', ref('AutomationVersion'), { name: str }),
        ),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/automations/{name}/runs'] = {
    get: {
      tags: ['Automations'],
      summary: 'List an automation’s runs',
      description:
        'The newest runs first — a bounded WINDOW (`limit` 1..200, default ' +
        '50), not a cursor walk; each row is the full run. To follow one ' +
        'run, poll `GET /api/v1/runs/{runId}`.',
      operationId: 'listAutomationRuns',
      security: sec,
      parameters: [
        automationNameParam,
        queryParam(
          'limit',
          'How many of the newest runs to answer, 1..200 (default 50)',
          { type: 'integer' },
        ),
      ],
      responses: {
        '200': jsonResponse('Newest runs first', listOf('runs', ref('Run'))),
        ...standardErrors,
      },
    },
    post: {
      tags: ['Automations'],
      summary: 'Start a run of the deployed version',
      description:
        'Answers 202 with the run’s identity rather than its result: a run ' +
        'is durable and may take minutes, so poll `GET /api/v1/runs/{runId}`. ' +
        'Starting a run needs no trigger — the API key is the entitlement. ' +
        '`mode` defaults to `live`, which requires the key holder to have ' +
        'the developer capability; a `mock` run needs only membership. ' +
        '`projectId` scopes the run to a project (required, and restricted ' +
        'to the bound set, when the automation is bound to several). ' +
        'Charged against the execute bucket (20/min) on top of the general ' +
        'one.',
      operationId: 'startAutomationRun',
      security: sec,
      parameters: [automationNameParam],
      requestBody: jsonBody(
        {
          type: 'object',
          properties: {
            input: { type: 'object', description: 'The run’s input value' },
            mode: { type: 'string', enum: ['live', 'mock'], default: 'live' },
            version: {
              type: 'integer',
              description:
                'Run a specific version (the deployed one when omitted)',
            },
            projectId: {
              type: 'string',
              description: 'The project the run operates in',
            },
          },
        },
        false,
      ),
      responses: {
        '202': jsonResponse('Run started', {
          type: 'object',
          required: ['runId', 'version', 'name', 'mode'],
          properties: {
            runId: { type: 'string' },
            version: { type: 'integer' },
            name: { type: 'string' },
            mode: { type: 'string', enum: ['live', 'mock'] },
          },
        }),
        '403': errorResponse('A live run needs the developer capability'),
        '409': errorResponse('The automation has no deployed version'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/automations/{name}/projects'] = {
    post: {
      tags: ['Automations'],
      summary: 'Bind the automation to a project',
      description:
        'Idempotently adds ONE project to the automation’s binding set — ' +
        'the machine door’s install step, so a worker that just created a ' +
        'client project can put the automation on it without a human. The ' +
        'binding SET is the scope: an automation with no bindings is ' +
        'org-level (every project sees it); one with bindings runs only in ' +
        'those projects. Requires the developer capability (the same gate ' +
        'as the session binding panel), and a key whose user belongs to ' +
        'several organizations must send `X-Organization-Slug`. The target ' +
        'project must be visible to the key’s minting user — an invisible ' +
        'or foreign project answers the same 404 as an absent one. Answers ' +
        '201 when the binding was added, 200 when it already existed. ' +
        'Unbinding stays a dashboard operation.',
      operationId: 'bindAutomationProject',
      security: sec,
      parameters: [automationNameParam, orgSlugHeaderParam],
      requestBody: jsonBody({
        type: 'object',
        required: ['projectId'],
        properties: {
          projectId: { type: 'string', description: 'The project to bind' },
        },
      }),
      responses: {
        '201': jsonResponse('Binding added', {
          type: 'object',
          required: ['name', 'added'],
          properties: {
            name: { type: 'string' },
            added: { type: 'boolean', enum: [true] },
          },
        }),
        '200': jsonResponse('Binding already existed', {
          type: 'object',
          required: ['name', 'added'],
          properties: {
            name: { type: 'string' },
            added: { type: 'boolean', enum: [false] },
          },
        }),
        '403': errorResponse('The key holder lacks the developer capability'),
        '404': errorResponse(
          'Automation or project not found (or not visible to the key)',
        ),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/automations/{name}/triggers'] = {
    get: {
      tags: ['Automations'],
      summary: 'Read the automation’s trigger',
      description:
        'The trigger binding — at most one per automation, answered as a ' +
        'list. Never the webhook secret: `hasToken` says one exists.',
      operationId: 'listAutomationTriggers',
      security: sec,
      parameters: [automationNameParam],
      responses: {
        '200': jsonResponse(
          'The trigger binding',
          listOf('triggers', ref('Trigger'), { name: str }),
        ),
        ...standardErrors,
      },
    },
    put: {
      tags: ['Automations'],
      summary: 'Bind what starts the automation',
      description:
        'Requires the developer capability. For a webhook trigger the ' +
        'plaintext token is returned ONCE in this response (and again only ' +
        'with `rotateToken: true`); the platform stores a hash.',
      operationId: 'setAutomationTrigger',
      security: sec,
      parameters: [automationNameParam],
      requestBody: jsonBody({
        type: 'object',
        required: ['kind'],
        properties: {
          kind: { type: 'string', enum: ['schedule', 'webhook', 'event'] },
          cron: {
            type: 'string',
            description: 'Schedule trigger: cron expression',
          },
          timezone: {
            type: 'string',
            description: 'Schedule trigger: IANA timezone',
          },
          event: {
            type: 'string',
            description: 'Event trigger: the platform event name',
          },
          enabled: { type: 'boolean', default: true },
          rotateToken: {
            type: 'boolean',
            description: 'Webhook trigger: mint (and return) a fresh token',
          },
        },
      }),
      responses: {
        '200': jsonResponse('Trigger bound', {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string' },
            token: {
              type: 'string',
              description: 'Webhook trigger only, shown once',
            },
          },
        }),
        '403': errorResponse('Needs the developer capability'),
        ...standardErrors,
      },
    },
    delete: {
      tags: ['Automations'],
      summary: 'Unbind the automation’s trigger',
      description:
        'Idempotent: answers 204 whether or not a trigger existed. Versions ' +
        'and run history stay. Requires the developer capability.',
      operationId: 'deleteAutomationTrigger',
      security: sec,
      parameters: [automationNameParam],
      responses: {
        '204': noContent('Unbound (or nothing was bound)'),
        '403': errorResponse('Needs the developer capability'),
        ...standardErrors,
      },
    },
  };

  // ── Runs ──────────────────────────────────────────────────────────────────

  paths['/api/v1/runs/{runId}'] = {
    get: {
      tags: ['Runs'],
      summary: 'Get one run in full',
      operationId: 'getRun',
      security: sec,
      parameters: [pathParam('runId', 'The run ID a start call returned')],
      responses: {
        '200': jsonResponse(
          'The run: status, output, trace, effects, checkpoints',
          ref('Run'),
        ),
        '404': errorResponse('Run not found'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/runs/{runId}/cancel'] = {
    post: {
      tags: ['Runs'],
      summary: 'Stop a run at its next node boundary',
      description:
        'Requires the developer capability. Work a node already performed ' +
        'is not undone.',
      operationId: 'cancelRun',
      security: sec,
      parameters: [pathParam('runId', 'The run ID')],
      responses: {
        '200': jsonResponse('Cancellation result', {
          type: 'object',
          required: ['cancelled'],
          properties: { cancelled: { type: 'boolean' } },
        }),
        '403': errorResponse('Needs the developer capability'),
        '404': errorResponse('Run not found'),
        ...standardErrors,
      },
    },
  };

  // ── Threads ───────────────────────────────────────────────────────────────

  paths['/api/v1/threads'] = {
    get: {
      tags: ['Threads'],
      summary: 'List the key holder’s threads',
      description: 'The key’s own active threads, newest activity first.',
      operationId: 'listThreads',
      security: sec,
      parameters: paginationParams(100, 25),
      responses: {
        '200': jsonResponse('Paginated threads', pageOf(ref('Thread'))),
        ...standardErrors,
      },
    },
    post: {
      tags: ['Threads'],
      summary: 'Create a thread',
      description:
        'A direct chat thread (never a sandbox thread — that needs a ' +
        'harness this surface cannot drive).',
      operationId: 'createThread',
      security: sec,
      requestBody: jsonBody(
        {
          type: 'object',
          properties: {
            title: { type: 'string' },
            agentSlug: { type: 'string' },
            projectId: { type: 'string' },
          },
        },
        false,
      ),
      responses: {
        '201': createdId('Created — the thread’s id'),
        '403': errorResponse('No access to the project'),
        '404': errorResponse('Project not found'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/threads/{id}'] = {
    get: {
      tags: ['Threads'],
      summary: 'Get a thread',
      operationId: 'getThread',
      security: sec,
      parameters: [pathParam('id', 'Thread ID')],
      responses: {
        '200': jsonResponse('The thread', ref('Thread')),
        '404': errorResponse('Thread not found'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/threads/{id}/messages'] = {
    get: {
      tags: ['Threads'],
      summary: 'List a thread’s messages',
      description:
        'The conversation in sequence order; `cursor` is the previous ' +
        'page’s `continueCursor` (the last message’s `sequence`).',
      operationId: 'listMessages',
      security: sec,
      parameters: [pathParam('id', 'Thread ID'), ...paginationParams(100, 25)],
      responses: {
        '200': jsonResponse('Paginated messages', pageOf(ref('Message'))),
        '404': errorResponse('Thread not found'),
        ...standardErrors,
      },
    },
    post: {
      tags: ['Threads'],
      summary: 'Send a message and start a turn',
      description:
        'Answers 202 immediately; the turn runs in the background. Poll ' +
        '`GET /api/v1/threads/{id}/generation` until `{"status": "idle"}`, ' +
        'then read the messages. A turn that fails before producing output ' +
        'surfaces as an assistant message carrying an error — never ' +
        'silently. Charged against the execute bucket (20/min) on top of ' +
        'the general one.',
      operationId: 'postMessage',
      security: sec,
      parameters: [pathParam('id', 'Thread ID')],
      requestBody: jsonBody({
        type: 'object',
        required: ['content', 'model'],
        properties: {
          content: { type: 'string' },
          model: {
            type: 'string',
            description: 'The model to answer with (never auto-selected)',
          },
          agentSlug: { type: 'string' },
          locale: { type: 'string' },
        },
      }),
      responses: {
        '202': jsonResponse('Turn accepted', {
          type: 'object',
          required: ['threadId', 'status', 'model', 'poll'],
          properties: {
            threadId: { type: 'string' },
            status: { type: 'string', enum: ['accepted'] },
            model: { type: 'string' },
            poll: { type: 'string', description: 'The generation poll URL' },
          },
        }),
        '404': errorResponse('Thread not found'),
        '409': errorResponse('Sandbox thread, or a turn is already running'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/threads/{id}/generation'] = {
    get: {
      tags: ['Threads'],
      summary: 'Poll the running turn',
      operationId: 'getGeneration',
      security: sec,
      parameters: [pathParam('id', 'Thread ID')],
      responses: {
        '200': jsonResponse(
          '`{"status": "idle"}` when no turn is running (read the messages); otherwise the live status',
          {
            type: 'object',
            required: ['status'],
            properties: {
              status: {
                type: 'string',
                enum: [
                  'idle',
                  'queued',
                  'streaming',
                  'waiting-approval',
                  'waiting-input',
                ],
              },
              waitingOn: { type: 'string' },
              messageId: { type: 'string' },
            },
          },
        ),
        '404': errorResponse('Thread not found'),
        ...standardErrors,
      },
    },
  };

  // ── Agents ────────────────────────────────────────────────────────────────

  paths['/api/v1/agents'] = {
    get: {
      tags: ['Agents'],
      summary: 'List agents',
      description:
        'The agents the key holder can see — a complete set, not ' +
        'paginated. `failures` names agent files that could not be read.',
      operationId: 'listAgents',
      security: sec,
      responses: {
        '200': jsonResponse(
          'The organization’s agents',
          listOf('agents', ref('AgentSummary'), {
            failures: { type: 'array', items: obj },
          }),
        ),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/agents/{slug}'] = {
    get: {
      tags: ['Agents'],
      summary: 'Get agent',
      operationId: 'getAgent',
      security: sec,
      parameters: [pathParam('slug', 'The agent slug')],
      responses: {
        '200': jsonResponse('The agent', {
          type: 'object',
          required: ['agent'],
          properties: { agent: ref('Agent') },
        }),
        '404': errorResponse('No such agent'),
        ...standardErrors,
      },
    },
    put: {
      tags: ['Agents'],
      summary: 'Create or replace agent',
      operationId: 'saveAgent',
      security: sec,
      parameters: [pathParam('slug', 'The agent slug')],
      requestBody: jsonBody({
        type: 'object',
        required: ['displayName'],
        properties: {
          displayName: str,
          description: str,
          instructions: str,
          visibility: { type: 'string', enum: ['private', 'org'] },
        },
      }),
      responses: {
        '200': jsonResponse('The saved agent', {
          type: 'object',
          required: ['agent'],
          properties: { agent: ref('Agent') },
        }),
        '403': errorResponse('Not editable with this key'),
        ...standardErrors,
      },
    },
    delete: {
      tags: ['Agents'],
      summary: 'Delete agent',
      description:
        'Answers whether anything was deleted rather than a 404 — deleting ' +
        'an absent agent is a `deleted: false`.',
      operationId: 'deleteAgent',
      security: sec,
      parameters: [pathParam('slug', 'The agent slug')],
      responses: {
        '200': jsonResponse('Deletion result', {
          type: 'object',
          required: ['deleted'],
          properties: { deleted: bool },
        }),
        '403': errorResponse('Not deletable with this key'),
        ...standardErrors,
      },
    },
  };

  // ── Skills ────────────────────────────────────────────────────────────────

  paths['/api/v1/skills'] = {
    get: {
      tags: ['Skills'],
      summary: 'List skills',
      description:
        'The skills the key holder can see (their own, their teams’, the ' +
        'organization’s) — a complete set, not paginated. `failures` names ' +
        'skill bundles that could not be read.',
      operationId: 'listSkills',
      security: sec,
      responses: {
        '200': jsonResponse(
          'The organization’s skills',
          listOf('skills', ref('SkillSummary'), {
            failures: { type: 'array', items: obj },
          }),
        ),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/skills/{slug}'] = {
    get: {
      tags: ['Skills'],
      summary: 'Get skill',
      operationId: 'getSkill',
      security: sec,
      parameters: [pathParam('slug', 'The skill slug')],
      responses: {
        '200': jsonResponse('The skill', ref('Skill')),
        '404': errorResponse('No such skill'),
        ...standardErrors,
      },
    },
    put: {
      tags: ['Skills'],
      summary: 'Create or replace skill',
      operationId: 'saveSkill',
      security: sec,
      parameters: [pathParam('slug', 'The skill slug')],
      requestBody: jsonBody({
        type: 'object',
        required: ['description', 'body'],
        properties: {
          description: { type: 'string', maxLength: 1024 },
          body: { type: 'string', maxLength: 1_000_000 },
          visibility: { type: 'string', enum: ['private', 'team', 'org'] },
          teams: { type: 'array', items: str, maxItems: 32 },
          icon: str,
          labels: { type: 'array', items: str, maxItems: 50 },
        },
      }),
      responses: {
        '200': jsonResponse('The saved skill', ref('Skill')),
        '403': errorResponse('Not editable with this key'),
        '422': errorResponse('The skill body is malformed'),
        ...standardErrors,
      },
    },
    delete: {
      tags: ['Skills'],
      summary: 'Delete skill',
      operationId: 'deleteSkill',
      security: sec,
      parameters: [pathParam('slug', 'The skill slug')],
      responses: {
        '204': noContent('Deleted'),
        '403': errorResponse('Not deletable with this key'),
        '404': errorResponse('No such skill'),
        ...standardErrors,
      },
    },
  };

  // ── Knowledge ─────────────────────────────────────────────────────────────

  paths['/api/v1/knowledge-entries'] = {
    get: {
      tags: ['Knowledge'],
      summary: 'List knowledge entries',
      description:
        'Newest first; `cursor` is the previous page’s `continueCursor`.',
      operationId: 'listKnowledgeEntries',
      security: sec,
      parameters: [
        ...paginationParams(100, 25),
        queryParam('status', '`active` (default) or `superseded`'),
      ],
      responses: {
        '200': jsonResponse('Paginated entries', pageOf(ref('KnowledgeEntry'))),
        ...standardErrors,
      },
    },
    post: {
      tags: ['Knowledge'],
      summary: 'Create a knowledge entry',
      description:
        'Charged against the per-organization `knowledge:mutate` budget ' +
        'the in-app editor shares.',
      operationId: 'createKnowledgeEntry',
      security: sec,
      requestBody: jsonBody({
        type: 'object',
        required: ['topic', 'content'],
        properties: {
          topic: { type: 'string', maxLength: 200 },
          content: { type: 'string', maxLength: 100_000 },
        },
      }),
      responses: {
        '201': createdId('Created — the entry’s id'),
        '409': errorResponse('An active entry with this topic exists'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/knowledge-entries/{id}'] = {
    get: {
      tags: ['Knowledge'],
      summary: 'Get a knowledge entry',
      operationId: 'getKnowledgeEntry',
      security: sec,
      parameters: [pathParam('id', 'Entry ID')],
      responses: {
        '200': jsonResponse('The entry', ref('KnowledgeEntry')),
        '404': errorResponse('Entry not found'),
        ...standardErrors,
      },
    },
    patch: {
      tags: ['Knowledge'],
      summary: 'Supersede a knowledge entry',
      description:
        'Entries are immutable: an update writes a NEW row and answers its ' +
        'id; the old row becomes `superseded`. Both `topic` and `content` ' +
        'are required.',
      operationId: 'updateKnowledgeEntry',
      security: sec,
      parameters: [pathParam('id', 'Entry ID')],
      requestBody: jsonBody({
        type: 'object',
        required: ['topic', 'content'],
        properties: {
          topic: { type: 'string', maxLength: 200 },
          content: { type: 'string', maxLength: 100_000 },
        },
      }),
      responses: {
        '200': jsonResponse('The NEW row', {
          type: 'object',
          required: ['id'],
          properties: { id: { type: 'string' } },
        }),
        '404': errorResponse('Entry not found'),
        '409': errorResponse('Entry is not active'),
        ...standardErrors,
      },
    },
    delete: {
      tags: ['Knowledge'],
      summary: 'Delete a knowledge entry',
      operationId: 'deleteKnowledgeEntry',
      security: sec,
      parameters: [pathParam('id', 'Entry ID')],
      responses: {
        '204': noContent('Deleted'),
        '404': errorResponse('Entry not found'),
        ...standardErrors,
      },
    },
  };

  paths['/api/v1/knowledge/search'] = {
    post: {
      tags: ['Knowledge'],
      summary: 'Semantic search over the organization’s knowledge',
      description:
        'A POST because it carries a body, not because it writes. ' +
        'Deliberately ORG-WIDE: the key speaks for the organization, not ' +
        'one member’s visibility.',
      operationId: 'searchKnowledge',
      security: sec,
      requestBody: jsonBody({
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', maxLength: 2000 },
          corpus: { type: 'string', enum: ['documents', 'web', 'all'] },
          limit: { type: 'integer', minimum: 1, maximum: 50 },
          minSimilarity: { type: 'number', minimum: 0, maximum: 1 },
        },
      }),
      responses: {
        '200': jsonResponse('Hits and diagnostics', {
          type: 'object',
          required: ['hits'],
          properties: {
            hits: { type: 'array', items: obj },
            diagnostics: obj,
          },
          additionalProperties: true,
        }),
        '409': errorResponse('No embedding model is configured'),
        ...standardErrors,
      },
    },
  };

  // ── MCP ───────────────────────────────────────────────────────────────────

  paths['/api/v1/mcp'] = {
    post: {
      tags: ['MCP'],
      summary: 'The platform MCP endpoint',
      description:
        'JSON-RPC over HTTP (MCP protocol 2025-03-26; JSON responses only, ' +
        'no SSE; one message per request). Authenticate with the same ' +
        'Bearer org API key as the REST API. Call `tools/list` for the tool ' +
        'inventory — automation authoring, run and trigger management, and ' +
        'the organization’s capability surface — and the `get_docs` tool for ' +
        'the in-band authoring reference. GET answers 405. See the MCP ' +
        'endpoint page in the developer docs for the full tour.',
      operationId: 'mcp',
      security: sec,
      requestBody: jsonBody({
        type: 'object',
        description: 'A single JSON-RPC 2.0 message',
      }),
      responses: {
        '200': jsonResponse('The JSON-RPC response'),
        ...standardErrors,
      },
    },
  };

  // ── Inbound automation webhook ────────────────────────────────────────────

  paths['/api/automations/webhook/{token}'] = {
    post: {
      tags: ['Automations'],
      summary: 'Fire a webhook trigger',
      description:
        'The URL token IS the credential (minted by `PUT /api/v1/automations/' +
        '{name}/triggers`, shown once, stored hashed). The request body ' +
        '(≤256 KB) becomes the run’s input.',
      operationId: 'fireAutomationWebhook',
      security: [],
      parameters: [pathParam('token', 'The webhook token')],
      requestBody: jsonBody({ type: 'object' }, false),
      responses: {
        '202': jsonResponse('Run started', {
          type: 'object',
          required: ['runId'],
          properties: { runId: { type: 'string' } },
        }),
        '404': errorResponse('Unknown or disabled token'),
        '409': errorResponse('The automation has no deployed version'),
        '413': errorResponse('Body exceeds 256 KB'),
      },
    },
  };

  return {
    openapi: '3.0.3',
    info: {
      title: 'Tale Platform API',
      version: '1.2.0',
      description: `
REST access to a Tale deployment: knowledge resources, automations and their
runs, chat threads, agents, and skills — plus an MCP endpoint exposing the
same platform to MCP clients.

## Authentication

Every request carries an organization API key (create one in
Settings → API):

\`\`\`
Authorization: Bearer tale_...
\`\`\`

## Errors

Non-2xx responses carry a flat envelope: \`{"error": "<message>"}\` (domain
refusals add a stable \`code\`).

## Pagination

The keyset-paginated lists — contacts, products, documents, knowledge
entries, threads, messages, websites — take \`cursor\` + \`limit\` and answer
\`{page, isDone, continueCursor}\`; pass \`continueCursor\` back as \`cursor\`
until \`isDone\`. Lists that answer a named array (\`{automations}\`,
\`{runs}\`, \`{agents}\`, \`{skills}\`, \`{folders}\`, \`{comments}\`) are complete
sets or bounded windows, not cursor walks; project files answer
\`{files, cursor?}\`.

## Rate limits

Budgets are keyed on the key holder — the user the key acts as — never on a
network address: reads and CRUD share one bucket (120/min, burst 200);
starting an automation run, sending a chat message and starting a task
workflow share a tighter one (20/min, burst 40); the project upload flow has
its own (240/min, burst 300). A key that fails to authenticate is throttled
per source IP instead (20/min, burst 40), so strangers never draw from a key
holder's budget. A 429 carries \`Retry-After\` in whole seconds.

## Quick start

\`\`\`bash
# 1. What automations does the org have?
curl -H "Authorization: Bearer tale_..." \\
  https://your-instance.com/api/v1/automations

# 2. Start a run of the deployed version
curl -X POST -H "Authorization: Bearer tale_..." \\
  -H "Content-Type: application/json" -d '{"input": {}}' \\
  https://your-instance.com/api/v1/automations/billing__dunning/runs

# 3. Poll it
curl -H "Authorization: Bearer tale_..." \\
  https://your-instance.com/api/v1/runs/<runId>
\`\`\`
`.trim(),
    },
    servers: [{ url: '', description: 'Same origin' }],
    security: sec,
    tags: [
      { name: 'Documents', description: 'Documents in the knowledge base.' },
      { name: 'Websites', description: 'Crawled website sources.' },
      { name: 'Products', description: 'Product catalog entries.' },
      { name: 'Contacts', description: 'Contact records.' },
      {
        name: 'Projects',
        description:
          'Projects, their folders, and their files — the machine door for ' +
          'external systems that mirror client work into the platform. ' +
          'Multi-org keys must send X-Organization-Slug on every call.',
      },
      {
        name: 'Tasks',
        description:
          'Tasks on the project boards — the machine door for external ' +
          'workers that materialize items as tasks, start their workflows, ' +
          'and report back. Multi-org keys must send X-Organization-Slug ' +
          'on every call.',
      },
      {
        name: 'Automations',
        description: 'Versioned automations, their runs and triggers.',
      },
      { name: 'Runs', description: 'Durable automation runs.' },
      { name: 'Threads', description: 'Chat threads of the key holder.' },
      { name: 'Agents', description: 'The organization’s agents.' },
      { name: 'Skills', description: 'The organization’s skills.' },
      {
        name: 'Knowledge',
        description: 'Knowledge entries and semantic search.',
      },
      {
        name: 'MCP',
        description: 'The platform MCP endpoint (JSON-RPC over HTTP).',
      },
    ],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'An organization API key. Create one in Settings → API.',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: { type: 'string', description: 'What went wrong' },
            code: {
              type: 'string',
              description: 'A stable refusal code, when the domain has one',
            },
          },
        },

        // ── Documents ──
        Document: {
          type: 'object',
          required: ['id', 'title', 'createdBy', 'createdAt', 'updatedAt'],
          properties: {
            id: str,
            title: str,
            content: nullable({
              ...str,
              description:
                'Inline text; null for blob-backed documents and in listings',
            }),
            fileId: nullable({ ...str, description: 'The blob reference' }),
            mimeType: nullable(str),
            extension: nullable(str),
            sourceProvider: nullable(str),
            teamId: nullable(str),
            folderId: nullable(str),
            metadata: nullable(obj),
            createdBy: str,
            createdAt: { ...num, description: 'Epoch ms' },
            updatedAt: { ...num, description: 'Epoch ms' },
          },
        },
        DocumentInput: {
          type: 'object',
          required: ['title'],
          properties: {
            title: { type: 'string', maxLength: 512 },
            content: { type: 'string', maxLength: 5_000_000 },
            fileId: { type: 'string', maxLength: 2048 },
            mimeType: { type: 'string', maxLength: 255 },
            extension: { type: 'string', maxLength: 32 },
            sourceProvider: { type: 'string', maxLength: 64 },
            metadata: obj,
            teamId: { type: 'string', maxLength: 128 },
            folderId: { type: 'string', maxLength: 64 },
          },
        },
        DocumentPatch: {
          type: 'object',
          description: 'Every field optional; null clears it',
          properties: {
            title: { type: 'string', maxLength: 512 },
            content: nullable({ type: 'string', maxLength: 5_000_000 }),
            metadata: nullable(obj),
            mimeType: nullable({ type: 'string', maxLength: 255 }),
            extension: nullable({ type: 'string', maxLength: 32 }),
            sourceProvider: nullable({ type: 'string', maxLength: 64 }),
            teamId: nullable({ type: 'string', maxLength: 128 }),
            folderId: nullable({ type: 'string', maxLength: 64 }),
          },
        },

        // ── Websites ──
        Website: {
          type: 'object',
          required: [
            'id',
            'organizationId',
            'domain',
            'scanInterval',
            'createdAt',
            'updatedAt',
          ],
          properties: {
            id: str,
            organizationId: str,
            domain: str,
            kind: nullable({ type: 'string', enum: ['site', 'list'] }),
            title: nullable(str),
            description: nullable(str),
            scanInterval: str,
            lastScannedAt: nullable({ ...num, description: 'Epoch ms' }),
            status: nullable(str),
            pageCount: nullable(int),
            crawledPageCount: nullable(int),
            metadata: nullable(obj),
            createdAt: { ...num, description: 'Epoch ms' },
            updatedAt: { ...num, description: 'Epoch ms' },
          },
        },
        WebsiteInput: {
          type: 'object',
          required: ['domain', 'scanInterval'],
          properties: {
            domain: { ...str, description: 'A hostname or URL' },
            title: str,
            description: str,
            scanInterval: str,
            urls: {
              type: 'array',
              items: str,
              description:
                'Registers a curated URL list on the domain instead of a ' +
                'whole-site crawl. Every entry must be an http(s) URL on the ' +
                'domain or its www/apex sibling; re-posting merges new URLs ' +
                'into the existing list.',
            },
          },
        },
        WebsitePatch: {
          type: 'object',
          properties: {
            domain: str,
            title: str,
            description: str,
            scanInterval: str,
          },
        },
        WebsitePageList: {
          type: 'object',
          required: ['pages', 'total', 'offset', 'hasMore'],
          properties: {
            pages: { type: 'array', items: obj },
            total: int,
            offset: int,
            hasMore: bool,
          },
        },
        WebsiteSearchResults: {
          type: 'object',
          required: ['results', 'total'],
          properties: {
            results: { type: 'array', items: obj },
            total: int,
          },
        },

        // ── Products ──
        Product: {
          type: 'object',
          required: [
            'id',
            'organizationId',
            'name',
            'tags',
            'createdAt',
            'updatedAt',
          ],
          properties: {
            id: str,
            organizationId: str,
            name: str,
            description: nullable(str),
            imageUrl: nullable(str),
            stock: nullable(num),
            price: nullable(num),
            currency: nullable(str),
            category: nullable(str),
            tags: strArray,
            status: nullable(str),
            translations: nullable({ type: 'array', items: obj }),
            externalId: nullable(str),
            metadata: nullable(obj),
            createdAt: { ...num, description: 'Epoch ms' },
            updatedAt: { ...num, description: 'Epoch ms' },
          },
        },
        ProductInput: {
          type: 'object',
          description:
            '`name` is required on create; every field is optional on update',
          properties: {
            name: str,
            description: str,
            imageUrl: str,
            stock: num,
            price: num,
            currency: str,
            category: str,
            tags: strArray,
            status: str,
            externalId: str,
            metadata: obj,
          },
        },

        // ── Contacts ──
        Contact: {
          type: 'object',
          required: [
            'id',
            'organizationId',
            'source',
            'tags',
            'createdAt',
            'updatedAt',
          ],
          properties: {
            id: str,
            organizationId: str,
            name: nullable(str),
            email: nullable(str),
            phone: nullable(str),
            externalId: nullable(str),
            source: str,
            locale: nullable(str),
            address: nullable(obj),
            tags: strArray,
            metadata: nullable(obj),
            notes: nullable(str),
            lifecycleStatus: nullable(str),
            createdAt: { ...num, description: 'Epoch ms' },
            updatedAt: { ...num, description: 'Epoch ms' },
          },
        },
        ContactInput: {
          type: 'object',
          properties: {
            name: str,
            email: str,
            phone: str,
            source: { ...str, description: 'Defaults to `api_import`' },
            locale: str,
            address: obj,
            externalId: {
              oneOf: [{ type: 'string' }, { type: 'number' }],
              description: 'Stored as a string',
            },
            tags: strArray,
            metadata: obj,
            notes: str,
          },
        },
        BulkCreateResult: {
          type: 'object',
          required: ['success', 'failed', 'errors'],
          properties: {
            success: int,
            failed: int,
            errors: {
              type: 'array',
              items: {
                type: 'object',
                required: ['index', 'error', 'errorCode', 'contact'],
                properties: {
                  index: int,
                  error: str,
                  errorCode: str,
                  contact: ref('ContactInput'),
                },
              },
            },
          },
        },

        // ── Projects ──
        Project: {
          type: 'object',
          required: ['id', 'name'],
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            key: {
              type: 'string',
              description: 'Immutable task-identifier prefix',
            },
            description: { type: 'string' },
            externalItemId: {
              type: 'string',
              description: 'Caller-owned external key, unique per organization',
            },
            archivedAt: {
              type: 'number',
              description:
                'Present (epoch ms) when the project is archived — the ' +
                'archived marker for lookups',
            },
          },
        },
        ProjectFolder: {
          type: 'object',
          required: ['id', 'name'],
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
          },
        },
        ProjectFolderResult: {
          type: 'object',
          required: ['folder', 'created'],
          properties: {
            folder: { $ref: '#/components/schemas/ProjectFolder' },
            created: {
              type: 'boolean',
              description:
                'false when an exact-name sibling already existed (200)',
            },
          },
        },
        ProjectUploadHandoff: {
          type: 'object',
          required: ['uploadId', 'url', 'method', 'expiresAt'],
          properties: {
            uploadId: {
              type: 'string',
              description: 'Single-use intent to present at the bind step',
            },
            url: { type: 'string', description: 'Where to send the bytes' },
            method: { type: 'string', enum: ['POST', 'PUT'] },
            s3Ref: {
              type: 'string',
              description:
                'PUT lane only: the blob reference to bind as `fileId`',
            },
            expiresAt: {
              type: 'number',
              description: 'Epoch ms; the intent dies of old age after this',
            },
          },
        },
        ProjectFile: {
          type: 'object',
          required: ['id', 'createdAt'],
          properties: {
            id: { type: 'string' },
            fileName: nullable(str),
            folderId: nullable(str),
            mimeType: nullable(str),
            createdAt: { type: 'number' },
          },
        },

        // ── Tasks ──
        Task: {
          type: 'object',
          required: [
            'id',
            'title',
            'status',
            'projectId',
            'labels',
            'createdAt',
            'updatedAt',
          ],
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            status: {
              type: 'string',
              enum: [
                'backlog',
                'todo',
                'in_progress',
                'in_review',
                'done',
                'cancelled',
              ],
            },
            projectId: { type: 'string' },
            externalSystem: { type: 'string' },
            externalId: {
              type: 'string',
              description: 'The caller-owned natural key, verbatim',
            },
            externalUrl: { type: 'string' },
            description: { type: 'string' },
            labels: {
              type: 'array',
              items: { type: 'string' },
              description: 'Resolved label names',
            },
            createdAt: { type: 'number' },
            updatedAt: { type: 'number' },
          },
        },
        TaskUpsertResult: {
          type: 'object',
          required: ['task'],
          properties: {
            task: {
              type: 'object',
              required: ['id', 'created'],
              properties: {
                id: { type: 'string' },
                created: {
                  type: 'boolean',
                  description: 'false on an idempotent re-pick (200)',
                },
              },
            },
            executionId: {
              type: 'string',
              nullable: true,
              description:
                'Present (as null) only when a workflow start was SCHEDULED ' +
                'for a newly created task — no run identity exists yet',
            },
          },
        },

        // ── Automations ──
        AutomationSummary: {
          type: 'object',
          required: ['name', 'latestVersion', 'deployedVersion', 'projectIds'],
          properties: {
            name: { type: 'string', description: 'The real `/`-slug' },
            latestVersion: int,
            deployedVersion: nullable({
              ...int,
              description: 'null while nothing is deployed',
            }),
            presentation: {
              description: 'The newest version’s display block, if authored',
            },
            projectIds: {
              ...strArray,
              description: 'The binding set; empty means org-level',
            },
          },
        },
        Automation: {
          type: 'object',
          required: ['name', 'version', 'document', 'createdBy', 'createdAt'],
          properties: {
            name: { type: 'string' },
            version: { type: 'integer' },
            document: {
              type: 'object',
              description:
                'The authored content (nodes and acceptance tests). The MCP ' +
                '`get_docs` tool is the grammar reference.',
            },
            message: { type: 'string' },
            testsPassed: { type: 'boolean' },
            deployedVersion: { type: 'integer' },
            createdBy: { type: 'string' },
            createdAt: { type: 'number' },
          },
        },
        AutomationVersion: {
          type: 'object',
          required: ['version', 'createdBy', 'createdAt'],
          properties: {
            version: int,
            message: nullable(str),
            testsPassed: nullable(bool),
            createdBy: str,
            createdAt: { ...num, description: 'Epoch ms' },
          },
        },
        Trigger: {
          type: 'object',
          required: ['name', 'kind', 'hasToken', 'enabled'],
          properties: {
            name: str,
            kind: { type: 'string', enum: ['schedule', 'webhook', 'event'] },
            cron: nullable(str),
            timezone: nullable(str),
            event: nullable(str),
            hasToken: {
              ...bool,
              description: 'A webhook secret exists (never returned here)',
            },
            enabled: bool,
            lastFiredAt: nullable({ ...num, description: 'Epoch ms' }),
          },
        },
        Run: {
          type: 'object',
          description:
            'A run in full — the same row in the runs listing and the single ' +
            'read: identity, status, input, output, trace, effects, and ' +
            'per-node checkpoints.',
          required: [
            'id',
            'organizationId',
            'name',
            'version',
            'status',
            'mode',
            'startedBy',
            'startedAt',
          ],
          properties: {
            id: { ...str, description: 'The run id (`runId` at start)' },
            organizationId: str,
            name: str,
            version: int,
            projectId: nullable(str),
            status: {
              type: 'string',
              enum: [
                'queued',
                'running',
                'waiting',
                'success',
                'failed',
                'cancelled',
              ],
            },
            mode: { type: 'string', enum: ['mock', 'live'] },
            startedBy: {
              ...str,
              description: '`api-key:<userId>` for runs started here',
            },
            input: {},
            output: {},
            checkpoints: {},
            trace: {},
            effects: {},
            detail: nullable(str),
            claimEpoch: int,
            chainSeq: int,
            startedAt: { ...num, description: 'Epoch ms' },
            finishedAt: nullable({ ...num, description: 'Epoch ms' }),
          },
        },

        // ── Threads ──
        Thread: {
          type: 'object',
          required: [
            'id',
            'kind',
            'archived',
            'createdAt',
            'updatedAt',
            'generating',
          ],
          properties: {
            id: str,
            title: str,
            kind: str,
            agentSlug: str,
            harness: str,
            projectId: str,
            archived: bool,
            isShared: bool,
            generating: bool,
            createdAt: { ...num, description: 'Epoch ms' },
            updatedAt: { ...num, description: 'Epoch ms' },
          },
        },
        Message: {
          type: 'object',
          required: ['id', 'role', 'parts', 'sequence', 'createdAt'],
          properties: {
            id: str,
            role: str,
            parts: {
              type: 'array',
              items: obj,
              description: 'The message parts (text, tool calls, files)',
            },
            sequence: { ...int, description: 'The paging key' },
            model: str,
            providerSlug: str,
            blockedReason: str,
            error: str,
            createdAt: { ...num, description: 'Epoch ms' },
          },
        },

        // ── Agents & skills ──
        AgentSummary: {
          type: 'object',
          required: ['slug', 'displayName', 'visibility'],
          properties: {
            slug: str,
            displayName: str,
            description: str,
            visibility: { type: 'string', enum: ['private', 'org'] },
            owner: str,
            icon: str,
            labels: strArray,
          },
          additionalProperties: true,
        },
        Agent: {
          type: 'object',
          description: 'The agent file as authored, plus its resolved summary',
          required: ['slug', 'displayName'],
          properties: {
            slug: str,
            displayName: str,
            description: str,
            instructions: str,
            visibility: { type: 'string', enum: ['private', 'org'] },
          },
          additionalProperties: true,
        },
        SkillSummary: {
          type: 'object',
          required: ['slug', 'description', 'visibility'],
          properties: {
            slug: str,
            description: str,
            visibility: { type: 'string', enum: ['private', 'team', 'org'] },
            teams: strArray,
            owner: str,
          },
          additionalProperties: true,
        },
        Skill: {
          type: 'object',
          description: 'The skill bundle: its summary fields plus the body',
          required: ['slug', 'description'],
          properties: {
            slug: str,
            description: str,
            body: str,
            visibility: { type: 'string', enum: ['private', 'team', 'org'] },
            teams: strArray,
          },
          additionalProperties: true,
        },

        // ── Knowledge ──
        KnowledgeEntry: {
          type: 'object',
          required: [
            'id',
            'topic',
            'content',
            'status',
            'source',
            'createdBy',
            'createdAt',
          ],
          properties: {
            id: str,
            topic: str,
            content: str,
            status: { type: 'string', enum: ['active', 'superseded'] },
            source: str,
            documentId: str,
            supersededBy: {
              ...str,
              description: 'The row that replaced this one',
            },
            createdBy: str,
            createdAt: { ...num, description: 'Epoch ms' },
          },
        },
      },
    },
  };
}
