import { PAD } from "./schemes.js";

// One-tap special moves. A sequence like "D,F,LP" or "B+LP+BLK+LK" is a list of steps;
// F/B are relative to where the fighter faces and are resolved when the step is played.
const HOLD_FRAMES = 3;
const GAP_FRAMES = 2;

export function parseSequence(text, buttonIds) {
  return text.split(",").map((step) =>
    step.split("+").map((token) => {
      token = token.trim();
      if (["U", "D", "F", "B"].includes(token)) return { dir: token };
      if (!(token in buttonIds)) throw new Error(`Unknown button "${token}" in "${text}"`);
      return { bit: buttonIds[token] };
    })
  );
}

function stepMask(step, facingRight) {
  let mask = 0;
  for (const t of step) {
    if (t.bit !== undefined) mask |= 1 << t.bit;
    else if (t.dir === "U") mask |= 1 << PAD.UP;
    else if (t.dir === "D") mask |= 1 << PAD.DOWN;
    else if (t.dir === "F") mask |= 1 << (facingRight ? PAD.RIGHT : PAD.LEFT);
    else if (t.dir === "B") mask |= 1 << (facingRight ? PAD.LEFT : PAD.RIGHT);
  }
  return mask;
}

// Plays macros frame-accurately against the emulator's frame counter.
export class MacroPlayer {
  // facing(player) -> true if that player's fighter faces right
  constructor({ buttonIds, frame, facing }) {
    this.buttonIds = buttonIds;
    this.frame = frame;
    this.facing = facing;
    this.active = [null, null];
  }

  play(player, text) {
    const steps = parseSequence(text, this.buttonIds);
    this.active[player] = { steps, start: this.frame(), facingRight: this.facing(player) };
  }

  // Returns the macro's mask for this frame, or null when no macro is running.
  mask(player) {
    const run = this.active[player];
    if (!run) return null;
    const elapsed = this.frame() - run.start;
    const index = Math.floor(elapsed / (HOLD_FRAMES + GAP_FRAMES));
    if (index >= run.steps.length) {
      this.active[player] = null;
      return null;
    }
    const inGap = elapsed % (HOLD_FRAMES + GAP_FRAMES) >= HOLD_FRAMES;
    return inGap ? 0 : stepMask(run.steps[index], run.facingRight);
  }
}
