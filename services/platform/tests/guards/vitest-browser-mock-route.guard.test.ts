// @vitest-environment node

import { PlaywrightBrowserProvider } from '@vitest/browser-playwright';
import { afterEach, describe, expect, it } from 'vitest';

// The browser tests' `vi.mock` is served by a Playwright route per module. A
// file's cleanup unroutes it while a handler may still await the factory, and
// the late `fulfill` then rejects with "Route is already handled!", an
// unhandled rejection that fails the whole run after every test passed. The
// patch in `patches/` settles that one answer and keeps every other error.

type MockRoute = { fulfill: (response: unknown) => Promise<void> };
type Handler = (route: MockRoute) => Promise<void> | void;

const providers: PlaywrightBrowserProvider[] = [];

afterEach(() => {
  for (const provider of providers.splice(0)) {
    // The constructor listens for SIGTERM; it is private, so reach it by name.
    process.off(
      'SIGTERM',
      (provider as unknown as { onSIGTERM: () => void }).onSIGTERM,
    );
  }
});

// The provider's mocker only needs a page whose context takes the route.
const registerManualMock = async (): Promise<Handler> => {
  const project = {
    config: { browser: { name: 'chromium' } },
    browser: {
      registerCommand: () => undefined,
      vite: { config: { server: { headers: {} } } },
    },
  };
  const provider = new PlaywrightBrowserProvider(project as never, {} as never);
  providers.push(provider);

  let handler: Handler | undefined;
  provider.getPage = (() => ({
    context: () => ({
      route: async (_predicate: unknown, routed: Handler) => {
        handler = routed;
      },
      unroute: async () => undefined,
    }),
  })) as never;

  await provider.mocker.register('session', {
    type: 'manual',
    url: 'http://localhost/app/lib/example.ts',
    resolve: async () => ({ answer: 42 }),
  } as never);
  if (!handler) throw new Error('the mocker registered no route');
  return handler;
};

describe('the browser provider’s mock route', () => {
  it('settles when the route was handled while the factory ran', async () => {
    const handler = await registerManualMock();
    await expect(
      Promise.resolve(
        handler({
          fulfill: async () => {
            throw new Error('route.fulfill: Route is already handled!');
          },
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it('still rejects every other failure to answer', async () => {
    const handler = await registerManualMock();
    await expect(
      Promise.resolve(
        handler({
          fulfill: async () => {
            throw new Error('route.fulfill: Target page has been closed');
          },
        }),
      ),
    ).rejects.toThrow('Target page has been closed');
  });

  it('still answers a route nobody handled', async () => {
    const handler = await registerManualMock();
    const answers: unknown[] = [];
    await handler({
      fulfill: async (response) => {
        answers.push(response);
      },
    });
    expect(answers).toHaveLength(1);
  });
});
