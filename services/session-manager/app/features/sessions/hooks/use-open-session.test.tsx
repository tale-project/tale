import { waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { failure, installFakeApi } from '@/tests/utils/fake-api';
import { session } from '@/tests/utils/fixtures';
import { renderHookApp } from '@/tests/utils/render';

import { useOpenSessionOutsideRows, withOpenSession } from './use-open-session';

const rows = [session({ id: 9 }), session({ id: 8 }), session({ id: 7 })];

describe('useOpenSessionOutsideRows', () => {
  it('reads the open session when the rows lack it', async () => {
    const api = installFakeApi({
      'GET /sessions/:id': session({ id: 2, name: 'Old one' }),
    });
    const { result } = renderHookApp(() => useOpenSessionOutsideRows(2, rows));

    await waitFor(() => expect(result.current?.name).toBe('Old one'));
    expect(api.callsTo('GET /sessions/:id')[0]?.params.id).toBe('2');
  });

  it('asks for nothing when the rows hold it, or none is open', async () => {
    const api = installFakeApi({ 'GET /sessions/:id': session({ id: 8 }) });
    const held = renderHookApp(() => useOpenSessionOutsideRows(8, rows));
    const none = renderHookApp(() => useOpenSessionOutsideRows(null, rows));

    expect(held.result.current).toBeNull();
    expect(none.result.current).toBeNull();
    await Promise.resolve();
    expect(api.callsTo('GET /sessions/:id')).toHaveLength(0);
  });

  it('has nothing to show for a session that does not exist', async () => {
    const api = installFakeApi({
      'GET /sessions/:id': failure(404, 'session_not_found'),
    });
    const { result } = renderHookApp(() => useOpenSessionOutsideRows(2, rows));

    await waitFor(() =>
      expect(api.callsTo('GET /sessions/:id')).toHaveLength(1),
    );
    expect(result.current).toBeNull();
  });
});

describe('withOpenSession', () => {
  const ids = (shown: readonly { id: number }[]) => shown.map((row) => row.id);

  it('puts an older session after the rows, a newer one before them, and one in between where it belongs', () => {
    expect(ids(withOpenSession(rows, session({ id: 2 })))).toEqual([
      9, 8, 7, 2,
    ]);
    expect(ids(withOpenSession(rows, session({ id: 12 })))).toEqual([
      12, 9, 8, 7,
    ]);
    expect(ids(withOpenSession(rows, session({ id: 5 })))).toEqual([
      9, 8, 7, 5,
    ]);
    expect(
      ids(
        withOpenSession(
          [session({ id: 9 }), session({ id: 7 })],
          session({ id: 8 }),
        ),
      ),
    ).toEqual([9, 8, 7]);
  });

  it('leaves the rows as they are when none is open', () => {
    expect(withOpenSession(rows, null)).toBe(rows);
  });
});
