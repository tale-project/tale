const isTTY = process.stdout.isTTY && !process.env.NO_COLOR;

const ESC = '\x1b';

const RESET = isTTY ? `${ESC}[0m` : '';
const BOLD = isTTY ? `${ESC}[1m` : '';
const DIM = isTTY ? `${ESC}[2m` : '';
const CYAN = isTTY ? `${ESC}[36m` : '';
const GREEN = isTTY ? `${ESC}[32m` : '';
const YELLOW = isTTY ? `${ESC}[33m` : '';

const COMPACT_LINES = 3;
const EXPANDED_LINES = 8;
const LOG_BUFFER_CAPACITY = 1000;

function write(text: string) {
  process.stdout.write(text);
}

function moveTo(row: number, col: number) {
  write(`${ESC}[${row};${col}H`);
}

function clearLine() {
  write(`${ESC}[2K`);
}

function clearScreen() {
  write(`${ESC}[2J`);
}

function hideCursor() {
  write(`${ESC}[?25l`);
}

function showCursor() {
  write(`${ESC}[?25h`);
}

// Strip ANSI escape sequences for accurate width measurement
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

function truncateLine(line: string, maxWidth: number): string {
  const stripped = stripAnsi(line);
  if (stripped.length <= maxWidth) return line;

  // Walk the original string, tracking visible character count
  let visible = 0;
  let i = 0;
  while (i < line.length && visible < maxWidth) {
    if (line[i] === '\x1b' && line[i + 1] === '[') {
      // Skip ANSI escape sequence
      const end = line.indexOf('m', i);
      if (end !== -1) {
        i = end + 1;
        continue;
      }
    }
    visible++;
    i++;
  }
  return line.slice(0, i) + RESET;
}

class RingBuffer {
  private buf: string[];
  private head = 0;
  private count = 0;

  constructor(private capacity: number) {
    this.buf = new Array(capacity);
  }

  push(item: string) {
    this.buf[(this.head + this.count) % this.capacity] = item;
    if (this.count < this.capacity) this.count++;
    else this.head = (this.head + 1) % this.capacity;
  }

  tail(n: number): string[] {
    const take = Math.min(n, this.count);
    const result: string[] = [];
    const start = (this.head + this.count - take) % this.capacity;
    for (let i = 0; i < take; i++) {
      result.push(this.buf[(start + i) % this.capacity]);
    }
    return result;
  }

  toArray(): string[] {
    return this.tail(this.count);
  }
}

interface ReadyUrls {
  app: string;
  api: string;
  actions: string;
  dashboard: string;
}

export class StatusHeader {
  private active = false;
  private cleanedUp = false;
  private ready = false;
  private version: string;
  private urls: ReadyUrls | null = null;
  private headerLines = COMPACT_LINES;
  private logBuffer = new RingBuffer(LOG_BUFFER_CAPACITY);
  private repaintScheduled = false;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private onExit: () => void;
  private onResize: () => void;

  constructor(version: string) {
    this.version = version;
    this.onExit = () => this.cleanup();
    this.onResize = () => {
      if (!this.active) return;
      if (this.resizeTimer) clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => {
        this.repaint();
      }, 50);
    };
  }

  setup() {
    if (!isTTY) return;
    this.active = true;

    clearScreen();
    this.repaint();

    process.on('exit', this.onExit);
    process.on('SIGINT', this.onExit);
    process.on('SIGTERM', this.onExit);
    process.stdout.on('resize', this.onResize);
  }

  setReady(urls: ReadyUrls) {
    if (!this.active || this.ready) return;
    this.ready = true;
    this.urls = urls;
    this.headerLines = EXPANDED_LINES;
    this.repaint();
  }

  writeLine(line: string) {
    this.logBuffer.push(line);

    if (!this.active) {
      process.stdout.write(line + '\n');
      return;
    }

    this.scheduleRepaint();
  }

  private scheduleRepaint() {
    if (this.repaintScheduled) return;
    this.repaintScheduled = true;
    queueMicrotask(() => {
      this.repaintScheduled = false;
      if (this.active) this.repaint();
    });
  }

  private repaint() {
    const rows = process.stdout.rows ?? 24;
    const cols = process.stdout.columns ?? 80;
    const separator = DIM + '─'.repeat(cols) + RESET;

    hideCursor();
    moveTo(1, 1);

    // Draw header
    if (this.ready && this.urls) {
      clearLine();
      write(
        `${BOLD}${CYAN}  Tale Dev${RESET} ${DIM}v${this.version}${RESET}  ${GREEN}Ready${RESET}`,
      );

      moveTo(2, 1);
      clearLine();
      moveTo(3, 1);
      clearLine();
      write(`  ${GREEN}Application${RESET}    ${this.urls.app}`);
      moveTo(4, 1);
      clearLine();
      write(`  ${GREEN}Convex API${RESET}     ${this.urls.api}`);
      moveTo(5, 1);
      clearLine();
      write(`  ${GREEN}Actions${RESET}        ${this.urls.actions}`);
      moveTo(6, 1);
      clearLine();
      write(`  ${GREEN}Dashboard${RESET}      ${this.urls.dashboard}`);
      moveTo(7, 1);
      clearLine();

      moveTo(EXPANDED_LINES, 1);
      clearLine();
      write(separator);
    } else {
      clearLine();
      write(
        `${BOLD}${CYAN}  Tale Dev${RESET} ${DIM}v${this.version}${RESET}  ${YELLOW}Starting services...${RESET}`,
      );

      moveTo(2, 1);
      clearLine();
      moveTo(COMPACT_LINES, 1);
      clearLine();
      write(separator);
    }

    // Draw log lines
    const availableRows = rows - this.headerLines;
    if (availableRows > 0) {
      const lines = this.logBuffer.tail(availableRows);
      for (let i = 0; i < availableRows; i++) {
        const row = this.headerLines + 1 + i;
        moveTo(row, 1);
        clearLine();
        if (i < lines.length) {
          write(truncateLine(lines[i], cols - 1));
        }
      }
    }

    // Position cursor after last visible log line
    const visibleCount = Math.min(
      this.logBuffer.tail(availableRows).length,
      availableRows,
    );
    moveTo(this.headerLines + visibleCount + 1, 1);
    showCursor();
  }

  cleanup() {
    if (!this.active || this.cleanedUp) return;
    this.cleanedUp = true;

    if (this.resizeTimer) clearTimeout(this.resizeTimer);

    // Clear the TUI and dump buffer to native scrollback
    clearScreen();
    moveTo(1, 1);
    showCursor();

    const lines = this.logBuffer.toArray();
    for (const line of lines) {
      process.stdout.write(line + '\n');
    }

    process.removeListener('exit', this.onExit);
    process.removeListener('SIGINT', this.onExit);
    process.removeListener('SIGTERM', this.onExit);
    process.stdout.removeListener('resize', this.onResize);
  }
}

const HEALTH_PATTERN = /"GET \/health[^"]*"\s+200/;

export function isHealthCheckLog(line: string): boolean {
  return HEALTH_PATTERN.test(line);
}
