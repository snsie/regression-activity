// Math behind the illustrative demos. Pure functions, tested in tests/demo-math.test.mjs.
// All demo data is made up; none of it comes from the activity's datasets.

// ---- Linear: a made-up two-feature model of resting heart rate (beats per minute)
export const LINEAR_DEMO = {
  units: "bpm",
  baseline: 70, // prediction for the made-up average person
  features: [
    { name: "exercise", label: "Exercise", unit: "hours/week", coefficient: -0.8, average: 4, min: 0, max: 12, step: 1 },
    { name: "coffee", label: "Coffee", unit: "cups/day", coefficient: 2.0, average: 2, min: 0, max: 6, step: 1 },
  ],
};

export function linearPushes(model, values) {
  const pushes = model.features.map((f) => ({ ...f, value: values[f.name], push: f.coefficient * (values[f.name] - f.average) }));
  const prediction = model.baseline + pushes.reduce((s, p) => s + p.push, 0);
  return { pushes, prediction };
}

// The intercept: the prediction when every feature is 0.
export function linearIntercept(model) {
  return model.baseline - model.features.reduce((s, f) => s + f.coefficient * f.average, 0);
}

// ---- Forest: made-up guesses from 8 trees for one made-up person
export const FOREST_DEMO = { units: "points", guesses: [118, 131, 124, 109, 127, 122, 135, 116] };

export function average(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

// ---- Boosting: depth-1 trees (one yes/no question each) on made-up data, squared error
export const BOOST_DEMO = {
  units: "points",
  learningRate: 0.3,
  rounds: 30,
  train: { x: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], y: [52, 58, 50, 66, 61, 72, 64, 80, 70, 78] },
  validation: { x: [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5], y: [57, 51, 62, 58, 69, 63, 74, 68, 79] },
};

// Best single split on x for residuals r (squared error). Ties keep the leftmost split.
export function fitStump(x, r) {
  const order = x.map((_, i) => i).sort((a, b) => x[a] - x[b]);
  const xs = order.map((i) => x[i]);
  const rs = order.map((i) => r[i]);
  const total = rs.reduce((a, b) => a + b, 0);
  const n = xs.length;
  let best = null;
  let left = 0;
  for (let k = 1; k < n; k++) {
    left += rs[k - 1];
    if (xs[k] === xs[k - 1]) continue;
    const meanL = left / k;
    const meanR = (total - left) / (n - k);
    const gain = ((k * (n - k)) / n) * (meanL - meanR) ** 2;
    if (!best || gain > best.gain + 1e-12) best = { gain, threshold: (xs[k - 1] + xs[k]) / 2, left: meanL, right: meanR };
  }
  return best;
}

export const stumpValue = (s, x) => (x <= s.threshold ? s.left : s.right);

export function rmse(y, p) {
  return Math.sqrt(y.reduce((s, v, i) => s + (v - p[i]) ** 2, 0) / y.length);
}

// Every round's stump and predictions. staged[m] = predictions after round m (staged[0] = training mean).
export function boost(demo = BOOST_DEMO) {
  const { x, y } = demo.train;
  const init = average(y);
  let pTrain = x.map(() => init);
  let pVal = demo.validation.x.map(() => init);
  const stumps = [];
  const trainRmse = [rmse(y, pTrain)];
  const valRmse = [rmse(demo.validation.y, pVal)];
  const stagedTrain = [pTrain];
  for (let m = 1; m <= demo.rounds; m++) {
    const residuals = y.map((v, i) => v - pTrain[i]);
    const s = fitStump(x, residuals);
    stumps.push(s);
    pTrain = pTrain.map((p, i) => p + demo.learningRate * stumpValue(s, x[i]));
    pVal = pVal.map((p, i) => p + demo.learningRate * stumpValue(s, demo.validation.x[i]));
    stagedTrain.push(pTrain);
    trainRmse.push(rmse(y, pTrain));
    valRmse.push(rmse(demo.validation.y, pVal));
  }
  const bestRound = valRmse.indexOf(Math.min(...valRmse));
  return { init, stumps, stagedTrain, trainRmse, valRmse, bestRound };
}

// Prediction for any x after `round` rounds.
export function boostPredict(fit, x, round, learningRate = BOOST_DEMO.learningRate) {
  let p = fit.init;
  for (let m = 0; m < round; m++) p += learningRate * stumpValue(fit.stumps[m], x);
  return p;
}
