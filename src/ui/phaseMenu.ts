import type { DemoStoryPhase } from "../render/phasePills.js";

const PHASES: Array<{ id: DemoStoryPhase; label: string }> = [
  { id: "unify", label: "Unify" },
  { id: "alert", label: "Alert" },
  { id: "investigate", label: "Investigate" },
  { id: "resolve", label: "Resolve" },
  { id: "automate", label: "Automate" },
  { id: "idle", label: "Idle" },
];

export interface PhaseMenuHandles {
  open: (kiosk: number, clientX: number, clientY: number) => void;
  close: () => void;
  destroy: () => void;
}

export const mountPhaseMenu = (
  root: HTMLElement,
  onSelect: (kiosk: number, phase: DemoStoryPhase) => void,
): PhaseMenuHandles => {
  const style = document.createElement("style");
  style.textContent = `
    .phase-menu {
      position: fixed;
      z-index: 12;
      min-width: 132px;
      padding: 6px;
      border-radius: 8px;
      background: rgba(8, 10, 16, 0.94);
      border: 1px solid rgba(255, 255, 255, 0.14);
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
      pointer-events: auto;
      font: 11px/1.35 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      color: #e8e8e8;
    }
    .phase-menu-title {
      padding: 4px 8px 6px;
      font-size: 10px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: rgba(255, 255, 255, 0.45);
    }
    .phase-menu-btn {
      display: block;
      width: 100%;
      box-sizing: border-box;
      text-align: left;
      margin: 0;
      padding: 6px 8px;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: rgba(255, 255, 255, 0.88);
      cursor: pointer;
      font: inherit;
    }
    .phase-menu-btn:hover { background: rgba(255, 255, 255, 0.1); }
    .phase-menu-btn:active { background: rgba(255, 255, 255, 0.16); }
  `;
  document.head.appendChild(style);

  const menu = document.createElement("div");
  menu.className = "phase-menu";
  menu.hidden = true;
  menu.setAttribute("role", "menu");

  const title = document.createElement("div");
  title.className = "phase-menu-title";
  menu.appendChild(title);

  for (const { id, label } of PHASES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "phase-menu-btn";
    btn.textContent = label;
    btn.dataset.phase = id;
    btn.setAttribute("role", "menuitem");
    menu.appendChild(btn);
  }

  root.appendChild(menu);

  let kiosk = 0;

  const close = (): void => {
    menu.hidden = true;
  };

  const open = (k: number, clientX: number, clientY: number): void => {
    kiosk = k;
    title.textContent = `Kiosk ${k + 1}`;
    menu.hidden = false;
    const pad = 8;
    const rect = menu.getBoundingClientRect();
    let left = clientX;
    let top = clientY;
    if (left + rect.width > window.innerWidth - pad) left = window.innerWidth - rect.width - pad;
    if (top + rect.height > window.innerHeight - pad) top = window.innerHeight - rect.height - pad;
    left = Math.max(pad, left);
    top = Math.max(pad, top);
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  };

  menu.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".phase-menu-btn");
    if (!btn?.dataset.phase) return;
    onSelect(kiosk, btn.dataset.phase as DemoStoryPhase);
    close();
  });

  const onDocPointer = (e: PointerEvent): void => {
    if (menu.hidden) return;
    if (e.target instanceof Node && menu.contains(e.target)) return;
    close();
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") close();
  };

  document.addEventListener("pointerdown", onDocPointer);
  document.addEventListener("keydown", onKey);

  return {
    open,
    close,
    destroy: () => {
      close();
      document.removeEventListener("pointerdown", onDocPointer);
      document.removeEventListener("keydown", onKey);
      menu.remove();
      style.remove();
    },
  };
};
