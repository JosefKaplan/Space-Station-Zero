# Analysis & implementation plan

Spoiler-free. Campaign specifics are in `campaign-data.md`.

## 1. What the game asks you to track

Space Station Zero is a solo/co-op miniatures game. The campaign is 24 numbered "Challenges" (rooms)
connected like a gamebook: finish a room, pick or roll an exit, go to the next number. Between rooms
there is bookkeeping. The table-top part (movement, combat, dice) needs no app; the bookkeeping does.

| Thing | Rule (page) | Why it is annoying on paper |
|---|---|---|
| Current room and exits | p. 43, each challenge | Exits are fixed doors *or* a d12 table, different per room |
| Backtracking | p. 43 | Cleared rooms can be walked through without replaying — you need to know which are cleared |
| No Return | p. 43 | Some rooms seal everything before them |
| Injuries & death | p. 40 | 2d12 table per downed crew member, results change stats permanently or bench someone for one room. A roll of 2 only says "Dead?" and points to a hidden page, so the player must say what that page decided (died or survived) before the room can be cleared |
| Experience | p. 41 | +1 per survivor, +1 commander, room bonuses; two different advancement tables |
| Secondary agenda | p. 38 | Two-part quests found in specific rooms, on a d12 5+; progress carries over to your *next* crew |
| Knowledge shards | p. 8 | Stat bonus plus a pointer into the hidden pages |
| Hidden information | p. 113+ | "Go read p. X, #Y" — must not be read early |
| Legacy between crews | campaign | Death is expected; some things persist across crews, most do not |
| Crew roster | p. 24–39, 121 | 5–9 models, 5 stats each, damage, XP, abilities, equipment |

## 2. Concept: "Captain's Log"

One screen per job, bottom tab bar, phone-first.

### Journey (home)
- Card for the current room: `Challenge N — name`, "Read p. NN", status (in progress / cleared).
- **Reminders** for this room from data: time limit, agenda opportunity (only if it matches your agenda),
  hidden-info pointer, shard.
- **Complete challenge** → opens the post-game flow (below).
- After completion, **exits**: door buttons, or a "Roll d12" button for random-exit rooms (manual override
  allowed — you may prefer real dice). Plus "Backtrack to…" listing cleared rooms still reachable.
- Station map: see § Station map below.

### Crew
- Header: crew size, ship type, edge, secondary agenda (+ progress 0/1/2).
- One card per member: name, type, Lf/Mv/Co/Re/In, damage stepper, XP stepper, free-text abilities
  and equipment, status (active / recovering / dead).
- Advancement badge when XP crosses a threshold; tap to record the chosen stat bump.
- New-crew form is a light builder: crew types are limited to what the ship type allows, the commander's
  3 free stat points are spent in the form, and stats and abilities (name + page) are filled in.
- Roster cards have pick lists that append an ability or a piece of equipment (name + page) to the member's
  free-text notes, so campaign finds can still be typed by hand.
- The app does **not** check crew composition or equipment limits — it points at the page that does.

### Post-game flow (the main time saver)
1. Tick who went Out of Action → for each: roll 2d12 (or enter the result) → outcome applied
   (stat changes, bench for next room, dead, or "see p. 114, #1").
2. XP: survivors +1, commander +1, optional bonus input → advancement prompts.
3. Agenda roll if this room offers your agenda; record success.
4. Shard / hidden-page pointers for this room.
5. Everyone healed to full; pick the exit. A log entry is written automatically.

### Log
- Timeline of auto-entries ("Cleared Challenge 4. Lost Vex. Took the rusted door.") with an editable
  note per room for the narrative. Export as Markdown.
- Graveyard: fallen crew members and previous crews.

### Dice (small)
- Pool size, optional successes needed and target number → rolls d12s, counts evens, says passed or
  how many short, flags critical success/failure.
- Collapsible "How do I make a test?" help: short reminders in the app's own words, each ending in a
  page reference (`DICE_HELP` in `data.js`). Never rulebook wording.

### Settings
- Export / import JSON, start new crew (keeps station layer), wipe everything.

## 3. Out of scope (YAGNI)

- Enemy AI, combat resolution, the book's room maps, turn/initiative tracking.
- Rule text, ability descriptions, crew-building validation.
- Skirmish mode.
- Accounts, cloud sync, PWA/service worker. Revisit only if actually missed.

## 4. Tech

Static site, no build: GitHub Pages serves the repo root.

```
index.html
css/style.css
js/data.js      campaign facts (rooms, exits, tables, thresholds) — the only place they live
js/state.js     load/save/migrate localStorage, export/import, pure state-changing functions
js/app.js       rendering + event handling (template strings, re-render on state change)
docs/
```

Reused: browser built-ins only (`localStorage`, `crypto.getRandomValues` for dice, ES modules,
`<dialog>` for the post-game flow). No library earns its place at this size; a framework would add a
build step for ~500 lines of UI.

## 5. Data model

