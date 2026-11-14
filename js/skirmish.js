// Versus (skirmish) matches: who plays, where they start, what each turn scored, who wins. No DOM, no storage:
// these work on the `match` object that lives in a playthrough's state (`state.versus.match`), see docs/ANALYSIS.md § 14.
//
// match = { id, challengeKey, players: [{ id, name }], order: [playerId...] (Crew 1, 2, ... = start areas One, Two, ...),
//   roles: null | [{ playerId, role: 'attacker' | 'defender', slot: 1 | 2 }] (Base Attack only), firstPlayerId: null | id,
//   phase: 'setup' | 'playing' | 'finished', turn: 1..SKIRMISH_TURNS, counts: { playerId: { lineKey: n } } (this turn),
//   turns: [counts of each finished turn], terrain: null | random terrain, startedAt }
import { SKIRMISH_CHALLENGES, SKIRMISH_TURNS } from './data.js';

export const MAX_SKIRMISH_PLAYERS = 4;
const PLAYER_NUMBER_WORDS = ['One', 'Two', 'Three', 'Four'];

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// a copy in a random order (Fisher-Yates); `random` is injectable for tests
export function shuffled(items, random = Math.random) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

const challengeOf = (match) => SKIRMISH_CHALLENGES[match.challengeKey];
const emptyCounts = (players) => Object.fromEntries(players.map((player) => [player.id, {}]));

// The d12 table that picks a challenge (p. 101)
export function challengeKeyForRoll(roll) {
  const found = Object.entries(SKIRMISH_CHALLENGES).find(([, challenge]) => roll >= challenge.rollOnD12[0] && roll <= challenge.rollOnD12[1]);
  if (!found) throw new Error(`No skirmish challenge for a roll of ${roll}.`);
  return found[0];
}

// Base Attack (p. 103): one attacker and one defender, or two of each with four players. The book does not say how to
// split three players: one attacker against two defenders here, so the attacker has the first activation and the odds.
export function rolesFor(playerIds, random = Math.random) {
  const attackerCount = playerIds.length === 4 ? 2 : 1;
  const mixed = shuffled(playerIds, random);
  return mixed.map((playerId, index) => (index < attackerCount
    ? { playerId, role: 'attacker', slot: index + 1 }
    : { playerId, role: 'defender', slot: index - attackerCount + 1 }));
}

export function createMatch({ challengeKey, playerNames }, random = Math.random) {
  const challenge = SKIRMISH_CHALLENGES[challengeKey];
  if (!challenge) throw new Error('Pick a skirmish challenge first.');
  const [fewest, most] = challenge.players;
  if (playerNames.length < fewest || playerNames.length > most) throw new Error(`${challenge.name} is for ${fewest} to ${most} players.`);
  const names = playerNames.map((name, index) => String(name ?? '').trim() || `Player ${index + 1}`);
  if (new Set(names.map((name) => name.toLowerCase())).size !== names.length) throw new Error('Give every player a different name.');
  const players = names.map((name) => ({ id: newId(), name }));
  const roles = challengeKey === 'base-attack' ? rolesFor(players.map((player) => player.id), random) : null;
  return {
    id: newId(), challengeKey, players, order: players.map((player) => player.id), roles,
    // in Base Attack the attacker goes first (p. 103); elsewhere it is rolled off
    firstPlayerId: roles ? roles.find((entry) => entry.role === 'attacker' && entry.slot === 1).playerId : null,
    phase: 'setup', turn: 1, counts: emptyCounts(players), turns: [], terrain: null, startedAt: new Date().toISOString(),
  };
}

export function rerollRoles(match, random = Math.random) {
  if (!match.roles) return;
  match.roles = rolesFor(match.players.map((player) => player.id), random);
  match.firstPlayerId = match.roles.find((entry) => entry.role === 'attacker' && entry.slot === 1).playerId;
}

export function randomiseOrder(match, random = Math.random) {
  match.order = shuffled(match.players.map((player) => player.id), random);
}

export function pickFirstPlayer(match, random = Math.random) {
  if (match.roles) return;   // the attacker always goes first
  match.firstPlayerId = match.players[Math.floor(random() * match.players.length)].id;
}

