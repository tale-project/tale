import { describe, expect, it } from 'vitest';

import { svgHasActiveContent } from './file_utils';

describe('svgHasActiveContent', () => {
  it.each([
    ['a script element', '<svg><script>alert(1)</script></svg>'],
    ['a namespaced script element', '<svg><svg:script href="x"/></svg>'],
    ['a script element with whitespace', '<svg>< script >1</script></svg>'],
    ['a self-closing script element', '<svg><script/></svg>'],
    ['an onload handler', '<svg onload="alert(1)"><rect/></svg>'],
    ['a mixed-case handler', '<svg oNcLiCk = "alert(1)"/>'],
    [
      'a javascript: URL',
      '<svg><a href="javascript:alert(1)"><text>x</text></a></svg>',
    ],
    [
      'a javascript: URL with whitespace',
      '<svg><a xlink:href="javascript\t:alert(1)"/></svg>',
    ],
  ])('flags %s', (_name, svg) => {
    expect(svgHasActiveContent(svg)).toBe(true);
  });

  it.each([
    [
      'a typical vector-tool export',
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><path d="M0 0h24v24H0z" fill="url(#g)" stroke="none"/></svg>',
    ],
    [
      'style, font, and fragment references',
      '<svg><style>.a{font-weight:700}</style><use xlink:href="#icon"/><text>conditions apply</text></svg>',
    ],
    [
      'a data-* attribute whose name contains "on"',
      '<svg><rect data-on-color="red" width="1" height="1"/></svg>',
    ],
    [
      'a description mentioning scripting',
      '<svg><desc>no scripts</desc></svg>',
    ],
  ])('accepts %s', (_name, svg) => {
    expect(svgHasActiveContent(svg)).toBe(false);
  });
});
