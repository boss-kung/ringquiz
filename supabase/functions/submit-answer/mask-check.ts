// mask-check.ts — PNG mask decoding and circle overlap validation.
//
// Decoder: jsr:@img/png/decode (pure TypeScript, async, Deno/JSR-compatible).
//   decodePNG(Uint8Array) → Promise<{ header: PNGOptions, body: Uint8Array }>
//   header.width, header.height — image dimensions
//   body — raw RGBA pixel data, row-major, 4 bytes per pixel [R, G, B, A]
//
// Fallback: deno.land/x/pngs@0.1.1 (WASM-based, synchronous).
//   decode(Uint8Array) → { width, height, image: Uint8Array }
//   Swap import + adapter in decodeMaskBuffer() if @img/png causes issues.
//
// Pixel correctness rule (AND condition):
//   A pixel is in the correct zone if:
//     alpha > 128  (opaque enough)
//   AND
//     (
//       brightness > 200
//       OR
//       vivid yellow: R > 200, G > 200, B < 120
//     )
//
//   Recommended mask format:
//     White, fully opaque  (R=255,G=255,B=255,A=255) — correct zone  → passes both conditions
//     Yellow, fully opaque (R=255,G=255,B=0,  A=255) — correct zone  → passes yellow condition
//     Black, transparent   (R=0,  G=0,  B=0,  A=0  ) — wrong zone   → fails both conditions
//     Black, opaque        (R=0,  G=0,  B=0,  A=255) — wrong zone   → fails brightness check
//     White, transparent   (R=255,G=255,B=255,A=0  ) — wrong zone   → fails alpha check
//
//   Only pixels that are BOTH opaque AND bright count as correct.
//   This prevents dark opaque pixels from being accidentally scored as correct.
//
// Caching:
//   Decoded masks are cached in module scope (per Edge Function warm instance).
//   Cache key = mask_storage_path from question_masks table.
//   Cache survives across requests on the same instance; cleared on cold start.

import { decodePNG } from "jsr:@img/png/decode";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DecodedMask {
  width: number;
  height: number;
  data: Uint8Array; // RGBA, row-major, 4 bytes per pixel
}

// ─── Module-level cache ───────────────────────────────────────────────────────

const maskCache = new Map<string, DecodedMask>();

export function getCachedMask(cacheKey: string): DecodedMask | undefined {
  return maskCache.get(cacheKey);
}

export function evictMaskCache(cacheKey: string): void {
  maskCache.delete(cacheKey);
}

export function clearMaskCache(): void {
  maskCache.clear();
}

// ─── Main exported function ───────────────────────────────────────────────────

/**
 * Decodes a PNG mask and checks whether the player's circle overlaps any
 * correct-zone pixel.
 *
 * @param maskBuffer      - Raw PNG file bytes from private storage
 * @param xRatio          - Circle center X, normalized [0, 1]
 * @param yRatio          - Circle center Y, normalized [0, 1]
 * @param circleRadiusRatio - Circle radius as fraction of mask width, (0, 0.5]
 * @param cacheKey        - mask_storage_path; used to cache decoded PNG across calls
 * @param expectedWidth   - Expected mask pixel width; throws on mismatch if provided
 * @param expectedHeight  - Expected mask pixel height; throws on mismatch if provided
 */
export async function checkCircleOverlapsMask(
  maskBuffer: ArrayBuffer,
  xRatio: number,
  yRatio: number,
  circleRadiusRatio: number,
  cacheKey?: string,
  expectedWidth?: number,
  expectedHeight?: number,
): Promise<boolean> {
  validateRatios(xRatio, yRatio, circleRadiusRatio);

  let mask: DecodedMask;

  if (cacheKey && maskCache.has(cacheKey)) {
    mask = maskCache.get(cacheKey)!;
  } else {
    mask = await decodeMaskBuffer(maskBuffer);
    if (cacheKey) maskCache.set(cacheKey, mask);
  }

  if (expectedWidth !== undefined && mask.width !== expectedWidth) {
    throw new Error(
      `Mask width mismatch: decoded=${mask.width}, expected=${expectedWidth}. ` +
      `Ensure mask and question image have identical pixel dimensions.`,
    );
  }
  if (expectedHeight !== undefined && mask.height !== expectedHeight) {
    throw new Error(
      `Mask height mismatch: decoded=${mask.height}, expected=${expectedHeight}. ` +
      `Ensure mask and question image have identical pixel dimensions.`,
    );
  }

  return checkOverlapOnPixels(
    mask.data,
    mask.width,
    mask.height,
    xRatio,
    yRatio,
    circleRadiusRatio,
  );
}

