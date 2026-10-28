import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyBackend } from '@tale/shared/classify';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import {
  nextOutboundProxy,
  resetOutboundProxiesForTests,
} from '../../../lib/net/outbound-proxy';
import {
  buildAntiBotFlags,
  buildSpawnPath,
  classifyYtDlpStderr,
  compareYtdlpVersions,
  MAX_PROXY_RUNS,
  MIN_YTDLP_VERSION,
  cookiesFlagsFromEnv,
  ffmpegLocationFlags,
  impersonateFlagsFromEnv,
  pluginDirFlagsFromEnv,
  proxyFlagsFromEnv,
  sanitizeStderr,
  youtubeExtractorArgsFromEnv,
  proxyFailedRun,
  resetServingProxiesForTests,
  YtDlpError,
  ytdlpExtractAudio,
  ytdlpJson,
  ytdlpProxyFromEnv,
  YtdlpRoute,
  ytdlpVersionWarning,
  ytdlpWriteSubs,
} from './ytdlp';
import {
  BGUTIL_PLUGIN_NEST_DIR,
  bgutilPluginInstallDir,
} from './ytdlp_toolchain';

describe('classifyYtDlpStderr', () => {
  it('classifies the YouTube bot wall', () => {
    expect(
      classifyYtDlpStderr(
        "ERROR: [youtube] xyz: Sign in to confirm you're not a bot",
      ),
    ).toBe('botDetection');
    expect(
      classifyYtDlpStderr('Please confirm you’re not a bot to continue'),
    ).toBe('botDetection');
  });

  it('classifies rate limiting and forbidden separately', () => {
    expect(classifyYtDlpStderr('HTTP Error 429: Too Many Requests')).toBe(
      'rateLimited',
    );
    expect(classifyYtDlpStderr('HTTP Error 403: Forbidden')).toBe('forbidden');
  });

  it('classifies common terminal states', () => {
    expect(classifyYtDlpStderr('ERROR: Private video')).toBe(
      'privateOrAgeGated',
    );
    expect(classifyYtDlpStderr('Video unavailable')).toBe('unavailable');
    expect(classifyYtDlpStderr('ERROR: Unsupported URL: https://x')).toBe(
      'unsupported',
    );
  });

  it('classifies geo-blocks across yt-dlp phrasings', () => {
    // Verbatim stderr from a real CH/LI-restricted video: "not" and
    // "available" are non-contiguous here, which the old pattern missed.
    expect(
      classifyYtDlpStderr(
        'ERROR: [youtube] h7LDFVd8DSk: The uploader has not made this video available in your country\n' +
          'This video is available in Switzerland, Liechtenstein.\n' +
          'You might want to use a VPN or a proxy server (with --proxy) to workaround.\n',
      ),
    ).toBe('geoblocked');
    expect(
      classifyYtDlpStderr('ERROR: This video is not available in your country'),
    ).toBe('geoblocked');
    expect(
      classifyYtDlpStderr('The video is not available in your region'),
    ).toBe('geoblocked');
  });

  // Verbatim stderr captured on 2026-09-08 against yt-dlp 2026.03.17 /
  // 2026.07.04 / 2026.08.19. Every one of these used to fall through to
  // `transient`, so each cost the full [30s, 60s, 120s] ladder and told the
  // user "Temporary issue — try again" about a wall that never moves.
  it('classifies a platform login wall as terminal, not transient', () => {
    expect(
      classifyYtDlpStderr(
        'ERROR: [vimeo] 1206142064: Failed to fetch macos OAuth token: HTTP Error 401: Unauthorized (caused by <HTTPError 401: Unauthorized>)',
      ),
    ).toBe('authRequired');
    expect(
      classifyYtDlpStderr(
        'ERROR: [vimeo] 1206142064: The web client only works when logged-in. Use --cookies, --cookies-from-browser, --username and --password, --netrc-cmd, or --netrc (vimeo) to provide account credentials.',
      ),
    ).toBe('authRequired');
    expect(
      classifyYtDlpStderr(
        'ERROR: [vimeo] 1206142064: The android client is unable to fetch new OAuth tokens and is only intended for use with previously cached tokens',
      ),
    ).toBe('authRequired');
  });

  it('keeps the bot wall ahead of the login wall', () => {
    // "Sign in to confirm you're not a bot" is an auth-shaped sentence about
    // a bot challenge. It must stay `botDetection` — that reason drives the
    // pooled-session 'blocked' report, which `authRequired` must not.
    expect(
      classifyYtDlpStderr(
        "ERROR: [youtube] xyz: Sign in to confirm you're not a bot. HTTP Error 401: Unauthorized",
      ),
    ).toBe('botDetection');
  });

  it("classifies Bilibili's bare 412 risk control as a block", () => {
    expect(
      classifyYtDlpStderr(
        'ERROR: [BiliBili] 18M7k6UE7d: Unable to download JSON metadata: HTTP Error 412: Precondition Failed (caused by <HTTPError 412: Precondition Failed>)',
      ),
    ).toBe('botDetection');
  });

  it('classifies a 404 as a gone video, but leaves toolchain faults alone', () => {
    expect(
      classifyYtDlpStderr(
        'ERROR: [vimeo] 999999999999: Unable to download webpage: HTTP Error 404: Not Found (caused by <HTTPError 404: Not Found>)',
      ),
    ).toBe('unavailable');
    // A bare "not found" is ours to fix, not a gone video — it must NOT
    // borrow the terminal reason and hide a broken image from the operator.
    expect(classifyYtDlpStderr('ERROR: ffmpeg not found')).toBe('transient');
  });

  it('reads a 429 in the video ID as nothing', () => {
    expect(
      classifyYtDlpStderr(
        'ERROR: [vimeo] 1042987654: The web client only works when logged-in. Use --cookies, --cookies-from-browser, --username and --password, --netrc-cmd, or --netrc (vimeo) to provide account credentials.',
      ),
    ).toBe('authRequired');
    expect(
      classifyYtDlpStderr('ERROR: [youtube] x429yz0AbCd: Private video'),
    ).toBe('privateOrAgeGated');
  });

  it('falls back to transient for anything unrecognized', () => {
    expect(classifyYtDlpStderr('some unexpected network blip')).toBe(
      'transient',
    );
  });
});

