import { z } from 'zod';

// The page's CSP has no `unsafe-eval`. Zod probes whether it may compile
// parsers, with `Function('')`, when the first object schema is built, and the
// browser reports the refused probe as a violation on every page load (Firefox
// logs it as an error in the console). With the compiler off zod does not try,
// and every schema parses the same.
//
// Import this first, from every module that builds a schema when it loads
// (`lib/api/schemas.ts` and `lib/live-view.ts` do): the bundler orders modules
// by what they import, not by the order of the lines of the entry file, so a
// line in `main.tsx` is not early enough. `tests/guards/zod-jitless.guard.test.ts`
// loads each of them alone and fails on the probe.
//
// The server shares these modules and so runs without the compiler too: what
// it parses (a request, a message of the live view) is small and rare enough
// for that not to matter.
z.config({ jitless: true });
