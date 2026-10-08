/**
 * The analysis pass: what a document does when it runs, read from the
 * document alone — the shape of every value (`../typing`), which nodes run
 * on which ways a run can go (`./flow`), and the findings both make
 * possible (`./rules`), plus the per-node summary and the possible paths
 * (`./summary`).
 *
 * Browser-safe: nothing here (or below it) loads the schema validator, so an
 * editor can run the same analysis on a draft. Every finding is built from
 * this call's own state; nothing is cached between calls.
 *
 * A reference cycle leaves no way to order the nodes: the flow findings and
 * the summary are skipped (the reference pass reports the cycle), the rest
 * still runs.
 */

import type { Issue } from '../types';
import { inferTypes, type AutomationTypes } from '../typing/infer';
import { ruleContext, type AnalysisInput } from './context';
import { analyzeFlow } from './flow';
import { conditionRules } from './rules/conditions';
import { flowRules } from './rules/flow';
import { iterationRules } from './rules/iteration';
import { nameRules } from './rules/names';
import { testRules } from './rules/tests';
import { nullInterpolations, typeRules } from './rules/types';
import { summarize, type AutomationAnalysis } from './summary';

export type { AnalysisInput } from './context';
export type {
  AutomationAnalysis,
  FailureReason,
  NodeAnalysis,
  SuccessPath,
} from './summary';

export interface AnalysisResult {
  /** The findings, in rule order. */
  issues: Issue[];
  /** The shape of every node's output, the run input and the result. */
  types: AutomationTypes;
  /** The per-node summary and the paths; absent on a reference cycle. */
  analysis?: AutomationAnalysis;
}

export function analyze(input: AnalysisInput): AnalysisResult {
  const types = inferTypes(
    { inputs: input.doc.inputs, nodes: input.nodes, output: input.doc.output },
    {
      parse: input.parse,
      ...(input.children !== undefined && { children: input.children }),
    },
  );
  const flow = analyzeFlow(input.nodes);
  const cx = ruleContext(input, types, flow);

  const issues: Issue[] = [];
  iterationRules(cx, issues);
  nameRules(cx, issues);
  conditionRules(cx, issues);
  typeRules(cx, issues);
  const flowIssues: Issue[] = [];
  if (flow !== null) flowRules(cx, flow, flowIssues);
  nullInterpolations(cx, flowIssues, issues);
  issues.push(...flowIssues);
  testRules(cx, issues);

  if (flow === null) return { issues, types };
  return {
    issues,
    types,
    analysis: summarize(cx, flow, [...input.issues, ...issues]),
  };
}
