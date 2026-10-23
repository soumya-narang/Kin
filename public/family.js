const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const sessionId = crypto.randomUUID();
const seenAlerts = new Set();
let firstLoad = true;
let lastKey = "";
let lastData = null;

const timeAgo = (iso) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
};
const dayLabel = (key) => new Date(`${key}T12:00:00`);

const ICON = {
  pill: '<path d="M10.5 20.5a5 5 0 0 1-7-7l7-7a5 5 0 0 1 7 7zM8.5 8.5l7 7"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9.5h.01M15 9.5h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  warn: '<path d="M12 3 2 20h20zM12 10v4M12 17.5h.01"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
};
const svg = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;
const iconFor = (code) =>
  code.startsWith("pattern") ? "link" : code.startsWith("med") ? "pill" : code.startsWith("symptom") || code.startsWith("severe") ? "bolt"
  : code.startsWith("sleep") ? "moon" : code.startsWith("mood") ? "smile" : code.startsWith("quiet") ? "clock" : "warn";

const STATUS = { ok: "All good", watch: "Keep an eye on this", alert: "Worth a call", urgent: "Act now" };

async function load() {
  try {
    const res = await fetch("/api/family/overview");
    if (!res.ok) return;
    const data = await res.json();
    const key = JSON.stringify({ p: data.profile, f: data.insights.findings, a: data.insights.adherence, d: data.insights.days, c: data.insights.checkedInToday, al: data.alerts, r: data.recent.map((x) => x.id) });
    if (key === lastKey) return;       // nothing changed: leave the page alone, don't replay animations
    lastKey = key;
    lastData = data;
    render(data);
  } catch { /* server restarting */ }
}

