const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const sessionId = crypto.randomUUID();
const seenAlerts = new Set();
let firstLoad = true;

const timeAgo = (iso) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
};

async function load() {
  const res = await fetch("/api/family/overview");
  if (!res.ok) return;
  render(await res.json());
}

function render({ profile, insights, alerts, recent }) {
  const p = profile;
  const rel = p.family[0];
  $("name").textContent = `${p.preferredName}`;
  $("who").textContent = `${p.age} · ${p.city} · ${p.conditions.join(", ")}${rel ? ` · viewing as ${rel.name} (${rel.relation})` : ""}`;
  $("askText").placeholder = `How has ${p.preferredName} been sleeping this week?`;

  $("status").innerHTML = `
    <span class="pill lvl-${insights.level}">${insights.level}</span>
    <div class="headline">${esc(insights.headline)}</div>
    <div class="empty">${insights.checkedInToday ? "Checked in today" : "No check-in yet today"}</div>`;

  $("findings").innerHTML = insights.findings.length
    ? insights.findings
        .map((f) => `<div class="finding f-${f.level}"><div class="t">${esc(f.title)}</div><div class="d">${esc(f.detail)}</div></div>`)
        .join("")
    : `<div class="empty">Nothing unusual. Kin is keeping an eye on things.</div>`;

  $("alerts").innerHTML = alerts.length
    ? alerts
        .map((a) => {
          const isNew = !firstLoad && !seenAlerts.has(a.id);
          return `<div class="alert-item${!a.acknowledged ? " new" : ""}" data-new="${isNew}">
            <div class="row"><span class="pill lvl-${a.level}">${a.level}</span><span class="when">${timeAgo(a.ts)} · ${a.channel === "sns" ? "sent by SMS/email" : "dashboard"}</span></div>
            <div class="title">${esc(a.title)}</div>
            <div>${esc(a.message)}</div>
            ${a.reasons.length ? `<ul>${a.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
            ${a.acknowledged ? `<span class="when">✓ acknowledged</span>` : `<button class="btn" data-ack="${a.id}">I'll call them</button>`}
          </div>`;
        })
        .join("")
    : `<div class="empty">No alerts. Kin will message you if a pattern needs attention.</div>`;
  const fresh = alerts.filter((a) => !seenAlerts.has(a.id));
  if (!firstLoad && fresh.length) notifyBrowser(fresh[0]);
  alerts.forEach((a) => seenAlerts.add(a.id));

  renderTimeline(p, insights.days);
  renderChart(insights.days);

  $("adherence").innerHTML = insights.adherence
    .map((a) => {
      const pct = a.due ? Math.round((a.taken / a.due) * 100) : 100;
      return `<div class="adh"><div style="flex:1"><div><b>${esc(a.medication)}</b> <span class="empty">${esc(a.purpose)}</span></div>
        <div class="bar"><i style="width:${pct}%;${pct < 80 ? "background:var(--urgent)" : ""}"></i></div></div>
        <div>${a.taken}/${a.due}</div></div>`;
    })
    .join("");

  const quotes = recent.filter((l) => l.utterance).slice(0, 8);
  $("quotes").innerHTML = quotes.length
    ? quotes.map((l) => `<div class="quote"><div class="s">“${esc(l.utterance)}”</div><div class="when">${timeAgo(l.ts)} · ${esc(l.kind)}</div></div>`).join("")
    : `<div class="empty">Nothing yet.</div>`;
  firstLoad = false;
}

function renderTimeline(profile, days) {
  const head = days
    .map((d) => {
      const dt = new Date(`${d.date}T12:00:00`);
      return `<th>${dt.toLocaleDateString([], { weekday: "narrow" })}<br>${dt.getDate()}</th>`;
    })
    .join("");
  const medRows = profile.medications
    .map(
      (m) =>
        `<tr><th>${esc(m.name)}</th>${days
          .map((d) => {
            const s = d.meds[m.name];
            const label = { taken: "✓", partial: "½", missed: "✕", pending: "·" }[s] ?? "";
            return `<td class="cell ${s}" title="${d.date}: ${s}">${label}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("");
  const symRow = `<tr><th>Symptoms</th>${days
    .map((d) => `<td class="cell ${d.symptoms.length ? "sym" : ""}" title="${esc(d.symptoms.join(", "))}">${d.symptoms.length ? esc(d.symptoms.map(short).join(" ")) : ""}</td>`)
    .join("")}</tr>`;
  const moodRow = `<tr><th>Mood</th>${days.map((d) => `<td class="cell">${d.mood != null ? moodFace(d.mood) : ""}</td>`).join("")}</tr>`;
  $("timeline").innerHTML = `<table><thead><tr><th></th>${head}</tr></thead><tbody>${medRows}${symRow}${moodRow}</tbody></table>`;
}

const short = (s) => ({ dizziness: "dizzy", "joint pain": "knee", headache: "head" })[s] ?? s.split(" ")[0];
const moodFace = (m) => (m >= 4.5 ? "😄" : m >= 3.5 ? "🙂" : m >= 2.5 ? "😐" : m >= 1.5 ? "🙁" : "😢");

function renderChart(days) {
  const W = 700, H = 140, pad = 22;
  const x = (i) => pad + (i * (W - pad * 2)) / (days.length - 1);
  const yMood = (m) => H - pad - ((m - 1) / 4) * (H - pad * 2);
  const ySleep = (h) => H - pad - (Math.min(h, 10) / 10) * (H - pad * 2);
  const line = (key, y) =>
    days
      .map((d, i) => (d[key] != null ? `${x(i)},${y(d[key])}` : null))
      .filter(Boolean)
      .join(" ");
  const labels = days
    .map((d, i) => (i % 2 === 0 || i === days.length - 1 ? `<text x="${x(i)}" y="${H - 4}" text-anchor="middle">${new Date(`${d.date}T12:00:00`).getDate()}</text>` : ""))
    .join("");
  $("chart").innerHTML = `
    <line class="axis" x1="${pad}" x2="${W - pad}" y1="${H - pad}" y2="${H - pad}" />
    <polyline class="sleep" points="${line("sleepHours", ySleep)}" />
    <polyline class="mood" points="${line("mood", yMood)}" />
    ${labels}`;
}

function notifyBrowser(alert) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  new Notification(`Kin: ${alert.title}`, { body: alert.reasons[0] || alert.message });
}

$("alerts").addEventListener("click", async (e) => {
  const id = e.target.dataset?.ack;
  if (!id) return;
  await fetch(`/api/family/alerts/${id}/ack`, { method: "POST" });
  load();
});

$("digestBtn").addEventListener("click", async () => {
  const btn = $("digestBtn");
  btn.disabled = true;
  btn.textContent = "Writing…";
  try {
    const res = await fetch("/api/family/digest");
    const data = await res.json();
    $("digest").textContent = data.digest || data.error;
  } finally {
    btn.disabled = false;
    btn.textContent = "Write today's digest";
  }
});

$("ask").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("askText").value.trim();
  if (!text) return;
  $("answer").textContent = "Kin is thinking…";
  const res = await fetch("/api/talk", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, sessionId, speaker: "family" }),
  });
  const data = await res.json();
  $("answer").textContent = data.reply || data.error;
});

$("reset").addEventListener("click", async () => {
  if (!confirm("Reload the two-week demo history? This clears today's conversation and alerts.")) return;
  await fetch("/api/demo/reset", { method: "POST" });
  seenAlerts.clear();
  firstLoad = true;
  $("digest").innerHTML = `<span class="empty">A short written summary from Kin.</span>`;
  $("answer").textContent = "";
  load();
});

if ("Notification" in window && Notification.permission === "default") {
  document.addEventListener("click", () => Notification.requestPermission(), { once: true });
}

load();
setInterval(load, 4000);
