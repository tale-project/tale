import { describe, expect, it } from 'vitest';

import {
  CLI_INSTALL_URL,
  connectCommand,
  installAndConnectCommand,
} from './device-command';

describe('device commands', () => {
  it('pins the CLI to the server release and connects only after a good install', () => {
    expect(
      installAndConnectCommand(
        'https://acme.tale.dev',
        'tsdj_0123abcd',
        '0.5.60',
      ),
    ).toBe(
      `curl -fsSL ${CLI_INSTALL_URL} | VERSION=0.5.60 bash && tale sandbox connect https://acme.tale.dev --token tsdj_0123abcd`,
    );
  });

  it('installs the latest CLI when the server runs a local build', () => {
    expect(
      installAndConnectCommand('http://localhost:3000', 'tsdj_x', 'dev'),
    ).toBe(
      `curl -fsSL ${CLI_INSTALL_URL} | bash && tale sandbox connect http://localhost:3000 --token tsdj_x`,
    );
  });

  it('quotes a site URL a shell would split', () => {
    expect(connectCommand("https://acme.example/t ale's", 'tsdj_x')).toBe(
      `tale sandbox connect 'https://acme.example/t ale'\\''s' --token tsdj_x`,
    );
  });
});
