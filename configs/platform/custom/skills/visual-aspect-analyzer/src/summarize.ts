// Agent-readable views over a Report: defect coalescing, remediation hints, and
// an overall visual-health score. Pure and tested; the CLIs render these, but
// the core Report stays a faithful record without editorial.

import { clamp } from './geometry';
import type { Defect, DefectMetrics, DefectType, Report } from './types';

export type CoalescedDefect = {
  type: DefectType;
  selector: string;
  /** Highest severity seen for this (type, selector). */
  severity: number;
  /** How many raw defects of this (type, selector) were folded together. */
  count: number;
  window: readonly [number, number];
  /** The detail of the worst occurrence. */
  detail: string;
  /** The raw metrics of the worst occurrence (same one `detail` came from). */
  metrics: DefectMetrics;
};

export type Summary = {
  /** Visual-health score, 0 (broken) .. 100 (flawless). */
  score: number;
  headline: string;
  elements: number;
  matched: number;
  affected: number;
  transitions: number;
  smoothTransitions: number;
  defectsByType: Record<DefectType, number>;
  /** The highest-severity distinct defects, worst first. */
  worst: CoalescedDefect[];
  /** One remediation hint per defect type present. */
  hints: string[];
};

// Per-defect-type metadata, single source of truth: `weight` is how much the
// type subtracts from the score (scaled by severity, capped at weight); `hint`
// is the remediation shown to the consumer.
const DEFECT_META: Record<DefectType, { weight: number; hint: string }> = {
  'layout-shift': {
    weight: 45,
    hint: 'Reserve space for late content (width/height or aspect-ratio) to avoid CLS.',
  },
  jank: {
    weight: 30,
    hint: 'Animate compositor-friendly properties (transform/opacity); avoid layout-triggering changes mid-animation.',
  },
  flicker: {
    weight: 25,
    hint: 'Stop toggling visibility/display rapidly; cross-fade with a single opacity transition.',
  },
  dithering: {
    weight: 12,
    hint: 'A static region is repainting — check animated gradients/filters or sub-pixel jitter.',
  },
};

// Iterated in a fixed order for deterministic output.
export const ALL_TYPES: readonly DefectType[] = [
  'layout-shift',
  'jank',
  'flicker',
  'dithering',
];

/** A fresh zero count for every defect type. */
function zeroByType(): Record<DefectType, number> {
  return { 'layout-shift': 0, jank: 0, flicker: 0, dithering: 0 };
}

/** The remediation hint for a defect type. */
export function hintFor(type: DefectType): string {
  return DEFECT_META[type].hint;
}

/**
 * Fold raw defects into one entry per (type, selector) — keeping the worst
 * severity/detail, the occurrence count, and the merged window — sorted worst
 * first. Turns six identical flicker bursts into one actionable issue.
 */
export function coalesceDefects(defects: readonly Defect[]): CoalescedDefect[] {
  const groups = new Map<string, CoalescedDefect>();
  for (const d of defects) {
    const id = `${d.type}|${d.selector}`;
    const existing = groups.get(id);
    if (existing) {
      existing.count++;
      // Strict `>` so `detail` and `metrics` always describe the SAME (first,
      // worst) occurrence — a tie keeps the earlier one.
      if (d.severity > existing.severity) {
        existing.severity = d.severity;
        existing.detail = d.detail;
        existing.metrics = d.metrics;
      }
      existing.window = [
        Math.min(existing.window[0], d.window[0]),
        Math.max(existing.window[1], d.window[1]),
      ];
    } else {
      groups.set(id, {
        type: d.type,
        selector: d.selector,
        severity: d.severity,
        count: 1,
        window: d.window,
        detail: d.detail,
        metrics: d.metrics,
      });
    }
  }
  // Worst first; tie-break on defect-type order then selector so equal-severity
  // defects keep a stable order. This feeds the AI-consumed compact report
  // (compact.ts), so deterministic output stays diffable and snapshot-testable.
  return [...groups.values()].sort(
    (a, b) =>
      b.severity - a.severity ||
      ALL_TYPES.indexOf(a.type) - ALL_TYPES.indexOf(b.type) ||
      // Code-point order, not locale-aware, so the sort is reproducible anywhere.
      (a.selector < b.selector ? -1 : a.selector > b.selector ? 1 : 0),
  );
}

export function summarize(report: Report): Summary {
  const defectsByType = zeroByType();
  // Accumulate severity per type, then cap each type's penalty at its weight so
  // one noisy type (e.g. persistent flicker) can't alone zero the score.
  const severityByType = zeroByType();
  for (const defect of report.defects) {
    defectsByType[defect.type]++;
    severityByType[defect.type] += defect.severity;
  }
  let penalty = 0;
  for (const type of ALL_TYPES) {
    penalty += DEFECT_META[type].weight * clamp(severityByType[type], 0, 1);
  }
  // The score is the one-glance gate ("investigate anything < 100"), so any
  // listed defect must move it off 100 — even a sub-rounding severity (e.g. a
  // CLS of 1e-4) whose weighted penalty would otherwise round away to 0. Cap at
  // 99 whenever a defect is present, so `score === 100` provably means "zero
  // defects" and the gate can never silently clear a real, reported issue.
  const raw = Math.round(clamp(100 - penalty, 0, 100));
  const score = report.defects.length > 0 ? Math.min(raw, 99) : raw;

  const matched = report.elements.filter((e) => e.source === 'matched').length;
  const affected = report.elements.length - matched;
  const smoothTransitions = report.transitions.filter(
    (t) => t.smoothness === 'smooth',
  ).length;

  const worst = coalesceDefects(report.defects).slice(0, 5);
  const hints = ALL_TYPES.filter((t) => defectsByType[t] > 0).map((t) =>
    hintFor(t),
  );

  const counts = ALL_TYPES.filter((t) => defectsByType[t] > 0)
    .map((t) => `${defectsByType[t]} ${t}`)
    .join(', ');
  const headline =
    report.defects.length === 0
      ? `Visual health ${score}/100 — no defects across ${report.elements.length} element(s).`
      : `Visual health ${score}/100 — ${counts} across ${report.elements.length} element(s).`;

  return {
    score,
    headline,
    elements: report.elements.length,
    matched,
    affected,
    transitions: report.transitions.length,
    smoothTransitions,
    defectsByType,
    worst,
    hints,
  };
}
