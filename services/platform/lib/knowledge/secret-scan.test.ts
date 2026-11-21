import { describe, expect, it } from 'vitest';

import { isPlaceholder, scanForSecrets, SecretScanner } from './secret-scan';

/**
 * A scanner is judged by both of its error modes. Missing a credential means it
 * gets indexed and eventually read back into a model's context; flagging
 * documentation means people cannot upload their own runbooks. So the refusals
 * and the acceptances are tested with equal weight — and the fail-open
 * behaviour is tested too, because a scanner bug must not become an outage.
 */

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('credentials are refused [KNOW-R8]', () => {
  const secrets: Array<[string, string, string]> = [
    [
      'an AWS access key id',
      'aws_key = AKIAIOSFODNN7EXAMPLE\n',
      'AWS access key',
    ],
    [
      'a PEM private key block',
      // nosemgrep: tools.opengrep.ts-no-private-key-literal -- truncated fake fixture the scanner must flag, not a real key
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n',
      'private key',
    ],
    [
      'an OpenSSH private key block',
      // nosemgrep: tools.opengrep.ts-no-private-key-literal -- truncated fake fixture the scanner must flag, not a real key
      '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNz...\n',
      'private key',
    ],
    [
      'a JSON Web Token',
      'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.7Hs_lTaSignature\n',
      'JSON Web Token',
    ],
    [
      'a long hex literal assigned to an api key',
      'api_key = "0f1e2d3c4b5a69788796a5b4c3d2e1f0"\n',
      'secret keyword',
    ],
    [
      'a high-entropy token assigned to a password',
      'password: xQ7v-Zk93Lp2Rt8W_bNc4Ye6\n',
      'secret keyword',
    ],
  ];

  it.each(secrets)('refuses %s', (_name, content, kind) => {
    const result = scanForSecrets(bytes(content));
    expect(result.rejected).toBe(true);
    expect(result.reason).toContain(kind);
  });

  it('never puts the value in the reason', () => {
    // The reason is shown to a user and written to a log; both are places the
    // secret must not end up.
    const secret = '0f1e2d3c4b5a69788796a5b4c3d2e1f0';
    const result = scanForSecrets(bytes(`api_key = "${secret}"`));
    expect(result.rejected).toBe(true);
    expect(result.reason).not.toContain(secret);
  });
});

describe('documentation is not a credential', () => {
  const allowed: Array<[string, string]> = [
    ['a placeholder', 'api_key = "your-api-key-here"\n'],
    ['a masked value', 'password: ********\n'],
    ['an environment reference', 'token = ${env.SERVICE_TOKEN}\n'],
    ['a template hole', 'secret: {{ vault.password }}\n'],
    ['a member access', 'const key = config.apiKey;\n'],
    ['an angle-bracket stand-in', 'auth: <your token>\n'],
    ['a short value', 'password: hunter2\n'],
    ['a prose sentence about keys', 'Rotate the api key every 90 days.\n'],
    ['an English word assigned to a token', 'token: production\n'],
    ['a plain document', 'Parental leave is 16 weeks for both parents.\n'],
    ['a lookalike identifier', 'api_key = AKIA_NOT_A_REAL_KEY\n'],
  ];

  it.each(allowed)('allows %s [KNOW-R8]', (_name, content) => {
    expect(scanForSecrets(bytes(content))).toEqual({
      rejected: false,
      reason: null,
    });
  });

  it('allows an empty file', () => {
    expect(scanForSecrets(new Uint8Array())).toEqual({
      rejected: false,
      reason: null,
    });
  });

  it('allows binary content it cannot read as text', () => {
    const binary = new Uint8Array([0xff, 0xfe, 0x00, 0x01, 0x80, 0x90]);
    expect(scanForSecrets(binary).rejected).toBe(false);
  });
});

describe('placeholder recognition', () => {
  it.each([
    'REDACTED',
    'changeme',
    '***',
    'your_secret_here',
    'example-token',
    'process.env.API_KEY',
    '${SECRET}',
    '<token>',
    '',
  ])('treats %s as a placeholder', (value) => {
    expect(isPlaceholder(value)).toBe(true);
  });

  it.each(['0f1e2d3c4b5a69788796a5b4c3d2e1f0', 'xQ7vZk93Lp2Rt8WbNc4Ye6'])(
    'does not treat %s as a placeholder',
    (value) => {
      expect(isPlaceholder(value)).toBe(false);
    },
  );
});

/**
 * A file read a piece at a time is scanned in parts. The verdict has to be
 * the whole file's verdict, wherever the pieces and the parts fall: a
 * credential missed because it sat on a seam would be indexed, and one
 * invented by a seam would keep a runbook out.
 */
