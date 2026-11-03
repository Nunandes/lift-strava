// Kernlogik: Alpha-Progression-CSV lesen, Muskelgruppen zuordnen, FIT-Datei bauen.
import { Encoder, Profile, Utils } from "@garmin/fitsdk";

// ---------- CSV ----------
// Alpha Progression exportiert mit ";" getrennt, Felder teils in "" (auch mehrzeilig).
export function parseCsvRows(text) {
  text = text.replace(/^﻿/, "");
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ";") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const num = (s) => {
  if (s == null) return null;
  s = String(s).trim();
  if (!s || s === "-") return null;
  const v = parseFloat(s.replace("+", "").replace(",", "."));
  return Number.isFinite(v) ? v : null;
};

// Workouts-Export: Kopfzeile "Name · Tag · Woche · Plan";"YYYY-MM-DD HH:MM Uhr";"1:39 Std."
export function parseWorkouts(text) {
  const rows = parseCsvRows(text);
  const workouts = [];
  let w = null, ex = null, cols = null;
  for (const r of rows) {
    if (r.length === 1 && r[0].trim() === "") { ex = null; continue; }
    if (r.length >= 2 && /\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}/.test(r[1] || "")) {
      const m = r[1].match(/(\d{4})-(\d{2})-(\d{2}) (\d{1,2}):(\d{2})/);
      const start = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
      const parts = r[0].split(" · ").map((s) => s.trim());
      w = {
        title: r[0].trim(),
        day: parts[0] || "Training",
        week: (parts.find((p) => /^Woche/.test(p)) || "").trim(),
        plan: parts.length > 3 ? parts[parts.length - 1] : "",
        start,
        durationSec: parseDuration(r[2] || ""),
        exercises: [],
      };
      workouts.push(w); ex = null; continue;
    }
    if (!w) continue;
    if (r.length === 1 && /^\d+\.\s/.test(r[0])) {
      const label = r[0].replace(/^\d+\.\s*/, "");
      const parts = label.split(" · ").map((s) => s.trim());
      const reps = parts.findIndex((p) => /Wdh$/.test(p));
      ex = {
        name: parts[0],
        equipment: reps > 1 ? parts[1] : (parts[1] && !/Wdh$/.test(parts[1]) ? parts[1] : ""),
        sets: [],
      };
      w.exercises.push(ex); cols = null; continue;
    }
    if (r[0] === "#") { cols = r.map((c) => c.trim().toUpperCase()); continue; }
    if (ex && cols && /^\d+$/.test(r[0])) {
      const get = (k) => { const i = cols.indexOf(k); return i >= 0 ? r[i] : null; };
      const reps = num(get("WDH"));
      const kgRaw = get("KG");
      if (reps == null && num(kgRaw) == null) continue; // ausgelassener Satz "-;-"
      ex.sets.push({
        reps: reps ?? 0,
        kg: num(kgRaw) ?? 0,
        bodyweight: kgRaw == null || /^\+/.test(String(kgRaw).trim()),
      });
    }
  }
  return workouts.filter((x) => x.exercises.some((e) => e.sets.length));
}

function parseDuration(s) {
  let m = s.match(/(\d+):(\d{2})\s*Std/);
  if (m) return (+m[1] * 60 + +m[2]) * 60;
  m = s.match(/(\d+)\s*Min/);
  if (m) return +m[1] * 60;
  m = s.match(/(\d+):(\d{2})/);
  if (m) return (+m[1] * 60 + +m[2]) * 60;
  return 3600;
}

// Eigene Übungen: NAME;EQUIPMENT;MUSKEL;HILFSMUSKELN;...
export function parseCustomExercises(text) {
  const rows = parseCsvRows(text);
  const head = (rows.shift() || []).map((h) => h.trim().toUpperCase());
  const iN = head.indexOf("NAME"), iM = head.indexOf("MUSKEL"), iH = head.indexOf("HILFSMUSKELN");
  const out = {};
  for (const r of rows) {
    const name = (r[iN] || "").trim();
    if (!name) continue;
    const primary = apMuscle(r[iM]);
    const helpers = String(r[iH] || "").split(",").map(apMuscle).filter(Boolean);
    if (primary) out[name.toLowerCase()] = { muscles: [primary, ...helpers.filter((h) => h !== primary)] };
  }
  return out;
}

