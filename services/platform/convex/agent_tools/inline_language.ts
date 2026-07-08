/**
 * Pre-sandbox validation for inline `run_code` snippets.
 *
 * Two structured, repairable rejections:
 * - `LANGUAGE_MISMATCH` — the snippet's syntax contradicts the declared
 *   `language` (the classic failure: Python code sent as bash dies with
 *   `import: command not found` and costs a sandbox round-trip).
 * - `PREFER_PACKAGES` — ad-hoc package installs in inline code (`pip install
 *   x`, `npm install -g y`); those must go through the `packages` parameter
 *   where the org policy can see them.
 *
 * FAIL-OPEN BY DESIGN. A missed mismatch costs one sandbox round-trip plus a
 * stderr hint; a false rejection blocks a legitimate run. So only
 * high-confidence contradictions reject: string/heredoc/comment bodies are
 * stripped before scoring, signals are weighted (3 = individually decisive,
 * i.e. never valid in the declared language; 2 = strong), and the threshold
 * is score ≥ 4, or ≥ 3 including a 3-point signal. The declared language is
 * never auto-corrected — the model resubmits.
 */

export type InlineLanguage = 'python' | 'node' | 'bash';

export interface InlineCodeIssue {
  code: 'LANGUAGE_MISMATCH' | 'PREFER_PACKAGES';
  message: string;
}

/**
 * Blank out the parts of a snippet that are data, not code, so quoted text
 * (`echo "import os"`) and heredoc bodies (often a different language by
 * design) never score as language signals. Lossy on purpose — mangling an
 * exotic construct only *loses* signals, which fails open.
 */
export function stripLiterals(code: string, language: InlineLanguage): string {
  let out = code;
  if (language === 'bash') {
    out = out.replace(
      /<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\s*(?=\n|$)/g,
      '<<HEREDOC',
    );
  }
  if (language === 'python') {
    out = out.replace(/[rbfu]{0,2}(?:'''[\s\S]*?'''|"""[\s\S]*?""")/gi, "''");
  }
  // Backtick spans: JS template literals; in bash they are command
  // substitution (code), but treating them as literal only loses signals.
  out = out.replace(/`(?:\\.|[^`\\])*`/g, '``');
  out = out.replace(/"(?:\\.|[^"\\\n])*"/g, '""');
  out = out.replace(/'(?:\\.|[^'\\\n])*'/g, "''");
  if (language === 'node') {
    out = out
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  } else {
    // `#` comments — but never the `#!` shebang, which is a scoring signal.
    out = out.replace(/(^|[^&\w])#(?!!)[^\n]*/g, '$1');
  }
  return out;
}

interface Signal {
  weight: 2 | 3;
  /** Matched against the stripped code — or the raw shebang line. */
  test: RegExp;
  shebang?: boolean;
  describe: string;
}

/** Signals that a snippet is written in the KEYED language — scored only for
 * languages other than the declared one, so e.g. `#!/bin/bash` under
 * `language: "bash"` never counts against itself. */
