"""
Generates test question image and mask PNG for quiz game seed.

Image: 400x300, left half blue / right half red
Mask:  400x300 RGBA
         left half  (x < 200) → transparent black  → INCORRECT zone
         right half (x >= 200) → opaque white       → CORRECT zone

Correct  coordinate: xRatio=0.75, yRatio=0.50  (center of right half)
Incorrect coordinate: xRatio=0.25, yRatio=0.50  (center of left half)
"""

import zlib, struct, os

OUT_DIR = os.path.join(os.path.dirname(__file__), "test_assets")
os.makedirs(OUT_DIR, exist_ok=True)

W, H = 400, 300


def png_chunk(tag: bytes, data: bytes) -> bytes:
    c = zlib.crc32(tag + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", c)


def write_png(path: str, rows: list[bytes], width: int, height: int, color_type: int):
    # color_type 2 = RGB, 6 = RGBA
    ihdr = struct.pack(">IIBBBBB", width, height, 8, color_type, 0, 0, 0)
    raw = b"".join(b"\x00" + row for row in rows)   # filter byte 0 per row
    idat = zlib.compress(raw, 9)
    sig = b"\x89PNG\r\n\x1a\n"
    with open(path, "wb") as f:
        f.write(sig)
        f.write(png_chunk(b"IHDR", ihdr))
        f.write(png_chunk(b"IDAT", idat))
        f.write(png_chunk(b"IEND", b""))
    print(f"  wrote {path}  ({os.path.getsize(path)} bytes)")


# ── Question image (RGB) ────────────────────────────────────────────────────
img_rows = []
for y in range(H):
    row = bytearray()
    for x in range(W):
        if x < W // 2:
            row += bytes([30, 100, 220])    # blue
        else:
            row += bytes([220, 60, 60])     # red
    img_rows.append(bytes(row))

img_path = os.path.join(OUT_DIR, "test_question.png")
write_png(img_path, img_rows, W, H, color_type=2)

# ── Mask (RGBA) ─────────────────────────────────────────────────────────────
# Pixel rule (server-side): A > 128 AND (R+G+B)/3 > 200
# Correct zone  → opaque white (255,255,255,255) ✓ both conditions true
# Incorrect zone → fully transparent (0,0,0,0)   ✗ A=0 fails first condition

mask_rows = []
for y in range(H):
    row = bytearray()
    for x in range(W):
        if x >= W // 2:
            row += bytes([255, 255, 255, 255])  # correct (right half)
        else:
            row += bytes([0, 0, 0, 0])          # incorrect (left half)
    mask_rows.append(bytes(row))

mask_path = os.path.join(OUT_DIR, "test_mask.png")
write_png(mask_path, mask_rows, W, H, color_type=6)

print()
print("Done. Files in scripts/test_assets/")
print()
print("Upload paths:")
print("  question-images bucket → test_question.png")
print("  question-masks  bucket → test_mask.png")
print()
print("Correct   coordinate: xRatio=0.75, yRatio=0.50")
print("Incorrect coordinate: xRatio=0.25, yRatio=0.50")
