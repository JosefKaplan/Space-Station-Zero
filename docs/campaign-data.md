# Campaign data — SPOILERS

> **Stop here if you are playing the campaign blind.** This file lists every room name, every exit,
> and where the secrets are. It exists only as the source for `js/data.js`.
> It contains facts and page references, no text from the book.

## Rooms

`→` fixed exits (player chooses). `d12` random exit. **NR** = No Return.

| # | Name | Page | Exits | Notes |
|---|---|---|---|---|
| 1 | Docking Bay Access Port | 45 | d12: 1→2, 2–4→3, 5–8→4, 9–11→5, 12→6 | Obstacles rolled at setup |
| 2 | The Darkened Hall | 47 | →6 | |
| 3 | Repair Bay | 49 | →4 | Limit: end of turn 4 |
| 4 | Fabrication Bay | 52 | →3, →2, →6 | |
| 5 | Medical Bay | 54 | →2 | Agenda: Data, Medicine |
| 6 | Pod 6 | 57 | **NR** d12: 1–3→7, 4–6→10, 7–9→13, 10–12→15 | Limit: end of turn 5. Pointer p.114 #2 (when the book says so) |
| 7 | Science Lab | 60 | →8, →15, →9 | Agenda: Data, Biology |
| 8 | Disused Bay | 63 | →7, →10 | Shard: p.114 #4 |
| 9 | Chemical Lab | 65 | →7, →11 | |
| 10 | Smelting Factory | 67 | →12, →8 | |
| 11 | Greenhouse | 69 | →12, →13, →9 | Agenda: Rescue, Medicine |
| 12 | Environmental Control Room | 72 | →11, →15, →10 | Agenda: Biology, Tech |
| 13 | Weapons Locker | 75 | →14 | Agenda: Weapons |
| 14 | Barracks | 78 | →16 | |
| 15 | Disused Bay | 80 | →7, →12 | |
| 16 | Shuttle Bay | 81 | **NR** d12: 1–6→17, 7–9→18, 10–11→19, 12→20 | Shard after completion: p.115 #6 |
| 17 | Trash Storage | 85 | →19 | Pointer at start of turn 3: p.115 #7 |
| 18 | Prison | 86 | →19 | |
| 19 | Disused Bay | 88 | →17, →18, →21, →22 | Limit: end of turn 3 |
| 20 | Hologram Bay | 91 | →21 | If repaired: p.115 #8 + shard |
| 21 | Bar | 92 | →22 | |
| 22 | Engine Room | 94 | →23 | Limit: end of turn 5 |
| 23 | Control Room | 96 | →24 | Optional outcome → p.116 #9, sets a station-level legacy flag (persists for future crews, stacks once more) |
| 24 | Master System | 99 | — (end) | p.116 #10 |

Exit labels (door names) are on the listed pages; add them to `data.js` when implementing.

## Secondary agendas (p. 38–39)

Roll at crew creation, d12: 1–2 Rescue, 3–4 Tech, 5–6 Biology, 7–8 Data, 9–10 Weapons, 11–12 Medicine.
In a matching room, after clearing it: d12, 5+ means the item is there (some then need a test — see the room's page).

| Agenda | Rooms | Parts needed | On completion |
|---|---|---|---|
| Rescue | 11 | 1 | Extra crew member (0 XP) |
| Tech | 12 | 1 | Equipment reward |
| Biology | 7, 12 | 2 | Shard: p.114 #3 |
| Data | 5, 7 | 2 | Shard: p.115 #5 |
| Weapons | 13 | 1 | Stat reward |
| Medicine | 5, 11 | 2 | Equipment reward |

Partial progress carries over to a later crew that takes the same agenda (station layer).

## Tables

**Injuries & death** (2d12, p. 40): 2 → p.114 #1 · 3–5 all stats −1 · 6–11 dead · 12–17 full recovery ·
18–20 misses next challenge · 21–23 one stat +1 · 24 all stats +1.

**XP** (p. 41): each survivor +1, commander +1 more, plus room bonuses.
Commander thresholds 7 / 14 / 21 / 28 / 35 (stat, ability, stat, ability, stat).
Crew thresholds 5 / 10 / 15 / 25 / 30 (Lf or Mv; Co, Re or In; alternating).

**Base stats by crew size** (Lf/Mv/Co/Re/In): eight 3/4/2/3/2 · six 4/4/3/3/3 · four 6/4/4/4/4.
Commander: base + ship bonus + 3 free points.

**Ship type → commander bonus:** Medical +1 In · Science +1 In · War +1 Co · Shipping +1 Lf · Pirate +1 Mv · Exploration +1 Re.

**Crew type → bonus:** Medical Officer +1 In · Soldier +1 Co · Engineer +1 Re · Scientist +1 In · Pilot +1 Re ·
Senior Physician +2 In · Lead Scientist +2 In · Veteran Soldier +2 Co · Chief Engineer +1 In +1 Re · Ace Pilot +2 Re.

**Edges** (names only, p. 34–36): Armored Force, Nano Tech, Psionic Talent, Telekinesis, Artificial Life Forms,
Warrior Born, Hive Mind, Harmonious Culture, Natural Brutes, Smugglers, Shapeshifters, Time Masters,
Chemically Enhanced, Parasites.

**Dice:** d12 pool, evens succeed (at or above the target number if there is one); two natural 12s = critical
success (doubles successes, beats a critical failure); two natural 1s = critical failure.
