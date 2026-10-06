import { DIRS, KEYBOARD } from "./schemes.js";

// Collects keyboard, gamepad and touch state into one bitmask per local player.
// Sources set their own partial masks; the player's mask is the OR of all of them.
export class InputManager {
  // controls: result of resolveControls(game)
  constructor(controls, onChange) {
    this.controls = controls;
    this.scheme = controls.scheme;
    this.onChange = onChange; // (player, mask) => void
    this.parts = new Map(); // "player:source" -> mask
    this.masks = [0, 0];
    this.keyBindings = new Map(); // code -> { player, bit }
    this.gamepadPlayers = []; // gamepad slot -> player
    this.pressedKeys = new Set();
    this.onKey = this.onKey.bind(this);
    this.onBlur = this.onBlur.bind(this);
    this.pollGamepads = this.pollGamepads.bind(this);
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKey);
    window.addEventListener("blur", this.onBlur);
    this.raf = requestAnimationFrame(this.pollGamepads);
  }

  destroy() {
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("keyup", this.onKey);
    window.removeEventListener("blur", this.onBlur);
    cancelAnimationFrame(this.raf);
  }

  // layouts: [{ player, layout: "solo" | "p1" | "p2" }]
  useKeyboard(layouts) {
    this.keyBindings.clear();
    for (const { player, layout } of layouts) {
      const kb = KEYBOARD[layout];
      for (const [code, dir] of Object.entries(kb.dirs)) this.keyBindings.set(code, { player, bit: DIRS[dir] });
      // Keyboard rows are bottom-up, on-screen rows are top-down.
      [...this.controls.rows].reverse().forEach((row, r) => {
        row.forEach((cell, c) => {
          for (const code of (kb.rows[r] && kb.rows[r][c]) || []) this.keyBindings.set(code, { player, bit: cell.id });
        });
      });
      for (const code of kb.start) this.keyBindings.set(code, { player, bit: this.scheme.start });
      if (this.scheme.select) for (const code of kb.select) this.keyBindings.set(code, { player, bit: this.scheme.select.id });
    }
  }

  // players[i] is the local player controlled by the i-th connected gamepad.
  useGamepads(players) {
    this.gamepadPlayers = players;
  }

  set(player, source, mask) {
    this.parts.set(`${player}:${source}`, mask);
    let total = 0;
    for (const [key, m] of this.parts) if (key.startsWith(`${player}:`)) total |= m;
    if (total !== this.masks[player]) {
      this.masks[player] = total;
      this.onChange(player, total);
    }
  }

  onKey(e) {
    const binding = this.keyBindings.get(e.code);
    if (!binding) return;
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
    e.preventDefault();
    if (e.type === "keydown") this.pressedKeys.add(e.code);
    else this.pressedKeys.delete(e.code);
    this.syncKeyboard();
  }

  onBlur() {
    this.pressedKeys.clear();
    this.syncKeyboard();
  }

  syncKeyboard() {
    const masks = [0, 0];
    for (const code of this.pressedKeys) {
      const b = this.keyBindings.get(code);
      if (b) masks[b.player] |= 1 << b.bit;
    }
    this.set(0, "kb", masks[0]);
    this.set(1, "kb", masks[1]);
  }

  pollGamepads() {
    this.raf = requestAnimationFrame(this.pollGamepads);
    const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
    const masks = [0, 0];
    pads.forEach((pad, slot) => {
      const player = this.gamepadPlayers[slot];
      if (player === undefined) return;
      masks[player] |= this.readGamepad(pad);
    });
    this.set(0, "pad", masks[0]);
    this.set(1, "pad", masks[1]);
  }

  readGamepad(pad) {
    const down = (i) => pad.buttons[i] && pad.buttons[i].pressed;
    const [ax = 0, ay = 0] = pad.axes;
    let mask = 0;
    if (down(12) || ay < -0.5) mask |= 1 << DIRS.up;
    if (down(13) || ay > 0.5) mask |= 1 << DIRS.down;
    if (down(14) || ax < -0.5) mask |= 1 << DIRS.left;
    if (down(15) || ax > 0.5) mask |= 1 << DIRS.right;
    for (const [name, index] of Object.entries(this.scheme.gamepad)) {
      if (down(index)) mask |= 1 << this.scheme.buttons[name];
    }
    if (down(9)) mask |= 1 << this.scheme.start;
    if (down(8) && this.scheme.select) mask |= 1 << this.scheme.select.id;
    return mask;
  }
}