What is saved (key `ssz-captains-log`) is a list of named **playthroughs**, each a whole separate campaign (own
station layer and run); the app works on the active one's `state` object directly. A save from before playthroughs
loads as "Playthrough 1" and is rewritten on the first change.

```text
// the saved store (shape sketch, not runnable code)
{ schemaVersion: 7, activeId, playthroughs: [{ id, name /* unique, 1-40 chars */, state /* the shape below */ }],
  crewTemplates: [{ id, name, draft /* the creator form as saved */ }], crewTemplatesUpdatedAt }

// one playthrough's state (its own schemaVersion is 6; 5 had a single `run.crew`)
{
  schemaVersion: 6,
  station: {                       // survives across crews
    agendaProgress: { data: 1 },   // parts found by any crew
    legacyCount: 0,                // campaign-wide unlock, capped in data.js
    pastCrews: [{ name, outcome, endedInChallenge, challengesCleared,
                 route: [...], fallen: [{ name, challenge }] }]   // drawn as ghosts on the map
  },
  run: {                           // the party's campaign; null before the first crew
    crews: [{ id, name, size: 4|6|8, shipType, edge, agenda,   // 1 to 4 crews, travelling together
              members: [{ id /* unique across crews */, name, type, isCommander, stats: {lf,mv,co,re,in},
                          damage, xp, advancementsTaken, abilities, equipment,
                          status: "active"|"recovering"|"dead", diedInChallenge }] }],
    currentChallenge: 1,
    route: [1],                    // every room entered, in order, backtracks included
    cleared: [],                   // challenge numbers; "is the current room cleared" and "visited" derive from it
    sealed: [],                    // rooms behind a No Return room, unreachable
    ended: null,                   // null | "lost" | "victory"
    roomSetup: {                   // the current room's table; reset on entering a room
      isMissionStarted: false,     // false = still on the set-up step
      terrain: null                // or { quadrantRolls: [4 × d12], pieces: [{ quadrant, size, x, y }] } in inches
    },
    log: [{ challenge, at, text, isNote }]
  }
}
```

`data.js` shape per room: `{ number, name, page, exits: [{label, to}] | {roll: [{max, to}]},
noReturn, turnLimit, agendas: [...], pointers: [{when, page, number}] }`.

## 6. Station map

The Journey tab draws the station as crews have actually seen it: a dungeon map that fills in, and scars, over time.
It is this app's own drawing. Room positions are invented from the exit graph, not copied from the book.

**Design choices**

- Mood: the darkest surface in the app, like a maintenance display in an unlit corridor. Same ink outlines and
  spray yellow as the rest, with red only for death and sealed sections.
- Fog of war: a room is drawn only once a crew has stood in it. Nothing reveals how big the station is; the
  drawing grows downward as the crew goes deeper.
- Memory: routes and deaths of earlier crews stay on the map for every later crew.

**What is drawn where** (bottom layer first)

| Layer | Drawn as | Source |
| --- | --- | --- |
| Corridors | dark pipes between rooms | every door a crew walked through, plus the doors of rooms this crew has searched |
| Unknown doors | short dashed stub ending in "?" | exits of a searched room that lead somewhere no crew has been |
| Earlier crews' routes | faint pink dotted spray line | `station.pastCrews[].route` |
| This crew's route | yellow spray line | `run.route` |
| Bulkheads | red dashed line marked SEALED | below each cleared No Return room |
| Rooms | numbered box: lit (this crew), dashed outline (earlier crews only), dimmed (sealed), yellow and glowing (here) | `run.cleared`, `run.sealed`, routes |
| Death marks | red crosses above a room (this crew), grey-pink crosses below it (earlier crews) | `member.diedInChallenge`, `pastCrews[].fallen` |

Tapping a room opens a panel under the map: name and page, known doors, who fell there, and that room's log
entries and notes. Room names are shown only for rooms a crew has reached.

**Implementation**

1. Layout in `js/data.js`: `map: [column, row]` per challenge on a 5-column grid, and `via` bend points on exits
   whose straight line would cross another room. Decks follow the "up"/"down" exits; the three sections are
   stacked top to bottom, split at the No Return rooms.
2. Save format v3 (`js/state.js`): `run.route`, `member.diedInChallenge`, and `route` plus located `fallen`
   entries on past crews. Migration rebuilds the route of a v2 save from its log; older deaths have no location.
3. `js/map.js`: builds the SVG from state. No user text goes into it, only numbers and shapes.
4. `js/app.js`: map card on the Journey tab (also shown with no crew aboard, as ghosts only) and the room panel.
5. Not built: pan/zoom, room names on the map itself, per-crew colours, hand-drawn annotations.

## 7. Room set-up and general terrain

Entering an uncleared room opens a set-up step before play, in the book's own order (p. 43–44): read the
briefing, lay out the room's map, add general terrain, place the crew last. "Begin challenge" moves on to the
in-progress view; "Room set-up" there goes back, so the sketch stays reachable during play.

