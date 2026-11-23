/**
 * The chart turn: `[[mock:run-code]]` makes the mock answer a chat turn
 * that offers the light sandbox's `run_code` tool with a call of it, as a
 * model asked for a chart answers: a Python program that draws a bar chart
 * with matplotlib and writes it to `/agent/output/`, where the platform
 * picks it up as the turn's file. The request that carries the result is
 * answered in prose, so the turn ends. The memory benchmark (`src/budget`)
 * sends it: finding 1's chat turn that runs `run_code` (tale#4942).
 */

import type { Random } from './random.ts';
import {
  valueForSchema,
  type ArgumentHints,
  type OfferedTool,
} from './tool-args.ts';

/** The name the platform offers its light sandbox's tool under. */
const RUN_CODE_TOOL = 'run_code';

/** The `run_code` tool among `tools`, or null when the turn offers none. */
export function findRunCodeTool(
  tools: readonly OfferedTool[],
): OfferedTool | null {
  return tools.find((tool) => tool.name === RUN_CODE_TOOL) ?? null;
}

/** What the chart program prints once it wrote its file. */
const CHART_WRITTEN = 'chart written to /agent/output/quarterly-revenue.png';

/** A small chart, the way a model writes one: matplotlib, no display. */
export const CHART_PROGRAM = [
  'import matplotlib',
  "matplotlib.use('Agg')",
  'import matplotlib.pyplot as plt',
  '',
  "quarters = ['Q1', 'Q2', 'Q3', 'Q4']",
  'revenue = [120, 135, 128, 150]',
  'fig, ax = plt.subplots(figsize=(6, 4), dpi=150)',
  "bars = ax.bar(quarters, revenue, color='#4f6bed')",
  "ax.bar_label(bars, fmt='%d')",
  "ax.set_ylabel('Revenue (kCHF)')",
  "ax.set_title('Revenue by quarter')",
  'fig.tight_layout()',
  "fig.savefig('/agent/output/quarterly-revenue.png')",
  `print('${CHART_WRITTEN}')`,
].join('\n');

/**
 * The arguments of the call: the chart program in Python. Any other
 * required property is generated from its schema, so the call validates.
 */
export function runCodeArguments(
  random: Random,
  tool: OfferedTool,
  hints: ArgumentHints,
): Record<string, unknown> {
  const args: Record<string, unknown> = {
    language: 'python',
    code: CHART_PROGRAM,
  };
  const properties = tool.parameters.properties;
  const required = tool.parameters.required;
  if (
    Array.isArray(required) &&
    typeof properties === 'object' &&
    properties !== null
  ) {
    for (const key of required) {
      if (typeof key !== 'string' || key in args) continue;
      args[key] = valueForSchema(
        random,
        (properties as Record<string, unknown>)[key],
        key,
        hints,
      );
    }
  }
  return args;
}
