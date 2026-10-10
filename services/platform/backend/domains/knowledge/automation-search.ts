import type { Sql } from 'postgres';

import type {
  KnowledgeRunHit,
  WorkflowKnowledgeSearch,
} from '../../../lib/connectors/natives/index.ts';
import { EMBEDDING_SLUG } from '../../../lib/shared/constants/usage.ts';
import { resolveAutomationRunBinding } from '../automations/run-binding.ts';
import { ChatBudgetExceededError } from '../chat/budget-admission.ts';
import { resolveAutomationRunAttribution } from '../sandbox/op-attribution.ts';
import { automationRunKnowledgeScope } from './automation-scope.ts';
import { KnowledgeError, searchKnowledgeForOrg } from './service.ts';

type Search = WorkflowKnowledgeSearch['search'];
type SearchHit = Awaited<
  ReturnType<typeof searchKnowledgeForOrg>
>['hits'][number];

/** The embedding provider's refusals: the search did not run. */
const UNAVAILABLE_CODES = new Set([
  'EMBEDDING_CREDIT_EXHAUSTED',
  'EMBEDDING_CREDENTIAL_REJECTED',
  'EMBEDDING_UPSTREAM_ERROR',
]);

function toRunHit(hit: SearchHit): KnowledgeRunHit {
  const { source } = hit;
  return {
    text: hit.text,
    title: source.title,
    source: hit.corpus,
    ...(typeof source.documentId === 'string' && {
      documentId: source.documentId,
    }),
    ...(typeof source.projectId === 'string' && {
      projectId: source.projectId,
    }),
    ...(typeof source.url === 'string' && { url: source.url }),
    score: hit.fusedScore,
    ...(typeof hit.similarity === 'number' && { similarity: hit.similarity }),
  };
}

/**
 * A `knowledge.search` step's search, AS THE RUN it is a step of: it reads
 * what the run's agent steps read (`automationRunKnowledgeScope` — the run's
 * project, its automation's bound projects, or the hub) and books the
 * query's embedding under the run's subject, as an `llm` step's call. A run
 * that is gone, or pinned to a project that is gone, searches nothing.
 *
 * The same search the REST door runs, with no similarity floor: each hit
 * carries its `similarity`, for a later step to judge.
 */
export function knowledgeSearchForRuns(sql: Sql): WorkflowKnowledgeSearch {
  const search: Search = async (args) => {
    const binding = await resolveAutomationRunBinding(
      sql,
      args.organizationId,
      args.runId,
    );
    const subject =
      binding.kind === 'none'
        ? null
        : await resolveAutomationRunAttribution(sql, args);
    if (binding.kind === 'none' || subject === null) {
      return { ok: false, refusal: { kind: 'no_scope' } };
    }
    const access = await automationRunKnowledgeScope(
      sql,
      args.organizationId,
      binding.kind === 'project'
        ? { projectId: binding.projectId }
        : { boundProjectIds: binding.boundProjectIds },
    );
    try {
      const result = await searchKnowledgeForOrg(sql, {
        organizationId: args.organizationId,
        spender: {
          userId: subject.userId,
          // The automation's name, the lane its llm steps book under.
          agentSlug: subject.agentSlug ?? EMBEDDING_SLUG,
          ...(subject.apiKeyId !== undefined && {
            apiKeyId: subject.apiKeyId,
          }),
          ...(subject.projectIds !== undefined && {
            projectIds: subject.projectIds,
          }),
        },
        query: args.query,
        corpus: args.corpus,
        limit: args.limit,
        ...(args.folder !== undefined && { folder: args.folder }),
        access,
      });
      return { ok: true, hits: result.hits.map(toRunHit) };
    } catch (error) {
      if (error instanceof ChatBudgetExceededError) {
        return {
          ok: false,
          refusal: { kind: 'budget', detail: error.data.message },
        };
      }
      if (error instanceof KnowledgeError) {
        if (error.code === 'EMBEDDING_NOT_CONFIGURED') {
          return { ok: false, refusal: { kind: 'not_configured' } };
        }
        if (error.code === 'BUDGET_EXCEEDED') {
          return {
            ok: false,
            refusal: { kind: 'budget', detail: error.message },
          };
        }
        if (UNAVAILABLE_CODES.has(error.code)) {
          return {
            ok: false,
            refusal: { kind: 'unavailable', detail: error.message },
          };
        }
      }
      throw error;
    }
  };
  return { search };
}