describe('proxyFlagsFromEnv', () => {
  it('is empty when unset', () => {
    expect(proxyFlagsFromEnv({})).toEqual([]);
  });

  it('passes a valid socks5h proxy through', () => {
    const url = 'socks5h://user:pass@residential.example:1080';
    expect(proxyFlagsFromEnv({ VIDEO_INGEST_PROXY_URL: url })).toEqual([
      '--proxy',
      url,
    ]);
  });

  it('accepts http/https/socks schemes', () => {
    for (const url of [
      'http://p:1',
      'https://p:1',
      'socks4://p:1',
      'socks5://p:1',
    ]) {
      expect(proxyFlagsFromEnv({ VIDEO_INGEST_PROXY_URL: url })).toEqual([
        '--proxy',
        url,
      ]);
    }
  });

  it('rejects unsupported schemes and garbage (logged, not thrown)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(proxyFlagsFromEnv({ VIDEO_INGEST_PROXY_URL: 'ftp://p:1' })).toEqual(
      [],
    );
    expect(proxyFlagsFromEnv({ VIDEO_INGEST_PROXY_URL: 'not a url' })).toEqual(
      [],
    );
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('ytdlpProxyFromEnv and the outbound proxies', () => {
  const POOL = {
    OUTBOUND_PROXY_URLS: 'http://u:p@a.example:8080, http://b.example:3128',
  };

  afterEach(() => {
    resetOutboundProxiesForTests();
    vi.restoreAllMocks();
  });

  it('takes the next outbound proxy for each run when VIDEO_INGEST_PROXY_URL is unset', () => {
    expect(proxyFlagsFromEnv(POOL)).toEqual([
      '--proxy',
      'http://u:p@a.example:8080',
    ]);
    expect(proxyFlagsFromEnv(POOL)).toEqual([
      '--proxy',
      'http://b.example:3128',
    ]);
  });

  it('lets VIDEO_INGEST_PROXY_URL take video ingestion out of the rotation', () => {
    const override = 'socks5h://user:pass@residential.example:1080';
    expect(
      ytdlpProxyFromEnv({ ...POOL, VIDEO_INGEST_PROXY_URL: override }),
    ).toEqual({ url: override, pooled: null });
    // The rotation did not move for it.
    expect(nextOutboundProxy(POOL)?.label).toBe('http://a.example:8080');
  });

  it('reads an invalid VIDEO_INGEST_PROXY_URL as absent, so the rotation carries the run', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(
      ytdlpProxyFromEnv({ ...POOL, VIDEO_INGEST_PROXY_URL: 'not a url' })?.url,
    ).toBe('http://u:p@a.example:8080');
  });

  it('runs without a proxy when neither is set', () => {
    expect(ytdlpProxyFromEnv({})).toBeNull();
    expect(buildAntiBotFlags({})).not.toContain('--proxy');
  });
});

describe('proxyFailedRun', () => {
  it.each([
    "ERROR: Unable to download API page: ('Unable to connect to proxy', ConnectionRefusedError(111, 'Connection refused'))",
    "ERROR: ('Unable to connect to proxy', OSError('Tunnel connection failed: 407 Proxy Authentication Required'))",
    'curl: (56) CONNECT tunnel failed, response 407',
    'curl: (5) Could not resolve proxy: p.example',
  ])('holds the proxy to blame for %j', (stderr) => {
    expect(proxyFailedRun(stderr)).toBe(true);
  });

  it.each([
    "ERROR: ('Unable to connect to proxy', OSError('Tunnel connection failed: 502 Bad Gateway'))",
    'curl: (56) CONNECT tunnel failed, response 403',
    'ERROR: [youtube] x: Sign in to confirm you are not a bot',
    'ERROR: HTTP Error 407: Proxy Authentication Required',
    'ERROR: [generic] Unable to extract title: the page says unable to connect to proxy',
  ])('does not for %j', (stderr) => {
    expect(proxyFailedRun(stderr)).toBe(false);
  });
});

describe('a video through the outbound proxies [VID-R7]', () => {
  // A stand-in yt-dlp on VIDEO_INGEST_BIN_DIR: it answers the version and
  // help probes, then adds the `--proxy` of each run to `proxies` in its HOME
  // (the job dir — the spawn env carries nothing else). A host listed in
  // `refused` fails the way yt-dlp does when its proxy refuses the
  // connection, one listed in `walled` meets YouTube's bot check, and a
  // private video fails through any proxy; otherwise it prints the metadata.
  const root = mkdtempSync(join(tmpdir(), 'tale-ytdlp-proxy-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'yt-dlp'),
    [
      '#!/bin/sh',
      'case "$1" in --help) exit 0 ;; --version) echo 2099.01.01; exit 0 ;; esac',
      'proxy=direct; prev=',
      'for arg in "$@"; do [ "$prev" = --proxy ] && proxy=$arg; prev=$arg; done',
      'echo "$proxy" >> "$HOME/proxies"',
      'printf "%s\\n" "$@" > "$HOME/args"',
      'host=${proxy##*@}; host=${host#http://}; host=${host%%:*}',
      'case "$*" in *v=private*)',
      `  echo "ERROR: [youtube] private: Private video. Sign in if you've been granted access to this video" >&2`,
      '  exit 1 ;;',
      'esac',
      `if grep -qx "$host" "${root}/refused" 2>/dev/null; then`,
      `  echo "ERROR: [youtube] x: Unable to download API page: ('Unable to connect to proxy', ConnectionRefusedError(111, 'Connection refused'))" >&2`,
      '  exit 1',
      'fi',
      `if grep -qx "$host" "${root}/walled" 2>/dev/null; then`,
      `  echo "ERROR: [youtube] x: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication." >&2`,
      '  exit 1',
      'fi',
      `echo '{"id": "x"}'`,
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const saved = {
    bin: process.env.VIDEO_INGEST_BIN_DIR,
    pool: process.env.OUTBOUND_PROXY_URLS,
    override: process.env.VIDEO_INGEST_PROXY_URL,
  };

  afterEach(() => {
    for (const [name, value] of [
      ['VIDEO_INGEST_BIN_DIR', saved.bin],
      ['OUTBOUND_PROXY_URLS', saved.pool],
      ['VIDEO_INGEST_PROXY_URL', saved.override],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(join(root, 'refused'), { force: true });
    rmSync(join(root, 'walled'), { force: true });
    resetOutboundProxiesForTests();
    resetServingProxiesForTests();
    vi.restoreAllMocks();
  });

  /** Proxies from `urls`, the hosts in `walled` meeting the bot check and
   * those in `refused` refusing the connection. */
  function deployment(
    urls: string,
    { walled = [], refused = [] }: { walled?: string[]; refused?: string[] },
  ): void {
    process.env.VIDEO_INGEST_BIN_DIR = bin;
    process.env.OUTBOUND_PROXY_URLS = urls;
    delete process.env.VIDEO_INGEST_PROXY_URL;
    writeFileSync(join(root, 'walled'), walled.map((h) => `${h}\n`).join(''));
    writeFileSync(join(root, 'refused'), refused.map((h) => `${h}\n`).join(''));
    resetOutboundProxiesForTests();
    resetServingProxiesForTests();
  }

  /** A video's metadata through `route`: how the call ended, and the
   * `--proxy` of every run it made. */
  async function metadata(
    route?: YtdlpRoute,
    url = 'https://www.youtube.com/watch?v=x',
  ): Promise<{ outcome: string; proxies: string[] }> {
    const jobDir = mkdtempSync(join(root, 'job-'));
    const outcome = await ytdlpJson(url, jobDir, 10_000, undefined, route).then(
      () => 'served',
      (error: unknown) =>
        error instanceof YtDlpError ? error.reason : String(error),
    );
    return { outcome, proxies: runProxies(jobDir) };
  }

  function runProxies(jobDir: string): string[] {
    const path = join(jobDir, 'proxies');
    return existsSync(path)
      ? readFileSync(path, 'utf8').trim().split('\n')
      : [];
  }

  function warnings(warn: { mock: { calls: unknown[][] } }): string {
    return warn.mock.calls.map((call) => String(call[0])).join('\n');
  }

  it('keeps a video on one proxy, and moves it on when the platform turns a run away', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    deployment(
      'http://u:p@a.example:8080, http://b.example:3128, http://c.example:3128',
      { walled: ['a.example'] },
    );
    const route = YtdlpRoute.forVideo();
    const jobDir = mkdtempSync(join(root, 'job-'));

    await expect(
      ytdlpJson(
        'https://www.youtube.com/watch?v=x',
        jobDir,
        10_000,
        undefined,
        route,
      ),
    ).resolves.toEqual({ id: 'x' });
    // The captions and the sound go through the proxy that served the
    // metadata; the stand-in writes neither file, which is not an address's
    // failure and moves nothing.
    await expect(
      ytdlpWriteSubs('https://www.youtube.com/watch?v=x', 'en', jobDir, {
        route,
        timeoutMs: 10_000,
      }),
    ).resolves.toBeNull();
    await expect(
      ytdlpExtractAudio(
        'https://www.youtube.com/watch?v=x',
        jobDir,
        10_000,
        undefined,
        route,
      ),
    ).rejects.toMatchObject({ reason: 'outputValidationFailed' });

    expect(runProxies(jobDir)).toEqual([
      'http://u:p@a.example:8080',
      'http://b.example:3128',
      'http://b.example:3128',
      'http://b.example:3128',
    ]);
    expect(warnings(warn)).toContain(
      '[ytdlp] outbound proxy entry 1 (http://a.example:8080) failed (botDetection); the video goes on through entry 2 (http://b.example:3128)',
    );
    expect(warnings(warn)).not.toContain('u:p@');
  });

  it('starts the next video on the proxy the platform last served, until it turns that one away', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    deployment(
      'http://a.example:3128, http://b.example:3128, http://c.example:3128',
      {},
    );
    expect(await metadata(YtdlpRoute.forVideo())).toEqual({
      outcome: 'served',
      proxies: ['http://a.example:3128'],
    });
    // Other requests to websites go on in turn…
    expect(nextOutboundProxy()?.label).toBe('http://b.example:3128');
    // …while the next video starts where the last one was served.
    expect(await metadata(YtdlpRoute.forVideo())).toEqual({
      outcome: 'served',
      proxies: ['http://a.example:3128'],
    });

    writeFileSync(join(root, 'walled'), 'a.example\n');
    expect(await metadata(YtdlpRoute.forVideo())).toEqual({
      outcome: 'served',
      proxies: ['http://a.example:3128', 'http://c.example:3128'],
    });
    expect(await metadata(YtdlpRoute.forVideo())).toEqual({
      outcome: 'served',
      proxies: ['http://c.example:3128'],
    });
  });

  it('passes over a proxy that cannot carry a run, and the run goes on through the next', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    deployment('http://u:p@a.example:8080, http://b.example:3128', {
      refused: ['a.example'],
    });
    expect(await metadata()).toEqual({
      outcome: 'served',
      proxies: ['http://u:p@a.example:8080', 'http://b.example:3128'],
    });
    // a.example's turn, but it is passed over for its minute.
    expect(nextOutboundProxy()?.label).toBe('http://b.example:3128');
    expect(warnings(warn)).toContain('http://a.example:8080 failed');
    expect(warnings(warn)).not.toContain('u:p@');
  });

  it("does not run again for the video's own answer", async () => {
    deployment('http://a.example:3128, http://b.example:3128', {});
    expect(
      await metadata(undefined, 'https://www.youtube.com/watch?v=private'),
    ).toEqual({
      outcome: 'privateOrAgeGated',
      proxies: ['http://a.example:3128'],
    });
  });

  it('does not run again through a lone proxy or VIDEO_INGEST_PROXY_URL', async () => {
    deployment('http://a.example:3128', { walled: ['a.example', 'v.example'] });
    expect(await metadata()).toEqual({
      outcome: 'botDetection',
      proxies: ['http://a.example:3128'],
    });

    process.env.OUTBOUND_PROXY_URLS =
      'http://b.example:3128, http://c.example:3128';
    process.env.VIDEO_INGEST_PROXY_URL = 'http://v.example:3128';
    expect(await metadata()).toEqual({
      outcome: 'botDetection',
      proxies: ['http://v.example:3128'],
    });
  });

  it(`stops after ${MAX_PROXY_RUNS} runs`, async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const hosts = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(
      (name) => `${name}.example`,
    );
    deployment(hosts.map((host) => `http://${host}:3128`).join(', '), {
      walled: hosts,
    });
    expect(await metadata()).toEqual({
      outcome: 'botDetection',
      proxies: hosts
        .slice(0, MAX_PROXY_RUNS)
        .map((host) => `http://${host}:3128`),
    });
  });

  it('moves a video only to a proxy that has not failed it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    deployment('http://a.example:3128, http://b.example:3128', {
      walled: ['a.example', 'b.example'],
    });
    const route = YtdlpRoute.forVideo();
    expect(await metadata(route)).toEqual({
      outcome: 'botDetection',
      proxies: ['http://a.example:3128', 'http://b.example:3128'],
    });
    // Another call for the video stays where the route is: a.example has
    // failed it too, so there is no proxy left to move to.
    expect(await metadata(route)).toEqual({
      outcome: 'botDetection',
      proxies: ['http://b.example:3128'],
    });
  });

  it('takes a proxy listed twice once per video', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    deployment(
      'http://a.example:3128, http://a.example:3128, http://b.example:3128',
      { walled: ['a.example'] },
    );
    expect(await metadata(YtdlpRoute.forVideo())).toEqual({
      outcome: 'served',
      proxies: ['http://a.example:3128', 'http://b.example:3128'],
    });
  });

  it("keeps each platform's serving proxy to itself", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    deployment(
      'http://a.example:3128, http://b.example:3128, http://c.example:3128',
      {},
    );
    expect(await metadata(YtdlpRoute.forVideo('youtube'))).toEqual({
      outcome: 'served',
      proxies: ['http://a.example:3128'],
    });
    // Vimeo starts in turn, not where YouTube was served…
    expect(await metadata(YtdlpRoute.forVideo('vimeo'))).toEqual({
      outcome: 'served',
      proxies: ['http://b.example:3128'],
    });
    // …and Vimeo turning that address away leaves YouTube's start alone.
    writeFileSync(join(root, 'walled'), 'b.example\n');
    await metadata(YtdlpRoute.forVideo('vimeo'));
    expect(YtdlpRoute.forVideo('youtube').proxy?.url).toBe(
      'http://a.example:3128',
    );
  });

  it('no longer starts videos on a serving proxy the platform turned away', async () => {
    deployment(
      'http://a.example:3128, http://b.example:3128, http://c.example:3128',
      {},
    );
    expect((await metadata(YtdlpRoute.forVideo())).proxies).toEqual([
      'http://a.example:3128',
    ]);
    writeFileSync(join(root, 'walled'), 'a.example\n');
    const route = YtdlpRoute.forVideo();
    expect(route.proxy?.url).toBe('http://a.example:3128');
    // The window is spent after the first run, so the call ends on a.
    let reads = 0;
    vi.spyOn(Date, 'now').mockImplementation(() =>
      reads++ === 0 ? 1_000 : 601_000,
    );
    expect(await metadata(route)).toEqual({
      outcome: 'botDetection',
      proxies: ['http://a.example:3128'],
    });
    vi.restoreAllMocks();
    expect(YtdlpRoute.forVideo().proxy?.url).toBe('http://b.example:3128');
  });

  it("opens each step's window once, and starts a step off a proxy that failed the video", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    deployment(
      'http://a.example:3128, http://b.example:3128, http://c.example:3128',
      { walled: ['a.example', 'b.example'] },
    );
    const route = YtdlpRoute.forVideo();
    // The step opens at 1 s; by its first failed run the clock reads 101 s.
    vi.spyOn(Date, 'now').mockReturnValueOnce(1_000).mockReturnValue(101_000);
    expect(await metadata(route)).toEqual({
      outcome: 'botDetection',
      proxies: ['http://a.example:3128'],
    });
    // A second call of the same step (the Vimeo embed fallback) leaves the
    // failed proxy but gets no further run.
    expect(await metadata(route)).toEqual({
      outcome: 'botDetection',
      proxies: ['http://b.example:3128'],
    });
    route.nextStep();
    expect(await metadata(route)).toEqual({
      outcome: 'served',
      proxies: ['http://c.example:3128'],
    });
    expect(warnings(warn)).toContain(
      'entry 1 (http://a.example:3128) failed this video earlier; the video goes on through entry 2 (http://b.example:3128)',
    );
  });

  it('starts every download over when a run goes again', async () => {
    deployment('http://a.example:3128', {});
    const jobDir = mkdtempSync(join(root, 'job-'));
    await ytdlpJson('https://www.youtube.com/watch?v=x', jobDir, 10_000);
    expect(readFileSync(join(jobDir, 'args'), 'utf8').split('\n')).toContain(
      '--no-continue',
    );
  });

  it('starts no further run once the step has spent its window', async () => {
    deployment('http://a.example:3128, http://b.example:3128', {
      walled: ['a.example'],
    });
    const route = YtdlpRoute.forVideo();
    // The call starts at 1 s; by the time the first run has failed, the
    // clock reads ten minutes later.
    let reads = 0;
    vi.spyOn(Date, 'now').mockImplementation(() =>
      reads++ === 0 ? 1_000 : 601_000,
    );
    expect(await metadata(route)).toEqual({
      outcome: 'botDetection',
      proxies: ['http://a.example:3128'],
    });
  });
});

