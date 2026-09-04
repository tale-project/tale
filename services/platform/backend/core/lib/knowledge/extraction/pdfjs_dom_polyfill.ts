'use node';

/**
 * Pure-JS DOM-global polyfills, plus the ES2025 shims pdfjs expects, for
 * running pdfjs-dist on the backend's Node worker.
 *
 * pdfjs 5.x's Node setup polyfills `DOMMatrix` / `ImageData` / `Path2D` by
 * `require("@napi-rs/canvas")` — a NATIVE module. Convex extracts a bundled
 * 'use node' action to a temp dir and does NOT ship externalized native
 * packages there (a pure-JS external like `postgres` resolves, a `.node` addon
 * does not), so that require fails and pdfjs throws `DOMMatrix is not defined`
 * on every PDF. We never rasterize (text is read per page; embedded image bytes
 * go to the Vision API), so a correct affine `DOMMatrix` plus inert
 * `ImageData` / `Path2D` stubs are sufficient — and because they're plain JS
 * they bundle into the action and are present at runtime.
 *
 * pdfjs only assigns its own polyfill when the global is absent
 * (`if (!globalThis.DOMMatrix)`), so installing these first makes pdfjs defer
 * to them and skips the native `require` entirely.
 */

interface Point2D {
  x?: number;
  y?: number;
  z?: number;
  w?: number;
}

/**
 * Spec-faithful 2D affine matrix:
 *   | a c e |
 *   | b d f |
 *   | 0 0 1 |
 * Implements the surface pdfjs exercises during text extraction: construction
 * from a 6- or 16-element array (or another matrix), multiply / translate /
 * scale / rotate (and their `*Self` mutating variants), inverse / invertSelf,
 * and transformPoint. 3D is collapsed to 2D (pdfjs passes 2D transforms here).
 */
class DOMMatrixPolyfill {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;

  constructor(init?: number[] | DOMMatrixPolyfill | string) {
    if (init == null) return;
    if (typeof init === 'string') {
      throw new Error('DOMMatrix(string) is not supported in this polyfill');
    }
    if (Array.isArray(init)) {
      if (init.length === 6) {
        [this.a, this.b, this.c, this.d, this.e, this.f] = init;
      } else if (init.length === 16) {
        // Column-major 4x4 → 2D components (m11,m12,m21,m22,m41,m42).
        this.a = init[0];
        this.b = init[1];
        this.c = init[4];
        this.d = init[5];
        this.e = init[12];
        this.f = init[13];
      } else {
        throw new Error(
          `DOMMatrix init array length ${init.length} unsupported`,
        );
      }
      return;
    }
    this.a = init.a;
    this.b = init.b;
    this.c = init.c;
    this.d = init.d;
    this.e = init.e;
    this.f = init.f;
  }

  // 4x4 aliases pdfjs / callers may read; 2D matrix → fixed 3rd/4th rows.
  get m11(): number {
    return this.a;
  }
  get m12(): number {
    return this.b;
  }
  get m21(): number {
    return this.c;
  }
  get m22(): number {
    return this.d;
  }
  get m41(): number {
    return this.e;
  }
  get m42(): number {
    return this.f;
  }
  get is2D(): boolean {
    return true;
  }
  get isIdentity(): boolean {
    return (
      this.a === 1 &&
      this.b === 0 &&
      this.c === 0 &&
      this.d === 1 &&
      this.e === 0 &&
      this.f === 0
    );
  }

  private clone(): DOMMatrixPolyfill {
    return new DOMMatrixPolyfill([
      this.a,
      this.b,
      this.c,
      this.d,
      this.e,
      this.f,
    ]);
  }

  /** this · other (matrix product), returning a new matrix. */
  multiply(other: DOMMatrixPolyfill): DOMMatrixPolyfill {
    return this.clone().multiplySelf(other);
  }

  multiplySelf(o: DOMMatrixPolyfill): DOMMatrixPolyfill {
    const a = this.a * o.a + this.c * o.b;
    const b = this.b * o.a + this.d * o.b;
    const c = this.a * o.c + this.c * o.d;
    const d = this.b * o.c + this.d * o.d;
    const e = this.a * o.e + this.c * o.f + this.e;
    const f = this.b * o.e + this.d * o.f + this.f;
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.e = e;
    this.f = f;
    return this;
  }

  /** this = other · this (pre-multiply), returning this. */
  preMultiplySelf(o: DOMMatrixPolyfill): DOMMatrixPolyfill {
    const a = o.a * this.a + o.c * this.b;
    const b = o.b * this.a + o.d * this.b;
    const c = o.a * this.c + o.c * this.d;
    const d = o.b * this.c + o.d * this.d;
    const e = o.a * this.e + o.c * this.f + o.e;
    const f = o.b * this.e + o.d * this.f + o.f;
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.e = e;
    this.f = f;
    return this;
  }

