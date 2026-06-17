import { describe, expect, it } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import type { ThoughtStep } from '../../utils/thought-step-types';
import { ToolStepRow } from './step-rows';

/** A Task step whose `output` carries folded sub-agent activity — the shape both
 *  the live builder and the persisted path (post toUIMessages) put on `output`. */
const foldedTask: Extract<ThoughtStep, { kind: 'tool' }> = {
  kind: 'tool',
  id: 'task1',
  toolName: 'Task',
  state: 'output-available',
  input: { description: 'Research frameworks' },
  output: {
    report: 'LangChain leads adoption.',
    steps: [
      {
        toolName: 'WebFetch',
        input: { url: 'https://example.com' },
        output: 'hits',
      },
    ],
  },
};

describe('ToolStepRow — folded sub-agent Task', () => {
  it('shows the Task title and is collapsed by default (report + steps hidden)', () => {
    render(<ToolStepRow step={foldedTask} active={false} />);
    // The card surfaces the Task description as its title.
    expect(screen.getByText('Task · Research frameworks')).toBeInTheDocument();
    // Default-collapsed: neither the report nor the nested step is rendered.
    expect(
      screen.queryByText('LangChain leads adoption.'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('WebFetch · example.com'),
    ).not.toBeInTheDocument();
  });

  it('reveals the rendered report and the nested step row when expanded', async () => {
    const { user } = render(<ToolStepRow step={foldedTask} active={false} />);
    await user.click(screen.getByRole('button', { name: /Task · Research/ }));
    // Report renders as markdown body...
    expect(screen.getByText('LangChain leads adoption.')).toBeInTheDocument();
    // ...above the nested sub-agent tool step (its own ToolStepRow).
    expect(screen.getByText('WebFetch · example.com')).toBeInTheDocument();
  });

  it('does NOT dump the folded {report,steps} object as a raw output blob', () => {
    render(<ToolStepRow step={foldedTask} active={false} />);
    // The literal serialized object must never appear (the bug we fixed).
    expect(screen.queryByText(/"steps":/)).not.toBeInTheDocument();
  });
});
