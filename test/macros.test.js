const test = require("node:test");
const assert = require("node:assert");

test("macro sequences resolve forward/back from facing and play frame by frame", async () => {
  const { MacroPlayer, parseSequence } = await import("../public/js/macros.js");
  const { PAD } = await import("../public/js/schemes.js");
  const ids = { LP: PAD.Y, BLK: PAD.B };
  assert.throws(() => parseSequence("D,F,XX", ids));

  let frame = 0;
  const player = new MacroPlayer({ buttonIds: ids, frame: () => frame, facing: () => false });
  player.play(0, "D,F,LP");
  const seen = [];
  for (; frame < 20; frame++) seen.push(player.mask(0));
  // facing left: F = LEFT
  assert.strictEqual(seen[0], 1 << PAD.DOWN);
  assert.strictEqual(seen[3], 0); // gap between steps
  assert.strictEqual(seen[5], 1 << PAD.LEFT);
  assert.strictEqual(seen[10], 1 << PAD.Y);
  assert.strictEqual(seen[15], null); // finished
});