describe('youtubeExtractorArgsFromEnv', () => {
  it('uses the resilient default player-client list', () => {
    expect(youtubeExtractorArgsFromEnv({})).toEqual([
      '--extractor-args',
      'youtube:player_client=default,tv_simply',
    ]);
  });

  it('honours a player-client override', () => {
    expect(
      youtubeExtractorArgsFromEnv({
        VIDEO_INGEST_PLAYER_CLIENT: 'default,mweb',
      }),
    ).toEqual(['--extractor-args', 'youtube:player_client=default,mweb']);
  });

  it('appends a manually supplied PO token to the youtube arg', () => {
    expect(
      youtubeExtractorArgsFromEnv({ VIDEO_INGEST_PO_TOKEN: 'mweb.gvs+TOK' }),
    ).toEqual([
      '--extractor-args',
      'youtube:player_client=default,tv_simply;po_token=mweb.gvs+TOK',
    ]);
  });

  it('adds a separate extractor-arg for the PO token provider', () => {
    const flags = youtubeExtractorArgsFromEnv({
      VIDEO_INGEST_POT_PROVIDER_URL: 'http://127.0.0.1:4416',
    });
    expect(flags).toContain(
      'youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416',
    );
    // Provider present → widen the client list to include mweb (PO-Token
    // Guide) and force PLAYER-context token fetches (auto never asks for one).
    expect(flags).toContain(
      'youtube:player_client=default,mweb,tv_simply;fetch_pot=always',
    );
  });

  it('ignores an invalid provider URL', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const flags = youtubeExtractorArgsFromEnv({
      VIDEO_INGEST_POT_PROVIDER_URL: 'nonsense',
    });
    expect(flags.join(' ')).not.toContain('bgutil');
    warn.mockRestore();
  });

  it('defaults the provider URL to the compose sidecar when the plugin is baked in', () => {
    // hasBakedPlugin=true simulates the self-hosted image where the bgutil
    // plugin dir exists; no operator env is needed.
    const flags = youtubeExtractorArgsFromEnv({}, undefined, true);
    expect(flags).toContain(
      'youtubepot-bgutilhttp:base_url=http://bgutil-provider:4416',
    );
    expect(flags).toContain(
      'youtube:player_client=default,mweb,tv_simply;fetch_pot=always',
    );
  });

  it('does not emit fetch_pot without a provider', () => {
    const flags = youtubeExtractorArgsFromEnv({}, undefined, false);
    expect(flags.join(' ')).not.toContain('fetch_pot');
  });

  it('honours a VIDEO_INGEST_FETCH_POT override', () => {
    const flags = youtubeExtractorArgsFromEnv(
      { VIDEO_INGEST_FETCH_POT: 'never' },
      undefined,
      true,
    );
    expect(flags).toContain(
      'youtube:player_client=default,mweb,tv_simply;fetch_pot=never',
    );
    // An explicit value applies even without a provider (e.g. an operator
    // running a plugin from VIDEO_INGEST_YTDLP_PLUGIN_DIRS only).
    const noProvider = youtubeExtractorArgsFromEnv(
      { VIDEO_INGEST_FETCH_POT: 'always' },
      undefined,
      false,
    );
    expect(noProvider).toContain(
      'youtube:player_client=default,tv_simply;fetch_pot=always',
    );
  });

  it('ignores an invalid VIDEO_INGEST_FETCH_POT (logged, not thrown)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const flags = youtubeExtractorArgsFromEnv(
      { VIDEO_INGEST_FETCH_POT: 'sometimes' },
      undefined,
      true,
    );
    expect(flags).toContain(
      'youtube:player_client=default,mweb,tv_simply;fetch_pot=always',
    );
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not default the provider URL without the baked plugin', () => {
    const flags = youtubeExtractorArgsFromEnv({}, undefined, false);
    expect(flags.join(' ')).not.toContain('bgutil');
  });

  it('lets an explicit provider URL override the baked default', () => {
    const flags = youtubeExtractorArgsFromEnv(
      { VIDEO_INGEST_POT_PROVIDER_URL: 'http://custom:9999' },
      undefined,
      true,
    );
    expect(flags).toContain(
      'youtubepot-bgutilhttp:base_url=http://custom:9999',
    );
    expect(flags.join(' ')).not.toContain('bgutil-provider');
  });
});

