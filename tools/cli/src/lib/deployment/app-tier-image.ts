import { z } from 'zod';

import { externalDepError } from '../../utils/fail';
import { imageServesAppInBackend } from '../compose/app-tier';
import { protocolAccess } from './automation-protocol';
import type { RuntimeDependencies } from './runtime-model';

/**
 * Whether an image on this host serves the app from its backend process: the
 * `io.tale.app-in-backend` label it carries or lacks (compose/app-tier.ts).
 *
 * `reference` is the one the colour's compose will name: the digest a
 * protocol-2 image was admitted under, so the image read here is the image
 * that starts. Read from the host, like the admission before it; an image
 * that is not here has nothing to say yet.
 */
export async function imageServesApp(
  reference: string,
  dependencies: RuntimeDependencies = {},
): Promise<boolean> {
  let inspected: unknown;
  try {
    inspected = await protocolAccess(dependencies).inspectImage([reference]);
  } catch (error) {
    // An answer that does not parse is refused as it is, below.
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      throw error;
    // The protocol reads' own sentence is about the installed writer; this
    // read is the selected image's, so name the image and the read instead.
    throw externalDepError(
      `Could not read which services the selected image runs as: \`docker image inspect ${reference}\` failed.`,
    );
  }
  const [image] = z
    .array(
      z.object({
        labels: z.record(z.string(), z.string()).nullable().optional(),
      }),
    )
    .length(1)
    .parse(inspected);
  return imageServesAppInBackend(image?.labels);
}
