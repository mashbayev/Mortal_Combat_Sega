// Read-only access to the Mega Drive 68k work RAM (0xFF0000-0xFFFFFF) inside the
// Genesis Plus GX wasm heap. The core doesn't export the RAM pointer, so we find it
// by matching a chunk of a fresh save state against the heap.

const RAM_SIZE = 0x10000;
const PROBE = 128;

// Genesis Plus GX save state payload starts with a 16-byte version string, then work RAM.
function workRamFromState(state) {
  let offset = 0;
  const tag = String.fromCharCode(...state.subarray(0, 7));
  if (tag === "RASTATE") offset = 16; // RetroArch wrapper: "RASTATE\1" + "MEM " + u32 size
  const version = String.fromCharCode(...state.subarray(offset, offset + 10));
  if (version !== "GENPLUS-GX") return null;
  return state.subarray(offset + 16, offset + 16 + RAM_SIZE);
}

function pickProbe(ram) {
  for (let off = 0; off + PROBE <= RAM_SIZE; off += 0x400) {
    const chunk = ram.subarray(off, off + PROBE);
    if (new Set(chunk).size > 32) return off;
  }
  return -1;
}

export class MegaDriveRam {
  constructor(ejs) {
    this.module = ejs.Module;
    this.gameManager = ejs.gameManager;
    this.base = -1;
  }

  // Returns true once the RAM was found. Cheap to call again after success.
  locate() {
    if (this.base >= 0) return true;
    const ram = workRamFromState(this.gameManager.getState());
    if (!ram) return false;
    const off = pickProbe(ram);
    if (off < 0) return false; // RAM still mostly empty (boot screen) — try again later
    const heap = this.module.HEAPU8;
    const first = ram[off];
    // The core's static work_ram lives in the data segment, below any malloc'd state copies,
    // so the first full match from the bottom is the live RAM.
    outer: for (let i = off; i < heap.length - PROBE; i++) {
      if (heap[i] !== first) continue;
      for (let j = 1; j < PROBE; j++) if (heap[i + j] !== ram[off + j]) continue outer;
      this.base = i - off;
      return true;
    }
    return false;
  }

  // 68k word at a 0xFFxxxx address. Words are stored host-endian (byte-swapped).
  read16(address) {
    if (this.base < 0) return 0;
    const heap = this.module.HEAPU8; // re-read: the heap can be replaced when memory grows
    const i = this.base + (address & 0xfffe);
    return heap[i] | (heap[i + 1] << 8);
  }
}
