import { afterEach, describe, expect, mock, test } from 'bun:test';

import { pullImage } from './pull-image';

const dockerMock = mock();

mock.module('./docker', () => ({
  docker: dockerMock,
}));

const loggerInfoMock = mock();
const loggerErrorMock = mock();
const loggerWarnMock = mock();

mock.module('../../utils/logger', () => ({
  info: loggerInfoMock,
  error: loggerErrorMock,
  warn: loggerWarnMock,
  debug: mock(),
}));

afterEach(() => {
  dockerMock.mockReset();
  loggerInfoMock.mockReset();
  loggerErrorMock.mockReset();
  loggerWarnMock.mockReset();
});

describe('pullImage', () => {
  test('returns true on successful pull', async () => {
    dockerMock.mockResolvedValue({ success: true, stdout: '', stderr: '' });

    const result = await pullImage(
      'ghcr.io/tale-project/tale/tale-platform:0.2.16',
    );

    expect(result).toBe(true);
    expect(dockerMock).toHaveBeenCalledWith(
      'pull',
      'ghcr.io/tale-project/tale/tale-platform:0.2.16',
    );
  });

  test('returns false and logs error on failed pull', async () => {
    dockerMock.mockResolvedValue({
      success: false,
      stdout: '',
      stderr: 'some docker error',
    });

    const result = await pullImage(
      'ghcr.io/tale-project/tale/tale-crawler:0.2.16',
    );

    expect(result).toBe(false);
    expect(loggerErrorMock).toHaveBeenCalled();
  });

  test('shows timing hint when manifest is not found', async () => {
    dockerMock.mockResolvedValue({
      success: false,
      stdout: '',
      stderr:
        'Error response from daemon: manifest for ghcr.io/tale-project/tale/tale-crawler:0.2.16 not found',
    });

    const result = await pullImage(
      'ghcr.io/tale-project/tale/tale-crawler:0.2.16',
    );

    expect(result).toBe(false);
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.stringContaining('images may still be building'),
    );
  });

  test('shows timing hint for manifest unknown error', async () => {
    dockerMock.mockResolvedValue({
      success: false,
      stdout: '',
      stderr: 'manifest unknown: manifest unknown',
    });

    const result = await pullImage('ghcr.io/tale-project/tale/tale-db:1.0.0');

    expect(result).toBe(false);
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.stringContaining('images may still be building'),
    );
  });

  test('shows raw stderr for non-manifest errors', async () => {
    dockerMock.mockResolvedValue({
      success: false,
      stdout: '',
      stderr: 'network timeout connecting to registry',
    });

    const result = await pullImage('ghcr.io/tale-project/tale/tale-rag:0.2.16');

    expect(result).toBe(false);
    expect(loggerWarnMock).not.toHaveBeenCalled();
    expect(loggerErrorMock).toHaveBeenCalledWith(
      'network timeout connecting to registry',
    );
  });

  test('handles thrown exceptions gracefully', async () => {
    dockerMock.mockRejectedValue(new Error('spawn failed'));

    const result = await pullImage(
      'ghcr.io/tale-project/tale/tale-proxy:0.2.16',
    );

    expect(result).toBe(false);
    expect(loggerErrorMock).toHaveBeenCalledWith('spawn failed');
  });
});
