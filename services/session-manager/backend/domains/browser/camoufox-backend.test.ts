import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FakeRemoteLifecycle,
  FakeSessionContext,
  Gate,
  NEW_YORK,
  fakeGeneratedIdentity,
  fakeIdentity,
  fakeLaunchSpec,
  fakeLocation,
} from '../../testing/fake-browser.ts';
import { settle, track } from '../../testing/promises.ts';
import { identityLaunchOptions } from '../identity/launch-options.ts';
import { GeoLookupError, IdentityError } from '../identity/types.ts';
import {
  CamoufoxBackend,
  LAUNCH_PREFS,
  createPlaywrightRemote,
  launchArgs,
  locationConfig,
  refreshGeoDatabase,
} from './camoufox-backend.ts';
import type {
  CamoufoxDeps,
  LaunchArgs,
  PlaywrightOptions,
  RemoteOptions,
} from './camoufox-backend.ts';
import type { SessionContext } from './camoufox-session.ts';
import { browserBuild } from './install.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/** What camoufox-js answers: its options for Playwright, with a copy of the environment. */
const CAMOUFOX_OPTIONS: PlaywrightOptions = {
  executablePath: '/fake/Camoufox.app/Contents/MacOS/camoufox',
  args: [],
  env: { CAMOU_CONFIG_1: '{}', SECRET_OF_THE_HOST: 'do not log' },
  firefoxUserPrefs: {},
  headless: true,
  // camoufox-js turns the URL of a proxy into its origin: "null" for socks5://.
  proxy: { server: 'null', username: '', password: '' },
};

interface Rig {
  backend: CamoufoxBackend;
  /** The camoufox-js arguments of each launch. */
  argsSeen: LaunchArgs[];
  /** The Playwright launches. */
  launched: { profileDir: string; options: PlaywrightOptions }[];
  contexts: FakeSessionContext[];
  remotes: FakeRemoteLifecycle[];
  remoteOptions: { context: SessionContext; options: RemoteOptions }[];
  directories: string[];
}

function rig(overrides: Partial<CamoufoxDeps> = {}, blockWebrtc = false): Rig {
  const result: Omit<Rig, 'backend'> = {
    argsSeen: [],
    launched: [],
    contexts: [],
    remotes: [],
    remoteOptions: [],
    directories: [],
  };
  const backend = new CamoufoxBackend({
    blockWebrtc,
    deps: {
      isInstalled: () => true,
      installBrowser: async () => null,
      warmUpGeo: async () => {},
      browserVersion: () => '1.2.3-beta.4',
      makeDirectory: async (path) => {
        result.directories.push(path);
      },
      launchOptions: async (args) => {
        result.argsSeen.push(args);
        return CAMOUFOX_OPTIONS;
      },
      launchPersistentContext: async (profileDir, options) => {
        result.launched.push({ profileDir, options });
        const context = new FakeSessionContext();
        result.contexts.push(context);
        return context;
      },
      createRemote: (context, options) => {
        const remote = new FakeRemoteLifecycle();
        result.remotes.push(remote);
        result.remoteOptions.push({ context, options });
        return remote;
      },
      listProcesses: async () => '',
      killProcess: () => {},
      ...overrides,
    },
  });
  return { backend, ...result };
}

