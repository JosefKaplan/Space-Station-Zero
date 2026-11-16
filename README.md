# Space Station Zero — Captain's Log

A tiny, free, offline-friendly campaign companion for the miniatures game
[Space Station Zero](https://www.snarlingbadger.com) by Snarling Badger Studios.

It replaces the paper roster and the "wait, which room were we in?" notes:

- **Playthroughs** — keep several named campaigns side by side (solo, co-op, a second try): each has its own crew, route, log, agenda progress and station legacy. Switch from the header.
- **Party** — 1 to 4 crews in one playthrough (two players, say): they travel together, each with its own roster, XP and agenda. Enemy counts follow the number of crews, the co-op stat bars light up, and a "Co-op" note in each room lists what changes with several crews (and, with the private room text, the room's own rules about crews). Add a crew from the Crew tab or from the room set-up.
- **Sync (optional)** — keep a copy of every playthrough in your own free Supabase database, behind your password and a TOTP code, so a cleared browser or a new phone loses nothing ([`docs/SYNC.md`](docs/SYNC.md)). Off until you set it up; nothing leaves the browser without it.
- **Versus** — the book's six skirmish challenges (p. 100–112), crews against each other for 2–4 players: pick one or roll the d12, set the player names, roll for start positions and first activation (or the attacker/defender roles in Base Attack), roll the random terrain around the start areas and objectives, then keep score turn by turn with tap counters. It adds up the points, ends after the last turn, names the winner (or the draw) and keeps a list of earlier matches. Matches are saved with the playthrough and sync with it.
- **Turn tracker** — in a room being played: who has the initiative, who has activated this turn, the number the next roll to keep the initiative needs (6+, 10+, 12+) with a roll button, the enemies' activations, the room's time limit and, while the enemies move, the book's enemy action list (p. 42; its text comes from your private rules file, otherwise the card points at the page).
- **Enemies** — the room's enemies as a list with Life pips: tap one when it activates, take Life off with the buttons or by tapping a pip, and it is out of action at 0. The list is made from the room's briefing when you begin the challenge (it needs the private room text, see below), or you add enemies by hand. The initiative count starts again each time a side gets the initiative back.
- **Combat calculator** — one attack and the defence against it, as the book's steps (p. 20–22): pick the attacker and defender (crew or a listed enemy), Close or Ranged, cover; it adds up the dice (Combat + the weapon's bonus), counts the successes against the armor, doubles on a critical, and tells you who takes how much. Roll in the app or type the results of your own dice; one tap applies the damage to the enemy list or the crew member.
- **Gear** — the equipment does what the book says (p. 36–38): the Dice tab rolls a test for a crew member with the dice their gear adds (Scanner, Hyper-Scanner, Heads-Up Display, Hazard Suit, Antitoxin, Mini-Lab Kit, Advanced Tech Kit, Medi-Bag), the calculator counts Armored Force armor and Ablative Shields (against Ranged Kinetic attacks only), an Emergency Med-Patch heals, the Stabilization Module rerolls an injury roll, and Jump Boots show the higher Move. [`docs/ANALYSIS.md`](docs/ANALYSIS.md) § 20 lists every item.
- **Preparation** — before you begin a challenge: each Engineer tunes a weapon (+1 die) and each Scientist an armor (+2), a Stim-Shot can be used (+2 Life and Move for the room, then it is gone), and each Drone System gets a Shielding or Targeting Drone. In the room, tap the once-per-turn, once-per-challenge and once-per-game abilities as you use them; a new turn and a new room free the right ones.
- **Journey** — where your crew is, which exits are open, where you can backtrack to, and what is sealed behind you.
- **Station map** — a map that fills in as you explore: your route, sealed sections, where crew members fell, and the faint trails of crews that came before.
- **Roster** — commander and crew with stats, damage, XP, and reminders when someone has earned an advancement.
- **Info notes** — on the Crew tab, folded notes under a member's abilities and equipment (and under the crew's edge) say what each one does, in the book's own words. They come from your private `local/crew-rules.json` (below) and do not exist without it.
- **Starting crews** — the crew builder has empty slots for the starting gear (one weapon each, the other pieces, the commander's bonus piece, as the book limits them), so a new crew starts fully equipped. Manage them under Settings → Starting crews (create, edit, delete: it works while another campaign is running), or save the crew you are building. Use one for any new campaign: you always get a fresh, fully geared copy, and what a crew earns later never changes the saved one. They sync with your saves.
- **Crew builder** — pick ship and crew types, spend the commander's points, and add abilities and equipment from pick lists (names and page references only).
- **After the challenge** — a short guided checklist: injuries, experience, agenda roll, pick the next door. Everyone marked out of action in the turn tracker (or at 0 Life) is ticked for the injury roll already; one button rolls the 2d12 for all of them, or roll one at a time, or type the result of your own dice.
- **Captain's log** — an automatic timeline of the run plus your own notes, exportable as text.
- **Dice** — a d12 pool roller that counts successes for you.
- **Room set-up** — rolls the book's random terrain and sketches it on the board with distances from the edges, around
  the room's own footprint (fixed terrain, enemy spots, crew zone) from the room footprints.

It is spoiler-safe: rooms are revealed only when you reach them, and secrets stay in the book —
the app just tells you which page to open.

> You need the rulebook to play. This repo contains no rules text or story — only numbers, names, page references and
> the room footprints (where the terrain and start zones sit on each map). The book's own room text and ability
> descriptions are never in this repo, only in private local files you build yourself (see below). Unofficial fan project, not
> affiliated with Snarling Badger Studios.

## Built with

Plain HTML, CSS and JavaScript (ES modules, no framework, no build step, no dependencies), SVG for the maps, `localStorage`
for the saves, GitHub Pages for hosting, and optionally your own Supabase project (Postgres and Auth) for synced saves.

## Use it

Open the GitHub Pages URL of this repo. Everything is stored in your browser (`localStorage`);
use **Export** to back up or move all playthroughs to another device, **Import** to load them (a backup replaces everything; the save of a single campaign is added as a new playthrough).
Or set up the optional sync below and your saves follow you to every device.

After one visit the app also works **offline** (a small service worker, `sw.js`, keeps the app's own files) and can be
**installed**: in the browser's menu choose "Install app" or "Add to Home Screen". An online visit always gets the newest version;
a chip in the header says when there is no connection, and syncing waits until it is back.

## Optional: sync your saves (Supabase)

Without this, saves live in one browser only and a cleared browser loses them. With it, every playthrough is also kept in
your own free Supabase database, locked behind your password **and** an authenticator (TOTP) code, so nothing is lost and
every device sees the same campaigns. Nothing is sent anywhere until you sign in. Full guide: [`docs/SYNC.md`](docs/SYNC.md).

One-time setup, about 10 minutes:

1. Create a free project at [supabase.com](https://supabase.com).
2. **SQL Editor**: paste and run [`docs/supabase-setup.sql`](docs/supabase-setup.sql). It makes the `playthroughs` table and the
   rule that only your own TOTP-verified session can touch it.
3. **Authentication → Sign In / Providers**: switch **off** "Allow new users to sign up", set the minimum password length
   to 12 or more, and (not required) switch off "Enable magic links and email OTP".
4. **Authentication → Users → Add user**: your email and a long password, "Auto Confirm User" ticked.
   Check that **Authentication → Multi-Factor** has TOTP enabled.
5. **Project Settings → API Keys**: copy the project URL and the **publishable** key into [`js/config.js`](js/config.js).
   Both are public by design. Never put a secret or `service_role` key anywhere in this repo.
6. Open the app, then **Settings → Sync**: sign in. The first time, scan the QR code with an authenticator app and type
   the 6-digit code. Do this once on each address you use (localhost, your GitHub Pages URL, ...).

Keep the authenticator's secret in a password manager too: losing it locks you out of the cloud copy (the local copy still works).

## Room layouts

The footprint of each room (crew start zone, enemy areas, fixed terrain, objective markers) is in
[`data/room-footprints.json`](data/room-footprints.json), public, so the sketch matches the book's map everywhere,
GitHub Pages included. Without more, a room shows its map and tells you to see the book for which enemies are there.

Optionally, a private file adds each room's briefing and the book's own text. Run from the project folder
(`python3 -m http.server 8000`), the app loads `local/room-layouts.json` by itself at every start and merges it over the
footprints: enemies and where each group sets up, hazards, goal, deadline, the enemy stat table, and the lore and rules
in folded sections. It is kept in your browser's storage afterwards and the repo never contains it (`local/` is
gitignored). Served from anywhere else (GitHub Pages) there is no such file, so the app shows the footprints only until you sign in to the sync.
To get the private part on your phone and on GitHub Pages, copy it to your own database with Settings → Sync → "Copy room texts to my database" and sign in on the other device ([`docs/SYNC.md`](docs/SYNC.md)); signing out removes it again.
After changing `local/room-layouts.json`, run `python3 local/export-room-footprints.py` to refresh the public footprints
(it copies only the geometry).

The format, for both files (the public one holds only `crewZone`, `enemyAreas`, `fixedTerrain` and `markers`):

```json
{ "schemaVersion": 2,
  "rooms": { "<challenge number>": {
    "note": "optional text shown in the room's set-up",
    "crewNote": "optional, when there is no starting zone",
    "enemyNote": "optional text", "goal": "optional text", "deadline": "optional text",
    "hazards": ["short names"],
    "lore": "optional, the book's read-aloud text", "rules": [{ "title": "Set-Up", "blocks": [{ "t": "p | li | table", "x": "text", "rows": [["table cells"]] }] }],
    "stats": [{ "name": "Enemy", "lf": 3, "mv": 4, "co": 2, "re": 2, "in": 1, "armor": "optional" }],
    "enemies": [{ "name": "Enemy", "count": "2 per crew", "where": "E1 and E2, split evenly", "perCrew": 2, "areas": ["E1", "E2"], "when": "optional", "hidden": false }],
    "crewZone": { "x": 0, "y": 0, "width": 22, "height": 6 },
    "enemyAreas": [{ "x": 0, "y": 0, "width": 7, "height": 6, "label": "E1" }],
    "fixedTerrain": [{ "x": 0, "y": 0, "width": 4, "height": 3, "label": "optional", "look": "black | gray | hatched" }],
    "markers": [{ "x": 0, "y": 0, "label": "FR", "diameter": 3 }] } } }
```

A spoiler warning is shown before you enter a room (on the exits and the set-out bar); once you are in, the room card
shows everything: your crew's start zone, the enemies and where each group sets up, the enemy stat table, goal,
deadline and hazards, the board, and the lore and the book's rules for the room in folded sections.

Inches, on the board as the book prints it (30" across, 22" deep), origin at the top-left corner. A marker with a `diameter` is a circle centred on
the point; without one it is a plain point (a drop spot). Random terrain keeps its 2" gap from fixed terrain and from
circular markers; if a piece fits nowhere, the set-up says "no room" for it.
Bad files are rejected with the path of the problem, and the previous layouts stay.

The same applies to the info notes: `python3 local/extract-crew-rules.py` reads what abilities, equipment, edges and
commander abilities do from your PDF into `local/crew-rules.json`, which the app loads the same way. The script stops and lists
any name from `js/data.js` it cannot find in the book. Served from anywhere else (GitHub Pages) there is no such file and no notes.

`.env` (gitignored; format in `.env.example`) holds the private link and local path of the rulebook PDF
for whoever builds that file.

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
GitHub Pages address by itself. Either sign in to the sync (above) on both, or move it with **Settings → Export save** and
**Import save**. The sync works from any address, Pages included; the private briefings and book text below come to the other address only after you sign in (see "Room layouts").

## Docs

- [`docs/ANALYSIS.md`](docs/ANALYSIS.md) — concept, scope, data model, implementation plan (spoiler-free)
- [`docs/campaign-data.md`](docs/campaign-data.md) — campaign graph used to build the app (**spoilers**)
- [`docs/SYNC.md`](docs/SYNC.md) — optional save sync: setup, how it is locked down, how it behaves
- [`CLAUDE.md`](CLAUDE.md) — working rules for AI-assisted development
