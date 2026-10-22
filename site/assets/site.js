// Site behaviour: mobile menu, help buttons (?) and saved checklists.
import { TERMS } from "./terms.js";

// ---- menu
const toggle = document.querySelector(".menu-toggle");
const nav = document.getElementById("site-nav");
if (toggle && nav) {
  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(open));
    nav.classList.toggle("open", open);
  });
}

// ---- help buttons
// Each "?" is a link to the glossary, so it works without JavaScript. Here it becomes a
// button that opens a short explanation right next to the term (disclosure pattern).
const INSIDE = "li, td, th, dd, caption, .item-body, .help-host";
const AFTER = "p, h1, h2, h3, h4, dt, label, .lead, .core-question";
let counter = 0;

function closePanel(btn, returnFocus = false) {
  const panel = document.getElementById(btn.getAttribute("aria-controls"));
  if (panel) panel.hidden = true;
  btn.setAttribute("aria-expanded", "false");
  if (returnFocus) btn.focus();
}

function buildPanel(btn, id) {
  const t = TERMS[id];
  const panel = document.createElement("div");
  panel.className = "help-panel";
  panel.id = btn.getAttribute("aria-controls");
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", `About: ${t.term}`);
  panel.innerHTML = `
    <div class="help-head"><p class="help-term"></p><button type="button" class="help-close">Close</button></div>
    <p class="help-short"></p>
    ${t.more ? `<button type="button" class="help-close help-more" aria-expanded="false">Tell me more</button><p class="more" hidden></p>` : ""}
    <p class="small"><a href="glossary.html#${id}">See it in the glossary</a></p>`;
  panel.querySelector(".help-term").textContent = t.term;
  panel.querySelector(".help-short").textContent = t.short;
  if (t.more) {
    const more = panel.querySelector(".more");
    more.textContent = t.more;
    const mb = panel.querySelector(".help-more");
    mb.addEventListener("click", () => {
      more.hidden = !more.hidden;
      mb.setAttribute("aria-expanded", String(!more.hidden));
      mb.textContent = more.hidden ? "Tell me more" : "Show less";
    });
  }
  panel.querySelector(".help-close:not(.help-more)").addEventListener("click", () => closePanel(btn, true));
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePanel(btn, true);
  });
  const inside = btn.closest(INSIDE);
  const after = btn.closest(AFTER);
  if (inside && (!after || inside.contains(after) === false)) inside.appendChild(panel);
  else if (after) after.insertAdjacentElement("afterend", panel);
  else btn.insertAdjacentElement("afterend", panel);
  return panel;
}

function openPanel(btn) {
  document.querySelectorAll('.help[aria-expanded="true"]').forEach((b) => b !== btn && closePanel(b));
  const panel = document.getElementById(btn.getAttribute("aria-controls")) || buildPanel(btn, btn.dataset.help);
  panel.hidden = false;
  btn.setAttribute("aria-expanded", "true");
}

document.querySelectorAll("a.help[data-help]").forEach((a) => {
  const id = a.dataset.help;
  if (!TERMS[id]) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "help";
  btn.dataset.help = id;
  btn.setAttribute("aria-label", a.getAttribute("aria-label"));
  btn.setAttribute("aria-expanded", "false");
  btn.setAttribute("aria-controls", `help-panel-${++counter}`);
  btn.innerHTML = '<span aria-hidden="true">?</span>';
  btn.addEventListener("click", () => (btn.getAttribute("aria-expanded") === "true" ? closePanel(btn) : openPanel(btn)));
  btn.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && btn.getAttribute("aria-expanded") === "true") closePanel(btn);
  });
  a.replaceWith(btn);
});

// ---- checklists (ticks are saved in this browser only)
function store(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key) || "[]");
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return [];
  }
  return [];
}

document.querySelectorAll("ul.checklist[data-store]").forEach((list) => {
  const key = `explain-the-model:${list.dataset.store}`;
  const boxes = [...list.querySelectorAll('input[type="checkbox"]')];
  const status = document.querySelector(`.checklist-status[data-for="${list.dataset.store}"]`);
  const saved = new Set(store(key));
  const update = () => {
    if (status) status.textContent = `${boxes.filter((b) => b.checked).length} of ${boxes.length} done (saved in this browser only)`;
  };
  boxes.forEach((b) => {
    b.checked = saved.has(b.id);
    b.addEventListener("change", () => {
      store(key, boxes.filter((x) => x.checked).map((x) => x.id));
      update();
    });
  });
  update();
});
