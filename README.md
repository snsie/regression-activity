# Explain the Model: M10 in-class activity

**Website: <https://snsie.github.io/regression-activity/>**

Students build one public app that explains three regression models (linear regression, random forest and gradient boosting) to someone with no machine-learning background. Each app covers NHANES fasting glucose, systolic blood pressure and lung function (FEV₁).
- **Timing:** about 105 minutes of building, then 30 minutes of peer review and voting.
- **Requirements:** each app needs a free public link and a GitHub backup.

## What's here
| Folder | What it is |
|---|---|
| [`starter/`](starter) | **The student starter.** It is also downloadable as a zip from the website. Contents: the three datasets and their dictionary (`data/`), the precomputed model outputs (`outputs/`), plain three-section apps for GitHub Pages (`index.html`, `app.js`, `m10.js`) and Streamlit (`streamlit_app.py`, `m10.py`), plus `AGENT_BRIEF.md`, `SETUP.md` and `check.md`. |
| [`site/`](site) | Website source: page fragments (`pages/`), `layout.html`, the glossary (`terms.json`), and styles and scripts (`assets/`). |
| [`scripts/`](scripts) | `build.mjs` builds the site into `dist/` and zips the starter. `serve.mjs` previews it under the same subpath GitHub Pages uses. |
| [`tests/`](tests) | `demo-math.test.mjs` checks the illustrative demos against scikit-learn. `e2e.py` checks links, downloads, help buttons, keyboard and touch use, layout and demos in a browser. |

## Build and preview
Requires Node 20 or later; there are no npm dependencies.
```bash
npm run build      # → dist/
npm test           # demo math
npm run preview    # http://localhost:4173/regression-activity/
uv run --with playwright python tests/e2e.py http://localhost:4173/regression-activity/   # browser checks
```

Pushing to `main` runs [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). It builds and tests the site, then publishes `dist/` to the `gh-pages` branch. GitHub Pages serves that branch (**Settings → Pages → Deploy from a branch → `gh-pages` / root**).

## Data
- **Source:** CDC/NCHS National Health and Nutrition Examination Survey (NHANES) 2017–2018 and 2011–2012 public-use files.
- **Preparation:** with the [regression-app](https://github.com/snsie/regression-app) pipeline. `starter/data/manifest.json` records the source commit, package versions and row counts.
- **Models:** fitted with scikit-learn on a fixed 80/20 split (seed 0). The settings are listed on the website's Data & files page.
