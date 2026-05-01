// mask-check.test.ts — unit and integration tests for mask validation.
//
// Run: deno test supabase/functions/submit-answer/mask-check.test.ts --allow-net
//
// Unit tests use checkOverlapOnPixels() and pixelIsCorrect() directly with
// synthetic RGBA buffers — no PNG encoding or decoding required.
//
// Integration tests use encodePNG() to produce real PNG bytes, then exercise
// the full checkCircleOverlapsMask() pipeline including the decoder.

import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import { encodePNG } from "jsr:@img/png/encode";
import {
  checkCircleOverlapsMask,
  checkOverlapOnPixels,
  clearMaskCache,
  pixelIsCorrect,
} from "./mask-check.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Creates a flat RGBA buffer filled with a single color. */
function makePixels(
  width: number,
  height: number,
  rgba: [number, number, number, number],
): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4]     = rgba[0];
    data[i * 4 + 1] = rgba[1];
    data[i * 4 + 2] = rgba[2];
    data[i * 4 + 3] = rgba[3];
  }
  return data;
}

/** Sets a single pixel in an RGBA buffer. */
function setPixel(
  data: Uint8Array,
  width: number,
  x: number,
  y: number,
  rgba: [number, number, number, number],
): void {
  const i = (y * width + x) * 4;
  data[i]     = rgba[0];
  data[i + 1] = rgba[1];
  data[i + 2] = rgba[2];
  data[i + 3] = rgba[3];
}

/** Encodes an RGBA pixel buffer to a PNG ArrayBuffer for integration tests. */
async function makePng(
  pixels: Uint8Array,
  width: number,
  height: number,
): Promise<ArrayBuffer> {
  const encoded = await encodePNG(
    pixels as Uint8Array<ArrayBuffer>,
    { width, height, compression: 0, filter: 0, interlace: 0 } as Parameters<typeof encodePNG>[1],
  );
  return encoded.buffer as ArrayBuffer;
}

// ─── pixelIsCorrect — unit tests ─────────────────────────────────────────────

Deno.test("pixelIsCorrect: white opaque pixel → correct", () => {
  assertEquals(pixelIsCorrect(255, 255, 255, 255), true);
});

Deno.test("pixelIsCorrect: vivid yellow opaque pixel → correct", () => {
  assertEquals(pixelIsCorrect(255, 255, 0, 255), true);
});

Deno.test("pixelIsCorrect: black transparent pixel → incorrect", () => {
  assertEquals(pixelIsCorrect(0, 0, 0, 0), false);
});

Deno.test("pixelIsCorrect: opaque black pixel (alpha > 128, dim) → incorrect (AND rule)", () => {
  // Black fully opaque: alpha=255 passes but brightness=0 fails → incorrect
  assertEquals(pixelIsCorrect(0, 0, 0, 255), false);
});

Deno.test("pixelIsCorrect: bright but mostly transparent pixel (alpha ≤ 128) → incorrect (AND rule)", () => {
  // White but almost transparent: alpha=10 fails even though brightness=255 > 200
  assertEquals(pixelIsCorrect(255, 255, 255, 10), false);
});

Deno.test("pixelIsCorrect: dark semi-transparent pixel → incorrect", () => {
  // Both conditions fail: alpha=100 (≤128), brightness=50 (≤200)
  assertEquals(pixelIsCorrect(50, 50, 50, 100), false);
});

Deno.test("pixelIsCorrect: mid-brightness dark pixel → incorrect", () => {
  // brightness = (150+150+150)/3 = 150 ≤ 200, alpha = 0 ≤ 128
  assertEquals(pixelIsCorrect(150, 150, 150, 0), false);
});

Deno.test("pixelIsCorrect: high-brightness but transparent pixel → incorrect (AND rule)", () => {
  // brightness = (220+210+215)/3 ≈ 215 > 200, but alpha=0 fails → incorrect
  assertEquals(pixelIsCorrect(220, 210, 215, 0), false);
});

Deno.test("pixelIsCorrect: exactly threshold alpha=128 → incorrect", () => {
  // alpha=128 is NOT > 128; AND fails regardless of brightness
  assertEquals(pixelIsCorrect(0, 0, 0, 128), false);
});

Deno.test("pixelIsCorrect: alpha=129 but dim → incorrect (AND rule)", () => {
  // alpha=129 passes alpha check but brightness=0 fails → incorrect
  assertEquals(pixelIsCorrect(0, 0, 0, 129), false);
});

Deno.test("pixelIsCorrect: opaque warm orange is still incorrect", () => {
  // Orange should not accidentally pass the yellow rule.
  assertEquals(pixelIsCorrect(255, 170, 0, 255), false);
});

