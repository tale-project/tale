/**
 * What starts an automation, in the words its Start node shows.
 *
 * The automation's trigger bindings (`listTriggers`) say what can start a
 * run: a schedule, a webhook, a platform event. Every automation can also be
 * started by hand, through the API or MCP, so that line is always there.
 * Each binding carries whether it would fire now: off, waiting for a live
 * version (a trigger always runs the deployed version), or paused after
 * repeated failures.
 *
 * Schedule words come from the cron preview the trigger editor shows under
 * its Cron field ("Every day at 07:00"); a cron it has no words for is
 * shown as written.
 */

import type { FlowRow } from '@tale/ui/flow/types';
import { Clock, Hand, Radio, Webhook } from 'lucide-react';

import {
  cronPatternText,
  previewCronExpression,
  type CronTranslate,
} from './cron-preview';

/** Whether a binding would start a run now, and if not, why. */
export type TriggerState = 'on' | 'off' | 'notLive' | 'paused';

/** A trigger binding, narrowed to what its line reads. */
export interface TriggerBinding {
  kind: string;
  enabled: boolean;
  cron?: string;
  timezone?: string;
  event?: string;
  lastSkipReason?: string | null;
}

export type TriggerLine =
  | {
      kind: 'schedule';
      /** The schedule in words, or the cron as written (`code`). */
      text: string;
      code: boolean;
      zone: string;
      /** The next run, epoch ms, when there is one. */
      nextAt?: number;
      state: TriggerState;
    }
  | { kind: 'webhook'; state: TriggerState }
  | { kind: 'event'; name: string; state: TriggerState }
  | {
      kind: 'manual';
      /** No binding starts it: only by hand. */
      only: boolean;
    };

/**
 * The input wrapper every trigger-started run arrives in
 * (`docs/en/platform/automations/triggers.md`): an `inputs` schema that
 * declares these fields describes the wrapper, not the author's own data.
 */
export const TRIGGER_WRAPPER_KEYS: ReadonlySet<string> = new Set([
  'trigger',
  'firedAt',
  'event',
  'payload',
]);

function stateOf(binding: TriggerBinding, deployed: boolean): TriggerState {
  if (!binding.enabled) {
    return binding.lastSkipReason === 'paused_after_failures'
      ? 'paused'
      : 'off';
  }
  return deployed ? 'on' : 'notLive';
}

/**
 * One line per binding the canvas can say, then the line every automation
 * has: by hand, the API or MCP.
 */
export function triggerLines(
  bindings: readonly TriggerBinding[],
  ctx: {
    /** A version is deployed: a trigger has something to run. */
    deployed: boolean;
    t: CronTranslate;
    now?: Date;
  },
): TriggerLine[] {
  const lines: TriggerLine[] = [];
  for (const binding of bindings) {
    const state = stateOf(binding, ctx.deployed);
    switch (binding.kind) {
      case 'schedule': {
        const cron = binding.cron ?? '';
        const zone = binding.timezone ?? 'UTC';
        const preview = previewCronExpression(cron, zone, ctx.now);
        const words =
          preview.kind === 'ok'
            ? cronPatternText(preview.pattern, ctx.t)
            : undefined;
        lines.push({
          kind: 'schedule',
          text: words ?? cron,
          code: words === undefined,
          zone,
          ...(preview.kind === 'ok' && { nextAt: preview.nextAt.getTime() }),
          state,
        });
        break;
      }
      case 'webhook':
        lines.push({ kind: 'webhook', state });
        break;
      case 'event':
        if (binding.event !== undefined && binding.event !== '') {
          lines.push({ kind: 'event', name: binding.event, state });
        }
        break;
      default:
        // Another kind (an API key binding) starts runs through the API,
        // which the line below already says.
        break;
    }
  }
  lines.push({ kind: 'manual', only: lines.length === 0 });
  return lines;
}

function badgeOf(
  state: TriggerState,
  t: CronTranslate,
): FlowRow['badge'] | undefined {
  switch (state) {
    case 'off':
      return { label: t('canvas.start.off'), tone: 'neutral' };
    case 'notLive':
      return { label: t('canvas.start.notLive'), tone: 'neutral' };
    case 'paused':
      return { label: t('trigger.paused'), tone: 'warning' };
    default:
      // `on`: it starts runs, nothing to say beside it.
      return undefined;
  }
}

/** The lines as Start's rows: an icon, the words, the next run, a state. */
export function triggerRows(
  lines: readonly TriggerLine[],
  ctx: { t: CronTranslate; formatDate: (at: Date) => string },
): FlowRow[] {
  const { t } = ctx;
  return lines.map((line, index): FlowRow => {
    const id = `trigger:${index}`;
    switch (line.kind) {
      case 'schedule': {
        const badge = badgeOf(line.state, t);
        const runs = line.state === 'on' || line.state === 'notLive';
        return {
          id,
          icon: Clock,
          label: t('canvas.start.scheduleZone', {
            schedule: line.text,
            zone: line.zone,
          }),
          ...(line.code && { code: true }),
          ...(runs &&
            line.nextAt !== undefined && {
              note: t('trigger.cronNext', {
                at: ctx.formatDate(new Date(line.nextAt)),
              }),
            }),
          ...(badge !== undefined && { badge }),
        };
      }
      case 'webhook': {
        const badge = badgeOf(line.state, t);
        return {
          id,
          icon: Webhook,
          label: t('canvas.start.webhook'),
          ...(badge !== undefined && { badge }),
        };
      }
      case 'event': {
        const badge = badgeOf(line.state, t);
        return {
          id,
          icon: Radio,
          label: t('canvas.start.event', { event: line.name }),
          ...(badge !== undefined && { badge }),
        };
      }
      default:
        // `manual`: by hand, the API or MCP.
        return {
          id: 'trigger:manual',
          icon: Hand,
          label: line.only
            ? t('canvas.start.manualOnly')
            : t('canvas.start.manual'),
        };
    }
  });
}
