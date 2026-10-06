import { resolveControls, KEYBOARD } from "./schemes.js";
import { InputManager } from "./input.js";
import { TouchControls } from "./touch.js";
import { Emulator } from "./emulator.js";
import { MegaDriveRam } from "./ram.js";
import { MacroPlayer } from "./macros.js";
import { Signal, HostLink, GuestLink } from "./net.js";

const $ = (sel) => document.querySelector(sel);
const SPECIAL_KEYS = ["Digit1", "Digit2", "Digit3", "Digit4"];
const ERRORS = {
  "room-not-found": "Комната не найдена. Проверьте код или попросите друга создать новую.",
  "room-full": "В этой комнате уже двое игроков.",
  "own-room": "Это ваша же комната.",
  "unknown-game": "Игра недоступна на сервере.",
};

// ---------- settings (per device) ----------
const settings = loadSettings();
function loadSettings() {
  const defaults = { size: 1, opacity: 0.55, touch: "auto", filter: "2xScaleHQ.glslp", fighter: {} };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem("ra.settings") || "{}") };
  } catch {
    return defaults;
  }
}
function saveSettings() {
  try {
    localStorage.setItem("ra.settings", JSON.stringify(settings));
  } catch {}
}

// ---------- screens ----------
function show(id) {
  for (const el of document.querySelectorAll(".screen")) el.hidden = el.id !== id;
}

let config;
async function main() {
  config = await (await fetch("/api/config")).json();
  const inviteCode = (location.pathname.match(/^\/r\/([A-Za-z0-9]{4})$/) || [])[1];
  if (inviteCode) {
    show("invite");
    $("#invite-code").textContent = inviteCode.toUpperCase();
    $("#invite-join").onclick = () => startGuest(inviteCode.toUpperCase());
    return;
  }
  renderHome();
}

function renderHome() {
  show("home");
  $("#games").innerHTML = config.games
    .map(
      (g) => `
      <article class="game ${g.available ? "" : "disabled"}" data-id="${g.id}">
        <div class="game-title"><h2>${g.title}</h2><p>${g.subtitle || ""}</p></div>
        ${
          g.available
            ? `<div class="game-actions">
                <button class="btn primary" data-act="host">Создать бой онлайн</button>
                <button class="btn" data-act="solo">Играть одному</button>
                ${g.players > 1 ? `<button class="btn" data-act="duo">Вдвоём за одним ПК</button>` : ""}
              </div>`
            : `<p class="muted">ROM не загружен на сервер</p>`
        }
      </article>`
    )
    .join("");
  $("#games").onclick = (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const game = config.games.find((g) => g.id === btn.closest(".game").dataset.id);
    if (btn.dataset.act === "host") startHost(game);
    else startLocal(game, btn.dataset.act);
  };
  $("#join-form").onsubmit = (e) => {
    e.preventDefault();
    const code = $("#join-code").value.trim().toUpperCase();
    if (code.length === 4) startGuest(code);
  };
}

// ---------- play screen helpers ----------
function setStatus(state, text) {
  const el = $("#status");
  el.dataset.state = state;
  el.querySelector("span").textContent = text;
}

function stageMessage(text, onClick) {
  const el = $("#stage-msg");
  el.hidden = !text;
  el.textContent = text || "";
  el.onclick = onClick || null;
  el.classList.toggle("clickable", !!onClick);
}

function touchVisible() {
  if (settings.touch === "on") return true;
  if (settings.touch === "off") return false;
  return matchMedia("(pointer: coarse)").matches;
}

// Builds the play screen shared by every mode. Returns helpers for the session.
function setupPlay(game, { keyboard, onSpecial, onFilter }) {
  show("play");
  document.body.classList.add("playing");
  const controls = resolveControls(game);
  const specialsFor = () => {
    const list = (game.specials && game.specials[settings.fighter[game.id]]) || [];
    return list.map(([name, seq]) => ({ name, seq }));
  };

  const touch = new TouchControls($("#touch"), controls, {
    onMask: (m) => input.set(0, "touch", m),
    onSpecial: (s) => onSpecial(s.seq),
  });
  const input = new InputManager(controls, () => {});

  const applyLayout = () => {
    $("#touch").hidden = !touchVisible();
    document.body.classList.toggle("with-touch", touchVisible());
    touch.setStyle(settings);
    touch.setSpecials(specialsFor());
  };
  applyLayout();

  // Number keys fire special moves on the keyboard (not in two-players-one-keyboard mode).
  if (game.specials && !keyboard.some((k) => k.layout === "p1")) {
    window.addEventListener("keydown", (e) => {
      const i = SPECIAL_KEYS.indexOf(e.code);
      if (i < 0 || e.repeat) return;
      const s = specialsFor()[i];
      if (s) onSpecial(s.seq);
    });
  }

  $("#filter-field").hidden = !onFilter;
  let filter = settings.filter;
  setupSettings(game, keyboard, () => {
    applyLayout();
    if (onFilter && settings.filter !== filter) onFilter((filter = settings.filter));
  });
  $("#btn-exit").onclick = () => (location.href = "/");
  $("#btn-fullscreen").onclick = toggleFullscreen;
  return { controls, input };
}

