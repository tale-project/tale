/**
 * A bottom-anchored live region — the universal-terminal replacement for the old
 * `StatusHeader`'s alt-screen rendering.
 *
 * It repaints a multi-line block in place using ONLY cursor-up + clear-line +
 * carriage-return + newline — never a full-screen clear or absolute cursor
 * positioning — so it cannot wipe scrollback or desync against prior output. The
 * block always sits at the bottom of the natural scroll buffer; finished lines
 * "graduate" into permanent history via {@link LiveRegion.print}.
 *
 * The five cross-terminal invariants (see the plan) are enforced here:
 *   1. every region line is truncated to `columns - 1` (wide-char-aware) so it
 *      can never soft-wrap and break the cursor-up row count;
 *   2. the caller drives repaint on a timer — this class never paints on its own;
 *   3. while mounted it is the single writer (callers route everything through
 *      `print`); the owner also disposes it before printing a crash trace;
 *   4. liveness is gated on the SAME stream it writes (stdout);
 *   5. in non-interactive mode it degrades to append-only and emits NO escapes.
 *
 * The cursor is hidden while mounted and ALWAYS restored on dispose (including
 * exit / SIGINT / SIGTERM / uncaughtException), so a crash mid-region never
 * leaves an invisible cursor.
 *
 * CLI/script-only, but written defensively (`process` guarded, escapes are
 * plain strings) so it carries no `node:*` value-import.
 */

import { ESC } from './ansi';
import type { Capabilities } from './capabilities';
import { truncate } from './width';

export interface LiveRegionDeps {
  /** Output sink; defaults to `process.stdout.write`. */
  write?: (chunk: string) => void;
  /** Capability snapshot; `interactive` decides live vs append-only. */
  capabilities: Capabilities;
  /** Register a teardown callback; defaults to process exit/signal/crash hooks. */
  registerExit?: (dispose: () => void) => void;
  /** Live column count, re-read per paint; defaults to `process.stdout.columns`. */
  columns?: () => number;
}

function defaultWrite(chunk: string): void {
  if (typeof process !== 'undefined') process.stdout.write(chunk);
}

function defaultRegisterExit(dispose: () => void): void {
  if (typeof process === 'undefined') return;
  process.once('exit', dispose);
  process.once('SIGINT', dispose);
  process.once('SIGTERM', dispose);
  // `uncaughtExceptionMonitor` (not `uncaughtException`) restores the cursor
  // without suppressing Node's default crash — a plain listener would swallow
  // the error and leave the process limping on with a corrupted terminal.
  process.on('uncaughtExceptionMonitor', dispose);
}

function defaultColumns(): number {
  if (typeof process !== 'undefined' && process.stdout?.columns) {
    return process.stdout.columns;
  }
  return 80;
}

export class LiveRegion {
  private readonly write: (chunk: string) => void;
  private readonly interactive: boolean;
  private readonly readColumns: () => number;
  private lines: string[] = [];
  private painted = 0;
  private disposed = false;
  private cursorHidden = false;

  constructor(deps: LiveRegionDeps) {
    this.write = deps.write ?? defaultWrite;
    this.interactive = deps.capabilities.interactive;
    this.readColumns = deps.columns ?? defaultColumns;
    if (this.interactive) {
      this.write(ESC.hideCursor);
      this.cursorHidden = true;
      (deps.registerExit ?? defaultRegisterExit)(() => this.dispose());
    }
  }

  /** Live terminal width, re-read each paint so a resize self-heals (invariant 1). */
  private get columns(): number {
    return this.readColumns();
  }

  /** Replace the current live block. No-op in non-interactive mode. */
  render(lines: string[]): void {
    if (this.disposed) return;
    this.lines = [...lines];
    if (!this.interactive) return;
    this.eraseBlock();
    this.writeBlock();
  }

  /** Emit a permanent line ABOVE the live block (it scrolls into history). */
  print(line: string): void {
    if (this.disposed) return;
    if (!this.interactive) {
      this.write(`${line}\n`);
      return;
    }
    this.eraseBlock();
    this.write(`${line}\n`);
    this.writeBlock();
  }

  /** Erase the live block (leaving any graduated history) without disposing. */
  clear(): void {
    if (this.disposed || !this.interactive) return;
    this.eraseBlock();
    this.lines = [];
  }

  /** Erase the block, restore the cursor, and detach. Idempotent — and `disposed`
   *  is set in a `finally`, so even a throwing `write` mid-teardown can never
   *  leave the region live (which would strand a hidden cursor on the next path). */
  dispose(): void {
    if (this.disposed) return;
    try {
      if (this.interactive) {
        this.eraseBlock();
        if (this.cursorHidden) {
          this.write(ESC.showCursor);
          this.cursorHidden = false;
        }
      }
    } finally {
      this.disposed = true;
    }
  }

  /** Move to the top of the painted block and clear every line it occupied. */
  private eraseBlock(): void {
    if (this.painted <= 0) return;
    this.write(ESC.up(this.painted));
    for (let i = 0; i < this.painted; i++) {
      this.write(`${ESC.cursorStart}${ESC.clearLine}\n`);
    }
    this.write(ESC.up(this.painted));
    this.painted = 0;
  }

  /** Paint the cached lines, each truncated so it can never wrap. */
  private writeBlock(): void {
    const max = Math.max(1, this.columns - 1);
    for (const line of this.lines) {
      this.write(`${ESC.cursorStart}${ESC.clearLine}${truncate(line, max)}\n`);
    }
    this.painted = this.lines.length;
  }
}
