const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const orb = $("orb");
const sessionId = crypto.randomUUID();
let busy = false;
let turnCount = 0;

// ---------- small helpers ----------

/** Cross-fades a text change so captions never pop. */
function setText(el, text) {
  if (el.textContent === text) return;
  clearTimeout(el._t);
  el.classList.add("out");
  el._t = setTimeout(() => {
    el.textContent = text;
    el.classList.remove("out");
  }, el.textContent ? 180 : 0);
  if (!el.textContent) {
    el.textContent = text;
    el.classList.remove("out");
  }
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Hello" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function tick() {
  const now = new Date();
  $("clock").textContent = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  $("date").textContent = now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
}
tick();
setInterval(tick, 15000);

fetch("/api/family/overview")
  .then((r) => (r.ok ? r.json() : null))
  .then((d) => {
    const name = d?.profile?.preferredName;
    if (!busy) setText($("kin"), `${greeting()}${name ? `, ${name}` : ""}. Tap the light and tell me how you are.`);
  })
  .catch(() => setText($("kin"), `${greeting()}. Tap the light and tell me how you are.`));
setText($("kin"), `${greeting()}. Tap the light and tell me how you are.`);

// ---------- speech out ----------
// Voices vary a lot by browser. Neural voices ("Natural", "Online", Google's) sound human at a normal
// pace; the older local ones sound slow and flat. Prefer neural, and Indian English when there is one.
const PACES = [
  { label: "Slower", rate: 0.88 },
  { label: "Natural", rate: 1.04 },
  { label: "Faster", rate: 1.18 },
];
let pace = 1;
try {
  const saved = localStorage.getItem("kin.pace");
  if (saved !== null && PACES[Number(saved)]) pace = Number(saved);
} catch { /* storage unavailable; use the default */ }

let voice;
function scoreVoice(v) {
  let score;
  if (/^en[-_]IN/i.test(v.lang)) score = 4;
  else if (/^en[-_](GB|AU|IE)/i.test(v.lang)) score = 2;
  else if (/^en/i.test(v.lang)) score = 1;
  else return -1;
  if (/natural|neural|online/i.test(v.name)) score += 6;
  else if (/^google/i.test(v.name)) score += 3;
  if (/female|heera|neerja|veena|sonia|libby|aria|jenny|samantha/i.test(v.name)) score += 1;
  return score;
}
function pickVoice() {
  voice = speechSynthesis
    .getVoices()
    .map((v) => [scoreVoice(v), v])
    .filter(([score]) => score >= 0)
    .sort((a, b) => b[0] - a[0])[0]?.[1];
}
if ("speechSynthesis" in window) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}

/** Splits on sentence ends only, so "2.5" and "Dr. Rao" stay whole. */
const sentences = (text) => text.split(/(?<=[.!?])(?<!\b(?:Dr|Mr|Mrs|Ms|St)\.)\s+(?=[A-Z0-9"'“])/).map((t) => t.trim()).filter(Boolean);

let speechRun = 0;
function stopSpeaking() {
  speechRun++;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}

/** Speaks one sentence at a time with a short breath between, which reads clearly without slowing every word. */
function speak(text) {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window) || !text) return resolve();
    stopSpeaking();
    const run = speechRun;
    const parts = sentences(text);
    setState("speaking");
    const next = (i) => {
      if (run !== speechRun || i >= parts.length) return resolve();
      const u = new SpeechSynthesisUtterance(parts[i]);
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      }
      u.rate = PACES[pace].rate;
      u.onend = () => setTimeout(() => next(i + 1), 160);
      u.onerror = () => resolve();
      speechSynthesis.speak(u);
    };
    // Chrome can drop an utterance queued in the same tick as cancel()
    setTimeout(() => next(0), 40);
  });
}

function showPace() {
  $("paceLabel").textContent = `${PACES[pace].label} pace`;
  $("paceBtn").setAttribute("aria-label", `Speaking pace: ${PACES[pace].label}`);
}
showPace();
$("paceBtn").addEventListener("click", () => {
  pace = (pace + 1) % PACES.length;
  try { localStorage.setItem("kin.pace", String(pace)); } catch { /* not saved; still applies now */ }
  showPace();
  if (!busy) speak("This is how I'll sound.").then(() => setState("idle"));
});

// ---------- speech in ----------
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer;
if (Recognition) {
  recognizer = new Recognition();
  recognizer.lang = "en-IN";
  recognizer.interimResults = true;
  recognizer.continuous = false;
  let finalText = "";
  recognizer.onresult = (e) => {
    finalText = Array.from(e.results).map((r) => r[0].transcript).join("");
    $("you").textContent = finalText;
  };
  recognizer.onend = () => {
    if (finalText.trim()) send(finalText.trim());
    else setState("idle");
    finalText = "";
  };
  recognizer.onerror = () => setState("idle");
} else {
  $("hint").textContent = "Voice needs Chrome or Edge. You can type instead.";
  openComposer(true, false);
}

function listen() {
  if (busy) return;
  if (!recognizer) return openComposer(true);
  stopSpeaking();
  setText($("you"), "");
  setState("listening");
  try { recognizer.start(); } catch { /* already listening */ }
}

// ---------- state ----------
const STATUS = { idle: "Tap to talk", listening: "Listening", thinking: "Thinking", speaking: "" };
function setState(s) {
  orb.classList.remove("listening", "thinking", "speaking");
  if (s !== "idle") orb.classList.add(s);
  setText($("status"), STATUS[s] ?? "");
}

