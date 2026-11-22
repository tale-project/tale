import { describe, expect, it } from 'vitest';

import {
  EXTERNAL_TOOLCHAINS_E2E_SKIP,
  EXTERNAL_TOOLCHAINS_STEP,
  externalToolchainsUnavailable,
  videoToolchainEnv,
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

// A deployment fetches a video in a sandbox session, whose image carries
// yt-dlp (tale-project/tale#4942). `bun dev` resolved the tools on this
// machine and fetches a video here.
describe('what the step adds to the environment the backend inherits', () => {
  const toolchain = {
    binDir: '/cache/bin',
    ffmpegLocation: '/usr/bin/ffmpeg',
    pluginDir: '/cache/plugins',
  };

  it('says where the tools are, and that a video is fetched on this machine', () => {
    expect(videoToolchainEnv({}, toolchain)).toEqual({
      VIDEO_INGEST_BIN_DIR: '/cache/bin',
      VIDEO_INGEST_FFMPEG_LOCATION: '/usr/bin/ffmpeg',
      VIDEO_INGEST_YTDLP_PLUGIN_DIRS: '/cache/plugins',
      VIDEO_INGEST_LANE: 'local',
    });
  });

  it('fills only what a developer has not set', () => {
    expect(
      videoToolchainEnv(
        {
          VIDEO_INGEST_FFMPEG_LOCATION: '/opt/homebrew/bin/ffmpeg',
          VIDEO_INGEST_YTDLP_PLUGIN_DIRS: '',
        },
        toolchain,
      ),
    ).toEqual({
      VIDEO_INGEST_BIN_DIR: '/cache/bin',
      // An empty value is none.
      VIDEO_INGEST_YTDLP_PLUGIN_DIRS: '/cache/plugins',
      VIDEO_INGEST_LANE: 'local',
    });
  });

  it("keeps the deployment's lane for a developer who asks for it", () => {
    expect(
      videoToolchainEnv({ VIDEO_INGEST_LANE: 'sandbox' }, toolchain),
    ).toEqual({
      VIDEO_INGEST_BIN_DIR: '/cache/bin',
      VIDEO_INGEST_FFMPEG_LOCATION: '/usr/bin/ffmpeg',
      VIDEO_INGEST_YTDLP_PLUGIN_DIRS: '/cache/plugins',
    });
  });

  it("adds the lane alone where the developer named the tools' places", () => {
    expect(
      videoToolchainEnv(
        {
          VIDEO_INGEST_BIN_DIR: '/home/dev/bin',
          VIDEO_INGEST_FFMPEG_LOCATION: '/usr/bin/ffmpeg',
        },
        null,
      ),
    ).toEqual({ VIDEO_INGEST_LANE: 'local' });
    expect(videoToolchainEnv({ VIDEO_INGEST_LANE: 'sandbox' }, null)).toEqual(
      {},
    );
  });
});