function setupSettings(game, keyboard, onChange) {
  const dlg = $("#settings");
  const fighters = Object.keys(game.specials || {}).sort();
  $("#fighter-field").hidden = !fighters.length;
  $("#set-fighter").innerHTML =
    `<option value="">— не выбран —</option>` + fighters.map((f) => `<option>${f}</option>`).join("");
  $("#set-fighter").value = settings.fighter[game.id] || "";
  $("#set-touch").value = settings.touch;
  $("#set-filter").value = settings.filter;
  $("#set-size").value = settings.size;
  $("#set-opacity").value = settings.opacity;
  const keys = keyboard.map((k) => `<p>${KEYBOARD[k.layout].help}</p>`).join("");
  const specials = fighters.length && !keyboard.some((k) => k.layout === "p1") ? "<p>Спецприёмы: клавиши 1–4</p>" : "";
  $("#help").innerHTML = `${game.hint ? `<p>${game.hint}</p>` : ""}${keys}${specials}<p>Геймпады подключаются автоматически.</p>`;

  const sync = () => {
    settings.fighter[game.id] = $("#set-fighter").value;
    settings.touch = $("#set-touch").value;
    settings.filter = $("#set-filter").value;
    settings.size = Number($("#set-size").value);
    settings.opacity = Number($("#set-opacity").value);
    $("#out-size").textContent = `${Math.round(settings.size * 100)}%`;
    $("#out-opacity").textContent = `${Math.round(settings.opacity * 100)}%`;
    saveSettings();
    onChange();
  };
  dlg.oninput = sync;
  dlg.onchange = sync;
  sync();
  $("#btn-settings").onclick = () => dlg.showModal();
}

function toggleFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  } else {
    (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el, { navigationUI: "hide" });
  }
}