const temporary: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sm-backend-test-'));
  temporary.push(dir);
  return dir;
}

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const dir of temporary.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('locationConfig', () => {
  it('sets the timezone, the geolocation and the IPv4 exit IP as the WebRTC address', () => {
    const { config, prefs } = locationConfig(
      fakeLocation('8.8.8.8', {
        timezone: 'America/Los_Angeles',
        latitude: 37.38605,
        longitude: -122.08385,
      }),
      false,
    );
    expect(config).toEqual({
      timezone: 'America/Los_Angeles',
      'geolocation:latitude': 37.38605,
      'geolocation:longitude': -122.08385,
      'webrtc:ipv4': '8.8.8.8',
    });
    // As with geoip=: the browser stays off IPv6 then.
    expect(prefs).toEqual({
      ...LAUNCH_PREFS,
      'roverfox.s.timezone_0': 'America/Los_Angeles',
      'network.dns.disableIPv6': true,
    });
  });

  it.each([false, true])(
    'pins the time zone in the profile at every launch too (WebRTC blocked: %s)',
    (blockWebrtc) => {
      // Camoufox 152 saves the zone it was configured with in the profile
      // (`prefs.js`) and a later launch's `timezone` does not replace it: a
      // session rotated to a proxy in another zone would keep its first clock.
      const { prefs } = locationConfig(
        fakeLocation('8.8.8.8', { timezone: 'Asia/Tokyo' }),
        blockWebrtc,
      );
      expect(prefs['roverfox.s.timezone_0']).toBe('Asia/Tokyo');
    },
  );

  it('gives an IPv6 exit IP as the WebRTC address and keeps IPv6 on', () => {
    const { config, prefs } = locationConfig(
      fakeLocation('2001:4860:4860::8888'),
      false,
    );
    expect(config['webrtc:ipv6']).toBe('2001:4860:4860::8888');
    expect(config).not.toHaveProperty('webrtc:ipv4');
    expect(prefs).toEqual({
      ...LAUNCH_PREFS,
      'roverfox.s.timezone_0': NEW_YORK.timezone,
    });
    expect(prefs).not.toHaveProperty('network.dns.disableIPv6');
  });

  it('leaves WebRTC alone when it is blocked', () => {
    const { config, prefs } = locationConfig(fakeLocation('8.8.8.8'), true);
    expect(
      Object.keys(config).filter((key) => key.startsWith('webrtc:')),
    ).toEqual([]);
    expect(prefs).toEqual({
      ...LAUNCH_PREFS,
      'roverfox.s.timezone_0': NEW_YORK.timezone,
    });
  });

  it('does not look at the exit IP when WebRTC is blocked', () => {
    expect(() => locationConfig(fakeLocation('not an ip'), true)).not.toThrow();
  });

  it('refuses an exit IP that is no IP address', () => {
    expect(() => locationConfig(fakeLocation('not an ip'), false)).toThrow(
      'not an ip is not an IP address',
    );
  });

  it('keeps the privacy prefs that every launch needs', () => {
    const { prefs } = locationConfig(fakeLocation(), false);
    expect(prefs['media.peerconnection.ice.proxy_only']).toBe(true);
    expect(prefs['browser.startup.couldRestoreSession.count']).toBe(-1);
  });

  it('sends the loopback addresses through the proxy too: a session never talks to the computer it runs on', () => {
    // Firefox leaves localhost, 127.0.0.1 and ::1 out of the proxy unless told
    // otherwise, so a page (or an assistant that navigates) could reach every
    // service of this computer, the manager's own API included, directly.
    for (const blockWebrtc of [false, true]) {
      const { prefs } = locationConfig(fakeLocation(), blockWebrtc);
      expect(prefs['network.proxy.allow_hijacking_localhost']).toBe(true);
    }
    expect(LAUNCH_PREFS['network.proxy.allow_hijacking_localhost']).toBe(true);
  });

  it('hands out prefs of its own: the shared ones stay as they are', () => {
    locationConfig(fakeLocation('8.8.8.8'), false).prefs['extra'] = true;
    expect(LAUNCH_PREFS).not.toHaveProperty('extra');
    expect(LAUNCH_PREFS).not.toHaveProperty('network.dns.disableIPv6');
  });
});

