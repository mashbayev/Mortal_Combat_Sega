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

// Keyboard layouts by KeyboardEvent.code. `rows` keys follow the on-screen rows bottom-up:
// rows[0] is the bottom row of buttons, rows[1] the row above it.
export const KEYBOARD = {
  solo: {
    dirs: {
      ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right",
      KeyW: "up", KeyS: "down", KeyA: "left", KeyD: "right",
    },
    rows: [[["KeyJ"], ["KeyK"], ["KeyL"]], [["KeyU"], ["KeyI"], ["KeyO"]]],
    start: ["Enter", "Space"],
    select: ["ShiftRight", "Backspace"],
    help: "Движение: стрелки / WASD · верхний ряд: U I O · нижний ряд: J K L · Start: Enter",
  },
  p1: {
    dirs: { KeyW: "up", KeyS: "down", KeyA: "left", KeyD: "right" },
    rows: [[["KeyF"], ["KeyG"], ["KeyH"]], [["KeyR"], ["KeyT"], ["KeyY"]]],
    start: ["Digit1"],
    select: ["Digit2"],
    help: "Игрок 1: WASD · верх R T Y · низ F G H · Start: 1",
  },
  p2: {
    dirs: { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" },
    rows: [
      [["Numpad1", "Comma"], ["Numpad2", "Period"], ["Numpad3", "Slash"]],
      [["Numpad4", "KeyK"], ["Numpad5", "KeyL"], ["Numpad6", "Semicolon"]],
    ],
    start: ["Enter", "NumpadEnter"],
    select: ["ShiftRight", "NumpadAdd"],
    help: "Игрок 2: стрелки · верх Numpad 4 5 6 (K L ;) · низ Numpad 1 2 3 (, . /) · Start: Enter",
  },
};

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
