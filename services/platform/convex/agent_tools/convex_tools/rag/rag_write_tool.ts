/**
 * Convex Tool: RAG Write
 *
 * Write (add or update) knowledge in the RAG knowledge base.
 * Supports both corrections (updating incorrect info) and adding new information.
 */

import { z } from 'zod';
import { createTool } from '@convex-dev/agent';
import type { ToolDefinition } from '../../types';

interface DocumentAddResponse {
  success: boolean;
  document_id: string;
  message?: string;
}

/**
 * Get RAG service URL from environment or variables
 */
function getRagServiceUrl(variables?: Record<string, unknown>): string {
  const url =
    (variables?.ragServiceUrl as string) ||
    process.env.RAG_URL ||
    'http://localhost:8001';

  return url;
}

export const ragWriteTool = {
  name: 'rag_write' as const,
  tool: createTool({
    description: `Write (add or update) knowledge in the knowledge base.

Use this tool to:
1. ADD new information the user provides that should be remembered
2. CORRECT information when the user points out something was wrong

Examples of when to use:
- User provides new info: "Our store hours are 9am-5pm on weekdays"
- User shares a policy: "We offer free shipping on orders over $50"
- User corrects you: "No, that's wrong. The actual answer is..."
- User updates info: "That information is outdated. Now it's..."

Parameters:
- topic: Brief subject (e.g., "store hours", "shipping policy")
- content: The information to add to the knowledge base
- incorrect_info: (Optional) If correcting, what was wrong`,
    args: z.object({
      topic: z
        .string()
        .describe(
          'Brief topic/subject (e.g., "return policy", "pricing", "store hours")',
        ),
      content: z
        .string()
        .describe('The information to add or the correct information'),
      incorrect_info: z
        .string()
        .optional()
        .describe(
          'If this is a correction, the incorrect information that was provided',
        ),
    }),
    handler: async (ctx, args): Promise<DocumentAddResponse> => {
      const variables = (
        ctx as unknown as { variables?: Record<string, unknown> }
      ).variables;

      const ragServiceUrl = getRagServiceUrl(variables);
      const isCorrection = !!args.incorrect_info;

      console.log('[tool:rag_write] start', {
        topic: args.topic,
        isCorrection,
        ragServiceUrl,
      });

      // Format the document based on whether it's a correction or new info
      let document: string;
      let documentType: string;

      if (isCorrection) {
        documentType = 'correction';
        document = `CORRECTION - ${args.topic.toUpperCase()}

Topic: ${args.topic}

Previous (INCORRECT) information: ${args.incorrect_info}

CORRECT information: ${args.content}

Note: This correction was made based on user feedback. The correct information above should be used instead of any older information on this topic.`;
      } else {
        documentType = 'knowledge';
        document = `KNOWLEDGE - ${args.topic.toUpperCase()}

Topic: ${args.topic}

Information: ${args.content}

Note: This information was provided by the user and added to the knowledge base.`;
      }

      const url = `${ragServiceUrl}/api/v1/documents`;
      const payload = {
        content: document,
        document_id: `${documentType}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
        metadata: {
          type: documentType,
          topic: args.topic,
          created_at: new Date().toISOString(),
          source: 'user_feedback',
        },
      };

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`RAG service error: ${response.status} ${errorText}`);
        }

        const result = (await response.json()) as DocumentAddResponse;

        console.log('[tool:rag_write] success', {
          topic: args.topic,
          isCorrection,
          document_id: result.document_id,
        });

        const action = isCorrection ? 'corrected' : 'added';
        return {
          success: true,
          document_id: result.document_id,
          message: `Knowledge base ${action} for "${args.topic}". Future queries will use this information.`,
        };
      } catch (error) {
        console.error('[tool:rag_write] error', {
          topic: args.topic,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  }),
} as const satisfies ToolDefinition;