describe('launchArgs', () => {
  const spec = fakeLaunchSpec({
    identity: {
      ...fakeIdentity('linux', 3),
      locale: 'fr-FR',
      pinned: { 'audio:seed': 7 },
    },
    proxy: { server: 'http://127.0.0.1:8080' }, // a session's ProxyBridge
    location: fakeLocation('8.8.8.8', {
      timezone: 'America/Los_Angeles',
      latitude: 37.38605,
      longitude: -122.08385,
    }),
  });

  it('carries the identity, the proxy and the place', () => {
    const args = launchArgs(spec, false);
    expect(args).toMatchObject({
      os: 'linux',
      locale: 'fr-FR', // the pinned locale: it is not drawn again
      webgl_config: ['Fake Vendor', 'Fake GPU'],
      screen: { maxWidth: 1920, maxHeight: 1080 },
      i_know_what_im_doing: true,
      headless: true, // the page is streamed: there is no window to show
      proxy: { server: 'http://127.0.0.1:8080' },
      block_webrtc: false,
    });
    expect(args.fingerprint).toEqual(spec.identity.fingerprint);
  });

  it('adds the place to the values the identity pins, not instead of them', () => {
    expect(launchArgs(spec, false).config).toEqual({
      'audio:seed': 7,
      timezone: 'America/Los_Angeles', // the session's place, not the host's
      'geolocation:latitude': 37.38605,
      'geolocation:longitude': -122.08385,
      'webrtc:ipv4': '8.8.8.8',
    });
  });

  it('does not ask camoufox-js to look the place up: the place is the pinned one', () => {
    // A GeoIP database update that moves an IP must not move a session that
    // already has a place for it.
    const args = launchArgs(spec, false);
    expect(args).not.toHaveProperty('geoip');
    expect(args.config).toMatchObject({ timezone: 'America/Los_Angeles' });
  });

  it('asks for the privacy prefs, and for no WebRTC address while it is blocked', () => {
    const open = launchArgs(spec, false);
    expect(open.firefox_user_prefs).toMatchObject({
      'media.peerconnection.ice.proxy_only': true,
      'browser.startup.couldRestoreSession.count': -1,
      'network.dns.disableIPv6': true,
    });
    const blocked = launchArgs(spec, true);
    expect(blocked.block_webrtc).toBe(true);
    expect(blocked.config).not.toHaveProperty('webrtc:ipv4');
    expect(blocked.firefox_user_prefs).not.toHaveProperty(
      'network.dns.disableIPv6',
    );
    expect(blocked.firefox_user_prefs).toMatchObject({
      'media.peerconnection.ice.proxy_only': true,
    });
  });

  it('carries the place of an IPv6 exit IP', () => {
    const v6 = fakeLaunchSpec({
      location: fakeLocation('2001:4860:4860::8888'),
    });
    const args = launchArgs(v6, false);
    expect(args.config).toMatchObject({
      'webrtc:ipv6': '2001:4860:4860::8888',
    });
    expect(args.config).not.toHaveProperty('webrtc:ipv4');
    expect(args.firefox_user_prefs).not.toHaveProperty(
      'network.dns.disableIPv6',
    );
  });

  it('does not change the identity, whatever camoufox-js does to the arguments', () => {
    const before = structuredClone(spec.identity);
    const args = launchArgs(spec, false);
    Object.assign(args.config ?? {}, { 'audio:seed': 99 });
    Object.assign(args.fingerprint ?? {}, { changed: true });
    expect(spec.identity).toEqual(before);
    expect(launchArgs(spec, false).config).toMatchObject({ 'audio:seed': 7 });
  });

  it('asks for the same as the identity alone, plus what the launch adds', () => {
    const alone = identityLaunchOptions(spec.identity);
    const args = launchArgs(spec, false);
    for (const key of [
      'os',
      'locale',
      'webgl_config',
      'screen',
      'i_know_what_im_doing',
    ]) {
      expect(args[key]).toEqual(alone[key]);
    }
  });
});

