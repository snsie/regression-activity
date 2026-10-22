// Checks the math behind every illustrative demo. Run: node --test tests/
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  BOOST_DEMO, FOREST_DEMO, LINEAR_DEMO, average, boost, boostPredict, linearIntercept, linearPushes,
} from "../site/assets/demo-math.js";

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test("linear: starting point + pushes = prediction = intercept + Σ coefficient × value", () => {
  const icpt = linearIntercept(LINEAR_DEMO);
  close(icpt, 70 - (-0.8 * 4) - 2.0 * 2); // 69.2
  for (let ex = 0; ex <= 12; ex++) {
    for (let cof = 0; cof <= 6; cof++) {
      const { pushes, prediction } = linearPushes(LINEAR_DEMO, { exercise: ex, coffee: cof });
      close(prediction, LINEAR_DEMO.baseline + pushes[0].push + pushes[1].push);
      close(prediction, icpt + -0.8 * ex + 2.0 * cof);
    }
  }
  const avg = linearPushes(LINEAR_DEMO, { exercise: 4, coffee: 2 });
  close(avg.prediction, 70); // the average person gets the starting point
  const ex = linearPushes(LINEAR_DEMO, { exercise: 8, coffee: 3 });
  close(ex.pushes[0].push, -3.2);
  close(ex.pushes[1].push, 2);
  close(ex.prediction, 68.8);
});

test("forest: the prediction is the average of the tree guesses", () => {
  close(average(FOREST_DEMO.guesses), 122.75);
  close(average(FOREST_DEMO.guesses.slice(0, 3)), (118 + 131 + 124) / 3);
});

test("boosting: matches scikit-learn GradientBoostingRegressor exactly", () => {
  const ref = JSON.parse(readFileSync(new URL("./boost-reference.json", import.meta.url)));
  const fit = boost();
  close(fit.init, average(BOOST_DEMO.train.y));
  fit.stagedTrain.forEach((row, m) => row.forEach((v, i) => close(v, ref.staged_train[m][i], 1e-6)));
  fit.stumps.forEach((s, m) => close(s.threshold, ref.thresholds[m], 1e-6));
  fit.trainRmse.forEach((v, m) => close(v, ref.train_rmse[m], 1e-6));
  fit.valRmse.forEach((v, m) => close(v, ref.validation_rmse[m], 1e-6));
  const grid = Array.from({ length: 23 }, (_, i) => (i * 11) / 22);
  grid.forEach((x, i) => close(boostPredict(fit, x, 30), ref.grid_predictions_round_30[i], 1e-6));
});

test("boosting: each round adds learning rate × that tree's value, once", () => {
  const fit = boost();
  for (let m = 1; m <= BOOST_DEMO.rounds; m++) {
    BOOST_DEMO.train.x.forEach((x, i) => {
      const s = fit.stumps[m - 1];
      const step = BOOST_DEMO.learningRate * (x <= s.threshold ? s.left : s.right);
      close(fit.stagedTrain[m][i], fit.stagedTrain[m - 1][i] + step, 1e-9);
    });
  }
});

test("boosting demo tells the intended story", () => {
  const fit = boost();
  // training error never rises; validation error is lowest part-way, then rises
  fit.trainRmse.slice(1).forEach((v, m) => assert.ok(v <= fit.trainRmse[m] + 1e-12));
  assert.equal(fit.bestRound, 5);
  assert.ok(fit.valRmse[BOOST_DEMO.rounds] > fit.valRmse[fit.bestRound] + 0.5);
  assert.ok(fit.trainRmse[BOOST_DEMO.rounds] < fit.trainRmse[fit.bestRound] - 1);
});
