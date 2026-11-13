// Campaign facts. The only place challenge numbers, thresholds and page references live.
// Facts and pointers only — no text from the rulebook (see CLAUDE.md).

export const STAT_KEYS = ['lf', 'mv', 'co', 're', 'in'];
export const STAT_LABELS = { lf: 'Lf', mv: 'Mv', co: 'Co', re: 'Re', in: 'In' };

export const BASE_STATS_BY_CREW_SIZE = {
  4: { lf: 6, mv: 4, co: 4, re: 4, in: 4 },
  6: { lf: 4, mv: 4, co: 3, re: 3, in: 3 },
  8: { lf: 3, mv: 4, co: 2, re: 3, in: 2 },
};

// commanderBonus and commanderAbility apply to the commander only; crew composition rules are on `page`
export const SHIP_TYPES = {
  Medical: { page: 26, commanderBonus: { in: 1 }, commanderAbility: 'Senior Doctor', extraStartingEquipment: 0,
    crewTypes: ['Medical Officer', 'Soldier', 'Engineer', 'Scientist', 'Pilot', 'Senior Physician'],
    equipmentCategories: ['general', 'medical'] },
  Science: { page: 27, commanderBonus: { in: 1 }, commanderAbility: 'Practiced Scientist', extraStartingEquipment: 0,
    crewTypes: ['Medical Officer', 'Soldier', 'Engineer', 'Scientist', 'Pilot', 'Lead Scientist'],
    equipmentCategories: ['general', 'scientific'] },
  War: { page: 28, commanderBonus: { co: 1 }, commanderAbility: 'Warmaster', extraStartingEquipment: 0,
    crewTypes: ['Medical Officer', 'Soldier', 'Engineer', 'Scientist', 'Pilot', 'Veteran Soldier'],
    equipmentCategories: ['general', 'weaponry'] },
  Shipping: { page: 29, commanderBonus: { lf: 1 }, commanderAbility: 'Logistics Expert', extraStartingEquipment: 0,
    crewTypes: ['Medical Officer', 'Soldier', 'Engineer', 'Pilot'],
    equipmentCategories: ['general', 'medical', 'weaponry', 'scientific', 'advancedTechnology'] },
  Pirate: { page: 30, commanderBonus: { mv: 1 }, commanderAbility: 'Sneaky Scoundrel', extraStartingEquipment: 2,
    crewTypes: ['Medical Officer', 'Soldier', 'Engineer', 'Pilot', 'Ace Pilot'],
    equipmentCategories: ['general', 'medical', 'weaponry', 'scientific'] },
  Exploration: { page: 31, commanderBonus: { re: 1 }, commanderAbility: 'Survival Specialist', extraStartingEquipment: 0,
    crewTypes: ['Medical Officer', 'Soldier', 'Engineer', 'Scientist', 'Pilot', 'Chief Engineer', 'Ace Pilot'],
    equipmentCategories: ['general', 'medical', 'scientific'] },
};

export const COMMANDER_FREE_STAT_POINTS = 3;
// p. 36: one weapon per crew member plus this many other pieces for the whole crew
export const STARTING_OTHER_EQUIPMENT = 3;

export const CREW_TYPES = {
  'Medical Officer': { isAdvanced: false, bonus: { in: 1 }, abilities: ['Medical Attention'] },
  Soldier: { isAdvanced: false, bonus: { co: 1 }, abilities: ['Combat Specialist'] },
  Engineer: { isAdvanced: false, bonus: { re: 1 }, abilities: ['Weapon Tuning'] },
  Scientist: { isAdvanced: false, bonus: { in: 1 }, abilities: ['Armor Tuning'] },
  Pilot: { isAdvanced: false, bonus: { re: 1 }, abilities: ['Awareness'] },
  'Senior Physician': { isAdvanced: true, bonus: { in: 2 }, abilities: ['Improved Medical Attention'] },
  'Lead Scientist': { isAdvanced: true, bonus: { in: 2 }, abilities: ['Area of Focus', 'Armor Tuning'] },
  'Veteran Soldier': { isAdvanced: true, bonus: { co: 2 }, abilities: ['Hard to Kill', 'Combat Specialist'] },
  'Chief Engineer': { isAdvanced: true, bonus: { in: 1, re: 1 }, abilities: ['Bypass', 'Weapon Tuning'] },
  'Ace Pilot': { isAdvanced: true, bonus: { re: 2 }, abilities: ['Ultimate Ace', 'Awareness'] },
};

// Names only — what an ability does is in the rulebook on its page.
export const ABILITY_PAGES = {
  'Medical Attention': 32, 'Combat Specialist': 32, 'Weapon Tuning': 32, 'Armor Tuning': 33, Awareness: 33,
  'Improved Medical Attention': 33, 'Area of Focus': 33, 'Hard to Kill': 33, Bypass: 34, 'Ultimate Ace': 34,
  'Senior Doctor': 26, 'Practiced Scientist': 27, Warmaster: 28, 'Logistics Expert': 29, 'Sneaky Scoundrel': 30,
  'Survival Specialist': 31,
};