Deno.test("pixelIsCorrect: brightness exactly 200 → incorrect", () => {
  // brightness=200 is NOT > 200; AND fails regardless of alpha
  assertEquals(pixelIsCorrect(200, 200, 200, 0), false);
});

Deno.test("pixelIsCorrect: brightness=201 but transparent → incorrect (AND rule)", () => {
  // brightness=201 passes brightness check but alpha=0 fails → incorrect
  assertEquals(pixelIsCorrect(201, 201, 201, 0), false);
});

Deno.test("pixelIsCorrect: opaque white pixel (alpha=129, brightness=201) → correct (AND rule)", () => {
  // Passes both: alpha=129 > 128, brightness=201 > 200
  assertEquals(pixelIsCorrect(201, 201, 201, 129), true);
});

Deno.test("pixelIsCorrect: bright opaque white (alpha=255, brightness=255) → correct (AND rule)", () => {
  assertEquals(pixelIsCorrect(255, 255, 255, 129), true);
});

// ─── checkOverlapOnPixels — unit tests ───────────────────────────────────────

Deno.test("checkOverlapOnPixels: all-white mask → circle always overlaps", () => {
  const W = 100, H = 100;
  const data = makePixels(W, H, [255, 255, 255, 255]);
  // Circle anywhere in the image should hit a white pixel
  assertEquals(checkOverlapOnPixels(data, W, H, 0.5, 0.5, 0.1), true);
  assertEquals(checkOverlapOnPixels(data, W, H, 0.1, 0.1, 0.05), true);
  assertEquals(checkOverlapOnPixels(data, W, H, 0.9, 0.9, 0.05), true);
});

Deno.test("checkOverlapOnPixels: all-black opaque mask → circle never overlaps", () => {
  // Black opaque pixels pass alpha check but fail brightness check → AND rule → incorrect
  const W = 100, H = 100;
  const data = makePixels(W, H, [0, 0, 0, 255]);
  assertEquals(checkOverlapOnPixels(data, W, H, 0.5, 0.5, 0.1), false);
  assertEquals(checkOverlapOnPixels(data, W, H, 0.1, 0.1, 0.05), false);
});

Deno.test("checkOverlapOnPixels: all-transparent mask → circle never overlaps", () => {
  const W = 100, H = 100;
  const data = makePixels(W, H, [0, 0, 0, 0]);
  assertEquals(checkOverlapOnPixels(data, W, H, 0.5, 0.5, 0.2), false);
});

Deno.test("checkOverlapOnPixels: single white pixel at center, circle overlaps → correct", () => {
  const W = 100, H = 100;
  // All black, one white pixel at exact center (50, 50)
  const data = makePixels(W, H, [0, 0, 0, 0]);
  setPixel(data, W, 50, 50, [255, 255, 255, 255]);

  // Circle centered at (0.5, 0.5) with radius 0.05 (5px) → center is at pixel (50,50)
  // The white pixel is at pixel (50,50) which is inside the circle
  assertEquals(checkOverlapOnPixels(data, W, H, 0.505, 0.505, 0.05), true);
});

Deno.test("checkOverlapOnPixels: single white pixel at center, circle does not overlap → incorrect", () => {
  const W = 100, H = 100;
  // White pixel at (50, 50)
  const data = makePixels(W, H, [0, 0, 0, 0]);
  setPixel(data, W, 50, 50, [255, 255, 255, 255]);

  // Circle centered far away at (0.1, 0.1) with small radius → cannot reach pixel (50,50)
  assertEquals(checkOverlapOnPixels(data, W, H, 0.1, 0.1, 0.05), false);
});

Deno.test("checkOverlapOnPixels: small white zone, circle barely overlaps → correct", () => {
  const W = 200, H = 200;
  // White zone: 5×5 block at top-left (pixels 10–14 in x, 10–14 in y)
  const data = makePixels(W, H, [0, 0, 0, 0]);
  for (let y = 10; y <= 14; y++) {
    for (let x = 10; x <= 14; x++) {
      setPixel(data, W, x, y, [255, 255, 255, 255]);
    }
  }

  // Circle centered at pixel (16, 12) = ratio (0.08, 0.06), radius 0.02 = 4px
  // Distance from center (16,12) to nearest zone edge (14, 12) = 2 < 4 → overlap
  assertEquals(checkOverlapOnPixels(data, W, H, 0.08, 0.06, 0.02), true);
});