describe('launching a browser', () => {
  it('launches the profile with what camoufox-js answers, and reopens the tabs', async () => {
    const r = rig();
    const onLayout = vi.fn();
    const spec = fakeLaunchSpec({
      profileDir: '/data/profiles/1',
      tabs: { urls: ['https://a.example', 'https://b.example'], active: 1 },
      onLayout,
    });
    const session = await r.backend.launch(spec);

    expect(r.directories).toEqual(['/data/profiles/1']);
    expect(r.argsSeen).toEqual([launchArgs(spec, false)]);
    expect(r.launched).toHaveLength(1);
    expect(r.launched[0]?.profileDir).toBe('/data/profiles/1');
    expect(r.launched[0]?.options).toMatchObject({
      executablePath: CAMOUFOX_OPTIONS.executablePath,
      env: CAMOUFOX_OPTIONS.env,
    });
    expect(r.remoteOptions[0]?.context).toBe(r.contexts[0]);
    expect(r.remoteOptions[0]?.options).toEqual({
      startPage: spec.startPage,
      onLayout,
    });
    expect(r.remotes[0]?.calls).toEqual([
      'restore https://a.example,https://b.example 1',
    ]);
    expect(session.remote).toBe(r.remotes[0]);
    expect(session.context).toBe(r.contexts[0]);
  });

  it('keeps what a page downloads out of the temporary folder: downloads are refused', async () => {
    // A download is a file the browser writes to the disk until the session
    // ends; a hostile page could fill the disk this way.
    const r = rig();
    await r.backend.launch(fakeLaunchSpec());
    expect(r.launched[0]?.options).toMatchObject({ acceptDownloads: false });
  });

  it('hands the browser an environment without the secrets of the host', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'ghp_not_for_the_browser');
    vi.stubEnv('DEBUG', 'session-manager');
    const r = rig();
    await r.backend.launch(fakeLaunchSpec());
    const env = r.argsSeen[0]?.env ?? {};
    expect(Object.keys(env)).not.toContain('GITHUB_TOKEN');
    expect(env).toMatchObject({ DEBUG: 'session-manager' });
    expect(env.PATH).toBe(process.env.PATH);
  });

  it('leaves the termination signals to the app, not to Playwright', async () => {
    const r = rig();
    await r.backend.launch(fakeLaunchSpec());

    expect(r.launched[0]?.options).toMatchObject({
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    });
  });

  it('tells the pages where the exit IP is', async () => {
    // The browser would never answer a page that asks for the position: it
    // cannot ask anyone (camoufox's `geolocation:*` values are not enough in
    // this build), and the timers of the page stop while it waits.
    const r = rig();
    await r.backend.launch(
      fakeLaunchSpec({
        location: fakeLocation('8.8.8.8', {
          latitude: 37.38605,
          longitude: -122.08385,
        }),
      }),
    );

    expect(r.contexts[0]?.geolocation).toEqual({
      latitude: 37.38605,
      longitude: -122.08385,
    });
  });

  it('closes a browser whose position cannot be set, and fails the launch', async () => {
    const context = new FakeSessionContext();
    context.positionError = new Error('Target closed');
    const r = rig({ launchPersistentContext: async () => context });

    await expect(r.backend.launch(fakeLaunchSpec())).rejects.toThrow(
      'Target closed',
    );
    expect(context.closeCalls).toBe(1);
    expect(r.remotes).toHaveLength(0);
  });

  it('opens the start page when there are no tabs to reopen', async () => {
    const r = rig();
    await r.backend.launch(
      fakeLaunchSpec({ startPage: 'https://duckduckgo.com' }),
    );
    expect(r.remotes[0]?.calls).toEqual(['restore https://duckduckgo.com 0']);
  });

  it('uses the absolute path of the profile, which is the one the process shows', async () => {
    const r = rig();
    await r.backend.launch(fakeLaunchSpec({ profileDir: 'data/profiles/7' }));
    const absolute = resolve('data/profiles/7');
    expect(r.directories).toEqual([absolute]);
    expect(r.launched[0]?.profileDir).toBe(absolute);
  });

  it('gives Playwright the proxy of the spec, not the one camoufox-js made of it', async () => {
    const r = rig();
    // socks5://host:port has the origin "null": camoufox-js would send the browser nowhere.
    await r.backend.launch(
      fakeLaunchSpec({ proxy: { server: 'socks5://192.0.2.1:1080' } }),
    );
    expect(r.launched[0]?.options.proxy).toEqual({
      server: 'socks5://192.0.2.1:1080',
    });
  });

  it('blocks WebRTC when the app is set to', async () => {
    const r = rig({}, true);
    await r.backend.launch(fakeLaunchSpec());
    expect(r.argsSeen[0]?.block_webrtc).toBe(true);
    expect(r.argsSeen[0]?.config).not.toHaveProperty('webrtc:ipv4');
  });

  it('returns a session that ends when the browser exits', async () => {
    const r = rig();
    const session = await r.backend.launch(fakeLaunchSpec());
    const ended = track(session.waitClosed());
    await settle();
    expect(ended.settled).toBe(false);

    r.contexts[0]?.die();
    await session.waitClosed();
    expect(r.remotes[0]?.calls).toContain('freeze flush=false');
  });

  it('never logs what camoufox-js answers: it holds the environment', async () => {
    const r = rig();
    await r.backend.launch(fakeLaunchSpec());
    for (const spy of [console.info, console.warn, console.error]) {
      expect(JSON.stringify(vi.mocked(spy).mock.calls)).not.toContain(
        'SECRET_OF_THE_HOST',
      );
    }
  });
});

