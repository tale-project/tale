import { waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { render } from '@/tests/utils/render';

import { Mermaid, sanitizeMermaidSvg } from './mermaid';

/**
 * Regression for the mermaid follow-up to #2662: `Mermaid` injects the
 * rendered diagram SVG via `dangerouslySetInnerHTML`. Mermaid's own
 * `securityLevel: 'strict'` runs its bundled DOMPurify over the output, but
 * that's an implementation detail of a third-party dependency, not a
 * boundary this component controls — `sanitizeMermaidSvg` re-sanitizes at
 * the point where the string is handed to React, mirroring the fix in
 * `app/features/workspace/viewers/svg-viewer.tsx`.
 *
 * `sanitizeMermaidSvg` is tested directly against fixtures (fast, no
 * dynamic-import mocking) and `Mermaid` itself is exercised end to end with
 * a mocked `mermaid` module to prove the sanitizer is actually wired into
 * the render path, not just defined.
 */
describe('sanitizeMermaidSvg', () => {
  it('neutralizes <svg/onload=…> (no leading space before the handler)', () => {
    const malicious = '<svg/onload=alert(1)><circle r="5"/></svg>';
    const safe = sanitizeMermaidSvg(malicious);

    expect(safe).not.toContain('onload');
  });

  it('neutralizes an unquoted javascript: href', () => {
    const malicious =
      '<svg xmlns="http://www.w3.org/2000/svg"><a href=javascript:alert(1)><text>click</text></a></svg>';
    const safe = sanitizeMermaidSvg(malicious);

    expect(safe).not.toContain('javascript:');
  });

  it('strips a <script> smuggled inside a <foreignObject> child (mermaid label)', () => {
    const malicious =
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><script>window.pwned = true;</script>text</div></foreignObject></svg>';
    const safe = sanitizeMermaidSvg(malicious);

    expect(safe).not.toContain('<script');
  });

  it('strips an onerror handler smuggled inside a <foreignObject> child', () => {
    const malicious =
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="alert(1)"/></div></foreignObject></svg>';
    const safe = sanitizeMermaidSvg(malicious);

    expect(safe).not.toContain('onerror');
  });

  it('neutralizes a <use> href pointing at a javascript: URL', () => {
    const malicious =
      '<svg xmlns="http://www.w3.org/2000/svg"><use href="javascript:alert(1)" x="10" y="10"/></svg>';
    const safe = sanitizeMermaidSvg(malicious);

    expect(safe).not.toContain('javascript:');
    expect(safe).not.toContain('href=');
  });

  it('neutralizes a <use> xlink:href pointing at an external origin', () => {
    const malicious =
      '<svg xmlns="http://www.w3.org/2000/svg"><use xlink:href="https://evil.example/x.svg#dot" x="10" y="10"/></svg>';
    const safe = sanitizeMermaidSvg(malicious);

    expect(safe).not.toContain('evil.example');
  });

  it('keeps a <use> referencing a local <defs> shape (legitimate mermaid pattern)', () => {
    const diagram =
      '<svg xmlns="http://www.w3.org/2000/svg"><defs><circle id="dot" r="5"/></defs><use href="#dot" x="10" y="10"/></svg>';
    const safe = sanitizeMermaidSvg(diagram);

    expect(safe).toContain('<use href="#dot"');
    expect(safe).toContain('<circle id="dot"');
  });

  it('keeps a realistic mermaid flowchart node with a <foreignObject> HTML label intact', () => {
    // Shaped like real `mermaid.render()` output for `flowchart LR\n A --> B`:
    // a node group with a shape + a foreignObject-borne text label.
    const flowchart =
      '<svg aria-roledescription="flowchart-v2" role="graphics-document document" viewBox="0 0 200 100" xmlns="http://www.w3.org/2000/svg" width="100%" id="mermaid-1"><g><g class="nodes"><g class="node" transform="translate(50,50)"><rect height="30" width="80" y="-15" x="-40" class="basic label-container"></rect><g class="label"><foreignObject height="20" width="60"><div xmlns="http://www.w3.org/1999/xhtml"><span class="nodeLabel">Browser</span></div></foreignObject></g></g></g></g></svg>';
    const safe = sanitizeMermaidSvg(flowchart);

    expect(safe).toContain('class="nodeLabel"');
    expect(safe).toContain('Browser');
    expect(safe).toContain('<rect');
    expect(safe).toContain('transform="translate(50,50)"');
    expect(safe).toContain('<foreignObject');
  });
});

interface MockMermaidApi {
  initialize: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
}

const mockMermaid: MockMermaidApi = {
  initialize: vi.fn(),
  render: vi.fn(),
};

vi.mock('mermaid', () => ({
  get default() {
    return mockMermaid;
  },
}));

describe('Mermaid', () => {
  it('strips a malicious mermaid render() output before it reaches the DOM', async () => {
    const malicious =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40" width="100%"><foreignObject width="100" height="30"><div xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="alert(1)"/></div></foreignObject><use href="javascript:alert(1)" x="10" y="10"/></svg>';
    mockMermaid.render.mockResolvedValueOnce({ svg: malicious });

    const { getByRole } = render(<Mermaid chart="flowchart TD\nA --> B" />);

    // Gate on the diagram slot, not on any <svg> in the tree: the zoom
    // toolbar's lucide icons are <svg>s too and render synchronously, so a
    // bare `container.querySelector('svg')` was satisfied before mermaid's
    // (async, mocked) import had resolved — the assertions then ran against
    // an empty stage whenever that import lost the race, which it did on a
    // loaded CI runner (main run 33829189967: "expected undefined to be null").
    const stage = getByRole('img', { name: 'Mermaid diagram' });
    await waitFor(() => {
      expect(stage.querySelector('svg')).not.toBeNull();
    });

    // The malicious markup is what rendered — its foreignObject label survives
    // sanitizing — so the negatives below are not passing against nothing.
    expect(stage.querySelector('foreignObject')).not.toBeNull();
    expect(
      stage.querySelector('img')?.getAttribute('onerror') ?? null,
    ).toBeNull();
    expect(stage.innerHTML).not.toContain('onerror');
    expect(stage.querySelector('use')?.getAttribute('href') ?? null).toBeNull();
    expect(stage.innerHTML).not.toContain('javascript:');
  });

  it('renders a realistic flowchart output with its foreignObject label intact', async () => {
    const flowchart =
      '<svg aria-roledescription="flowchart-v2" role="graphics-document document" viewBox="0 0 200 100" xmlns="http://www.w3.org/2000/svg" width="100%" id="mermaid-1"><g><g class="nodes"><g class="node" transform="translate(50,50)"><rect height="30" width="80" y="-15" x="-40" class="basic label-container"></rect><g class="label"><foreignObject height="20" width="60"><div xmlns="http://www.w3.org/1999/xhtml"><span class="nodeLabel">Browser</span></div></foreignObject></g></g></g></g></svg>';
    mockMermaid.render.mockResolvedValueOnce({ svg: flowchart });

    const { container } = render(<Mermaid chart="flowchart LR\nA --> B" />);

    await waitFor(() => {
      expect(container.querySelector('foreignObject')).not.toBeNull();
    });

    const label = container.querySelector('foreignObject .nodeLabel');
    expect(label?.textContent).toBe('Browser');
    expect(container.querySelector('rect.basic')).not.toBeNull();
  });
});
