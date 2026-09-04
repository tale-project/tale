/**
 * The knowledge routes' WIRE contract, as the data-residency page and the
 * retrieval surface drive it:
 *
 *  - a BYO connection with `sslmode: 'verify-ca'` — one of the five modes the
 *    picker offers and the shared schema accepts — saves and probes instead
 *    of dying at the route gate as a bare "invalid body";
 *  - a host-policy refusal is a 400 carrying its code and the sentence that
 *    names the fix, never a generic 500;
 *  - `/fetch` honours `page` as a window over the text rather than accepting
 *    it and shipping the whole document regardless.
 */

import type { Context } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

const {
  writeKnowledgeConnection,
  probeKnowledgeConnection,
  writeKnowledgeEmbedding,
  fetchKnowledgeDocument,
  searchKnowledgeForOrg,
} = vi.hoisted(() => ({
  writeKnowledgeConnection: vi.fn(),
  probeKnowledgeConnection: vi.fn(),
  writeKnowledgeEmbedding: vi.fn(),
  fetchKnowledgeDocument: vi.fn(),
  searchKnowledgeForOrg: vi.fn(),
}));

vi.mock('./admin.ts', () => {
  class KnowledgeAdminError extends Error {
    readonly code: string;
    readonly status: 400 | 404;
    constructor(code: string, message: string, status: 400 | 404 = 400) {
      super(message);
      this.name = 'KnowledgeAdminError';
      this.code = code;
      this.status = status;
    }
  }
  return {
    KnowledgeAdminError,
    writeKnowledgeConnection,
    probeKnowledgeConnection,
    writeKnowledgeEmbedding,
    deleteKnowledgeConnection: vi.fn(),
    deleteKnowledgeEmbedding: vi.fn(),
    readKnowledgeConnectionView: vi.fn(),
    readKnowledgeEmbeddingView: vi.fn(),
    listEmbeddingRecommendationsForOrg: vi.fn(),
  };
});

vi.mock('./service.ts', () => {
  class KnowledgeError extends Error {
    readonly code: string;
    readonly status: 400 | 404 | 503;
    constructor(code: string, message: string, status: 400 | 404 | 503 = 400) {
      super(message);
      this.name = 'KnowledgeError';
      this.code = code;
      this.status = status;
    }
  }
  return { KnowledgeError, fetchKnowledgeDocument, searchKnowledgeForOrg };
});

vi.mock('../projects/service.ts', () => ({
  getProjectAuthContext: vi.fn(async () => ({
    organizationId: 'o1',
    userId: 'u1',
    role: 'admin',
    teamIds: [],
  })),
  listProjects: vi.fn(async () => []),
}));

vi.mock('../provider_credentials/service.ts', () => ({
  listCredentials: vi.fn(async () => []),
}));

vi.mock('../../lib/org-config.ts', () => ({
  resolveOrgSlug: vi.fn(async () => 'acme'),
}));

vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', {
        user: { id: 'u1', email: 'u@example.test' },
      } as never);
      await next();
    },
}));

vi.mock('../../auth/org.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth/org.ts')>();
  return {
    ...actual,
    requireOrgMember:
      () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
        c.set('orgId', 'o1');
        c.set('orgMember', { role: 'admin' } as never);
        await next();
      },
  };
});

import { FETCH_WINDOW_CHARS } from '../../core/knowledge/fetch.ts';
import { KnowledgeAdminError } from './admin.ts';
import { createKnowledgeRoutes } from './routes.ts';

function makeApp() {
  return createKnowledgeRoutes({ sql: {} as never, auth: {} as never });
}

async function post(route: string, body: unknown): Promise<Response> {
  return await makeApp().request(route, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const verifyCaConnection = {
  host: 'kb.internal.example',
  port: 5432,
  database: 'knowledge',
  user: 'tale',
  sslmode: 'verify-ca',
  password: 'secret',
};

describe('knowledge routes — BYO connection wire contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeKnowledgeConnection.mockResolvedValue(undefined);
    probeKnowledgeConnection.mockResolvedValue({ ok: true, latencyMs: 3 });
  });

  it('saves a connection with sslmode verify-ca (the picker offers it)', async () => {
    const res = await post('/connection?orgId=o1', verifyCaConnection);
    expect(res.status).toBe(200);
    expect(writeKnowledgeConnection).toHaveBeenCalledWith('acme', {
      connection: expect.objectContaining({ sslmode: 'verify-ca' }),
      password: 'secret',
    });
  });

  it('probes a connection with sslmode verify-ca', async () => {
    const res = await post('/connection/test?orgId=o1', verifyCaConnection);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, latencyMs: 3 });
    expect(probeKnowledgeConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        connection: expect.objectContaining({ sslmode: 'verify-ca' }),
        orgSlug: 'acme',
      }),
    );
  });

  it('still refuses a mode outside the shared set', async () => {
    const res = await post('/connection?orgId=o1', {
      ...verifyCaConnection,
      sslmode: 'allow',
    });
    expect(res.status).toBe(400);
    expect(writeKnowledgeConnection).not.toHaveBeenCalled();
  });

  it('answers a host-policy refusal on save as a 400 with code and reason', async () => {
    writeKnowledgeConnection.mockRejectedValue(
      new KnowledgeAdminError(
        'PRIVATE_HOST_BLOCKED',
        'Host "10.0.0.5" is a private/loopback address and is blocked. Set TALE_ALLOW_PRIVATE_PROVIDER_HOSTS=1 in the platform process env to enable self-hosted backends like Ollama on localhost.',
        400,
      ),
    );
    const res = await post('/connection?orgId=o1', {
      ...verifyCaConnection,
      host: '10.0.0.5',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('PRIVATE_HOST_BLOCKED');
    expect(body.message).toContain('TALE_ALLOW_PRIVATE_PROVIDER_HOSTS');
  });

  it('maps a refusal thrown by the probe the same way instead of a 500', async () => {
    probeKnowledgeConnection.mockRejectedValue(
      new KnowledgeAdminError('BLOCKED_HOST', 'Host is blocked.', 400),
    );
    const res = await post('/connection/test?orgId=o1', verifyCaConnection);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'BLOCKED_HOST',
      message: 'Host is blocked.',
    });
  });
});

describe('knowledge routes — fetch paging', () => {
  const text = 'x'.repeat(FETCH_WINDOW_CHARS * 2 + 5);
  const document = {
    fileId: 'ref-1',
    filename: 'ledger.txt',
    folderPath: null,
    modifiedAt: null,
    text,
    conversationId: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    fetchKnowledgeDocument.mockResolvedValue(document);
  });

  it('ships the whole document when no page is asked for', async () => {
    const res = await post('/fetch?orgId=o1', { fileId: 'ref-1' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { document: { text: string } };
    expect(body.document.text).toHaveLength(text.length);
    expect(body).not.toHaveProperty('page');
  });

  it('windows the text by page and says how many pages there are', async () => {
    const res = await post('/fetch?orgId=o1', { fileId: 'ref-1', page: 3 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      document: { text: string };
      page: number;
      totalPages: number;
      totalChars: number;
    };
    expect(body.page).toBe(3);
    expect(body.totalPages).toBe(3);
    expect(body.totalChars).toBe(text.length);
    expect(body.document.text).toHaveLength(5);
  });

  it('keeps a miss a miss', async () => {
    fetchKnowledgeDocument.mockResolvedValue(null);
    const res = await post('/fetch?orgId=o1', { fileId: 'ghost', page: 2 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ document: null });
  });
});
