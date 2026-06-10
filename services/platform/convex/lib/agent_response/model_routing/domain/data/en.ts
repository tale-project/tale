/**
 * English domain keywords, ported/condensed from
 * `old_router/cascadeflow/routing/domain.py`. Tiers are weighted (see
 * `TIER_WEIGHTS`). Generic filler is intentionally omitted so specific domains
 * win over `general`.
 *
 * Cascadeflow's STRUCTURED / RAG / TOOL / MULTIMODAL / COMPARISON domains are
 * deliberately NOT detected here — those shapes are already read off the
 * difficulty signals (`scoreDifficulty`). This taxonomy is the topical one in
 * `lib/shared/constants/domains.ts`.
 */

import type { DomainLexicon } from '../types';

export const EN_LEXICON: DomainLexicon = {
  locale: 'en',
  boundaryMode: 'word',
  keywords: {
    code: {
      veryStrong: [
        'async',
        'await',
        'import',
        'def ',
        'npm',
        'docker',
        'pytest',
        'compile',
        'stack trace',
        'segfault',
        'null pointer',
        'regex',
      ],
      strong: [
        'function',
        'python',
        'javascript',
        'typescript',
        'api endpoint',
        'debug',
        'refactor',
        'algorithm',
        'database query',
        'sql',
        'variable',
        'class',
        'method',
        'exception',
      ],
      moderate: ['build', 'script', 'deploy', 'git', 'test', 'syntax', 'bug'],
    },
    data: {
      veryStrong: [
        'dataframe',
        'pivot table',
        'group by',
        'aggregate',
        'csv',
        'spreadsheet',
        'etl',
      ],
      strong: [
        'dataset',
        'analytics',
        'visualization',
        'chart',
        'correlation',
        'regression',
        'metrics',
        'query the data',
      ],
      moderate: ['analyze', 'report', 'trend', 'column', 'row', 'filter'],
    },
    math: {
      veryStrong: [
        'theorem',
        'derivative',
        'integral',
        'equation',
        'proof',
        'matrix',
        'eigenvalue',
        'probability',
      ],
      strong: [
        'calculate',
        'solve for',
        'algebra',
        'calculus',
        'geometry',
        'statistics',
        'formula',
        'compute',
      ],
      moderate: ['sum', 'average', 'percentage', 'ratio', 'evaluate'],
      weak: ['number', 'math'],
    },
    creative: {
      strong: [
        'write a story',
        'poem',
        'creative',
        'brainstorm',
        'imagine',
        'fiction',
        'screenplay',
        'lyrics',
        'tagline',
      ],
      moderate: ['draft', 'compose', 'narrative', 'character', 'plot'],
      weak: ['create', 'make', 'new'],
    },
    translation: {
      strong: [
        'translate',
        'translation',
        'in spanish',
        'in french',
        'in german',
        'into english',
        'localize',
      ],
      moderate: ['language', 'fluent', 'idiomatic', 'phrase'],
      weak: ['change language', 'switch language'],
    },
    summary: {
      strong: ['summarize', 'summary', 'tldr', 'key points', 'recap'],
      moderate: ['brief', 'abstract', 'distill', 'condense', 'shorten'],
      weak: ['short', 'quick'],
    },
    factual: {
      veryStrong: [
        'what is the capital',
        'who invented',
        'when did',
        'fact check',
      ],
      strong: [
        'define',
        'definition',
        'explain what',
        'history of',
        'difference between',
      ],
      moderate: ['who is', 'where is', 'how many', 'list of'],
    },
    legal: {
      veryStrong: [
        'contract',
        'liability',
        'plaintiff',
        'defendant',
        'jurisdiction',
      ],
      strong: [
        'legal',
        'lawsuit',
        'clause',
        'compliance',
        'regulation',
        'terms of service',
        'intellectual property',
        'gdpr',
      ],
      moderate: ['agreement', 'policy', 'rights', 'obligation'],
      weak: ['rule', 'requirement'],
    },
    medical: {
      veryStrong: [
        'diagnosis',
        'symptom',
        'prescription',
        'dosage',
        'pathology',
      ],
      strong: [
        'medical',
        'disease',
        'treatment',
        'patient',
        'clinical',
        'medication',
        'therapy',
      ],
      moderate: ['health', 'doctor', 'pain', 'condition'],
      weak: ['feel', 'sick', 'ill'],
    },
    financial: {
      veryStrong: [
        'portfolio',
        'valuation',
        'ebitda',
        'cash flow',
        'balance sheet',
      ],
      strong: [
        'investment',
        'stock',
        'revenue',
        'profit margin',
        'interest rate',
        'tax',
        'budget forecast',
        'roi',
      ],
      moderate: ['finance', 'market', 'expense', 'income'],
      weak: ['money', 'cost', 'price'],
    },
    conversation: {
      veryStrong: [
        'as i said',
        'you mentioned',
        'earlier you',
        'continuing from',
      ],
      strong: ['follow up', 'by the way', 'also', 'one more thing'],
      moderate: ['thanks', 'ok', 'got it'],
    },
  },
};
