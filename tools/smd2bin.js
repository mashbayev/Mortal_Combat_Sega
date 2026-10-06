#!/usr/bin/env node
// Converts an interleaved Super Magic Drive dump (.smd) into a raw Mega Drive ROM (.bin).
// Usage: node tools/smd2bin.js input.smd output.bin
const fs = require("fs");

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("Usage: node tools/smd2bin.js input.smd output.bin");
  process.exit(1);
}

const src = fs.readFileSync(input);
const HEADER = 512;
const BLOCK = 16384;
const body = src.subarray(src.length % BLOCK === HEADER ? HEADER : 0);
if (body.length % BLOCK !== 0) {
  console.error("Not an SMD file: size is not a multiple of 16 KB");
  process.exit(1);
}

const out = Buffer.alloc(body.length);
for (let b = 0; b < body.length; b += BLOCK) {
  const half = BLOCK / 2;
  for (let i = 0; i < half; i++) {
    out[b + i * 2] = body[b + half + i]; // even bytes live in the second half
    out[b + i * 2 + 1] = body[b + i]; // odd bytes live in the first half
  }
}

const title = out.subarray(0x150, 0x180).toString("latin1").trim();
fs.writeFileSync(output, out);
console.log(`OK: ${output} (${out.length} bytes) — "${title}"`);
