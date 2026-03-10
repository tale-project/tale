import { describe, expect, it } from 'vitest';

import { computeStepOrder } from './compute_step_order';

function step(
  stepSlug: string,
  stepType: string,
  nextSteps: Record<string, string>,
) {
  return { stepSlug, stepType, nextSteps };
}

function getOrder(result: Map<string, number>, slug: string) {
  const order = result.get(slug);
  expect(order).toBeDefined();
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- guaranteed by expect above
  return order as number;
}

describe('computeStepOrder', () => {
  it('returns empty map for empty steps', () => {
    expect(computeStepOrder([])).toEqual(new Map());
  });

  it('assigns order 1 to a single start step', () => {
    const result = computeStepOrder([
      step('start', 'start', { success: 'noop' }),
    ]);
    expect(result.get('start')).toBe(1);
  });

  it('handles linear workflow', () => {
    const result = computeStepOrder([
      step('start', 'start', { success: 'a' }),
      step('a', 'action', { success: 'b' }),
      step('b', 'action', { success: 'output' }),
      step('output', 'output', {}),
    ]);
    expect(result.get('start')).toBe(1);
    expect(result.get('a')).toBe(2);
    expect(result.get('b')).toBe(3);
    expect(result.get('output')).toBe(4);
  });

  it('handles condition branching (diverge then merge)', () => {
    const result = computeStepOrder([
      step('start', 'start', { success: 'cond' }),
      step('cond', 'condition', { true: 'branch_a', false: 'branch_b' }),
      step('branch_a', 'action', { success: 'merge' }),
      step('branch_b', 'action', { success: 'merge' }),
      step('merge', 'action', { success: 'output' }),
      step('output', 'output', {}),
    ]);

    expect(result.get('start')).toBe(1);
    expect(result.get('cond')).toBe(2);

    const branchAOrder = getOrder(result, 'branch_a');
    const branchBOrder = getOrder(result, 'branch_b');
    const mergeOrder = getOrder(result, 'merge');
    expect(branchAOrder).toBeLessThan(mergeOrder);
    expect(branchBOrder).toBeLessThan(mergeOrder);
    expect(result.get('output')).toBe(6);
  });

  it('handles diamond/fan-in pattern', () => {
    const result = computeStepOrder([
      step('start', 'start', { success: 'cond' }),
      step('cond', 'condition', { true: 'a', false: 'b' }),
      step('a', 'action', { success: 'join' }),
      step('b', 'action', { success: 'join' }),
      step('join', 'output', {}),
    ]);

    const joinOrder = getOrder(result, 'join');
    expect(getOrder(result, 'a')).toBeLessThan(joinOrder);
    expect(getOrder(result, 'b')).toBeLessThan(joinOrder);
  });

  it('handles loop with body step pointing back', () => {
    const result = computeStepOrder([
      step('start', 'start', { success: 'loop_items' }),
      step('loop_items', 'loop', { loop: 'process_item', done: 'after_loop' }),
      step('process_item', 'action', { success: 'loop_items' }),
      step('after_loop', 'output', {}),
    ]);

    expect(result.get('start')).toBe(1);
    expect(result.get('loop_items')).toBe(2);
    expect(result.get('process_item')).toBe(3);
    expect(result.get('after_loop')).toBe(4);
  });

  it('handles loop with multiple body steps', () => {
    const result = computeStepOrder([
      step('start', 'start', { success: 'loop' }),
      step('loop', 'loop', { loop: 'step_a', done: 'output' }),
      step('step_a', 'action', { success: 'step_b' }),
      step('step_b', 'action', { success: 'loop' }),
      step('output', 'output', {}),
    ]);

    expect(result.get('start')).toBe(1);
    expect(result.get('loop')).toBe(2);
    expect(result.get('step_a')).toBe(3);
    expect(result.get('step_b')).toBe(4);
    expect(result.get('output')).toBe(5);
  });

  it('handles loop with condition inside body', () => {
    const result = computeStepOrder([
      step('start', 'start', { success: 'loop' }),
      step('loop', 'loop', { loop: 'search', done: 'output' }),
      step('search', 'action', { success: 'check' }),
      step('check', 'condition', { true: 'compare', false: 'loop' }),
      step('compare', 'action', { success: 'accumulate' }),
      step('accumulate', 'action', { success: 'loop' }),
      step('output', 'output', {}),
    ]);

    expect(result.get('start')).toBe(1);
    expect(result.get('loop')).toBe(2);
    expect(result.get('search')).toBe(3);
    expect(result.get('check')).toBe(4);
    expect(result.get('compare')).toBe(5);
    expect(result.get('accumulate')).toBe(6);
    expect(result.get('output')).toBe(7);
  });

  it('handles sequential loops (not nested)', () => {
    const result = computeStepOrder([
      step('start', 'start', { success: 'loop1' }),
      step('loop1', 'loop', { loop: 'body1', done: 'loop2' }),
      step('body1', 'action', { success: 'loop1' }),
      step('loop2', 'loop', { loop: 'body2', done: 'output' }),
      step('body2', 'action', { success: 'loop2' }),
      step('output', 'output', {}),
    ]);

    expect(result.get('start')).toBe(1);
    expect(result.get('loop1')).toBe(2);
    expect(result.get('body1')).toBe(3);
    expect(result.get('loop2')).toBe(4);
    expect(result.get('body2')).toBe(5);
    expect(result.get('output')).toBe(6);
  });

  it('handles noop terminal in condition branch', () => {
    const result = computeStepOrder([
      step('start', 'start', { success: 'check' }),
      step('check', 'condition', { true: 'process', false: 'noop' }),
      step('process', 'action', { success: 'noop' }),
    ]);

    expect(result.get('start')).toBe(1);
    expect(result.get('check')).toBe(2);
    expect(result.get('process')).toBe(3);
  });

  it('assigns max+1 to orphaned/unreachable steps', () => {
    const result = computeStepOrder([
      step('start', 'start', { success: 'a' }),
      step('a', 'action', { success: 'noop' }),
      step('orphan', 'action', { success: 'noop' }),
    ]);

    expect(result.get('start')).toBe(1);
    expect(result.get('a')).toBe(2);
    expect(result.get('orphan')).toBe(3); // max (2) + 1
  });

  it('handles trigger step as start', () => {
    const result = computeStepOrder([
      step('trigger', 'trigger', { success: 'a' }),
      step('a', 'action', { success: 'noop' }),
    ]);

    expect(result.get('trigger')).toBe(1);
    expect(result.get('a')).toBe(2);
  });

  it('handles workflow with no start/trigger step (falls back to in-degree 0)', () => {
    const result = computeStepOrder([
      step('a', 'action', { success: 'b' }),
      step('b', 'action', { success: 'noop' }),
    ]);

    expect(result.get('a')).toBe(1);
    expect(result.get('b')).toBe(2);
  });

  it('matches gmail-email-sync workflow ordering', () => {
    const result = computeStepOrder([
      step('start', 'start', { success: 'query_latest_inbound_message' }),
      step('query_latest_inbound_message', 'action', {
        success: 'check_has_cursor',
      }),
      step('check_has_cursor', 'condition', {
        true: 'fetch_new_emails',
        false: 'fetch_latest_email',
      }),
      step('fetch_latest_email', 'action', { success: 'check_has_emails' }),
      step('fetch_new_emails', 'action', { success: 'check_has_emails' }),
      step('check_has_emails', 'condition', {
        true: 'set_thread_id',
        false: 'noop',
      }),
      step('set_thread_id', 'action', { success: 'fetch_thread_messages' }),
      step('fetch_thread_messages', 'action', {
        success: 'insert_email_to_conversation',
      }),
      step('insert_email_to_conversation', 'action', { success: 'noop' }),
    ]);

    // Start is always 1
    expect(result.get('start')).toBe(1);
    expect(result.get('query_latest_inbound_message')).toBe(2);
    expect(result.get('check_has_cursor')).toBe(3);

    // Both branches should be before check_has_emails (fan-in)
    const fetchLatest = getOrder(result, 'fetch_latest_email');
    const fetchNew = getOrder(result, 'fetch_new_emails');
    const checkHas = getOrder(result, 'check_has_emails');
    expect(fetchLatest).toBeLessThan(checkHas);
    expect(fetchNew).toBeLessThan(checkHas);

    // Rest follows linearly after check_has_emails
    expect(getOrder(result, 'set_thread_id')).toBeGreaterThan(checkHas);
    expect(getOrder(result, 'fetch_thread_messages')).toBeGreaterThan(
      getOrder(result, 'set_thread_id'),
    );
    expect(getOrder(result, 'insert_email_to_conversation')).toBeGreaterThan(
      getOrder(result, 'fetch_thread_messages'),
    );
  });

  it('assigns all steps an order (no undefined values)', () => {
    const steps = [
      step('start', 'start', { success: 'a' }),
      step('a', 'action', { success: 'b' }),
      step('b', 'action', { success: 'noop' }),
      step('c', 'action', { success: 'noop' }),
    ];
    const result = computeStepOrder(steps);
    for (const s of steps) {
      expect(result.has(s.stepSlug)).toBe(true);
      expect(typeof result.get(s.stepSlug)).toBe('number');
    }
  });

  it('handles intermediate step before loop', () => {
    const result = computeStepOrder([
      step('start', 'start', { success: 'init' }),
      step('init', 'action', { success: 'loop' }),
      step('loop', 'loop', { loop: 'body_a', done: 'after' }),
      step('body_a', 'action', { success: 'body_b' }),
      step('body_b', 'action', { success: 'loop' }),
      step('after', 'output', {}),
    ]);

    expect(result.get('start')).toBe(1);
    expect(result.get('init')).toBe(2);
    expect(result.get('loop')).toBe(3);
    expect(result.get('body_a')).toBe(4);
    expect(result.get('body_b')).toBe(5);
    expect(result.get('after')).toBe(6);
  });

  it('handles multiple intermediate steps before loop', () => {
    const result = computeStepOrder([
      step('start', 'start', { success: 'step1' }),
      step('step1', 'action', { success: 'step2' }),
      step('step2', 'action', { success: 'loop' }),
      step('loop', 'loop', { loop: 'body', done: 'output' }),
      step('body', 'action', { success: 'loop' }),
      step('output', 'output', {}),
    ]);

    expect(result.get('start')).toBe(1);
    expect(result.get('step1')).toBe(2);
    expect(result.get('step2')).toBe(3);
    expect(result.get('loop')).toBe(4);
    expect(result.get('body')).toBe(5);
    expect(result.get('output')).toBe(6);
  });

  it('handles multiple predecessors feeding into a loop', () => {
    const result = computeStepOrder([
      step('start', 'start', { success: 'cond' }),
      step('cond', 'condition', { true: 'path_a', false: 'path_b' }),
      step('path_a', 'action', { success: 'loop' }),
      step('path_b', 'action', { success: 'loop' }),
      step('loop', 'loop', { loop: 'body', done: 'output' }),
      step('body', 'action', { success: 'loop' }),
      step('output', 'output', {}),
    ]);

    expect(result.get('start')).toBe(1);
    expect(result.get('cond')).toBe(2);

    // Both paths feed into the loop — neither is a back-edge
    const pathA = getOrder(result, 'path_a');
    const pathB = getOrder(result, 'path_b');
    const loopOrder = getOrder(result, 'loop');
    expect(pathA).toBeLessThan(loopOrder);
    expect(pathB).toBeLessThan(loopOrder);

    // Body is inside loop, after comes last
    expect(getOrder(result, 'body')).toBeGreaterThan(loopOrder);
    expect(getOrder(result, 'output')).toBeGreaterThan(
      getOrder(result, 'body'),
    );
  });

  it('handles contract-comparison workflow (full 12-step real-world test)', () => {
    const result = computeStepOrder([
      step('start', 'start', { success: 'init_variables' }),
      step('init_variables', 'action', { success: 'loop_comparison_files' }),
      step('loop_comparison_files', 'loop', {
        loop: 'index_base_doc',
        done: 'generate_overview',
      }),
      step('index_base_doc', 'action', { success: 'index_comparison_doc' }),
      step('index_comparison_doc', 'action', { success: 'compare_documents' }),
      step('compare_documents', 'action', { success: 'analyze_differences' }),
      step('analyze_differences', 'llm', { success: 'summarize_transition' }),
      step('summarize_transition', 'llm', { success: 'accumulate_results' }),
      step('accumulate_results', 'action', {
        success: 'loop_comparison_files',
      }),
      step('generate_overview', 'llm', { success: 'generate_report' }),
      step('generate_report', 'action', { success: 'output' }),
      step('output', 'output', {}),
    ]);

    // Linear chain: start → init → loop → body steps → after-loop steps
    expect(result.get('start')).toBe(1);
    expect(result.get('init_variables')).toBe(2);
    expect(result.get('loop_comparison_files')).toBe(3);
    expect(result.get('index_base_doc')).toBe(4);
    expect(result.get('index_comparison_doc')).toBe(5);
    expect(result.get('compare_documents')).toBe(6);
    expect(result.get('analyze_differences')).toBe(7);
    expect(result.get('summarize_transition')).toBe(8);
    expect(result.get('accumulate_results')).toBe(9);
    expect(result.get('generate_overview')).toBe(10);
    expect(result.get('generate_report')).toBe(11);
    expect(result.get('output')).toBe(12);
  });

  it('produces unique order values for reachable steps', () => {
    const result = computeStepOrder([
      step('start', 'start', { success: 'a' }),
      step('a', 'action', { success: 'b' }),
      step('b', 'action', { success: 'c' }),
      step('c', 'output', {}),
    ]);

    const orders = [...result.values()];
    const uniqueOrders = new Set(orders);
    expect(uniqueOrders.size).toBe(orders.length);
  });
});