describe('a launch that fails', () => {
  it('fails when camoufox-js cannot make the options', async () => {
    const r = rig({
      launchOptions: async () => {
        throw new Error('Camoufox is not installed');
      },
    });
    await expect(r.backend.launch(fakeLaunchSpec())).rejects.toThrow(
      'Camoufox is not installed',
    );
    expect(r.contexts).toEqual([]);
  });

  it('fails when the browser does not start', async () => {
    const r = rig({
      launchPersistentContext: async () => {
        throw new Error('A copy of Camoufox is already open.');
      },
    });
    await expect(r.backend.launch(fakeLaunchSpec())).rejects.toThrow(
      'A copy of Camoufox is already open.',
    );
    expect(r.remotes).toEqual([]);
  });

  it('closes the browser when the remote cannot be made', async () => {
    const r = rig({
      createRemote: () => {
        throw new Error('no remote');
      },
    });
    await expect(r.backend.launch(fakeLaunchSpec())).rejects.toThrow(
      'no remote',
    );
    expect(r.contexts[0]?.closeCalls).toBe(1);
  });

  it('closes the session when its tabs cannot be reopened, and reports why', async () => {
    const r = rig({
      createRemote: (context, options) => {
        const remote = new FakeRemoteLifecycle();
        remote.restoreError = new Error('Could not open the first page');
        r.remotes.push(remote);
        r.remoteOptions.push({ context, options });
        return remote;
      },
    });
    await expect(r.backend.launch(fakeLaunchSpec())).rejects.toThrow(
      'Could not open the first page',
    );
    const [remote] = r.remotes;
    expect(remote?.calls).toEqual([
      'restore https://www.google.com 0',
      'freeze flush=true',
      'aclose',
    ]);
    expect(r.contexts[0]?.closeCalls).toBe(1);
  });

  it('reports the failure of the launch, not of the clean-up after it', async () => {
    const profileDir = resolve('/data/profiles/1');
    const context = new FakeSessionContext();
    context.closeBehaviour = 'fails';
    const remote = new FakeRemoteLifecycle();
    remote.restoreError = new Error('Could not open the first page');
    const { backend } = rig({
      launchPersistentContext: async () => context,
      createRemote: () => remote,
      listProcesses: async () =>
        `  9 /x/camoufox -no-remote -profile ${profileDir} -juggler-pipe`,
      killProcess: () => {
        throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' });
      },
    });
    await expect(
      backend.launch(fakeLaunchSpec({ profileDir, name: 'shop' })),
    ).rejects.toThrow('Could not open the first page');
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('could not close the browser of shop'),
    );
  });
});

describe('closing the backend', () => {
  it('closes the browsers that are still open', async () => {
    const r = rig();
    await r.backend.launch(fakeLaunchSpec({ profileDir: '/data/profiles/1' }));
    await r.backend.launch(fakeLaunchSpec({ profileDir: '/data/profiles/2' }));
    await r.backend.close();
    expect(r.contexts.map((context) => context.closeCalls)).toEqual([1, 1]);
    expect(r.remotes.map((remote) => remote.calls.at(-1))).toEqual([
      'aclose',
      'aclose',
    ]);
  });

  it('leaves alone a browser that is closed already', async () => {
    const r = rig();
    const session = await r.backend.launch(fakeLaunchSpec());
    await session.close();
    await settle();
    await r.backend.close();
    expect(r.contexts[0]?.closeCalls).toBe(1);
  });

  it('leaves alone a browser that exited on its own', async () => {
    const r = rig();
    await r.backend.launch(fakeLaunchSpec());
    r.contexts[0]?.die();
    await settle();
    await r.backend.close();
    expect(r.contexts[0]?.closeCalls).toBe(0);
  });

  it('still closes the other browsers when one will not close', async () => {
    const r = rig({
      killProcess: () => {
        throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' });
      },
      listProcesses: async () =>
        `  9 /x/camoufox -profile ${resolve('/data/profiles/1')} -juggler-pipe`,
    });
    await r.backend.launch(fakeLaunchSpec({ profileDir: '/data/profiles/1' }));
    await r.backend.launch(fakeLaunchSpec({ profileDir: '/data/profiles/2' }));
    r.contexts[0].closeBehaviour = 'fails';
    await r.backend.close();
    expect(r.contexts[1]?.closeCalls).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      'Could not close a browser',
      expect.any(Error),
    );
  });

  it('refuses a launch afterwards', async () => {
    const r = rig();
    await r.backend.close();
    await expect(r.backend.launch(fakeLaunchSpec())).rejects.toThrow('closed');
    expect(r.launched).toEqual([]);
  });

  it('closes a browser that finished starting after it closed', async () => {
    const gate = new Gate();
    const r = rig({
      launchPersistentContext: async () => {
        await gate.wait();
        const context = new FakeSessionContext();
        r.contexts.push(context);
        return context;
      },
    });
    const launching = r.backend.launch(fakeLaunchSpec());
    const assertion = expect(launching).rejects.toThrow('closed');
    await r.backend.close();
    gate.open();
    await assertion;
    expect(r.contexts[0]?.closeCalls).toBe(1);
  });

  it('closes a browser whose tabs are still being reopened', async () => {
    const gate = new Gate();
    const remote = new FakeRemoteLifecycle();
    remote.restore = async () => {
      await gate.wait();
    };
    const r = rig({ createRemote: () => remote });
    const launching = r.backend.launch(fakeLaunchSpec());
    const assertion = expect(launching).rejects.toThrow('closed');
    await vi.waitFor(() => expect(r.contexts).toHaveLength(1));
    await settle();

    await r.backend.close();
    expect(r.contexts[0]?.closeCalls).toBe(1);
    gate.open();
    await assertion;
    expect(r.contexts[0]?.closeCalls).toBe(1); // closed once
  });

  it('can be closed again', async () => {
    const r = rig();
    await r.backend.close();
    await r.backend.close();
  });
});

