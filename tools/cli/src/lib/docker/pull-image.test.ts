import { afterEach, describe, expect, mock, test } from 'bun:test';

import { pullImage } from './pull-image';

const dockerMock = mock();

mock.module('./docker', () => ({
  docker: dockerMock,
}));

const errorSpy = mock();
const infoSpy = mock();

mock.module('../../utils/logger', () => ({
  info: infoSpy,
  error: errorSpy,
  debug: mock(),
}));

afterEach(() => {
  dockerMock.mockReset();
  errorSpy.mockReset();
  infoSpy.mockReset();
});

describe('pullImage', () => {
  test('returns true on successful pull', async () => {
    dockerMock.mockResolvedValue({ success: true, stdout: '', stderr: '' });

    const result = await pullImage(
      'ghcr.io/tale-project/tale/tale-crawler:0.2.16',
    );

    expect(result).toBe(true);
    expect(dockerMock).toHaveBeenCalledWith(
      'pull',
      'ghcr.io/tale-project/tale/tale-crawler:0.2.16',
    );
  });

  test('returns false on failed pull', async () => {
    dockerMock.mockResolvedValue({
      success: false,
      stdout: '',
      stderr: 'connection refused',
    });

    const result = await pullImage(
      'ghcr.io/tale-project/tale/tale-crawler:0.2.16',
    );

    expect(result).toBe(false);
  });

  test('shows timing hint when image is not found', async () => {
    dockerMock.mockResolvedValue({
      success: false,
      stdout: '',
      stderr:
        'Error response from daemon: manifest for ghcr.io/tale-project/tale/tale-crawler:0.2.16 not found',
    });

    await pullImage('ghcr.io/tale-project/tale/tale-crawler:0.2.16');

    const messages = errorSpy.mock.calls.map((c: string[]) => c[0]);
    expect(messages.some((m: string) => m.includes('still be building'))).toBe(
      true,
    );
  });

  test('shows timing hint for manifest unknown error', async () => {
    dockerMock.mockResolvedValue({
      success: false,
      stdout: '',
      stderr: 'manifest unknown: manifest unknown',
    });

    await pullImage('ghcr.io/example/image:1.0.0');

    const messages = errorSpy.mock.calls.map((c: string[]) => c[0]);
    expect(messages.some((m: string) => m.includes('still be building'))).toBe(
      true,
    );
  });

  test('shows timing hint for name unknown error', async () => {
    dockerMock.mockResolvedValue({
      success: false,
      stdout: '',
      stderr: 'name unknown: repository name not known to registry',
    });

    await pullImage('ghcr.io/example/image:1.0.0');

    const messages = errorSpy.mock.calls.map((c: string[]) => c[0]);
    expect(messages.some((m: string) => m.includes('still be building'))).toBe(
      true,
    );
  });

  test('shows raw stderr for non-not-found errors', async () => {
    dockerMock.mockResolvedValue({
      success: false,
      stdout: '',
      stderr: 'unauthorized: authentication required',
    });

    await pullImage('ghcr.io/example/image:1.0.0');

    const messages = errorSpy.mock.calls.map((c: string[]) => c[0]);
    expect(
      messages.some((m: string) => m.includes('authentication required')),
    ).toBe(true);
    expect(messages.some((m: string) => m.includes('still be building'))).toBe(
      false,
    );
  });

  test('returns false and logs error on exception', async () => {
    dockerMock.mockRejectedValue(new Error('Docker not installed'));

    const result = await pullImage('ghcr.io/example/image:1.0.0');

    expect(result).toBe(false);
    const messages = errorSpy.mock.calls.map((c: string[]) => c[0]);
    expect(
      messages.some((m: string) => m.includes('Docker not installed')),
    ).toBe(true);
  });
});
