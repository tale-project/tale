/**
 * Compact Workflow Syntax Reference
 * This is a minified version for AI system prompts.
 * For detailed examples, use workflow_examples tool with get_syntax_reference operation.
 */

export const WORKFLOW_SYNTAX_COMPACT = `
## Workflow Structure
\`\`\`
{ workflowConfig: { name, description?, version?, workflowType: 'predefined', config?: { timeout?, retryPolicy?: { maxRetries, backoffMs }, variables?, secrets? } }, stepsConfig: [{ stepSlug, name, stepType, config, nextSteps, order? }] }
\`\`\`

## Hello World Example
\`\`\`
{
  workflowConfig: { name: 'Hello World', description: 'Simple greeting workflow' },
  stepsConfig: [
    { stepSlug: 'start', name: 'Start', stepType: 'start', config: {}, nextSteps: { success: 'greet' } },
    { stepSlug: 'greet', name: 'Greet', stepType: 'llm', config: { name: 'Greeter', systemPrompt: 'Say hello to the world in a friendly way.' }, nextSteps: { success: 'result' } },
    { stepSlug: 'result', name: 'Result', stepType: 'output', config: { outputMapping: { greeting: '{{steps.greet.output}}' } }, nextSteps: {} }
  ]
}
\`\`\`

## Step Types

### start (stepType: 'start')
Config: { inputSchema?: { properties: { [name]: { type, description? } }, required?: string[] } }
NextSteps: { success: 'next_step' }
Note: Trigger sources (schedules, webhooks, events) are configured separately, not in step config.

### llm (stepType: 'llm')
Config: { name (REQUIRED), systemPrompt (REQUIRED), userPrompt?, tools?: string[], outputFormat?: 'text'|'json', outputSchema?: JsonSchemaDefinition, contextVariables? }
- outputSchema: When outputFormat is 'json', provides structured output validation using JSON Schema format
- Schema format: { type: 'object', properties: { fieldName: { type: 'string'|'number'|'boolean'|'array'|'object', description?, items?, properties?, required?, enum? } }, required?: string[] }
- When outputSchema is provided, the LLM output is validated against the schema at runtime
NextSteps: { success: 'next_step', error?: 'error_handler' }

### condition (stepType: 'condition')
Config: { expression (JEXL), description?, variables? }
NextSteps: { true: 'if_true_step', false: 'if_false_step' }

### action (stepType: 'action')
Config: { type (action type), parameters, retryPolicy? }
NextSteps: { success: 'next_step', error?: 'error_handler' }

### loop (stepType: 'loop')
Config: { items, itemVariable?: 'item', indexVariable?: 'index', maxIterations?: 1000, continueOnError? }
NextSteps: { loop: 'loop_body_step', done: 'after_loop_step', error?: 'error_handler' }
Note: 'loop' port goes to the step executed for each item; 'done' port goes to the step after loop completes

### output (stepType: 'output')
Config: { outputMapping?: Record<string, string> }
NextSteps: { success: 'next_step' }
Note: Maps workflow variables to final output. Values support {{variable}} template syntax. Result stored in __workflowOutput.

## Action Types & Output Structures
All actions return unified structure: \`{ data: T | T[] | null, isDone?: boolean, continueCursor?: string | null }\`
Exception: set_variables returns \`{ variables: {...} }\`
(Params: required params listed first, optional params end with ?)

### workflow_processing_records
Ops: find_unprocessed, record_processed
Params (find_unprocessed): tableName (required), backoffHours (required), filterExpression? (JEXL expression for filtering, e.g., 'status == "open"')
Params (record_processed): tableName (required), recordId (required), recordCreationTime (required), metadata?
Note: organizationId and rootWfDefinitionId are auto-read from workflow context
Output (find_*): \`{ data: {...document} | null }\` - returns single document or null
Output (record_processed): \`{ data: {...processingRecord} | null }\` - returns full processing record entity
- Condition example: \`steps.find_step.output.data != null\`
- Access fields: \`{{steps.find_step.output.data._id}}\`, \`{{steps.find_step.output.data._creationTime}}\`

### customer
Ops: create, query, filter, update
Params (create): name?, email?, status? ('active'|'churned'|'potential'), source?, locale?, externalId?, metadata?
Params (query): status?, source?, externalId?, paginationOpts (required: {numItems, cursor})
Params (filter): expression (required - JEXL expression)
Params (update): customerId (required), updates (required)
Output (query): \`{ data: [...customers], isDone: boolean, continueCursor: string | null }\`
Output (filter): \`{ data: [...customers] }\`
Output (create): \`{ data: {...customer} }\` - returns full created customer entity
Output (update): \`{ data: {...customer} }\` - returns full updated customer entity

### product
Ops: create, get_by_id, query, filter, update, hydrate_fields
Params (create): name (required), description?, imageUrl?, stock?, price?, currency?, category?, tags?, status?, externalId?, metadata?
Params (get_by_id): productId (required)
Params (query): status?, category?, externalId?, paginationOpts (required)
Params (filter): expression (required - JEXL expression)
Params (update): productId (required), updates (required)
Params (hydrate_fields): items (array), idField? (default: 'product_id'), mappings? (Record<targetKey, sourceKey>), preserveExisting? (default: true)
Output (get_by_id): \`{ data: {...product} | null }\`
Output (query): \`{ data: [...products], isDone: boolean, continueCursor: string | null }\`
Output (filter): \`{ data: [...products] }\`
Output (create): \`{ data: {...product} }\` - returns full created product entity
Output (update): \`{ data: {...product} }\` - returns full updated product entity
Output (hydrate_fields): \`{ data: [...hydratedItems] }\` - items with fields mapped from product DB

### conversation
Ops: create, query_messages, query_latest_message_by_delivery_state, update, create_from_email, create_from_sent_email
Params (create): customerId?, subject?, status? ('open'|'closed'|'archived'|'spam'), priority?, type?, channel?, direction? ('inbound'|'outbound'), metadata?
Params (query_messages): conversationId?, channel?, direction?, paginationOpts (required)
Params (query_latest_message_by_delivery_state): channel (required), direction (required), deliveryState (required: 'queued'|'sent'|'delivered'|'failed')
Params (update): conversationId (required), updates (required)
Params (create_from_email): emails (required), status?, priority?, type?
Params (create_from_sent_email): emails (required), status?, priority?, accountEmail?, type?
Output (query_messages): \`{ page: [...messages], isDone: boolean, continueCursor: string | null }\`
Output (create/update): \`{ data: {...conversation} }\` - returns full conversation entity

### document
Ops: update, retrieve, generate_docx
Params (update): documentId (required), title?, content?, metadata?, mimeType?, extension?, sourceProvider?
Params (retrieve): fileId (required - file storage ID), chunkStart? (number), chunkEnd? (number), returnChunks? (boolean)
Params (generate_docx): fileName (required), sourceType (required: 'markdown'|'html'), content (required)
Output (update): \`{ data: {...document} }\` - returns full document entity
Output (retrieve): \`{ data: { content, chunks?, ... } }\` - returns document content from RAG
Output (generate_docx): \`{ data: { fileStorageId, downloadUrl, fileName } }\`

### integration
Params: name (required - e.g., 'shopify', 'circuly'), operation (required), params?
Output: \`{ data: { name, operation, result, duration, version } }\`
- Access result: \`{{steps.integration_step.output.data.result}}\`

### set_variables
Params: variables (required - array of { name, value, secure? })
Output: \`{ variables: {...processedVariables} }\` - NOT wrapped in data
- Secure variables are stored in secrets namespace with JWE encryption
- Later variables can reference earlier ones in the same step

### rag
Ops: upload_document, delete_document, search
Params (upload_document): fileId (required - file storage ID), fileName? (optional), contentType? (optional), sync? (optional boolean)
Params (delete_document): fileId (required - file storage ID to delete from RAG)
Params (search): query (required), fileIds (required - array of file storage IDs), topK? (optional number), similarityThreshold? (optional number)
Output (upload_document): \`{ data: { success, executionTimeMs, fileId, ragDocumentId?, ... } }\`

### approval
Ops: create_approval
Params (create_approval): resourceType (required), resourceId (required), priority (required: 'low'|'medium'|'high'|'urgent'), requestedBy?, dueDate?, description?, executionId?, stepSlug?, metadata?
Output: \`{ data: {...approval} }\` - returns created approval entity

### onedrive
Ops: get_user_token, refresh_token, read_file, list_folder_contents, sync_folder_files, upload_to_storage, update_sync_config
Params (get_user_token): userId (required)
Params (refresh_token): accountId (required), refreshToken (required)
Params (read_file): itemId (required), token (required)
Params (list_folder_contents): itemId (required), token (required)
Params (sync_folder_files): files (required), token (required), configId?, folderItemPath?
Params (upload_to_storage): fileName (required), fileContent (required), contentType?, storagePath?, metadata?
Params (update_sync_config): configId (required), status?, lastSyncAt?, lastSyncStatus?, errorMessage?
Output varies by operation - typically \`{ data: {...result} }\`

### crawler
Ops: discover_urls, fetch_urls
Params (discover_urls): url or domain (required), maxUrls? (default: 100), pattern?, query?, timeout?
Params (fetch_urls): urls (required - array), wordCountThreshold? (default: 100), timeout?
Output (discover_urls): \`{ data: { success, urls_discovered, urls: [...] } }\`
Output (fetch_urls): \`{ data: { success, urls_fetched, urls_requested, pages: [...] } }\`

### website
Ops: create, update, get_by_domain
Params (create): domain (required), title?, description?, scanInterval? (default: '6h'), status? (default: 'active'), metadata?
Params (update): websiteId (required), domain?, title?, description?, scanInterval?, lastScannedAt?, status?, metadata?
Params (get_by_domain): domain (required)
Output: \`{ data: {...website} | null }\`

## Variable Syntax
- Simple: {{variableName}}
- Nested: {{customer.email}}
- Array: {{customers[0].name}}
- Step output: {{steps.step_slug.output.data.fieldName}}
- Secrets: {{secrets.secretName}}
- System: {{organizationId}}, {{executionId}}

### Step Output Access Pattern
Action step outputs are wrapped: \`steps.{step_slug}.output.data\`
- Single entity: \`{{steps.get_customer.output.data._id}}\`
- Array item: \`{{steps.query_step.output.data[0]._id}}\`
- Array length: \`{{steps.query_step.output.data|length}}\`
- Paginated: \`{{steps.query_step.output.data}}\` (array), \`{{steps.query_step.output.isDone}}\`
- Exception: set_variables returns \`{{steps.set_step.output.variables.varName}}\`

JEXL condition expressions (no curly braces):
- Check array not empty: \`steps.query_step.output.data|length > 0\`
- Check entity exists (get_by_id): \`steps.get_customer.output.data != null\`
- Check entity found (workflow_processing_records.find_*): \`steps.find_step.output.data != null\`
- Check isDone: \`steps.query_step.output.isDone == false\`

## JEXL Expression Syntax
Operators: ==, !=, <, >, <=, >=, &&, ||, !, +, -, *, /, %
Ternary: condition ? trueVal : falseVal
Access: field.nested, array[0], array[0].name
Transforms: value|transform, value|transform(arg)
Note: Use |length for array/string length. .length does NOT work in JEXL.

## JEXL Transforms
Pipe syntax: value|transform or value|transform(arg1, arg2). Chainable: value|sort('asc')|first

### String
- upper: \`name|upper\` → "JOHN"
- lower: \`name|lower\` → "john"
- trim: \`input|trim\` → removes whitespace
- length: \`items|length\` → 3 (works on strings and arrays, returns 0 otherwise)
- string: \`count|string\` → "42" (uses JSON.stringify for objects)

### Array
- first: \`items|first\` → first element
- last: \`items|last\` → last element
- join: \`tags|join(', ')\` → "a, b, c" (default separator: ',')
- map: \`users|map('email')\` → ["a@x.com", "b@x.com"]
- filter: \`scores|filter('value > 50')\` → items where value > 50 (numeric conditions only)
- filterBy: \`users|filterBy('status', 'active')\` → users where status equals "active"
- find: \`users|find('id', '123')\` → first user with id "123" (or null)
- flatten: \`[[1,2],[3]]|flatten\` → [1,2,3] (one level)
- unique: \`[1,1,2]|unique\` → ["1","2"] (string-based dedup)
- concat: \`arr1|concat(arr2)\` → merged array
- sort: \`items|sort('price', 'desc')\` → sorted by price descending (default: 'asc')
- reverse: \`items|reverse\` → reversed order
- slice: \`items|slice(0, 5)\` → first 5 elements
- hasOverlap: \`tags1|hasOverlap(tags2)\` → true/false

### Type Conversion
- number: \`str|number\` → numeric value
- boolean: \`val|boolean\` → true/false
- parseJSON: \`jsonStr|parseJSON\` → parsed object (returns null on error)

### Date/Time
- daysAgo: \`createdAt|daysAgo\` → 7 (days since date, -1 if invalid)
- hoursAgo: \`updatedAt|hoursAgo\` → 24
- minutesAgo: \`timestamp|minutesAgo\` → 30
- parseDate: \`dateStr|parseDate\` → timestamp in ms (null if invalid)
- isoDate: \`timestamp|isoDate\` → "2024-01-15T10:30:00.000Z"
- epochSeconds: \`timestamp|epochSeconds\` → 1705312200
- isBefore: \`date1|isBefore(date2)\` → true/false
- isAfter: \`date1|isAfter(date2)\` → true/false

### Formatting
- formatList: \`products|formatList('- {name}: \${price}', '\\n')\` → formatted string (default separator: '\\n')

## Best Practices
- Use snake_case for stepSlug
- Always define error ports for action/llm steps
- Use set_variables to update state
- Set maxIterations on loops
- Configure retryPolicy for unreliable services
`;