describe('the install of the browser', () => {
  it('has nothing to show before it starts', () => {
    expect(rig().backend.browserInstall()).toEqual({
      installing: false,
      error: null,
    });
  });

  it('asks whether the browser is installed every time', () => {
    let installed = false;
    const { backend } = rig({ isInstalled: () => installed });
    expect(backend.browserInstalled()).toBe(false);
    installed = true; // installed by hand since
    expect(backend.browserInstalled()).toBe(true);
  });

  it('leaves an installed browser alone', async () => {
    const installBrowser = vi.fn(async () => null);
    const { backend } = rig({ installBrowser });
    await backend.warmUp();
    expect(installBrowser).not.toHaveBeenCalled();
    expect(backend.browserInstall()).toEqual({
      installing: false,
      error: null,
    });
  });

  it('installs a missing browser and keeps the issue that stopped it', async () => {
    const seen: unknown[] = [];
    const { backend } = rig({
      isInstalled: () => false,
      installBrowser: async () => {
        seen.push(backend.browserInstall());
        return 'no space left on device';
      },
    });
    expect(backend.browserInstall()).toEqual({
      installing: false,
      error: null,
    });
    await backend.warmUp();
    expect(seen).toEqual([{ installing: true, error: null }]);
    expect(backend.browserInstall()).toEqual({
      installing: false,
      error: 'no space left on device',
    });
  });

  it('shows the install as under way until it is done', async () => {
    const gate = new Gate();
    const { backend } = rig({
      isInstalled: () => false,
      installBrowser: async () => {
        await gate.wait();
        return null;
      },
    });
    const warming = backend.warmUp();
    expect(backend.browserInstall()).toEqual({ installing: true, error: null });
    gate.open();
    await warming;
    expect(backend.browserInstall()).toEqual({
      installing: false,
      error: null,
    });
  });

  it('keeps an unexpected failure as the issue, and logs it', async () => {
    const { backend } = rig({
      isInstalled: () => false,
      installBrowser: async () => {
        throw new TypeError('fetch failed');
      },
    });
    await backend.warmUp();
    expect(backend.browserInstall()).toEqual({
      installing: false,
      error: 'TypeError: fetch failed',
    });
    expect(console.error).toHaveBeenCalled();
  });

  it('stops an install under way when the backend closes, and shows no issue', async () => {
    const warmUpGeo = vi.fn(async () => {});
    const { backend } = rig({
      isInstalled: () => false,
      warmUpGeo,
      installBrowser: (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        }),
    });
    const warming = backend.warmUp();
    expect(backend.browserInstall().installing).toBe(true);

    await backend.close();
    await warming;
    expect(backend.browserInstall()).toEqual({
      installing: false,
      error: null,
    });
    expect(warmUpGeo).not.toHaveBeenCalled();
  });

  it('installs once when it is asked to warm up twice at the same time', async () => {
    const gate = new Gate();
    const installBrowser = vi.fn(async () => {
      await gate.wait();
      return null;
    });
    const { backend } = rig({ isInstalled: () => false, installBrowser });
    const first = backend.warmUp();
    const second = backend.warmUp();
    gate.open();
    await Promise.all([first, second]);
    expect(installBrowser).toHaveBeenCalledTimes(1);

    await backend.warmUp(); // later, it checks again
    expect(installBrowser).toHaveBeenCalledTimes(2);
  });
});

