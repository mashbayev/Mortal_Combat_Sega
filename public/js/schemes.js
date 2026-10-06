// Control schemes per console. Bits of an input mask are libretro RetroPad ids,
// so a mask can be fed straight into EmulatorJS simulateInput(player, id, 1/0).
export const PAD = { B: 0, Y: 1, SELECT: 2, START: 3, UP: 4, DOWN: 5, LEFT: 6, RIGHT: 7, A: 8, X: 9, L: 10, R: 11 };
export const DIRS = { up: PAD.UP, down: PAD.DOWN, left: PAD.LEFT, right: PAD.RIGHT };

// `buttons`: console button name -> RetroPad id.
// `rows`: default on-screen layout, top row first (a game can override it with its own labels).
// `gamepad`: console button name -> standard Gamepad API button index.
export const SCHEMES = {
  // Genesis Plus GX maps RetroPad Y/B/A/L/X/R to Mega Drive A/B/C/X/Y/Z.
  genesis6: {
    buttons: { A: PAD.Y, B: PAD.B, C: PAD.A, X: PAD.L, Y: PAD.X, Z: PAD.R },
    rows: [["X", "Y", "Z"], ["A", "B", "C"]],
    gamepad: { A: 0, B: 1, C: 5, X: 2, Y: 3, Z: 4 },
    start: PAD.START,
    select: { name: "Mode", id: PAD.SELECT },
  },
  genesis3: {
    buttons: { A: PAD.Y, B: PAD.B, C: PAD.A },
    rows: [["A", "B", "C"]],
    gamepad: { A: 2, B: 0, C: 1 },
    start: PAD.START,
    select: null,
  },
  // NES / Dendy (FCEUmm): RetroPad B and A are the console's B and A.
  nes: {
    buttons: { B: PAD.B, A: PAD.A },
    rows: [["B", "A"]],
    gamepad: { B: 0, A: 1 },
    start: PAD.START,
    select: { name: "Select", id: PAD.SELECT },
  },
};

// Default keyboard bindings by KeyboardEvent.code, keyed by action:
// up/down/left/right, start, select, sp0..sp3 (special moves, main player only) and
// b{row}_{col} for action buttons, where row 0 is the BOTTOM on-screen row.
// "main" is the main player (solo, online, player 1 at a shared keyboard), "p2" the second.
export const DEFAULT_KEYS = {
  main: {
    up: ["KeyW"], down: ["KeyS"], left: ["KeyA"], right: ["KeyD"],
    // UMK3: bottom row LP RUN LK = R E T, top row HP BLK HK = Y Q U.
    b0_0: ["KeyR"], b0_1: ["KeyE"], b0_2: ["KeyT"],
    b1_0: ["KeyY"], b1_1: ["KeyQ"], b1_2: ["KeyU"],
    start: ["Enter"], select: ["Backspace"],
    sp0: ["KeyF"], sp1: ["KeyG"], sp2: ["KeyH"], sp3: ["KeyJ"],
  },
  p2: {
    up: ["ArrowUp"], down: ["ArrowDown"], left: ["ArrowLeft"], right: ["ArrowRight"],
    b0_0: ["Numpad1", "Comma"], b0_1: ["Numpad2", "Period"], b0_2: ["Numpad3", "Slash"],
    b1_0: ["Numpad4", "KeyK"], b1_1: ["Numpad5", "KeyL"], b1_2: ["Numpad6", "Semicolon"],
    start: ["NumpadEnter", "ShiftRight"], select: ["NumpadAdd"],
  },
};
export const SPECIAL_ACTIONS = ["sp0", "sp1", "sp2", "sp3"];
export const buttonAction = (rowFromBottom, col) => `b${rowFromBottom}_${col}`;

// Defaults overridden by the player's saved bindings (custom: { layout: { action: [codes] } }).
export function keymapFor(layout, custom = {}) {
  return { ...DEFAULT_KEYS[layout], ...(custom[layout] || {}) };
}

// Resolves a game's control layout: rows of { label, button, id } (top row first)
// plus a label -> RetroPad id map used by special-move macros.
export function resolveControls(game) {
  const scheme = SCHEMES[game.controls];
  if (!scheme) throw new Error(`Unknown control scheme: ${game.controls}`);
  const rows = (game.layout || scheme.rows.map((r) => r.map((b) => ({ label: b, button: b })))).map((row) =>
    row.map((cell) => {
      const id = scheme.buttons[cell.button];
      if (id === undefined) throw new Error(`Unknown button ${cell.button} for ${game.controls}`);
      return { ...cell, id };
    })
  );
  const ids = {};
  for (const row of rows) for (const cell of row) ids[cell.label] = cell.id;
  return { scheme, rows, ids };
}
