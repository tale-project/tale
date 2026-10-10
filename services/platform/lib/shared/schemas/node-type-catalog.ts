/**
 * The node-type catalog as the automation editor reads it off the wire
 * (`GET /api/app/automations/catalog/node-types`): one row per connector
 * action, and the connectors those actions belong to, once each.
 *
 * Besides what the editor validates a node against (fields, output kind,
 * whether it writes), a row carries what a person reads on the canvas: the
 * connector it belongs to and the action's title in English with its
 * per-locale overrides. The connector rows carry the display name (with its
 * overrides, for a connector named with ordinary words rather than a brand)
 * and the shipped icon as a data URL. The route builds this shape and the app
 * parses it at the boundary, so a foreign answer is a failed read, never a
 * cast; keys this build does not know are stripped.
 */

import { z } from 'zod';

const nodeTypeSummarySchema = z.object({
  type: z.string(),
  kind: z.enum(['connector', 'core']),
  description: z.string(),
  allowedFields: z.array(z.string()),
  requiredFields: z.array(z.string()),
  outputKind: z.enum(['structured', 'unstructured']),
  hasEffect: z.boolean().optional(),
  /** The connector's catalog slug — the first half of `type`. */
  connector: z.string().optional(),
  /** The action in words, in English ("List issues"). */
  title: z.string().optional(),
  /** Per-locale overrides of `title`: the exact tag, then its base language,
   * then the English. */
  i18n: z
    .record(z.string(), z.object({ title: z.string().optional() }))
    .optional(),
});

const connectorDisplaySchema = z.object({
  name: z.string(),
  displayName: z.string(),
  /** Per-locale overrides of `displayName`; a brand has none. */
  i18n: z
    .record(z.string(), z.object({ displayName: z.string().optional() }))
    .optional(),
  /** The shipped `icon.svg` as a data URL; absent when none ships. */
  iconUrl: z.string().optional(),
});

export const nodeTypeCatalogSchema = z.object({
  nodeTypes: z.array(nodeTypeSummarySchema),
  connectors: z.array(connectorDisplaySchema).default([]),
});

export type NodeTypeCatalog = z.infer<typeof nodeTypeCatalogSchema>;
