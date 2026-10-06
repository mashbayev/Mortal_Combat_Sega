import { resolveControls, keymapFor, SPECIAL_ACTIONS } from "./schemes.js";
import { InputManager } from "./input.js";
import { TouchControls } from "./touch.js";
import { Emulator } from "./emulator.js";
import { MegaDriveRam } from "./ram.js";
import { MacroPlayer } from "./macros.js";
import { Signal, HostLink, GuestLink } from "./net.js";
import { showBriefing } from "./briefing.js";
import { loadAutosave, startAutosave } from "./autosave.js";

const $ = (sel) => document.querySelector(sel);
const ERRORS = {
  "room-not-found": "Комната не найдена. Проверьте код или попросите друга создать новую.",
  "room-full": "В этой комнате уже двое игроков.",
  "own-room": "Это ваша же комната.",
  "unknown-game": "Игра недоступна на сервере.",
};

// ---------- settings (per device) ----------
const settings = loadSettings();
function loadSettings() {
  const defaults = { size: 1, opacity: 0.55, touch: "auto", filter: "2xScaleHQ.glslp", fighter: {}, skipBriefing: {}, keys: {} };
  try {
    const saved = { ...defaults, ...JSON.parse(localStorage.getItem("ra.settings") || "{}") };
    // Key bindings used to be global; they belonged to UMK3, the only game back then.
    if (saved.keys.main || saved.keys.p2) saved.keys = { umk3: saved.keys };
    return saved;
  } catch {
    return defaults;
  }
}
function saveSettings() {
  try {
    localStorage.setItem("ra.settings", JSON.stringify(settings));
  } catch {}
}

// Keyboard layouts per mode.
const KEYBOARDS = {
  solo: [{ player: 0, layout: "main" }],
  duo: [{ player: 0, layout: "main" }, { player: 1, layout: "p2" }],
};
const keymaps = (game, keyboard) =>
  Object.fromEntries(keyboard.map((k) => [k.layout, keymapFor(game, k.layout, settings.keys)]));

// Controls reference shown before a game (unless skipped) and from the top bar.
function briefing(game, keyboard, inGame = false) {
  const goFullscreen = () => {
    if (matchMedia("(pointer: coarse)").matches) enterFullscreen();
  };
  if (!inGame && settings.skipBriefing[game.id]) return Promise.resolve().then(goFullscreen);
  return showBriefing({ game, keyboard, settings, save: saveSettings, inGame }).then(goFullscreen);
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
  const saves = {};
  // "Продолжить" for games with a recent autosave (page reloaded, back swipe, closed tab).
  for (const g of config.games.filter((g) => g.available)) {
    loadAutosave(g.id).then((save) => {
      if (!save) return;
      saves[g.id] = save;
      const mins = Math.max(1, Math.round((Date.now() - save.time) / 60000));
      const ago = mins < 60 ? `${mins} мин назад` : `${Math.round(mins / 60)} ч назад`;
      document
        .querySelector(`.game[data-id="${g.id}"] .game-actions`)
        .insertAdjacentHTML("afterbegin", `<button class="btn resume" data-act="resume">▶ Продолжить <small>${ago}</small></button>`);
    });
  }
  $("#games").onclick = (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const game = config.games.find((g) => g.id === btn.closest(".game").dataset.id);
    let mode = btn.dataset.act;
    let resumeState = null;
    if (mode === "resume") {
      resumeState = saves[game.id].state;
      mode = saves[game.id].mode;
    }
    briefing(game, mode === "duo" ? KEYBOARDS.duo : KEYBOARDS.solo).then(() =>
      mode === "host" ? startHost(game, resumeState) : startLocal(game, mode, resumeState)
    );
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
  const bindKeys = () => input.useKeyboard(keyboard, keymaps(game, keyboard));
  bindKeys();

  const applyLayout = () => {
    $("#touch").hidden = !touchVisible();
    document.body.classList.toggle("with-touch", touchVisible());
    touch.setStyle(settings);
    touch.setSpecials(specialsFor());
  };
  applyLayout();

  // F G H J fire the main player's special moves.
  if (game.specials) {
    window.addEventListener("keydown", (e) => {
      if (e.repeat || document.querySelector("dialog[open]")) return;
      const main = keymapFor(game, "main", settings.keys);
      const i = SPECIAL_ACTIONS.findIndex((a) => (main[a] || []).includes(e.code));
      if (i < 0) return;
      const s = specialsFor()[i];
      if (s) onSpecial(s.seq);
    });
  }

  $("#filter-field").hidden = !onFilter;
  let filter = settings.filter;
  const syncSettings = setupSettings(game, keyboard, () => {
    applyLayout();
    if (onFilter && settings.filter !== filter) onFilter((filter = settings.filter));
  });
  // The reference can change the fighter, so refresh the specials afterwards.
  // It can also rebind keys, so re-apply them.
  $("#btn-help").onclick = () =>
    briefing(game, keyboard, true).then(() => {
      syncSettings();
      bindKeys();
    });
  guardExit();
  $("#btn-fullscreen").onclick = toggleFullscreen;
  // Desktop: double-click the game to toggle full screen.
  $("#stage").ondblclick = () => {
    if (!matchMedia("(pointer: coarse)").matches) toggleFullscreen();
  };
  return {
    controls,
    input,
    refresh: () => {
      syncSettings();
      bindKeys();
    },
  };
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
  $("#help").innerHTML = `${game.hint ? `<p>${game.hint}</p>` : ""}<p>Все клавиши и их настройка — кнопка «Кнопки» в верхней панели.</p><p>Геймпады подключаются автоматически.</p>`;

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
  // Re-read settings changed elsewhere (the reference dialog) into the form.
  return () => {
    $("#set-fighter").value = settings.fighter[game.id] || "";
    sync();
  };
}

// iPhone Safari has no Fullscreen API for pages; there the only way is a home-screen web app.
const canFullscreen = () => !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
const isStandalone = () => matchMedia("(display-mode: standalone), (display-mode: fullscreen)").matches || navigator.standalone;

function enterFullscreen() {
  const el = document.documentElement;
  const request = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!request || document.fullscreenElement || document.webkitFullscreenElement) return;
  Promise.resolve(request.call(el, { navigationUI: "hide" })).catch(() => {});
}

