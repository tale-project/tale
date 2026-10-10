/**
 * What a node's box on the canvas says: an icon, its title, what kind of
 * node it is ("GitHub · List issues", "Language model · claude-haiku-4-5"),
 * what it returns, and the marks that change how it behaves (it writes, it
 * may ask, it goes on after a failure).
 *
 * Built from the document and the node-type catalog alone, so the box
 * reads the same for every viewer. What it returns comes from the draft
 * check's inferred types when the reader may have the document checked;
 * the row is reserved until the check answers, so its arrival never moves
 * a box.
 */

import type { FlowChip, FlowIcon, FlowMarker } from '@tale/ui/flow/types';
import { VendorIcon } from '@tale/ui/vendor-icon';
import {
  Bot,
  Braces,
  CircleHelp,
  MessageCircleQuestion,
  PinOff,
  ShieldCheck,
  Sparkles,
  Workflow,
} from 'lucide-react';
import { createElement } from 'react';

import type { NodeDef } from '@/lib/engine/core/types';
import { isUnknown, toTs, type Shape } from '@/lib/engine/core/typing/shape';
import type { NodeTypeCatalog } from '@/lib/shared/schemas/node-type-catalog';

import type { NodeTypeSummary } from '../hooks/backend';
import type { ConditionTranslate } from './condition-text';
import { humanizeNodeId } from './node-label';

export type ConnectorDisplay = NodeTypeCatalog['connectors'][number];

/** The node-type catalog, keyed for lookups. */
export interface NodeCatalogView {
  types: ReadonlyMap<string, NodeTypeSummary>;
  connectors: ReadonlyMap<string, ConnectorDisplay>;
}

export function nodeCatalogView(
  nodeTypes: readonly NodeTypeSummary[],
  connectors: readonly ConnectorDisplay[] = [],
): NodeCatalogView {
  return {
    types: new Map(nodeTypes.map((def) => [def.type, def])),
    connectors: new Map(connectors.map((entry) => [entry.name, entry])),
  };
}

/** What the draft check said each node returns, when the reader may have
 *  the document checked. */
export interface ReturnsSource {
  /**
   * `off`: nobody checks this document for this reader (no row at all);
   * `pending`: no answer yet (the row is reserved);
   * `ready`/`failed`: the last answer, or none when the check failed.
   */
  status: 'off' | 'pending' | 'ready' | 'failed';
  outputs: Readonly<Record<string, Shape>> | null;
}

export interface NodeFaceContext {
  t: ConditionTranslate;
  locale: string;
  catalog: NodeCatalogView;
  /** A served model's display name; the id as written when unknown. */
  modelLabel?: (id: string) => string | undefined;
  returns: ReturnsSource;
}

/** A node's title on its box: its id in words, capitalised ("Open
 *  issues"). Sentences about nodes use the same title, so a reader finds
 *  the box a sentence names. */