function render({ profile: p, insights, alerts, recent }) {
  const initials = p.parentName.split(/\s+/).map((w) => w[0]).slice(0, 2).join("");
  $("avatar").textContent = initials;
  $("name").textContent = p.parentName;
  const rel = p.family[0];
  $("who").textContent = `${p.age} · ${p.city}${rel ? ` · viewing as ${rel.name}, ${rel.relation}` : ""}`;
  document.title = `${p.preferredName} · Kin`;
  $("askText").placeholder = `How has ${p.preferredName} been sleeping this week?`;

  // Hero
  const hero = $("hero");
  hero.className = `card hero s12 lvl-${insights.level}`;
  const top = insights.findings[0];
  hero.innerHTML = `
    <div class="hero-top"><span class="pill lvl-${insights.level}">${STATUS[insights.level]}</span></div>
    <h2 class="headline">${esc(insights.headline)}</h2>
    <p class="sub">${esc(insights.level === "ok" ? "Nothing unusual this week. Kin keeps an eye on things so you don't have to." : top.detail)}</p>
    <div class="hero-meta">
      <span class="meta-chip">${insights.checkedInToday ? `${esc(p.preferredName)} has checked in today` : `No check-in from ${esc(p.preferredName)} yet today`}</span>
      <span class="meta-chip">${esc(p.conditions.join(" · "))}</span>
    </div>`;

  // Alerts, styled like notifications
  const open = alerts.filter((a) => !a.acknowledged).length;
  $("alertCount").textContent = alerts.length ? (open ? `${open} to act on` : "all handled") : "";
  $("alerts").innerHTML = alerts.length
    ? alerts.map((a) => {
        const isNew = !firstLoad && !seenAlerts.has(a.id);
        return `<div class="notif${a.acknowledged ? "" : " open"}${isNew ? " enter" : ""}">
          <div class="app-badge" aria-hidden="true">K</div>
          <div class="notif-body">
            <div class="notif-top"><b>Kin</b><span>${timeAgo(a.ts)}</span></div>
            <div class="notif-title">${esc(a.title)}</div>
            <div class="notif-msg">${esc(a.message)}</div>
            ${a.reasons.length ? `<ul>${a.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
            <div class="row">
              ${a.acknowledged ? `<span>✓ Acknowledged</span>` : `<button class="btn primary tiny press" data-ack="${a.id}">I'll call ${esc(p.preferredName)}</button>`}
              <span>${a.channel === "sns" ? "Emailed via Amazon SNS" : "Dashboard only"}</span>
            </div>
          </div>
        </div>`;
      }).join("")
    : `<div class="empty"><b>No alerts.</b> Kin will tell you here, and by email, if a pattern needs a call.</div>`;
  const fresh = alerts.filter((a) => !seenAlerts.has(a.id));
  if (!firstLoad && fresh.length) announce(fresh[0]);
  alerts.forEach((a) => seenAlerts.add(a.id));

  // Findings
  $("findings").innerHTML = insights.findings.length
    ? insights.findings.map((f) => `<div class="insight lvl-${f.level}"><div class="glyph">${svg(iconFor(f.code))}</div><div><div class="t">${esc(f.title)}</div><div class="d">${esc(f.detail)}</div></div></div>`).join("")
    : `<div class="empty"><b>Nothing to report.</b> Medicines, mood and sleep all look steady.</div>`;

  renderTimeline(p, insights.days);
  renderChart(insights.days);
  renderRings(insights.adherence);

  // Their own words
  const quotes = recent.filter((l) => l.utterance).slice(0, 8);
  $("quotes").innerHTML = quotes.length
    ? quotes.map((l) => `<div class="say"><div class="bubble kin">${esc(l.utterance)}</div><div class="when">${timeAgo(l.ts)} · ${esc(l.kind)}</div></div>`).join("")
    : `<div class="empty">Nothing yet today.</div>`;
  firstLoad = false;
}

// ---------- Timeline ----------
const moodColor = (m) => `hsl(${Math.round(((m - 1) / 4) * 120)} 68% 50%)`;
function renderTimeline(profile, days) {
  const today = days.at(-1)?.date;
  let h = `<span></span>` + days.map((d) => {
    const dt = dayLabel(d.date);
    return `<div class="dh${d.date === today ? " today" : ""}">${dt.toLocaleDateString([], { weekday: "narrow" })}<br>${dt.getDate()}</div>`;
  }).join("");
  for (const m of profile.medications) {
    h += `<div class="rowlabel">${esc(m.name)}<small>${esc(m.purpose)}</small></div>`;
    h += days.map((d) => {
      const s = d.meds[m.name];
      const glyph = { taken: "✓", missed: "✕" }[s] || "";
      return `<span class="mark ${s}" title="${esc(m.name)} · ${dayLabel(d.date).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })} · ${s}">${glyph}</span>`;
    }).join("");
  }
  h += `<div class="rowlabel">Symptoms<small>as reported</small></div>` + days.map((d) =>
    d.symptoms.length ? `<span class="mark sym" title="${esc(d.symptoms.join(", "))}">${d.symptoms.length > 1 ? d.symptoms.length : "!"}</span>` : `<span class="mark none"></span>`).join("");
  h += `<div class="rowlabel">Mood<small>daily</small></div>` + days.map((d) =>
    d.mood != null ? `<span class="mark" style="background:${moodColor(d.mood)}" title="Mood ${d.mood.toFixed(1)} of 5"></span>` : `<span class="mark none"></span>`).join("");
  $("timeline").innerHTML = h;
}

// ---------- Mood and sleep chart: smooth, with a hover read-out ----------
function smooth(pts) {
  if (pts.length < 2) return "";
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2, t = 0.18;
    const c1 = [p1[0] + (p2[0] - p0[0]) * t, p1[1] + (p2[1] - p0[1]) * t];
    const c2 = [p2[0] - (p3[0] - p1[0]) * t, p2[1] - (p3[1] - p1[1]) * t];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}
function renderChart(days) {
  const el = $("chart");
  const W = Math.max($("chartWrap").clientWidth, 260), H = 200, pl = 22, pr = 8, pt = 16, pb = 26;
  el.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const n = days.length;
  const x = (i) => pl + (i * (W - pl - pr)) / (n - 1);
  const yMood = (m) => H - pb - ((m - 1) / 4) * (H - pt - pb);
  const ySleep = (s) => H - pb - (Math.min(s, 10) / 10) * (H - pt - pb);
  const moodPts = days.map((d, i) => (d.mood != null ? [x(i), yMood(d.mood)] : null)).filter(Boolean);
  const sleepPts = days.map((d, i) => (d.sleepHours != null ? [x(i), ySleep(d.sleepHours)] : null)).filter(Boolean);
  const moodPath = smooth(moodPts);
  const area = moodPts.length > 1 ? `${moodPath} L${moodPts.at(-1)[0]},${H - pb} L${moodPts[0][0]},${H - pb} Z` : "";
  const grid = [1, 3, 5].map((m) => `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${yMood(m)}" y2="${yMood(m)}"/><text class="lbl" x="0" y="${yMood(m) + 4}">${m}</text>`).join("");
  const xl = days.map((d, i) => (i % 2 === 0 || i === n - 1 ? `<text class="lbl" x="${x(i)}" y="${H - 6}" text-anchor="middle">${dayLabel(d.date).getDate()}</text>` : "")).join("");
  el.innerHTML = `
    <defs><linearGradient id="moodFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity="0.28"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
    ${grid}${xl}
    ${area ? `<path d="${area}" fill="url(#moodFill)"/>` : ""}
    <path class="line-sleep" d="${smooth(sleepPts)}"/>
    <path class="line-mood" d="${moodPath}"/>
    <line class="grid" id="cross" y1="${pt}" y2="${H - pb}" style="opacity:0"/>
    <circle id="cm" r="5" fill="var(--accent)" stroke="var(--card)" stroke-width="2.5" style="opacity:0"/>`;
  const tip = $("tip");
  el.onpointermove = (e) => {
    const r = el.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - pl) / (W - pl - pr)) * (n - 1))));
    const d = days[i];
    const cross = el.querySelector("#cross"), cm = el.querySelector("#cm");
    cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.style.opacity = 1;
    if (d.mood != null) { cm.setAttribute("cx", x(i)); cm.setAttribute("cy", yMood(d.mood)); cm.style.opacity = 1; } else cm.style.opacity = 0;
    tip.innerHTML = `<b>${dayLabel(d.date).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}</b><br>Mood ${d.mood != null ? d.mood.toFixed(1) : "–"} · Sleep ${d.sleepHours != null ? d.sleepHours + " h" : "–"}`;
    tip.style.left = `${(x(i) / W) * 100}%`;
    tip.classList.add("on");
  };
  el.onpointerleave = () => { tip.classList.remove("on"); el.querySelector("#cross").style.opacity = 0; el.querySelector("#cm").style.opacity = 0; };
}

