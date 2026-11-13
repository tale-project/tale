import type { DeploymentColor } from '../../../compose/types';
import { parseCidr } from '../../../project/runtime-declaration';
import type { InterpolationPath } from './interpolate';
import { RefusalError, refusal } from './refusals';

/**
 * The stack's addresses, fixed by `runtime.incus.network.block` (design 5.2).
 * Every instance has a static address, so every name the stack resolves and
 * every upstream the switch lists is known before anything runs:
 *
 * | Offset    | Holder                                                  |
 * | --------- | ------------------------------------------------------- |
 * | .1        | the bridge gateway (the operator's)                     |
 * | .2-.12    | the singletons (`SINGLETON_OFFSETS`)                    |
 * | .16-.31   | one-shot helpers `job-*`                                |
 * | .32-.63   | reserved                                                |
 * | .64-.127  | blue: platform .64, backend-api .80, backend-worker .96 |
 * | .128-.191 | green: the same layout, 64 further                      |
 *
 * A workspace flips between two colours and needs a /24; a managed
 * deployment has no colours, runs on the blue slots without a colour label,
 * and needs a /25. Each role holds 16 slots per colour, the CLI's maximum
 * replica count (`utils/load-env.ts`), and a count above them is refused.
 */

export const SINGLETON_OFFSETS = {
  names: 2,
  'names-sessions': 3,
  proxy: 4,
  switch: 5,
  db: 6,
  'knowledge-db': 7,
  'object-store': 8,
  'sandbox-llm-gateway': 9,
  'sandbox-egress': 10,
  sandbox: 11,
  'bgutil-provider': 12,
} as const;
export type SingletonRole = keyof typeof SINGLETON_OFFSETS;

export const SLOT_ROLES = [
  'platform',
  'backend-api',
  'backend-worker',
] as const;
export type SlotRole = (typeof SLOT_ROLES)[number];

/** Slots per role and colour: the CLI's maximum replica count. */
const SLOTS_PER_ROLE = 16;
const BLUE_BASE = 64;
const COLOUR_SPAN = 64;
const HELPER_FIRST = 16;
const HELPER_LAST = 31;

const ROLE_OFFSET: Record<SlotRole, number> = {
  platform: 0,
  'backend-api': SLOTS_PER_ROLE,
  'backend-worker': 2 * SLOTS_PER_ROLE,
};

/** The prefix each path's block must have. */
const BLOCK_PREFIX: Record<InterpolationPath, number> = {
  workspace: 24,
  managed: 25,
};

export interface AddressPlan {
  path: InterpolationPath;
  /** The block, as declared. */
  block: string;
  /** The bridge gateway every instance routes through. */
  gateway: string;
  /** The subnet's prefix length: an instance's address is `<ip>/<prefix>`. */
  subnetPrefix: number;
  /** The colours the block holds: both for a workspace, blue alone for a
   * managed deployment, which carries no colour label. */
  colours: readonly DeploymentColor[];
  singleton(role: SingletonRole): string;
  /** The address of replica `index` (1-based) of `role` in `colour`. */
  slot(role: SlotRole, colour: DeploymentColor, index: number): string;
  /** Every slot of a role in every colour the block holds, in order. */
  slots(role: SlotRole): string[];
  /** The addresses one-shot helpers take, in order. */
  helpers(): string[];
}

function formatAddress(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.');
}

/**
 * The plan of `network` for `path`. Refuses a block of the wrong size for the
 * path and a replica count above the slots of its role.
 */
export function addressPlan(
  network: { subnet: string; gateway: string; block: string },
  path: InterpolationPath,
  replicas: Readonly<Record<SlotRole, number>>,
): AddressPlan {
  const block = parseCidr(network.block);
  if (block.prefix !== BLOCK_PREFIX[path])
    throw new RefusalError(
      refusal(
        'address-block',
        `runtime.incus.network.block ${network.block} is a /${block.prefix}; a ${path === 'workspace' ? 'workspace' : 'managed deployment'} needs a /${BLOCK_PREFIX[path]}.`,
      ),
    );
  for (const role of SLOT_ROLES) {
    const count = replicas[role];
    if (!Number.isSafeInteger(count) || count < 1 || count > SLOTS_PER_ROLE)
      throw new RefusalError(
        refusal(
          'replicas',
          `${role} asks for ${count} replicas; the plan holds 1 to ${SLOTS_PER_ROLE}.`,
          role,
        ),
      );
  }
  const colours: readonly DeploymentColor[] =
    path === 'workspace' ? ['blue', 'green'] : ['blue'];
  const at = (offset: number): string => formatAddress(block.first + offset);
  const slot = (
    role: SlotRole,
    colour: DeploymentColor,
    index: number,
  ): string => {
    if (!colours.includes(colour))
      throw new Error(`The ${path} address plan has no ${colour} slots.`);
    if (!Number.isSafeInteger(index) || index < 1 || index > SLOTS_PER_ROLE)
      throw new Error(`Replica ${index} of ${role} has no slot.`);
    return at(
      BLUE_BASE +
        (colour === 'green' ? COLOUR_SPAN : 0) +
        ROLE_OFFSET[role] +
        index -
        1,
    );
  };
  return {
    path,
    block: network.block,
    gateway: network.gateway,
    subnetPrefix: parseCidr(network.subnet).prefix,
    colours,
    singleton: (role) => at(SINGLETON_OFFSETS[role]),
    slot,
    slots: (role) =>
      colours.flatMap((colour) =>
        Array.from({ length: SLOTS_PER_ROLE }, (_, index) =>
          slot(role, colour, index + 1),
        ),
      ),
    helpers: () =>
      Array.from({ length: HELPER_LAST - HELPER_FIRST + 1 }, (_, index) =>
        at(HELPER_FIRST + index),
      ),
  };
}
