import { KEYBOARD, SPECIAL_KEYS, resolveControls } from "./schemes.js";

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

const kbd = (codes) => codes.map((c) => `<kbd>${keyName(c)}</kbd>`).join(" ");
const chip = (label) => `<span class="chip chip-${label}">${label}</span>`;

// "D,F,LP" -> ↓ → LP ; "B+LK" -> ← + LK ; free text passes through.
export function formatMove(text, labels) {
  return text
    .split(/([,+])/)
    .map((part) => {
      const t = part.trim();
      if (t === ",") return " ";
      if (t === "+") return " + ";
      if (ARROWS[t]) return `<b class="arrow">${ARROWS[t]}</b>`;
      if (labels.includes(t)) return chip(t);
      return t.replace(/\b(LP|HP|LK|HK|BLK|RUN)\b/g, (m) => (labels.includes(m) ? chip(m) : m));
    })
    .join("");
}

function controlsTable(game, keyboard) {
  const { rows, scheme } = resolveControls(game);
  const layouts = keyboard.map((k) => KEYBOARD[k.layout]);
  const two = layouts.length > 1;
  const names = game.buttonNames || {};
  // Keyboard rows are bottom-up, on-screen rows top-down.
  const keysFor = (kb, r, c) => (kb.rows[rows.length - 1 - r] || [])[c] || [];
  const dirKeys = (kb) => {
    const order = ["up", "left", "down", "right"];
    return order.flatMap((d) => Object.keys(kb.dirs).filter((code) => kb.dirs[code] === d));
  };
  const padFor = (button) => GAMEPAD_NAMES[scheme.gamepad[button]] || "";

  const lines = [];
  lines.push(
    `<tr><td>${chip("⇄")}</td><td>Движение</td>${layouts.map((kb) => `<td>${kbd(dirKeys(kb))}</td>`).join("")}<td>крестовина / стик</td></tr>`
  );
  // Show the bottom row first: it holds the most used buttons (LP, RUN, LK).
  [...rows.keys()].reverse().forEach((r) => {
    rows[r].forEach((cell, c) => {
      lines.push(
        `<tr><td>${chip(cell.label)}</td><td>${names[cell.label] || cell.label}</td>${layouts
          .map((kb) => `<td>${kbd(keysFor(kb, r, c))}</td>`)
          .join("")}<td>${padFor(cell.button)}</td></tr>`
      );
    });
  });
  lines.push(
    `<tr><td>${chip("Start")}</td><td>Пауза, вход второго игрока</td>${layouts.map((kb) => `<td>${kbd(kb.start)}</td>`).join("")}<td>Start</td></tr>`
  );
  return `
    <table class="ref">
      <thead><tr><th></th><th>Действие</th>${two ? "<th>Игрок 1</th><th>Игрок 2</th>" : "<th>Клавиатура</th>"}<th>Геймпад</th></tr></thead>
      <tbody>${lines.join("")}</tbody>
    </table>`;
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

function specialsBlock(game, fighter, labels) {
  const list = (game.specials && game.specials[fighter]) || [];
  if (!fighter) return `<p class="muted">Выберите бойца — появятся его спецприёмы и кнопки для них.</p>`;
  return `
    <table class="ref specials-ref">
      <tbody>${list
        .map(
          ([name, seq], i) =>
            `<tr><td>${name}</td><td class="move">${formatMove(seq, labels)}</td><td>${
              SPECIAL_KEYS[i] ? kbd([SPECIAL_KEYS[i]]) : ""
            }</td></tr>`
        )
        .join("")}</tbody>
    </table>
    <p class="muted small">→ — вперёд (к сопернику), ← — назад. Кнопки спецприёмов сами учитывают, в какую сторону смотрит боец.</p>`;
}

// Resolves when the player presses "В бой!" (or closes the dialog when opened mid-game).
export function showBriefing({ game, keyboard, settings, save, inGame = false }) {
  const dlg = document.getElementById("briefing");
  const labels = Object.keys(game.buttonNames || {});
  const fighters = Object.keys(game.specials || {}).sort();
  const isTouch = matchMedia("(pointer: coarse)").matches;

  const render = () => {
    const fighter = settings.fighter[game.id] || "";
    dlg.innerHTML = `
      <form method="dialog" class="briefing">
        <header><p class="muted">${inGame ? "Справочник" : "Перед боем"}</p><h2>${game.title}</h2></header>
        ${isTouch ? `<section><h3>На телефоне</h3>${touchHelp(game)}</section>` : ""}
        <section>
          <h3>${isTouch ? "Клавиатура и геймпад" : "Управление"}</h3>
          ${controlsTable(game, keyboard)}
        </section>
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
                ${specialsBlock(game, fighter, labels)}
              </section>`
            : ""
        }
        <footer>
          ${inGame ? "" : `<label class="check"><input type="checkbox" name="skip" ${settings.skipBriefing[game.id] ? "checked" : ""}> Больше не показывать перед игрой</label>`}
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

  render();
  return new Promise((resolve) => {
    dlg.onclose = () => resolve();
    dlg.showModal();
  });
}
