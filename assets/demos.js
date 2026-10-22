// Small illustrative demos. All numbers are made up (see demo-math.js), never the activity's data.
import { BOOST_DEMO, FOREST_DEMO, LINEAR_DEMO, average, boost, boostPredict, linearIntercept, linearPushes } from "./demo-math.js";

const f1 = (v) => v.toFixed(1);
const signed = (v) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(1)}`;
const cls = (v) => (v > 0 ? "up" : v < 0 ? "down" : "");

// ---- Linear: how a coefficient and a value make a push -------------------------
function linearDemo(root) {
  const m = LINEAR_DEMO;
  const u = m.units;
  const values = Object.fromEntries(m.features.map((f) => [f.name, f.average]));
  root.innerHTML = `
    <p class="demo-intro"><span class="tag illustrative">Illustrative example: made-up numbers</span></p>
    <p>A made-up model predicts resting heart rate. Its average person exercises ${m.features[0].average} hours a week and drinks ${m.features[1].average} cups of coffee a day, and gets the <strong>starting point</strong> of ${m.baseline} ${u}. Move the sliders.</p>
    <div class="demo-controls">
      ${m.features.map((f) => `<label>${f.label}: <output id="lin-${f.name}-out">${f.average} ${f.unit}</output>
        <input type="range" id="lin-${f.name}" min="${f.min}" max="${f.max}" step="${f.step}" value="${f.average}" aria-describedby="lin-${f.name}-coef"></label>`).join("")}
    </div>
    <div class="table-wrap"><table class="receipt"><tbody id="lin-receipt"></tbody></table></div>
    <p class="small muted" id="lin-note"></p>`;
  const body = root.querySelector("#lin-receipt");
  const render = () => {
    const { pushes, prediction } = linearPushes(m, values);
    body.innerHTML = `<tr><td>Starting point (the average person)</td><td class="num">${f1(m.baseline)} ${u}</td></tr>
      ${pushes.map((p) => `<tr><td><span id="lin-${p.name}-coef">${p.label}: ${p.coefficient > 0 ? "+" : "−"}${Math.abs(p.coefficient).toFixed(1)} ${u} per ${p.unit.split("/")[0].replace(/s$/, "")} × (${p.value} − ${p.average})</span></td>
        <td class="num ${cls(p.push)}">${signed(p.push)} ${u}</td></tr>`).join("")}
      <tr class="total"><td>Prediction</td><td class="num" aria-live="polite">${f1(prediction)} ${u}</td></tr>`;
    const allAvg = pushes.every((p) => p.value === p.average);
    root.querySelector("#lin-note").textContent = allAvg
      ? `Both values are average, so both pushes are 0 and the prediction equals the starting point. (The intercept, the prediction at 0 hours and 0 cups, would be ${f1(linearIntercept(m))} ${u}: nobody's starting point.)`
      : "Each push = coefficient × (value − average). Starting point + pushes = prediction.";
  };
  m.features.forEach((f) => {
    const input = root.querySelector(`#lin-${f.name}`);
    input.addEventListener("input", () => {
      values[f.name] = Number(input.value);
      root.querySelector(`#lin-${f.name}-out`).textContent = `${input.value} ${f.unit}`;
      render();
    });
  });
  render();
}