const inFullscreen = () => !!(document.fullscreenElement || document.webkitFullscreenElement);

function toggleFullscreen() {
  if (inFullscreen()) {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    return;
  }
  if (isStandalone()) return; // home-screen app is already full screen
  if (canFullscreen()) enterFullscreen();
  // iPhone Safari exposes the API but silently ignores it for pages: if nothing happened,
  // explain the home-screen way instead.
  setTimeout(() => {
    if (!inFullscreen()) $("#ios-fullscreen").showModal();
  }, 400);
}

// ---------- emulator-running modes (local + host) ----------
// Leaving a running game needs a confirmation: the ✕ button and the browser's back gesture
// (an easy accidental swipe from the left edge on iPhone, right where the stick is).
function guardExit() {
  const dlg = $("#exit-confirm");
  history.pushState({ playing: true }, "");
  window.addEventListener("popstate", () => {
    history.pushState({ playing: true }, "");
    if (!dlg.open) dlg.showModal();
  });
  $("#btn-exit").onclick = () => dlg.showModal();
  dlg.onclose = () => {
    if (dlg.returnValue === "exit") location.href = "/";
  };
}

async function runEmulator(game, { keyboard, gamepads, remote, mode, resumeState }) {
  let session;
  const play = setupPlay(game, {
    keyboard,
    onSpecial: (seq) => session && session.macros.play(0, seq),
    onFilter: (f) => session && session.emu.setFilter(f),
  });
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
  if (resumeState) {
    try {
      emu.ejs.gameManager.loadState(resumeState);
    } catch (e) {
      console.warn("resume failed", e);
    }
  }
  startAutosave(game.id, mode, emu.ejs.gameManager);
  setStatus("ok", remote ? "Ждём соперника" : "Игра идёт");
  return session;
}

async function startLocal(game, mode, resumeState) {
  const duo = mode === "duo";
  await runEmulator(game, {
    keyboard: duo ? KEYBOARDS.duo : KEYBOARDS.solo,
    gamepads: duo ? [0, 1] : [0, 0, 0, 0],
    remote: false,
    mode,
    resumeState,
  });
}

async function startHost(game, resumeState) {
  const signal = new Signal();
  const sessionReady = runEmulator(game, {
    keyboard: KEYBOARDS.solo,
    gamepads: [0, 0, 0, 0],
    remote: true,
    mode: "host",
    resumeState,
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
    const play = setupPlay(game, { keyboard: KEYBOARDS.solo, onSpecial: (seq) => link.sendMacro(seq) });
    play.input.onChange = (_p, mask) => link.setMask(mask);
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
    // The reference opens on top while the connection is set up; its button is also the
    // tap browsers want before playing sound.
    briefing(game, KEYBOARDS.solo).then(() => {
      play.refresh();
      video.play().catch(() => {});
    });
  });
}

main().catch((e) => {
  console.error(e);
  document.body.textContent = "Ошибка загрузки: " + e.message;
});
