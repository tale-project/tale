// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const media = vi.hoisted(() => ({
  sizes: [] as number[],
  calls: [] as string[][],
  audio: null as { codec: string } | null,
  duration: 8000,
  frames: 192,
}));

vi.mock('../../../platform/tests/docs-videos/lib/ffmpeg', () => ({
  ffmpegBin: () => 'ffmpeg',
  runFfmpeg: async (_bin: string, args: string[]) => {
    media.calls.push(args);
    const destination = args.at(-1);
    if (!destination) throw new Error('Missing destination');
    writeFileSync(destination, Buffer.alloc(media.sizes.shift() ?? 2000, 7));
    return { code: 0, stdout: '', stderr: '' };
  },
  probeAudioStream: async () => media.audio,
  probeDurationMs: async () => media.duration,
  probeVideoStream: async (file: string) => ({
    codec: file.endsWith('.webm') ? 'vp9' : 'h264',
    width: 1280,
    height: 800,
    fps: 24,
    pixelFormat: 'yuv420p',
    frameCount: media.frames,
  }),
}));

import { encodeMotion, MOTION_BUDGETS, sha256 } from './encode';

let directory = '';
beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'tale-motion-encode-'));
  media.sizes = [];
  media.calls = [];
  media.audio = null;
  media.duration = 8000;
  media.frames = 192;
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

describe('bounded native motion encoding', () => {
  it.each(['webm', 'mp4'])(
    'keeps literal paths, silent browser codecs and exact CFR duration for %s',
    async (format) => {
      const playlist = path.join(directory, 'frames $(literal).txt');
      const output = path.join(directory, `native clip.${format}`);
      const result = await encodeMotion(
        playlist,
        output,
        { width: 1280, height: 800 },
        'desktop',
      );
      const args = media.calls[0]!;
      expect(args[args.indexOf('-i') + 1]).toBe(playlist);
      expect(args.at(-1)).toBe(output);
      expect(args).toContain('-an');
      expect(args[args.indexOf('-c:v') + 1]).toBe(
        format === 'webm' ? 'libvpx-vp9' : 'libx264',
      );
      expect(args[args.indexOf('-frames:v') + 1]).toBe('192');
      expect(args[args.indexOf('-fps_mode') + 1]).toBe('cfr');
      expect(args[args.indexOf('-vf') + 1]).toContain('tpad=stop_mode=clone');
      expect(result).toEqual({
        bytes: readFileSync(output).length,
        sha256: sha256(output),
        durationMs: 8000,
      });
    },
  );

  it('lowers quality only after a real encoded byte budget is exceeded', async () => {
    media.sizes = [MOTION_BUDGETS.desktop + 1, 4000];
    await encodeMotion(
      'frames.txt',
      path.join(directory, 'clip.webm'),
      { width: 1280, height: 800 },
      'desktop',
    );
    expect(media.calls.map((args) => args[args.indexOf('-crf') + 1])).toEqual([
      '24',
      '28',
    ]);
  });

  it('fails at the bounded quality floor without accepting an oversized clip', async () => {
    media.sizes = Array.from({ length: 4 }, () => MOTION_BUDGETS.mobile + 1);
    await expect(
      encodeMotion(
        'frames.txt',
        path.join(directory, 'clip.mp4'),
        { width: 1280, height: 800 },
        'mobile',
      ),
    ).rejects.toThrow('cannot fit');
    expect(media.calls).toHaveLength(4);
  });

  it('rejects the observed 191-frame shortfall instead of reporting a valid eight-second clip', async () => {
    media.frames = 191;
    await expect(
      encodeMotion(
        'frames.txt',
        path.join(directory, 'clip.mp4'),
        { width: 1280, height: 800 },
        'desktop',
      ),
    ).rejects.toThrow('incompatible video stream');
  });

  it('rejects accidental audio and a mistimed output', async () => {
    media.audio = { codec: 'aac' };
    await expect(
      encodeMotion(
        'frames.txt',
        path.join(directory, 'audio.mp4'),
        { width: 1280, height: 800 },
        'desktop',
      ),
    ).rejects.toThrow('must be silent');
    media.audio = null;
    media.duration = 7700;
    await expect(
      encodeMotion(
        'frames.txt',
        path.join(directory, 'short.mp4'),
        { width: 1280, height: 800 },
        'desktop',
      ),
    ).rejects.toThrow('unexpected duration');
  });
});