General terrain (`js/terrain.js`, table and sizes in `js/data.js`):

- One d12 per quadrant of the 30" × 22" board (drawn landscape, as the book's maps are), read off the Random Terrain Table.
- Pieces are placed at random whole-inch spots inside their quadrant, at least 2" from every other piece.
  Large pieces are placed first across the whole board; if a layout does not fit, positions are retried
  (the dice stand), up to a cap; the best layout found is kept (see the room-layout notes below).
- The sketch labels pieces A, B, …; the list under it gives each piece's gap to its two nearest board edges.
- Random terrain is never moved by hand: it only changes by rolling again. Without an imported room layout the app does
  not know the room's own terrain, objectives or starting zone, so it cannot keep the pieces off them.
- The step is shown in every room; a room whose set-up says it has no terrain is the player's call to skip.
- Not built: tickable steps, keeping a room's layout after leaving it, dragging pieces, scatter terrain.

Room layouts (`js/room-layouts.js`, optional): the room's own footprint comes from the owner's private
`local/room-layouts.json` (gitignored), loaded at start and stored under its own `localStorage` key
`ssz-room-layouts`, apart from the save (schema in the README). It is never part of an export and never in the repo.

- `fetchLocalRoomLayouts` (room-layouts.js) tries `local/room-layouts.json` next to the app at every start and, if
  served, validates it and replaces the stored copy; a 404 (GitHub Pages) is silently ignored, an invalid file is an error.
- Per challenge number: `fixedTerrain` and `enemyAreas` rectangles, `markers` (objectives and drop points; a
  `diameter` makes one a circle), one `crewZone` rectangle and an optional `note`, in inches from the top-left corner,
  in the orientation the book prints (30" × 22"), so the sketch can be compared with the page.
  Layout file `schemaVersion` 2. Validated on import (known challenge, inside the board); a bad file is
  rejected and the old layouts stay; a stored file that stops validating shows an error instead of vanishing.
- The sketch imitates the printed map: grey/black/hatched room terrain (`look`), teal crew zone, pink enemy areas
  with the number of models in each (`perCrew` split over `areas`, one crew), black objective circles; the random
  pieces are solid yellow-outlined boxes with letters and a shadow, so they cannot be mistaken for the room's own terrain (dashed, translucent or hatched). Zone labels are drawn above random pieces. The set-up step lists each with its distance to the nearest
  board edges, so it can be built with a tape measure.
- Random terrain keeps the 2" gap from fixed terrain and from circular markers (the square around them), both when
  rolled. The crew zone and enemy areas are kept free while there is room for every piece (then overlapped as a last
  resort); drop points are not avoided.
- A piece goes in its own quadrant; if the room's terrain leaves no spot there, anywhere else on the board; if there
  is none at all, it is kept in `terrain.unplacedPieces` and shown as "no room" (the rooms whose own terrain leaves
  too little space). Saves without the field mean none unplaced, so no migration.
- Importing layouts clears terrain already rolled for the room being set up, since it ignored the room's terrain.
- The same entry can carry a short briefing: `enemies` (name, count, where, optional when/hidden), `enemyNote`,
  `crewNote`, `hazards`, `deadline`, `goal`. What is in a room (briefing, layout, text) is shown only for the room the crew has reached, and a spoiler warning
  comes before entering it (exits, set-out bar), not inside the room. The room card is one flow: a summary (where the crew and each enemy group set up, goal, deadline, hazards), the board with the roll button,
  measurements and the random pieces in folded lists, and a sticky "Begin challenge" / "Challenge over" button.
- The map is interactive and animated (CSS only, off with `prefers-reduced-motion`): hovering or tapping any area,
  object or piece shows its details in an info line under the map (`ui.boardInfo`); the legend entries are buttons
  that light one kind up and dim the rest (`ui.boardFocus`); the crew zone's dashes march, enemy areas pulse,
  circular objectives ping, rolled pieces drop in (only on the render right after a roll). Taps on the map and the
  legend update it in place (`refreshBoardInteractions`) instead of re-rendering, so animations are not restarted
  and the tapped item stays lit (`.selected`). Neither state is saved.
  The info line gives an item's distance from all four board edges, and dashed measuring lines with the distances are
  drawn on the map from each edge to the tapped or hovered item (`renderMeasurementLinesSvg`, into `#board-measure`;
  rectangles are measured to their sides, circular objectives and drop points to their centre).
- Random terrain never covers the middle 80% × 60% of a zone (where its label sits); only the zone's edge can be
  overlapped, and such pieces are drawn translucent.
- Not built: per-room versions of the layout.

## 8. Implementation steps

1. `data.js` from `campaign-data.md`; `state.js` with save/load/export/import.
2. Crew tab: create crew, roster cards, damage/XP steppers.
3. Journey tab: current room, exits, roll, backtrack, No Return.
4. Post-game dialog: injuries → XP → agenda → exit; auto log entries. Opening it ticks everyone who went down in the room (marked out of
   action in the turn tracker, or at 0 Life); "Roll 2d12 for all" rolls for each ticked member who has no roll yet.
5. Log tab + Markdown export; station layer (new crew keeps legacy).
6. Dice tab; visual polish (dark, terminal-ish), phone check.
7. Enable GitHub Pages.

Each step is usable on its own; 1–4 is the MVP.

## 9. Open questions

- Should exits roll in-app by default, or always ask for the physical dice result?

## 10. Playthroughs and parties of several crews

- **Playthroughs.** Separate campaigns kept side by side and named by the owner (header picker). Everything about one,
  crews and their stats included, lives inside it, so nothing crosses between playthroughs. Switching, adding, renaming
  and deleting are in `js/state.js` (`switchPlaythrough`, `addPlaythrough`, ...); export saves all of them, importing
  a backup replaces everything, importing a single old campaign adds it as a new playthrough.
- **Parties.** A run holds `crews` (1 to `MAX_CREWS` = 4) that always travel together: one route, one cleared list, one
  log. More crews can join later (`addCrew`); one can leave (`removeCrew`, remembered in `pastCrews`); retiring retires
  the whole party (`retireParty`). Save `schemaVersion` 6 turned the single `run.crew` into `run.crews`.
- Each crew has its own roster, XP, injuries and secondary agenda. Agenda progress is counted per agenda key at the
  station, so two active crews cannot chase the same agenda (refused when adding).
- The post-game form lists every crew's members; each crew with an advancing agenda gets its own checkbox.
- The book's "per crew" enemy counts are multiplied by the crews taking part (those with someone able to play the
  room). With two or more crews taking part the co-op stat bar of the Warship and CONTROL is the one shown in full.

