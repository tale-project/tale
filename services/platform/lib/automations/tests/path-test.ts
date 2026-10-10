/**
 * A test for one possible path of an automation — "Add a test for this
 * path": the stand-ins and expectations that steer a run down a way through
 * its conditions and tolerated failures that no test covers yet.
 *
 * A path (`possiblePaths`, `lib/engine/core/analysis/flow.ts`) is decided by
 * its atoms: whether a node's `when` held, and whether a node with `onError:
 * continue` failed. A failure the path needs is simulated outright, with a
 * stand-in failure for its node. A condition is the run's own to decide —
 * from its input and from what the nodes before it returned — so the test
 * says what each condition needs (in its description, in words the caller
 * gives, since the description is the author's text in the author's
 * language); and where a condition reads the output of one node that calls
 * out and nothing else, the test starts a stand-in for that node from the
 * shape its output has, for the author to fill in. The test expects every
 * node the path decides — one that does not run on every path — to do what
 * the path says it does.
 *
 * Pure and browser-safe: the editor builds the test from the document on
 * screen.
 */

import { analyzeFlow } from '../../engine/core/analysis/flow';
import { stubFromSchema } from '../../engine/core/execute/scope';
import { sourcesOf } from '../../engine/core/syntax/sources';
import type {
  Automation,
  AutomationTest,
  ExpectedNodeState,
  Json,
  NodeDef,
} from '../../engine/core/types';
import { isRecord } from '../../utils/type-utils';

/** What a path asks of a run at one of its atoms. */
export interface PathNeed {
  /** `when:<node>` or `fail:<node>`. */
  atom: string;
  node: string;
  kind: 'when' | 'failure';
  /** The condition holds, or the node fails. */
  value: boolean;
}

export interface PathTest {
  test: AutomationTest;
  /** What the path asks of a run, in the order a run meets it. */
  needs: PathNeed[];
}

/** The message a failure the path needs is simulated with by default. */
export const PATH_FAILURE_MESSAGE = 'simulated failure';

/** The one node whose output `node`'s condition reads, when it reads
 * nothing else — no input, no item, no other node — and parses. */
function onlyOutputRead(node: NodeDef): string | undefined {
  let read: string | undefined;
  for (const source of sourcesOf(node)) {
    if (source.field !== 'when') continue;
    for (const unit of source.units) {
      if (!unit.parse.ok) return undefined;
      for (const site of unit.refs) {
        if (
          site.root !== 'nodes' ||
          site.nodeId === undefined ||
          site.member !== 'output' ||
          (read !== undefined && read !== site.nodeId)
        ) {
          return undefined;
        }
        read = site.nodeId;
      }
    }
  }
  return read;
}

/**
 * A test that takes the path `pathId` of `document`, named `name`, with
 * `input` (the empty object by default); null when the document has no
 * such path — its nodes reference each other in a cycle, it has more
 * conditions than its paths are listed for, or none has that id.
 *
 * `outputShapes` are the inferred shapes of the nodes' outputs (the check's
 * `types`), which a stand-in for a node a condition reads starts from;
 * without one no stand-in is started. `describe` words what a condition
 * needs, one line of the test's description each; without it the test has
 * no description. A failure the path needs is simulated with
 * `failureMessage`.
 */
export function testForPath(args: {
  document: Pick<Automation, 'nodes'>;
  pathId: string;
  name: string;
  input?: Json;
  outputShapes?: Readonly<Record<string, unknown>>;
  describe?: (need: PathNeed) => string | null;
  failureMessage?: string;
}): PathTest | null {
  const flow = analyzeFlow(args.document.nodes);
  const path = flow?.paths.find((candidate) => candidate.id === args.pathId);
  if (flow === null || path === undefined) return null;

  const needs: PathNeed[] = flow.atoms
    .filter((atom) => Object.hasOwn(path.assignment, atom.id))
    .map((atom) => ({
      atom: atom.id,
      node: atom.nodeId,
      kind: atom.kind,
      value: path.assignment[atom.id],
    }));

  const byId = new Map<string, NodeDef>();
  for (const node of args.document.nodes) {
    if (!byId.has(node.id)) byId.set(node.id, node);
  }
  const ran = new Set(path.ran);

  const failures: Record<string, string> = {};
  for (const need of needs) {
    if (need.kind === 'failure' && need.value) {
      failures[need.node] = args.failureMessage ?? PATH_FAILURE_MESSAGE;
    }
  }

  const mocks: Record<string, Json> = {};
  for (const need of needs) {
    if (need.kind !== 'when') continue;
    const gated = byId.get(need.node);
    const read = gated === undefined ? undefined : onlyOutputRead(gated);
    const shape = read === undefined ? undefined : args.outputShapes?.[read];
    if (
      read === undefined ||
      !isRecord(shape) ||
      !ran.has(read) ||
      byId.get(read)?.type === 'transform' ||
      Object.hasOwn(failures, read) ||
      Object.hasOwn(mocks, read)
    ) {
      continue;
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a stub built from a JSON Schema is plain JSON
    mocks[read] = stubFromSchema(shape) as Json;
  }

  const nodes: Record<string, ExpectedNodeState> = {};
  for (const id of flow.order) {
    if (flow.reach(id).always) continue;
    const outcome = flow.outcomeOf(path, id);
    if (outcome === undefined) continue;
    nodes[id] =
      outcome === 'ran' ? 'ran' : outcome === 'error' ? 'failed' : 'skipped';
  }

  const description = needs
    .filter((need) => need.kind === 'when')
    .map((need) => args.describe?.(need) ?? null)
    .filter((line) => line !== null && line !== '')
    .join('\n');

  return {
    test: {
      name: args.name,
      ...(description !== '' && { description }),
      input: args.input ?? {},
      ...(Object.keys(mocks).length > 0 && { mocks }),
      ...(Object.keys(failures).length > 0 && { failures }),
      ...(Object.keys(nodes).length > 0 && { expect: { nodes } }),
    },
    needs,
  };
}