Deno.test("checkOverlapOnPixels: small white zone, circle just outside → incorrect", () => {
  const W = 200, H = 200;
  // White zone: 5×5 block at pixels (10–14, 10–14)
  const data = makePixels(W, H, [0, 0, 0, 0]);
  for (let y = 10; y <= 14; y++) {
    for (let x = 10; x <= 14; x++) {
      setPixel(data, W, x, y, [255, 255, 255, 255]);
    }
  }

  // Circle centered at pixel (30, 30) = ratio (0.15, 0.15), radius 0.02 = 4px
  // Nearest white pixel is at (14,14); distance = sqrt((30-14)²+(30-14)²) ≈ 22.6 >> 4
  assertEquals(checkOverlapOnPixels(data, W, H, 0.15, 0.15, 0.02), false);
});

Deno.test("checkOverlapOnPixels: circle partially outside image bounds → no throw, returns false for off-screen area", () => {
  const W = 100, H = 100;
  const data = makePixels(W, H, [0, 0, 0, 0]); // all black

  // Circle centered at corner pixel (0,0) with radius going outside bounds
  // xRatio=0, yRatio=0, radius=0.2 → circle extends left and up off screen
  // No throw expected; out-of-bounds pixels are clamped/skipped
  assertEquals(checkOverlapOnPixels(data, W, H, 0.0, 0.0, 0.2), false);
});

Deno.test("checkOverlapOnPixels: circle at edge with some correct pixels in bounds → correct", () => {
  const W = 100, H = 100;
  // White pixel at (0, 0) — top-left corner
  const data = makePixels(W, H, [0, 0, 0, 0]);
  setPixel(data, W, 0, 0, [255, 255, 255, 255]);

  // Circle centered at (0,0) with radius 5px — the corner pixel is at distance 0 from center
  assertEquals(checkOverlapOnPixels(data, W, H, 0.0, 0.0, 0.05), true);
});

Deno.test("checkOverlapOnPixels: 1x1 image with white pixel, circle centered on pixel → correct", () => {
  // Algorithm samples integer pixel coords; circle center must be at or near (0,0).
  // xRatio=0,yRatio=0 → cx=0,cy=0; r=0.5 → dx=0,dy=0 → inside circle.
  const data = makePixels(1, 1, [255, 255, 255, 255]);
  assertEquals(checkOverlapOnPixels(data, 1, 1, 0.0, 0.0, 0.5), true);
});

Deno.test("checkOverlapOnPixels: 1x1 image with black pixel, circle centered on pixel → incorrect", () => {
  const data = makePixels(1, 1, [0, 0, 0, 0]);
  assertEquals(checkOverlapOnPixels(data, 1, 1, 0.0, 0.0, 0.5), false);
});

// ─── checkCircleOverlapsMask — integration tests (full PNG pipeline) ──────────

Deno.test({
  name: "checkCircleOverlapsMask: all-white PNG → correct",
  async fn() {
    clearMaskCache();
    const W = 20, H = 20;
    const pixels = makePixels(W, H, [255, 255, 255, 255]);
    const pngBuffer = await makePng(pixels, W, H);

    const result = await checkCircleOverlapsMask(
      pngBuffer,
      0.5, 0.5,  // circle center
      0.1,       // radius ratio
    );
    assertEquals(result, true);
  },
});

Deno.test({
  name: "checkCircleOverlapsMask: all-black opaque PNG → incorrect (AND rule: dark fails brightness)",
  async fn() {
    clearMaskCache();
    const W = 20, H = 20;
    // Black opaque pixels: alpha=255 passes but brightness=0 fails → AND → false
    const pixels = makePixels(W, H, [0, 0, 0, 255]);
    const pngBuffer = await makePng(pixels, W, H);

    const result = await checkCircleOverlapsMask(
      pngBuffer,
      0.5, 0.5,
      0.1,
    );
    assertEquals(result, false);
  },
});

Deno.test({
  name: "checkCircleOverlapsMask: dim gray opaque PNG → incorrect (brightness below threshold)",
  async fn() {
    clearMaskCache();
    const W = 20, H = 20;
    // brightness = (100+100+100)/3 = 100 ≤ 200; alpha=255 passes but brightness fails
    const pixels = makePixels(W, H, [100, 100, 100, 255]);
    const pngBuffer = await makePng(pixels, W, H);

    const result = await checkCircleOverlapsMask(
      pngBuffer,
      0.5, 0.5,
      0.1,
    );
    assertEquals(result, false);
  },
});

