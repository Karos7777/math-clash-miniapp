const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const OUT_DIR = path.join(__dirname, "..", "public", "assets");

fs.mkdirSync(OUT_DIR, { recursive: true });

writePng(path.join(OUT_DIR, "icon.png"), 1024, 1024, (x, y, width, height) => {
  const nx = x / width;
  const ny = y / height;
  let color = mix([17, 19, 24], [24, 199, 150], nx * 0.42 + ny * 0.2);

  if (circle(x, y, 512, 512, 310)) color = [244, 188, 66];
  if (circle(x, y, 512, 512, 245)) color = [17, 19, 24];
  if (Math.abs(x - 512) < 58 && y > 260 && y < 764) color = [255, 255, 255];
  if (Math.abs(y - 512) < 58 && x > 260 && x < 764) color = [255, 255, 255];
  if (x > 660 && x < 810 && y > 190 && y < 340) color = [255, 107, 90];
  if (x > 708 && x < 762 && y > 140 && y < 390) color = [255, 107, 90];

  return color;
});

writePng(path.join(OUT_DIR, "splash.png"), 200, 200, (x, y, width, height) => {
  let color = mix([17, 19, 24], [111, 92, 255], x / width * 0.35);
  if (circle(x, y, 100, 100, 62)) color = [24, 199, 150];
  if (circle(x, y, 100, 100, 46)) color = [17, 19, 24];
  if (Math.abs(x - 100) < 10 && y > 52 && y < 148) color = [255, 255, 255];
  if (Math.abs(y - 100) < 10 && x > 52 && x < 148) color = [255, 255, 255];
  return color;
});

writePng(path.join(OUT_DIR, "og.png"), 1200, 630, (x, y, width, height) => {
  const nx = x / width;
  const ny = y / height;
  let color = mix([17, 19, 24], [24, 199, 150], nx * 0.28);
  color = mix(color, [111, 92, 255], ny * 0.24);

  if (y > 420 - Math.sin(nx * Math.PI * 4) * 30) {
    color = [255, 107, 90];
  }
  if (circle(x, y, 260, 250, 108)) color = [244, 188, 66];
  if (circle(x, y, 940, 250, 108)) color = [24, 199, 150];
  if (Math.abs(x - 600) < 38 && y > 205 && y < 425) color = [255, 255, 255];
  if (Math.abs(y - 315) < 38 && x > 490 && x < 710) color = [255, 255, 255];
  if (x > 190 && x < 330 && Math.abs(y - 250) < 22) color = [17, 19, 24];
  if (Math.abs(x - 905 - (y - 215)) < 18 && y > 190 && y < 310) color = [17, 19, 24];
  if (Math.abs(x - 975 + (y - 215)) < 18 && y > 190 && y < 310) color = [17, 19, 24];
  return color;
});

console.log("Generated PNG assets in public/assets");

function writePng(filePath, width, height, pixel) {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = y * stride + 1 + x * 3;
      const [r, g, b] = pixel(x, y, width, height).map((value) => clamp(Math.round(value)));
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
    }
  }

  const chunks = [
    chunk("IHDR", Buffer.concat([
      uint32(width),
      uint32(height),
      Buffer.from([8, 2, 0, 0, 0])
    ])),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ];

  fs.writeFileSync(filePath, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    ...chunks
  ]));
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  return Buffer.concat([
    uint32(data.length),
    typeBuffer,
    data,
    uint32(crc32(Buffer.concat([typeBuffer, data])))
  ]);
}

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0);
  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function mix(a, b, amount) {
  const t = Math.max(0, Math.min(1, amount));
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t
  ];
}

function circle(x, y, cx, cy, r) {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function clamp(value) {
  return Math.max(0, Math.min(255, value));
}
