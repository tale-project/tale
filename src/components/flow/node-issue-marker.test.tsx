import { describe, expect, it } from 'vitest';

import { render } from '@/tests/utils/render';

import {
  FlowNodeIssueMarker,
  flowNodeIssueFrameClass,
  flowNodeIssueText,
} from './node-issue-marker';

/** English as the catalog says it, enough to read the helper's output. */
const english = (key: string, options?: Record<string, unknown>) => {
  if (key === 'summary') {
    const errors = Number(options?.errors);
    const warnings = Number(options?.warnings);
    return [
      errors > 0 ? `${errors} errors` : '',
      warnings > 0 ? `${warnings} warnings` : '',
    ]
      .filter(Boolean)
      .join(' and ');
  }
  if (key === 'nodeSummary') return `(${String(options?.summary)})`;
  return key;
};

describe('FlowNodeIssueMarker', () => {
  it('renders nothing without problems', () => {
    const { container } = render(
      <FlowNodeIssueMarker errors={0} warnings={0} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a chip per kind, as decoration', () => {
    const { container } = render(
      <FlowNodeIssueMarker errors={2} warnings={1} />,
    );
    const marker = container.firstElementChild;
    expect(marker).toHaveAttribute('aria-hidden', 'true');
    expect(
      container.querySelector('[data-severity="error"]'),
    ).toHaveTextContent('2');
    expect(
      container.querySelector('[data-severity="warning"]'),
    ).toHaveTextContent('1');
    expect(container.querySelector('button, a, [tabindex]')).toBeNull();
  });

  it('shows only the kinds that are present', () => {
    const { container } = render(
      <FlowNodeIssueMarker errors={0} warnings={4} />,
    );
    expect(container.querySelector('[data-severity="error"]')).toBeNull();
    expect(
      container.querySelector('[data-severity="warning"]'),
    ).toHaveTextContent('4');
  });

  it('fades its chips in, and not under reduced motion', () => {
    const { container } = render(
      <FlowNodeIssueMarker errors={1} warnings={1} />,
    );
    for (const chip of container.querySelectorAll('[data-severity]')) {
      expect(chip).toHaveClass(
        'animate-in',
        'fade-in',
        'motion-reduce:animate-none',
      );
    }
  });
});

describe('flowNodeIssueText', () => {
  it('says the counts for the node name, and nothing without problems', () => {
    expect(flowNodeIssueText(english, { errors: 2, warnings: 1 })).toBe(
      '(2 errors and 1 warnings)',
    );
    expect(flowNodeIssueText(english, { errors: 0, warnings: 0 })).toBe('');
  });

  it('names its own namespace, so any bound translate function will do', () => {
    const calls: Array<Record<string, unknown> | undefined> = [];
    flowNodeIssueText(
      (key, options) => {
        calls.push(options);
        return key;
      },
      { errors: 1, warnings: 0 },
    );
    expect(calls.every((options) => options?.ns === 'issues')).toBe(true);
  });
});

describe('flowNodeIssueFrameClass', () => {
  it('takes the worst problem, and nothing without one', () => {
    expect(flowNodeIssueFrameClass({ errors: 1, warnings: 3 })).toBe(
      'border-destructive',
    );
    expect(flowNodeIssueFrameClass({ errors: 0, warnings: 3 })).toBe(
      'border-amber-600 dark:border-amber-500',
    );
    expect(flowNodeIssueFrameClass({ errors: 0, warnings: 0 })).toBe('');
  });
});