// ---------- Rings ----------
function renderRings(adherence) {
  const C = 2 * Math.PI * 34;
  $("rings").innerHTML = adherence.map((a) => {
    const pct = a.due ? a.taken / a.due : 1;
    const color = pct >= 0.85 ? "var(--ok)" : pct >= 0.7 ? "var(--watch)" : "var(--urgent)";
    return `<div class="ring">
      <svg viewBox="0 0 84 84" role="img" aria-label="${esc(a.medication)}: ${a.taken} of ${a.due} doses"><circle class="track" cx="42" cy="42" r="34" fill="none" stroke-width="9"/><circle class="prog" cx="42" cy="42" r="34" fill="none" stroke-width="9" stroke="${color}" stroke-dasharray="${C}" stroke-dashoffset="${C}" data-off="${C * (1 - pct)}"/></svg>
      <div><div class="ring-val">${a.taken}/${a.due}</div><div class="ring-name">${esc(a.medication)}</div><div class="ring-sub">${esc(a.purpose)}</div></div>
    </div>`;
  }).join("");
  requestAnimationFrame(() => requestAnimationFrame(() => document.querySelectorAll(".ring .prog").forEach((c) => (c.style.strokeDashoffset = c.dataset.off))));
}

// ---------- New alert: banner from the top, like a phone notification ----------
let bannerTimer;
function announce(alert) {
  $("bannerTitle").textContent = `Kin · ${alert.title}`;
  $("bannerMsg").textContent = alert.reasons[0] || alert.message;
  $("banner").classList.add("show");
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => $("banner").classList.remove("show"), 7500);
  if ("Notification" in window && Notification.permission === "granted") new Notification(`Kin: ${alert.title}`, { body: alert.reasons[0] || alert.message });
}
$("banner").addEventListener("click", () => $("banner").classList.remove("show"));

// ---------- Actions ----------
$("alerts").addEventListener("click", async (e) => {
  const id = e.target.dataset?.ack;
  if (!id) return;
  e.target.disabled = true;
  await fetch(`/api/family/alerts/${id}/ack`, { method: "POST" });
  lastKey = "";
  load();
});

$("digestBtn").addEventListener("click", async () => {
  const btn = $("digestBtn");
  btn.disabled = true;
  btn.textContent = "Writing…";
  try {
    const data = await (await fetch("/api/family/digest")).json();
    const box = $("digest");
    box.classList.remove("fresh");
    box.textContent = data.digest || data.error;
    void box.offsetWidth;
    box.classList.add("fresh");
  } finally {
    btn.disabled = false;
    btn.textContent = "Write today's digest";
  }
});

function bubble(cls, text) {
  const b = document.createElement("div");
  b.className = `bubble ${cls}`;
  if (text) b.textContent = text;
  $("thread").append(b);
  return b;
}
$("ask").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("askText").value.trim();
  if (!text) return;
  $("askText").value = "";
  bubble("me", text);
  const typing = bubble("kin typing");
  typing.innerHTML = "<i></i><i></i><i></i>";
  try {
    const res = await fetch("/api/talk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, sessionId, speaker: "family" }),
    });
    const data = await res.json();
    typing.className = "bubble kin";
    typing.textContent = data.reply || data.error || "Sorry, I couldn't answer that.";
  } catch {
    typing.className = "bubble kin";
    typing.textContent = "Sorry, I couldn't reach Kin.";
  }
});

$("reset").addEventListener("click", async () => {
  if (!confirm("Reload the two-week demo history? This clears today's conversation and alerts.")) return;
  const res = await fetch("/api/demo/reset", { method: "POST" });
  if (!res.ok) return alert((await res.json().catch(() => ({}))).error || "Reset failed.");
  seenAlerts.clear();
  firstLoad = true;
  lastKey = "";
  $("digest").innerHTML = `<span class="empty">A short written summary from Kin, in plain words.</span>`;
  $("thread").innerHTML = "";
  $("banner").classList.remove("show");
  load();
});

if ("Notification" in window && Notification.permission === "default") {
  document.addEventListener("click", () => Notification.requestPermission(), { once: true });
}
let resizeTimer;
addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => lastData && renderChart(lastData.insights.days), 150); });

load();
setInterval(load, 4000);
