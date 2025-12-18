/**
 * Compact Workflow Syntax Reference
 * This is a minified version for AI system prompts.
 * For detailed examples, use workflow_examples tool with list_predefined or get_predefined operations.
 */

export const WORKFLOW_SYNTAX_COMPACT = `
## Workflow Structure
\`\`\`
{ workflowConfig: { name, description?, version?, workflowType: 'predefined', config?: { timeout?, retryPolicy?: { maxRetries, backoffMs }, variables?, secrets? } }, stepsConfig: [{ stepSlug, name, stepType, order, config, nextSteps }] }
\`\`\`

## Step Types

### trigger (stepType: 'trigger')
Config: { type: 'manual'|'scheduled'|'webhook'|'event', inputs?, schedule?, context? }
NextSteps: { success: 'next_step' }

### llm (stepType: 'llm')
Config: { name (REQUIRED), systemPrompt (REQUIRED), userPrompt?, temperature?, maxTokens?, maxSteps?, tools?: string[], outputFormat?: 'text'|'json', outputSchema?: JsonSchemaDefinition, contextVariables? }
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

## Action Types & Output Structures
All actions return unified structure: \`{ data: T | T[] | null, isDone?: boolean, continueCursor?: string | null }\`
Exception: set_variables returns \`{ variables: {...} }\`
(Params: required params listed first, optional params end with ?)

### workflow_processing_records
Ops: find_unprocessed, find_unprocessed_open_conversation, find_product_recommendation_by_status, record_processed
Params (find_unprocessed): tableName (required), backoffHours (required)
Params (find_unprocessed_open_conversation): backoffHours (required)
Params (find_product_recommendation_by_status): backoffHours (required), status (required: 'pending'|'approved'|'rejected')
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
Params (create): customerId?, subject?, status? ('open'|'closed'|'archived'|'spam'), priority?, type?, channel?, direction? ('inbound'|'outbound'), providerId?, metadata?
Params (query_messages): conversationId?, channel?, direction?, paginationOpts (required)
Params (query_latest_message_by_delivery_state): channel (required), direction (required), deliveryState (required: 'queued'|'sent'|'delivered'|'failed'), providerId?
Params (update): conversationId (required), updates (required)
Params (create_from_email): emails (required), status?, priority?, providerId?, type?
Params (create_from_sent_email): emails (required), status?, priority?, providerId?, accountEmail?, type?
Output (query_messages): \`{ page: [...messages], isDone: boolean, continueCursor: string | null }\`
Output (create/update): \`{ data: {...conversation} }\` - returns full conversation entity

### document
Ops: update
Params (update): documentId (required), title?, content?, metadata?, fileId?, mimeType?, extension?, sourceProvider?
Output (update): \`{ data: {...document} }\` - returns full document entity

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
Ops: upload_document, upload_text
Params (upload_document): recordId (required - document ID from documents table)
Params (upload_text): content (required), metadata (required), recordId?
Output: \`{ data: { success, documentType, executionTimeMs, ... } }\`

### imap
Ops: search
Params: host?, port?, secure?, username?, password?, accessToken?, mailbox? (default: 'INBOX'), afterUid?, includeAttachments?, parseHtml?, threadSearchFolders?
Note: credentials can be provided via params or workflow variables
Output: \`{ data: [...emails] }\` - array of email objects with thread messages

### email_provider
Ops: get_default, get_imap_credentials
Output (get_default): \`{ data: { _id, name, vendor, authMethod, imapConfig, smtpConfig, passwordAuth?, isDefault, status } }\`
Output (get_imap_credentials): \`{ data: { providerId, credentials: { host, port, secure, username, passwordEncrypted/accessTokenEncrypted }, authMethod } }\`

### approval
Ops: create_approval
Params (create_approval): resourceType (required), resourceId (required), priority (required: 'low'|'medium'|'high'|'urgent'), requestedBy?, dueDate?, description?, executionId?, stepSlug?, metadata?
Output: \`{ data: {...approval} }\` - returns created approval entity

### tone_of_voice
Ops: get_tone_of_voice
Output: \`{ data: {...toneOfVoice} | null }\`

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

### websitePages
Ops: bulk_upsert
Params: websiteId (required), pages (required - array of { url, title?, description?, content?, wordCount?, metadata?, structuredData? })
Output: \`{ data: { created, updated, total } }\`

### workflow
Ops: upload_all_workflows
Params: timeout? (default: 120000ms)
Output: \`{ data: { ...result, executionTimeMs } }\`

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
- Array length: \`{{steps.query_step.output.data.length}}\`
- Paginated: \`{{steps.query_step.output.data}}\` (array), \`{{steps.query_step.output.isDone}}\`
- Exception: set_variables returns \`{{steps.set_step.output.variables.varName}}\`

JEXL condition expressions (no curly braces):
- Check array not empty: \`steps.query_step.output.data.length > 0\`
- Check entity exists (get_by_id): \`steps.get_customer.output.data != null\`
- Check entity found (workflow_processing_records.find_*): \`steps.find_step.output.data != null\`
- Check isDone: \`steps.query_step.output.isDone == false\`

## Common Patterns

### Pagination
1. Fetch: action(query with paginationOpts)
2. Loop: loop(items={{steps.step_slug.output.data}})
3. Check: condition(expression='steps.step_slug.output.isDone == false')
4. Continue: set_variables(cursor={{steps.step_slug.output.continueCursor}})

### Entity Processing (One-at-a-time Pattern)
workflow_processing_records returns ONE entity at a time (not an array):
1. Find: action(workflow_processing_records.find_unprocessed)
   - Returns: { data: {...document} | null } - single document or null
2. Check: condition(expression='steps.find_step.output.data != null')
3. Access entity directly: {{steps.find_step.output.data._id}}, {{steps.find_step.output.data.email}}
4. Process: llm or action steps
5. Mark: action(workflow_processing_records.record_processed) with recordId={{steps.find_step.output.data._id}}, recordCreationTime={{steps.find_step.output.data._creationTime}}

### Integration Sync
1. Fetch: action(integration with list operation)
2. Access result: \`{{steps.fetch_step.output.data.result}}\`
3. Loop if array: loop(items={{steps.fetch_step.output.data.result}})
4. Upsert: action(customer/product create/update)

## Best Practices
- Use snake_case for stepSlug
- Always define error ports for action/llm steps
- Use set_variables to update state
- Set maxIterations on loops
- Use workflow_processing_records for entity-by-entity processing
- Configure retryPolicy for unreliable services
`;