const LANGUAGE_SIGNALS: Record<InlineLanguage, Signal[]> = {
  python: [
    {
      weight: 3,
      test: /^#!.*\bpython/,
      shebang: true,
      describe: 'a Python shebang',
    },
    {
      weight: 3,
      test: /^\s*def\s+\w+\s*\([^)\n]*\)\s*:/m,
      describe: 'a Python `def …():` definition',
    },
    {
      // Bare `import x` / `import x as y` / `from x import y` — an ESM
      // import never ends at the module name (it needs `from '…'` or a
      // string), so the line-end anchor keeps Node imports out.
      weight: 3,
      test: /^\s*(?:from\s+[\w.]+\s+import\s+[\w.*]|import\s+[\w.]+(?:\s+as\s+\w+)?\s*$)/m,
      describe: 'a Python import statement',
    },
    {
      weight: 2,
      test: /^\s*(?:elif\b|except\b|raise\s)/m,
      describe: 'Python-only keywords (elif/except/raise)',
    },
    { weight: 2, test: /\bf(?:''|"")/, describe: 'a Python f-string' },
    { weight: 2, test: /^\s*print\s*\(/m, describe: '`print(…)`' },
  ],
  node: [
    {
      weight: 3,
      test: /^#!.*\bnode/,
      shebang: true,
      describe: 'a Node shebang',
    },
    {
      weight: 3,
      test: /\bconsole\.(?:log|error|warn|info)\s*\(/,
      describe: '`console.*(…)`',
    },
    {
      // `const` declarations — `let` is a bash builtin, so it can't serve.
      weight: 3,
      test: /^\s*const\s+[\w{[$]/m,
      describe: 'a `const` declaration',
    },
    {
      weight: 3,
      test: /^\s*import\s+.+\s+from\s+(?:''|"")/m,
      describe: 'an ESM import',
    },
    { weight: 2, test: /=>\s*[{(]|\)\s*=>/, describe: 'an arrow function' },
    {
      weight: 2,
      test: /\brequire\s*\(\s*(?:''|"")\s*\)/,
      describe: '`require(…)`',
    },
  ],
  bash: [
    {
      weight: 3,
      test: /^#!.*\b(?:ba|z|da)?sh\b/,
      shebang: true,
      describe: 'a shell shebang',
    },
    {
      weight: 3,
      test: /^\s*(?:fi|done|esac)\s*(?:;.*)?$/m,
      describe: 'shell block keywords (fi/done/esac)',
    },
    {
      weight: 2,
      test: /^\s*(?:sudo|apt-get|apt|yum|apk)\s+\w/m,
      describe: 'a system package-manager command',
    },
    { weight: 2, test: /^\s*echo\s+(?![-+=*/])/m, describe: '`echo …`' },
    {
      weight: 2,
      test: /\|\s*(?:grep|awk|sed|xargs|sort|uniq|head|tail)\b/,
      describe: 'a coreutils pipeline',
    },
    {
      weight: 2,
      test: /^\s*(?:export\s+\w+=|cd\s+\/)/m,
      describe: '`export VAR=` / `cd /…`',
    },
  ],
};

const INSTALL_HINT =
  'Declare installs in the `packages` parameter instead of running them from inline code — the org run_code policy applies there and the install is checked before anything runs. Either {"mode":"install","packages":{"python":["<name>"]}} as its own call, or add `packages` to this one. (`pip install -r/-e …` and project-local `npm install` runs stay allowed inline.)';

/** Bare `pip install <name>` — requirement-file (-r), editable (-e), and
 * local-dir installs have no `packages` equivalent and stay allowed. */
const PIP_INSTALL_REGEX =
  /(?:^|[;&|(\s])(?:(?:python3?|uv)\s+-m\s+)?pip3?\s+install\s+(?!(?:-r|--requirement|-e|--editable)\b|\.)/m;
/** Global npm installs only — a project-local `npm install` is a build step,
 * not package provisioning. */
const NPM_GLOBAL_INSTALL_REGEX =
  /(?:^|[;&|(\s])npm\s+(?:install|i|add)\s+(?:-g\b|--global\b)/m;

function detectInlineInstall(
  raw: string,
  stripped: string,
  language: InlineLanguage,
): InlineCodeIssue | null {
  if (
    PIP_INSTALL_REGEX.test(stripped) ||
    NPM_GLOBAL_INSTALL_REGEX.test(stripped)
  ) {
    return { code: 'PREFER_PACKAGES', message: INSTALL_HINT };
  }
  // Process-spawned installs keep their tokens inside string literals, so
  // the stripped scan can't see them. Scan with comments removed but strings
  // KEPT — and only next to a spawn call, so a comment or prose mention of
  // pip never trips this.
  const spawnsProcess =
    language === 'python'
      ? /\b(?:subprocess\.|os\.system|check_call|check_output)/.test(stripped)
      : language === 'node'
        ? /\b(?:child_process|execSync|spawn(?:Sync)?\s*\()/.test(stripped)
        : false;
  const uncommented = stripComments(raw, language);
  if (
    spawnsProcess &&
    /\b(?:pip3?\b[^\n]{0,60}\binstall\b|npm\b[^\n]{0,60}\binstall\b[^\n]{0,60}(?:-g\b|--global\b))/.test(
      uncommented,
    )
  ) {
    return { code: 'PREFER_PACKAGES', message: INSTALL_HINT };
  }
  return null;
}

/** Comments out, string literals kept — for scans that must see quoted
 * install commands but not commented-out ones. */
function stripComments(code: string, language: InlineLanguage): string {
  if (language === 'node') {
    return code
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  }
  return code.replace(/(^|[^&\w])#(?!!)[^\n]*/g, '$1');
}

function detectLanguageMismatch(
  raw: string,
  stripped: string,
  declared: InlineLanguage,
): InlineCodeIssue | null {
  const shebang = raw.startsWith('#!')
    ? raw.slice(0, raw.indexOf('\n') === -1 ? raw.length : raw.indexOf('\n'))
    : null;
  let best: {
    language: InlineLanguage;
    score: number;
    hasDecisive: boolean;
    hits: string[];
  } | null = null;
  for (const language of ['python', 'node', 'bash'] as const) {
    if (language === declared) continue;
    let score = 0;
    let hasDecisive = false;
    const hits: string[] = [];
    for (const signal of LANGUAGE_SIGNALS[language]) {
      const subject = signal.shebang ? shebang : stripped;
      if (subject === null || !signal.test.test(subject)) continue;
      score += signal.weight;
      hasDecisive ||= signal.weight === 3;
      hits.push(signal.describe);
    }
    if (best === null || score > best.score) {
      best = { language, score, hasDecisive, hits };
    }
  }
  if (
    best !== null &&
    (best.score >= 4 || (best.score >= 3 && best.hasDecisive))
  ) {
    return {
      code: 'LANGUAGE_MISMATCH',
      message: `\`language\` is "${declared}" but the snippet looks like ${best.language} — it contains ${best.hits.join(', ')}. The language is not auto-corrected: resubmit with language: "${best.language}", or rewrite the snippet in ${declared}.`,
    };
  }
  return null;
}

/**
 * Layer-2 check `run_code` runs on inline snippets before touching the
 * sandbox. `null` means "run it" — including every uncertain case.
 */
export function validateInlineCode(
  code: string,
  language: InlineLanguage,
): InlineCodeIssue | null {
  try {
    const stripped = stripLiterals(code, language);
    return (
      detectInlineInstall(code, stripped, language) ??
      detectLanguageMismatch(code, stripped, language)
    );
  } catch (err) {
    // Fail open: a validator crash must never block a run.
    console.warn('[run_code] inline language validation failed:', err);
    return null;
  }
}