Deno.test({
  name: "checkCircleOverlapsMask: partially transparent white (alpha=128) → incorrect (alpha not > 128)",
  async fn() {
    clearMaskCache();
    const W = 20, H = 20;
    // alpha=128 is NOT > 128; brightness=255 would pass but AND fails
    const pixels = makePixels(W, H, [255, 255, 255, 128]);
    const pngBuffer = await makePng(pixels, W, H);

    const result = await checkCircleOverlapsMask(
      pngBuffer,
      0.5, 0.5,
      0.1,
    );
    assertEquals(result, false);
  },
});

Deno.test({
  name: "checkCircleOverlapsMask: partially transparent white (alpha=129) → correct (both conditions met)",
  async fn() {
    clearMaskCache();
    const W = 20, H = 20;
    // alpha=129 > 128, brightness=255 > 200 → AND passes
    const pixels = makePixels(W, H, [255, 255, 255, 129]);
    const pngBuffer = await makePng(pixels, W, H);

    const result = await checkCircleOverlapsMask(
      pngBuffer,
      0.5, 0.5,
      0.1,
    );
    assertEquals(result, true);
  },
});

Deno.test({
  name: "checkCircleOverlapsMask: all-transparent PNG → incorrect",
  async fn() {
    clearMaskCache();
    const W = 20, H = 20;
    const pixels = makePixels(W, H, [0, 0, 0, 0]);
    const pngBuffer = await makePng(pixels, W, H);

    const result = await checkCircleOverlapsMask(
      pngBuffer,
      0.5, 0.5,
      0.1,
    );
    assertEquals(result, false);
  },
});

Deno.test({
  name: "checkCircleOverlapsMask: single white pixel, circle overlaps → correct",
  async fn() {
    clearMaskCache();
    const W = 100, H = 100;
    // All transparent/black, single white target at center
    const pixels = makePixels(W, H, [0, 0, 0, 0]);
    setPixel(pixels, W, 50, 50, [255, 255, 255, 255]);
    const pngBuffer = await makePng(pixels, W, H);

    // Circle centered near pixel (50,50) with radius 5px — pixel is within circle
    const result = await checkCircleOverlapsMask(
      pngBuffer,
      0.505, 0.505,  // ≈ pixel (50.5, 50.5)
      0.05,          // radius = 5px on a 100px-wide image
    );
    assertEquals(result, true);
  },
});

Deno.test({
  name: "checkCircleOverlapsMask: single white pixel, circle does not overlap → incorrect",
  async fn() {
    clearMaskCache();
    const W = 100, H = 100;
    const pixels = makePixels(W, H, [0, 0, 0, 0]);
    setPixel(pixels, W, 50, 50, [255, 255, 255, 255]); // white pixel at center
    const pngBuffer = await makePng(pixels, W, H);

    // Circle far away at (0.1, 0.1) with radius 0.05 → cannot reach pixel (50, 50)
    const result = await checkCircleOverlapsMask(
      pngBuffer,
      0.1, 0.1,
      0.05,
    );
    assertEquals(result, false);
  },
});

Deno.test({
  name: "checkCircleOverlapsMask: circle partially outside image bounds → no throw",
  async fn() {
    clearMaskCache();
    const W = 50, H = 50;
    const pixels = makePixels(W, H, [0, 0, 0, 0]); // all black
    const pngBuffer = await makePng(pixels, W, H);

    // Circle centered at (0,0) — half of it is off-screen
    const result = await checkCircleOverlapsMask(
      pngBuffer,
      0.0, 0.0,
      0.2, // radius = 10px — extends left and up outside image
    );
    assertEquals(result, false); // no black pixels pass the check; no throw
  },
});

Deno.test({
  name: "checkCircleOverlapsMask: dimension mismatch → throws",
  async fn() {
    clearMaskCache();
    const W = 100, H = 100;
    const pixels = makePixels(W, H, [255, 255, 255, 255]);
    const pngBuffer = await makePng(pixels, W, H);

    // Tell it to expect 200x200 but the PNG is 100x100
    await assertRejects(
      () => checkCircleOverlapsMask(pngBuffer, 0.5, 0.5, 0.1, undefined, 200, 200),
      Error,
      "Mask width mismatch",
    );
  },
});

Deno.test({
  name: "checkCircleOverlapsMask: dimension mismatch height → throws",
  async fn() {
    clearMaskCache();
    const W = 100, H = 50;
    const pixels = makePixels(W, H, [255, 255, 255, 255]);
    const pngBuffer = await makePng(pixels, W, H);

    await assertRejects(
      () => checkCircleOverlapsMask(pngBuffer, 0.5, 0.5, 0.1, undefined, 100, 200),
      Error,
      "Mask height mismatch",
    );
  },
});

