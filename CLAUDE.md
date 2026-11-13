# Space Station Zero — Captain's Log

Campaign companion for the tabletop game *Space Station Zero* (Snarling Badger Studios).
Tracks a crew's journey from room to room: where they are, where they can go, who is alive,
XP, agenda progress, and a narrative log. It is a tracker, not a rules engine.

Read `docs/ANALYSIS.md` for the concept and implementation plan.
`docs/campaign-data.md` holds the campaign graph — it is full of spoilers (see below).

## Stack

- Plain HTML + CSS + vanilla JS (ES modules). No framework, no build step, no dependencies, no backend.
- State lives in `localStorage`; JSON export/import is the only backup/sync.
- Hosted on GitHub Pages straight from the repo root of `main`. All paths must be relative.
- Run locally: `python3 -m http.server 8000` in the repo root, open `http://localhost:8000`.

## Hard rules

1. **No rulebook content in the repo.** The repo is public and the rulebook is a paid, copyrighted,
   watermarked PDF. Never commit the PDF, extracted text, flavour text, hidden-information text,
   maps, or full rule/ability wording. Allowed: challenge numbers and names, exit graph, page
   references ("read p. 45"), table thresholds, stat numbers, names of ship types / crew types /
   edges / equipment. When the player needs wording, point at the page.
2. **Spoiler safety.** The owner plays the campaign blind. The UI reveals a challenge's name only
   once the crew has reached it; unvisited rooms show as "Challenge N". Hidden information is only
   ever a pointer ("p. 114, #2"), shown at the moment the book would send you there.
   In chat, do not quote or summarise story content from the book or from `docs/campaign-data.md`.
3. **No git writes** (`add` / `commit` / `push`) — tell the owner when one is needed.
4. **Nothing leaves the browser.** No analytics, CDNs, web fonts, or external requests.

## Conventions

- Keep it small: a new file or abstraction needs a reason. No dependency unless it clearly beats ~50 lines of own code.
- Campaign facts live in `js/data.js` only — never hard-code a challenge number or threshold elsewhere.
- Two layers of state, never mixed: **station** (persists across crews: completed agendas parts, legacy flags)
  and **run** (one crew's campaign). See `docs/ANALYSIS.md` § Data model.
- Saved state carries a `schemaVersion`; changing the shape means writing a migration, not breaking old saves.
- Mobile first — it is used at the gaming table on a phone or tablet. Big tap targets, works offline once loaded.
- Fail loudly: a corrupt save or bad import shows an error and keeps the old state; never silently reset.
- Verbose, self-documenting names; comments only for the why.
