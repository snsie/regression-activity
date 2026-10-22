"""End-to-end checks for the built or deployed site.

    node scripts/serve.mjs &   # local preview at http://localhost:4173/regression-activity/
    uv run --with playwright python tests/e2e.py http://localhost:4173/regression-activity/
    uv run --with playwright python tests/e2e.py https://snsie.github.io/regression-activity/

(First time: uv run --with playwright python -m playwright install chromium)
Checks links and downloads, help buttons (keyboard and touch), the mobile menu,
demos, saved checklists, page width at several screen sizes, and console errors.
"""

import io
import sys
import urllib.request
import zipfile
from urllib.parse import urljoin, urlparse

from playwright.sync_api import expect, sync_playwright

BASE = sys.argv[1].rstrip("/") + "/"
PAGES = ["", "linear.html", "forest.html", "boosting.html", "data.html", "hosting.html", "submit.html", "glossary.html"]
failures: list[str] = []


def check(ok: bool, msg: str) -> None:
    print(("  ok   " if ok else "  FAIL ") + msg)
    if not ok:
        failures.append(msg)


def fetch(url: str) -> tuple[int, bytes]:
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, b""


with sync_playwright() as p:
    browser = p.chromium.launch()

    # ---- every page loads without errors; every internal link and download resolves
    print("Links and downloads")
    page = browser.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    targets: set[str] = set()
    for path in PAGES:
        resp = page.goto(BASE + path)
        check(resp.status == 200, f"page {path or 'index'} → {resp.status}")
        for attr in ["href", "src"]:
            for v in page.eval_on_selector_all(f"[{attr}]", f"els => els.map(e => e.getAttribute('{attr}'))"):
                if v.startswith(("http", "mailto:", "data:", "#")):
                    continue
                targets.add(urljoin(BASE + path, v).split("#")[0])
    check(not errors, f"no console errors on any page {errors[:3]}")
    for t in sorted(targets):
        status, body = fetch(t)
        check(status == 200 and urlparse(t).path.startswith(urlparse(BASE).path), f"{t.replace(BASE, '')} → {status}")
        if t.endswith(".zip"):
            z = zipfile.ZipFile(io.BytesIO(body))
            names = z.namelist()
            check(z.testzip() is None and "explain-the-model-starter/outputs/sbp.json" in names and
                  "explain-the-model-starter/index.html" in names, f"starter zip valid with {len(names)} files")
    status, _ = fetch(BASE + "no-such-page")
    check(status == 404, f"missing page returns 404 ({status})")

    # ---- help buttons: keyboard
    print("Help buttons")
    page.goto(BASE + "boosting.html")
    helps = page.locator("button.help")
    check(helps.count() >= 10, f"{helps.count()} help buttons on the boosting page")
    labels = helps.evaluate_all("bs => bs.map(b => b.getAttribute('aria-label'))")
    check(all(l and l.startswith("What is") for l in labels), "every help button has an accessible label")
    first = helps.first
    first.focus()
    page.keyboard.press("Enter")
    panel = page.locator("#" + first.get_attribute("aria-controls"))
    expect(panel).to_be_visible()
    check(first.get_attribute("aria-expanded") == "true", "Enter opens the explanation")
    check("Gradient boosting" in panel.inner_text(), "panel shows the right term")
    panel.locator(".help-more").click()
    check(panel.locator(".more").is_visible(), "'Tell me more' reveals more detail")
    page.keyboard.press("Escape")
    check(panel.is_hidden() and first.get_attribute("aria-expanded") == "false", "Escape closes it")
    check(page.evaluate("document.activeElement.classList.contains('help')"), "focus returns to the ? button")
    page.keyboard.press("Space")
    check(panel.is_visible(), "Space opens it too")
    second = helps.nth(3)
    second.click()
    check(panel.is_hidden(), "opening another explanation closes the first")

    # ---- help buttons and menu: touch, small screen
    print("Touch and mobile menu")
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
    m = ctx.new_page()
    m.goto(BASE + "linear.html")
    nav = m.locator("#site-nav")
    check(nav.is_hidden(), "menu collapsed on a phone")
    m.locator(".menu-toggle").tap()
    check(nav.is_visible() and m.locator(".menu-toggle").get_attribute("aria-expanded") == "true", "tapping Menu opens it")
    h = m.locator("button.help").nth(1)
    h.tap()
    check(m.locator("#" + h.get_attribute("aria-controls")).is_visible(), "tapping ? opens the explanation")

    # ---- page width at several screen sizes
    print("Responsive layout")
    for w in [320, 390, 768, 1024, 1440]:
        v = browser.new_page(viewport={"width": w, "height": 900})
        wide = []
        for path in PAGES:
            v.goto(BASE + path)
            v.evaluate("document.querySelectorAll('details').forEach(d => d.open = true)")
            sw = v.evaluate("document.documentElement.scrollWidth")
            if sw > w:
                wide.append(f"{path or 'index'}={sw}")
        check(not wide, f"no sideways scrolling at {w}px {wide}")
        v.close()

    # ---- demos (illustrative numbers from demo-math.js)
    print("Demos")
    page.goto(BASE + "linear.html")
    page.locator("details.demo summary").click()
    page.locator("#lin-exercise").fill("8")
    page.locator("#lin-coffee").fill("3")
    receipt = page.locator("#lin-receipt").inner_text()
    check("−3.2 bpm" in receipt and "+2.0 bpm" in receipt and "68.8 bpm" in receipt, "linear demo: 70 − 3.2 + 2.0 = 68.8")
    page.locator("#lin-exercise").fill("4")
    page.locator("#lin-coffee").fill("2")
    check("69.2" in page.locator("#lin-note").inner_text(), "linear demo: intercept note at the average (69.2)")

    page.goto(BASE + "forest.html")
    page.locator("details.demo summary").click()
    read = page.locator("#forest-readout")
    check("Whole forest" in read.inner_text() and "122.75" in read.inner_text(), "forest demo: all 8 trees average 122.75")
    page.get_by_role("button", name="First 3 trees").click()
    check("Partial forest (3 of 8 trees)" in read.inner_text() and "124.3" in read.inner_text(), "forest demo: first 3 trees average 124.3")
    page.locator(".tree-toggle").first.focus()
    page.keyboard.press("Enter")
    check(page.locator(".tree-toggle").first.get_attribute("aria-pressed") == "false", "tree toggles work from the keyboard")

    page.goto(BASE + "boosting.html")
    page.locator("details.demo summary").click()
    page.get_by_role("button", name="Next round").click()
    step = page.locator("#b-step").inner_text()
    check("Round 1" in step and "3.5" in step, "boosting demo: round 1 tree splits at 3.5")
    page.locator("#b-round").fill("5")
    err = page.locator("#b-err-text").inner_text()
    check("5.22" in err and "Both errors are still falling" in err, "boosting demo: lowest validation error 5.22 at round 5")
    page.locator("#b-round").fill("30")
    err = page.locator("#b-err-text").inner_text()
    check("3.12" in err and "5.94" in err and "lowest at round 5" in err, "boosting demo: round 30 train 3.12, validation 5.94")

    # ---- supplied-data tables match the model output files
    print("Supplied-data numbers")
    import json
    for key, name in [("glucose", "Fasting glucose"), ("sbp", "Blood pressure"), ("fev1", "Lung function")]:
        _, raw = fetch(BASE + f"starter/outputs/{key}.json")
        b = json.loads(raw)
        pid = b["people"][0]["id"]
        for sec, value in [("linear.html", b["linear"]["people"][pid]["prediction"]),
                           ("forest.html", b["forest"]["people"][pid]["prediction"]),
                           ("boosting.html", b["boosting"]["people"][pid]["staged"][-1])]:
            page.goto(BASE + sec)
            row = page.locator("table.check tr", has_text=name).inner_text()
            check(f"{value:,.1f}" in row, f"{sec} {key}: Person 1 shows {value:,.1f}")

    # ---- checklists persist in this browser
    print("Checklists")
    page.goto(BASE + "submit.html")
    page.locator("#fin-1").check()
    page.locator("#fin-3").check()
    page.reload()
    check(page.locator("#fin-1").is_checked() and page.locator("#fin-3").is_checked(), "ticks survive a reload")
    check("2 of 8 done" in page.locator('.checklist-status[data-for="final"]').inner_text(), "progress count shown")

    browser.close()

print(f"\n{'ALL CHECKS PASSED' if not failures else f'{len(failures)} FAILED'}")
sys.exit(1 if failures else 0)
