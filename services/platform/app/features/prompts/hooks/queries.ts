import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';

export interface PromptVersionEntry {
  version: number;
  content: string;
  publishedAt: number;
  publishedBy: string;
}

export interface PromptTemplate {
  _id: Id<'promptTemplates'>;
  _creationTime: number;
  organizationId: string;
  createdBy: string;
  title: string;
  content: string;
  description?: string;
  scope: 'global' | 'team' | 'personal';
  teamId?: string;
  category?: string;
  tags?: string[];
  usageCount: number;
  /** @deprecated */
  isPublished?: boolean;
  sourceMessageId?: string;
  version?: number;
  /** Only present in `getPrompt` detail for creator/admin viewers. */
  versionHistory?: PromptVersionEntry[];
}

export function usePrompts(organizationId: string) {
  const { data, isLoading } = useConvexQuery(api.prompts.queries.listPrompts, {
    organizationId,
  });

  const prompts: PromptTemplate[] = data ?? [];

  return {
    prompts,
    isLoading,
  };
}

export function usePrompt(promptId: Id<'promptTemplates'> | undefined) {
  return useConvexQuery(
    api.prompts.queries.getPrompt,
    promptId ? { promptId } : 'skip',
    { enabled: !!promptId },
  );
}

export function usePromptHistory(promptId: Id<'promptTemplates'> | undefined) {
  return useConvexQuery(
    api.prompts.queries.getPromptHistory,
    promptId ? { promptId } : 'skip',
    { enabled: !!promptId },
  );
}