describe('warming up', () => {
  it('prepares the GeoIP database once the browser is there', async () => {
    const warmUpGeo = vi.fn(async () => {});
    await rig({ warmUpGeo }).backend.warmUp();
    expect(warmUpGeo).toHaveBeenCalledTimes(1);
  });

  it('prepares it after an install that failed, too', async () => {
    const warmUpGeo = vi.fn(async () => {});
    const { backend } = rig({
      isInstalled: () => false,
      installBrowser: async () => 'offline',
      warmUpGeo,
    });
    await backend.warmUp();
    expect(warmUpGeo).toHaveBeenCalledTimes(1);
    expect(backend.browserInstall().error).toBe('offline');
  });

  it('is best effort: a failing warm-up is logged, not thrown', async () => {
    const { backend } = rig({
      warmUpGeo: async () => {
        throw new Error('offline');
      },
    });
    await expect(backend.warmUp()).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(
      'Camoufox warm-up failed',
      expect.any(Error),
    );
    expect(backend.browserInstall()).toEqual({
      installing: false,
      error: null,
    });
  });
});

describe('identities and places', () => {
  it('draws identities through the identity module', async () => {
    const generated = fakeGeneratedIdentity('macos', 5);
    const createIdentity = vi.fn(async () => generated);
    const { backend } = rig({ createIdentity });
    const taken = new Set(['visible-1']);
    expect(await backend.createIdentity('macos', taken)).toBe(generated);
    expect(createIdentity).toHaveBeenCalledWith('macos', taken);
  });

  it('passes on an identity that cannot be drawn', async () => {
    const { backend } = rig({
      createIdentity: async () => {
        throw new IdentityError('no suitable identity');
      },
    });
    await expect(
      backend.createIdentity('linux', new Set()),
    ).rejects.toBeInstanceOf(IdentityError);
  });

  it('looks places up through the geo module', async () => {
    const lookupGeo = vi.fn(async () => NEW_YORK);
    const { backend } = rig({ lookupGeo });
    expect(await backend.lookupGeo('203.0.113.1')).toBe(NEW_YORK);
    expect(lookupGeo).toHaveBeenCalledWith('203.0.113.1');
  });

  it('passes on a place that is not known', async () => {
    const { backend } = rig({
      lookupGeo: async (ip) => {
        throw new GeoLookupError(
          `the GeoIP database has no location for ${ip}`,
        );
      },
    });
    await expect(backend.lookupGeo('10.0.0.1')).rejects.toBeInstanceOf(
      GeoLookupError,
    );
  });
});

describe('the browser version', () => {
  it('is the build that the deps name, asked once', () => {
    const browserVersion = vi.fn(() => '152.0.4-beta.30');
    const { backend } = rig({ browserVersion });
    expect(backend.browserVersion).toBe('152.0.4-beta.30');
    expect(backend.browserVersion).toBe('152.0.4-beta.30');
    expect(browserVersion).toHaveBeenCalledTimes(1);
  });

  it('is the build that camoufox-js pins unless told otherwise', () => {
    const backend = new CamoufoxBackend({ blockWebrtc: false });
    expect(backend.browserVersion).toBe(browserBuild());
    expect(backend.browserVersion).toMatch(/^\d+(\.\d+)+-\S+$/);
  });
});