// ---------- Muskelgruppen ----------
export const MUSCLES = [
  "Brust", "Vordere Schulter", "Seitliche Schulter", "Hintere Schulter", "Lat",
  "Oberer Rücken", "Unterer Rücken", "Trapez", "Bizeps", "Trizeps", "Unterarme",
  "Bauch", "Quadrizeps", "Beinbeuger", "Gesäss", "Adduktoren", "Waden",
];

function apMuscle(s) {
  s = String(s || "").trim().toLowerCase();
  if (!s || s === "-") return null;
  const map = {
    "brust": "Brust", "vordere schulter": "Vordere Schulter", "seitliche schulter": "Seitliche Schulter",
    "hintere schulter": "Hintere Schulter", "lat": "Lat", "oberer rücken": "Oberer Rücken",
    "unterer rücken": "Unterer Rücken", "nacken": "Trapez", "trapez": "Trapez", "bizeps": "Bizeps",
    "trizeps": "Trizeps", "unterarme": "Unterarme", "bauch": "Bauch", "oberschenkel vorne": "Quadrizeps",
    "oberschenkel hinten": "Beinbeuger", "gesäß": "Gesäss", "gesäss": "Gesäss", "adduktoren": "Adduktoren",
    "waden": "Waden",
  };
  return map[s] || null;
}

// FIT-Kategorie je Hauptmuskel (Rückfall, falls keine Regel greift)
const MUSCLE_CATEGORY = {
  "Brust": "benchPress", "Vordere Schulter": "shoulderPress", "Seitliche Schulter": "lateralRaise",
  "Hintere Schulter": "flye", "Lat": "pullUp", "Oberer Rücken": "row", "Unterer Rücken": "hyperextension",
  "Trapez": "shrug", "Bizeps": "curl", "Trizeps": "tricepsExtension", "Unterarme": "curl",
  "Bauch": "crunch", "Quadrizeps": "squat", "Beinbeuger": "legCurl", "Gesäss": "hipRaise",
  "Adduktoren": "hipStability", "Waden": "calfRaise",
};

