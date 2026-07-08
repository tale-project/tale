'use node';

/**
 * Pure-JS DOM-global polyfills for running pdfjs-dist in the Convex node
 * action runtime.
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

/**
 * ES2025 shims for the modern (non-legacy) pdfjs build on Node 22 — the floor
 * across dev hosts, CI runners, and the upstream convex-backend image (its
 * .nvmrc pins 22.x). pdfjs calls `Promise.try` (MessageHandler — every
 * worker message), `Uint8Array.prototype.toHex` (document fingerprints —
 * every getDocument), `Uint8Array.fromBase64` (XFA / signature data), and
 * `Uint8Array.prototype.toBase64` (data URLs, signature bytes) without
 * feature-testing; all four only land natively in Node 24. The legacy build
 * covered them via ~2 MB of bundled core-js — these few lines replace that.
 * pdfjs passes no options objects to the base64 calls, but `alphabet` costs
 * nothing to honor via Buffer's `base64url` codec.
 */
/**
 * Install `value` as `target[name]` unless it already exists (native or an
 * earlier shim). `Object.defineProperty` defaults to non-enumerable, matching
 * the native methods, and needs no type assertion on the target.
 */
function defineShim(target: object, name: string, value: unknown): void {
  if (name in target) return;
  Object.defineProperty(target, name, {
    value,
    writable: true,
    configurable: true,
  });
}

function installEs2025Shims(): void {
  defineShim(
    Promise,
    'try',
    function tryShim(
      fn: (...args: unknown[]) => unknown,
      ...args: unknown[]
    ): Promise<unknown> {
      return new Promise((resolve) => resolve(fn(...args)));
    },
  );

  defineShim(
    Uint8Array,
    'fromBase64',
    function fromBase64Shim(
      base64: string,
      options?: { alphabet?: 'base64' | 'base64url' },
    ): Uint8Array {
      const encoding =
        options?.alphabet === 'base64url' ? 'base64url' : 'base64';
      // new Uint8Array(buffer) copies exactly the Buffer's view — never build
      // a view over buf.buffer, which may be Node's shared allocation pool.
      return new Uint8Array(Buffer.from(base64, encoding));
    },
  );

  defineShim(
    Uint8Array.prototype,
    'toBase64',
    function toBase64Shim(
      this: Uint8Array,
      options?: { alphabet?: 'base64' | 'base64url' },
    ): string {
      const encoding =
        options?.alphabet === 'base64url' ? 'base64url' : 'base64';
      return Buffer.from(
        this.buffer,
        this.byteOffset,
        this.byteLength,
      ).toString(encoding);
    },
  );

  defineShim(
    Uint8Array.prototype,
    'toHex',
    function toHexShim(this: Uint8Array): string {
      return Buffer.from(
        this.buffer,
        this.byteOffset,
        this.byteLength,
      ).toString('hex');
    },
  );
}

let installed = false;

/**
 * Idempotently install the DOM globals pdfjs needs, BEFORE pdfjs is imported.
 * Only fills gaps so a real browser/runtime global (or @napi-rs/canvas, if it
 * ever does load) still wins.
 */
export function installPdfjsDomGlobals(): void {
  if (installed) return;
  installed = true;
  const g = globalThis as Record<string, unknown>;
  g.DOMMatrix ??= DOMMatrixPolyfill;
  g.ImageData ??= ImageDataPolyfill;
  g.Path2D ??= Path2DPolyfill;
  installEs2025Shims();
}
