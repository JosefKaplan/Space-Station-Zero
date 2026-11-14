# Space Station Zero — Captain's Log

Campaign companion for the tabletop game *Space Station Zero* (Snarling Badger Studios).
Tracks a crew's journey from room to room: where they are, where they can go, who is alive,
XP, agenda progress, and a narrative log. It is a tracker, not a rules engine.

Read `docs/ANALYSIS.md` for the concept and implementation plan.
`docs/campaign-data.md` holds the campaign graph — it is full of spoilers (see below).

Rulebook source: the owner's paid, watermarked PDF, kept outside the repo. Its private link and local path
are in the gitignored `.env` (`RULEBOOK_PDF_URL`, `RULEBOOK_PDF_LOCAL_PATH`); `.env.example` shows the format.

## Stack

- Plain HTML + CSS + vanilla JS (ES modules). No framework, no build step, no dependencies, no backend.
- State lives in `localStorage`; JSON export/import is the only backup/sync.
- Hosted on GitHub Pages straight from the repo root of `main`. All paths must be relative.
- Run locally: `python3 -m http.server 8000` in the repo root, open `http://localhost:8000`.

## Hard rules

1. **No rulebook content in the repo.** The repo is public and the rulebook is a paid, copyrighted,
   watermarked PDF. Never commit the PDF, extracted text, flavour text, hidden-information text,
   maps, or full rule/ability wording. Room footprints (fixed terrain, enemy spots, crew zone) are map content:
   they live only in the owner's gitignored `local/room-layouts.json`, imported into the browser's localStorage
   (`js/room-layouts.js`). The same file holds each room's short briefing (enemy names and counts, hazards,
   deadline, goal) and the book's own room text (lore, rules, enemy stat bars), extracted by
   `local/extract-room-texts.py`. Never write any of it into tracked files, commits, chat, or examples built from real data. Allowed: challenge numbers and names, exit graph, page
   references ("read p. 45"), table thresholds, stat numbers, names of ship types / crew types /
   edges / equipment. When the player needs wording, point at the page.
2. **Spoiler safety.** The owner plays the campaign blind. The UI reveals a challenge's name only
   once the crew has reached it; unvisited rooms show as "Challenge N". Hidden information is only
   ever a pointer ("p. 114, #2"), shown at the moment the book would send you there.
   In chat, do not quote or summarise story content from the book or from `docs/campaign-data.md`.
   Room layouts, briefings and the book's room text are spoilers too: the UI shows them only for the room the crew
   has reached, and warns about spoilers before a room is entered (at the exits and on the set-out bar).
3. **No git writes** (`add` / `commit` / `push`) — tell the owner when one is needed.
4. **Nothing leaves the browser.** No analytics, CDNs, web fonts, or external requests.

## Conventions

- Keep it small: a new file or abstraction needs a reason. No dependency unless it clearly beats ~50 lines of own code.
- Campaign facts live in `js/data.js` only — never hard-code a challenge number or threshold elsewhere.
- Two layers of state, never mixed: **station** (persists across crews: completed agendas parts, legacy flags)
  and **run** (one crew's campaign). See `docs/ANALYSIS.md` § Data model.
- Saved state carries a `schemaVersion`; changing the shape means writing a migration, not breaking old saves.
- The look is fixed and must not depend on a device's dark/light setting: `color-scheme: only dark` (meta and CSS), explicit
  backgrounds on the map and tables, no `prefers-color-scheme` rules.
- Mobile first — it is used at the gaming table on a phone or tablet. Big tap targets, works offline once loaded.
- Fail loudly: a corrupt save or bad import shows an error and keeps the old state; never silently reset.
- Verbose, self-documenting names; comments only for the why.