describe('cookies / impersonate flags', () => {
  it('are empty by default and set when configured', () => {
    expect(cookiesFlagsFromEnv({})).toEqual([]);
    expect(
      cookiesFlagsFromEnv({ VIDEO_INGEST_COOKIES_FILE: '/secrets/yt.txt' }),
    ).toEqual(['--cookies', '/secrets/yt.txt']);
    expect(impersonateFlagsFromEnv({})).toEqual([]);
    expect(
      impersonateFlagsFromEnv({ VIDEO_INGEST_IMPERSONATE: 'safari' }),
    ).toEqual(['--impersonate', 'safari']);
  });
});

describe('buildAntiBotFlags', () => {
  it('always includes light request pacing and the youtube extractor arg', () => {
    const flags = buildAntiBotFlags({});
    expect(flags).toEqual(
      expect.arrayContaining([
        '--sleep-requests',
        '1',
        '--extractor-args',
        'youtube:player_client=default,tv_simply',
      ]),
    );
    // No proxy/cookies/impersonate on a default build.
    expect(flags).not.toContain('--proxy');
    expect(flags).not.toContain('--cookies');
    expect(flags).not.toContain('--impersonate');
  });

  it('composes every configured mitigation', () => {
    const flags = buildAntiBotFlags({
      VIDEO_INGEST_PROXY_URL: 'socks5h://p:1',
      VIDEO_INGEST_COOKIES_FILE: '/c.txt',
      VIDEO_INGEST_IMPERSONATE: 'chrome',
      VIDEO_INGEST_PLAYER_CLIENT: 'default,mweb',
    });
    expect(flags).toEqual(
      expect.arrayContaining([
        '--proxy',
        'socks5h://p:1',
        '--cookies',
        '/c.txt',
        '--impersonate',
        'chrome',
        'youtube:player_client=default,mweb',
      ]),
    );
  });
});

