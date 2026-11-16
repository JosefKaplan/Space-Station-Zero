// The turn tracker for a room being played (p. 13–15): which side has the initiative, who has gone, what the next roll to
// keep the initiative needs. Pure: it works on the `turns` object of a room (`run.roomSetup.turns`) and changes it in place.
//
// turns = { turn, side: 'crew' | 'enemy', doneIds: [memberId], outIds: [memberId], enemyDoneIds: [enemyId],
//           enemyActivations, enemiesDone, run, awaitingRoll, lastRoll: null | { side, roll, needed, kept },
//           used: [key] }   `used`: the once-per-turn abilities used this turn (js/limited-use.js); a new turn clears it
//
// `sides` (given to every change) says who is able to act: { crewIds: [memberId], enemyIds: [enemyId] | null }. `enemyIds` are the
// enemies still standing on the room's enemy list (js/enemies.js); null when the room has no list, and the enemies' activations
// are only counted by hand.
//
// How a turn goes (the book): the crew has the first activation of every turn. After each activation the side rolls a d12 to keep
// the initiative (6+ after its 1st activation, 10+ after the 2nd, 12+ after every later one). A failed roll passes the initiative
// to the other side, and the turn is over when everyone, crew and enemies, has activated once. Enemies roll the same way (p. 42).
//
// Where the book is silent, the owner decided (docs/ANALYSIS.md § 16): when a side gets the initiative back, its count of
// activations starts again, so it takes a free activation and then needs 6+ again. `run` is that count.
import { initiativeRollNeeded } from './data.js';

export function newTurns() {
  return { turn: 1, side: 'crew', doneIds: [], outIds: [], enemyDoneIds: [], enemyActivations: 0, enemiesDone: false, run: 0, awaitingRoll: false, lastRoll: null, used: [] };
}

const otherSideOf = (side) => (side === 'crew' ? 'enemy' : 'crew');

// nobody on that side is left to activate this turn
export function isSideFinished(turns, sides, side) {
  if (side === 'crew') return sides.crewIds.every((memberId) => turns.doneIds.includes(memberId) || turns.outIds.includes(memberId));
  return turns.enemiesDone || (sides.enemyIds !== null && sides.enemyIds.every((enemyId) => turns.enemyDoneIds.includes(enemyId)));
}

// the turn is over when both sides have nobody left
export const isTurnComplete = (turns, sides) => isSideFinished(turns, sides, 'crew') && isSideFinished(turns, sides, 'enemy');

function giveInitiativeTo(turns, side, run = 0) {
  turns.side = side;
  turns.run = run;
  turns.awaitingRoll = false;
}

const activationsThisTurn = (turns, side) => (side === 'crew' ? turns.doneIds : turns.enemyDoneIds).length;

// Call after anything that changes who is left to act (an activation, someone out of action, an enemy put down):
// a side with nobody left hands the initiative on without a roll, and nobody rolls when the other side has nobody to take it.
export function settleInitiative(turns, sides) {
  const own = turns.side;
  const isOwnFinished = isSideFinished(turns, sides, own);
  const isOtherFinished = isSideFinished(turns, sides, otherSideOf(own));
  if (isOwnFinished && !isOtherFinished) giveInitiativeTo(turns, otherSideOf(own));
  else if (isOwnFinished || isOtherFinished) turns.awaitingRoll = false;
}

// the d12 result needed to keep the initiative after this side's latest activation; null when no roll is due
export function rollNeeded(turns) {
  return turns.awaitingRoll ? initiativeRollNeeded(turns.run) : null;
}

function recordActivation(turns, sides) {
  turns.run += 1;
  turns.lastRoll = null;
  turns.awaitingRoll = true;
  settleInitiative(turns, sides);
}

// Runs a change that can bring someone back on a side (an activation given back, a crew member back in action), then settles.
// A side that had nobody left passed the initiative on without a roll: when someone is back, the initiative returns to it, unless
// the other side got it by a lost roll or has acted since (that hand-over stands). Only for changes of a side that has acted this
// turn or the crew: the crew holds the initiative at the start of a turn, so an enemy side "finished" by hand had been given nothing.
// The side's count of activations in a row is gone by then, so it restarts from its activations this turn (right unless it
// lost the initiative and won it back during the turn).
function changeWhoIsLeft(turns, sides, change) {
  const wasFinished = { crew: isSideFinished(turns, sides, 'crew'), enemy: isSideFinished(turns, sides, 'enemy') };
  change();
  const returningSide = otherSideOf(turns.side);
  const isInitiativeUntouched = turns.run === 0 && !turns.awaitingRoll && turns.lastRoll?.kept !== false;
  if (wasFinished[returningSide] && !isSideFinished(turns, sides, returningSide) && isInitiativeUntouched) {
    giveInitiativeTo(turns, returningSide, activationsThisTurn(turns, returningSide));
  }
  settleInitiative(turns, sides);
}

