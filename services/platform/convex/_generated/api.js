/**
 * The runtime behind the name vocabulary in ./api.d.ts.
 *
 * `internal.a.b.c` is a proxy walk that records a path and nothing else; the
 * 0.5 ctx shim (`backend/lib/convex-shim.ts`) turns that path into a name and
 * dispatches it to a SQL-backed handler.
 *
 * `anyApi` and `componentsGeneric` are the LAST runtime tie to the `convex`
 * package outside the two `getFunctionName` call sites. They are kept here,
 * rather than reimplemented, because the shim's handler table is keyed by the
 * exact strings `getFunctionName` produces — owning the reference format means
 * owning both ends at once, which is its own change.
 *
 * HAND-MAINTAINED, not generated.
 */

import { anyApi, componentsGeneric } from 'convex/server';

export const api = anyApi;
export const internal = anyApi;
export const components = componentsGeneric();