describe('sanitizeStderr', () => {
  it('redacts inline proxy credentials in any scheme', () => {
    const out = sanitizeStderr(
      'ERROR: Unable to connect to proxy socks5h://alice:s3cret@host:1080',
    );
    expect(out).not.toContain('s3cret');
    expect(out).not.toContain('alice');
  });

  it('redacts PO tokens and cookie flags', () => {
    expect(sanitizeStderr('debug po_token=ABC123DEF')).not.toContain(
      'ABC123DEF',
    );
    expect(sanitizeStderr('cmd --cookies /secrets/jar.txt')).toContain(
      '--cookies <redacted>',
    );
  });
});

describe('pooled session support', () => {
  it("prefers a session's cookie jar over the env path", () => {
    const flags = cookiesFlagsFromEnv(
      { VIDEO_INGEST_COOKIES_FILE: '/env/jar.txt' },
      { cookiesFile: '/job/cookies.txt' },
    );
    expect(flags).toEqual(['--cookies', '/job/cookies.txt']);
  });

  it("threads a session's visitor_data + po_token into the youtube arg", () => {
    const flags = youtubeExtractorArgsFromEnv(
      {},
      { visitorData: 'VD123', poToken: 'mweb.gvs+TOK' },
    );
    expect(flags).toContain(
      'youtube:player_client=default,tv_simply;po_token=mweb.gvs+TOK;visitor_data=VD123',
    );
  });

  it('composes the full anti-bot flag set with a session', () => {
    const flags = buildAntiBotFlags(
      { VIDEO_INGEST_PROXY_URL: 'socks5h://p:1' },
      { cookiesFile: '/job/c.txt', visitorData: 'VD' },
    );
    expect(flags).toEqual(
      expect.arrayContaining([
        '--proxy',
        'socks5h://p:1',
        '--cookies',
        '/job/c.txt',
        'youtube:player_client=default,tv_simply;visitor_data=VD',
      ]),
    );
  });
});

