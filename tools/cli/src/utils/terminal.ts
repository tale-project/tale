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

function write(text: string) {
  process.stdout.write(text);
}

function moveTo(row: number, col: number) {
  write(`${ESC}[${row};${col}H`);
}

function clearLine() {
  write(`${ESC}[2K`);
}

function saveCursor() {
  write(`${ESC}7`);
}

function restoreCursor() {
  write(`${ESC}8`);
}

function setScrollRegion(top: number, bottom: number) {
  write(`${ESC}[${top};${bottom}r`);
}

function resetScrollRegion() {
  write(`${ESC}[r`);
}

function hideCursor() {
  write(`${ESC}[?25l`);
}

function showCursor() {
  write(`${ESC}[?25h`);
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
  private onExit: () => void;
  private onResize: () => void;

  constructor(version: string) {
    this.version = version;
    this.onExit = () => this.cleanup();
    this.onResize = () => {
      if (this.active) {
        this.applyScrollRegion();
        this.render();
      }
    };
  }

  setup() {
    if (!isTTY) return;
    this.active = true;

    write(`${ESC}[2J`);
    this.render();
    this.applyScrollRegion();
    moveTo(this.headerLines + 1, 1);

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
    this.render();
    this.applyScrollRegion();
    moveTo(this.headerLines + 1, 1);
  }

  private applyScrollRegion() {
    const rows = process.stdout.rows ?? 24;
    setScrollRegion(this.headerLines + 1, rows);
  }

  private clearHeaderArea(lines: number) {
    for (let i = 1; i <= lines; i++) {
      moveTo(i, 1);
      clearLine();
    }
  }

  private render() {
    saveCursor();
    hideCursor();

    const cols = process.stdout.columns ?? 80;
    const separator = DIM + '─'.repeat(cols) + RESET;

    // Clear the full expanded area to avoid stale content
    this.clearHeaderArea(EXPANDED_LINES);

    if (this.ready && this.urls) {
      moveTo(1, 1);
      write(
        `${BOLD}${CYAN}  Tale Dev${RESET} ${DIM}v${this.version}${RESET}  ${GREEN}Ready${RESET}`,
      );

      moveTo(3, 1);
      write(`  ${GREEN}Application${RESET}    ${this.urls.app}`);
      moveTo(4, 1);
      write(`  ${GREEN}Convex API${RESET}     ${this.urls.api}`);
      moveTo(5, 1);
      write(`  ${GREEN}Actions${RESET}        ${this.urls.actions}`);
      moveTo(6, 1);
      write(`  ${GREEN}Dashboard${RESET}      ${this.urls.dashboard}`);

      moveTo(EXPANDED_LINES, 1);
      write(separator);
    } else {
      moveTo(1, 1);
      write(
        `${BOLD}${CYAN}  Tale Dev${RESET} ${DIM}v${this.version}${RESET}  ${YELLOW}Starting services...${RESET}`,
      );

      moveTo(COMPACT_LINES, 1);
      write(separator);
    }

    restoreCursor();
    showCursor();
  }

  cleanup() {
    if (!this.active || this.cleanedUp) return;
    this.cleanedUp = true;

    resetScrollRegion();
    showCursor();

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
