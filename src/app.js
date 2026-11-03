import * as C from "./core.js";

const $ = (s) => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

let workouts = [];
let current = null;
let overrides = store.get("overrides", {});
let custom = store.get("custom", {});
let done = store.get("done", {});

const keyOf = (w) => w.start.toISOString();
const fmtDate = (d) => d.toLocaleDateString("de-CH", { weekday: "short", day: "numeric", month: "short" }) +
  ", " + d.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
const fmtDur = (s) => `${Math.floor(s / 3600)}:${String(Math.round((s % 3600) / 60)).padStart(2, "0")} Std.`;

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("show"), 1800);
}

async function readFile(file) { return await file.text(); }

const onCsv = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  const text = await readFile(f);
  e.target.value = "";
  if (/^﻿?NAME;EQUIPMENT;MUSKEL/.test(text)) { importCustom(text); return; }
  const ws = C.parseWorkouts(text);
  if (!ws.length) { toast("Keine Workouts gefunden. Ist es der Export «Workouts»?"); return; }
  workouts = ws.sort((a, b) => b.start - a.start);
  store.set("lastCsv", text.length < 1500000 ? text : null);
  current = workouts[0];
  render();
};
$("#csv").addEventListener("change", onCsv);
$("#csv2").addEventListener("change", onCsv);

$("#custom").addEventListener("change", async (e) => {
  const f = e.target.files[0]; if (!f) return;
  importCustom(await readFile(f)); e.target.value = "";
});

function importCustom(text) {
  custom = C.parseCustomExercises(text);
  store.set("custom", custom);
  toast(`${Object.keys(custom).length} eigene Übungen übernommen`);
  render();
}

function render() {
  $("#empty").hidden = !!current;
  $("#main").hidden = !current;
  if (!current) return;

  // Auswahl der letzten Trainings
  const list = $("#list");
  list.innerHTML = "";
  workouts.slice(0, 12).forEach((w) => {
    const b = document.createElement("button");
    b.className = "pill" + (w === current ? " active" : "");
    b.innerHTML = `<span>${esc(w.day)}</span><small>${fmtDate(w.start)}</small>${done[keyOf(w)] ? '<i title="hochgeladen">✓</i>' : ""}`;
    b.onclick = () => { current = w; render(); };
    list.appendChild(b);
  });

  const w = current;
  const st = C.stats(w);
  $("#title").textContent = C.buildTitle(w);
  $("#meta").textContent = `${fmtDate(w.start)} · ${fmtDur(w.durationSec)} · ${st.sets} Sätze · ${st.volume.toLocaleString("de-CH")} kg`;
  $("#status").hidden = !done[keyOf(w)];
  $("#markDone").textContent = done[keyOf(w)] ? "Markierung entfernen" : "Als hochgeladen markieren";

  const mus = C.muscleSummary(w, overrides, custom);
  const max = mus[0]?.score || 1;
  $("#muscles").innerHTML = mus.map((m) =>
    `<span class="chip" style="--p:${Math.round((m.score / max) * 100)}%">${esc(m.muscle)}</span>`).join("");

  const ul = $("#exercises");
  ul.innerHTML = "";
  w.exercises.forEach((ex) => {
    const c = C.classify(ex, overrides, custom);
    const li = document.createElement("li");
    const sets = ex.sets.map((s) => (s.bodyweight && !s.kg ? `KG×${s.reps}` : `${String(s.kg).replace(".", ",")}×${s.reps}`)).join("  ");
    li.innerHTML = `<div class="ex"><b>${esc(ex.name)}</b><small>${esc(sets)}</small></div>
      <button class="tag ${c.muscles.length ? "" : "warn"}" aria-label="Muskel ändern">${esc(c.muscles[0] || "Muskel wählen")}</button>`;
    li.querySelector("button").onclick = () => pickMuscle(ex, c);
    ul.appendChild(li);
  });
}

function pickMuscle(ex, c) {
  const dlg = $("#pick");
  $("#pickName").textContent = ex.name;
  const box = $("#pickList");
  box.innerHTML = "";
  C.MUSCLES.forEach((m) => {
    const b = document.createElement("button");
    b.className = "chip sel" + (c.muscles[0] === m ? " on" : "");
    b.textContent = m;
    b.onclick = () => {
      const rest = c.muscles.filter((x) => x !== m);
      overrides[ex.name.toLowerCase()] = { muscles: [m, ...rest] };
      store.set("overrides", overrides);
      dlg.close(); render(); toast("Gespeichert, gilt ab jetzt immer");
    };
    box.appendChild(b);
  });
  $("#pickReset").onclick = () => {
    delete overrides[ex.name.toLowerCase()];
    store.set("overrides", overrides); dlg.close(); render();
  };
  dlg.showModal();
}

async function copy(text, label) {
  try { await navigator.clipboard.writeText(text); toast(label + " kopiert"); }
  catch {
    const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta);
    ta.select(); document.execCommand("copy"); ta.remove(); toast(label + " kopiert");
  }
}

$("#copyTitle").onclick = () => copy(C.buildTitle(current), "Titel");
$("#copyDesc").onclick = () => copy(C.buildDescription(current, overrides, custom), "Beschreibung");

$("#fit").onclick = async () => {
  const w = current;
  const bytes = C.buildFit(w, overrides, custom);
  const d = w.start;
  const name = `${w.day.replace(/[^\wäöüÄÖÜ-]+/g, "_")}_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.fit`;
  const file = new File([bytes], name, { type: "application/octet-stream" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
};

$("#markDone").onclick = () => {
  const k = keyOf(current);
  if (done[k]) delete done[k]; else done[k] = Date.now();
  store.set("done", done); render();
};

$("#resetAll").onclick = () => {
  if (!confirm("Alle eigenen Muskel-Zuordnungen löschen?")) return;
  overrides = {}; store.set("overrides", overrides); render(); toast("Zurückgesetzt");
};

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// Letzten Import wiederherstellen
const last = store.get("lastCsv", null);
if (last) {
  workouts = C.parseWorkouts(last).sort((a, b) => b.start - a.start);
  current = workouts[0] || null;
}
render();

