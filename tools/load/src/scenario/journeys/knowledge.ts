/**
 * Knowledge journeys: upload a document to the hub (presign, PUT to the
 * object store, bind), search the knowledge base for what was uploaded,
 * search the hub by name.
 *
 * Two environment refusals end a user's attempts for good instead of
 * failing forever: a deployment without object storage (503
 * `OBJECT_STORE_UNCONFIGURED`, counted as `uploads.unavailable`) and an
 * organization without a usable embedding model (`knowledge.unavailable`).
 */

import {
  KNOWLEDGE_UNAVAILABLE_CODES,
  OBJECT_STORE_UNCONFIGURED,
  createDocumentFromUpload,
  listHubDocuments,
  presignUpload,
  putPresigned,
  searchHub,
  searchKnowledge,
} from '../../api/knowledge.ts';
import { generateDocument, knowledgeQuery } from '../../data/documents.ts';
import { pick } from '../../data/random.ts';
import { searchTerm } from '../../data/work.ts';
import { remember } from '../user.ts';
import type { Journey } from './journey.ts';

/** Upload one generated document to the hub. */
export const uploadDocument: Journey = {
  name: 'knowledge.upload',
  eligible: (vu) => vu.options.uploads && vu.canEdit && !vu.uploadsUnavailable,
  run: async (vu) => {
    const orgId = vu.orgId;
    vu.screen = 'other';
    await listHubDocuments(vu.api, orgId);
    await vu.pause('click');
    const doc = generateDocument(vu.data, vu.random);
    const ticket = await presignUpload(vu.api, orgId, doc.contentType);
    if (ticket.status === 503) {
      if (ticket.code === OBJECT_STORE_UNCONFIGURED) {
        vu.uploadsUnavailable = true;
        vu.metrics.counter('uploads.unavailable');
      } else {
        vu.metrics.error(
          'POST /api/app/files/blob-upload',
          'http_503',
          ticket.response?.text.slice(0, 200) ?? '',
        );
      }
      return;
    }
    if (ticket.body === undefined) return;
    const status = await putPresigned(
      vu.ctx.agent,
      vu.metrics,
      ticket.body.url,
      doc.contentType,
      doc.body,
      vu.options.requestTimeoutMs,
    );
    await vu.guard();
    if (status < 200 || status >= 300) return;
    const bound = await createDocumentFromUpload(vu.api, orgId, {
      storageRef: ticket.body.storageRef,
      fileName: doc.fileName,
      contentType: doc.contentType,
    });
    if (bound.body === undefined) return;
    vu.metrics.counter('uploads.completed');
    vu.metrics.counter('uploads.bytes', doc.body.length);
    const memory = vu.memory();
    for (const keyword of doc.keywords) remember(memory.keywords, keyword);
    await listHubDocuments(vu.api, orgId);
  },
};

/** Ask the knowledge base about something (ideally something uploaded). */
export const searchKnowledgeBase: Journey = {
  name: 'knowledge.search',
  eligible: (vu) => vu.options.knowledgeSearch && !vu.knowledgeUnavailable,
  run: async (vu) => {
    const orgId = vu.orgId;
    vu.screen = 'other';
    const query = knowledgeQuery(
      vu.random,
      vu.memory().keywords,
      searchTerm(vu.data, vu.random),
    );
    await vu.pause('type', 0.5);
    const result = await searchKnowledge(vu.api, orgId, query);
    if (result.ok) {
      vu.metrics.counter(
        result.body === 0 ? 'knowledge.search_empty' : 'knowledge.search_hits',
      );
      return;
    }
    if (
      result.code !== undefined &&
      KNOWLEDGE_UNAVAILABLE_CODES.has(result.code)
    ) {
      vu.knowledgeUnavailable = true;
      vu.metrics.counter('knowledge.unavailable');
      return;
    }
    if (result.status === 503 || result.status === 409) {
      vu.metrics.error(
        'POST /api/app/knowledge/search',
        `http_${result.status}`,
        result.response?.text.slice(0, 200) ?? '',
      );
    }
  },
};

/** Find a document in the hub by name. */
export const searchDocuments: Journey = {
  name: 'knowledge.hub-search',
  run: async (vu) => {
    vu.screen = 'other';
    const term =
      pick(vu.random, vu.memory().keywords) ?? searchTerm(vu.data, vu.random);
    await vu.pause('type', 0.3);
    await searchHub(vu.api, vu.orgId, term.split(' ')[0] ?? term);
  },
};
