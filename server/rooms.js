// In-memory rooms: one host (runs the emulator, player 1) and one guest (player 2).
// The server only relays signaling messages; game traffic goes peer-to-peer over WebRTC.

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const CODE_LENGTH = 4;

function makeCode(exists) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    let code = "";
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    if (!exists(code)) return code;
  }
  throw new Error("No free room codes");
}

class Rooms {
  constructor({ gameExists = () => true } = {}) {
    this.rooms = new Map();
    this.gameExists = gameExists;
  }

  // Each client is an object with send(obj) and a mutable `room` / `role`.
  handle(client, msg) {
    switch (msg && msg.type) {
      case "create":
        return this.create(client, msg.game);
      case "join":
        return this.join(client, String(msg.code || "").toUpperCase());
      case "signal":
      case "input":
        return this.relay(client, msg);
      case "leave":
        return this.leave(client);
      case "ping":
        return client.send({ type: "pong", t: msg.t });
      default:
        return client.send({ type: "error", error: "unknown-message" });
    }
  }

  create(client, game) {
    if (!this.gameExists(game)) return client.send({ type: "error", error: "unknown-game" });
    this.leave(client);
    const code = makeCode((c) => this.rooms.has(c));
    this.rooms.set(code, { code, game, host: client, guest: null, createdAt: Date.now() });
    client.room = code;
    client.role = "host";
    client.send({ type: "created", code, game });
  }

  join(client, code) {
    const room = this.rooms.get(code);
    if (!room) return client.send({ type: "error", error: "room-not-found" });
    if (room.guest && room.guest !== client) return client.send({ type: "error", error: "room-full" });
    if (room.host === client) return client.send({ type: "error", error: "own-room" });
    this.leave(client);
    room.guest = client;
    client.room = code;
    client.role = "guest";
    client.send({ type: "joined", code, game: room.game });
    room.host.send({ type: "peer-joined" });
  }

  relay(client, msg) {
    const room = this.rooms.get(client.room);
    if (!room) return;
    const other = client.role === "host" ? room.guest : room.host;
    if (other) other.send({ type: msg.type, data: msg.data });
  }

  leave(client) {
    const room = this.rooms.get(client.room);
    client.room = null;
    if (!room) return;
    if (room.host === client) {
      this.rooms.delete(room.code);
      if (room.guest) {
        room.guest.room = null;
        room.guest.send({ type: "host-left" });
      }
    } else if (room.guest === client) {
      room.guest = null;
      room.host.send({ type: "peer-left" });
    }
  }

  get size() {
    return this.rooms.size;
  }
}

module.exports = { Rooms, makeCode, CODE_ALPHABET };
