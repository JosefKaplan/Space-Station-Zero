// The enemies of a room being played: who is standing, how much Life each has left. Pure, no DOM, no storage: it works on the
// `enemies` list of a room (`run.roomSetup.enemies`), see docs/ANALYSIS.md § 17.
//
// enemies = [{ id, name, number, life, damage, armor, combat, isHidden }]   life = the Life stat, damage = Life lost so far; at
// damage >= life the enemy is out of action and removed from play (p. 12, p. 21). `number` tells models of one kind apart,
// `combat` is the Combat stat (the dice it rolls in a fight, js/combat.js), null when it is not known.
//
// The list is built from the room's briefing and stat bars (js/room-layouts.js: the owner's private text), or by hand.

export const MAX_ENEMY_LIFE = 99;
export const MAX_LIFE_WITH_PIPS = 12;   // up to this much Life a row shows tappable pips; above it only the buttons

// some enemies have a solo and a co-op stat bar: with two or more crews taking part the co-op one is yours
export function isStatBarForOtherPartySize(statName, crewCount) {
  const isCoop = crewCount >= 2;
  return (statName.includes('(solo play)') && isCoop) || (statName.includes('(co-op play)') && !isCoop);
}

// "Drone Sentries" -> "Drone Sentry", "Mutants" -> "Mutant", "CONTROL" stays; a note in brackets is dropped
function singularOf(name) {
  const plain = name.replace(/\s*\(.*?\)\s*/g, ' ').trim();
  if (/ies$/.test(plain)) return plain.replace(/ies$/, 'y');
  return /[^s]s$/.test(plain) ? plain.slice(0, -1) : plain;
}

const sameKind = (nameA, nameB) => singularOf(nameA).toLowerCase() === singularOf(nameB).toLowerCase();

// How many models a group of the room's enemies has with this many crews, or null when the briefing gives no plain number.
function groupSize(group, crewCount) {
  if (group.perCrew) return group.perCrew * crewCount;
  return /^\d+$/.test(group.count ?? '') ? Number(group.count) : null;
}

const isLifeTheListCanHold = (life) => Number.isInteger(life) && life >= 1 && life <= MAX_ENEMY_LIFE;

// What the room's briefing says about its enemies, group by group: { index, name, size, stat, modelName, isHidden, when }.
// `stat` is the matching stat bar, null when the book gives none under that name or its Life is one the list cannot hold (a save
// with such an enemy would be refused as damaged): the group is then offered by hand. `modelName` is the name of one model.
export function enemyGroups(roomLayout, crewCount) {
  const statBars = (roomLayout?.stats ?? []).filter((stat) => !isStatBarForOtherPartySize(stat.name, crewCount) && isLifeTheListCanHold(stat.lf));
  return (roomLayout?.enemies ?? []).map((group, index) => {
    const stat = statBars.find((candidate) => sameKind(candidate.name, group.name)) ?? null;
    return {
      index, name: group.name, size: groupSize(group, crewCount), isHidden: Boolean(group.hidden), when: group.when ?? null,
      stat, modelName: stat && singularOf(stat.name),
    };
  });
}

const nextIdNumber = (enemies) => enemies.reduce((highest, enemy) => Math.max(highest, Number(enemy.id.slice(1)) || 0), 0) + 1;

// the models of the listed groups ({ size, stat, modelName, isHidden }), added to `enemies` (hidden ones last: they activate after all the others, p. 22)
export function addGroups(enemies, groups) {
  const added = [];
  for (const group of groups) {
    const name = group.modelName;
    for (let copy = 0; copy < group.size; copy += 1) {
      const existing = [...enemies, ...added];
      added.push({
        id: `e${nextIdNumber(existing)}`, name, number: existing.filter((enemy) => enemy.name === name).length + 1,
        life: group.stat.lf, damage: 0, armor: group.stat.armor ?? '', combat: group.stat.co ?? null, isHidden: group.isHidden,
      });
    }
  }
  enemies.push(...added);
  // visible models first, hidden last
  enemies.sort((a, b) => Number(a.isHidden) - Number(b.isHidden));
}

// The list to start a room with: every group the briefing gives a number and a stat bar for, except the ones that come
// later (the briefing gives a condition, `when`); those are offered by hand, as are groups without a number or bar.
export function startingEnemies(roomLayout, crewCount) {
  const groups = enemyGroups(roomLayout, crewCount);
  const enemies = [];
  addGroups(enemies, groups.filter((group) => group.size && group.stat && !group.when));
  return {
    enemies,
    later: groups.filter((group) => group.size && group.stat && group.when),
    notListed: groups.filter((group) => !group.size || !group.stat),
  };
}

// `combat` may be left empty: the enemy then has no Combat stat on the list
export function addEnemyByHand(enemies, { name, life, combat }) {
  const trimmedName = String(name ?? '').trim();
  if (!trimmedName) throw new Error('Give the enemy a name.');
  if (!Number.isInteger(life) || life < 1 || life > MAX_ENEMY_LIFE) throw new Error(`Life must be a whole number from 1 to ${MAX_ENEMY_LIFE}.`);
  const hasCombat = combat !== '' && combat !== null && combat !== undefined;
  if (hasCombat && (!Number.isInteger(combat) || combat < 0 || combat > MAX_ENEMY_LIFE)) throw new Error('Combat must be a whole number, or left empty.');
  addGroups(enemies, [{ size: 1, isHidden: false, modelName: trimmedName, stat: { lf: life, co: hasCombat ? combat : null } }]);
}

export const isOutOfAction = (enemy) => enemy.damage >= enemy.life;
export const lifeLeft = (enemy) => Math.max(0, enemy.life - enemy.damage);
export const standingIds = (enemies) => enemies.filter((enemy) => !isOutOfAction(enemy)).map((enemy) => enemy.id);

// "Drone #2" when there are several of a kind, plain "Warship" when there is one
export function displayName(enemies, enemy) {
  return enemies.filter((other) => other.name === enemy.name).length > 1 ? `${enemy.name} #${enemy.number}` : enemy.name;
}

const requireEnemy = (enemies, enemyId) => {
  const enemy = enemies.find((candidate) => candidate.id === enemyId);
  if (!enemy) throw new Error('That enemy is not on the list.');
  return enemy;
};

// Life goes down (or back up, to fix a slip) by `change`, never below 0 nor above the Life stat (p. 21)
export function changeLife(enemies, enemyId, change) {
  const enemy = requireEnemy(enemies, enemyId);
  enemy.damage = Math.min(enemy.life, Math.max(0, enemy.damage - change));
}

// a tap on pip `pipNumber` of the row: that many Life left; a tap on the last full pip takes it away
export function setLifeFromPip(enemies, enemyId, pipNumber) {
  const enemy = requireEnemy(enemies, enemyId);
  const target = lifeLeft(enemy) === pipNumber ? pipNumber - 1 : pipNumber;
  enemy.damage = enemy.life - Math.min(enemy.life, Math.max(0, target));
}
