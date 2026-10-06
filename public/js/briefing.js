import { SPECIAL_ACTIONS, buttonAction, keymapFor, resolveControls } from "./schemes.js";

// "Before the fight" reference: what every button does on keyboard, gamepad and touch,
// basic moves and the chosen fighter's specials. Also reopened from the settings.

const ARROWS = { F: "→", B: "←", U: "↑", D: "↓" };
const GAMEPAD_NAMES = { 0: "A", 1: "B", 2: "X", 3: "Y", 4: "LB", 5: "RB", 6: "LT", 7: "RT", 8: "Back", 9: "Start" };

function keyName(code) {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `Num ${code.slice(6).replace("Add", "+")}`;
  const names = {
    ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Enter: "Enter", Space: "Пробел",
    ShiftRight: "Shift (пр.)", Backspace: "Backspace", Comma: ",", Period: ".", Slash: "/", Semicolon: ";",
  };
  return names[code] || code;
}

const kbd = (codes) =>
  codes.length ? codes.map((c) => `<kbd>${keyName(c)}</kbd>`).join(" ") : `<span class="unbound">нет клавиши</span>`;
// A key cell the player can click to rebind.
const bindCell = (layout, action, codes) =>
  `<button type="button" class="keybind" data-layout="${layout}" data-action="${action}" title="Нажмите, чтобы назначить другую клавишу">${kbd(codes || [])}</button>`;
const chip = (label) => `<span class="chip chip-${label}">${label}</span>`;

// "D,F,LP" -> ↓ → LP ; "B+LK" -> ← + LK ; button labels inside free text become chips.
// A game's own button labels win over direction letters (on NES "B" is a button, not "back").
export function formatMove(text, labels) {
  const inText = labels.length ? new RegExp(`\\b(${labels.join("|")})\\b`, "g") : null;
  return text
    .split(/([,+])/)
    .map((part) => {
      const t = part.trim();
      if (t === ",") return " ";
      if (t === "+") return " + ";
      if (labels.includes(t)) return chip(t);
      if (ARROWS[t]) return `<b class="arrow">${ARROWS[t]}</b>`;
      return inText ? t.replace(inText, (m) => chip(m)) : t;
    })
    .join("");
}

function controlsTable(game, keyboard, saved) {
  const { rows, scheme } = resolveControls(game);
  const layouts = keyboard.map((k) => ({ layout: k.layout, km: keymapFor(game, k.layout, saved) }));
  const two = layouts.length > 1;
  const names = game.buttonNames || {};
  const padFor = (button) => GAMEPAD_NAMES[scheme.gamepad[button]] || "";
  const row = (icon, title, action, pad) =>
    `<tr><td>${icon}</td><td>${title}</td>${layouts
      .map(({ layout, km }) => `<td>${bindCell(layout, action, km[action])}</td>`)
      .join("")}<td>${pad}</td></tr>`;

  const lines = [
    row(chip("↑"), "Вверх / прыжок", "up", "↑"),
    row(chip("↓"), "Вниз / присесть", "down", "↓"),
    row(chip("←"), "Влево", "left", "←"),
    row(chip("→"), "Вправо", "right", "→"),
  ];
  // Bottom row first: it holds the most used buttons (LP, RUN, LK).
  [...rows].reverse().forEach((cells, r) =>
    cells.forEach((cell, c) => lines.push(row(chip(cell.label), names[cell.label] || cell.label, buttonAction(r, c), padFor(cell.button))))
  );
  lines.push(row(chip("Start"), names.Start || "Старт / пауза", "start", "Start"));
  // Select / Mode only when the game says what it does.
  if (scheme.select && names[scheme.select.name]) lines.push(row(chip(scheme.select.name), names[scheme.select.name], "select", "Back"));
  return `
    <table class="ref">
      <thead><tr><th></th><th>Действие</th>${two ? "<th>Игрок 1</th><th>Игрок 2</th>" : "<th>Клавиша</th>"}<th>Геймпад</th></tr></thead>
      <tbody>${lines.join("")}</tbody>
    </table>
    <p class="muted small">Чтобы поменять клавишу, нажмите на неё в таблице, а затем нужную клавишу на клавиатуре. Esc — отмена.</p>`;
}

function touchHelp(game) {
  const { rows } = resolveControls(game);
  return `
    <div class="touch-help">
      <div class="touch-help-stick"><div class="ring"><i></i></div><p>Палец в левой части экрана — появится стик. Ведите в нужную сторону.</p></div>
      <div class="touch-help-btns">
        ${rows.map((row) => `<div>${row.map((c) => chip(c.label)).join("")}</div>`).join("")}
        <p>Удары справа. Можно вести палец с кнопки на кнопку.</p>
      </div>
    </div>`;
}

function specialsBlock(game, fighter, labels, saved) {
  const main = keymapFor(game, "main", saved);
  const list = (game.specials && game.specials[fighter]) || [];
  if (!fighter) return `<p class="muted">Выберите бойца — появятся его спецприёмы и кнопки для них.</p>`;
  return `
    <table class="ref specials-ref">
      <tbody>${list
        .map(
          ([name, seq], i) =>
            `<tr><td>${name}</td><td class="move">${formatMove(seq, labels)}</td><td>${
              SPECIAL_ACTIONS[i] ? bindCell("main", SPECIAL_ACTIONS[i], main[SPECIAL_ACTIONS[i]]) : ""
            }</td></tr>`
        )
        .join("")}</tbody>
    </table>
    <p class="muted small">→ — вперёд (к сопернику), ← — назад. Кнопки спецприёмов сами учитывают, в какую сторону смотрит боец.</p>`;
}

