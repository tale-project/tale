export interface RagConfig {
  serviceUrl: string;
}

/**
 * Get RAG service configuration
 * Reads from RAG_URL environment variable or defaults to http://localhost:8001
 */
export function getRagConfig(): RagConfig {
  // Get RAG service URL from environment or default
  // Priority: RAG_URL environment variable > default (http://localhost:8001)
  const serviceUrl = process.env.RAG_URL || 'http://localhost:8001';

  return { serviceUrl };
}

