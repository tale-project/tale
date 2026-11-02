import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useSessionActions } from '@/app/features/sessions/hooks/use-session-actions';
import {
  answer,
  failure,
  installFakeApi,
  listFor,
} from '@/tests/utils/fake-api';
import { session } from '@/tests/utils/fixtures';
import { renderHookApp } from '@/tests/utils/render';
import { installSecretsApi } from '@/tests/utils/secrets-api';

import {
  SESSION_CHOICES_LIMIT,
  useSessionChoices,
} from './use-session-choices';

describe('useSessionChoices', () => {
  it('asks for as many sessions as one request returns', async () => {
    const { api } = installSecretsApi();
    renderHookApp(useSessionChoices);
    await waitFor(() => expect(api.callsTo('GET /sessions')).toHaveLength(1));
    expect(api.callsTo('GET /sessions')[0]?.query.get('limit')).toBe(
      String(SESSION_CHOICES_LIMIT),
    );
    expect(SESSION_CHOICES_LIMIT).toBe(500);
  });

  it('returns each session as its id and name, and how many there are in all', async () => {
    installFakeApi({
      'GET /sessions': ({ query }) =>
        listFor(
          query,
          [session({ id: 4, name: 'Shop' }), session({ id: 2, name: '0002' })],
          730,
        ),
    });
    const { result } = renderHookApp(useSessionChoices);
    await waitFor(() => expect(result.current.sessions).toHaveLength(2));
    expect(result.current.sessions).toEqual([
      { id: 4, name: 'Shop' },
      { id: 2, name: '0002' },
    ]);
    expect(result.current.total).toBe(730);
  });

  it('is pending, with no session, before the answer', () => {
    installFakeApi({ 'GET /sessions': () => new Promise(() => {}) });
    const { result } = renderHookApp(useSessionChoices);
    expect(result.current.isPending).toBe(true);
    expect(result.current.sessions).toEqual([]);
    expect(result.current.total).toBe(0);
  });

  it('has no session and says so when the sessions cannot be read', async () => {
    installFakeApi({ 'GET /sessions': failure(500, 'internal') });
    const { result } = renderHookApp(useSessionChoices);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.sessions).toEqual([]);
  });

  it('is read once for all the pickers that show it', async () => {
    const { api } = installSecretsApi();
    const { queryClient } = renderHookApp(() => {
      useSessionChoices();
      return useSessionChoices();
    });
    await waitFor(() => expect(api.callsTo('GET /sessions')).toHaveLength(1));
    expect(queryClient.isFetching()).toBeLessThanOrEqual(1);
  });
});

describe('the sessions it lists after a person changed one', () => {
  // The list is kept for 30 seconds so that a form opened again at once does
  // not ask again. A session added, renamed or deleted in that time must show.
  function useChoicesAndActions() {
    return { choices: useSessionChoices(), actions: useSessionActions() };
  }
  const names = (view: { current: ReturnType<typeof useChoicesAndActions> }) =>
    view.current.choices.sessions.map((entry) => entry.name);

  function server() {
    const state = {
      sessions: [
        session({ id: 2, name: 'Shop' }),
        session({ id: 1, name: '0001' }),
      ],
    };
    installFakeApi({
      'GET /sessions': ({ query }) => listFor(query, state.sessions),
      'POST /sessions': () => {
        const created = session({ id: 3, name: '0003' });
        state.sessions = [created, ...state.sessions];
        return answer({ status: 201, body: created });
      },
      'PATCH /sessions/:id': ({ params, body }) => {
        const name =
          typeof body === 'object' && body !== null && 'name' in body
            ? String(body.name)
            : '';
        state.sessions = state.sessions.map((entry) =>
          entry.id === Number(params.id) ? { ...entry, name } : entry,
        );
        return state.sessions.find((entry) => entry.id === Number(params.id));
      },
      'DELETE /sessions/:id': ({ params }) => {
        state.sessions = state.sessions.filter(
          (entry) => entry.id !== Number(params.id),
        );
        return answer({ status: 204 });
      },
    });
  }

  it('shows a session that was just added', async () => {
    server();
    const { result } = renderHookApp(useChoicesAndActions);
    await waitFor(() => expect(names(result)).toEqual(['Shop', '0001']));

    await act(() => result.current.actions.create.mutateAsync({}));

    await waitFor(() =>
      expect(names(result)).toEqual(['0003', 'Shop', '0001']),
    );
  });

  it('shows the new name of a session that was just renamed', async () => {
    server();
    const { result } = renderHookApp(useChoicesAndActions);
    await waitFor(() => expect(names(result)).toEqual(['Shop', '0001']));

    await act(() =>
      result.current.actions.rename.mutateAsync({ id: 2, name: 'Shop EU' }),
    );

    await waitFor(() => expect(names(result)).toEqual(['Shop EU', '0001']));
  });

  it('no longer shows a session that was just deleted', async () => {
    server();
    const { result } = renderHookApp(useChoicesAndActions);
    await waitFor(() => expect(names(result)).toEqual(['Shop', '0001']));

    await act(() => result.current.actions.remove.mutateAsync({ id: 2 }));

    await waitFor(() => expect(names(result)).toEqual(['0001']));
  });
});