describe("a file scanned a piece at a time gets the whole file's verdict", () => {
  /** Scan `content` pushed in pieces of `pushChars`, cut into parts once
   * `partChars` are gathered. */
  function scanInPieces(
    content: string,
    pushChars: number,
    partChars: number,
  ): ReturnType<typeof scanForSecrets> {
    const scanner = new SecretScanner(partChars);
    for (let at = 0; at < content.length; at += pushChars) {
      scanner.push(content.slice(at, at + pushChars));
    }
    return scanner.end();
  }

  const FILLER = 'Parental leave is 16 weeks for both parents.\n';
  const cases: Array<[string, string]> = [
    ['an AWS access key id', 'aws_key = AKIAIOSFODNN7EXAMPLE\n'],
    // nosemgrep: tools.opengrep.ts-no-private-key-literal -- truncated fake fixture the scanner must flag, not a real key
    ['a PEM private key block', '-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n'],
    [
      'a JSON Web Token',
      'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.7Hs_lTaSignature\n',
    ],
    [
      'an assignment on one line',
      'api_key = "0f1e2d3c4b5a69788796a5b4c3d2e1f0"\n',
    ],
    [
      'an assignment whose value is on the next line',
      'password:\n    xQ7v-Zk93Lp2Rt8W_bNc4Ye6\n',
    ],
    [
      'an assignment whose sign is on the next line',
      'token\n  =\n\n  xQ7v-Zk93Lp2Rt8W_bNc4Ye6\n',
    ],
    [
      'an assignment after many empty lines',
      `secret =${'\n'.repeat(300)}0f1e2d3c4b5a69788796a5b4c3d2e1f0\n`,
    ],
    ['a placeholder', 'api_key = "your-api-key-here"\n'],
    ['a short value on the next line', 'password:\n  hunter2\n'],
    ['a plain document', FILLER],
    ['nothing', ''],
  ];

  it.each(cases)('for %s, on every seam', (_name, fragment) => {
    const content = `${FILLER.repeat(3)}${fragment}${FILLER.repeat(3)}`;
    const whole = scanForSecrets(bytes(content));
    for (const partChars of [1, 7, 40, 200, 100_000]) {
      for (const pushChars of [1, 3, 16, 64, 1000]) {
        expect(
          scanInPieces(content, pushChars, partChars),
          `pieces of ${pushChars}, parts of ${partChars}`,
        ).toEqual(whole);
      }
    }
  });

  it('names the detector the whole scan names when a file holds several', () => {
    // The whole scan asks its detectors in turn, each over the whole file:
    // a key id near the end outranks a password near the start.
    const content = `password: xQ7v-Zk93Lp2Rt8W_bNc4Ye6\n${FILLER.repeat(40)}AKIAIOSFODNN7EXAMPLE\n`;
    const whole = scanForSecrets(bytes(content));
    expect(whole.reason).toContain('AWS access key');
    expect(scanInPieces(content, 50, 100)).toEqual(whole);
  });

  it('agrees with the whole scan on files put together at random', () => {
    function mulberry32(seed: number): () => number {
      let a = seed >>> 0;
      return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    const PARTS = [
      'word ',
      'another word, ',
      '\n',
      '\n\n',
      '\r\n',
      '   ',
      '\t',
      'password',
      'api_key',
      'token',
      'auth',
      ':',
      '=',
      ' = ',
      ': ',
      'xQ7v-Zk93Lp2Rt8W_bNc4Ye6',
      '0f1e2d3c4b5a69788796a5b4c3d2e1f0',
      'your-api-key-here',
      'hunter2',
      'AKIAIOSFODNN7EXAMPLE',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.7Hs_lTaSignature',
      // nosemgrep: tools.opengrep.ts-no-private-key-literal -- fake fixture the scanner must flag, not a real key
      '-----BEGIN PRIVATE KEY-----',
      '# a comment',
      '"',
      'é',
    ];
    let refused = 0;
    for (let seed = 1; seed <= 1500; seed += 1) {
      const random = mulberry32(seed);
      let content = '';
      const count = 5 + Math.floor(random() * 40);
      for (let i = 0; i < count; i += 1) {
        content += PARTS[Math.floor(random() * PARTS.length)] ?? '';
      }
      const whole = scanForSecrets(bytes(content));
      if (whole.rejected) refused += 1;
      const pushChars = 1 + Math.floor(random() * 30);
      const partChars = 1 + Math.floor(random() * 60);
      expect(
        scanInPieces(content, pushChars, partChars),
        `seed ${seed}: ${JSON.stringify(content)}`,
      ).toEqual(whole);
    }
    // Both verdicts are well represented, or the comparison proves little.
    expect(refused).toBeGreaterThan(300);
    expect(refused).toBeLessThan(1200);
  });

  // What a line ends with is looked for past the white space before its
  // end, and a name is told by its whole length: `password` and a run of
  // blanks used to read as `ssword` once the blanks left room for no more,
  // and the line end after it as a place to cut.
  it.each(
    Array.from({ length: 50 }, (_unused, at) => 78 + at).map(
      (blanks) => [blanks] as const,
    ),
  )('keeps an assignment whole across %s blanks and a line end', (blanks) => {
    const content = `${FILLER.repeat(3)}password${' '.repeat(blanks)}\n= xQ7v-Zk93Lp2Rt8W_bNc4Ye6\n${FILLER}`;
    const whole = scanForSecrets(bytes(content));
    expect(whole.rejected).toBe(true);
    for (const partChars of [1, 40, 200]) {
      for (const pushChars of [1, 16, 64, 1000]) {
        expect(
          scanInPieces(content, pushChars, partChars),
          `pieces of ${pushChars}, parts of ${partChars}`,
        ).toEqual(whole);
      }
    }
  });

  // No detector's literal runs across a line end, whichever it is: a file
  // whose lines end in a carriage return alone is cut like any other.
  it.each([
    ['carriage returns', '\r'],
    ['carriage returns and line feeds', '\r\n'],
    ['line separators', '\u2028'],
  ])(
    'agrees with the whole scan on a file whose lines end in %s',
    (_what, end) => {
      const line = (text: string): string => `${text}${end}`;
      for (const fragment of [
        line('api_key = "0f1e2d3c4b5a69788796a5b4c3d2e1f0"'),
        `${line('password:')}${line('    xQ7v-Zk93Lp2Rt8W_bNc4Ye6')}`,
        `${line('token')}${line('  =')}${line('')}${line('  xQ7v-Zk93Lp2Rt8W_bNc4Ye6')}`,
        line('api_key = "your-api-key-here"'),
        line('AKIAIOSFODNN7EXAMPLE'),
      ]) {
        const content = `${line('Parental leave is 16 weeks.').repeat(4)}${fragment}${line('Parental leave is 16 weeks.').repeat(4)}`;
        const whole = scanForSecrets(bytes(content));
        for (const partChars of [1, 30, 200]) {
          for (const pushChars of [1, 5, 64]) {
            expect(
              scanInPieces(content, pushChars, partChars),
              `${JSON.stringify(fragment)}: pieces of ${pushChars}, parts of ${partChars}`,
            ).toEqual(whole);
          }
        }
      }
    },
  );

  it('lets go of a file whose lines end in a carriage return alone, a part at a time', () => {
    const scanner = new SecretScanner(1000);
    let most = 0;
    for (let i = 0; i < 5000; i += 1) {
      scanner.push('Parental leave is 16 weeks for both parents.\r');
      most = Math.max(most, scanner.heldChars);
    }
    scanner.push('api_key = "0f1e2d3c4b5a69788796a5b4c3d2e1f0"\r');
    expect(scanner.end().rejected).toBe(true);
    // A thousand characters are gathered and scanned: never the file.
    expect(most).toBeLessThan(1100);
  });

  // A text with no line end to cut at is gathered whole, and looked
  // through once as it comes: gathering it used to look through all of it
  // again with every piece, a minute for sixty megabytes.
  it('gathers a text with no line end in the time its length takes', () => {
    const piece = '{"k":"v"},'.repeat(3276);
    const scanner = new SecretScanner();
    const started = performance.now();
    for (let i = 0; i < 1024; i += 1) scanner.push(piece);
    const gatheredIn = performance.now() - started;
    const verdict = scanner.end();
    expect(verdict.rejected).toBe(false);
    // Thirty-two megabytes: well under a second gathered piece by piece,
    // where looking through the whole again each time took fourteen.
    expect(gatheredIn).toBeLessThan(3000);
  });

  it('finds a credential at the end of a text with no line end', () => {
    const scanner = new SecretScanner(1000);
    for (let i = 0; i < 400; i += 1) scanner.push('{"k":"v"},');
    scanner.push('{"api_key": "0f1e2d3c4b5a69788796a5b4c3d2e1f0"}');
    const whole = scanForSecrets(
      bytes(
        `${'{"k":"v"},'.repeat(400)}{"api_key": "0f1e2d3c4b5a69788796a5b4c3d2e1f0"}`,
      ),
    );
    expect(scanner.end()).toEqual(whole);
  });

  it('holds a part at a time, not the file', () => {
    // A long file of short lines: once a part is gathered it is scanned and
    // let go, so a credential in the last line is still found.
    const scanner = new SecretScanner(1000);
    let most = 0;
    for (let i = 0; i < 5000; i += 1) {
      scanner.push(FILLER);
      most = Math.max(most, scanner.heldChars);
    }
    scanner.push('api_key = "0f1e2d3c4b5a69788796a5b4c3d2e1f0"\n');
    expect(scanner.end().rejected).toBe(true);
    expect(most).toBeLessThan(1100);
  });
});
