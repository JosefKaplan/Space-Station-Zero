// One combat exchange (p. 20–21): the attacker's dice, the defender's dice, and who takes how much damage. Pure: no DOM, no storage.
//
// Steps of the book: the attacker rolls Combat + weapon + modifiers and counts the even results that reach the target's armor
// (armor is the target number; no armor means every even result counts); the defender rolls Combat (a weapon does not count) and
// counts every even result; more successes for the attacker means the difference is the damage; a tie does nothing; more for the
// defender hurts the attacker by the difference in a Close attack and does nothing in a Ranged one. Two or more natural 12s double
// a roll's successes, and two or more natural 1s make it fail, unless it has two 12s too (p. 17).
import { ARMOR_ITEMS, EDGE_ARMOR, TUNINGS, WEAPON_PROFILES } from './data.js';
import { carriedItems } from './gear.js';

export const COVER_ARMOR_BONUS = 2;      // p. 22: against a Ranged attack, cover raises the target's armor by 2
export const NO_ARMOR_NUMBER = 2;        // without armor every even result counts, which is the same as an armor of 2+
export const MAX_DICE_IN_A_POOL = 40;

// the faces of one roll scored against a target number (0 = every even result counts)
export function scorePool(faces, targetNumber = 0) {
  const dice = faces.map((face) => ({ face, isSuccess: face % 2 === 0 && face >= targetNumber }));
  const rawSuccesses = dice.filter((die) => die.isSuccess).length;
  const isCriticalSuccess = faces.filter((face) => face === 12).length >= 2;
  const isCriticalFailure = !isCriticalSuccess && faces.filter((face) => face === 1).length >= 2;
  const successes = isCriticalFailure ? 0 : (isCriticalSuccess ? rawSuccesses * 2 : rawSuccesses);
  return { dice, rawSuccesses, successes, isCriticalSuccess, isCriticalFailure };
}

// the number an attacker's even results must reach, or null when nothing is in the way
export function attackTargetNumber({ armor, reach, hasCover }) {
  const armorNumber = Number.isFinite(armor) && armor > NO_ARMOR_NUMBER ? armor : null;
  if (reach === 'ranged' && hasCover) return (armorNumber ?? NO_ARMOR_NUMBER) + COVER_ARMOR_BONUS;
  return armorNumber;
}

export function resolveAttack({ attackFaces, defenseFaces, armor, reach, hasCover }) {
  const targetNumber = attackTargetNumber({ armor, reach, hasCover });
  const attack = scorePool(attackFaces, targetNumber ?? 0);
  const defense = scorePool(defenseFaces);
  let outcome;
  if (attack.successes > defense.successes) outcome = { kind: 'hit', victim: 'defender', damage: attack.successes - defense.successes };
  else if (attack.successes === defense.successes) outcome = { kind: 'tie', victim: null, damage: 0 };
  else if (reach === 'close') outcome = { kind: 'reflected', victim: 'attacker', damage: defense.successes - attack.successes };
  else outcome = { kind: 'blocked', victim: null, damage: 0 };
  return { targetNumber, attack, defense, outcome };
}

// dice typed in by hand ("2 5 6, 10 11"): whole numbers from 1 to 12, as many as were rolled
export function parseFaces(text) {
  const parts = String(text ?? '').split(/[^0-9]+/).filter(Boolean);
  if (parts.length === 0) throw new Error('Type the d12 results, with spaces between them.');
  const faces = parts.map(Number);
  if (faces.some((face) => face < 1 || face > 12)) throw new Error('A d12 shows 1 to 12: check the numbers typed.');
  if (faces.length > MAX_DICE_IN_A_POOL) throw new Error(`That is more than ${MAX_DICE_IN_A_POOL} dice.`);
  return faces;
}

// ---------- what a crew member carries (their equipment text, as typed or picked) ----------

// the weapons carried (each kind once)
export const carriedWeapons = (equipmentText) => [...new Set(carriedItems(equipmentText).filter((name) => name in WEAPON_PROFILES))];

// the armor value of a piece of armor, or null when it has none of its own to add up
export const armorValueOf = (itemName) => ARMOR_ITEMS[itemName]?.value ?? Object.values(EDGE_ARMOR).find((armor) => armor.item === itemName)?.value ?? null;

// the pieces of armor carried, and the Power Armor of a crew whose edge gives it
export function carriedArmor(equipmentText, edge = '') {
  return [...new Set(carriedItems(equipmentText).filter((name) => name in ARMOR_ITEMS)), ...(EDGE_ARMOR[edge] ? [EDGE_ARMOR[edge].item] : [])];
}

// The best armor value among what is carried, or null. `tunedItems` are the names of this carrier's pieces tuned for this challenge
// (js/preparation.js); `isRangedKinetic` says whether the attack is one that Ablative Shields count against; `edge` is the crew's edge.
export function armorOf(equipmentText, { tunedItems = [], edge = '', isRangedKinetic = false } = {}) {
  const values = carriedArmor(equipmentText, edge)
    .filter((name) => armorValueOf(name) !== null && (ARMOR_ITEMS[name]?.onlyAgainst !== 'rangedKinetic' || isRangedKinetic))
    .map((name) => armorValueOf(name) + (tunedItems.includes(name) ? TUNINGS.armor.bonus : 0));
  return values.length ? Math.max(...values) : null;
}

// the dice a weapon adds, with its tuning for this challenge
export const weaponDiceOf = (weaponName, tunedItems = []) => WEAPON_PROFILES[weaponName].bonusDice + (tunedItems.includes(weaponName) ? TUNINGS.weapon.bonus : 0);

// dice a carried weapon adds to the carrier's defence rolls (only some do), 0 otherwise
export function defenseBonusOf(equipmentText, tunedItems = []) {
  return carriedWeapons(equipmentText).reduce((total, name) => total + (WEAPON_PROFILES[name].addsToDefense ? weaponDiceOf(name, tunedItems) : 0), 0);
}
