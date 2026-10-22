# Brief for the AI coding agent

Read this before changing any code. The student will design the explainers; your job is to build what they ask for **without breaking the rules below**.

## The project
One public app with three sections. Each section explains one fixed regression model to **someone with no machine-learning background**, on three datasets (`glucose`, `sbp`, `fev1`):

| Section | URL | Core question |
|---|---|---|
| Push & Pull | `#linear` or `/linear` | Which features push a prediction up or down, and by how much? |
| Wisdom of the Forest | `#forest` or `/forest` | How do many different trees combine into one prediction? |
| One Correction at a Time | `#boosting` or `/boosting` | How does each new tree improve the model, and when should training stop? |

## Files
- `outputs/<key>.json`: every number the app needs, already computed and checked. Field guide: `outputs/SCHEMA.md`.
- `outputs/<key>_boosting_trees.json`: the boosting trees, for live predictions on custom inputs.
- `m10.py` (Python/Streamlit) and `m10.js` (browser) do the math: `linear_explain` / `linearExplain`, `boosting_rounds` / `boostingRounds`, `category_inputs` / `categoryInputs`.
- `data/*.csv` and `data/README.md`: the raw rows and the data dictionary.
- `streamlit_app.py` (Streamlit route) and `index.html` + `app.js` (GitHub Pages route): plain starter sections that already show correct numbers.
- `check.md`: the numbers the finished app must still show.

## Rules for the numbers (do not break these)
1. **Never invent, hard-code or re-estimate predictions.** Every number shown comes from the bundle or the helpers. Do not retrain with other settings or swap in other models. (`m10.fit_models` exists only for live forest predictions on custom inputs, and its output must pass `m10.check_refit`.)
2. **Every section keeps a dataset switcher (all three datasets) and the supplied people** ("Person 1"–"Person 5"), so reviewers can find the same person in every app.
3. **Linear:** push = coefficient × (value − reference), where the reference is the training average. **Starting point (`linear.baseline`) + all pushes = prediction.** The intercept is *not* the starting point.
   - Sex and ethnicity are category selectors, not separate 0/1 switches. Show them as one push each (`grouped_pushes`).
   - **Two different "references":**
     - Pushes are measured from the **training average**, which includes the average mix of men/women and of ethnic groups. So a man, or a Non-Hispanic White person, still gets a small sex or ethnicity push. That is correct; don't "fix" it.
     - The **reference group** (`categorical_groups[].reference`, e.g. Non-Hispanic White) is only how the 0/1 columns are coded. A coefficient like `eth_nh_black` = +7.1 mmHg compares that group with the reference group, holding the other features fixed. Say which comparison you're showing.
   - To compare features "in general", use `typical_effect_per_sd`, never raw coefficients, because features have different units. Keep one person's pushes separate from overall importance.
   - Some line predictions are far off. For example, lung function Person 1 is a 9-year-old, and the line predicts about twice the measured value, because one straight line can't follow growth and then decline with age. That is the model, not a bug: don't hide it. Showing it is a good explanation.
   - Editing a person's values is a linear-section feature. The forest and boosting sections show the supplied people. If you allow custom inputs there, boosting can use `boosting_rounds` / `boostingRounds`, and the forest needs the Python route (`m10.fit_models` + `check_refit`). Never show a supplied person's forest numbers for edited values.
4. **Forest:** the forest's prediction is the **average of all 100 trees**. If fewer trees are shown or averaged, label it **"partial forest"**. Trees differ because of bootstrap samples (`bootstrap_unique_training_rows`) and random feature choice at each split (`features_tried_per_split`). A spread of tree guesses is **"disagreement"**, never a confidence or prediction interval.
5. **Boosting:** round 0 = `boosting.init` (the training average). `staged[m] = staged[m-1] + corrections[m-1]`. **The corrections already include the learning rate, so never multiply by it again.**
   - Each new tree is fitted to the **training** residuals.
   - Show training and validation RMSE with units and labelled axes.
   - The best round comes from **validation** data. Call it a validation-based choice, never a test result.
   - Learning rate 0.02 may only use `comparison_learning_rate_0_02`. Do not rescale the 0.1 sequence.
6. **Words:** show units everywhere. Use plain language. Describe model associations, never causes (no "lowering your BMI would…"). Don't compare raw RMSE across datasets: each has its own units.

## Hosting
- **GitHub Pages:** static files only (HTML/CSS/JS). There is no Python at runtime. Load `outputs/*.json` with relative paths.
- **Streamlit Community Cloud:** entry point `streamlit_app.py`, every import listed in `requirements.txt`, and relative paths.
- Libraries from a CDN are fine for the static route.
- Static route tip: when a slider moves, redraw only the results, not the slider itself. Replacing the slider while it is being dragged stops the drag. Never commit passwords, tokens or API keys.

## Before you say you're done
Open `check.md` and confirm the app still shows every number in it for Person 1 on all three datasets. Then remind the student to commit and push.
