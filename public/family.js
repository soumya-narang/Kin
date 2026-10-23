const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const sessionId = crypto.randomUUID();
const seenAlerts = new Set();
const seenMessages = new Set();
let firstLoad = true;
let lastKey = "";
let profileName = "";

const LEVEL = {
  ok: "All is well",
  watch: "Worth keeping an eye on",
  alert: "Worth a call today",
  urgent: "Needs attention now",
};
const MSG_LEVEL = { watch: "For your awareness", alert: "Worth a call", urgent: "Urgent" };
const CHECK = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7"/></svg>`;

const timeAgo = (iso) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
};
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const present = (xs) => xs.filter((x) => x != null);

async function load() {
  try {
    const res = await fetch("/api/family/overview");
    if (res.ok) render(await res.json());
  } catch { /* server restarting; the next poll will catch up */ }
}

function render(data) {
  const { generatedAt, ...insights } = data.insights;
  const key = JSON.stringify([data.profile, insights, data.alerts, data.recent, data.messages]) + Math.floor(Date.now() / 60000);
  if (key === lastKey) return;
  lastKey = key;

  const { profile: p, alerts, recent, messages = [] } = data;
  profileName = p.preferredName;
  document.title = `${p.preferredName} · Kin`;

  renderHero(p, insights);
  renderFindings(insights);
  renderTimeline(p, insights.days);
  renderVitals(insights.days);
  renderAlerts(alerts);
  renderAdherence(insights.adherence);
  renderDay(p, recent);
  renderThread(p, messages, alerts);

  $("speakerLink").textContent = `Open ${p.preferredName}'s speaker`;
  $("askLede").textContent = `Ask about ${p.preferredName} in your own words.`;
  $("askText").placeholder = `How has ${p.preferredName} been sleeping?`;
  $("dayTitle").textContent = `${p.preferredName}'s day`;
  $("convTitle").textContent = `Messages with ${p.preferredName}`;
  $("convLede").textContent = `Kin reads your messages aloud on ${p.preferredName}'s speaker at a quiet moment, and passes on what ${p.preferredName} says back.`;
  $("composeText").placeholder = `Write to ${p.preferredName}…`;
  if (!$("sugg").children.length) {
    $("sugg").innerHTML = [`How has ${p.preferredName} been sleeping?`, `Did ${p.preferredName} take today's tablets?`, "Is there anything I should worry about?"]
      .map((q) => `<button type="button">${esc(q)}</button>`)
      .join("");
  }

  if (firstLoad) {
    firstLoad = false;
    setTimeout(() => document.body.classList.remove("first"), 1600);
  }
}

function renderHero(p, i) {
  const n = i.findings.length;
  const bits = [];
  if (n) bits.push(`${n} ${n === 1 ? "thing" : "things"} Kin noticed this week`);
  bits.push(i.checkedInToday ? `${p.preferredName} has checked in today` : `No check-in from ${p.preferredName} yet today`);
  $("hero").dataset.level = i.level;
  $("hero").innerHTML = `
    <div class="who">${esc(p.preferredName)}${p.age ? `, ${p.age}` : ""}${p.city ? ` · ${esc(p.city)}` : ""}</div>
    <div class="state"><span class="dot-live"></span>${LEVEL[i.level]}</div>
    <h1 class="headline">${esc(i.headline)}</h1>
    <p class="sub">${bits.join(" · ")}</p>`;
}

function renderFindings(i) {
  $("findings").innerHTML = i.findings.length
    ? i.findings
        .map((f) => `<div class="find ${f.level}"><span class="mark-dot"></span><div><div class="t">${esc(f.title)}</div><div class="d">${esc(f.detail)}</div></div></div>`)
        .join("")
    : `<p class="empty">Nothing unusual. Kin is keeping an eye on things.</p>`;
}