  translate(tx = 0, ty = 0): DOMMatrixPolyfill {
    return this.clone().translateSelf(tx, ty);
  }

  translateSelf(tx = 0, ty = 0): DOMMatrixPolyfill {
    this.e += this.a * tx + this.c * ty;
    this.f += this.b * tx + this.d * ty;
    return this;
  }

  scale(sx = 1, sy?: number): DOMMatrixPolyfill {
    return this.clone().scaleSelf(sx, sy);
  }

  scaleSelf(sx = 1, sy?: number): DOMMatrixPolyfill {
    const sceY = sy ?? sx;
    this.a *= sx;
    this.b *= sx;
    this.c *= sceY;
    this.d *= sceY;
    return this;
  }

  rotate(deg = 0): DOMMatrixPolyfill {
    return this.clone().rotateSelf(deg);
  }

  rotateSelf(deg = 0): DOMMatrixPolyfill {
    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return this.multiplySelf(
      new DOMMatrixPolyfill([cos, sin, -sin, cos, 0, 0]),
    );
  }

  inverse(): DOMMatrixPolyfill {
    return this.clone().invertSelf();
  }

  invertSelf(): DOMMatrixPolyfill {
    const det = this.a * this.d - this.b * this.c;
    if (!det) {
      this.a = this.b = this.c = this.d = this.e = this.f = NaN;
      return this;
    }
    const { a, b, c, d, e, f } = this;
    this.a = d / det;
    this.b = -b / det;
    this.c = -c / det;
    this.d = a / det;
    this.e = (c * f - d * e) / det;
    this.f = (b * e - a * f) / det;
    return this;
  }

  transformPoint(point: Point2D = {}): Point2D {
    const x = point.x ?? 0;
    const y = point.y ?? 0;
    return {
      x: this.a * x + this.c * y + this.e,
      y: this.b * x + this.d * y + this.f,
      z: point.z ?? 0,
      w: point.w ?? 1,
    };
  }
}

/** Inert stand-ins — only constructed on the rasterization path we never take. */
class ImageDataPolyfill {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  constructor(widthOrData: number | Uint8ClampedArray, height?: number) {
    if (typeof widthOrData === 'number') {
      this.width = widthOrData;
      this.height = height ?? 0;
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
    } else {
      this.data = widthOrData;
      this.width = height ?? 0;
      this.height = this.width ? widthOrData.length / 4 / this.width : 0;
    }
  }
}

class Path2DPolyfill {
  // No-op: pdfjs only builds paths when rendering to a canvas.
  addPath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  bezierCurveTo(): void {}
  quadraticCurveTo(): void {}
  arc(): void {}
  rect(): void {}
  closePath(): void {}
}

let installed = false;

type Base64Alphabet = 'base64' | 'base64url';

type ToBase64Options = {
  alphabet?: Base64Alphabet;
  omitPadding?: boolean;
};

type FromBase64Options = {
  alphabet?: Base64Alphabet;
};

/**
 * ES2025 `Uint8Array` base64 codecs — Node 22 lacks them; pdfjs 5.x calls them
 * unconditionally. jose's CompactEncrypt also prefers `toBase64` when present
 * and passes `{ alphabet: 'base64url', omitPadding: true }`. A shim that
 * ignores those options poisons every later encrypt in the same Node worker
 * (integration credentials, OAuth tokens, …) with std-base64 JWE that
 * `compactDecrypt` rejects.
 */
function toBase64Shim(this: Uint8Array, options?: ToBase64Options): string {
  const encoding: BufferEncoding =
    options?.alphabet === 'base64url' ? 'base64url' : 'base64';
  let out = Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString(
    encoding,
  );
  // Node's `base64url` codec already omits padding; std `base64` does not.
  if (options?.omitPadding) out = out.replace(/=+$/, '');
  return out;
}

function fromBase64Shim(
  base64: string,
  options?: FromBase64Options,
): Uint8Array {
  const encoding: BufferEncoding =
    options?.alphabet === 'base64url' ? 'base64url' : 'base64';
  // Copy the Buffer view — never wrap buf.buffer (shared allocation pool).
  return new Uint8Array(Buffer.from(base64, encoding));
}

function toBase64IgnoresBase64urlAlphabet(): boolean {
  const toBase64 = Reflect.get(Uint8Array.prototype, 'toBase64');
  if (typeof toBase64 !== 'function') return false;
  try {
    const probe = new Uint8Array([0xff, 0xfe, 0xfd, 0x00, 0x01]);
    const out = Reflect.apply(toBase64, probe, [
      { alphabet: 'base64url', omitPadding: true },
    ]);
    return typeof out !== 'string' || /[+=/]/.test(out);
  } catch {
    return true;
  }
}

