/**
 * `knowledge` — the wire contract for the backend calls the app makes into this
 * family: one entry per function name, carrying its argument and response
 * shapes. Materialized from the shapes the app consumed at the Convex
 * retirement, so the hook wrappers stay fully typed with no generated
 * `_generated/api` behind them; the adapter rows in `../knowledge.ts` are what
 * actually serve them.
 */

export interface KnowledgeContract {
  'knowledge/actions:deleteKnowledgeConnection': {
    kind: 'action';
    args: { organizationId: string };
    returns: null;
  };
  'knowledge/actions:deleteKnowledgeEmbedding': {
    kind: 'action';
    args: { organizationId: string };
    returns: null;
  };
  'knowledge/actions:getKnowledgeConnection': {
    kind: 'action';
    args: { organizationId: string };
    returns: {
      configured: boolean;
      host?: string;
      port?: number;
      database?: string;
      user?: string;
      sslmode?: 'disable' | 'prefer' | 'require' | 'verify-ca' | 'verify-full';
      hasPassword?: boolean;
    };
  };
  'knowledge/actions:getKnowledgeEmbedding': {
    kind: 'action';
    args: { organizationId: string };
    returns: {
      configured: boolean;
      providerSlug?: string;
      credentialId?: string;
      model?: string;
      dimensions?: number;
      baseUrl?: string;
    };
  };
  'knowledge/actions:saveKnowledgeConnection': {
    kind: 'action';
    args: {
      password?: null | string;
      organizationId: string;
      user: string;
      host: string;
      port: number;
      database: string;
      sslmode: 'disable' | 'prefer' | 'require' | 'verify-ca' | 'verify-full';
    };
    returns: null;
  };
  'knowledge/actions:saveKnowledgeEmbedding': {
    kind: 'action';
    args: {
      credentialId?: string;
      baseUrl?: string;
      dimensions: number;
      organizationId: string;
      model: string;
      providerSlug: string;
    };
    returns: null;
  };
  'knowledge/actions:testKnowledgeConnection': {
    kind: 'action';
    args: {
      password?: null | string;
      organizationId: string;
      user: string;
      host: string;
      port: number;
      database: string;
      sslmode: 'disable' | 'prefer' | 'require' | 'verify-ca' | 'verify-full';
    };
    returns: {
      ok: boolean;
      latencyMs?: number;
      version?: string;
      vectorAvailable?: boolean;
      paradedbAvailable?: boolean;
      error?: string;
      hint?: string;
    };
  };
  'knowledge/recommendations:listEmbeddingRecommendations': {
    kind: 'action';
    args: { organizationId: string };
    returns: Array<{
      providerSlug: string;
      model: string;
      dimensions: number;
      recommended: boolean;
    }>;
  };
}
