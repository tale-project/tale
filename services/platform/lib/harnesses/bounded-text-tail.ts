const isHighSurrogate = (unit: number) => unit >= 0xd800 && unit <= 0xdbff;
const isLowSurrogate = (unit: number) => unit >= 0xdc00 && unit <= 0xdfff;

/** UTF-8 bytes inside a JSON string when this code unit stands alone. A
 * neighboring surrogate pair replaces two six-byte escapes with four bytes. */
function jsonUnitBytes(unit: number): number {
  if (unit === 0x22 || unit === 0x5c) return 2;
  if (unit < 0x20)
    return unit === 8 || unit === 9 || unit === 10 || unit === 12 || unit === 13
      ? 2
      : 6;
  if (unit < 0x80) return 1;
  if (unit < 0x800) return 2;
  return unit >= 0xd800 && unit <= 0xdfff ? 6 : 3;
}

/** The same UTF-16 tail as repeated textTail concatenation, with storage and
 * append work bounded independently of the number of incoming fragments.
 * Strings materialize only when read; code units preserve lone surrogates. */
export class BoundedTextTail {
  private units = new Uint16Array(0);
  private head = 0;
  private count = 0;
  private contentBytes = 0;
  private truncated = false;
  private cached = '';
  private dirty = 0;

  constructor(
    private readonly maxChars: number,
    private readonly measureJsonBytes = true,
  ) {
    if (!Number.isSafeInteger(maxChars) || maxChars < 2)
      throw new RangeError('A text tail needs at least two code units');
  }

  get length(): number {
    return this.count + (this.truncated ? 1 : 0);
  }

  /** Includes the JSON string's quotes and any visible truncation marker. */
  get jsonBytes(): number {
    if (!this.measureJsonBytes)
      throw new Error('JSON byte accounting is disabled for this text tail');
    return this.contentBytes + 2 + (this.truncated ? 3 : 0);
  }

  private grow(required: number): void {
    if (required <= this.units.length) return;
    const capacity = Math.min(
      this.maxChars,
      Math.max(required, this.units.length * 2, 256),
    );
    const next = new Uint16Array(capacity);
    const first = Math.min(this.count, this.units.length - this.head);
    next.set(this.units.subarray(this.head, this.head + first));
    next.set(this.units.subarray(0, this.count - first), first);
    this.units = next;
    this.head = 0;
  }

  private drop(): void {
    const unit = this.units[this.head];
    this.head = (this.head + 1) % this.units.length;
    this.count -= 1;
    this.contentBytes -= jsonUnitBytes(unit);
    // Evicting a pair's high surrogate turns the remaining low surrogate
    // back into a six-byte JSON escape.
    if (
      this.count > 0 &&
      isHighSurrogate(unit) &&
      isLowSurrogate(this.units[this.head])
    )
      this.contentBytes += 8;
  }

  append(value: string): void {
    if (value === '') return;
    if (this.length + value.length > this.maxChars) this.truncated = true;
    const limit = this.maxChars - (this.truncated ? 1 : 0);
    const start = Math.max(0, value.length - limit);
    if (value.length >= limit) {
      this.head = 0;
      this.count = 0;
      this.contentBytes = 0;
    }
    const incoming = value.length - start;
    const removed = Math.max(0, this.count + incoming - limit);
    if (this.measureJsonBytes) {
      for (let n = 0; n < removed; n++) this.drop();
    } else if (removed > 0) {
      this.head = (this.head + removed) % this.units.length;
      this.count -= removed;
    }
    this.grow(this.count + incoming);
    for (let index = start; index < value.length; index++) {
      const unit = value.charCodeAt(index);
      const at = (this.head + this.count) % this.units.length;
      if (this.measureJsonBytes) {
        if (
          this.count > 0 &&
          isHighSurrogate(
            this.units[(at + this.units.length - 1) % this.units.length],
          ) &&
          isLowSurrogate(unit)
        )
          this.contentBytes -= 8;
        this.contentBytes += jsonUnitBytes(unit);
      }
      this.units[at] = unit;
      this.count += 1;
    }
    this.dirty = Math.min(this.count, this.dirty + value.length);
  }

  get text(): string {
    if (this.dirty === 0) return this.cached;
    const chunks = this.truncated ? ['…'] : [];
    // Reuse the surviving prefix of the previous snapshot. Frequent readers
    // of bursty streams should convert only new units, not the entire tail.
    const retained = this.count - this.dirty;
    if (retained > 0) chunks.push(this.cached.slice(-retained));
    for (let offset = retained; offset < this.count;) {
      const start = (this.head + offset) % this.units.length;
      // Bound function arguments; TextDecoder would replace lone surrogates.
      const length = Math.min(
        2048,
        this.count - offset,
        this.units.length - start,
      );
      chunks.push(
        Reflect.apply(
          String.fromCharCode,
          undefined,
          this.units.subarray(start, start + length),
        ),
      );
      offset += length;
    }
    this.cached = chunks.join('');
    this.dirty = 0;
    return this.cached;
  }
}
