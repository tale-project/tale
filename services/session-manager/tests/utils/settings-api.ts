import type { Meta, Settings } from '@/lib/api/schemas';
import { isRecord } from '@/lib/is-record';

import { failure, installFakeApi } from './fake-api';
import { meta as metaFixture, settings as settingsFixture } from './fixtures';

/** The address the server completes a bare host to, as the backend does. */
function completed(address: string): string {
  return /^https?:\/\//.test(address) ? address : `https://${address}`;
}

interface SettingsApiOptions {
  settings?: Settings;
  meta?: Meta;
}

/**
 * The settings and meta endpoints, answering as the backend does: a blank start
 * page is the default, a bare host is completed to `https://…`, and an address
 * with spaces in it is refused with `invalid_start_page`. The saved settings
 * are `server.settings`, so a test can change them behind the page's back.
 */
export function installSettingsApi(options: SettingsApiOptions = {}) {
  const server = {
    settings: options.settings ?? settingsFixture(),
    meta: options.meta ?? metaFixture(),
  };
  const api = installFakeApi({
    'GET /settings': () => server.settings,
    'GET /meta': () => server.meta,
    'PATCH /settings': ({ body }) => {
      if (!isRecord(body)) return failure(422, 'validation_error');
      if (typeof body.startPage === 'string') {
        const asked = body.startPage.trim();
        if (/\s/.test(asked)) return failure(422, 'invalid_start_page');
        server.settings = {
          ...server.settings,
          startPage:
            asked === '' ? server.settings.defaultStartPage : completed(asked),
        };
      }
      if (typeof body.mcpEnabled === 'boolean') {
        server.settings = { ...server.settings, mcpEnabled: body.mcpEnabled };
      }
      return server.settings;
    },
  });
  return { api, server };
}
