# Explain the Model

**App:** _paste your public link here_

An app that explains three regression models to someone with no machine-learning background: how a straight-line model adds up feature pushes, how a forest of trees averages its guesses, and how boosting improves one correction at a time. Datasets: NHANES fasting glucose, blood pressure and lung function.

## What's here
| File | What it is |
|---|---|
| `AGENT_BRIEF.md` | Rules for your AI coding agent (have it read this first) |
| `SETUP.md` | How to run and publish (GitHub Pages or Streamlit) |
| `check.md` | Numbers your finished app must still show |
| `index.html`, `app.js`, `m10.js` | GitHub Pages route |
| `streamlit_app.py`, `m10.py`, `requirements.txt` | Streamlit route |
| `outputs/` | Reference model outputs (field guide: `outputs/SCHEMA.md`) |
| `data/` | The three datasets and the data dictionary |

## Run locally
- GitHub Pages route: `python -m http.server 8000`, then open <http://localhost:8000>
- Streamlit route: `uv run --with streamlit,pandas,numpy streamlit run streamlit_app.py`
