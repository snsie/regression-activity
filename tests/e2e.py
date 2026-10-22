"""End-to-end checks for the built or deployed site.

    node scripts/serve.mjs &   # local preview at http://localhost:4173/regression-activity/
    uv run --with playwright python tests/e2e.py http://localhost:4173/regression-activity/
    uv run --with playwright python tests/e2e.py https://snsie.github.io/regression-activity/

(First time: uv run --with playwright python -m playwright install chromium)
Checks links and downloads, help buttons (keyboard and touch), the mobile menu,
demos, saved checklists, page width at several screen sizes, and console errors.
The gallery is checked against a local mock of its backend (tests/gallery-mock.mjs),
so no real votes are cast, even when testing the deployed site.
"""

import io
import re
import subprocess
import sys
import time
import urllib.request
import zipfile
from urllib.parse import urljoin, urlparse

from playwright.sync_api import expect, sync_playwright

BASE = sys.argv[1].rstrip("/") + "/"
PAGES = ["", "linear.html", "forest.html", "boosting.html", "data.html", "hosting.html", "submit.html", "gallery.html", "glossary.html"]
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
            check(f"{value:,.1f}" in row, f"{sec} {key}: Example person 1 shows {value:,.1f}")

    # ---- checklists persist in this browser
    print("Checklists")
    page.goto(BASE + "submit.html")
    page.locator("#fin-1").check()
    page.locator("#fin-3").check()
    page.reload()
    check(page.locator("#fin-1").is_checked() and page.locator("#fin-3").is_checked(), "ticks survive a reload")
    check("2 of 8 done" in page.locator('.checklist-status[data-for="final"]').inner_text(), "progress count shown")

    # ---- gallery & votes, against the local mock backend
    print("Gallery & votes")
    page.goto(BASE + "gallery.html")
    configured = page.locator("#gallery").get_attribute("data-endpoint")
    if not configured:
        check(page.locator(".gallery-closed").is_visible() and page.locator("#add-form").is_hidden(),
              "with no backend configured, the page says the gallery isn't open yet")
    # The page calls a stand-in Apps Script URL, which Playwright forwards to the mock
    # (Chromium won't let a page call a different localhost port directly).
    mock_port = 4175
    mock_url = "https://script.google.com/macros/s/e2e-mock/exec"
    mock = subprocess.Popen(["node", "tests/gallery-mock.mjs", str(mock_port)], stdout=subprocess.PIPE)
    mock.stdout.readline()  # waits until it's listening
    try:
        def point_at_mock(route):
            html = route.fetch().text()
            route.fulfill(body=re.sub(r'data-endpoint="[^"]*"', f'data-endpoint="{mock_url}"', html),
                          headers={"content-type": "text/html; charset=utf-8"})

        def to_mock(route):
            route.fulfill(response=route.fetch(url=f"http://localhost:{mock_port}/exec"))

        def person(c=None):
            c = c or browser.new_context()
            c.route(BASE + "gallery.html", point_at_mock)
            c.route(mock_url, to_mock)
            pg = c.new_page()
            pg.on("pageerror", lambda e: errors.append(str(e)))
            pg.goto(BASE + "gallery.html")
            return pg

        def row(pg, name):
            return pg.locator(".gallery-item", has_text=name)

        errors.clear()
        alice = person()
        expect(alice.locator(".gallery-status")).to_have_text("No apps yet. Add the first one above.")
        alice.locator("#add-url").fill("alice.github.io")
        alice.get_by_role("button", name="Add to the list").click()
        check("starting with https://" in alice.locator("#add-msg").inner_text() and
              alice.locator("#add-url").get_attribute("aria-invalid") == "true", "a link without https:// is refused")
        alice.locator("#add-url").fill("https://alice.github.io/explain-the-model/")
        alice.locator("#add-title").fill("Alice's app")
        alice.get_by_role("button", name="Add to the list").click()
        expect(row(alice, "Alice's app")).to_be_visible()
        check("Added by you" in row(alice, "Alice's app").text_content() and
              row(alice, "Alice's app").locator(".vote-button").count() == 0, "your own app is marked, with no Vote button")
        check(alice.locator("#add-url").input_value() == "", "the form clears after adding")
        alice.locator("#add-url").fill("http://alice.github.io/explain-the-model/index.html")
        alice.get_by_role("button", name="Add to the list").click()
        expect(alice.locator("#add-msg")).to_have_text("That app is already in the list.")

        bob = person()
        a_row = row(bob, "Alice's app")
        expect(a_row).to_be_visible()
        check("Added by you" not in a_row.text_content(), "another person doesn't see it as theirs")
        check(a_row.locator("a").get_attribute("target") == "_blank" and
              "noopener" in a_row.locator("a").get_attribute("rel"), "app links open safely in a new tab")
        a_row.get_by_role("button", name="Vote for Alice's app").click()
        expect(a_row.locator(".vote-done")).to_have_text("✓ You voted")
        check(a_row.locator(".vote-count").inner_text() == "1 vote", "the vote is counted")
        check(bob.evaluate("document.activeElement.classList.contains('vote-done')"), "focus stays on the app after voting")
        bob.reload()
        expect(row(bob, "Alice's app").locator(".vote-done")).to_have_text("✓ You voted")
        check(row(bob, "Alice's app").locator(".vote-button").count() == 0, "after a reload, you still can't vote again")
        bob.locator("#add-url").fill("https://bob.streamlit.app")
        bob.get_by_role("button", name="Add to the list").click()
        expect(row(bob, "bob.streamlit.app")).to_be_visible()
        check(row(bob, "bob.streamlit.app").locator(".gallery-title").inner_text() == "bob.streamlit.app",
              "an app without a name is listed by its address")

        api = "(a) => fetch(a.url, {method: 'POST', body: JSON.stringify({action: 'vote', id: a.id, key: localStorage.getItem('explain-the-model:gallery-key')})}).then(r => r.json())"
        a_id = row(bob, "Alice's app").get_attribute("data-id")
        b_id = row(bob, "bob.streamlit.app").get_attribute("data-id")
        r = bob.evaluate(api, {"url": mock_url, "id": a_id})
        check(not r["ok"] and "already voted" in r["error"], "the server refuses a second vote from the same person")
        r = alice.evaluate(api, {"url": mock_url, "id": a_id})
        check(not r["ok"] and "you added" in r["error"], "the server refuses a vote for your own app")

        carol = person()
        btn = row(carol, "bob.streamlit.app").get_by_role("button", name="Vote for bob.streamlit.app")
        btn.focus()
        carol.keyboard.press("Enter")
        expect(row(carol, "bob.streamlit.app").locator(".vote-done")).to_be_visible()
        row(carol, "Alice's app").get_by_role("button").click()
        expect(row(carol, "Alice's app").locator(".vote-count")).to_have_text("2 votes")
        carol.locator("#gallery-sort").select_option("votes")
        check(carol.locator(".gallery-item").first.inner_text().startswith("Alice's app"), "sorting by votes puts the most-voted app first")
        carol.locator("#gallery-sort").select_option("name")
        check(carol.locator(".gallery-item").first.inner_text().startswith("Alice's app"), "A–Z sorting")
        carol.locator("#gallery-sort").select_option("new")
        check(carol.locator(".gallery-item").first.inner_text().startswith("bob.streamlit.app"), "newest-first sorting")
        check("2 apps, 3 votes" in carol.locator(".gallery-summary").inner_text(), "summary shows apps and total votes")

        alice.get_by_role("button", name="Refresh").click()
        expect(row(alice, "Alice's app").locator(".vote-count")).to_have_text("2 votes")
        check(row(alice, "Alice's app").locator(".vote-done").inner_text() == "Your app", "still no vote button on your own app")
        check(not errors, f"no script errors in the gallery {errors[:3]}")

        nostore = browser.new_context()
        nostore.add_init_script("Storage.prototype.setItem = () => { throw new Error('blocked'); }")
        ns = person(nostore)
        expect(ns.locator(".gallery-item")).to_have_count(2)
        check(ns.locator(".gallery-key-note").is_visible(), "a browser that can't save the key is warned")

        for w in [320, 390]:
            c = browser.new_context(viewport={"width": w, "height": 900})
            v = person(c)
            expect(v.locator(".gallery-item")).to_have_count(2)
            sw = v.evaluate("document.documentElement.scrollWidth")
            check(sw <= w, f"gallery with apps has no sideways scrolling at {w}px ({sw})")
            c.close()
    finally:
        mock.terminate()

    browser.close()

print(f"\n{'ALL CHECKS PASSED' if not failures else f'{len(failures)} FAILED'}")
sys.exit(1 if failures else 0)
