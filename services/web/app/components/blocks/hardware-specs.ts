import type { TFunction } from 'i18next';

// =============================================================================
// Hardware catalog — single source of truth for the hardware-pricing page.
//
// Edit a node below; multi-node specs, pricing, and progress-bar metrics all
// recompute from `NODES × MULTI_NODE_COMPOSITION`. The snake_case IDs
// (`ddr5_ecc`, `apple_silicon`, `m2_nvme`, …) map to display labels in
// `messages/global.yml` under `specs.types.*` — keep the two in sync.
// =============================================================================

type TierKey = 'quality' | 'hybrid' | 'speed';
type NodeKey = TierKey;
type MultiNodeKey = TierKey;

type RamId = 'uma' | 'vram' | 'ddr5' | 'ddr5_ecc';
type ChipId =
  | 'apple_silicon'
  | 'nvidia_rtx_pro_6000'
  | 'amd_epyc_4545p_zen5'
  | 'amd_epyc_9355p_zen4';

interface Ram {
  id: RamId;
  gb: number;
}
interface Chip {
  id: ChipId;
  count: number;
}

interface Node {
  /** GPU-bound inference memory. */
  aiRam: Ram | null;
  /** Host memory used by the OS and CPU workloads. */
  systemRam: Ram | null;
  gpu: Chip | null;
  cpu: Chip | null;
  /** Always m.2 NVMe in current configs. */
  ssdTB: number;
  /** One-off purchase price (CHF). Rental is derived (≈5%, ceil to CHF 100). */
  buyPrice: number;
}

const NODES: Record<NodeKey, Node> = {
  quality: {
    aiRam: { id: 'uma', gb: 96 },
    systemRam: null,
    gpu: { id: 'apple_silicon', count: 1 },
    cpu: null,
    ssdTB: 1,
    buyPrice: 3_990,
  },
  // Presented as "Application node" in node-mode. Same compute hardware
  // as the speed node — differentiated by extra storage (and price).
  hybrid: {
    aiRam: { id: 'vram', gb: 96 },
    systemRam: { id: 'ddr5_ecc', gb: 96 },
    gpu: { id: 'nvidia_rtx_pro_6000', count: 1 },
    cpu: { id: 'amd_epyc_4545p_zen5', count: 1 },
    ssdTB: 4,
    buyPrice: 14_990,
  },
  speed: {
    aiRam: { id: 'vram', gb: 96 },
    systemRam: { id: 'ddr5_ecc', gb: 64 },
    gpu: { id: 'nvidia_rtx_pro_6000', count: 1 },
    cpu: { id: 'amd_epyc_4545p_zen5', count: 1 },
    ssdTB: 1,
    buyPrice: 13_690,
  },
};

/**
 * Number of each node type composing a multi-node setup. Every multi-node
 * configuration ships with two application nodes (`hybrid`) — one drives
 * the workload, the other stands by for redundancy and rolling upgrades.
 */
const MULTI_NODE_COMPOSITION: Record<MultiNodeKey, Record<NodeKey, number>> = {
  quality: { quality: 6, hybrid: 2, speed: 0 },
  hybrid: { quality: 3, hybrid: 2, speed: 1 },
  speed: { quality: 0, hybrid: 2, speed: 2 },
};

/**
 * AI server rack — single-chassis offering that bundles the compute of a
 * speed multi-node setup into one rack unit, with confidential computing
 * enabled by default. Only one configuration ships in this mode.
 */
const RACK: Node = {
  aiRam: { id: 'vram', gb: 384 },
  systemRam: { id: 'ddr5_ecc', gb: 256 },
  gpu: { id: 'nvidia_rtx_pro_6000', count: 4 },
  cpu: { id: 'amd_epyc_9355p_zen4', count: 1 },
  ssdTB: 8,
  buyPrice: 64_890,
};

const TIER_KEYS: readonly TierKey[] = ['quality', 'hybrid', 'speed'];
const NA = '-';