## 11. Save sync (optional)

Saves can mirror to the owner's own Supabase project (`js/cloud-sync.js`, setup in `docs/SYNC.md`, database in
`docs/supabase-setup.sql`). This is the one allowed exception to "nothing leaves the browser" (CLAUDE.md rule 4).

- **Locked down:** sign-ups off; sign-in is email + password, then a TOTP code (Supabase MFA, plain `fetch`, no
  library). The `playthroughs` table's row-level security only lets the owner's `aal2` session read or write its
  rows, so a password alone or the public anon key gets nothing. The client also refuses to sync before the TOTP step.
- **Model:** the browser copy stays the main one. One row per playthrough (`owner, id, name, state jsonb, updated_at ms,
  deleted`). Each playthrough carries `updatedAt`, moved only by saves that really change it (so tab clicks never
  upload); the newest change wins. A deletion leaves a `deleted` marker that other devices honour.
- **When:** pull + merge + upload on start, when the tab becomes visible again (at most every 20 s), and ~1.5 s after a
  change. Cloud rows are untrusted: each is validated like an imported save and a bad one is skipped and reported.
  An untouched starter "Playthrough 1" neither uploads nor outlives playthroughs that arrive from the cloud.
- **Failure:** offline or server errors leave the local save untouched and show "Sync failed" in Settings → Sync.
- Not built: sharing one playthrough between accounts, conflict merging inside a playthrough (last change wins).
- Tests use a local mock of the endpoints (never the live project).
- The first-time authenticator QR is drawn in the app (`js/qr.js`: a dependency-free QR encoder, byte mode, level M,
  versions 1-10) from the `otpauth://` link Supabase returns; the secret and the link are shown as text too. Verified by
  decoding the generated codes with the browser's `BarcodeDetector`.

## 12. Saved starting crews