// Resolves true when the player presses "В бой!" / "Вернуться в игру", false when they
// close it with ✕ or Esc (before a game that means "don't start").
export function showBriefing({ game, keyboard, settings, save, inGame = false }) {
  const dlg = document.getElementById("briefing");
  const labels = resolveControls(game).rows.flat().map((c) => c.label);
  const fighters = Object.keys(game.specials || {}).sort();
  const isTouch = matchMedia("(pointer: coarse)").matches;

  const render = () => {
    const fighter = settings.fighter[game.id] || "";
    dlg.innerHTML = `
      <form method="dialog" class="briefing">
        <header>
          <div><p class="muted">${inGame ? "Справочник" : "Перед боем"}</p><h2>${game.title}</h2></div>
          <button type="button" class="icon-btn briefing-close" data-close aria-label="${inGame ? "Закрыть" : "Отмена"}" title="${inGame ? "Закрыть" : "Отмена — вернуться на главную"}">✕</button>
        </header>
        ${isTouch ? `<section><h3>На телефоне</h3>${touchHelp(game)}</section>` : ""}
        ${
          isTouch
            ? `<details><summary>Клавиатура и геймпад</summary>${controlsTable(game, keyboard, settings.keys)}</details>`
            : `<section><h3>Управление</h3>${controlsTable(game, keyboard, settings.keys)}</section>`
        }
        ${
          game.basics
            ? `<section><h3>Базовые приёмы</h3><table class="ref"><tbody>${game.basics
                .map(([name, seq]) => `<tr><td>${name}</td><td class="move">${formatMove(seq, labels)}</td></tr>`)
                .join("")}</tbody></table></section>`
            : ""
        }
        ${
          fighters.length
            ? `<section>
                <h3>Спецприёмы одной кнопкой</h3>
                <label class="field"><span>Мой боец</span>
                  <select name="fighter"><option value="">— выберите —</option>${fighters
                    .map((f) => `<option ${f === fighter ? "selected" : ""}>${f}</option>`)
                    .join("")}</select>
                </label>
                ${specialsBlock(game, fighter, labels, settings.keys)}
              </section>`
            : ""
        }
        <footer>
          ${inGame ? "" : `<label class="check"><input type="checkbox" name="skip" ${settings.skipBriefing[game.id] ? "checked" : ""}> Больше не показывать перед игрой</label>`}
          <button type="button" class="btn ghost small" data-reset-keys>Сбросить клавиши</button>
          <button class="btn primary big" value="go">${inGame ? "Вернуться в игру" : "В бой!"}</button>
        </footer>
      </form>`;
    const select = dlg.querySelector('select[name="fighter"]');
    if (select)
      select.onchange = () => {
        settings.fighter[game.id] = select.value;
        save();
        render();
      };
    const skip = dlg.querySelector('input[name="skip"]');
    if (skip)
      skip.onchange = () => {
        settings.skipBriefing[game.id] = skip.checked;
        save();
      };
  };

  // ----- key rebinding -----
  let listening = null; // { layout, action, el }
  let swallowKeyup = null;
  const layoutsInUse = [...new Set([...keyboard.map((k) => k.layout), "main"])];

  const assign = (layout, action, code) => {
    // A key can do only one thing: take it away from every other action of every player.
    const saved = (settings.keys[game.id] = settings.keys[game.id] || {});
    for (const l of layoutsInUse) {
      const km = keymapFor(game, l, settings.keys);
      for (const a of Object.keys(km)) km[a] = km[a].filter((c) => c !== code);
      saved[l] = km;
    }
    saved[layout][action] = [code];
    save();
  };

  const onKeyDown = (e) => {
    if (!listening) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.code !== "Escape") assign(listening.layout, listening.action, e.code);
    swallowKeyup = e.code;
    listening = null;
    render();
  };
  // Stop the key that was just bound from also clicking a focused button on release.
  const onKeyUp = (e) => {
    if (e.code !== swallowKeyup) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    swallowKeyup = null;
  };
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);

  dlg.onclick = (e) => {
    const cell = e.target.closest(".keybind");
    if (cell) {
      dlg.querySelectorAll(".keybind.listening").forEach((el) => {
        el.classList.remove("listening");
        el.innerHTML = el.dataset.prev;
      });
      listening = { layout: cell.dataset.layout, action: cell.dataset.action };
      cell.dataset.prev = cell.innerHTML;
      cell.classList.add("listening");
      cell.textContent = "Нажмите клавишу…";
      return;
    }
    if (e.target.closest("[data-close]")) {
      dlg.close("cancel");
      return;
    }
    if (e.target.closest("[data-reset-keys]")) {
      delete settings.keys[game.id];
      save();
      render();
    }
  };
  // Esc while waiting for a key cancels the binding, not the whole dialog.
  dlg.oncancel = (e) => {
    if (listening || swallowKeyup === "Escape") e.preventDefault();
  };

  render();
  dlg.returnValue = "";
  return new Promise((resolve) => {
    dlg.onclose = () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      listening = null;
      resolve(dlg.returnValue === "go");
    };
    dlg.showModal();
  });
}
