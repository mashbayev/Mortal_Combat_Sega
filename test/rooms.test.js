const test = require("node:test");
const assert = require("node:assert");
const { Rooms, makeCode, CODE_ALPHABET } = require("../server/rooms");

function client() {
  return { room: null, role: null, inbox: [], send(m) { this.inbox.push(m); }, last() { return this.inbox[this.inbox.length - 1]; } };
}

test("codes use the unambiguous alphabet and avoid taken codes", () => {
  const code = makeCode((c) => c === "AAAA");
  assert.strictEqual(code.length, 4);
  for (const ch of code) assert.ok(CODE_ALPHABET.includes(ch));
});

test("host creates, guest joins, signals are relayed both ways", () => {
  const rooms = new Rooms();
  const host = client();
  const guest = client();
  rooms.handle(host, { type: "create", game: "umk3" });
  const { code } = host.last();
  assert.strictEqual(host.last().type, "created");

  rooms.handle(guest, { type: "join", code: code.toLowerCase() });
  assert.deepStrictEqual(guest.last(), { type: "joined", code, game: "umk3" });
  assert.deepStrictEqual(host.last(), { type: "peer-joined" });

  rooms.handle(host, { type: "signal", data: { sdp: "offer" } });
  assert.deepStrictEqual(guest.last(), { type: "signal", data: { sdp: "offer" } });
  rooms.handle(guest, { type: "input", data: { s: 1, m: 8 } });
  assert.deepStrictEqual(host.last(), { type: "input", data: { s: 1, m: 8 } });
});

test("a third player is rejected and unknown rooms report an error", () => {
  const rooms = new Rooms();
  const [host, guest, third] = [client(), client(), client()];
  rooms.handle(host, { type: "create", game: "umk3" });
  const { code } = host.last();
  rooms.handle(guest, { type: "join", code });
  rooms.handle(third, { type: "join", code });
  assert.deepStrictEqual(third.last(), { type: "error", error: "room-full" });
  rooms.handle(third, { type: "join", code: "ZZZZ" });
  assert.deepStrictEqual(third.last(), { type: "error", error: "room-not-found" });
});

test("guest leaving frees the slot; host leaving closes the room", () => {
  const rooms = new Rooms();
  const [host, guest, other] = [client(), client(), client()];
  rooms.handle(host, { type: "create", game: "umk3" });
  const { code } = host.last();
  rooms.handle(guest, { type: "join", code });
  rooms.leave(guest);
  assert.deepStrictEqual(host.last(), { type: "peer-left" });
  rooms.handle(other, { type: "join", code });
  assert.strictEqual(other.last().type, "joined");
  rooms.leave(host);
  assert.deepStrictEqual(other.last(), { type: "host-left" });
  assert.strictEqual(rooms.size, 0);
});

test("unknown games can't be hosted", () => {
  const rooms = new Rooms({ gameExists: (id) => id === "umk3" });
  const host = client();
  rooms.handle(host, { type: "create", game: "nope" });
  assert.deepStrictEqual(host.last(), { type: "error", error: "unknown-game" });
});
