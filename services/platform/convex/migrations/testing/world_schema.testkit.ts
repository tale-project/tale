/**
 * The corpus world schema. Since the 0.4 baseline reset the baseline world
 * IS the current production schema: the seeded corpus models a fresh 0.4.0
 * deployment, so the world validates against `convex/schema.ts` itself —
 * no union with historical shapes, because the pre-0.4 chain (and every
 * table only it knew) is gone. A future 0.4.x migration that reshapes a
 * table widens this schema exactly by changing the real schema module it
 * ships with; the corpus never re-declares shapes on its own.
 *
 * Two-dot basename (`world_schema.testkit.ts`) keeps this module out of the
 * Convex push bundle; it must still never import vitest/convex-test.
 */

import schema from '../../schema';

export const worldSchema = schema;
