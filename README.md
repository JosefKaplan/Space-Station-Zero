# Space Station Zero — Captain's Log

A tiny, free, offline-friendly campaign companion for the miniatures game
[Space Station Zero](https://www.snarlingbadger.com) by Snarling Badger Studios.

It replaces the paper roster and the "wait, which room were we in?" notes:

- **Journey** — where your crew is, which exits are open, where you can backtrack to, and what is sealed behind you.
- **Station map** — a map that fills in as you explore: your route, sealed sections, where crew members fell, and the faint trails of crews that came before.
- **Roster** — commander and crew with stats, damage, XP, and reminders when someone has earned an advancement.
- **Crew builder** — pick ship and crew types, spend the commander's points, and add abilities and equipment from pick lists (names and page references only).
- **After the challenge** — a short guided checklist: injuries, experience, agenda roll, pick the next door.
- **Captain's log** — an automatic timeline of the run plus your own notes, exportable as text.
- **Dice** — a d12 pool roller that counts successes for you.

It is spoiler-safe: rooms are revealed only when you reach them, and secrets stay in the book —
the app just tells you which page to open.

> You need the rulebook to play. This app contains no rules text, maps, or story — only numbers,
> names, and page references. Unofficial fan project, not affiliated with Snarling Badger Studios.

## Use it

Open the GitHub Pages URL of this repo. Everything is stored in your browser (`localStorage`);
use **Export** to back up or move a campaign to another device, **Import** to load it.

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

No build, no install.

## Deploy to GitHub Pages

The site is the repo itself: GitHub Pages serves `index.html` from the root of `main`, with no build step.
On a free GitHub plan the repo must be public.

One-time setup:

1. Commit and push everything to `main`:
   ```sh
   git add .
   git commit -m "Captain's Log: first version"
   git push -u origin main
   ```
2. On GitHub open the repo → **Settings** → **Pages**.
3. Under **Build and deployment**, set **Source** to *Deploy from a branch*.
4. Set **Branch** to `main` and the folder to `/ (root)`, then **Save**.
5. Wait a minute or two. The Pages settings screen shows the address once it is live:
   `https://josefkaplan.github.io/Space-Station-Zero/`

After that, every push to `main` redeploys automatically (progress is under the repo's **Actions** tab).
If the phone still shows the old version, reload the page.

Saves are per browser and per address: a campaign started on `localhost` does not appear on the
GitHub Pages address. Move it with **Settings → Export save** and **Import save**.

## Docs

- [`docs/ANALYSIS.md`](docs/ANALYSIS.md) — concept, scope, data model, implementation plan (spoiler-free)
- [`docs/campaign-data.md`](docs/campaign-data.md) — campaign graph used to build the app (**spoilers**)
- [`CLAUDE.md`](CLAUDE.md) — working rules for AI-assisted development