- **What they are.** A saved starting crew is the creator's form as it was when saved: name, size, ship, edge, commander
  (name and free points), crew types and names, and the starting gear (p. 36: one weapon each, the other pieces for the
  whole crew with who carries them, the commander's bonus piece). It is a recipe, not a live crew: the secondary agenda is
  not part of it, and nothing a campaign's crew earns (XP, boosts, equipment) ever reaches it. Using one makes a fresh
  crew with its own ids, 0 XP and the gear already on the roster; the list lives in the store, so every playthrough sees it.
- **Where they are managed.** Settings → Starting crews: create, edit (the same form as the crew builder, without the secondary
  agenda), rename (not to another one's name) and delete, independent of the running campaign. The Crew tab lists them to use
  or adjust when a crew is being made; adjusting never changes the saved one.
- **Gear rules** are data (`startingGearRules` in `js/data.js`): the pieces a ship's categories allow, `STARTING_OTHER_EQUIPMENT`
  plus the ship's extra pieces, an edge that adds more (Smugglers), and Advanced Technology for the commander's bonus.
  `sanitizedStartingGear` in `js/state.js` drops anything the current ship and edge do not allow.
- **Syncing.** The list travels as one extra row (id `crew-templates`) in the same cloud table as the playthroughs;
  newest change wins, like a playthrough.

## 13. Co-op notes

With two or more crews that can play the room, the room card gets a folded "Co-op" note: the book's co-op rules in this app's
own words with page references (`COOP_REMINDERS` in `js/data.js`), and, when the private room text is loaded, the sentences of
that room's rules that speak of crews, picked out by a pattern so nothing that depends on the number of crews is missed.
Numbers are still computed only where they are data (enemies "per crew"). Skirmish challenges (crews against each other)
are a different mode and are not covered.

## 14. Versus (skirmish) mode

Source: p. 100–112. In a skirmish, crews fight each other instead of exploring; each of the six challenges has a start area per
player, markers, one obstacle and a way to score.

**What the book says (rules, not wording).** Skirmish games use the standard rules with these changes: a d12 roll-off (ties
roll again) decides the first activation, with clockwise activations for more than two players; a roll-off decides who is Crew 1 to 4
(their start areas); commanders should be within 3 experience of each other; terrain is random (p. 43), there is no preset
terrain. Every challenge is for two to four players and ends after the fifth turn. The d12 table: 1–2 Resource War, 3–4 Base
Attack, 5–6 Code Raiders, 7–8 Sealed In, 9–10 Environmental Controls, 11–12 The Lab. Scoring, per turn unless noted:

| Challenge | Victory points |
|---|---|
| Resource War | 1 per resource token controlled; 1 per Uncertain Floors test passed |
| Base Attack | no points: most non-drone crew members in the defenders' territory at the end of turn 5; the attacker goes first |
| Code Raiders | 1 per information node controlled; 1 per node hacked |
| Sealed In | 1 per enemy put Out of Action; 2 per turret disabled or taken over |
| Environmental Controls | 2 per control system held; 1 per enemy crew member put Out of Action |
| The Lab | 2 per Experiment Vat halted; 1 per Deranged Mutant put Out of Action |

The book also offers, for skirmish campaigns, the normal post-game steps and an optional rule that an injury roll of 6–11 (Dead) counts as
12–17 (Full Recovery).

**What the app does.** `state.versus = { match, history }` per playthrough (so it syncs with it; the playthrough's `schemaVersion` is 7).
A `match` is the pure data in `js/skirmish.js`: players, start order, roles (Base Attack), first player, phase
(setup → playing → finished), turn, this turn's counts, finished turns' counts, random terrain. The app counts: points
come from the counts, a turn is closed with "End turn" (and can be taken back), a `finalOnly` line (Base Attack) counts only on
the last turn, and the winner is the highest total (all on the top total share a win). The challenge facts (names, pages, scoring,
start areas, marker positions, stat numbers of the drones, turrets and mutants) are data in `js/data.js`
(`SKIRMISH_CHALLENGES`); the start areas and markers were measured from the book's six maps (board 30" × 22", as in the campaign).
Markers that depend on the number of players (`minPlayers`, `forPlayer`: one turret per crew, three vats per crew) appear only for
the players taking part. The book's own text of each challenge is private (`local/skirmish-texts.json` via `local/extract-skirmish-texts.py`,
carried in `local/crew-rules.json` as `skirmishes`) and shown in a folded section when loaded.

**Not covered.** Vat wake-up progress and the turrets' and mutants' own activations are played at the table, not tracked.
Players are people at the table, not campaign crews: the match does not track life or equipment. With three players Base Attack
is split one attacker against two defenders, because the book only describes one or two of each.

## 15. Offline use and installing

`manifest.webmanifest` (name, colours, icons 192/512 PNG plus the SVG) makes the app installable; `sw.js`, registered by `js/app.js`,
makes it work offline. The worker is **network first**: every request for one of this site's own files tries the network (revalidating,
with a 4 s timeout so a weak signal does not hold the app up), keeps the answer, and falls back to the kept copy when the network does
not answer. So an online visit always gets the newest files (there is no version number to bump) and an offline visit gets the files
of the last online visit, which were all fetched together. It never touches another origin (the sync server) or the private
`local/` files. `FILES_TO_KEEP_AT_INSTALL` in `sw.js` lists the files kept at the first visit so that the very first offline start works;
a new module should be added there, but forgetting it is harmless (it is kept the first time it loads). The header shows an "offline"
chip when the browser reports no connection. Saves were always in `localStorage`, so editing offline needs nothing else; the sync
(`js/cloud-sync.js`) simply waits for the connection.

## 16. Turn tracker

Source: p. 13–15 (activation and the roll to keep the initiative) and p. 42 (enemy AI). A card at the top of a room being played
(`renderTurnTracker`, logic in `js/turns.js`, state in `run.roomSetup.turns`, so it is saved, synced and reset for every room;
state `schemaVersion` 12).

- **The turn.** The crew has the first activation. After each activation the side rolls a d12 to keep the initiative: 6+ after its
  1st activation, 10+ after the 2nd, 12+ after every later one (the book's example of play calls the first roll "6+"). A failed roll
  passes the initiative to the other side; the turn is over when everyone, crew and enemies, has activated once. Both sides use the
  same numbers (enemies roll "as normal", p. 42).
- **What the card does.** Chips for every crew member able to play (all crews of a party together): tap = activated, ✕ = out of action.
  It shows who has the initiative, the number the next roll needs, a roll button (or "rolled it: kept / lost" for rolls made by hand,
  also for abilities that keep the initiative without a roll), the enemies (§ 17), "Enemies are done" (tap again to take it back),
  and a button for the next turn. A room's time limit (`turnLimit`) shows as a chip and turns to a warning on the last turn.
- **Enemy AI.** While the enemies have the initiative, the card shows the book's enemy action list (p. 42). Its wording is the book's, so
  it is not in the repo: it comes from the private `local/crew-rules.json` (`enemyAi`, made by `local/extract-crew-rules.py`, copied by
  "Copy room texts to my database"). Without it the card only points at p. 42 and p. 22.
- **Where the book is silent: the initiative coming back.** The book gives the roll numbers only for a run of activations and says
  a failed roll passes the initiative; it does not say what the numbers do when the initiative returns. Decided by the owner:
  **the count starts again every time a side gets the initiative back.** The first activation of the new run is free (the book
  never asks for a roll to take the initiative back), and the roll after it needs 6+ again, then 10+, then 12+. The tracker keeps
  that count in `turns.run`. The other reading (the count carries across the whole turn: the 3rd crew activation always needs 12+)
  was the first version of the tracker and was dropped.
- **No roll when it would mean nothing.** A side with nobody left hands the initiative on without a roll, and nobody rolls when the
  other side has nobody left to take it (every enemy has gone or is out of action): the side just goes on. This is the app's reading
  of "the turn is over when everyone has activated once": a failed roll could not take anything away.
- **Not covered.** Skirmish (versus) matches, and abilities that change the roll (only "kept by hand" is offered; "Determined Leader"
  (p. 41, once per challenge) and the other once-per-X abilities are marked as used in § 19).

## 17. The room's enemies

Source: p. 12 and p. 21 (Life, damage, out of action), p. 22 (hidden enemies activate last), p. 42 (enemy AI). The enemies of the
room being played, each with its Life (`js/enemies.js`, pure; state in `run.roomSetup.enemies`, saved and synced with the room, empty
for every new room; state `schemaVersion` 12; schema 8 saves get an empty list, schema 9 ones no Combat stat).

- **The list.** `[{ id, name, number, life, damage, armor, combat, isHidden }]` (`combat` is the Combat stat, null when unknown). `life` is the Life stat, `damage` the Life lost; at
  `damage >= life` the enemy is out of action and removed from play. Models of one kind are numbered ("Drone #2"); a single one is not.
- **Where it comes from.** When the crew begins a challenge, the list is built from the room's briefing and stat bars, which are the
  owner's private room text (`js/room-layouts.js`, only there): each group's size ("per crew" times the crews taking part, or a plain
  number) and the stat bar of the same kind, the solo or co-op bar to match the party. Hidden enemies come last. Groups that come
  later (the briefing gives a condition for them) are offered as "Add N× …" buttons, and groups without a number or a stat
  bar are named under the list to be added by hand. Without the private text (GitHub Pages before signing in) the list is empty
  and enemies are added by hand (name and Life); the tracker then falls back to counting the enemies' activations.
  Going back to the set-up and in again keeps the list and its damage.
- **In the tracker.** Each row is the enemy's chip: tap = activated (like a crew chip), Life as `2/3` with tappable pips (up to 12 Life;
  tap a pip to set the Life, the last full pip again takes it away) and −1 / +1 buttons (−5 as well above 12 Life: the large ones).
  Armor is shown on the row. An enemy that is out stops needing an activation; when the last one to go is put down, the enemies' side
  of the turn is over and the initiative moves on without a roll (§ 16).
- **Scaling with the crews.** A group's size is its per-crew number times the crews taking part (a crew counts when someone in it can play
  the room), and the solo or co-op stat bar is chosen to match. The list is built once, when the challenge begins: after another crew
  joins, clear it and list the enemies again.
