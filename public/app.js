const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const orb = $("orb");
const sessionId = crypto.randomUUID();
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
let busy = false;
let state = "idle";

// ---------- A spring drives the orb, so every state change starts from where it is ----------
// response = how quickly it settles (s), damping 1 = no overshoot, below 1 = bounce
const spring = { x: 1, v: 0, target: 1, response: 0.38, damping: 0.78, running: false, last: 0 };
function stepSpring(now) {
  const dt = Math.min((now - spring.last) / 1000, 0.032);
  spring.last = now;
  const w = (2 * Math.PI) / spring.response;
  const a = w * w * (spring.target - spring.x) - 2 * spring.damping * w * spring.v;
  spring.v += a * dt;
  spring.x += spring.v * dt;
  orb.style.setProperty("--s", spring.x.toFixed(4));
  if (Math.abs(spring.v) > 0.0008 || Math.abs(spring.target - spring.x) > 0.0006) requestAnimationFrame(stepSpring);
  else { spring.running = false; spring.x = spring.target; orb.style.setProperty("--s", spring.target); }
}
function kick(target, velocity = 0) {
  if (target != null) spring.target = target;
  spring.v += velocity;
  if (reduceMotion) { spring.x = spring.target; spring.v = 0; orb.style.setProperty("--s", spring.x); return; }
  if (!spring.running) { spring.running = true; spring.last = performance.now(); requestAnimationFrame(stepSpring); }
}
const restScale = { idle: 1, listening: 1.06, thinking: 0.95, speaking: 1.01 };

const LABELS = { idle: "Tap to talk", listening: "Listening", thinking: "Thinking", speaking: "Speaking" };
function setState(s) {
  state = s;
  orb.dataset.state = s;
  $("stateLabel").textContent = LABELS[s];
  $("stateLabel").classList.toggle("live", s !== "idle");
  kick(restScale[s], s === "listening" ? 0.6 : 0);
}

// Pressing feels instant: the orb gives under the finger before the tap completes
orb.addEventListener("pointerdown", () => kick(0.93));
orb.addEventListener("pointerup", () => kick(restScale[state]));
orb.addEventListener("pointerleave", () => kick(restScale[state]));

// ---------- Which engine is behind this? Say it honestly. ----------
fetch("/healthz")
  .then((r) => r.json())
  .then((h) => {
    const nice = (m) => (/nova-pro/.test(m) ? "Nova Pro" : /nova-lite/.test(m) ? "Nova Lite" : m.replace(/^us\./, ""));
    const text =
      h.llm === "bedrock" ? `Amazon Bedrock · ${nice(h.model)}`
      : h.llm === "mock" ? "Offline demo mode"
      : h.llm === "anthropic" ? "Claude API"
      : "OpenAI-compatible API";
    $("provider").innerHTML = `<span class="dot-live${h.llm === "mock" ? " off" : ""}"></span>&nbsp; ${esc(text)}`;
    $("modelBadge").textContent = h.llm === "bedrock" ? `Bedrock · ${nice(h.model)}` : text;
  })
  .catch(() => ($("provider").textContent = "Server unreachable"));

// ---------- Speech out ----------
let voice;
function pickVoice() {
  const voices = speechSynthesis.getVoices();
  voice =
    voices.find((v) => /en-IN/i.test(v.lang) && /female|heera|neerja/i.test(v.name)) ||
    voices.find((v) => /en-IN/i.test(v.lang)) ||
    voices.find((v) => /Google UK English Female|Samantha|Aria|Jenny|Libby/i.test(v.name)) ||
    voices.find((v) => /^en/i.test(v.lang));
}
const canSpeak = "speechSynthesis" in window;
if (canSpeak) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}

// Words light up as they're spoken, so you can follow along (and read it on video)
function renderWords(text) {
  const kin = $("kin");
  kin.classList.remove("plain");
  kin.innerHTML = "";
  const words = [];
  let offset = 0;
  for (const part of text.split(/(\s+)/)) {
    if (!part) continue;
    if (/^\s+$/.test(part)) { kin.append(" "); offset += part.length; continue; }
    const span = document.createElement("span");
    span.className = "w";
    span.textContent = part;
    span.dataset.start = offset;
    kin.append(span);
    words.push(span);
    offset += part.length;
  }
  return words;
}
function showPlain(text) {
  const kin = $("kin");
  kin.classList.add("plain");
  kin.textContent = text;
}