// Names only — what a piece does is in the rulebook on `page`.
export const EQUIPMENT_CATEGORIES = {
  general: { name: 'General Equipment', page: '36',
    items: ['Scanner', 'Medi-Bag', 'Sidearm', 'Melee Weapon', 'Armored Jacket'] },
  medical: { name: 'Medical Equipment', page: '36–37',
    items: ['Antitoxin', 'Stabilization Module', 'Hazard Suit', 'Emergency Med-Patch', 'Stim-Shot'] },
  weaponry: { name: 'Advanced Weaponry', page: '37',
    items: ['Energy Melee Weapon', 'Energy Missile Weapon', 'Heavy Kinetic Missile Weapon', 'Heavy Melee Weapon'] },
  scientific: { name: 'Scientific Gear', page: '37',
    items: ['Hyper-Scanner', 'Chem-Protection Suit', 'Advanced Tech Kit', 'Mini-Lab Kit'] },
  advancedTechnology: { name: 'Advanced Technology', page: '37–38',
    items: ['Ablative Shields', 'Jump Boots', 'Drone System', 'Point-to-Point Teleporter', 'Heads-Up Display'] },
};
export const WEAPONS = ['Sidearm', 'Melee Weapon', 'Energy Melee Weapon', 'Energy Missile Weapon',
  'Heavy Kinetic Missile Weapon', 'Heavy Melee Weapon'];

export const EDGES = [
  'Armored Force', 'Nano Tech', 'Psionic Talent', 'Telekinesis', 'Artificial Life Forms',
  'Warrior Born', 'Hive Mind', 'Harmonious Culture', 'Natural Brutes', 'Smugglers',
  'Shapeshifters', 'Time Masters', 'Chemically Enhanced', 'Parasites',
];

export const AGENDAS = {
  rescue: { name: 'Rescue', partsNeeded: 1, onCompletion: 'Add one standard crew member with 0 XP (Crew tab → Add member).' },
  tech: { name: 'Tech', partsNeeded: 1, onCompletion: 'Add one piece of Advanced Technology (p. 37).' },
  biology: { name: 'Biology', partsNeeded: 2, onCompletion: 'Knowledge Shard — read p. 114, #3.' },
  data: { name: 'Data', partsNeeded: 2, onCompletion: 'Knowledge Shard — read p. 115, #5.' },
  weapons: { name: 'Weapons', partsNeeded: 1, onCompletion: 'Two crew members get +1 Combat.' },
  medicine: { name: 'Medicine', partsNeeded: 2, onCompletion: 'Add one piece of Medical Equipment (p. 36).' },
};

// d12 needed to keep the initiative for the 2nd, 3rd and every later activation in a turn (p. 14)
export const RETAIN_INITIATIVE_ROLLS = [6, 10, 12];

// Short reminders in this app's own words, not the rulebook's; the pages have the full rules and examples.
export const DICE_HELP = [
  { question: 'How do I read "Reaction 2 (6+)"?',
    answer: 'Roll one d12 per point of the stat named (here Reaction). You need 2 successes, and only even results of 6 or higher count. With no bracket, every even result counts. p. 15–16' },
  { question: 'What counts as a success?',
    answer: 'An even number that is at least the target in brackets. Odd results never count. p. 15' },
  { question: 'One roll was not enough. Now what?',
    answer: 'Successes add up over several rolls and several crew members until the number is reached, unless the test is marked Single Roll. p. 16' },
  { question: 'What is different about a Save?',
    answer: 'It is a single roll and costs no action. Falling short usually means damage equal to the successes you are missing. p. 16' },
  { question: 'What do 12s and 1s do?',
    answer: 'Two or more 12s: the test succeeds whatever was needed, and successes count double. Two or more 1s: it fails, unless there are also two 12s. p. 17' },
  { question: 'How many crew can act before the enemy?',
    answer: `The first acts for free. Roll a d12 to keep going: ${RETAIN_INITIATIVE_ROLLS[0]}+ for the second, ${RETAIN_INITIATIVE_ROLLS[1]}+ for the third, ${RETAIN_INITIATIVE_ROLLS[2]}+ after that. p. 13–14` },
  { question: 'How does an attack work?',
    answer: 'Attacker and defender both roll Combat. See p. 20.' },
];