- **Not covered.** An enemy's stats beyond Life, armor and Combat are in the room's stat table above the list. The attack and the
  defence against it are § 18.

## 18. Combat calculator

Source: p. 17 (criticals), p. 20–21 (combat steps), p. 22 (cover). A button in the room card opens it (`renderCombat`, rules in
`js/combat.js`, pure; the choices live only in the screen, nothing about it is saved). One exchange at a time:

- **Choose** an attacker and a defender: a crew member, an enemy standing on the list (§ 17), or "someone else" whose dice you set by
  hand; Close (within 1") or Ranged; cover for the defender (Ranged only); swap the two to let an enemy hit back.
- **The dice.** Attacker: Combat + the weapon's bonus dice + any extra dice. Defender: Combat (+ extra; a weapon's dice do not count in
  defence, except for the one weapon that says it does). A crew member's weapon is read from their equipment text (`carriedWeapons`),
  an enemy's Combat and armor from the list. The Armor stepper starts at the defender's armor (an Armored Jacket, or the enemy's
  stat bar); other armor, and armor with a condition, is set by hand.
- **The steps.** The attacker counts even results that reach the defender's armor (armor is the target number; none: every even
  result); the defender counts every even result; more successes for the attacker: the difference is the damage; equal: nothing; more
  for the defender: the attacker takes the difference in a Close attack, nothing in a Ranged one. Two or more 12s double a roll's
  successes, two or more 1s fail it, unless it also has two 12s. The Dice tab uses the same scoring (`scorePool`).
