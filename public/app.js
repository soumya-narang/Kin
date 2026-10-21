const $ = (id) => document.getElementById(id);
const orb = $("orb");
const sessionId = crypto.randomUUID();
let busy = false;

// ---------- speech out ----------
let voice;
function pickVoice() {
  const voices = speechSynthesis.getVoices();
  voice =
    voices.find((v) => /en-IN/i.test(v.lang) && /female|heera|neerja/i.test(v.name)) ||
    voices.find((v) => /en-IN/i.test(v.lang)) ||
    voices.find((v) => /Google UK English Female|Samantha|Aria|Jenny|Libby/i.test(v.name)) ||
    voices.find((v) => /^en/i.test(v.lang));
}
if ("speechSynthesis" in window) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}

function speak(text) {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) return resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.rate = 0.95;
    u.onend = u.onerror = () => resolve();
    setState("speaking");
    speechSynthesis.speak(u);
  });
}

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
    $("you").textContent = `“${finalText}”`;
  };
  recognizer.onend = () => {
    if (finalText.trim()) send(finalText.trim());
    else setState("idle");
    finalText = "";
  };
  recognizer.onerror = () => setState("idle");
} else {
  $("hint").textContent = "Voice input needs Chrome or Edge. You can still type.";
}

function listen() {
  if (busy) return;
  if (!recognizer) return $("text").focus();
  speechSynthesis.cancel();
  $("you").textContent = "";
  setState("listening");
  try { recognizer.start(); } catch { /* already listening */ }
}

// ---------- state ----------
function setState(s) {
  orb.classList.remove("listening", "thinking", "speaking");
  if (s !== "idle") orb.classList.add(s);
  $("orbLabel").textContent = { idle: "Tap to talk", listening: "Listening", thinking: "", speaking: "" }[s] ?? "";
}

async function send(text) {
  if (busy) return;
  busy = true;
  $("you").textContent = `“${text}”`;
  $("kin").textContent = "";
  $("notified").classList.remove("show");
  orb.classList.remove("alerting");
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
    $("kin").textContent = data.reply;
    if (data.familyNotified) {
      orb.classList.add("alerting");
      $("notified").innerHTML = `<span>🔔</span><span>Family notified: <b>${esc(data.familyNotified.title)}</b></span>`;
      $("notified").classList.add("show");
    }
    busy = false;
    await speak(data.reply);
  } catch (err) {
    $("kin").textContent = `Sorry, something went wrong. (${err.message})`;
  } finally {
    busy = false;
    setState("idle");
  }
}

function renderTurn(text, data) {
  const el = document.createElement("div");
  el.className = "turn";
  const calls = data.tools
    .map((t) => {
      const args = Object.entries(t.input || {})
        .filter(([k]) => k !== "utterance")
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(", ");
      const esc8 = t.output && t.output.familyNotified;
      return `<div class="call${esc8 ? " escalate" : ""}"><b>${esc(t.name)}</b>(<span class="args">${esc(args)}</span>)${
        esc8 ? `<br>→ family notified: ${esc(t.output.familyNotified.title)}` : ""
      }</div>`;
    })
    .join("");
  el.innerHTML = `<div class="q">“${esc(text)}”</div>${calls}<div class="meta">care level: ${esc(data.careLevel || "?")} · ${data.ms} ms</div>`;
  $("turns").prepend(el);
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ---------- proactive reminders ----------
setInterval(async () => {
  if (busy) return;
  try {
    const { reminders } = await (await fetch("/api/parent/due")).json();
    for (const r of reminders) {
      $("you").textContent = "";
      $("kin").textContent = r;
      await speak(r);
      setState("idle");
    }
  } catch { /* server restarting */ }
}, 15000);

// ---------- wiring ----------
orb.addEventListener("click", listen);
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && document.activeElement !== $("text")) {
    e.preventDefault();
    listen();
  }
});
$("composer").addEventListener("submit", (e) => {
  e.preventDefault();
  const t = $("text").value.trim();
  if (!t) return;
  $("text").value = "";
  send(t);
});
$("chips").addEventListener("click", (e) => {
  if (e.target.tagName === "BUTTON") send(e.target.textContent);
});