describe('refreshGeoDatabase', () => {
  function database(ageMs: number): string {
    const file = join(tempDir(), 'GeoLite2-City.mmdb');
    writeFileSync(file, 'data');
    const time = new Date(Date.now() - ageMs);
    utimesSync(file, time, time);
    return file;
  }

  it('downloads a database that is missing', async () => {
    const download = vi.fn(async () => {});
    const file = join(tempDir(), 'GeoLite2-City.mmdb');
    expect(await refreshGeoDatabase({ file, download })).toBe(true);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it('keeps a database that is recent', async () => {
    const download = vi.fn(async () => {});
    expect(
      await refreshGeoDatabase({ file: database(2 * DAY_MS), download }),
    ).toBe(false);
    expect(download).not.toHaveBeenCalled();
  });

  it('downloads a database that is old', async () => {
    const download = vi.fn(async () => {});
    expect(
      await refreshGeoDatabase({ file: database(9 * DAY_MS), download }),
    ).toBe(true);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it('counts the age on the clock it is given', async () => {
    const download = vi.fn(async () => {});
    const file = database(0);
    const later = () => Date.now() + 30 * DAY_MS;
    expect(await refreshGeoDatabase({ file, download, now: later })).toBe(true);
  });

  it('fails when the download fails, so that the caller can log it', async () => {
    const file = join(tempDir(), 'GeoLite2-City.mmdb');
    await expect(
      refreshGeoDatabase({
        file,
        download: async () => {
          throw new Error('offline');
        },
      }),
    ).rejects.toThrow('offline');
  });
});

describe('the Playwright remote', () => {
  it('is made for a context that Playwright drives', async () => {
    const context: SessionContext & {
      newPage: () => Promise<never>;
      off: (event: string, listener: () => void) => void;
    } = {
      pages: () => [],
      on: () => undefined,
      off: () => undefined,
      newPage: () => Promise.reject(new Error('no page')),
      setGeolocation: async () => {},
      close: async () => {},
    };
    const remote = await createPlaywrightRemote(context, {
      startPage: 'https://www.google.com',
    });
    expect(remote.closed).toBe(false);
    expect(remote.tabs()).toEqual([]);
    await remote.aclose();
    expect(remote.closed).toBe(true);
  });

  it('is not made for anything else', async () => {
    await expect(
      createPlaywrightRemote(new FakeSessionContext(), {
        startPage: 'https://www.google.com',
      }),
    ).rejects.toThrow('cannot be driven');
  });
});

describe('the defaults of the deps', () => {
  it('makes the profile directory, parents included', async () => {
    const profileDir = join(tempDir(), 'profiles', '1');
    const { backend } = rig({ makeDirectory: undefined });
    await backend.launch(fakeLaunchSpec({ profileDir }));
    expect(existsSync(profileDir)).toBe(true);
  });

  it('asks the geo module, which refuses an address that is none', async () => {
    const backend = new CamoufoxBackend({ blockWebrtc: false });
    await expect(backend.lookupGeo('not an ip')).rejects.toBeInstanceOf(
      GeoLookupError,
    );
  });

  it('asks the identity module, which refuses an OS it does not know', async () => {
    const backend = new CamoufoxBackend({ blockWebrtc: false });
    await expect(
      backend.createIdentity('android', new Set()),
    ).rejects.toThrow();
  });
});

/**
 * The real camoufox-js answers, in a process of its own: it reads the install
 * directory when it is first loaded, and this process must not read the user's.
 * `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` makes it say that it skips a download
 * instead of making one.
 */
describe('the default GeoIP warm-up', () => {
  function warmUpIn(installDir: string): string {
    const module = new URL('./camoufox-backend.ts', import.meta.url).href;
    const code = `
      import { CamoufoxBackend } from ${JSON.stringify(module)};
      const backend = new CamoufoxBackend({ blockWebrtc: false, deps: { isInstalled: () => true } });
      await backend.warmUp();`;
    return execFileSync(process.execPath, ['-e', code], {
      env: {
        ...process.env,
        CAMOUFOX_INSTALL_DIR: installDir,
        PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
      },
      encoding: 'utf8',
    });
  }

  it('lets camoufox-js download the database when it is missing', () => {
    expect(warmUpIn(tempDir())).toContain('Skipping GeoIP database download');
  });

  it('leaves a recent database alone', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'GeoLite2-City.mmdb'), 'data');
    expect(warmUpIn(dir)).not.toContain('GeoIP');
  });

  it('replaces an old database', () => {
    const dir = tempDir();
    const file = join(dir, 'GeoLite2-City.mmdb');
    writeFileSync(file, 'data');
    const old = new Date(Date.now() - 9 * DAY_MS);
    utimesSync(file, old, old);
    expect(warmUpIn(dir)).toContain('Skipping GeoIP database download');
  });
});