describe('pluginDirFlagsFromEnv', () => {
  it('is empty by default and set when configured', () => {
    expect(pluginDirFlagsFromEnv({})).toEqual([]);
    expect(
      pluginDirFlagsFromEnv({
        VIDEO_INGEST_YTDLP_PLUGIN_DIRS: '/etc/yt-dlp/plugins',
      }),
    ).toEqual(['--plugin-dirs', '/etc/yt-dlp/plugins']);
  });

  it('falls back to the baked plugin dir when it exists', () => {
    expect(pluginDirFlagsFromEnv({}, true)).toEqual([
      '--plugin-dirs',
      '/opt/yt-dlp/plugins',
    ]);
  });

  it('prefers an explicit env dir over the baked default', () => {
    expect(
      pluginDirFlagsFromEnv({ VIDEO_INGEST_YTDLP_PLUGIN_DIRS: '/x' }, true),
    ).toEqual(['--plugin-dirs', '/x']);
  });
});

describe('bgutilPluginInstallDir', () => {
  // Guards the nesting contract that yt-dlp requires for --plugin-dirs:
  // the zip's yt_dlp_plugins/ must live under a named child, not the root.
  it('nests the bgutil package under a named child of the plugin-dirs root', () => {
    expect(BGUTIL_PLUGIN_NEST_DIR).toBe('bgutil');
    expect(bgutilPluginInstallDir('/opt/yt-dlp/plugins')).toBe(
      '/opt/yt-dlp/plugins/bgutil',
    );
  });
});

