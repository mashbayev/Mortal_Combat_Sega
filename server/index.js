const path = require("path");
const fs = require("fs");
const http = require("http");
const express = require("express");
const { WebSocketServer } = require("ws");
const { Rooms } = require("./rooms");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.PORT) || 8080;
const ROMS_DIR = path.resolve(process.env.ROMS_DIR || path.join(ROOT, "roms"));
const GAMES_FILE = path.resolve(process.env.GAMES_FILE || path.join(ROOT, "games.json"));
// Where the browser downloads EmulatorJS from (loader.js, cores). Point at a self-hosted copy if needed.
const EJS_DATA_PATH = process.env.EJS_DATA_PATH || "https://cdn.emulatorjs.org/stable/data/";

function loadGames() {
  const games = JSON.parse(fs.readFileSync(GAMES_FILE, "utf8"));
  return games.map((g) => ({ ...g, available: fs.existsSync(path.join(ROMS_DIR, g.rom)) }));
}

function iceServers() {
  const servers = [{ urls: (process.env.STUN_URLS || "stun:stun.l.google.com:19302").split(",") }];
  if (process.env.TURN_URLS) {
    servers.push({
      urls: process.env.TURN_URLS.split(","),
      username: process.env.TURN_USERNAME || "",
      credential: process.env.TURN_PASSWORD || "",
    });
  }
  return servers;
}

const app = express();
app.disable("x-powered-by");

// Page loads and ROM downloads, so reloads (e.g. a phone killing the tab) show up in the log.
app.use((req, _res, next) => {
  if (req.path === "/" || req.path.startsWith("/r/") || req.path.startsWith("/roms/")) {
    const ua = String(req.headers["user-agent"] || "").replace(/^Mozilla\/5\.0 /, "").slice(0, 70);
    console.log(new Date().toISOString().slice(11, 19), req.headers["x-forwarded-for"] || req.socket.remoteAddress, "GET", req.path, ua);
  }
  next();
});

app.get("/api/config", (_req, res) => {
  res.json({ iceServers: iceServers(), ejsDataPath: EJS_DATA_PATH, games: loadGames() });
});

app.get("/api/health", (_req, res) => res.json({ ok: true, rooms: rooms.size }));

// ROMs are never committed; they live in ROMS_DIR on the server.
app.use("/roms", express.static(ROMS_DIR, { fallthrough: false, maxAge: "7d" }));
// no-cache = always revalidate (cheap 304s), so phones pick up new versions immediately.
app.use(express.static(path.join(ROOT, "public"), { extensions: ["html"], setHeaders: (res) => res.set("Cache-Control", "no-cache") }));
// Room links like /r/ABCD open the SPA, which reads the code from the URL.
app.get("/r/:code", (_req, res) => res.set("Cache-Control", "no-cache").sendFile(path.join(ROOT, "public", "index.html")));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 64 * 1024 });
const rooms = new Rooms({ gameExists: (id) => loadGames().some((g) => g.id === id) });
const log = (...args) => console.log(new Date().toISOString().slice(11, 19), ...args);

wss.on("connection", (ws, req) => {
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  const client = {
    room: null,
    role: null,
    send(obj) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
    },
  };
  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));
  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return client.send({ type: "error", error: "bad-json" });
    }
    if (["create", "join", "leave"].includes(msg.type)) log(ip, msg.type, msg.code || msg.game || "");
    rooms.handle(client, msg);
    if (msg.type === "create" || msg.type === "join") log(ip, "->", client.role || "rejected", client.room || "");
  });
  ws.on("close", () => {
    if (client.room) log(ip, "disconnected from", client.room, `(${client.role})`);
    rooms.leave(client);
  });
});

// Drop dead connections (phones that lost network) so rooms get freed.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);
wss.on("close", () => clearInterval(heartbeat));

server.listen(PORT, () => {
  console.log(`Retro Arena on http://localhost:${PORT}  (roms: ${ROMS_DIR})`);
});