// ---------- emulator-running modes (local + host) ----------
async function runEmulator(game, { keyboard, gamepads, remote }) {
  let session;
  const play = setupPlay(game, {
    keyboard,
    onSpecial: (seq) => session && session.macros.play(0, seq),
    onFilter: (f) => session && session.emu.setFilter(f),
  });
  play.input.useKeyboard(keyboard);
  play.input.useGamepads(gamepads);

  setStatus("connecting", "Загрузка игры…");
  const emu = new Emulator();
  try {
    await emu.start({ container: $("#stage"), game, dataPath: config.ejsDataPath, filter: settings.filter });
  } catch (e) {
    setStatus("error", e.message);
    return null;
  }

  const ram = game.facing ? new MegaDriveRam(emu.ejs) : null;
  const facingAddrs = game.facing ? game.facing.x.map((a) => parseInt(a, 16)) : [];
  const facingRight = (player) => {
    if (ram && ram.locate()) {
      const [x1, x2] = facingAddrs.map((a) => ram.read16(a));
      if (x1 !== x2 && x1 < 4096 && x2 < 4096) return player === 0 ? x1 < x2 : x2 < x1;
    }
    return player === 0; // before a fight starts: P1 on the left, P2 on the right
  };
  const macros = new MacroPlayer({
    buttonIds: play.controls.ids,
    frame: () => emu.ejs.gameManager.getFrameNum(),
    facing: facingRight,
  });
  session = { emu, macros, remoteMask: 0 };
  window.arena = session; // handy for debugging from the console

  // Every animation frame: macro (if running) overrides the player's live input.
  const tick = () => {
    for (const player of [0, 1]) {
      const live = player === 1 && remote ? session.remoteMask : play.input.masks[player];
      const macro = macros.mask(player);
      emu.setMask(player, macro ?? live);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  setStatus("ok", remote ? "Ждём соперника" : "Игра идёт");
  return session;
}

async function startLocal(game, mode) {
  const duo = mode === "duo";
  await runEmulator(game, {
    keyboard: duo ? [{ player: 0, layout: "p1" }, { player: 1, layout: "p2" }] : [{ player: 0, layout: "solo" }],
    gamepads: duo ? [0, 1] : [0, 0, 0, 0],
    remote: false,
  });
}

async function startHost(game) {
  const signal = new Signal();
  const sessionReady = runEmulator(game, {
    keyboard: [{ player: 0, layout: "solo" }],
    gamepads: [0, 0, 0, 0],
    remote: true,
  });
  signal.send({ type: "create", game: game.id });
  signal.on("error", (m) => setStatus("error", ERRORS[m.error] || m.error));
  signal.on("close", () => setStatus("error", "Нет связи с сервером"));
  signal.on("created", async (m) => {
    $("#room").hidden = false;
    $("#room-code").textContent = m.code;
    const link = `${location.origin}/r/${m.code}`;
    $("#btn-share").onclick = () => share(link, m.code, game.title);
    const session = await sessionReady;
    if (!session) return;
    setStatus("waiting", "Ждём соперника — отправьте ему ссылку");
    new HostLink({
      signal,
      iceServers: config.iceServers,
      getVideoTrack: () => session.emu.captureStream(60).getVideoTracks()[0],
      onAudioStream: (fn) => session.emu.onAudioStream(fn),
      onInput: (mask) => (session.remoteMask = mask),
      onMacro: (seq) => {
        if (typeof seq === "string" && seq.length < 64) {
          try {
            session.macros.play(1, seq);
          } catch {}
        }
      },
      onStatus: setStatus,
    });
  });
}

async function share(link, code, title) {
  const text = `Давай сыграем в ${title}! Комната ${code}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: "Retro Arena", text, url: link });
      return;
    } catch {}
  }
  try {
    await navigator.clipboard.writeText(link);
    $("#btn-share").textContent = "Ссылка скопирована";
  } catch {
    prompt("Ссылка на комнату:", link);
  }
}

// ---------- guest ----------
function startGuest(code) {
  history.replaceState(null, "", `/r/${code}`);
  const video = $("#remote-video");
  video.hidden = false;
  video.play().catch(() => {}); // unlock playback inside the user's tap (iOS)

  const signal = new Signal();
  let link;
  let game;
  signal.send({ type: "join", code });
  signal.on("error", (m) => {
    show("play");
    setStatus("error", ERRORS[m.error] || m.error);
    stageMessage(ERRORS[m.error] || m.error, () => (location.href = "/"));
  });
  signal.on("close", () => setStatus("error", "Нет связи с сервером"));
  signal.on("host-left", () => {
    setStatus("error", "Хозяин комнаты вышел");
    stageMessage("Бой окончен — хозяин комнаты вышел. Нажмите, чтобы вернуться.", () => (location.href = "/"));
  });
  signal.on("joined", (m) => {
    game = config.games.find((g) => g.id === m.game);
    if (!game) return setStatus("error", "Неизвестная игра");
    const play = setupPlay(game, { keyboard: [{ player: 0, layout: "solo" }], onSpecial: (seq) => link.sendMacro(seq) });
    play.input.onChange = (_p, mask) => link.setMask(mask);
    play.input.useKeyboard([{ player: 0, layout: "solo" }]);
    play.input.useGamepads([0, 0, 0, 0]);
    $("#room").hidden = false;
    $("#room-code").textContent = code;
    $("#btn-share").hidden = true;
    setStatus("connecting", "Соединяемся с соперником…");
    stageMessage("Соединяемся…");
    link = new GuestLink({
      signal,
      iceServers: config.iceServers,
      video,
      onStatus: (state, text) => {
        if (state === "tap-for-sound") {
          stageMessage("Нажмите, чтобы включить звук", () => {
            video.muted = false;
            video.play();
            stageMessage(null);
          });
          return;
        }
        setStatus(state, text);
        if (state === "connected" && $("#stage-msg").textContent === "Соединяемся…") stageMessage(null);
        if (state === "error") stageMessage(text);
      },
    });
  });
}

main().catch((e) => {
  console.error(e);
  document.body.textContent = "Ошибка загрузки: " + e.message;
});