// ---- Forest: averaging different trees ----------------------------------------
function forestDemo(root) {
  const g = FOREST_DEMO.guesses;
  const u = FOREST_DEMO.units;
  const on = g.map(() => true);
  root.innerHTML = `
    <p class="demo-intro"><span class="tag illustrative">Illustrative example: made-up numbers</span></p>
    <p>Eight made-up trees each guess a score for the same person. Switch trees off and on to see how the average changes.</p>
    <ul class="tree-toggles">${g.map((v, i) => `<li><button type="button" class="tree-toggle" aria-pressed="true" data-i="${i}">Tree ${i + 1}: ${v}</button></li>`).join("")}</ul>
    <div class="demo-buttons"><button type="button" data-set="all">All 8 trees</button><button type="button" data-set="one">Tree 1 only</button><button type="button" data-set="first3">First 3 trees</button></div>
    <div id="forest-chart"></div>
    <div class="demo-readout" aria-live="polite" id="forest-readout"></div>`;
  const W = 600, H = 120, lo = 100, hi = 140, pad = 30;
  const x = (v) => pad + ((v - lo) / (hi - lo)) * (W - 2 * pad);
  const render = () => {
    const used = g.filter((_, i) => on[i]);
    const avg = used.length ? average(used) : null;
    const all = average(g);
    root.querySelector("#forest-chart").innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tree guesses on a line from ${lo} to ${hi}, with the average of the included trees marked">
      <line class="axis" x1="${pad}" x2="${W - pad}" y1="70" y2="70"/>
      ${[100, 110, 120, 130, 140].map((t) => `<text x="${x(t)}" y="100" text-anchor="middle">${t}</text>`).join("")}
      ${g.map((v, i) => `<circle class="dot${on[i] ? "" : " off"}" cx="${x(v)}" cy="${60 - (i % 2) * 14}" r="7"/>`).join("")}
      ${avg !== null ? `<line class="avg" x1="${x(avg)}" x2="${x(avg)}" y1="22" y2="78"/><text x="${x(avg)}" y="16" text-anchor="middle">average ${f1(avg)}</text>` : ""}
    </svg>`;
    const n = used.length;
    root.querySelector("#forest-readout").innerHTML = n === 0
      ? "<p>No trees switched on: switch at least one on.</p>"
      : `<p><strong>${n === g.length ? "Whole forest" : `Partial forest (${n} of ${g.length} trees)`}:</strong> average ${f1(avg)} ${u}</p>
         <p>All ${g.length} trees: ${all.toFixed(2)} ${u}. Lowest to highest guess: ${Math.min(...g)}–${Math.max(...g)} ${u}. That spread is <em>disagreement</em>, not a confidence range.</p>`;
    root.querySelectorAll(".tree-toggle").forEach((b) => b.setAttribute("aria-pressed", String(on[b.dataset.i])));
  };
  root.querySelectorAll(".tree-toggle").forEach((b) => b.addEventListener("click", () => { on[b.dataset.i] = !on[b.dataset.i]; render(); }));
  root.querySelectorAll("[data-set]").forEach((b) => b.addEventListener("click", () => {
    g.forEach((_, i) => { on[i] = b.dataset.set === "all" || i === 0 || (b.dataset.set === "first3" && i < 3); });
    render();
  }));
  render();
}

// ---- Boosting: successive corrections, and training vs validation ----------------
function boostDemo(root) {
  const d = BOOST_DEMO;
  const fit = boost(d);
  const u = d.units;
  const who = 3; // the 4th training person (x = 4)
  let r = 0;
  root.innerHTML = `
    <p class="demo-intro"><span class="tag illustrative">Illustrative example: made-up numbers</span></p>
    <p>Ten made-up training people (filled dots) and nine made-up validation people (rings), with one feature. Each round adds one tiny tree that asks a single yes/no question. Learning rate ${d.learningRate}.</p>
    <div class="demo-controls"><label>Round: <output id="b-round-out">0</output>
      <input type="range" id="b-round" min="0" max="${d.rounds}" step="1" value="0"></label></div>
    <div class="demo-buttons"><button type="button" data-step="-1">Back one round</button><button type="button" data-step="1">Next round</button><button type="button" data-go="0">Round 0</button><button type="button" data-go="${d.rounds}">Round ${d.rounds}</button></div>
    <ul class="legend"><li><span class="swatch dot"></span>training person</li><li><span class="swatch ring"></span>validation person</li><li><span class="swatch fit"></span>model's prediction</li></ul>
    <div id="b-fit"></div>
    <div class="demo-readout" aria-live="polite" id="b-step"></div>
    <h3>Training vs validation error</h3>
    <ul class="legend"><li><span class="swatch"></span>training RMSE</li><li><span class="swatch val"></span>validation RMSE</li></ul>
    <div id="b-err"></div>
    <div class="demo-readout" aria-live="polite" id="b-err-text"></div>`;

  const W = 600, H = 260, pad = 36;
  const sx = (v) => pad + (v / 11) * (W - 2 * pad);
  const sy = (v) => H - pad - ((v - 45) / 40) * (H - 2 * pad);
  const curve = (round) => {
    const pts = [];
    const xs = [0, ...fit.stumps.slice(0, round).map((s) => s.threshold), 11].sort((a, b) => a - b);
    for (let k = 0; k < xs.length - 1; k++) {
      const mid = (xs[k] + xs[k + 1]) / 2;
      const yv = boostPredict(fit, mid, round, d.learningRate);
      pts.push(`${sx(xs[k]).toFixed(1)},${sy(yv).toFixed(1)}`, `${sx(xs[k + 1]).toFixed(1)},${sy(yv).toFixed(1)}`);
    }
    return pts.join(" ");
  };
  const errW = 600, errH = 200;
  const ex = (m) => pad + (m / d.rounds) * (errW - 2 * pad);
  const maxE = Math.max(...fit.trainRmse, ...fit.valRmse);
  const ey = (v) => errH - pad - (v / maxE) * (errH - 2 * pad);
  const line = (arr) => arr.map((v, m) => `${ex(m).toFixed(1)},${ey(v).toFixed(1)}`).join(" ");

  const render = () => {
    root.querySelector("#b-round").value = r;
    root.querySelector("#b-round-out").textContent = r;
    root.querySelector("#b-fit").innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Scatter of made-up training and validation people with the model's step-shaped prediction after round ${r}">
      <line class="axis" x1="${pad}" x2="${W - pad}" y1="${H - pad}" y2="${H - pad}"/><line class="axis" x1="${pad}" x2="${pad}" y1="${pad - 10}" y2="${H - pad}"/>
      ${[50, 60, 70, 80].map((t) => `<text x="${pad - 6}" y="${sy(t) + 4}" text-anchor="end">${t}</text>`).join("")}
      ${[0, 2, 4, 6, 8, 10].map((t) => `<text x="${sx(t)}" y="${H - pad + 16}" text-anchor="middle">${t}</text>`).join("")}
      <text x="${W / 2}" y="${H - 4}" text-anchor="middle">feature (made up)</text>
      <polyline class="fit" points="${curve(r)}"/>
      ${d.validation.x.map((v, i) => `<circle class="val" cx="${sx(v)}" cy="${sy(d.validation.y[i])}" r="6"/>`).join("")}
      ${d.train.x.map((v, i) => `<circle class="train" cx="${sx(v)}" cy="${sy(d.train.y[i])}" r="${i === who ? 8 : 6}"/>`).join("")}
      <text x="${sx(d.train.x[who]) + 10}" y="${sy(d.train.y[who]) - 8}">person A</text>
    </svg>`;
    const before = r === 0 ? null : fit.stagedTrain[r - 1][who];
    const after = fit.stagedTrain[r][who];
    const yA = d.train.y[who];
    if (r === 0) {
      root.querySelector("#b-step").innerHTML = `<p><strong>Round 0:</strong> no trees yet. Everyone gets the training average, ${f1(fit.init)} ${u}.</p>
        <p>Person A (actual ${yA}) is predicted ${f1(after)}, so the residual is ${signed(yA - after)} ${u}.</p>`;
    } else {
      const s = fit.stumps[r - 1];
      const corr = after - before;
      root.querySelector("#b-step").innerHTML = `<p><strong>Round ${r}:</strong> the new tree asks "is the feature ≤ ${s.threshold}?". It was fitted to the current training residuals: yes → ${signed(s.left)}, no → ${signed(s.right)}. Only ${d.learningRate} of that is used.</p>
        <p>Person A: ${f1(before)} <span class="${cls(corr)}">${signed(corr)}</span> = <strong>${f1(after)}</strong> ${u} (actual ${yA}; residual now ${signed(yA - after)}).</p>`;
    }
    root.querySelector("#b-err").innerHTML = `<svg class="chart" viewBox="0 0 ${errW} ${errH}" role="img" aria-label="Training and validation error by round; validation error is lowest at round ${fit.bestRound}">
      <line class="axis" x1="${pad}" x2="${errW - pad}" y1="${errH - pad}" y2="${errH - pad}"/><line class="axis" x1="${pad}" x2="${pad}" y1="${pad - 10}" y2="${errH - pad}"/>
      ${[0, 5, 10, 15, 20, 25, 30].map((t) => `<text x="${ex(t)}" y="${errH - pad + 16}" text-anchor="middle">${t}</text>`).join("")}
      ${[0, 5, 10].map((t) => `<text x="${pad - 6}" y="${ey(t) + 4}" text-anchor="end">${t}</text>`).join("")}
      <text x="${errW / 2}" y="${errH - 4}" text-anchor="middle">round</text>
      <polyline class="train-line" points="${line(fit.trainRmse)}"/>
      <polyline class="val-line" points="${line(fit.valRmse)}"/>
      <line class="marker" x1="${ex(r)}" x2="${ex(r)}" y1="${pad - 10}" y2="${errH - pad}"/>
    </svg>`;
    root.querySelector("#b-err-text").innerHTML = `<p>After round ${r}: training RMSE ${fit.trainRmse[r].toFixed(2)}, validation RMSE ${fit.valRmse[r].toFixed(2)} ${u}.</p>
      <p>${r <= fit.bestRound
        ? "Both errors are still falling: each tree is fixing real pattern."
        : `Training error keeps falling, but validation error was lowest at round ${fit.bestRound} (${fit.valRmse[fit.bestRound].toFixed(2)}). Later trees fit noise in the training people, which doesn't help new people.`}</p>`;
  };
  root.querySelector("#b-round").addEventListener("input", (e) => { r = Number(e.target.value); render(); });
  root.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", () => { r = Math.min(d.rounds, Math.max(0, r + Number(b.dataset.step))); render(); }));
  root.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => { r = Number(b.dataset.go); render(); }));
  render();
}

const DEMOS = { "demo-linear": linearDemo, "demo-forest": forestDemo, "demo-boost": boostDemo };
for (const [id, fn] of Object.entries(DEMOS)) {
  const el = document.getElementById(id);
  if (el) fn(el);
}
