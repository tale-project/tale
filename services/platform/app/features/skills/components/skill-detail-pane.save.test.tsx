/** Real query/mutation hooks and HTTP adapters, with an in-memory HTTP door. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { configKeys } from '@/app/hooks/config-query-keys';
import type { ReturnsOf } from '@/app/lib/backend/contract';
import { act, render, screen, waitFor } from '@/tests/utils/render';

import { SkillsSettings } from './skills-settings';

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@tale/ui/use-toast', async (original) => ({
  ...(await original<typeof import('@tale/ui/use-toast')>()),
  toast,
}));
vi.mock('@/app/hooks/use-session-probe', () => ({
  useSessionProbeSignedIn: () => true,
}));
vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useOrgTeams: () => ({ teams: [], isLoading: false }),
  useTeamDirectory: () => ({ teams: [], isLoading: false }),
}));
vi.mock('@tale/ui/error-boundaries/error-scope', () => ({
  useErrorScope: () => ({ organizationId: 'org1' }),
}));

type Skill = NonNullable<ReturnsOf<'skills/actions:getSkill'>>;
const initialSkill: Skill = {
  slug: 'house-voice',
  description: 'How we write',
  body: 'Write clearly.',
  visibility: 'org',
  origin: 'member',
  ownerName: 'Ada',
  canEdit: true,
  labels: ['writing'],
  files: [{ path: 'SKILL.md', size: 32 }],
  etag: 'original',
  updatedAt: 1,
};
const savedBody = z.object({ description: z.string(), body: z.string() });
function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
let stored: Skill;
let writes: number;
let refused: boolean;
let detailGate: ReturnType<typeof deferred> | undefined;
let listGate: ReturnType<typeof deferred> | undefined;
let client: QueryClient;

beforeEach(() => {
  stored = structuredClone(initialSkill);
  writes = 0;
  refused = false;
  detailGate = undefined;
  listGate = undefined;
  toast.mockClear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://localhost');
      if (url.pathname === '/api/app/skills/house-voice') {
        if (init?.method === 'PUT') {
          writes++;
          if (refused)
            return Response.json(
              { error: 'SKILL_FORBIDDEN', message: 'Save refused' },
              { status: 403 },
            );
          if (typeof init.body !== 'string')
            throw new Error('Expected JSON body');
          const body = savedBody.parse(JSON.parse(init.body));
          if (
            body.description !== stored.description ||
            body.body !== stored.body
          ) {
            stored = { ...stored, ...body, etag: 'changed', updatedAt: 2 };
          }
          return Response.json({ skill: stored });
        }
        if (writes > 0) await detailGate?.promise;
        return Response.json({ skill: stored });
      }
      if (url.pathname === '/api/app/skills') {
        if (writes > 0) await listGate?.promise;
        return Response.json({
          skills: [stored],
          failures: [],
          publishing: { mode: 'everyone', allowed: true },
        });
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    }),
  );
});
afterEach(() => {
  client.clear();
  vi.unstubAllGlobals();
});
async function openEditor() {
  const view = render(
    <QueryClientProvider client={client}>
      <SkillsSettings organizationId="org1" />
    </QueryClientProvider>,
  );
  await view.user.click(
    await screen.findByRole('button', { name: 'house-voice' }),
  );
  await screen.findByRole('textbox', { name: /Instructions/ });
  return view;
}
function expectEditor(description: string, body: string) {
  expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue(
    description,
  );
  expect(screen.getByRole('textbox', { name: /Instructions/ })).toHaveValue(
    body,
  );
  expect(screen.getByRole('textbox', { name: 'Labels' })).toHaveValue(
    'writing',
  );
  expect(screen.getByRole('radio', { name: /Organization/ })).toBeChecked();
}
async function expectSaved(description: string, body: string) {
  await waitFor(() =>
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Skill saved', variant: 'success' }),
    ),
  );
  expectEditor(description, body);
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
}

describe('skill editor after saving (#3642)', () => {
  it('keeps every control and a clean Save after a normalized no-op with unchanged query data', async () => {
    const { user } = await openEditor();
    const before = client.getQueryData(
      configKeys.detail('skills', 'org1', 'house-voice'),
    );
    await user.type(screen.getByRole('textbox', { name: 'Description' }), ' ');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await expectSaved(initialSkill.description, initialSkill.body);
    expect(stored).toEqual(initialSkill);
    expect(
      client.getQueryData(configKeys.detail('skills', 'org1', 'house-voice')),
    ).toBe(before);
    expect(writes).toBe(1);
  });

  it.each(['detail first', 'library first'] as const)(
    'keeps the saved editor when refreshes finish %s',
    async (order) => {
      const { user } = await openEditor();
      detailGate = deferred();
      listGate = deferred();
      await user.type(
        screen.getByRole('textbox', { name: /Instructions/ }),
        ' Changed.',
      );
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(writes).toBe(1));
      const first = order === 'detail first' ? detailGate : listGate;
      const last = order === 'detail first' ? listGate : detailGate;
      await act(async () => first.resolve());
      const key =
        order === 'detail first'
          ? configKeys.detail('skills', 'org1', 'house-voice')
          : configKeys.list('skills', 'org1');
      await waitFor(() =>
        expect(client.getQueryState(key)?.fetchStatus).toBe('idle'),
      );
      expect(toast).not.toHaveBeenCalled();
      expectEditor(initialSkill.description, `${initialSkill.body} Changed.`);
      await act(async () => last.resolve());
      await expectSaved(
        initialSkill.description,
        `${initialSkill.body} Changed.`,
      );
      expect(stored.body).toBe(`${initialSkill.body} Changed.`);
      // The pane is usable for a second edit immediately, without reopening.
      await user.type(
        screen.getByRole('textbox', { name: /Instructions/ }),
        ' Again.',
      );
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    },
  );

  it('keeps the draft and persisted document when a save is refused', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { user } = await openEditor();
      refused = true;
      await user.type(
        screen.getByRole('textbox', { name: /Instructions/ }),
        ' Draft.',
      );
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() =>
        expect(toast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "Couldn't save skill",
            variant: 'destructive',
          }),
        ),
      );
      expectEditor(initialSkill.description, `${initialSkill.body} Draft.`);
      expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
      expect(stored).toEqual(initialSkill);
      expect(writes).toBe(1);
    } finally {
      log.mockRestore();
    }
  });

  it('reopens an untouched skill intact without a PUT', async () => {
    const { user } = await openEditor();
    expectEditor(initialSkill.description, initialSkill.body);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'house-voice' }));
    await screen.findByRole('textbox', { name: /Instructions/ });
    expectEditor(initialSkill.description, initialSkill.body);
    expect(writes).toBe(0);
  });
});