export function nodeTitle(id: string): string {
  const words = humanizeNodeId(id);
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const CORE_ICONS: Readonly<Record<string, FlowIcon>> = {
  transform: Braces,
  llm: Sparkles,
  agent: Bot,
  subautomation: Workflow,
};

const CORE_TYPES: ReadonlySet<string> = new Set(Object.keys(CORE_ICONS));

/** A per-URL icon component: a box re-rendering with the same connector
 *  keeps the same component, and so its loaded image. */
const vendorIcons = new Map<string, FlowIcon>();

function vendorIcon(url: string | undefined): FlowIcon {
  const key = url ?? '';
  let icon = vendorIcons.get(key);
  if (icon === undefined) {
    const Icon = ({ className }: { className?: string }) =>
      createElement(VendorIcon, {
        ...(url !== undefined && { iconUrl: url }),
        ...(className !== undefined && { className }),
      });
    Icon.displayName = 'ConnectorIcon';
    icon = Icon;
    vendorIcons.set(key, icon);
  }
  return icon;
}

/** A per-locale override: the exact tag, then its base language, then
 *  the English. */
function localized<T extends string>(
  english: string | undefined,
  overrides: Readonly<Record<string, Partial<Record<T, string>>>> | undefined,
  field: T,
  locale: string,
): string | undefined {
  const base = locale.split('-')[0] ?? locale;
  return overrides?.[locale]?.[field] ?? overrides?.[base]?.[field] ?? english;
}

/** The connector a `<connector>.<action>` type belongs to, and the action. */
function connectorParts(
  type: string,
): { connector: string; action: string } | null {
  const dot = type.indexOf('.');
  if (dot <= 0 || dot === type.length - 1) return null;
  return { connector: type.slice(0, dot), action: type.slice(dot + 1) };
}

/** A connector's name in the reader's language. */
export function connectorName(
  slug: string,
  catalog: NodeCatalogView,
  locale: string,
): string {
  const entry = catalog.connectors.get(slug);
  if (entry === undefined) return slug;
  return (
    localized(entry.displayName, entry.i18n, 'displayName', locale) ?? slug
  );
}

/** A connector action's title in the reader's language: the catalog's,
 *  else its name in words ("List issues"). */
export function actionTitle(
  type: string,
  catalog: NodeCatalogView,
  locale: string,
): string {
  const entry = catalog.types.get(type);
  const dot = type.indexOf('.');
  return (
    localized(entry?.title, entry?.i18n, 'title', locale) ??
    nodeTitle(dot === -1 ? type : type.slice(dot + 1))
  );
}

/** The node's icon: the connector's own, or one per core type. */
export function nodeIcon(node: NodeDef, catalog: NodeCatalogView): FlowIcon {
  const core = CORE_ICONS[node.type];
  if (core !== undefined) return core;
  const parts = connectorParts(node.type);
  if (parts === null) return CircleHelp;
  return vendorIcon(catalog.connectors.get(parts.connector)?.iconUrl);
}

/** A core type's word: "Transform", "Language model", "Agent". */
export function coreTypeWord(type: string, t: ConditionTranslate): string {
  switch (type) {
    case 'llm':
      return t('canvas.node.catalog.llm');
    case 'agent':
      return t('canvas.node.catalog.agent');
    default:
      return t('canvas.node.catalog.transform');
  }
}

/** "GitHub · List issues", "Transform", "Language model · claude-haiku-4-5". */
export function catalogLabel(node: NodeDef, ctx: NodeFaceContext): string {
  const { t, catalog, locale } = ctx;
  if (CORE_TYPES.has(node.type)) {
    if (node.type === 'subautomation') {
      return typeof node.automation === 'string' && node.automation !== ''
        ? t('canvas.node.catalog.subautomation', {
            automation: humanizeNodeId(
              node.automation.split('/').at(-1) ?? node.automation,
            ),
          })
        : t('canvas.node.catalog.subautomationUnset');
    }
    const type = coreTypeWord(node.type, t);
    if (
      (node.type === 'llm' || node.type === 'agent') &&
      typeof node.model === 'string' &&
      node.model !== ''
    ) {
      return t('canvas.node.catalog.withModel', {
        type,
        model: ctx.modelLabel?.(node.model) ?? node.model,
      });
    }
    return type;
  }
  const parts = connectorParts(node.type);
  if (parts === null) {
    return t('canvas.node.catalog.unknown', { type: node.type });
  }
  return t('canvas.node.catalog.connector', {
    connector: connectorName(parts.connector, catalog, locale),
    action: actionTitle(node.type, catalog, locale),
  });
}

/**
 * An agent that names a model but not a provider — the same predicate the
 * store uses for `deployedUnpinnedAgentNodes`. The run walks connectors at
 * kick time; the editor's preselect can look pinned.
 */
function agentHasUnpinnedModel(node: NodeDef): boolean {
  if (node.type !== 'agent') return false;
  if (typeof node.model !== 'string' || node.model === '') return false;
  return typeof node.modelProvider !== 'string' || node.modelProvider === '';
}

/** What the node returns: a shape, a sentence, a reserved row, or none. */
function returnsOf(
  node: NodeDef,
  ctx: NodeFaceContext,
): { text: string; code: boolean } | null | undefined {
  const { status, outputs } = ctx.returns;
  if (status === 'off') return undefined;
  const known = CORE_TYPES.has(node.type) || connectorParts(node.type) !== null;
  if (!known) return undefined;
  const shape = outputs?.[node.id];
  if (shape === undefined) {
    return status === 'pending'
      ? null
      : { text: ctx.t('canvas.node.returnsUnknown'), code: false };
  }
  return isUnknown(shape)
    ? { text: ctx.t('canvas.node.returnsUnknown'), code: false }
    : { text: toTs(shape, 1), code: true };
}

export interface NodeFace {
  label: string;
  icon: FlowIcon;
  typeLabel: string;
  returns: { text: string; code: boolean } | null | undefined;
  chips: FlowChip[];
  markers: FlowMarker[];
  /** The sentences the chips, markers and returns row stand for. */
  sentences: string[];
}

/** Everything a node's box says that comes from the node itself. */
export function nodeFace(node: NodeDef, ctx: NodeFaceContext): NodeFace {
  const { t, catalog, locale } = ctx;
  const chips: FlowChip[] = [];
  const markers: FlowMarker[] = [];
  const sentences: string[] = [];
  const returns = returnsOf(node, ctx);
  if (returns?.code === true) {
    sentences.push(t('canvas.node.returns', { shape: returns.text }));
  } else if (returns !== undefined && returns !== null) {
    sentences.push(returns.text);
  }
  if (node.onError === 'continue') {
    const label = t('canvas.controlFlow.onError');
    chips.push({ id: 'onError', label, tone: 'error' });
    sentences.push(label);
  }
  const parts = connectorParts(node.type);
  if (parts !== null && catalog.types.get(node.type)?.hasEffect === true) {
    const label = t('canvas.node.writes', {
      connector: connectorName(parts.connector, catalog, locale),
    });
    markers.push({ id: 'writes', icon: ShieldCheck, label });
    sentences.push(label);
  }
  if (node.type === 'agent') {
    const label = t('canvas.node.asks');
    markers.push({ id: 'asks', icon: MessageCircleQuestion, label });
    sentences.push(label);
  }
  if (agentHasUnpinnedModel(node)) {
    // A note, not a problem: a muted glyph of its own, so it never reads
    // as a warning the issue count beside it leaves out.
    const label = t('canvas.unpinnedModel');
    markers.push({ id: 'unpinnedModel', icon: PinOff, label });
    sentences.push(label);
  }
  return {
    label: nodeTitle(node.id),
    icon: nodeIcon(node, catalog),
    typeLabel: catalogLabel(node, ctx),
    returns,
    chips,
    markers,
    sentences,
  };
}