describe('buildSpawnPath', () => {
  it('pins the production PATH when unset', () => {
    expect(buildSpawnPath({})).toBe('/usr/local/bin:/usr/bin:/bin');
  });

  it('prepends VIDEO_INGEST_BIN_DIR when set', () => {
    expect(buildSpawnPath({ VIDEO_INGEST_BIN_DIR: '/cache/bin' })).toBe(
      '/cache/bin:/usr/local/bin:/usr/bin:/bin',
    );
  });

  it('ignores a blank override', () => {
    expect(buildSpawnPath({ VIDEO_INGEST_BIN_DIR: '   ' })).toBe(
      '/usr/local/bin:/usr/bin:/bin',
    );
  });
});

describe('ffmpegLocationFlags', () => {
  it('defaults to the baked /usr/bin/ffmpeg', () => {
    expect(ffmpegLocationFlags({})).toEqual([
      '--ffmpeg-location',
      '/usr/bin/ffmpeg',
    ]);
  });

  it('honours VIDEO_INGEST_FFMPEG_LOCATION', () => {
    expect(
      ffmpegLocationFlags({
        VIDEO_INGEST_FFMPEG_LOCATION: '/opt/homebrew/bin/ffmpeg',
      }),
    ).toEqual(['--ffmpeg-location', '/opt/homebrew/bin/ffmpeg']);
  });

  it('falls back to the default for a blank override', () => {
    expect(ffmpegLocationFlags({ VIDEO_INGEST_FFMPEG_LOCATION: '  ' })).toEqual(
      ['--ffmpeg-location', '/usr/bin/ffmpeg'],
    );
  });
});