function speak(text) {
  return new Promise((resolve) => {
    const words = renderWords(text);
    const lightAll = () => words.forEach((w) => w.classList.add("on"));
    if (!canSpeak) { lightAll(); return resolve(); }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.rate = 0.96;
    let sawBoundary = false;
    const fallback = setTimeout(() => { if (!sawBoundary) lightAll(); }, 900);
    u.onboundary = (e) => {
      sawBoundary = true;
      let lit = 0;
      for (const w of words) if (Number(w.dataset.start) <= e.charIndex) { w.classList.add("on"); lit++; }
      kick(null, 0.7 + Math.min(lit, 3) * 0.05);   // a small pulse on every word
    };
    u.onend = u.onerror = () => { clearTimeout(fallback); lightAll(); resolve(); };
    setState("speaking");
    speechSynthesis.speak(u);
  });
}

// ---------- Speech in ----------
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
    else if (state === "listening") setState("idle");
    finalText = "";
  };
  recognizer.onerror = () => { if (state === "listening") setState("idle"); };
} else {
  $("hint").textContent = "Voice input needs Chrome or Edge. You can still type below.";
}

function listen() {
  if (busy) return;
  if (!recognizer) return $("text").focus();
  if (canSpeak) speechSynthesis.cancel();
  $("you").textContent = "";
  setState("listening");
  try { recognizer.start(); } catch { /* already listening */ }
}

// ---------- A turn ----------
let toastTimer;
function showToast(title, body) {
  $("toastTitle").textContent = title;
  $("toastBody").textContent = body;
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 7000);
}

async function send(text) {
  if (busy) return;
  busy = true;
  $("you").textContent = text;
  showPlain("");
  $("toast").classList.remove("show");
  document.body.classList.remove("is-alert");
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
    if (data.familyNotified) {
      document.body.classList.add("is-alert");
      showToast("Family notified", data.familyNotified.title);
    }
    busy = false;
    await speak(data.reply);
  } catch (err) {
    showPlain(`Sorry, something went wrong. (${err.message})`);
  } finally {
    busy = false;
    setState("idle");
  }
}

function renderTurn(text, data) {
  $("traceEmpty")?.remove();
  const el = document.createElement("div");
  el.className = "turn";
  const calls = data.tools
    .map((t) => {
      const args = Object.entries(t.input || {})
        .filter(([k]) => k !== "utterance")
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(", ");
      const notified = t.output && t.output.familyNotified;
      return `<div class="call${notified ? " escalate" : ""}"><span class="n">${esc(t.name)}</span><span class="a">${esc(args)}</span></div>${
        notified ? `<div class="call escalate"><span class="n">→ family notified</span><span class="a">${esc(t.output.familyNotified.title)}</span></div>` : ""
      }`;
    })
    .join("");
  el.innerHTML = `<div class="q">${esc(text)}</div>${calls}<div class="meta"><span>care level · ${esc(data.careLevel || "unknown")}</span><span>${data.ms} ms</span></div>`;
  $("turns").prepend(el);
}

// ---------- Reminders Kin speaks unprompted ----------
setInterval(async () => {
  if (busy || state !== "idle") return;
  try {
    const { reminders } = await (await fetch("/api/parent/due")).json();
    for (const r of reminders) {
      $("you").textContent = "";
      await speak(r);
      setState("idle");
    }
  } catch { /* server restarting */ }
}, 15000);

// ---------- Wiring ----------
orb.addEventListener("click", listen);
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && document.activeElement !== $("text")) { e.preventDefault(); listen(); }
  if (e.key === "Escape" && canSpeak) { speechSynthesis.cancel(); }
});
const form = $("composer");
$("text").addEventListener("input", () => form.classList.toggle("has-text", $("text").value.trim().length > 0));
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const t = $("text").value.trim();
  if (!t) return;
  $("text").value = "";
  form.classList.remove("has-text");
  send(t);
});
$("chips").addEventListener("click", (e) => {
  if (e.target.tagName === "BUTTON") send(e.target.textContent);
});

const traceBtn = $("traceBtn");
function setTrace(open) {
  document.body.classList.toggle("trace-open", open);
  traceBtn.setAttribute("aria-pressed", String(open));
}
traceBtn.addEventListener("click", () => setTrace(!document.body.classList.contains("trace-open")));
setTrace(innerWidth >= 1100);
setState("idle");