// a tap too many: the side's latest activation is given back (only when that side still holds the initiative)
function takeActivationBack(turns, side) {
  turns.awaitingRoll = false;
  if (turns.side === side) turns.run = Math.max(0, turns.run - 1);
}

function requireSideToActivate(turns, side) {
  if (turns.side !== side) throw new Error(side === 'crew'
    ? 'The enemies have the initiative: let them finish, or mark their roll lost.'
    : 'The crew has the initiative.');
  if (turns.awaitingRoll) throw new Error('Resolve the roll to keep the initiative first.');
}

// a crew member takes (or gives back) their activation
export function toggleDone(turns, memberId, sides) {
  if (turns.outIds.includes(memberId)) throw new Error('That crew member is out of action.');
  if (turns.doneIds.includes(memberId)) {
    changeWhoIsLeft(turns, sides, () => {
      turns.doneIds = turns.doneIds.filter((id) => id !== memberId);
      takeActivationBack(turns, 'crew');
    });
    return;
  }
  requireSideToActivate(turns, 'crew');
  turns.doneIds.push(memberId);
  recordActivation(turns, sides);
}

// someone put out of action, or back in (a mistake): out of action crew members no longer need to act
export function toggleOut(turns, memberId, sides) {
  changeWhoIsLeft(turns, sides, () => {
    turns.outIds = turns.outIds.includes(memberId) ? turns.outIds.filter((id) => id !== memberId) : [...turns.outIds, memberId];
  });
}

// an enemy from the room's list takes (or gives back) its activation
export function toggleEnemyDone(turns, enemyId, sides) {
  if (sides.enemyIds === null) throw new Error('This room has no enemy list: count the enemies’ activations instead.');
  if (turns.enemyDoneIds.includes(enemyId)) {
    changeWhoIsLeft(turns, sides, () => {
      turns.enemyDoneIds = turns.enemyDoneIds.filter((id) => id !== enemyId);
      takeActivationBack(turns, 'enemy');
    });
    return;
  }
  if (!sides.enemyIds.includes(enemyId)) throw new Error('That enemy is out of action.');
  requireSideToActivate(turns, 'enemy');
  turns.enemyDoneIds.push(enemyId);
  recordActivation(turns, sides);
}

// without an enemy list: one enemy has activated (or one tap too many: `change` -1)
export function changeEnemyActivations(turns, change, sides) {
  if (change > 0) {
    requireSideToActivate(turns, 'enemy');
    turns.enemyActivations += 1;
    recordActivation(turns, sides);
  } else {
    turns.enemyActivations = Math.max(0, turns.enemyActivations - 1);
    takeActivationBack(turns, 'enemy');
    settleInitiative(turns, sides);
  }
}

// "Enemies are done": nothing left for them this turn (tap again to take it back)
export function setEnemiesDone(turns, isDone, sides) {
  turns.enemiesDone = isDone;
  settleInitiative(turns, sides);
}

// the roll to keep the initiative came out: `kept` or lost. `roll` is the d12, or null when it was rolled by hand
export function resolveRoll(turns, { kept, roll = null }, sides) {
  if (!turns.awaitingRoll) throw new Error('No roll is due.');
  turns.lastRoll = { side: turns.side, roll, needed: rollNeeded(turns), kept };
  turns.awaitingRoll = false;
  if (kept) return;
  giveInitiativeTo(turns, otherSideOf(turns.side));
  settleInitiative(turns, sides);
}

// the crew has the first activation of the turn, unless nobody on its side is able to act: then the enemies start
export function nextTurn(turns, sides) {
  Object.assign(turns, { turn: turns.turn + 1, side: 'crew', doneIds: [], enemyDoneIds: [], enemyActivations: 0, enemiesDone: false, run: 0, awaitingRoll: false, lastRoll: null, used: [] });
  settleInitiative(turns, sides);
}