- **Cover** raises the armor by 2 against a Ranged attack; without armor that is 4+ (p. 22). A Close attack ignores cover. A weapon
  that ignores armor (the Energy Melee Weapon) sets the target aside.
- **Roll or type.** "Roll both" rolls the dice; "I rolled my own dice" takes the results typed in (the table's real dice) and scores
  them the same way.
- **Apply.** The damage goes to whoever it hurt in one tap, once: an enemy loses Life (and drops out of the turn at 0), a crew
  member's damage goes up (capped at their Life) and at 0 Life they are marked out of action in the turn tracker. Roll on the injury
  table after the challenge as usual.
- **The weapon table** (`WEAPON_PROFILES` in `js/data.js`) holds numbers only: bonus dice, Close or Ranged, and two flags. It is the one
  place the calculator needs the book's gear numbers; names and numbers, no rule text.
- **Not covered.** Abilities that change a roll (extra dice from an ability, re-rolls) are typed in as extra dice; armor that works
  only against some attacks; area attacks; damage that is not combat (saves, falls).

## 19. Preparation and once-per-X abilities

Source: p. 32 (Weapon Tuning), p. 33 (Armor Tuning), and the ability, edge and equipment entries that limit their use. Two parts.

**Before the challenge: tunings** (`js/preparation.js`, pure; state `run.roomSetup.tunings`, new for every room, state `schemaVersion` 12).
A card "Before you begin" in the set-up screen, above "Begin challenge".
- **Weapon Tuning** (Engineer, Chief Engineer): each one taking part picks one weapon, which adds 1 die more for this challenge.
  **Armor Tuning** (Scientist, Lead Scientist): each one picks one piece of armor, whose armor value goes up by 2 for this challenge.
- **Decided by the owner:** only members taking part can tune (not one sitting out); any crew's weapon or armor in the party may be
  tuned (co-op included); armor with a plain value (the Armored Jacket) is counted in the calculator by itself, the other armor
  (Chem-Protection Suit, Ablative Shields, which work only against some attacks or in another way) is tuned too but its value is raised by hand.
- **Rules of the list.** `[{ kind, tunerId, carrierId, item }]`: one tuning per tuner, and the same piece cannot be tuned twice (two
  Sidearms carried by two crew members are two weapons). Once the challenge has begun the tunings stand, even if the tuner goes down.
  A tuned Heavy Melee Weapon (it adds its dice to its wearer's defence too) is +1 there as well.
- **Effects.** The room card shows what is tuned; the combat calculator adds the die to the weapon (in the list of weapons and in the
  dice line, as "weapon, tuned") and the 2 to the defender's armor value, and notes armor it cannot add up by itself.
- Removing a crew member or a crew also removes them from the tunings and the turn tracker (a save that still named them was refused as damaged).

**During the challenge: once per turn / challenge / game** (`js/limited-use.js`, pure; names and frequency in `LIMITED_USE` in `js/data.js`).
Chips under the crew in the turn tracker, grouped by how often, for the members taking part and the crews' edges: Combat Specialist,
Hive Mind, Time Masters, Chemically Enhanced, Logistics Expert, Sneaky Scoundrel and the Drone System (per turn); Bypass, Emergency
Med-Patch and Determined Leader (per challenge); Survival Specialist (per game). A chip is found by the name appearing in the member's
abilities or equipment text (or being the crew's edge). Tap = used (struck out), tap again to take it back.
Marks: once per turn in `turns.used` (a new turn clears it), once per challenge in `roomSetup.used` (a new room clears it), once per game in
`run.usedForGame` (the whole run). Only names and frequencies are in the code; what each does is in the book and the private notes.

**Also at the start of a challenge** (§ 20): the Stim-Shot (used up, +2 Life and Move for the room) and the choice of a Shielding or a
Targeting Drone for each Drone System, in the same card. **Not covered.** Suggesting who should make the Hidden-enemy spotting test
(p. 22); Time Masters and similar abilities that change the rules are only marked, not applied.

## 20. Equipment, item by item

Source: p. 36–38 (all equipment), p. 24–31 (what each ship may take), p. 34 (Armored Force, Smugglers). Audited against the book's text:
names, categories, pages, which ship takes which category, the starting allowance (one weapon each, three other pieces, the Pirate's two,
the commander's bonus piece, the Smugglers' three) and every item's numbers. What each piece does is in the book (p. 36–38) and the private notes, not here. Equipment is free text on each member (one piece per line); a
piece counts when its name is in it (`carriedItems` in `js/gear.js`: longer names first, so a Hyper-Scanner is not also a Scanner). The numbers
are in `js/data.js` (`WEAPON_PROFILES`, `ARMOR_ITEMS`, `EQUIPMENT_EFFECTS`, `TEST_KINDS`, `STIM_SHOT`, `MED_PATCH`, `DRONES`); no rule wording.

| Piece | Numbers it uses (`js/data.js`) | Where the app uses it |
|---|---|---|
| Scanner | `testDice.spotHidden` 1 | Dice tab, "Test for a crew member" |
| Medi-Bag | `testDice.medicalAttention` 2 | the same |
| Sidearm | Ranged, 2 dice | combat calculator |
| Melee Weapon | Close, 2 dice | combat calculator |
| Armored Jacket | armor 4 | combat calculator (defender's armor) |
| Antitoxin | `testDice.lifeVsChemical` 2 | test roller |
| Stabilization Module | no number: one reroll per module carried | after the challenge: "Reroll (Stabilization Module)", once per roll |
| Hazard Suit | `testDice.life` 1 | test roller |
| Emergency Med-Patch | `MED_PATCH.heal` 3, once per challenge | tracker: pick who, "Heal" |
| Stim-Shot | `STIM_SHOT.stat` Life 2, Move 2; single use | "Before you begin" or the tracker: used up, Life and Move +2 in the room |
| Energy Melee Weapon | Close, 3 dice, `ignoresArmor` | combat calculator |
| Energy Missile Weapon | Ranged, 3 dice | combat calculator |
| Heavy Kinetic Missile Weapon | Ranged, 3 dice, `isKinetic` | combat calculator (Kinetic matters for Ablative Shields) |
| Heavy Melee Weapon | Close, 3 dice, `isKinetic`, `addsToDefense` | combat calculator |
| Hyper-Scanner | `testDice.reaction` 2 | test roller |
| Chem-Protection Suit | `chemicalDamageCut` 2, no armor value | a note on a Life test against a Chemical; tuned by hand |
| Advanced Tech Kit | `testDice.alienTech` 3 | test roller |
| Mini-Lab Kit | `testDice.intelligence` 1 | test roller |
| Ablative Shields | armor 8, `onlyAgainst` rangedKinetic | calculator: counted only for a Ranged Kinetic attack |
| Jump Boots | `stat.mv` 2, `flies` | Move shown with the boost on the Crew tab |
| Drone System | Shielding: `stopsUpTo` 4; Targeting: `bonusDice` 2 beyond 3" | drone chosen per challenge in the set-up; the calculator offers the shield on the result and the dice on a far target |
| Point-to-Point Teleporter | none | not modelled (movement is played on the table) |
| Heads-Up Display | `statOnTest.spotHidden.re` 2, `extraDieOnTest` reaction | test roller: the stat, the extra die rolled and the worst one discarded |
| Armored Force (edge) | Power Armor, armor 6 | calculator: armor 6 for the crew; Power Armor can be tuned like any armor |

**Fixed in this audit** (the app did less or something else before): Armored Force armor, Ablative Shields' condition, a Ranged attack
needing a weapon without the Close keyword (a crew member with none, or a Close-only one, attacks within 1"), Jump Boots' Move, the eight pieces
that add dice to tests (they were only notes), the Med-Patch healing, the Drone System, the Stabilization Module's reroll, the Stim-Shot,
and the four item notes in `local/crew-rules.json` that ran on into the next section's heading (`local/extract-crew-rules.py`).

**Checked and right:** the names and pages of the five categories, each ship's categories (Medical: General and Medical; Science: General
and Scientific Gear; War: General and Advanced Weaponry; Shipping: all; Pirate: all but Advanced Technology, and two more pieces; Exploration:
General, Medical and Scientific), the allowance of one weapon per crew member and three other pieces, the commander's bonus piece from the
ship's lists or Advanced Technology, the Smugglers' three extra pieces of Advanced Weaponry or Advanced Technology, the weapon numbers.

**Decided where the book is silent** (say if one should change): the three "other pieces" may be weapons as well (the book says "other
pieces", and the Smugglers' extras are weapons); the drone is chosen for each challenge (the book does not say when); a Stim-Shot can be used
at any time in the room and taken back for a slip; only one Stim-Shot works for a member in a room; each Stabilization Module gives one reroll
and a rerolled roll is not rerolled again; the Heads-Up Display's discard is made by the app (the worst die, a failure and a 1 first); the
Shielding Drone also stops damage a Close attack turns back on its user.

**How it works.** A Stim-Shot is used with `useStimShot` (state.js): the piece leaves the member's equipment and the member is listed in
`run.roomSetup.stimmed`; their Life and Move are shown, and used for out of action, 2 higher (`effectiveStat`) until the room is left, which clears the list
(everyone is healed after a challenge anyway). The drone choices are in `run.roomSetup.drones`. State `schemaVersion` 12.