function renderAlerts(alerts) {
  $("alerts").innerHTML = alerts.length
    ? alerts
        .map((a) => {
          const fresh = !firstLoad && !seenAlerts.has(a.id);
          return `<article class="msg${fresh ? " fresh" : ""}">
            <div class="top"><span class="lvl ${a.level}">${MSG_LEVEL[a.level] || a.level}</span><span>${timeAgo(a.ts)} · ${a.channel === "sns" ? "Sent by text or email" : "Shown here"}</span></div>
            <h3>${esc(a.title)}</h3>
            <p>${esc(a.message)}</p>
            ${a.reasons.length ? `<ul>${a.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
            <div class="foot">${a.acknowledged ? `<span class="done">${CHECK}You are on it</span>` : `<button class="btn" data-ack="${esc(a.id)}">I'll call them</button>`}<button class="btn soft" data-reply>Send a message</button></div>
          </article>`;
        })
        .join("")
    : `<p class="empty">Nothing to report. Kin will message you if a pattern needs your attention.</p>`;

  const fresh = alerts.filter((a) => !seenAlerts.has(a.id));
  if (!firstLoad && fresh.length) announce(fresh[0]);
  alerts.forEach((a) => seenAlerts.add(a.id));
}

function renderTimeline(profile, days) {
  const cells = (fn) => days.map(fn).join("");
  const head = cells((d, i) => {
    const dt = new Date(`${d.date}T12:00:00`);
    return `<div class="day${i === days.length - 1 ? " today" : ""}"><b>${dt.toLocaleDateString([], { weekday: "narrow" })}</b>${dt.getDate()}</div>`;
  });
  const meds = profile.medications
    .map(
      (m) =>
        `<div class="lab">${esc(m.name)}</div>${cells((d) => {
          const s = d.meds[m.name] || "pending";
          return `<div class="cell"><i class="pip ${s}" title="${esc(m.name)}, ${d.date}: ${s}"></i></div>`;
        })}`,
    )
    .join("");
  const sym = `<div class="lab">Symptoms</div>${cells((d) =>
    d.symptoms.length
      ? `<div class="cell"><i class="pip sym" title="${esc(d.symptoms.join(", "))}"></i></div>`
      : `<div class="cell"><i class="pip pending"></i></div>`,
  )}`;
  $("timeline").innerHTML = `<div></div>${head}${meds}<div class="rule"></div>${sym}`;
}

// ---- mood and sleep ----

function smooth(pts) {
  if (pts.length < 2) return `M${pts[0][0]},${pts[0][1]}`;
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

function spark(values, [lo, hi], color) {
  const W = 300, H = 64, pad = 6;
  const x = (i) => (i / (values.length - 1)) * W;
  const y = (v) => H - pad - ((Math.min(Math.max(v, lo), hi) - lo) / (hi - lo)) * (H - pad * 2);
  const segs = [];
  let cur = [];
  values.forEach((v, i) => {
    if (v == null) { if (cur.length) segs.push(cur), (cur = []); } else cur.push([x(i), y(v)]);
  });
  if (cur.length) segs.push(cur);
  const paths = segs
    .filter((s) => s.length > 1)
    .map((s) => `<path class="area" d="${smooth(s)} L${s.at(-1)[0]},${H} L${s[0][0]},${H}Z"/><path class="line" d="${smooth(s)}"/>`)
    .join("");
  const lastIdx = values.map((v) => v != null).lastIndexOf(true);
  const dot = lastIdx >= 0 ? `<i style="left:${(x(lastIdx) / W) * 100}%;top:${(y(values[lastIdx]) / H) * 100}%"></i>` : "";
  return `<div class="spark" style="--c:${color}"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${paths}</svg>${dot}</div>`;
}

function renderVitals(days) {
  const series = (key) => days.map((d) => d[key] ?? null);
  const compare = (key, unit, step, fmt) => {
    const recent = avg(present(days.slice(-3).map((d) => d[key])));
    const before = avg(present(days.slice(-10, -3).map((d) => d[key])));
    if (recent == null) return { value: "–", note: "Nothing logged yet" };
    if (before == null) return { value: fmt(recent), note: "Not enough history yet" };
    const diff = recent - before;
    const note = Math.abs(diff) < step ? "Steady compared with the week before" : `${diff < 0 ? "Lower" : "Higher"} than the week before (${fmt(before)}${unit})`;
    return { value: fmt(recent), note, down: diff <= -step };
  };
  const mood = compare("mood", "", 0.5, (v) => v.toFixed(1));
  const sleep = compare("sleepHours", " h", 0.75, (v) => v.toFixed(1));
  const tone = (m) => (m.down ? "var(--alert)" : "var(--accent)");
  $("vitals").innerHTML = `
    <div class="metric"><div class="k">Mood</div><div class="v">${mood.value}<small>/ 5</small></div><div class="n">${mood.note}</div>${spark(series("mood"), [1, 5], tone(mood))}</div>
    <div class="metric"><div class="k">Sleep</div><div class="v">${sleep.value}<small>hours</small></div><div class="n">${sleep.note}</div>${spark(series("sleepHours"), [3, 9], tone(sleep))}</div>`;
}

function renderAdherence(list) {
  $("adherence").innerHTML = list
    .map((a) => {
      const pct = a.due ? Math.round((a.taken / a.due) * 100) : 100;
      return `<div class="med"><div class="row"><span><span class="name">${esc(a.medication)}</span><span class="for">${esc(a.purpose)}</span></span><span class="num">${a.taken} of ${a.due}</span></div>
        <div class="track"><i class="${pct < 80 ? "low" : ""}" style="width:${pct}%"></i></div></div>`;
    })
    .join("");
}

// ---- their day, as a story rather than a chart ----

const fmtHours = (h) => `${Number.isInteger(h) ? h : h.toFixed(1)} ${h === 1 ? "hour" : "hours"}`;
function describe(l) {
  switch (l.kind) {
    case "medication":
      return l.taken === false ? [`Skipped ${l.medication}`, "low"] : [`Took ${l.medication}`, "good"];
    case "symptom":
      return [`Mentioned ${l.symptom}${(l.severity ?? 0) >= 4 ? ", quite badly" : ""}`, "care"];
    case "mood":
      return l.mood <= 2 ? ["Feeling low", "low"] : l.mood >= 4 ? ["In good spirits", "good"] : ["Feeling okay", ""];
    case "sleep":
      return [`Slept about ${fmtHours(l.sleepHours)}`, l.sleepHours < 6 ? "low" : ""];
    default:
      return [l.text || "Shared a note", ""];
  }
}

function renderDay(p, recent) {
  const dayOf = (iso) => new Date(iso).toDateString();
  const latest = recent[0] && dayOf(recent[0].ts);
  const entries = recent.filter((l) => latest && dayOf(l.ts) === latest).reverse();
  if (!entries.length) {
    $("dayLede").textContent = "Nothing heard in the last few days.";
    $("day").innerHTML = "";
    return;
  }
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  $("dayLede").textContent =
    latest === today ? "Today, in order." : latest === yesterday ? "Yesterday. Nothing yet today." : new Date(recent[0].ts).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
  $("day").innerHTML = entries
    .map((l) => {
      const [what, tone] = describe(l);
      const time = new Date(l.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      return `<li class="${tone}"><time>${time}</time><div><b>${esc(what)}</b>${l.utterance ? `<q>“${esc(l.utterance)}”</q>` : ""}</div></li>`;
    })
    .join("");
}

// ---- messages both ways ----

let threadKey = "";
function renderThread(p, messages, alerts) {
  const key = JSON.stringify(messages);
  if (key !== threadKey) {
    const fresh = !firstLoad;
    $("thread").innerHTML = messages.length
      ? messages
          .map((m) => {
            const isNew = fresh && !seenMessages.has(m.id);
            const when = timeAgo(m.ts);
            const meta =
              m.from === "family"
                ? `${esc(m.author)} · ${when} · ${m.deliveredAt ? `<span class="heard">Read aloud to ${esc(p.preferredName)}</span>` : "Waiting for a quiet moment"}`
                : `${esc(m.author)} · ${when}${m.channel === "sns" ? " · Also sent to you by text" : ""}`;
            return `<div class="b ${m.from === "family" ? "out" : "in"}${isNew ? " new" : ""}"><p>${esc(m.text)}</p><div class="meta">${meta}</div></div>`;
          })
          .join("")
      : `<p class="empty">No messages yet. Anything you write here, Kin reads aloud to ${esc(p.preferredName)}.</p>`;
    $("thread").scrollTop = $("thread").scrollHeight;
    if (fresh) {
      const reply = messages.find((m) => m.from === "parent" && !seenMessages.has(m.id));
      if (reply) announce({ title: `${reply.author} sent you a message`, reasons: [reply.text], message: reply.text });
    }
    messages.forEach((m) => seenMessages.add(m.id));
    threadKey = key;
  }

  const worried = alerts.some((a) => !a.acknowledged);
  const quick = worried
    ? ["I'll call you this evening.", "Please sit down and have some water. I'll call you soon."]
    : ["Thinking of you today.", "I'll call you this evening."];
  const html = quick.map((q) => `<button type="button">${esc(q)}</button>`).join("");
  if ($("quick").innerHTML !== html) $("quick").innerHTML = html;
}

async function sendMessage(text) {
  const btn = $("compose").querySelector(".go");
  btn.disabled = true;
  try {
    const res = await fetch("/api/family/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    $("composeText").value = "";
    lastKey = "";
    await load();
  } catch (err) {
    $("composeText").value = text;
    announce({ title: "Message not sent", reasons: [err.message || "Please try again."], message: "" });
  } finally {
    btn.disabled = false;
  }
}
$("compose").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("composeText").value.trim();
  if (text) sendMessage(text);
});
$("quick").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  $("composeText").value = b.textContent;
  $("composeText").focus();
});

function focusComposer() {
  const card = $("convCard");
  card.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
  card.classList.remove("flash");
  void card.offsetWidth;
  card.classList.add("flash");
  setTimeout(() => $("composeText").focus({ preventScroll: true }), 350);
}

// Speak a message instead of typing it
(() => {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return;
  const mic = $("mic");
  mic.hidden = false;
  const r = new Recognition();
  r.lang = "en-IN";
  r.interimResults = true;
  let base = "";
  r.onresult = (e) => {
    $("composeText").value = (base + " " + Array.from(e.results).map((x) => x[0].transcript).join("")).trim();
  };
  r.onend = r.onerror = () => {
    mic.classList.remove("on");
    mic.setAttribute("aria-label", "Speak your message");
  };
  mic.addEventListener("click", () => {
    if (mic.classList.contains("on")) return r.stop();
    base = $("composeText").value.trim();
    mic.classList.add("on");
    mic.setAttribute("aria-label", "Stop dictating");
    try { r.start(); } catch { /* already listening */ }
  });
})();

// ---- alerts: toast and system notification ----

let toastTimer;
function announce(alert) {
  $("toastTitle").textContent = alert.title;
  $("toastBody").textContent = alert.reasons[0] || alert.message;
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 7000);
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(`Kin: ${alert.title}`, { body: alert.reasons[0] || alert.message });
  }
}
$("toast").addEventListener("click", () => $("toast").classList.remove("show"));

$("alerts").addEventListener("click", async (e) => {
  if (e.target.closest("[data-reply]")) return focusComposer();
  const btn = e.target.closest("[data-ack]");
  if (!btn) return;
  btn.disabled = true;
  await fetch(`/api/family/alerts/${btn.dataset.ack}/ack`, { method: "POST" });
  lastKey = "";
  load();
});

// ---- ask Kin and the daily summary ----

function reveal(el, text, waiting = false) {
  el.textContent = text;
  el.classList.toggle("wait", waiting);
  el.classList.remove("rise");
  void el.offsetWidth;
  el.classList.add("rise");
}

async function ask(text) {
  reveal($("answer"), "Kin is thinking…", true);
  try {
    const res = await fetch("/api/talk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, sessionId, speaker: "family" }),
    });
    const data = await res.json();
    reveal($("answer"), data.reply || "Sorry, I couldn't answer that just now.");
  } catch {
    reveal($("answer"), "Sorry, I couldn't reach Kin just now.");
  }
}
$("ask").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("askText").value.trim();
  if (!text) return;
  $("askText").value = "";
  ask(text);
});
$("sugg").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b) ask(b.textContent);
});

$("digestBtn").addEventListener("click", async () => {
  const btn = $("digestBtn");
  btn.disabled = true;
  btn.textContent = "Writing…";
  try {
    const data = await (await fetch("/api/family/digest")).json();
    reveal($("digest"), data.digest || "Sorry, the summary isn't available right now.");
  } catch {
    reveal($("digest"), "Sorry, the summary isn't available right now.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Write it again";
  }
});

// ---- demo tools ----

$("checkin").addEventListener("click", async () => {
  const btn = $("checkin");
  const res = await fetch("/api/demo/checkin", { method: "POST" });
  btn.textContent = res.ok ? "Kin will check in on the speaker" : "Demo tools are off here";
  setTimeout(() => (btn.textContent = "Have Kin check in now"), 3500);
});

// Reset takes two taps instead of a modal dialog

let resetArmed;
$("reset").addEventListener("click", async () => {
  const btn = $("reset");
  if (!resetArmed) {
    btn.textContent = "Tap again to reload the history";
    resetArmed = setTimeout(() => {
      resetArmed = null;
      btn.textContent = "Reset demo history";
    }, 3500);
    return;
  }
  clearTimeout(resetArmed);
  resetArmed = null;
  btn.textContent = "Reset demo history";
  const res = await fetch("/api/demo/reset", { method: "POST" });
  if (!res.ok) return reveal($("answer"), (await res.json().catch(() => ({}))).error || "Reset failed.");
  seenAlerts.clear();
  seenMessages.clear();
  threadKey = "";
  firstLoad = true;
  lastKey = "";
  $("digest").textContent = "";
  $("answer").textContent = "";
  load();
});

if ("Notification" in window && Notification.permission === "default") {
  document.addEventListener("click", () => Notification.requestPermission(), { once: true });
}

load();
setInterval(load, 4000);
