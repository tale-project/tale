import { setSafeFetchResolverForTests } from '../lib/net/safe-fetch';

/**
 * The server project's per-file setup. The unit suites stub `fetch` and
 * name fixture hosts (`api.example.com`); `safeFetch` resolves every host
 * before it dials, so without this the suites would reach real DNS. Every
 * name answers one documentation-range public address here; a suite that
 * tests the resolution guard installs its own resolver.
 */
setSafeFetchResolverForTests(() =>
  Promise.resolve([{ address: '203.0.113.10', family: 4 }]),
);
