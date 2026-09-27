import { describe, expect, it, vi } from 'vitest';

import { USER_NAME_MAX_LENGTH } from '../../../lib/shared/constants/user-name.ts';
import { updateUserName } from './service.ts';

/**
 * The account form refuses a display name past `USER_NAME_MAX_LENGTH` in the
 * field; the server holds the same bound, so the two can never disagree about
 * which name a save accepts.
 */
describe('updateUserName', () => {
  it('refuses a name one past the shared limit before writing anything', async () => {
    const sql = vi.fn();
    await expect(
      updateUserName(
        sql as never,
        'user-1',
        'x'.repeat(USER_NAME_MAX_LENGTH + 1),
      ),
    ).rejects.toMatchObject({ code: 'too_long', status: 400 });
    expect(sql).not.toHaveBeenCalled();
  });

  it('writes a name exactly at the limit, trimmed', async () => {
    const sql = vi.fn().mockResolvedValue([]);
    const longest = 'x'.repeat(USER_NAME_MAX_LENGTH);
    await updateUserName(sql as never, 'user-1', `  ${longest}  `);
    expect(sql).toHaveBeenCalledTimes(1);
    expect(sql.mock.calls[0]).toContain(longest);
  });
});