// Regeln: erste passende gewinnt. n = Garmin-Übungsname (optional, wird gegen das FIT-Profil geprüft)
const R = (re, cat, muscles, n) => ({ re, cat, muscles, n });
const RULES = [
  R(/laufband|cardio|\bfahrrad|crosstrainer/, null, []),
  R(/wadenheben.*sitz/, "calfRaise", ["Waden"], "seatedCalfRaise"),
  R(/wadenheben/, "calfRaise", ["Waden"], "standingCalfRaise"),
  R(/beinbeugen/, "legCurl", ["Beinbeuger"], "legCurl"),
  R(/beinstrecken/, "squat", ["Quadrizeps"], null),
  R(/hackenschmidt|hack squat/, "squat", ["Quadrizeps", "Gesäss"], "barbellHackSquat"),
  R(/beinpresse|pendulum|belt squat/, "squat", ["Quadrizeps", "Gesäss"], "legPress"),
  R(/bulgarian|split squat|ausfallschritt/, "lunge", ["Quadrizeps", "Gesäss"], "dumbbellBulgarianSplitSquat"),
  R(/sumo kniebeug/, "squat", ["Quadrizeps", "Gesäss", "Adduktoren"], "sumoSquat"),
  R(/kniebeug|squat/, "squat", ["Quadrizeps", "Gesäss"], "barbellBackSquat"),
  R(/rumänisch|rdl/, "deadlift", ["Beinbeuger", "Gesäss", "Unterer Rücken"], "romanianDeadlift"),
  R(/rack pull/, "deadlift", ["Unterer Rücken", "Trapez", "Gesäss"], "rackPull"),
  R(/kreuzheben|deadlift/, "deadlift", ["Unterer Rücken", "Gesäss", "Beinbeuger"], "barbellDeadlift"),
  R(/hip thrust/, "hipRaise", ["Gesäss", "Beinbeuger"], "barbellHipThrustWithBench"),
  R(/adduktor/, "hipStability", ["Adduktoren"], "weightedStandingAdduction"),
  R(/abduktor/, "hipStability", ["Gesäss"], "standingHipAbduction"),
  R(/hyperextension|rückenstrecker/, "hyperextension", ["Unterer Rücken", "Gesäss"], "staticBackExtension"),
  R(/klimmz|pull.?up|\bchin.?up/, "pullUp", ["Lat", "Bizeps"], "wideGripPullUp"),
  R(/latzug|lat pull|cbum/, "pullUp", ["Lat", "Bizeps"], "latPulldown"),
  R(/überzüge|pullover/, "pullUp", ["Lat"], "straightArmPulldown"),
  R(/face pull/, "row", ["Hintere Schulter", "Oberer Rücken"], "facePull"),
  R(/aufrechtes rudern|upright/, "shrug", ["Seitliche Schulter", "Trapez"], "uprightRow"),
  R(/shrug|schulterheben/, "shrug", ["Trapez"], null),
  R(/t-bar/, "row", ["Oberer Rücken", "Lat", "Bizeps"], "tBarRow"),
  R(/vorgebeugtes rudern.*langhantel|langhantel.*rudern/, "row", ["Oberer Rücken", "Lat", "Bizeps"], "bentOverRowWithBarbell"),
  R(/rudern.*kurzhantel|einarmiges rudern(?!.*kabel)/, "row", ["Lat", "Oberer Rücken", "Bizeps"], "dumbbellRow"),
  R(/rudern|row/, "row", ["Oberer Rücken", "Lat", "Bizeps"], "seatedCableRow"),
  R(/reverse fl|butterfly reverse|vorgebeugtes seitheben|rear delt/, "flye", ["Hintere Schulter"], "inclineReverseFlye"),
  R(/butterfly|fliegende|flye|cross.?over/, "flye", ["Brust"], "cableCrossover"),
  R(/seitheben.*kabel|seitheben.*hüfthöhe/, "lateralRaise", ["Seitliche Schulter"], "oneArmCableLateralRaise"),
  R(/seitheben|side raise|lateral/, "lateralRaise", ["Seitliche Schulter"], "dumbbellLateralRaise"),
  R(/frontheben|front raise/, "lateralRaise", ["Vordere Schulter"], "frontRaise"),
  R(/schulterdrücken.*multi|schulterdrücken.*smith/, "shoulderPress", ["Vordere Schulter", "Seitliche Schulter", "Trizeps"], "smithMachineOverheadPress"),
  R(/schulterdrücken|schulterpresse|neck press|military|overhead press/, "shoulderPress", ["Vordere Schulter", "Seitliche Schulter", "Trizeps"], "seatedDumbbellShoulderPress"),
  R(/schräg.*(drücken|presse).*(multi|smith)/, "benchPress", ["Brust", "Vordere Schulter", "Trizeps"], "inclineSmithMachineBenchPress"),
  R(/schrägbankdrücken|schräge brustpresse/, "benchPress", ["Brust", "Vordere Schulter", "Trizeps"], "inclineDumbbellBenchPress"),
  R(/bankdrücken eng/, "benchPress", ["Trizeps", "Brust"], "closeGripBarbellBenchPress"),
  R(/bankdrücken.*langhantel/, "benchPress", ["Brust", "Vordere Schulter", "Trizeps"], "barbellBenchPress"),
  R(/bankdrücken|brustpresse|chest press|bench/, "benchPress", ["Brust", "Vordere Schulter", "Trizeps"], "dumbbellBenchPress"),
  R(/liegestütz|push.?up/, "pushUp", ["Brust", "Trizeps"], null),
  R(/dips/, "tricepsExtension", ["Trizeps", "Brust"], "bodyWeightDip"),
  R(/stirnpresse|skull/, "tricepsExtension", ["Trizeps"], "lyingEzBarTricepsExtension"),
  R(/über.*kopf.*(trizeps)|trizeps.*über.*kopf|katana|overhead.*ext|medial head|bela/, "tricepsExtension", ["Trizeps"], "cableOverheadTricepsExtension"),
  R(/trizeps|triceps|extensions/, "tricepsExtension", ["Trizeps"], "tricepsPressdown"),
  R(/hammer curl.*(kabel|seil)/, "curl", ["Bizeps", "Unterarme"], "cableHammerCurl"),
  R(/hammer curl/, "curl", ["Bizeps", "Unterarme"], "dumbbellHammerCurl"),
  R(/preacher|scott/, "curl", ["Bizeps"], "ezBarPreacherCurl"),
  R(/curl.*(kabel|seil)|jesus|machine overhead curl|biceps überkopf/, "curl", ["Bizeps"], "cableBicepsCurl"),
  R(/curl.*langhantel/, "curl", ["Bizeps"], "barbellBicepsCurl"),
  R(/schrägbank curl/, "curl", ["Bizeps"], "inclineDumbbellBicepsCurl"),
  R(/curl|bizeps|bicep/, "curl", ["Bizeps"], "dumbbellBicepsCurl"),
  R(/crunch|bauchmaschine/, "crunch", ["Bauch"], "kneelingCableCrunch"),
  R(/beinheben/, "legRaise", ["Bauch"], "hangingLegRaise"),
  R(/russian twist/, "core", ["Bauch"], "russianTwist"),
  R(/plank|unterarmstütz/, "plank", ["Bauch"], null),
];

