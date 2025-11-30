# RAG Search Tool

## Overview

The RAG search tool enables agents to search the RAG knowledge base for relevant context using semantic search. This tool wraps the RAG service's `/api/v1/search` endpoint and returns the most relevant document chunks based on the query.

## Tool Name

`rag_search`

## Description

Search the RAG knowledge base for relevant context using semantic search. Returns the most relevant document chunks based on the query. Use this tool to find information from previously uploaded documents, websites, or other knowledge sources.

## Parameters

- **query** (string, required): Search query text
- **top_k** (number, optional): Number of results to return (default: 5, max: 20)
- **similarity_threshold** (number, optional): Minimum similarity score (0.0-1.0). Results below this threshold will be filtered out.
- **include_metadata** (boolean, optional): Whether to include metadata in results (default: true)

## Return Value

Returns a `QueryResponse` object with the following structure:

```typescript
{
  success: boolean;
  query: string;
  results: Array<{
    content: string;
    score: number;
    document_id?: string;
    metadata?: Record<string, unknown>;
  }>;
  total_results: number;
  processing_time_ms: number;
}
```

## Configuration

The tool requires the RAG service URL to be configured. It checks the following sources in order of priority:

1. `variables.ragServiceUrl` (from workflow variables)
2. `process.env.RAG_URL`
3. Default: `http://localhost:8001`

### Environment Variables

Set in your `.env` file:

```bash
# RAG Service URL (default: http://localhost:8001)
RAG_URL=http://localhost:8001
```

### Workflow Variables

You can also configure the RAG service URL in workflow variables:

```typescript
{
  ragServiceUrl: 'http://localhost:8001',
}
```

## Usage Examples

### Basic Search

```typescript
// In an agent configuration
{
  agentType: 'entity_finder',
  config: {
    systemPrompt: 'You are a helpful assistant...',
    userPrompt: 'Find information about {{topic}}',
    tools: ['rag_search'],
  }
}
```

### With Custom Parameters

The agent can call the tool with custom parameters:

```typescript
// The LLM will call the tool like this:
{
  query: "What is the return policy?",
  top_k: 3,
  similarity_threshold: 0.7,
  include_metadata: true
}
```

### In LLM Node

```typescript
{
  stepSlug: 'search_knowledge',
  stepType: 'llm',
  config: {
    llmNode: {
      systemPrompt: 'Search the knowledge base for relevant information.',
      userPrompt: 'Find information about {{query}}',
      tools: ['rag_search'],
    },
  },
  nextSteps: { success: 'process_results' },
}
```

## Integration with RAG Service

This tool integrates with the Tale RAG service, which:

- Stores documents in a vector database (PGVector)
- Uses semantic embeddings for similarity search
- Supports text documents, URLs, and file uploads
- Maintains metadata for filtering and context

Before using this tool, ensure that:

1. The RAG service is running and accessible
2. Documents have been uploaded to the RAG service (using the `rag` workflow action or directly via the RAG API)
3. The RAG service URL is properly configured

## Error Handling

The tool will throw an error if:

- The RAG service is not accessible
- The RAG service returns an error response
- Network issues occur during the request

Errors are logged with context information for debugging.

## See Also

- [RAG Service Documentation](../../../../../rag/README.md)
- [RAG Workflow Action](../../../../workflow/nodes/action/actions/rag/README.md)
- [Tool Registry](../../tool_registry.ts)
