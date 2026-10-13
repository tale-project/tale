'use client';

import type {
  TriggerKind,
  TriggerView,
} from '@tale/shared/schemas/automation-trigger';
import { Badge } from '@tale/ui/badge';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { CircleHelp, Clock, Hand, Radio, Webhook } from 'lucide-react';
import type * as React from 'react';

import { useT } from '@/lib/i18n/client';

import { triggerStateOf, type TriggerState } from '../lib/trigger-summary';

/** What the automations list says starts a row on its own. */
export type TriggerReadiness =
  | { kind: TriggerKind; state: TriggerState }
  /** Nothing is bound: it runs by hand, through the API or MCP. */
  | { kind: 'manual' }
  /** The listing said nothing about it: a server that predates the field. */
  | { kind: 'unknown' };

/**
 * A listing row's trigger as the list reads it: the binding's own state —
 * the same rule as Start's line on the canvas — or nothing bound. A row the
 * server sent without the field is unknown: never read as "no trigger",
 * which would call a schedule that may be running a manual automation.
 */
export function triggerReadinessOf(
  trigger:
    | Pick<TriggerView, 'kind' | 'enabled' | 'lastSkipReason'>
    | null
    | undefined,
  deployed: boolean,
): TriggerReadiness {
  if (trigger === undefined) return { kind: 'unknown' };
  if (trigger === null) return { kind: 'manual' };
  return { kind: trigger.kind, state: triggerStateOf(trigger, deployed) };
}

type BadgeIcon = React.ComponentType<{ className?: string }>;
type BadgeVariant = 'green' | 'yellow' | 'slate' | 'outline';

/** Start's own glyph for each kind of trigger. */
const KIND_ICON: Record<TriggerKind, BadgeIcon> = {
  schedule: Clock,
  webhook: Webhook,
  event: Radio,
};

/** The trigger card's own name for each kind. */
const KIND_KEY: Record<TriggerKind, string> = {
  schedule: 'trigger.kinds.schedule',
  webhook: 'trigger.kinds.webhook',
  event: 'trigger.kinds.event',
};

/**
 * Each state's colour and word, beside the Status column's green Live and
 * yellow Not deployed: a trigger that starts runs reads green, one its
 * failures paused waits for a person in yellow, and one that is off or
 * waits for a live version stays neutral — the deployment beside it already
 * says what is missing. Colour is never the only signal: the word names the
 * state, and the line under it the kind.
 */
const STATE_STYLE: Record<
  TriggerState,
  { variant: BadgeVariant; key: string }
> = {
  on: { variant: 'green', key: 'list.trigger.on' },
  paused: { variant: 'yellow', key: 'list.trigger.paused' },
  off: { variant: 'slate', key: 'list.trigger.off' },
  notLive: { variant: 'slate', key: 'list.trigger.notLive' },
};

/**
 * Whether the row's trigger starts runs on its own: the state in a badge
 * with the kind's glyph, and under it the kind ("Paused", "Schedule"). An
 * automation without a trigger reads how it does run — by hand, the API or
 * MCP — in the same neutral tone as one switched off: nothing is wrong with
 * it. Read-only, like the rest of the row; the words stay whole at the
 * column's width, so nothing needs a hover to be read.
 */
export function TriggerReadinessBadge({
  readiness,
}: {
  readiness: TriggerReadiness;
}) {
  const { t } = useT('automations');
  let variant: BadgeVariant;
  let icon: BadgeIcon;
  let word: string;
  let caption: string | null;
  switch (readiness.kind) {
    case 'manual':
      variant = 'slate';
      icon = Hand;
      word = t('list.trigger.manual');
      caption = t('list.trigger.manualHow');
      break;
    case 'unknown':
      variant = 'outline';
      icon = CircleHelp;
      word = t('list.trigger.unknown');
      caption = null;
      break;
    default: {
      const style = STATE_STYLE[readiness.state];
      variant = style.variant;
      icon = KIND_ICON[readiness.kind];
      word = t(style.key);
      caption = t(KIND_KEY[readiness.kind]);
      break;
    }
  }
  return (
    <Stack gap={0} className="min-w-0">
      <Badge variant={variant} icon={icon} className="self-start">
        {word}
      </Badge>
      {caption !== null && (
        <Text as="span" variant="caption">
          {caption}
        </Text>
      )}
    </Stack>
  );
}