// =============================================================================
// Spec lines — content for each cell of the compare table.
// =============================================================================

export interface SpecLines {
  aiRam: string;
  systemRam: string;
  gpu: string;
  cpu: string;
  ssd: string;
  hdd: string;
  size: string;
}

const label = (t: TFunction, id: string) => t(`specs.types.${id}`);
const ramLine = (t: TFunction, r: Ram) =>
  t('specs.line.ram', { gb: r.gb, type: label(t, r.id) });
const chipLine = (t: TFunction, c: Chip) =>
  t('specs.line.chip', { count: c.count, name: label(t, c.id) });
const ssdLine = (t: TFunction, tb: number) =>
  t('specs.line.ssd', { tb, type: label(t, 'm2_nvme') });

export function nodeSpec(t: TFunction, key: NodeKey): SpecLines {
  const n = NODES[key];
  return {
    aiRam: n.aiRam ? ramLine(t, n.aiRam) : NA,
    systemRam: n.systemRam ? ramLine(t, n.systemRam) : NA,
    gpu: n.gpu ? chipLine(t, n.gpu) : NA,
    cpu: n.cpu ? chipLine(t, n.cpu) : NA,
    ssd: ssdLine(t, n.ssdTB),
    hdd: NA,
    size: t(`specs.sizes.node.${key}`),
  };
}

export function rackSpec(t: TFunction): SpecLines {
  return {
    aiRam: RACK.aiRam ? ramLine(t, RACK.aiRam) : NA,
    systemRam: RACK.systemRam ? ramLine(t, RACK.systemRam) : NA,
    gpu: RACK.gpu ? chipLine(t, RACK.gpu) : NA,
    cpu: RACK.cpu ? chipLine(t, RACK.cpu) : NA,
    ssd: ssdLine(t, RACK.ssdTB),
    hdd: NA,
    size: t('specs.sizes.rack'),
  };
}

/**
 * Multi-node composition rendered as one line per node type, e.g.
 *   "6× Quality node\n2× Application node"
 * Node types with a zero count are omitted; line order follows `TIER_KEYS`.
 */
export function multiNodeComposition(t: TFunction, key: MultiNodeKey): string {
  const comp = MULTI_NODE_COMPOSITION[key];
  const lines: string[] = [];
  for (const nk of TIER_KEYS) {
    const count = comp[nk];
    if (count === 0) continue;
    lines.push(`${count}× ${t(`tierNames.node.${nk}`)}`);
  }
  return lines.join('\n');
}

/**
 * Multi-node specs sum each component across the composition, grouped by
 * `id`. If two types coexist on the same row (e.g. UMA + VRAM, or Apple +
 * NVIDIA), each renders as its own line — order follows first appearance
 * in the composition.
 */
export function multiNodeSpec(t: TFunction, key: MultiNodeKey): SpecLines {
  const comp = MULTI_NODE_COMPOSITION[key];

  function sumByType<I extends string>(
    pick: (n: Node) => { id: I; n: number } | null,
  ): Map<I, number> {
    const out = new Map<I, number>();
    for (const nk of TIER_KEYS) {
      const count = comp[nk];
      if (!count) continue;
      const item = pick(NODES[nk]);
      if (!item) continue;
      out.set(item.id, (out.get(item.id) ?? 0) + item.n * count);
    }
    return out;
  }

  const join = (lines: string[]) => (lines.length > 0 ? lines.join('\n') : NA);

  const aiRam = sumByType((n) => n.aiRam && { id: n.aiRam.id, n: n.aiRam.gb });
  const systemRam = sumByType(
    (n) => n.systemRam && { id: n.systemRam.id, n: n.systemRam.gb },
  );
  const gpu = sumByType((n) => n.gpu && { id: n.gpu.id, n: n.gpu.count });
  const cpu = sumByType((n) => n.cpu && { id: n.cpu.id, n: n.cpu.count });
  const ssdTotal = TIER_KEYS.reduce(
    (sum, nk) => sum + NODES[nk].ssdTB * comp[nk],
    0,
  );

  return {
    aiRam: join([...aiRam].map(([id, gb]) => ramLine(t, { id, gb }))),
    systemRam: join([...systemRam].map(([id, gb]) => ramLine(t, { id, gb }))),
    gpu: join([...gpu].map(([id, count]) => chipLine(t, { id, count }))),
    cpu: join([...cpu].map(([id, count]) => chipLine(t, { id, count }))),
    ssd: ssdTotal > 0 ? ssdLine(t, ssdTotal) : NA,
    hdd: NA,
    size: t(`specs.sizes.multinode.${key}`),
  };
}

