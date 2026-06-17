/**
 * Terminal output helpers shared by the container test scripts: ANSI colors,
 * the box-drawing headers the bash suites used, and a pass/fail/warn results
 * collector with a reusable summary box.
 */

export const RED = '\x1b[0;31m';
export const GREEN = '\x1b[0;32m';
export const YELLOW = '\x1b[1;33m';
export const CYAN = '\x1b[0;36m';
export const NC = '\x1b[0m';
export const BOLD = '\x1b[1m';

const TOP = '╔══════════════════════════════════════════════════════════╗';
const BOT = '╚══════════════════════════════════════════════════════════╝';
const MID = '╠══════════════════════════════════════════════════════════╣';

/** The double-ruled header box the bash scripts printed before each section. */
export function header(title: string): void {
  console.log('');
  console.log(`${BOLD}${TOP}${NC}`);
  console.log(`${BOLD}║  ${title}${NC}`);
  console.log(`${BOLD}${BOT}${NC}`);
}

/** The single-line cyan section marker (used by master-e2e). */
export function section(title: string): void {
  console.log(`${CYAN}${BOLD}━━━ ${title} ━━━${NC}`);
}

type Status = 'PASS' | 'FAIL' | 'WARN';

interface Result {
  name: string;
  status: Status;
}

/** Left-pad a label to `width`, replicating bash `printf %-<width>s`. */
function padRight(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

/**
 * Collects pass/fail/warn results and prints them. Mirrors the bash
 * `pass`/`fail`/`warn` functions + the final results box.
 */
export class Results {
  readonly entries: Result[] = [];
  passed = 0;
  failed = 0;
  warned = 0;

  pass(name: string): void {
    console.log(`  ${GREEN}✓${NC} ${name}`);
    this.entries.push({ name, status: 'PASS' });
    this.passed++;
  }

  fail(name: string): void {
    console.log(`  ${RED}✗${NC} ${name}`);
    this.entries.push({ name, status: 'FAIL' });
    this.failed++;
  }

  warn(name: string): void {
    console.log(`  ${YELLOW}⚠${NC} ${name}`);
    this.entries.push({ name, status: 'WARN' });
    this.warned++;
  }

  get total(): number {
    return this.passed + this.failed;
  }

  /**
   * Print the bordered results box. `title` is centered-ish like the bash
   * heredocs. `nameWidth` matches the `%-NNs` column the script used; set
   * `statusWord` to append "PASSED"/"FAILED" after the name (smoke/master),
   * `showWarnings` to include the warnings tally, and `successBanner` for the
   * celebratory line printed when nothing failed.
   */
  printSummary(opts: {
    title: string;
    nameWidth?: number;
    statusWord?: boolean;
    showWarnings?: boolean;
    successBanner?: string;
  }): void {
    const {
      title,
      nameWidth = 50,
      statusWord = false,
      showWarnings = false,
      successBanner,
    } = opts;

    console.log('');
    console.log(`${BOLD}${TOP}${NC}`);
    console.log(`${BOLD}║  ${title}${NC}`);
    console.log(`${BOLD}${MID}${NC}`);

    for (const { name, status } of this.entries) {
      const padded = padRight(name, nameWidth);
      if (status === 'PASS') {
        console.log(
          `  ${GREEN}✅ ${padded}${NC}${statusWord ? ' PASSED' : ''}`,
        );
      } else if (status === 'FAIL') {
        console.log(`  ${RED}❌ ${padded}${NC}${statusWord ? ' FAILED' : ''}`);
      } else {
        console.log(`  ${YELLOW}⚠️  ${padded}${NC}`);
      }
    }

    console.log(`${BOLD}${MID}${NC}`);
    const tail = showWarnings
      ? `  |  ${YELLOW}Warnings: ${this.warned}${NC}`
      : '';
    console.log(
      `  Tests: ${this.total}  |  ${GREEN}Passed: ${this.passed}${NC}  |  ${RED}Failed: ${this.failed}${NC}${tail}`,
    );

    if (this.failed === 0 && successBanner) {
      console.log('');
      console.log(`  ${GREEN}${BOLD}${successBanner}${NC}`);
    }

    console.log(`${BOLD}${BOT}${NC}`);
    console.log('');
  }
}