// ─── Core algorithm — exported for unit testing ───────────────────────────────

/**
 * Pure function: checks circle-pixel overlap on pre-decoded RGBA data.
 * Exported so tests can inject synthetic pixel buffers without PNG encoding.
 *
 * Algorithm:
 *   1. Convert normalized coords to pixel coords in mask space.
 *   2. Compute bounding box of circle, clamped to image bounds.
 *   3. Iterate pixels in bounding box; skip those outside circle radius.
 *   4. Return true on first correct-zone pixel hit (early exit).
 */
export function checkOverlapOnPixels(
  data: Uint8Array,
  width: number,
  height: number,
  xRatio: number,
  yRatio: number,
  circleRadiusRatio: number,
): boolean {
  // Circle center in pixel space (may be fractional)
  const cx = xRatio * width;
  const cy = yRatio * height;
  // Radius relative to image width — consistent regardless of image aspect ratio
  const r = circleRadiusRatio * width;
  const rSquared = r * r;

  // Bounding box of the circle, clamped to image boundaries
  // Pixels outside image bounds are silently skipped — no throw
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(width - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(height - 1, Math.ceil(cy + r));

  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      // Skip pixels outside the circle
      const dx = px - cx;
      const dy = py - cy;
      if (dx * dx + dy * dy > rSquared) continue;

      // Read RGBA channels
      const i = (py * width + px) * 4;
      if (pixelIsCorrect(data[i], data[i + 1], data[i + 2], data[i + 3])) {
        return true; // Early exit on first correct-zone hit
      }
    }
  }

  return false;
}

/**
 * Pixel correctness rule.
 * Returns true if the pixel is in the correct answer zone.
 *
 * Rule:
 *   alpha > 128
 *   AND
 *   (
 *     brightness > 200
 *     OR
 *     vivid yellow: R > 200, G > 200, B < 120
 *   )
 * where brightness = (R + G + B) / 3
 *
 * Exported for direct unit testing.
 */
export function pixelIsCorrect(R: number, G: number, B: number, A: number): boolean {
  const brightness = (R + G + B) / 3;
  const vividYellow = R > 200 && G > 200 && B < 120;
  return A > 128 && (brightness > 200 || vividYellow);
}

// ─── PNG decoding ─────────────────────────────────────────────────────────────

async function decodeMaskBuffer(buffer: ArrayBuffer): Promise<DecodedMask> {
  const bytes = new Uint8Array(buffer);

  // jsr:@img/png/decode — pure TypeScript, async, no native dependencies.
  // Returns: { header: PNGOptions, body: Uint8Array }
  //   header.width, header.height — pixel dimensions
  //   body — RGBA pixel data, 4 bytes per pixel [R, G, B, A]
  const result = await decodePNG(bytes);

  if (!result || !result.header || !result.body) {
    throw new Error("PNG decode failed: unexpected result shape from decodePNG");
  }

  const { width, height } = result.header;

  if (!width || !height || width <= 0 || height <= 0) {
    throw new Error(`PNG decode returned invalid dimensions: ${width}x${height}`);
  }

  const expectedBytes = width * height * 4;
  if (result.body.length !== expectedBytes) {
    throw new Error(
      `PNG body length mismatch: got ${result.body.length}, expected ${expectedBytes} ` +
      `(${width}x${height}x4). Mask may not be in RGBA format.`,
    );
  }

  // Normalize to a plain Uint8Array (library may return Uint8ClampedArray on some runtimes)
  const data = new Uint8Array(result.body);

  return { width, height, data };
}

// ─── Input validation ─────────────────────────────────────────────────────────

function validateRatios(x: number, y: number, r: number): void {
  if (typeof x !== "number" || isNaN(x) || x < 0 || x > 1) {
    throw new RangeError(`xRatio must be a number in [0, 1], got: ${x}`);
  }
  if (typeof y !== "number" || isNaN(y) || y < 0 || y > 1) {
    throw new RangeError(`yRatio must be a number in [0, 1], got: ${y}`);
  }
  if (typeof r !== "number" || isNaN(r) || r <= 0 || r > 0.5) {
    throw new RangeError(`circleRadiusRatio must be in (0, 0.5], got: ${r}`);
  }
}