// General terrain, p. 43–44: one d12 per quadrant of the board. The board is drawn upright: 22" across, 30" deep.
export const BOARD_WIDTH_INCHES = 22;
export const BOARD_HEIGHT_INCHES = 30;
export const LARGE_TERRAIN_INCHES = 5;
export const SMALL_TERRAIN_INCHES = 2;
export const TERRAIN_MIN_GAP_INCHES = 2;
export const RANDOM_TERRAIN_TABLE = [
  { max: 4, largePieces: 1, smallPiecesDieSides: 0 },
  { max: 8, largePieces: 2, smallPiecesDieSides: 0 },
  { max: 12, largePieces: 2, smallPiecesDieSides: 3 },
];

// p. 41
export const XP_PER_SURVIVED_CHALLENGE = 1;
export const COMMANDER_BONUS_XP_PER_CHALLENGE = 1;
// p. 38: d12 result needed to follow a challenge's Secondary Agenda section
export const AGENDA_ROLL_TARGET = 5;
export const STARTING_CHALLENGE = 1;

export const COMMANDER_ADVANCEMENTS = [
  { xp: 7, statOptions: STAT_KEYS },
  { xp: 14, ability: 'Skill Expertise (p. 41)' },
  { xp: 21, statOptions: STAT_KEYS },
  { xp: 28, ability: 'Determined Leader (p. 41)' },
  { xp: 35, statOptions: STAT_KEYS },
];

export const CREW_ADVANCEMENTS = [
  { xp: 5, statOptions: ['lf', 'mv'] },
  { xp: 10, statOptions: ['co', 're', 'in'] },
  { xp: 15, statOptions: ['lf', 'mv'] },
  { xp: 25, statOptions: ['co', 're', 'in'] },
  { xp: 30, statOptions: ['lf', 'mv'] },
];

// 2d12, p. 40
const INJURY_TABLE = [
  { max: 2, key: 'hidden', label: 'Dead… but read p. 114, #1' },
  { max: 5, key: 'allStatsDown', label: 'Worse for Wear — all stats −1' },
  { max: 11, key: 'dead', label: 'Dead and Gone' },
  { max: 17, key: 'fullRecovery', label: 'Full Recovery' },
  { max: 20, key: 'recovering', label: 'Recovery Time — misses the next challenge' },
  { max: 23, key: 'oneStatUp', label: 'Unexpected Recovery — one stat +1' },
  { max: 24, key: 'allStatsUp', label: "It's a Miracle — all stats +1" },
];

export const INJURY_ROLL_MIN = 2;
export const INJURY_ROLL_MAX = INJURY_TABLE.at(-1).max;

export function injuryOutcomeForRoll(roll) {
  if (!Number.isInteger(roll) || roll < INJURY_ROLL_MIN || roll > INJURY_ROLL_MAX) return null;
  return INJURY_TABLE.find((row) => roll <= row.max);
}

export function injuryRollRangeLabel(outcomeKey) {
  const rowIndex = INJURY_TABLE.findIndex((row) => row.key === outcomeKey);
  const lowest = rowIndex === 0 ? INJURY_ROLL_MIN : INJURY_TABLE[rowIndex - 1].max + 1;
  const highest = INJURY_TABLE[rowIndex].max;
  return lowest === highest ? `${lowest}` : `${lowest}–${highest}`;
}

