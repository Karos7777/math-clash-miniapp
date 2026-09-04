#!/usr/bin/env python3
"""Draws the legacy launcher icons.

Android 8.0 and up use the adaptive icon in res/mipmap-anydpi-v26. Android 7.x
has no such thing and needs real bitmaps, so this renders the same artwork —
the crossing of a row and a column on one shared cell — into PNGs.

Run from the android/ directory:  python3 tools/make-icons.py
"""
import math
import os
import struct
import zlib

MASTER = 768          # rendered once at this size, then boxed down per density
SS = 3                # supersampling factor for anti-aliasing
DENSITIES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}

BG_TOP = (0x20, 0x2A, 0x4B)
BG_BOTTOM = (0x0B, 0x0F, 0x1C)
ROW_BAR = (0x6E, 0x8B, 0xFF)
COL_BAR = (0xA1, 0x77, 0xFF)
NODE = (0xF0, 0xB4, 0x29)
NODE_CORE = (0x15, 0x1B, 0x2E)

# Geometry in unit coordinates, matching ic_launcher_foreground.xml.
BAR_HALF = 10 / 108 / 2
BAR_FROM, BAR_TO = 30 / 108, 78 / 108
NODE_R = 10.5 / 108
CORE_R = 4 / 108
CORNER_R = 0.22


def blend(dst, src, alpha):
    return tuple(round(d + (s - d) * alpha) for d, s in zip(dst, src))


def segment_distance(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def rounded_box_distance(px, py, radius):
    """Signed distance to a rounded square covering the whole unit tile."""
    qx, qy = abs(px - 0.5) - (0.5 - radius), abs(py - 0.5) - (0.5 - radius)
    outside = math.hypot(max(qx, 0.0), max(qy, 0.0))
    return outside + min(max(qx, qy), 0.0) - radius


def render(size, round_icon):
    pixels = [[(0, 0, 0, 0)] * size for _ in range(size)]
    step = 1.0 / (size * SS)
    for y in range(size):
        row = pixels[y]
        for x in range(size):
            r = g = b = a = 0.0
            for sy in range(SS):
                for sx in range(SS):
                    px = (x * SS + sx + 0.5) * step
                    py = (y * SS + sy + 0.5) * step
                    if round_icon:
                        inside = math.hypot(px - 0.5, py - 0.5) <= 0.5
                    else:
                        inside = rounded_box_distance(px, py, CORNER_R) <= 0.0
                    if not inside:
                        continue
                    shade = py
                    colour = tuple(
                        round(t + (bm - t) * shade) for t, bm in zip(BG_TOP, BG_BOTTOM)
                    )
                    if segment_distance(px, py, BAR_FROM, 0.5, BAR_TO, 0.5) <= BAR_HALF:
                        colour = ROW_BAR
                    if segment_distance(px, py, 0.5, BAR_FROM, 0.5, BAR_TO) <= BAR_HALF:
                        colour = COL_BAR
                    centre = math.hypot(px - 0.5, py - 0.5)
                    if centre <= NODE_R:
                        colour = NODE
                    if centre <= CORE_R:
                        colour = NODE_CORE
                    r += colour[0]
                    g += colour[1]
                    b += colour[2]
                    a += 1.0
            total = SS * SS
            if a == 0:
                row[x] = (0, 0, 0, 0)
            else:
                row[x] = (round(r / a), round(g / a), round(b / a), round(255 * a / total))
    return pixels


def write_png(path, pixels):
    size = len(pixels)
    raw = bytearray()
    for row in pixels:
        raw.append(0)
        for r, g, b, a in row:
            raw += bytes((r, g, b, a))

    def chunk(tag, payload):
        return (
            struct.pack(">I", len(payload))
            + tag
            + payload
            + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
        )

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as handle:
        handle.write(png)


def downsample(master, target):
    source = len(master)
    scale = source / target
    out = []
    for y in range(target):
        row = []
        y0, y1 = int(y * scale), max(int(y * scale) + 1, int((y + 1) * scale))
        for x in range(target):
            x0, x1 = int(x * scale), max(int(x * scale) + 1, int((x + 1) * scale))
            r = g = b = a = 0
            count = 0
            for sy in range(y0, y1):
                for sx in range(x0, x1):
                    pr, pg, pb, pa = master[sy][sx]
                    r += pr * pa
                    g += pg * pa
                    b += pb * pa
                    a += pa
                    count += 1
            if a == 0:
                row.append((0, 0, 0, 0))
            else:
                row.append((round(r / a), round(g / a), round(b / a), round(a / count)))
        out.append(row)
    return out


def main():
    for name, round_icon in (("ic_launcher", False), ("ic_launcher_round", True)):
        master = render(MASTER, round_icon)
        for density, size in DENSITIES.items():
            path = os.path.join("app", "src", "main", "res", f"mipmap-{density}", f"{name}.png")
            write_png(path, downsample(master, size))
            print("wrote", path)


if __name__ == "__main__":
    main()