// The turn order after the first player goes first: clockwise round the table, which is the order of the start areas
// (Crew 1, 2, ...) as the players sit; the app can only offer that order, the table decides the direction.
export function activationOrder(match) {
  const start = match.order.indexOf(match.firstPlayerId);
  if (start === -1) return match.order;
  return [...match.order.slice(start), ...match.order.slice(0, start)];
}

export function beginMatch(match) {
  if (match.firstPlayerId === null) throw new Error('Roll for who activates first before starting.');
  match.phase = 'playing';
}

// the scoring lines that apply on a turn (some count only at the end of the last one)
export function scoringLinesOnTurn(challenge, turn) {
  return challenge.scoring.filter((line) => !line.finalOnly || turn === SKIRMISH_TURNS);
}

export function changeCount(match, playerId, lineKey, change) {
  if (match.phase !== 'playing') throw new Error('The match is not being played.');
  const counts = match.counts[playerId];
  if (!counts) throw new Error('That player is not in this match.');
  counts[lineKey] = Math.max(0, (counts[lineKey] ?? 0) + change);
}

const pointsOfTurn = (challenge, turnNumber, counts) => scoringLinesOnTurn(challenge, turnNumber)
  .reduce((total, line) => total + (counts?.[line.key] ?? 0) * line.vp, 0);

// per player: points of each finished turn, the total, and what this turn's counts would add
export function standings(match) {
  const challenge = challengeOf(match);
  const rows = match.players.map((player) => {
    const perTurn = match.turns.map((counts, index) => pointsOfTurn(challenge, index + 1, counts[player.id]));
    const total = perTurn.reduce((sum, points) => sum + points, 0);
    const thisTurn = match.phase === 'finished' ? 0 : pointsOfTurn(challenge, match.turn, match.counts[player.id]);
    return { player, perTurn, total, thisTurn };
  });
  const best = Math.max(...rows.map((row) => row.total));
  return rows.map((row) => ({ ...row, isLeading: match.turns.length > 0 && row.total === best }));
}

// at the end of the last turn: everyone on the highest total wins together (a draw is a draw)
export function winners(match) {
  const rows = standings(match);
  const best = Math.max(...rows.map((row) => row.total));
  return rows.filter((row) => row.total === best).map((row) => row.player);
}

// closes the turn: this turn's counts are kept, and after the last one the match is finished
export function endTurn(match) {
  if (match.phase !== 'playing') throw new Error('The match is not being played.');
  match.turns.push(structuredClone(match.counts));
  match.counts = emptyCounts(match.players);
  if (match.turn >= SKIRMISH_TURNS) {
    match.phase = 'finished';
  } else {
    match.turn += 1;
  }
}

// takes the last finished turn back, with its counts, so a slip can be fixed
export function undoTurn(match) {
  if (match.turns.length === 0) throw new Error('No finished turn to take back.');
  const lastCounts = match.turns.pop();
  match.counts = lastCounts;
  match.phase = 'playing';
  match.turn = match.turns.length + 1;
}

// ---------- the board ----------

const rectangle = ([x, y, width, height]) => ({ x, y, width, height });

// A layout the board sketch understands (terrain.js): a start area per player, labelled with the player, plus the
// challenge's markers for the players taking part.
export function skirmishLayout(match) {
  const challenge = challengeOf(match);
  const nameOf = (playerId) => match.players.find((player) => player.id === playerId)?.name ?? '';
  let crewZones;
  if (match.roles) {
    crewZones = match.roles.map(({ playerId, role, slot }) => {
      const areas = role === 'attacker' ? challenge.attackerAreas : challenge.defenderAreas;
      const roleName = role === 'attacker' ? 'Attacker' : 'Defender';
      // a short label fits the area; the hover text gives the whole name
      return { ...rectangle(areas[slot - 1]), label: `${roleName[0]}${slot}`, caption: nameOf(playerId), owner: `${roleName} ${slot}` };
    });
  } else {
    crewZones = match.order.map((playerId, index) => ({
      ...rectangle(challenge.startAreas[index]), label: `P${index + 1}`, caption: nameOf(playerId), owner: `Player ${PLAYER_NUMBER_WORDS[index]}`,
    }));
  }
  const playerCount = match.players.length;
  const markers = challenge.markers
    .filter((marker) => (marker.minPlayers ?? 1) <= playerCount && (marker.forPlayer ?? 1) <= playerCount)
    .map(({ minPlayers, forPlayer, ...marker }) => marker);
  return { crewZones, markers };
}