Deno.test({
  name: "checkCircleOverlapsMask: caching — second call uses cache, same result",
  async fn() {
    clearMaskCache();
    const W = 30, H = 30;
    const pixels = makePixels(W, H, [255, 255, 255, 255]); // all white
    const pngBuffer = await makePng(pixels, W, H);

    const key = "test-cache-key-001";
    const r1 = await checkCircleOverlapsMask(pngBuffer, 0.5, 0.5, 0.1, key);
    // Second call — buffer is empty ArrayBuffer; cache should serve the result
    const r2 = await checkCircleOverlapsMask(new ArrayBuffer(0), 0.5, 0.5, 0.1, key);
    assertEquals(r1, true);
    assertEquals(r2, true); // served from cache
  },
});

// ─── Input validation tests ───────────────────────────────────────────────────

Deno.test("checkOverlapOnPixels: x_ratio below range not validated here (validated in Edge Function)", () => {
  // checkOverlapOnPixels itself does NOT validate — it trusts the caller.
  // Validation happens in checkCircleOverlapsMask via validateRatios().
  // This test confirms the function doesn't throw on valid inputs.
  const data = makePixels(10, 10, [0, 0, 0, 0]);
  assertEquals(checkOverlapOnPixels(data, 10, 10, 0.0, 0.0, 0.05), false);
  assertEquals(checkOverlapOnPixels(data, 10, 10, 1.0, 1.0, 0.05), false);
});

Deno.test({
  name: "checkCircleOverlapsMask: xRatio out of range → throws RangeError",
  async fn() {
    const buf = new ArrayBuffer(1);
    await assertRejects(
      () => checkCircleOverlapsMask(buf, -0.1, 0.5, 0.1),
      RangeError,
      "xRatio",
    );
    await assertRejects(
      () => checkCircleOverlapsMask(buf, 1.1, 0.5, 0.1),
      RangeError,
      "xRatio",
    );
  },
});

Deno.test({
  name: "checkCircleOverlapsMask: yRatio out of range → throws RangeError",
  async fn() {
    const buf = new ArrayBuffer(1);
    await assertRejects(
      () => checkCircleOverlapsMask(buf, 0.5, -0.01, 0.1),
      RangeError,
      "yRatio",
    );
    await assertRejects(
      () => checkCircleOverlapsMask(buf, 0.5, 1.01, 0.1),
      RangeError,
      "yRatio",
    );
  },
});

Deno.test({
  name: "checkCircleOverlapsMask: radiusRatio zero → throws RangeError",
  async fn() {
    const buf = new ArrayBuffer(1);
    await assertRejects(
      () => checkCircleOverlapsMask(buf, 0.5, 0.5, 0),
      RangeError,
      "circleRadiusRatio",
    );
  },
});

Deno.test({
  name: "checkCircleOverlapsMask: radiusRatio > 0.5 → throws RangeError",
  async fn() {
    const buf = new ArrayBuffer(1);
    await assertRejects(
      () => checkCircleOverlapsMask(buf, 0.5, 0.5, 0.51),
      RangeError,
      "circleRadiusRatio",
    );
  },
});

Deno.test({
  name: "checkCircleOverlapsMask: NaN ratio → throws RangeError",
  async fn() {
    const buf = new ArrayBuffer(1);
    await assertRejects(
      () => checkCircleOverlapsMask(buf, NaN, 0.5, 0.1),
      RangeError,
      "xRatio",
    );
  },
});

// ─── Edge case: circle exactly at image boundary pixels ───────────────────────

Deno.test("checkOverlapOnPixels: circle centered at exact image edge, white border → correct", () => {
  const W = 100, H = 100;
  const data = makePixels(W, H, [0, 0, 0, 0]);
  // White pixels along the right edge
  for (let y = 0; y < H; y++) setPixel(data, W, W - 1, y, [255, 255, 255, 255]);

  // Circle centered at (1.0, 0.5) → pixel x = 100 (out of bounds), radius 0.02 = 2px
  // The circle extends from pixel x=98 to x=102; only x=98..99 are in bounds.
  // x=99 is the right-edge white pixel → should return true
  assertEquals(checkOverlapOnPixels(data, W, H, 1.0, 0.5, 0.02), true);
});

Deno.test("checkOverlapOnPixels: circle fully outside image bounds → false, no throw", () => {
  const W = 100, H = 100;
  const data = makePixels(W, H, [255, 255, 255, 255]); // all white
  // Circle at xRatio=2.0 — completely off right side; bounding box clamped to empty range
  // Should return false since no pixels are sampled
  assertEquals(checkOverlapOnPixels(data, W, H, 2.0, 0.5, 0.1), false);
});