// map: [column, row] on the station map — this app's own layout, not taken from the book.
// via: grid points a corridor bends through so it does not run across other rooms.
// exits: player chooses. exitRoll: d12 table. reminders: page pointers, shown for as long as the crew is in the room.
export const CHALLENGES = {
  1: { name: 'Docking Bay Access Port', page: 45, map: [2, 0],
    exitRoll: [{ max: 1, to: 2 }, { max: 4, to: 3, via: [[0, 0]] }, { max: 8, to: 4 }, { max: 11, to: 5, via: [[4, 0]] }, { max: 12, to: 6, via: [[2, 2]] }] },
  2: { name: 'The Darkened Hall', page: 47, map: [3, 1], exits: [{ label: 'Sealed Door', to: 6 }] },
  3: { name: 'Repair Bay', page: 49, map: [0, 1], turnLimit: 4, exits: [{ label: 'Jammed Door', to: 4 }] },
  4: { name: 'Fabrication Bay', page: 52, map: [1, 1],
    exits: [{ label: 'Jammed Door', to: 3 }, { label: 'Rusted Door', to: 2 }, { label: 'Exposed Ventilation Shaft', to: 6 }] },
  5: { name: 'Medical Bay', page: 54, map: [4, 1], agendas: ['data', 'medicine'], exits: [{ label: 'Door', to: 2 }] },
  6: { name: 'Pod 6', page: 57, map: [1, 2], turnLimit: 5, noReturn: true,
    reminders: ['When the challenge text sends you there: p. 114, #2.'],
    exitRoll: [{ max: 3, to: 7, via: [[1, 4]] }, { max: 6, to: 10, via: [[4, 2]] }, { max: 9, to: 13, via: [[0, 2], [0, 8]] }, { max: 12, to: 15, via: [[0, 2], [0, 5]] }] },
  7: { name: 'Science Lab', page: 60, map: [2, 4], agendas: ['data', 'biology'],
    exits: [{ label: 'Broken Elevator Tube (Going Up)', to: 8 }, { label: 'Broken Elevator Tube (Going Down)', to: 15 }, { label: 'Broken Doors', to: 9, via: [[3, 4]] }] },
  8: { name: 'Disused Bay', page: 63, map: [2, 3],
    reminders: ['If you earn the Knowledge Shard: p. 114, #4.'],
    exits: [{ label: 'Broken Elevator Tube (Going Down)', to: 7 }, { label: 'Rusted Conveyor Belt Tunnel', to: 10, via: [[4, 3]] }] },
  9: { name: 'Chemical Lab', page: 65, map: [3, 5.5], exits: [{ label: 'Broken Doors', to: 7, via: [[3, 4]] }, { label: 'Ventilation System', to: 11, via: [[3, 7]] }] },
  10: { name: 'Smelting Factory', page: 67, map: [4, 4], exits: [{ label: 'Emergency Exit', to: 12, via: [[4, 6]] }, { label: 'Rusted Conveyor Belt Tunnel', to: 8, via: [[4, 3]] }] },
  11: { name: 'Greenhouse', page: 69, map: [2, 7], agendas: ['rescue', 'medicine'],
    exits: [{ label: 'Broken Lift Tube Up', to: 12 }, { label: 'Broken Lift Tube Down', to: 13 }, { label: 'Ventilation System', to: 9, via: [[3, 7]] }] },
  12: { name: 'Environmental Control Room', page: 72, map: [2, 6], agendas: ['biology', 'tech'],
    exits: [{ label: 'Broken Lift Tube Down', to: 11 }, { label: 'Broken Lift Tube Up', to: 15 }, { label: 'Frozen Emergency Exit', to: 10, via: [[4, 6]] }] },
  13: { name: 'Weapons Locker', page: 75, map: [2, 8], agendas: ['weapons'], exits: [{ label: 'Secured Door', to: 14 }] },
  14: { name: 'Barracks', page: 78, map: [3, 8], exits: [{ label: 'Broken Lift Tube Down', to: 16 }] },
  15: { name: 'Disused Bay', page: 80, map: [2, 5], exits: [{ label: 'Broken Lift Tube Up', to: 7 }, { label: 'Broken Lift Tube Down', to: 12 }] },
  16: { name: 'Shuttle Bay', page: 81, map: [3, 9], noReturn: true,
    reminders: ['After completing the challenge: Knowledge Shard, p. 115, #6.'],
    exitRoll: [{ max: 6, to: 17, via: [[1, 9]] }, { max: 9, to: 18 }, { max: 11, to: 19, via: [[3, 10.5]] }, { max: 12, to: 20, via: [[4, 9]] }] },
  17: { name: 'Trash Storage', page: 85, map: [1, 11.5],
    reminders: ['At the start of turn 3: read p. 115, #7.'],
    exits: [{ label: 'Sealed Door', to: 19 }] },
  18: { name: 'Prison', page: 86, map: [3, 11.5], exits: [{ label: 'Sealed Door', to: 19 }] },
  19: { name: 'Disused Bay', page: 88, map: [2, 11.5], turnLimit: 3,
    exits: [{ label: 'Sealed Door', to: 17 }, { label: 'Rusted Door', to: 18 }, { label: 'Broken Lift Tube Up', to: 21 }, { label: 'Broken Lift Tube Down', to: 22 }] },
  20: { name: 'Hologram Bay', page: 91, map: [4, 10.5],
    reminders: ['If the challenge text sends you there: p. 115, #8 (and a Knowledge Shard: +1 to one stat).'],
    exits: [{ label: 'Ventilation Shaft', to: 21 }] },
  21: { name: 'Bar', page: 92, map: [2, 10.5], exits: [{ label: 'Explosion Hole', to: 22, via: [[0, 10.5], [0, 12.5]] }] },
  22: { name: 'Engine Room', page: 94, map: [2, 12.5], turnLimit: 5, exits: [{ label: 'Functional Lift', to: 23 }] },
  23: { name: 'Control Room', page: 96, map: [2, 13.5], canEarnLegacy: true,
    reminders: ['If the Rewards section sends you there: p. 116, #9.'],
    exits: [{ label: 'Bay Door', to: 24 }] },
  24: { name: 'Master System', page: 99, map: [2, 14.5], reminders: ['Read p. 116, #10.'] },
};

export const LEGACY_PAGE_REFERENCE = 'p. 116, #9';
export const MAX_LEGACY_COUNT = 2;

export function exitForRoll(challenge, roll) {
  if (!Number.isInteger(roll) || roll < 1 || roll > 12) return null;
  return challenge.exitRoll.find((row) => roll <= row.max).to;
}
