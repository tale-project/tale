export interface RagConfig {
  serviceUrl: string;
}

/**
 * Get RAG service configuration.
 * Reads from RAG_URL environment variable or defaults to http://localhost:8001.
 */
export function getRagConfig(): RagConfig {
  const serviceUrl = process.env.RAG_URL || 'http://localhost:8001';
  return { serviceUrl };
}
