# Gallery & votes backend

The website's [Gallery & votes](https://snsie.github.io/regression-activity/gallery.html) page lists the class's apps and collects votes. GitHub Pages can't store data, so the list and votes live in a Google Sheet that you own, behind a small Apps Script web app ([`Code.gs`](Code.gs)). Until it's connected, the page says "The gallery isn't open yet".

## Rules (enforced by the server, not just the page)
- Anyone can add an app link. Each link can be listed only once; `http`/`https`, a trailing `/`, `index.html` and `#…` don't count as different links.
- Each person can vote for each app once, and not for an app they added.
- Votes are anonymous. Each browser keeps a random key that stands for one person (there's no sign-in), and the Sheet stores only salted hashes of it. The **Votes** tab has a different hash for every vote, so you can't tell which votes came from the same person or link them to the apps that person added. No names are stored.
- **Limit:** one browser = one person. Someone could vote again from a private window or another device, or add their app in one browser and vote for it in another. The page asks students not to.

## Setup (about 10 minutes, once)
1. Create a new Google Sheet, e.g. "Explain the Model gallery".
2. In the Sheet, choose **Extensions → Apps Script**. Replace the editor's contents with [`Code.gs`](Code.gs) and save.
3. Save the script. The menu next to **Run** and **Debug** in the toolbar picks the function that **Run** runs, and it starts on `doGet`, which changes nothing. Choose `setup` there, then click **Run**. Approve the permissions; the script only uses this Sheet. This creates the **Sites** and **Votes** tabs.
4. Choose **Deploy → New deployment → Web app**, with:
   - **Execute as:** Me
   - **Who has access:** Anyone

   Click **Deploy** and copy the **Web app URL**. It ends in `/exec`.
5. Put the URL in [`site/gallery.json`](../site/gallery.json):
   ```json
   { "endpoint": "https://script.google.com/macros/s/…/exec" }
   ```
   Commit and push. The site rebuilds, and the gallery opens.

Students never see the Sheet. Keep it private.

To change `Code.gs` later, edit the script and use **Deploy → Manage deployments → Edit → Version: New version**. That keeps the same URL; a *new* deployment would get a new URL.

## During and after class
- **Remove an app** (spam or a mistake): delete its row in **Sites**. Its votes stop counting.
- **Reset** for a new class: delete every row below the header in both tabs. To also start new voter hashes, delete the `SALT` script property (**Project Settings → Script properties**).
- **Close voting:** set `"endpoint": ""` in `site/gallery.json` and push, or archive the deployment (**Deploy → Manage deployments**).
- **Totals:** the page shows them live. In the Sheet, a pivot of **Votes** by `site` gives the same counts.

## Test locally without Google
[`tests/gallery-mock.mjs`](../tests/gallery-mock.mjs) runs the real `Code.gs` against an in-memory Sheet:
```bash
node tests/gallery-mock.mjs 4174 &
GALLERY_ENDPOINT=http://localhost:4174/exec npm run build && npm run preview
```
Chromium-based browsers may block a page on one localhost port from calling another. `tests/e2e.py` routes around this, and `npm test` checks the rules in `Code.gs` directly.
