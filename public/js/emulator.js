// Thin wrapper around EmulatorJS: boots a game into a container, takes input as bitmasks,
// and exposes the video/audio as a MediaStream for streaming to the remote player.

let audioTap = null;

// EmulatorJS creates its own AudioContext deep inside the wasm glue. To stream game sound
// we mirror every node that connects to the speakers into a MediaStreamDestination.
function installAudioTap() {
  if (audioTap) return audioTap;
  audioTap = { destination: null, listeners: [] };
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (target, ...rest) {
    const result = connect.call(this, target, ...rest);
    if (target instanceof AudioDestinationNode) {
      if (!audioTap.destination || audioTap.destination.context !== this.context) {
        audioTap.destination = this.context.createMediaStreamDestination();
        audioTap.listeners.forEach((fn) => fn(audioTap.destination.stream));
      }
      connect.call(this, audioTap.destination);
    }
    return result;
  };
  return audioTap;
}

const EMPTY_CONTROLS = { 0: {}, 1: {}, 2: {}, 3: {} };

export class Emulator {
  constructor() {
    this.masks = [0, 0];
    this.ejs = null;
  }

  // Resolves once the game is running.
  start({ container, game, dataPath, filter }) {
    installAudioTap();
    return new Promise((resolve, reject) => {
      const target = document.createElement("div");
      target.id = "ejs-target";
      container.appendChild(target);

      Object.assign(window, {
        EJS_player: "#ejs-target",
        EJS_core: game.core,
        EJS_gameUrl: `/roms/${encodeURIComponent(game.rom)}`,
        EJS_gameName: game.title,
        EJS_pathtodata: dataPath,
        EJS_startOnLoaded: true,
        EJS_disableLocalStorage: true,
        EJS_disableDatabases: true,
        EJS_defaultControls: EMPTY_CONTROLS, // all input goes through simulateInput
        EJS_color: "#c8102e",
        EJS_backgroundColor: "#000",
        EJS_language: "en-US",
        EJS_Buttons: {
          playPause: false, restart: false, mute: false, settings: false, fullscreen: false,
          saveState: false, loadState: false, screenRecord: false, gamepad: false, cheat: false,
          volume: false, saveSavFiles: false, loadSavFiles: false, quickSave: false, quickLoad: false,
          screenshot: false, cacheManager: false, exitEmulation: false, netplay: false, diskButton: false,
          contextMenu: false,
        },
        EJS_defaultOptions: { "virtual-gamepad": "disabled", shader: filter || "disabled" },
        EJS_onGameStart: () => {
          this.ejs = window.EJS_emulator;
          resolve();
        },
      });

      const script = document.createElement("script");
      script.src = `${dataPath}loader.js`;
      script.onerror = () => reject(new Error("Не удалось загрузить эмулятор"));
      document.body.appendChild(script);
    });
  }

  get canvas() {
    return this.ejs && this.ejs.canvas;
  }

  // Applies a full input mask for a player, pressing/releasing only the changed bits.
  setMask(player, mask) {
    const prev = this.masks[player];
    this.masks[player] = mask;
    if (!this.ejs) return;
    const changed = prev ^ mask;
    for (let bit = 0; changed >> bit; bit++) {
      if (changed & (1 << bit)) this.ejs.gameManager.simulateInput(player, bit, (mask >> bit) & 1);
    }
  }

  // Video + game audio for the remote player.
  captureStream(fps = 60) {
    return this.canvas.captureStream(fps);
  }

  onAudioStream(fn) {
    const tap = installAudioTap();
    if (tap.destination) fn(tap.destination.stream);
    tap.listeners.push(fn);
  }

  setPaused(paused) {
    if (!this.ejs) return;
    this.ejs.gameManager.toggleMainLoop(paused ? 0 : 1);
  }

  // EmulatorJS shader name, or "disabled" for sharp pixels.
  setFilter(shader) {
    if (this.ejs) this.ejs.changeSettingOption("shader", shader || "disabled");
  }

  setVolume(volume) {
    if (this.ejs) this.ejs.setVolume(volume);
  }
}