async function send(text) {
  if (busy) return;
  busy = true;
  setText($("you"), text);
  setText($("kin"), "");
  $("notified").classList.remove("show");
  document.body.classList.remove("alerting");
  setState("thinking");
  try {
    const res = await fetch("/api/talk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, sessionId, speaker: "parent" }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    renderTurn(text, data);
    setText($("kin"), data.reply);
    if (data.familyNotified) {
      document.body.classList.add("alerting");
      $("notifiedText").textContent = `Your family has been told: ${data.familyNotified.title}`;
      $("notified").classList.add("show");
    }
    busy = false;
    await speak(data.reply);
  } catch (err) {
    setText($("kin"), "Sorry, I couldn't reach Kin just now. Please try again.");
    console.error(err);
  } finally {
    busy = false;
    setState("idle");
  }
}

// ---------- behind the scenes ----------
function renderTurn(text, data) {
  $("emptyTurns")?.remove();
  const el = document.createElement("div");
  el.className = "turn";
  const calls = data.tools
    .map((t) => {
      const args = Object.entries(t.input || {})
        .filter(([k]) => k !== "utterance")
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(", ");
      const notified = t.output && t.output.familyNotified;
      return `<div class="call${notified ? " escalate" : ""}"><b>${esc(t.name)}</b>(${esc(args)})${
        notified ? `<br>family notified: ${esc(t.output.familyNotified.title)}` : ""
      }</div>`;
    })
    .join("");
  el.innerHTML = `<div class="q">${esc(text)}</div>${calls}<div class="meta">Care level ${esc(data.careLevel || "unknown")} · ${data.ms} ms</div>`;
  $("turns").prepend(el);
  const count = $("count");
  count.textContent = ++turnCount;
  count.classList.add("show");
}

const sheet = $("sheet");
function setSheet(open) {
  sheet.classList.toggle("open", open);
  sheet.toggleAttribute("inert", !open);
  sheet.setAttribute("aria-hidden", String(!open));
  $("traceBtn").setAttribute("aria-expanded", String(open));
}
$("traceBtn").addEventListener("click", () => setSheet(!sheet.classList.contains("open")));
$("closeSheet").addEventListener("click", () => setSheet(false));
document.addEventListener("keydown", (e) => e.key === "Escape" && setSheet(false));

// Drag the sheet away: it tracks the pointer 1:1, then a flick is projected forward to decide.
(() => {
  let start, startX, dx, samples, active;
  const project = (v, rate = 0.998) => ((v / 1000) * rate) / (1 - rate);
  sheet.addEventListener("pointerdown", (e) => {
    if (!sheet.classList.contains("open") || e.target.closest("button, a, input")) return;
    start = { x: e.clientX, y: e.clientY };
    startX = e.clientX;
    dx = 0;
    active = false;
    samples = [{ x: e.clientX, t: e.timeStamp }];
  });
  sheet.addEventListener("pointermove", (e) => {
    if (!start) return;
    if (!active) {
      const mx = e.clientX - start.x, my = e.clientY - start.y;
      if (Math.abs(mx) < 10 && Math.abs(my) < 10) return;
      if (Math.abs(my) > Math.abs(mx)) return void (start = null);
      active = true;
      sheet.setPointerCapture(e.pointerId);
      sheet.classList.add("dragging");
    }
    const raw = e.clientX - startX;
    // Pulling toward the screen is resisted; pulling away follows the finger exactly
    dx = raw < 0 ? raw * 0.15 : raw;
    sheet.style.transform = `translateX(${dx}px)`;
    samples.push({ x: e.clientX, t: e.timeStamp });
    if (samples.length > 6) samples.shift();
  });
  const end = () => {
    if (!start) return;
    const wasActive = active;
    start = null;
    if (!wasActive) return;
    const a = samples[0], b = samples.at(-1);
    const v = b.t > a.t ? ((b.x - a.x) / (b.t - a.t)) * 1000 : 0;
    const close = dx + project(v) > sheet.offsetWidth * 0.4;
    sheet.classList.remove("dragging");
    sheet.style.transform = "";
    setSheet(!close);
  };
  sheet.addEventListener("pointerup", end);
  sheet.addEventListener("pointercancel", end);
})();

// ---------- typing instead ----------
function openComposer(open, focus = true) {
  $("composer").classList.toggle("open", open);
  $("typeBtn").setAttribute("aria-expanded", String(open));
  $("text").tabIndex = open ? 0 : -1;
  if (open && focus) setTimeout(() => $("text").focus(), 120);
}
$("typeBtn").addEventListener("click", () => openComposer(!$("composer").classList.contains("open")));
$("composerForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const t = $("text").value.trim();
  if (!t) return;
  $("text").value = "";
  send(t);
});

// ---------- proactive reminders ----------
setInterval(async () => {
  if (busy) return;
  try {
    const { reminders } = await (await fetch("/api/parent/due")).json();
    for (const r of reminders) {
      setText($("you"), "");
      setText($("kin"), r);
      await speak(r);
      setState("idle");
    }
  } catch { /* server restarting */ }
}, 15000);

// ---------- wiring ----------
orb.addEventListener("click", listen);
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && !e.target.closest("input, button, a")) {
    e.preventDefault();
    listen();
  }
});
$("chips").addEventListener("click", (e) => {
  if (e.target.tagName === "BUTTON") send(e.target.textContent);
});