// Zuordnung für eine Übung. overrides: {name: {muscles:[...]}} (eigene Einstellungen der App)
export function classify(ex, overrides = {}, custom = {}) {
  const key = ex.name.toLowerCase();
  const full = (ex.name + " " + (ex.equipment || "")).toLowerCase();
  const own = overrides[key] || custom[key];
  const rule = RULES.find((r) => r.re.test(full));
  if (own && own.muscles && own.muscles.length) {
    const cat = rule && rule.cat && rule.muscles.includes(own.muscles[0]) ? rule.cat : MUSCLE_CATEGORY[own.muscles[0]];
    return { muscles: own.muscles, cat, n: rule && rule.cat === cat ? rule.n : null, source: "eigen" };
  }
  if (rule) return { muscles: rule.muscles, cat: rule.cat, n: rule.n, source: "regel" };
  return { muscles: [], cat: null, n: null, source: "unbekannt" };
}

// Muskelgruppen eines Trainings, gewichtet nach Sätzen (Hauptmuskel 1, Hilfsmuskeln 0.5)
export function muscleSummary(workout, overrides, custom) {
  const score = {};
  for (const ex of workout.exercises) {
    const c = classify(ex, overrides, custom);
    const n = ex.sets.length;
    c.muscles.forEach((m, i) => { score[m] = (score[m] || 0) + n * (i === 0 ? 1 : 0.5); });
  }
  return Object.entries(score).sort((a, b) => b[1] - a[1]).map(([m, s]) => ({ muscle: m, score: s }));
}

const fmtKg = (v) => (Math.round(v * 10) / 10).toString().replace(".", ",");

export function stats(workout) {
  let sets = 0, vol = 0;
  for (const ex of workout.exercises) for (const s of ex.sets) { sets++; if (!s.bodyweight) vol += s.kg * s.reps; }
  return { sets, volume: Math.round(vol) };
}

export function buildTitle(workout) {
  return `${workout.day} 💪${workout.week ? " · " + workout.week : ""}`;
}

export function buildDescription(workout, overrides, custom) {
  const mus = muscleSummary(workout, overrides, custom);
  const main = mus.filter((m) => m.score >= 2).map((m) => m.muscle);
  const st = stats(workout);
  const lines = [];
  lines.push(`Muskelgruppen: ${(main.length ? main : mus.map((m) => m.muscle)).join(" · ")}`);
  lines.push(`${workout.exercises.length} Übungen · ${st.sets} Sätze · ${st.volume.toLocaleString("de-CH")} kg Volumen`);
  lines.push("");
  workout.exercises.forEach((ex, i) => {
    const sets = ex.sets.map((s) => (s.bodyweight && !s.kg ? `KG×${s.reps}` : `${fmtKg(s.kg)}×${s.reps}`)).join(", ");
    lines.push(`${i + 1}. ${ex.name}: ${sets}`);
  });
  if (workout.plan) { lines.push(""); lines.push(`Plan: ${workout.plan} (Alpha Progression)`); }
  return lines.join("\n");
}

