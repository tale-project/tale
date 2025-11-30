# RAG Action - Document Upload to Cognee

This action uploads documents from the Convex database to the cognee RAG (Retrieval-Augmented Generation) service for semantic search and retrieval.

## Overview

The RAG action enables workflows to:

- Read documents from the Convex `documents` table
- Handle both text content and file storage references
- Upload documents to the cognee RAG service
- Track upload status and results

## Configuration

### Environment Variables

Set these in your `.env` file:

```bash
# RAG Service URL (default: http://localhost:8001)
RAG_URL=http://localhost:8001

# Optional: RAG API Key (if authentication is required)
RAG_API_KEY=your-api-key-here
```

### Workflow Variables

You can also configure RAG settings in workflow variables:

```typescript
{
  ragServiceUrl: 'http://localhost:8001',
  ragApiKey: 'optional-api-key',
}
```

## Usage

### Basic Example

```typescript
{
  type: 'rag',
  config: {
    parameters: {
      operation: 'upload_document',
      documentId: 'doc_123',
      organizationId: 'org_456',
    },
  },
}
```

### With Custom RAG Service URL

```typescript
{
  type: 'rag',
  config: {
    parameters: {
      operation: 'upload_document',
      documentId: 'doc_123',
      organizationId: 'org_456',
      ragServiceUrl: 'https://rag.example.com',
    },
  },
}
```

### With Advanced Options

```typescript
{
  type: 'rag',
  config: {
    parameters: {
      operation: 'upload_document',
      documentId: 'doc_123',
      organizationId: 'org_456',
      forceReupload: true,        // Re-upload even if already uploaded
      includeMetadata: true,      // Include document metadata
      timeout: 60000,             // 60 second timeout
    },
  },
}
```

## Parameters

| Parameter         | Type    | Required | Description                                         |
| ----------------- | ------- | -------- | --------------------------------------------------- |
| `operation`       | string  | Yes      | Must be `'upload_document'`                         |
| `documentId`      | string  | Yes      | ID of the document to upload                        |
| `organizationId`  | string  | Yes      | Organization ID for context                         |
| `ragServiceUrl`   | string  | No       | RAG service URL (overrides env var)                 |
| `forceReupload`   | boolean | No       | Re-upload even if already uploaded (default: false) |
| `includeMetadata` | boolean | No       | Include document metadata (default: true)           |
| `timeout`         | number  | No       | Request timeout in milliseconds (default: 30000)    |

## Return Value

The action returns a result object:

```typescript
{
  success: boolean;
  documentId: string;
  ragDocumentId?: string;        // ID assigned by RAG service
  chunksCreated?: number;        // Number of chunks created
  processingTimeMs?: number;     // Time spent uploading
  documentType?: 'text' | 'file'; // Type of document uploaded
  executionTimeMs?: number;      // Total execution time
  error?: string;                // Error message if failed
  timestamp: number;             // Timestamp of upload
}
```

## Document Types

### Text Documents

Documents with a `content` field are uploaded as text:

```typescript
{
  title: 'My Document',
  kind: 'note',
  content: 'This is the document content...',
  metadata: { /* ... */ }
}
```

### File Documents

Documents with a `fileId` field are uploaded as files:

```typescript
{
  title: 'my-file.pdf',
  kind: 'file',
  fileId: 'storage_id_123',
  metadata: {
    contentType: 'application/pdf',
    size: 1024000,
    /* ... */
  }
}
```

## Metadata

The action automatically includes the following metadata when uploading:

```typescript
{
  documentId: string;           // Convex document ID
  organizationId: string;       // Organization ID
  title?: string;               // Document title
  kind?: string;                // Document kind
  sourceProvider?: string;      // Source provider (e.g., 'upload', 'onedrive')
  uploadedAt: string;           // ISO timestamp
}
```

## Error Handling

The action handles various error scenarios:

- **Document not found**: Returns error if document doesn't exist
- **Missing content**: Returns error if document has neither content nor fileId
- **File download failed**: Returns error if file URL is invalid or file is deleted
- **RAG service unavailable**: Retries up to 3 times with exponential backoff
- **Network timeout**: Respects the configured timeout parameter

## Workflow Example

Here's a complete workflow that uploads documents to RAG:

```typescript
export default {
  workflowConfig: {
    name: 'Upload Documents to RAG',
    workflowType: 'predefined',
    config: {
      variables: {
        ragServiceUrl: 'http://localhost:8001',
      },
    },
  },
  steps: [
    {
      id: 'trigger',
      type: 'trigger',
      config: { triggerType: 'manual' },
    },
    {
      id: 'upload_to_rag',
      type: 'action',
      config: {
        actionType: 'rag',
        parameters: {
          operation: 'upload_document',
          documentId: '${trigger.documentId}',
          organizationId: '${trigger.organizationId}',
        },
      },
    },
  ],
};
```

## Troubleshooting

### RAG Service URL not configured

**Error**: "RAG service URL not configured"

**Solution**: Set `RAG_URL` environment variable or provide `ragServiceUrl` in action parameters.

### Document not found

**Error**: "Document not found"

**Solution**: Verify the `documentId` is correct and the document exists in the database.

### File URL not available

**Error**: "File URL not available for document"

**Solution**: The file may have been deleted from storage. Check if the file still exists in Convex storage.

### RAG service connection failed

**Error**: "RAG service error: 502 Bad Gateway"

**Solution**: Verify the RAG service is running and accessible at the configured URL.

## Implementation Details

### File Structure

```
rag/
├── rag_action.ts          # Main action definition
├── types.ts               # TypeScript interfaces
├── rag_client.ts          # HTTP client for RAG service
├── get_rag_config.ts      # Configuration helper
├── read_document.ts       # Document reading logic
└── README.md              # This file
```

### Key Features

- **Retry Logic**: Automatic retries with exponential backoff for transient failures
- **File Handling**: Seamless handling of both text and file documents
- **Metadata Enrichment**: Automatic metadata inclusion for better RAG context
- **Error Tracking**: Detailed error messages for debugging
- **Performance Metrics**: Tracks processing and execution times
