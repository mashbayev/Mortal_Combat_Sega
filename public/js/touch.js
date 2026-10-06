import { DIRS } from "./schemes.js";

// On a portrait phone the play screen may be turned 90° clockwise (body.rotated, see style.css).
// Pointer events still come in window coordinates; this maps them to the screen's own frame.
const rotated = () => document.body.classList.contains("rotated");
const localPoint = (x, y) => (rotated() ? { x: y, y: window.innerWidth - x } : { x, y });

// On-screen controls: a floating stick (appears under the thumb), action buttons
// that can be slid across with one finger, Start/Select, and special-move buttons.
export class TouchControls {
  constructor(root, controls, { onMask, onSpecial }) {
    this.root = root;
    this.controls = controls;
    this.onMask = onMask;
    this.onSpecial = onSpecial;
    this.stickMask = 0;
    this.buttonPointers = new Map(); // pointerId -> bit
    this.build();
  }

  build() {
    const { rows, scheme } = this.controls;
    this.root.innerHTML = `
      <div class="stick-zone"><div class="stick-base"><div class="stick-knob"></div></div></div>
      <div class="action-zone">
        <div class="specials"></div>
        <div class="buttons">${rows
          .map(
            (row) =>
              `<div class="btn-row">${row
                .map((c) => `<button class="pad-btn" data-bit="${c.id}" data-label="${c.label}">${c.label}</button>`)
                .join("")}</div>`
          )
          .join("")}</div>
      </div>
      <div class="sys-zone">
        ${scheme.select ? `<button class="sys-btn" data-bit="${scheme.select.id}">${scheme.select.name}</button>` : ""}
        <button class="sys-btn" data-bit="${scheme.start}">Start</button>
      </div>`;
    this.zone = this.root.querySelector(".stick-zone");
    this.base = this.root.querySelector(".stick-base");
    this.knob = this.root.querySelector(".stick-knob");
    this.specialsEl = this.root.querySelector(".specials");
    this.bindStick();
    this.bindButtons();
  }

  // [{ name, seq }] — rendered as small buttons above the action buttons.
  setSpecials(list) {
    this.specialsEl.innerHTML = list
      .map((s, i) => `<button class="special-btn" data-i="${i}">${s.name}</button>`)
      .join("");
    this.specialsEl.querySelectorAll(".special-btn").forEach((el) => {
      el.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        el.classList.add("down");
        this.onSpecial(list[el.dataset.i]);
      });
      const up = () => el.classList.remove("down");
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
      el.addEventListener("pointerleave", up);
    });
  }

  bindStick() {
    let active = null; // { id, x, y }
    const radius = () => this.base.offsetWidth / 2 || 60;

    const update = (dx, dy) => {
      const r = radius();
      const dist = Math.hypot(dx, dy);
      const k = dist > r ? r / dist : 1;
      this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      let mask = 0;
      if (dist > r * 0.3) {
        // 8 sectors of 45°; diagonals press both directions.
        const angle = Math.atan2(dy, dx);
        const sector = Math.round(angle / (Math.PI / 4)); // -4..4
        const right = [-1, 0, 1].includes(sector);
        const left = [-4, -3, 3, 4].includes(sector);
        const down = [1, 2, 3].includes(sector);
        const up = [-1, -2, -3].includes(sector);
        if (right) mask |= 1 << DIRS.right;
        if (left) mask |= 1 << DIRS.left;
        if (down) mask |= 1 << DIRS.down;
        if (up) mask |= 1 << DIRS.up;
      }
      if (mask !== this.stickMask) {
        this.stickMask = mask;
        this.emit();
      }
    };

    // x, y are in the play screen's own frame (see localPoint).
    const place = (x, y) => {
      const rect = this.zone.getBoundingClientRect();
      const origin = rotated() ? localPoint(rect.right, rect.top) : { x: rect.left, y: rect.top };
      this.base.style.left = `${x - origin.x}px`;
      this.base.style.top = `${y - origin.y}px`;
    };

    this.zone.addEventListener("pointerdown", (e) => {
      if (active) return;
      e.preventDefault();
      this.zone.setPointerCapture(e.pointerId);
      const p = localPoint(e.clientX, e.clientY);
      active = { id: e.pointerId, x: p.x, y: p.y };
      place(p.x, p.y);
      this.zone.classList.add("active");
      update(0, 0);
    });
    this.zone.addEventListener("pointermove", (e) => {
      if (!active || e.pointerId !== active.id) return;
      const p = localPoint(e.clientX, e.clientY);
      let dx = p.x - active.x;
      let dy = p.y - active.y;
      // Drag the base along when the thumb travels past the edge, so reversing is instant.
      const r = radius();
      const dist = Math.hypot(dx, dy);
      if (dist > r * 1.4) {
        const pull = (dist - r * 1.4) / dist;
        active.x += dx * pull;
        active.y += dy * pull;
        place(active.x, active.y);
        dx = p.x - active.x;
        dy = p.y - active.y;
      }
      update(dx, dy);
    });
    const end = (e) => {
      if (!active || e.pointerId !== active.id) return;
      active = null;
      this.zone.classList.remove("active");
      this.base.style.left = "";
      this.base.style.top = "";
      update(0, 0);
    };
    this.zone.addEventListener("pointerup", end);
    this.zone.addEventListener("pointercancel", end);
  }

  bindButtons() {
    const buttons = [...this.root.querySelectorAll(".pad-btn, .sys-btn")];
    const bitAt = (x, y) => {
      const el = document.elementFromPoint(x, y);
      const btn = el && el.closest && el.closest(".pad-btn, .sys-btn");
      return btn && this.root.contains(btn) ? Number(btn.dataset.bit) : null;
    };
    const refresh = () => {
      const pressed = new Set(this.buttonPointers.values());
      buttons.forEach((b) => b.classList.toggle("down", pressed.has(Number(b.dataset.bit))));
      this.emit();
    };
    for (const btn of buttons) {
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        btn.releasePointerCapture?.(e.pointerId);
        this.buttonPointers.set(e.pointerId, Number(btn.dataset.bit));
        refresh();
      });
    }
    // Sliding a finger from one action button to another switches the press (pad-btn only).
    this.root.addEventListener("pointermove", (e) => {
      if (!this.buttonPointers.has(e.pointerId)) return;
      const bit = bitAt(e.clientX, e.clientY);
      if (bit !== null && bit !== this.buttonPointers.get(e.pointerId)) {
        this.buttonPointers.set(e.pointerId, bit);
        refresh();
      }
    });
    const end = (e) => {
      if (this.buttonPointers.delete(e.pointerId)) refresh();
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }

  emit() {
    let mask = this.stickMask;
    for (const bit of this.buttonPointers.values()) mask |= 1 << bit;
    this.onMask(mask);
  }

  setStyle({ size, opacity }) {
    this.root.style.setProperty("--pad-scale", size);
    this.root.style.setProperty("--pad-opacity", opacity);
  }
}
