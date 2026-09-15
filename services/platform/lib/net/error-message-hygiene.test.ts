import { describe, expect, it } from 'vitest';

import { stripRuntimeLocations } from './error-message-hygiene';

describe('stripRuntimeLocations', () => {
  it('drops the OpenSSL handle and the toolchain path from a TLS alert', () => {
    expect(
      stripRuntimeLocations(
        'C08C3904E37E0000:error:0A000410:SSL routines:ssl3_read_bytes:ssl/tls alert handshake failure:../deps/openssl/openssl/ssl/record/rec_layer_s3.c:916:SSL alert number 40',
      ),
    ).toBe(
      'SSL routines:ssl3_read_bytes:ssl/tls alert handshake failure:SSL alert number 40',
    );
  });

  it('leaves an ordinary message alone', () => {
    expect(
      stripRuntimeLocations(
        'Connection failed: other side closed (UND_ERR_SOCKET)',
      ),
    ).toBe('Connection failed: other side closed (UND_ERR_SOCKET)');
    expect(stripRuntimeLocations('  padded  ')).toBe('padded');
  });
});
