// Equipment and what it does to a crew member's stats and tests (p. 36–38). Pure: no DOM, no storage. A member's equipment is free text
// (one piece per line as the pickers write it, or typed by hand); a piece counts when its name is in it. The numbers are in
// js/data.js (EQUIPMENT_EFFECTS, STIM_SHOT, TEST_KINDS); the weapons and armor in WEAPON_PROFILES and ARMOR_ITEMS (js/combat.js).
import { EQUIPMENT_CATEGORIES, EQUIPMENT_EFFECTS, STIM_SHOT, TEST_KINDS, equipmentLine } from './data.js';

const STAT_NAMES = { lf: 'Life', mv: 'Move', co: 'Combat', re: 'Reaction', in: 'Intelligence' };

const ALL_ITEM_NAMES_LONGEST_FIRST = Object.values(EQUIPMENT_CATEGORIES).flatMap((category) => category.items).sort((a, b) => b.length - a.length);

// Every piece of equipment named in the text, in the order they stand, once for each time it is named (two Stim-Shots are two).
// Longer names are taken first, so "Melee Weapon" inside "Energy Melee Weapon" and "Scanner" inside "Hyper-Scanner" are not counted
// as pieces of their own.
export function carriedItems(equipmentText) {
  let remaining = String(equipmentText ?? '').toLowerCase();
  const found = [];
  for (const name of ALL_ITEM_NAMES_LONGEST_FIRST) {
    const lowerName = name.toLowerCase();
    for (let at = remaining.indexOf(lowerName); at !== -1; at = remaining.indexOf(lowerName)) {
      found.push({ name, at });
      remaining = remaining.slice(0, at) + '\u0000'.repeat(lowerName.length) + remaining.slice(at + lowerName.length);
    }
  }
  return found.sort((a, b) => a.at - b.at).map((entry) => entry.name);
}

export const carries = (equipmentText, itemName) => carriedItems(equipmentText).includes(itemName);

// ---------- stats ----------

// what changes a crew member's stat right now, as [{ source, amount }]: gear that always applies (Jump Boots) and a Stim-Shot used in this room
export function statBonusParts(member, stat, { isStimmed = false } = {}) {
  const parts = [...new Set(carriedItems(member.equipment))]
    .filter((item) => EQUIPMENT_EFFECTS[item]?.stat?.[stat])
    .map((item) => ({ source: item, amount: EQUIPMENT_EFFECTS[item].stat[stat] }));
  if (isStimmed && STIM_SHOT.stat[stat]) parts.push({ source: STIM_SHOT.item, amount: STIM_SHOT.stat[stat] });
  return parts;
}

export const effectiveStat = (member, stat, options) => member.stats[stat] + statBonusParts(member, stat, options).reduce((total, part) => total + part.amount, 0);

// ---------- equipment text ----------

// takes one named piece out of the text, with its "(p. 37)" and the line or comma it stood on
export function removeItemLine(equipmentText, itemName) {
  const escaped = itemName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(equipmentText ?? '')
    .replace(new RegExp(`${escaped}(?:\\s*\\(p\\. [^)]*\\))?`, 'i'), '')
    .replace(/[ \t]*,[ \t]*(?=,|\n|$)/g, '')
    .replace(/^[ \t]*,[ \t]*/gm, '')
    .replace(/\n[ \t]*(?=\n)/g, '')
    .replace(/^\s+|\s+$/g, '');
}

export const addItemLine = (equipmentText, itemName) => [String(equipmentText ?? '').trim(), equipmentLine(itemName)].filter(Boolean).join('\n');

// ---------- tests ----------

// The dice pool of a crew member for a kind of test: the stat, what each piece of equipment adds, the Heads-Up Display's higher stat
// on a spotting test, and whether one more die is rolled and one discarded (the Heads-Up Display on any Reaction test).
export function testPool(member, testKey, options) {
  const kind = TEST_KINDS[testKey];
  if (!kind) throw new Error(`Unknown test: ${testKey}.`);
  const items = [...new Set(carriedItems(member.equipment))];
  const stat = effectiveStat(member, kind.stat, options);
  const parts = [{ source: `${STAT_NAMES[kind.stat]} stat`, dice: stat }];
  const notes = [];
  for (const item of items) {
    const effects = EQUIPMENT_EFFECTS[item] ?? {};
    for (const [coveredKind, dice] of Object.entries(effects.testDice ?? {})) if (kind.covers.includes(coveredKind)) parts.push({ source: item, dice });
    for (const [coveredKind, stats] of Object.entries(effects.statOnTest ?? {})) if (kind.covers.includes(coveredKind) && stats[kind.stat]) parts.push({ source: item, dice: stats[kind.stat] });
    if (effects.chemicalDamageCut && testKey === 'lifeVsChemical') notes.push(`${item}: damage from this Chemical is ${effects.chemicalDamageCut} less.`);
  }
  const hasExtraDie = items.some((item) => kind.covers.includes(EQUIPMENT_EFFECTS[item]?.extraDieOnTest));
  if (hasExtraDie) notes.push('Heads-Up Display: one more die is rolled and the worst one discarded.');
  return { kind, parts, total: parts.reduce((sum, part) => sum + part.dice, 0), hasExtraDie, notes };
}

// which die to discard (the Heads-Up Display lets the player choose): a failure if there is one, the lowest first, so a die that
// could make a critical failure (a 1) goes before the rest; with only successes, the lowest of them
export function discardedIndex(faces, targetNumber = 0) {
  const isSuccess = (face) => face % 2 === 0 && face >= targetNumber;
  return faces.map((face, index) => ({ face, index })).sort((a, b) => Number(isSuccess(a.face)) - Number(isSuccess(b.face)) || a.face - b.face || a.index - b.index)[0].index;
}