// =============================================================================
// Pricing — node buy prices listed; multi-node buy = sum of contained
// nodes plus a flat infrastructure surcharge. Monthly leasing is derived
// on demand from buy × per-term factor.
// =============================================================================

/**
 * Flat surcharge added to every multi-node setup — covers the cables,
 * network equipment, and rack that ship with the bundle and aren't billed
 * per-node.
 */
const MULTI_NODE_INFRA_SURCHARGE = 790;

export function nodeBuyPrice(key: NodeKey): number {
  return NODES[key].buyPrice;
}

export function multiNodeBuyPrice(key: MultiNodeKey): number {
  const comp = MULTI_NODE_COMPOSITION[key];
  let buy = 0;
  for (const nk of TIER_KEYS) buy += NODES[nk].buyPrice * comp[nk];
  return buy + MULTI_NODE_INFRA_SURCHARGE;
}

export function rackBuyPrice(): number {
  return RACK.buyPrice;
}

export const LEASING_TERMS = [12, 24, 36, 48, 60] as const;
export type LeasingTerm = (typeof LEASING_TERMS)[number];

/**
 * Indicative monthly leasing factor by term length. Monthly payment is
 * `buy × factor`. Shorter terms have a higher monthly rate but lower
 * total cost; longer terms amortise more interest. Real quotes depend
 * on the leasing partner — these are marketing approximations,
 * rendered with the `approximate: true` currency flag.
 */
const LEASING_FACTOR: Record<LeasingTerm, number> = {
  12: 0.085,
  24: 0.045,
  36: 0.03,
  48: 0.025,
  60: 0.02,
};

/** Indicative monthly leasing payment, rounded to the nearest CHF 100. */
export function leasingMonthly(buy: number, term: LeasingTerm): number {
  return Math.round((buy * LEASING_FACTOR[term]) / 100) * 100;
}

// =============================================================================
// Progress-bar metrics — three 0–100 bars per tier, normalised within mode.
//
//   • quality — AI RAM per CHF (capacity weighted by value-for-money)
//   • speed   — average chip bandwidth across the tier's AI RAM
//               (per-token rate; doesn't grow with multi-node size)
//   • storage — total SSD TB
//
// Speed is a *rate*, not a capacity — a 9-node Apple multi-node setup
// doesn't generate tokens 9× faster than one Apple node. Multi-node speed
// is the RAM-weighted average bandwidth of the chips driving inference,
// so a setup dominated by NVIDIA scores higher than one dominated by
// Apple regardless of total node count.
// =============================================================================

/**
 * Memory-bandwidth ratio, normalised to Apple Silicon UMA = 1.0.
 *   • NVIDIA RTX PRO 6000 VRAM ≈ 1700 GB/s → 4×
 *   • Apple Silicon UMA       ≈  400 GB/s → 1×
 *   • AMD EPYC + DDR5 ECC     ≈   50 GB/s → 0.125× (CPU-inference fallback)
 */
const BANDWIDTH: Record<ChipId, number> = {
  apple_silicon: 1.0,
  nvidia_rtx_pro_6000: 4.0,
  amd_epyc_4545p_zen5: 0.125,
  amd_epyc_9355p_zen4: 0.125,
};

