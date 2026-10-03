/** Reader decisions related to each editorial topic, ordered for the next step. */
export const BLOG_RELATED_TOPICS: Readonly<Record<string, readonly string[]>> =
  {
    T01: ['T03', 'T02', 'T04'],
    T02: ['T01', 'T03', 'T07'],
    T03: ['T01', 'T02', 'T08'],
    T04: ['T01', 'T05', 'T09'],
    T05: ['T04', 'T07', 'T08'],
    T06: ['T05', 'T07', 'T09'],
    T07: ['T02', 'T05', 'T06'],
    T08: ['T03', 'T09', 'T10'],
    T09: ['T04', 'T06', 'T08'],
    T10: ['T01', 'T02', 'T08'],
  };