// ---------- FIT ----------
const T = Profile.types;
const catNum = (cat) => {
  const e = Object.entries(T.exerciseCategory).find(([, v]) => v === cat);
  return e ? +e[0] : 65534;
};
const nameNum = (cat, n) => {
  if (!cat || !n) return null;
  const t = T[cat + "ExerciseName"];
  if (!t) return null;
  const e = Object.entries(t).find(([, v]) => v === n);
  return e ? +e[0] : null;
};

// Sätze gleichmässig über die Trainingsdauer verteilen (AP liefert keine Zeit pro Satz)
export function buildFit(workout, overrides, custom) {
  const startMs = workout.start.getTime();
  const total = Math.max(workout.durationSec, 60);
  const all = [];
  workout.exercises.forEach((ex) => {
    const c = classify(ex, overrides, custom);
    ex.sets.forEach((s) => all.push({ ex, c, s }));
  });
  const slot = total / Math.max(all.length, 1);
  const active = Math.max(15, Math.min(50, Math.round(slot * 0.35)));

  const fitTime = (ms) => Utils.convertDateToDateTime(new Date(ms));
  const t0 = fitTime(startMs);
  const tEnd = t0 + total;
  const enc = new Encoder();
  const MN = Profile.MesgNum;

  enc.onMesg(MN.FILE_ID, {
    type: "activity", manufacturer: "development", product: 0,
    timeCreated: t0, serialNumber: 12345,
  });
  enc.onMesg(MN.DEVICE_INFO, {
    timestamp: t0, manufacturer: "development", product: 0, softwareVersion: 1.0, deviceIndex: "creator",
  });
  enc.onMesg(MN.EVENT, { timestamp: t0, event: "timer", eventType: "start" });

  let idx = 0;
  all.forEach((it, i) => {
    const sStart = t0 + Math.round(i * slot);
    const restStart = sStart + active;
    const nextStart = t0 + Math.round((i + 1) * slot);
    const catN = it.c.cat ? catNum(it.c.cat) : 65534;
    const nm = nameNum(it.c.cat, it.c.n);
    const setMsg = {
      timestamp: restStart, startTime: sStart, duration: active,
      setType: "active", repetitions: it.s.reps, messageIndex: idx++,
      category: [catN], weightDisplayUnit: "kilogram",
    };
    if (nm != null) setMsg.categorySubtype = [nm];
    if (it.s.kg) setMsg.weight = it.s.kg;
    enc.onMesg(MN.SET, setMsg);
    if (nextStart > restStart) {
      enc.onMesg(MN.SET, {
        timestamp: nextStart, startTime: restStart, duration: nextStart - restStart,
        setType: "rest", messageIndex: idx++,
      });
    }
  });

  // ein paar Records, damit die Aktivität eine Zeitachse hat
  for (let t = t0; t <= tEnd; t += 60) enc.onMesg(MN.RECORD, { timestamp: t });

  enc.onMesg(MN.EVENT, { timestamp: tEnd, event: "timer", eventType: "stopAll" });
  const common = {
    timestamp: tEnd, startTime: t0, totalElapsedTime: total, totalTimerTime: total,
    sport: "training", subSport: "strengthTraining",
  };
  enc.onMesg(MN.LAP, { ...common, messageIndex: 0, event: "lap", eventType: "stop" });
  enc.onMesg(MN.SESSION, {
    ...common, messageIndex: 0, firstLapIndex: 0, numLaps: 1, event: "session", eventType: "stop",
    trigger: "activityEnd",
  });
  enc.onMesg(MN.ACTIVITY, {
    timestamp: tEnd, numSessions: 1, type: "manual", event: "activity", eventType: "stop",
    totalTimerTime: total, localTimestamp: tEnd - new Date(startMs).getTimezoneOffset() * 60,
  });
  return enc.close();
}