export interface TierMetrics {
  quality: number;
  speed: number;
  storage: number;
}

interface RawMetrics {
  aiRamGB: number;
  speed: number;
  ssdTB: number;
  buy: number;
}

function nodeRaw(key: NodeKey): RawMetrics {
  const n = NODES[key];
  const ramGB = n.aiRam?.gb ?? 0;
  // Chip that handles inference: GPU if present, else CPU. `count` is
  // folded in so a node with multiple compute units scores higher.
  const compute = n.gpu ?? n.cpu;
  const bw = compute ? BANDWIDTH[compute.id] * compute.count : 0;
  return {
    aiRamGB: ramGB,
    speed: ramGB * bw,
    ssdTB: n.ssdTB,
    buy: n.buyPrice,
  };
}

function multiNodeRaw(key: MultiNodeKey): RawMetrics {
  const comp = MULTI_NODE_COMPOSITION[key];
  // Seed `buy` with the infra surcharge so the quality metric
  // (aiRamGB / buy) divides by the true multi-node price that customers
  // see, matching what `multiNodeBuyPrice()` returns.
  const zero: RawMetrics = {
    aiRamGB: 0,
    speed: 0,
    ssdTB: 0,
    buy: MULTI_NODE_INFRA_SURCHARGE,
  };
  return TIER_KEYS.reduce((acc, nk) => {
    const c = comp[nk];
    if (!c) return acc;
    const r = nodeRaw(nk);
    return {
      aiRamGB: acc.aiRamGB + r.aiRamGB * c,
      speed: acc.speed + r.speed * c,
      ssdTB: acc.ssdTB + r.ssdTB * c,
      buy: acc.buy + r.buy * c,
    };
  }, zero);
}

const pct = (v: number, max: number) =>
  max > 0 ? Math.round((v / max) * 100) : 0;

function normalize(my: RawMetrics, all: RawMetrics[]): TierMetrics {
  const qualityOf = (r: RawMetrics) => (r.buy > 0 ? r.aiRamGB / r.buy : 0);
  // Speed = RAM-weighted average bandwidth: total compute capability
  // (ramGB × bandwidth, summed) divided by total RAM. Stays at the
  // bandwidth of a single chip when the multi-node setup is homogeneous;
  // blends toward whichever chip family carries more RAM in mixed setups.
  const speedOf = (r: RawMetrics) => (r.aiRamGB > 0 ? r.speed / r.aiRamGB : 0);
  return {
    quality: pct(qualityOf(my), Math.max(...all.map(qualityOf))),
    speed: pct(speedOf(my), Math.max(...all.map(speedOf))),
    storage: pct(my.ssdTB, Math.max(...all.map((r) => r.ssdTB))),
  };
}

export const nodeMetrics = (key: NodeKey): TierMetrics =>
  normalize(nodeRaw(key), TIER_KEYS.map(nodeRaw));

export const multiNodeMetrics = (key: MultiNodeKey): TierMetrics =>
  normalize(multiNodeRaw(key), TIER_KEYS.map(multiNodeRaw));

/**
 * Rack metrics use the multi-node set as the reference scale so the bars
 * communicate where the rack sits relative to multi-node alternatives.
 * Speed is taken as the per-GPU bandwidth (each GPU drives its own VRAM
 * slice) — matching the RAM-weighted-average semantics used for
 * multi-node setups.
 */
function rackRaw(): RawMetrics {
  const gpu = RACK.gpu;
  const ramGB = RACK.aiRam?.gb ?? 0;
  const bw = gpu ? BANDWIDTH[gpu.id] : 0;
  return {
    aiRamGB: ramGB,
    speed: ramGB * bw,
    ssdTB: RACK.ssdTB,
    buy: RACK.buyPrice,
  };
}

export const rackMetrics = (): TierMetrics => {
  const me = rackRaw();
  return normalize(me, [me, ...TIER_KEYS.map(multiNodeRaw)]);
};
