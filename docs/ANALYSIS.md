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
| Injuries & death | p. 40 | 2d12 table per downed crew member, results change stats permanently or bench someone for one room |
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
- Small station map: a vertical list/graph of visited rooms and the known doors between them; unvisited
  targets show as `Challenge N` with no name. Sealed (No Return) rooms are greyed out.

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
- Pool size, optional target number → rolls d12s, counts evens, flags critical success/failure.

### Settings
- Export / import JSON, start new crew (keeps station layer), wipe everything.

## 3. Out of scope (YAGNI)

- Enemy AI, combat resolution, maps, terrain generation, turn/initiative tracking.
- Rule text, ability descriptions, crew-building validation.
- Skirmish mode, co-op with multiple rosters (one roster per save; co-op players each open the app).
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

```text
// localStorage key (shape sketch, not runnable code) "ssz-captains-log"
{
  schemaVersion: 2,
  station: {                       // survives across crews
    agendaProgress: { data: 1 },   // parts found by any crew
    legacyCount: 0,                // campaign-wide unlock, capped in data.js
    pastCrews: [{ name, outcome, endedInChallenge, challengesCleared, fallen: [...] }]
  },
  run: {                           // one crew's campaign; null before the first crew
    crew: { name, size: 4|6|8, shipType, edge, agenda,
            members: [{ id, name, type, isCommander, stats: {lf,mv,co,re,in},
                        damage, xp, advancementsTaken, abilities, equipment,
                        status: "active"|"recovering"|"dead" }] },
    currentChallenge: 1,
    cleared: [],                   // challenge numbers; "is the current room cleared" and "visited" derive from it
    sealed: [],                    // rooms behind a No Return room, unreachable
    ended: null,                   // null | "lost" | "victory"
    log: [{ challenge, at, text, isNote }]
  }
}
```

`data.js` shape per room: `{ number, name, page, exits: [{label, to}] | {roll: [{max, to}]},
noReturn, turnLimit, agendas: [...], pointers: [{when, page, number}] }`.

## 6. Implementation steps

1. `data.js` from `campaign-data.md`; `state.js` with save/load/export/import.
2. Crew tab: create crew, roster cards, damage/XP steppers.
3. Journey tab: current room, exits, roll, backtrack, No Return.
4. Post-game dialog: injuries → XP → agenda → exit; auto log entries.
5. Log tab + Markdown export; station layer (new crew keeps legacy).
6. Dice tab; visual polish (dark, terminal-ish), phone check.
7. Enable GitHub Pages.

Each step is usable on its own; 1–4 is the MVP.

## 7. Open questions

- Co-op: is one roster per device enough?
- Should exits roll in-app by default, or always ask for the physical dice result?
