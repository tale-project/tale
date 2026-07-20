import { describe, expect, it, vi } from 'vitest';

import {
  buildAntiBotFlags,
  buildSpawnPath,
  classifyYtDlpStderr,
  cookiesFlagsFromEnv,
  ffmpegLocationFlags,
  impersonateFlagsFromEnv,
  pluginDirFlagsFromEnv,
  proxyFlagsFromEnv,
  sanitizeStderr,
  youtubeExtractorArgsFromEnv,
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
