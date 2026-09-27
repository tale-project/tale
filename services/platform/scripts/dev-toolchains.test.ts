import { describe, expect, it } from 'vitest';

import {
  EXTERNAL_TOOLCHAINS_E2E_SKIP,
  EXTERNAL_TOOLCHAINS_STEP,
  externalToolchainsUnavailable,
} from './dev-toolchains';

// The step provisions host binaries the backend spawns (yt-dlp + deno +
// ffmpeg today); its lines name that general job, not one consumer of it, so
// a tool that is not about video can join the step without a relabel.
describe('the external toolchains step `bun dev` runs', () => {
  it('labels the step as external toolchains, not a video toolchain', () => {
    expect(EXTERNAL_TOOLCHAINS_STEP).toEqual({
      active: 'Provisioning external toolchains',
      done: 'External toolchains ready',
    });
  });

  it('names the same step on its skip and failure lines', () => {
    const lines = [
      EXTERNAL_TOOLCHAINS_E2E_SKIP,
      externalToolchainsUnavailable(new Error('offline')),
    ];
    for (const line of lines) {
      expect(line).toMatch(/external toolchain/i);
      expect(line).not.toMatch(/video toolchain/i);
    }
  });

  it('says why the E2E stack skips it', () => {
    expect(EXTERNAL_TOOLCHAINS_E2E_SKIP).toContain('TALE_E2E');
  });

  it('degrades with the consequence and the cause', () => {
    const message = externalToolchainsUnavailable(
      new Error('download failed (503)'),
    );
    expect(message).toContain('pasting a video link in chat');
    expect(message).toContain('Underlying: download failed (503)');
    expect(externalToolchainsUnavailable('boom')).toContain('Underlying: boom');
  });
});
