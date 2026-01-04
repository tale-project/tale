/**
 * Helper for reading predefined workflows from TypeScript files
 */

import { workflows } from '../../../predefined_workflows';

/**
 * Workflow categories and use cases for agent guidance
 */
const WORKFLOW_METADATA: Record<string, { category: string; useCases: string[] }> = {
  // Entity Processing - process one entity at a time
  generalCustomerStatusAssessment: {
    category: 'entity_processing',
    useCases: ['customer analysis', 'status assessment', 'churn prediction'],
  },
  generalProductRecommendation: {
    category: 'entity_processing',
    useCases: ['product recommendations', 'AI recommendations', 'personalization'],
  },
  productRecommendationEmail: {
    category: 'entity_processing',
    useCases: ['email campaigns', 'product recommendations', 'email sending'],
  },
  conversationAutoReply: {
    category: 'entity_processing',
    useCases: ['auto reply', 'customer support', 'conversation handling'],
  },
  conversationAutoArchive: {
    category: 'entity_processing',
    useCases: ['archiving', 'cleanup', 'conversation management'],
  },
  productRelationshipAnalysis: {
    category: 'entity_processing',
    useCases: ['product analysis', 'relationship mapping', 'cross-sell'],
  },

  // RAG Sync - sync data to knowledge base
  documentRagSync: {
    category: 'rag_sync',
    useCases: ['RAG', 'knowledge base', 'document sync'],
  },
  productRagSync: {
    category: 'rag_sync',
    useCases: ['RAG', 'product sync', 'knowledge base'],
  },
  customerRagSync: {
    category: 'rag_sync',
    useCases: ['RAG', 'customer sync', 'knowledge base'],
  },

  // Data Sync - sync external data with pagination
  shopifySyncProducts: {
    category: 'data_sync',
    useCases: ['Shopify', 'product sync', 'e-commerce', 'pagination'],
  },
  shopifySyncCustomers: {
    category: 'data_sync',
    useCases: ['Shopify', 'customer sync', 'e-commerce', 'pagination'],
  },
  emailSyncImap: {
    category: 'data_sync',
    useCases: ['email sync', 'IMAP', 'inbox sync'],
  },
  onedriveSyncWorkflow: {
    category: 'data_sync',
    useCases: ['OneDrive', 'file sync', 'document sync'],
  },
};

type WorkflowDefinition = {
  workflowConfig: {
    name: string;
    description?: string;
    version?: string;
    workflowType: string;
    config?: Record<string, unknown>;
  };
  stepsConfig: Array<{
    stepSlug: string;
    name: string;
    stepType: string;
    order: number;
    config: unknown;
    nextSteps: Record<string, string>;
  }>;
};

export type WorkflowReadListPredefinedResult = {
  operation: 'list_predefined';
  count: number;
  categorySummary: string;
  workflows: Array<{
    key: string;
    name: string;
    description: string;
    version: string;
    stepCount: number;
    category: string;
    useCases: string[];
  }>;
};

export type WorkflowReadGetPredefinedResult = {
  operation: 'get_predefined';
  found: boolean;
  key?: string;
  workflow?: WorkflowDefinition;
  message?: string;
};

/**
 * List all predefined workflows with basic info
 */
export function listPredefinedWorkflows(): WorkflowReadListPredefinedResult {
  const workflowEntries = Object.entries(workflows) as [string, WorkflowDefinition][];

  const workflowList = workflowEntries.map(([key, wf]) => {
    const metadata = WORKFLOW_METADATA[key] || { category: 'other', useCases: [] };
    return {
      key,
      name: wf.workflowConfig.name,
      description: wf.workflowConfig.description || 'No description',
      version: wf.workflowConfig.version || '1.0.0',
      stepCount: wf.stepsConfig.length,
      category: metadata.category,
      useCases: metadata.useCases,
    };
  });

  // Group by category for summary
  const byCategory = workflowList.reduce((acc, wf) => {
    if (!acc[wf.category]) acc[wf.category] = [];
    acc[wf.category].push(wf.key);
    return acc;
  }, {} as Record<string, string[]>);

  const categorySummary = Object.entries(byCategory)
    .map(([cat, keys]) => `${cat}: ${keys.join(', ')}`)
    .join(' | ');

  return {
    operation: 'list_predefined',
    count: workflowList.length,
    categorySummary,
    workflows: workflowList,
  };
}

/**
 * Get a specific predefined workflow by key
 */
export function getPredefinedWorkflow(args: {
  workflowKey: string;
}): WorkflowReadGetPredefinedResult {
  const { workflowKey } = args;
  
  const workflowEntries = Object.entries(workflows) as [string, WorkflowDefinition][];
  
  // Try exact match first
  let found = workflowEntries.find(([key]) => key === workflowKey);
  
  // Try case-insensitive match
  if (!found) {
    found = workflowEntries.find(
      ([key]) => key.toLowerCase() === workflowKey.toLowerCase()
    );
  }
  
  // Try partial match (contains) - but only if there's exactly one match
  if (!found) {
    const partialMatches = workflowEntries.filter(([key]) =>
      key.toLowerCase().includes(workflowKey.toLowerCase()),
    );
    if (partialMatches.length === 1) {
      found = partialMatches[0];
    } else if (partialMatches.length > 1) {
      const matchedKeys = partialMatches.map(([key]) => key).join(', ');
      return {
        operation: 'get_predefined',
        found: false,
        message: `Multiple workflows match "${workflowKey}": ${matchedKeys}. Please be more specific.`,
      };
    }
  }

  if (!found) {
    const availableKeys = workflowEntries.map(([key]) => key).join(', ');
    return {
      operation: 'get_predefined',
      found: false,
      message: `Predefined workflow "${workflowKey}" not found. Available: ${availableKeys}`,
    };
  }

  const [key, workflow] = found;
  return {
    operation: 'get_predefined',
    found: true,
    key,
    workflow,
  };
}