function ensureEs2025Shims(): void {
  // The lib.esnext types declare these, so `typeof` guards compile cleanly;
  // Object.defineProperty sidesteps matching the full declared signatures
  // (options bags, overloads) that the simple fills don't implement.
  if (typeof Promise.try !== 'function') {
    Object.defineProperty(Promise, 'try', {
      value: (fn: (...args: unknown[]) => unknown, ...args: unknown[]) =>
        new Promise((resolve) => resolve(fn(...args))),
      writable: true,
      configurable: true,
    });
  }

  // pdfjs 5.x calls this on plain Maps in both the main and worker builds
  // (`_intentStates`, `methodPromises`, `objs`, …). Node 22 lacks it, and the
  // failure is quiet: the operator-list read throws once per page, and that is
  // the path that finds embedded images and decides "scanned page → OCR". Text
  // extraction still runs, so a digital PDF looks fine while a scanned one
  // indexes thin or empty with only a warning to say so (#3018).
  //
  // Spec shape: return the existing value when the key is present; otherwise
  // compute, insert, and return. Presence, not truthiness — a callback that
  // returns `undefined` still counts, so a second call does not recompute.
  // `set` runs after the callback, as the proposal does: the callback may have
  // inserted the key itself, and the computed value wins.
  if (typeof Map.prototype.getOrInsertComputed !== 'function') {
    // oxlint-disable-next-line no-extend-native -- deliberate spec-shaped polyfill of an ES2025 method Node 22 lacks; guarded so a real runtime implementation wins
    Object.defineProperty(Map.prototype, 'getOrInsertComputed', {
      value: function <K, V>(this: Map<K, V>, key: K, callbackfn: (k: K) => V) {
        if (typeof callbackfn !== 'function') {
          throw new TypeError(
            'Map.prototype.getOrInsertComputed: callback is not a function',
          );
        }
        if (this.has(key)) return this.get(key);
        const value = callbackfn(key);
        this.set(key, value);
        return value;
      },
      writable: true,
      configurable: true,
    });
  }

  // Install when missing, or replace a process-global poison shim that
  // ignores `alphabet` (regression: always-`base64` loop). Native Node ≥24
  // / Bun implementations honor options and win the probe below.
  const needBase64Codecs =
    typeof Uint8Array.fromBase64 !== 'function' ||
    typeof Uint8Array.prototype.toBase64 !== 'function' ||
    toBase64IgnoresBase64urlAlphabet();
  if (needBase64Codecs) {
    Object.defineProperty(Uint8Array, 'fromBase64', {
      value: fromBase64Shim,
      writable: true,
      configurable: true,
    });
    // oxlint-disable-next-line no-extend-native -- deliberate spec-shaped polyfill of an ES2025 method Node 22 lacks; guarded so a correct native implementation wins
    Object.defineProperty(Uint8Array.prototype, 'toBase64', {
      value: toBase64Shim,
      writable: true,
      configurable: true,
    });
  }
  if (typeof Uint8Array.prototype.toHex !== 'function') {
    // oxlint-disable-next-line no-extend-native -- deliberate spec-shaped polyfill of an ES2025 method Node 22 lacks; guarded so a real runtime implementation wins
    Object.defineProperty(Uint8Array.prototype, 'toHex', {
      value: function (this: Uint8Array) {
        return Buffer.from(
          this.buffer,
          this.byteOffset,
          this.byteLength,
        ).toString('hex');
      },
      writable: true,
      configurable: true,
    });
  }
}

/**
 * Idempotently install the globals pdfjs needs, BEFORE pdfjs is imported.
 * Only fills gaps so a real browser/runtime global (or @napi-rs/canvas, if it
 * ever does load) still wins.
 *
 * Besides the DOM globals, pdfjs 5.x's modern build calls ES2025 APIs
 * unconditionally — `Promise.try` in its message handler, the `Uint8Array`
 * base64 codecs on font/signature paths — which Node 22 (V8 12.4) doesn't
 * ship. Fill those too; removable once the runtime moves to Node ≥24.
 *
 * ES2025 shims re-run on every call so a hot reload can replace a previously
 * installed options-blind `toBase64` without restarting the Node worker.
 */
export function installPdfjsDomGlobals(): void {
  ensureEs2025Shims();
  if (installed) return;
  installed = true;
  const g = globalThis as Record<string, unknown>;
  g.DOMMatrix ??= DOMMatrixPolyfill;
  g.ImageData ??= ImageDataPolyfill;
  g.Path2D ??= Path2DPolyfill;
}
