// Reveals sections as they arrive, and draws the lines that connect a missed
// tablet to the dizzy spell after it.

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

const reveals = [...document.querySelectorAll(".rv")];
const show = (el) => {
  el.classList.add(el.id === "weekWrap" ? "play" : "in");
  io.unobserve(el);
};
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      show(e.target);
      // A jump from the nav can skip past sections; never leave anything above hidden
      if (e.target.classList.contains("rv")) reveals.slice(0, reveals.indexOf(e.target)).forEach(show);
    }
  },
  { threshold: 0.15, rootMargin: "0px 0px -6% 0px" },
);
reveals.forEach((el) => io.observe(el));

const wrap = document.getElementById("weekWrap");
const svg = document.getElementById("arcs");
const NS = "http://www.w3.org/2000/svg";

/** Layout position inside the week, ignoring the entrance transforms still in flight. */
function place(el) {
  let left = 0, top = 0;
  for (let n = el; n && n !== wrap; n = n.offsetParent) {
    left += n.offsetLeft;
    top += n.offsetTop;
  }
  return { left, top, width: el.offsetWidth, height: el.offsetHeight, right: left + el.offsetWidth, bottom: top + el.offsetHeight };
}

function drawArcs() {
  const box = { width: wrap.offsetWidth, height: wrap.offsetHeight };
  svg.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
  svg.replaceChildren();
  const vertical = getComputedStyle(wrap.querySelector(".week")).gridTemplateColumns.split(" ").length === 1;

  wrap.querySelectorAll("[data-from]").forEach((fromEl, k) => {
    const toEl = wrap.querySelector(`[data-to="${fromEl.dataset.from}"]`);
    if (!toEl) return;
    const a = place(fromEl);
    const b = place(toEl);
    const ax = a.left + a.width / 2, ay = a.bottom;
    const bx = b.left + b.width / 2, by = b.bottom;
    let d, end;
    if (fromEl.closest(".day") === toEl.closest(".day") && Math.abs(a.top - b.top) < 4) {
      // Same day, tags side by side: a shallow dip beneath them
      const dip = Math.max(a.bottom, b.bottom) + 9;
      d = `M${ax},${ay + 2} C${ax},${dip} ${bx},${dip} ${bx},${by + 2}`;
      end = [bx, by + 2];
    } else if (fromEl.closest(".day") === toEl.closest(".day")) {
      // Same day, tags stacked: a small bracket on their right
      const y1 = a.top + a.height / 2, y2 = b.top + b.height / 2;
      const x1 = a.right + 5, x2 = b.right + 5, out = Math.max(a.right, b.right) + 16;
      d = `M${x1},${y1} C${out},${y1} ${out},${y2} ${x2},${y2}`;
      end = [x2, y2];
    } else if (vertical) {
      // Stacked days: loop out to the right margin and back in
      const x1 = place(fromEl.closest(".day")).right + 4, y1 = a.top + a.height / 2;
      const x2 = place(toEl.closest(".day")).right + 4, y2 = b.top + b.height / 2;
      const out = box.width - 6;
      d = `M${x1},${y1} C${out},${y1} ${out},${y2} ${x2},${y2}`;
      end = [x2, y2];
    } else {
      // Days side by side: dip below the cards, deeper for longer jumps
      const dip = Math.max(ay, by) + 18 + Math.min(Math.abs(bx - ax) * 0.12, 26);
      d = `M${ax},${ay + 3} C${ax},${dip} ${bx},${dip} ${bx},${by + 3}`;
      end = [bx, by + 3];
    }
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", d);
    path.style.setProperty("--k", k);
    svg.append(path);
    path.style.setProperty("--len", Math.ceil(path.getTotalLength()) + 1);
    const dot = document.createElementNS(NS, "circle");
    dot.setAttribute("cx", end[0]);
    dot.setAttribute("cy", end[1]);
    dot.setAttribute("r", 3);
    dot.style.setProperty("--k", k);
    svg.append(dot);
  });
}

drawArcs();
io.observe(wrap);
let resizeFrame;
addEventListener("resize", () => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(drawArcs);
});
// Fonts can shift the layout after first paint
document.fonts?.ready.then(drawArcs);
if (reduced) wrap.classList.add("play");