describe('the yt-dlp version floor', () => {
  it('orders date-shaped versions, nightly suffix included', () => {
    expect(compareYtdlpVersions('2026.03.17', '2026.07.04')).toBeLessThan(0);
    expect(compareYtdlpVersions('2026.08.19', '2026.07.04')).toBeGreaterThan(0);
    expect(compareYtdlpVersions('2026.07.04', '2026.07.04')).toBe(0);
    // A same-day nightly is newer than the release it builds on.
    expect(
      compareYtdlpVersions('2026.07.04.232805', '2026.07.04'),
    ).toBeGreaterThan(0);
    // Zero-padding is cosmetic; the components are numbers.
    expect(compareYtdlpVersions('2026.7.4', '2026.07.04')).toBe(0);
  });

  it('emits the stale-binary warning where the dev loop will show it', () => {
    // `bun dev` pipes the backend through `classifyBackend`, which surfaces a
    // line only when it carries ERROR or WARN and drops everything else as
    // noise. This warning exists to be READ — if it classifies as noise, a
    // developer goes on reading a stale binary's failures as platform blocks,
    // which is the exact confusion it was added to prevent.
    const warning = ytdlpVersionWarning('2026.03.17');
    expect(classifyBackend(warning).kind).toBe('warn');
    // And it has to say what to do about it.
    expect(warning).toContain('2026.03.17');
    expect(warning).toContain(MIN_YTDLP_VERSION);
    expect(warning).toContain('VIDEO_INGEST_BIN_DIR');
  });

  it('never exceeds the version the image pins', () => {
    // The floor is what we warn a dev host about. If it ever rose above the
    // Dockerfile pin, the shipped image would warn about itself — and the
    // warning would stop meaning "your host is behind production".
    const dockerfile = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../../Dockerfile'),
      'utf8',
    );
    const pinned = /^ARG YTDLP_VERSION=(\S+)$/m.exec(dockerfile)?.[1];
    expect(pinned).toBeDefined();
    expect(
      compareYtdlpVersions(MIN_YTDLP_VERSION, pinned as string),
    ).toBeLessThanOrEqual(0);
  });
});
