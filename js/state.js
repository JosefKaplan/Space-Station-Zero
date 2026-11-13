// Saved state: loading, saving and every rule-driven change to it. No DOM in here.
import {
  ABILITY_PAGES, AGENDAS, BASE_STATS_BY_CREW_SIZE, CHALLENGES, COMMANDER_ADVANCEMENTS, COMMANDER_BONUS_XP_PER_CHALLENGE,
  COMMANDER_FREE_STAT_POINTS, CREW_ADVANCEMENTS, CREW_TYPES, INJURY_ROLL_MAX, INJURY_ROLL_MIN, MAX_LEGACY_COUNT,
  SHIP_TYPES, STARTING_CHALLENGE, STAT_KEYS, XP_PER_SURVIVED_CHALLENGE, injuryOutcomeForRoll,
} from './data.js';

export const STORAGE_KEY = 'ssz-captains-log';
const SCHEMA_VERSION = 3;
const MEMBER_STATUSES = ['active', 'recovering', 'dead'];

export function createEmptyState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    // station survives across crews; run is one crew's campaign
    station: { agendaProgress: {}, legacyCount: 0, pastCrews: [] },
    run: null,
  };
}

export function zeroStats() {
  return Object.fromEntries(STAT_KEYS.map((stat) => [stat, 0]));
}

export function commanderPointsSpent(commanderPoints) {
  return STAT_KEYS.reduce((total, stat) => total + commanderPoints[stat], 0);
}

// v1 stored currentCleared and visited (both derivable from cleared) and an unused id per log entry
function migrateFromVersion1(saved) {
  if (saved.run) {
    delete saved.run.currentCleared;
    delete saved.run.visited;
    if (Array.isArray(saved.run.log)) for (const entry of saved.run.log) delete entry.id;
  }
  saved.schemaVersion = 2;
}

// v2 did not record the path walked or where crew members fell
function migrateFromVersion2(saved) {
  for (const crew of saved.station?.pastCrews ?? []) {
    crew.route = [];
    crew.fallen = (crew.fallen ?? []).map((name) => ({ name, challenge: null }));
  }
  if (saved.run) {
    // every log entry was written in the room the crew stood in, so their order replays the walk
    const walked = (saved.run.log ?? []).map((entry) => entry.challenge).concat(saved.run.currentChallenge);
    saved.run.route = walked.filter((challenge, index) => challenge !== walked[index - 1]);
    for (const member of saved.run.crew?.members ?? []) member.diedInChallenge = null;
  }
  saved.schemaVersion = 3;
}

function requireValid(condition, what) {
  if (!condition) throw new Error(`Save data is damaged: ${what}.`);
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isCount = (value) => Number.isInteger(value) && value >= 0;
const isChallengeNumber = (value) => Number.isInteger(value) && value in CHALLENGES;
const isChallengeList = (value) => Array.isArray(value) && value.every(isChallengeNumber);

// A save that passes here can be rendered without crashing, and holds nothing but plain text and numbers.
function assertValidState(saved) {
  const { station, run } = saved;
  requireValid(isPlainObject(station), 'station is missing');
  requireValid(isPlainObject(station.agendaProgress)
    && Object.entries(station.agendaProgress).every(([key, found]) => key in AGENDAS && isCount(found)), 'agenda progress');
  requireValid(isCount(station.legacyCount), 'legacy count');
  requireValid(Array.isArray(station.pastCrews) && station.pastCrews.every((crew) => isPlainObject(crew)
    && typeof crew.name === 'string' && typeof crew.outcome === 'string' && isChallengeNumber(crew.endedInChallenge)
    && isCount(crew.challengesCleared) && isChallengeList(crew.route) && Array.isArray(crew.fallen)
    && crew.fallen.every((entry) => isPlainObject(entry) && typeof entry.name === 'string'
      && (entry.challenge === null || isChallengeNumber(entry.challenge)))), 'previous crews');
  if (run === null) return;

  requireValid(isPlainObject(run) && isPlainObject(run.crew), 'crew is missing');
  const { crew } = run;
  requireValid(typeof crew.name === 'string' && typeof crew.edge === 'string', 'crew name or edge');
  requireValid(crew.size in BASE_STATS_BY_CREW_SIZE && crew.shipType in SHIP_TYPES, 'crew size or ship type');
  requireValid(crew.agenda === '' || crew.agenda in AGENDAS, 'secondary agenda');
  requireValid(Array.isArray(crew.members) && crew.members.length > 0, 'crew members');
  crew.members.forEach((member, index) => {
    requireValid(isPlainObject(member)
      && ['id', 'name', 'type', 'abilities', 'equipment'].every((field) => typeof member[field] === 'string')
      && typeof member.isCommander === 'boolean' && MEMBER_STATUSES.includes(member.status)
      && (member.diedInChallenge === null || isChallengeNumber(member.diedInChallenge))
      && isPlainObject(member.stats) && STAT_KEYS.every((stat) => isCount(member.stats[stat]))
      && ['damage', 'xp', 'advancementsTaken'].every((field) => isCount(member[field])), `crew member ${index + 1}`);
  });
  requireValid(isChallengeNumber(run.currentChallenge), 'current challenge');
  requireValid(isChallengeList(run.cleared) && isChallengeList(run.sealed), 'cleared or sealed challenges');
  requireValid(isChallengeList(run.route) && run.route.at(-1) === run.currentChallenge, 'route');
  requireValid([null, 'lost', 'victory'].includes(run.ended), 'campaign ending');
  requireValid(Array.isArray(run.log) && run.log.every((entry) => isPlainObject(entry) && isChallengeNumber(entry.challenge)
    && typeof entry.at === 'string' && typeof entry.text === 'string' && typeof entry.isNote === 'boolean'), 'log');
}

export function parseSavedState(text) {
  const saved = JSON.parse(text);
  if (!isPlainObject(saved) || ![1, 2, SCHEMA_VERSION].includes(saved.schemaVersion)) {
    throw new Error(`Not a Captain's Log save, or an unsupported version (schemaVersion: ${saved?.schemaVersion}).`);
  }
  if (saved.schemaVersion === 1) migrateFromVersion1(saved);
  if (saved.schemaVersion === 2) migrateFromVersion2(saved);
  assertValidState(saved);
  return saved;
}

export function loadState() {
  const rawSave = localStorage.getItem(STORAGE_KEY);
  return rawSave === null ? createEmptyState() : parseSavedState(rawSave);
}

export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function isCurrentChallengeCleared(run) {
  return run.cleared.includes(run.currentChallenge);
}

// a room can only be left once cleared, so the rooms seen so far are the cleared ones plus the current one
export function visitedChallenges(run) {
  return isCurrentChallengeCleared(run) ? run.cleared : [...run.cleared, run.currentChallenge];
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function statsWithBonus(baseStats, bonus) {
  const stats = { ...baseStats };
  for (const [stat, amount] of Object.entries(bonus)) stats[stat] += amount;
  return stats;
}

export function createMember({ name, type, isCommander, stats, abilities = '' }) {
  return {
    id: newId(), name, type, isCommander, stats,
    damage: 0, xp: 0, advancementsTaken: 0, abilities, equipment: '', status: 'active', diedInChallenge: null,
  };
}

function abilityLines(abilityNames) {
  return abilityNames.map((abilityName) => `${abilityName} (p. ${ABILITY_PAGES[abilityName]})`).join('\n');
}

export function addLogEntry(run, text, isNote = false) {
  run.log.push({ challenge: run.currentChallenge, at: new Date().toISOString(), text, isNote });
}

export function startNewCrew(state, { name, size, shipType, edge, agenda, commanderName, commanderPoints, memberNames, memberTypes }) {
  const baseStats = BASE_STATS_BY_CREW_SIZE[size];
  const ship = SHIP_TYPES[shipType];
  const chosenTypes = memberTypes.slice(0, size);
  const unavailableType = chosenTypes.find((type) => !ship.crewTypes.includes(type));
  if (unavailableType) throw new Error(`${unavailableType} cannot be recruited on a ${shipType} ship (p. ${ship.page}).`);
  if (commanderPointsSpent(commanderPoints) > COMMANDER_FREE_STAT_POINTS) throw new Error(`The commander has only ${COMMANDER_FREE_STAT_POINTS} free stat points.`);

  const members = [
    createMember({ name: commanderName || 'Commander', type: 'Commander', isCommander: true,
      stats: statsWithBonus(statsWithBonus(baseStats, ship.commanderBonus), commanderPoints),
      abilities: abilityLines([ship.commanderAbility]) }),
    ...chosenTypes.map((type, index) => createMember({
      name: memberNames[index]?.trim() || `Crew ${index + 1}`, type, isCommander: false, stats: statsWithBonus(baseStats, CREW_TYPES[type].bonus),
      abilities: abilityLines(CREW_TYPES[type].abilities),
    })),
  ];
  // a finished agenda can be taken again by a new crew; unfinished progress carries over
  if (agenda && (state.station.agendaProgress[agenda] ?? 0) >= AGENDAS[agenda].partsNeeded) {
    state.station.agendaProgress[agenda] = 0;
  }
  state.run = {
    crew: { name: name || 'Unnamed crew', size, shipType, edge, agenda, members },
    currentChallenge: STARTING_CHALLENGE, route: [STARTING_CHALLENGE], cleared: [], sealed: [], log: [], ended: null,
  };
  addLogEntry(state.run, `${state.run.crew.name} leaves Dock Zero.`);
}

export function pendingAdvancement(member) {
  const table = member.isCommander ? COMMANDER_ADVANCEMENTS : CREW_ADVANCEMENTS;
  const next = table[member.advancementsTaken];
  return next && member.xp >= next.xp ? next : null;
}

export function takeAdvancement(member, chosenStat) {
  const advancement = pendingAdvancement(member);
  if (!advancement) throw new Error(`${member.name} has no advancement to take.`);
  if (advancement.statOptions) {
    if (!advancement.statOptions.includes(chosenStat)) throw new Error(`Stat ${chosenStat} is not allowed for this advancement.`);
    member.stats[chosenStat] += 1;
  } else {
    member.abilities = [member.abilities, advancement.ability].filter(Boolean).join('\n');
  }
  member.advancementsTaken += 1;
}

export function agendaProgress(state) {
  const agendaKey = state.run?.crew.agenda;
  if (!agendaKey) return null;
  const found = state.station.agendaProgress[agendaKey] ?? 0;
  const { partsNeeded } = AGENDAS[agendaKey];
  return { agendaKey, found, partsNeeded, isComplete: found >= partsNeeded };
}

export function canAdvanceAgendaInCurrentChallenge(state) {
  const progress = agendaProgress(state);
  return Boolean(progress && !progress.isComplete
    && CHALLENGES[state.run.currentChallenge].agendas?.includes(progress.agendaKey));
}

// the map marks where each crew member fell; a death undone on the roster loses its mark
export function recordDeathLocations(run) {
  for (const member of run.crew.members) {
    if (member.status !== 'dead') member.diedInChallenge = null;
    else member.diedInChallenge ??= run.currentChallenge;
  }
}

function applyInjury(member, outcome, chosenStat) {
  const changeAllStats = (delta) => {
    for (const stat of STAT_KEYS) member.stats[stat] = Math.max(0, member.stats[stat] + delta);
  };
  switch (outcome.key) {
    case 'hidden':
    case 'dead': member.status = 'dead'; break;
    case 'allStatsDown': changeAllStats(-1); break;
    case 'recovering': member.status = 'recovering'; break;
    case 'oneStatUp': member.stats[chosenStat] += 1; break;
    case 'allStatsUp': changeAllStats(1); break;
    case 'fullRecovery': break;
    default: throw new Error(`Unknown injury outcome: ${outcome.key}`);
  }
}

// draft: { downed: { [memberId]: { roll, stat } }, bonusXp: { [memberId]: number },
//          agendaPartFound, legacyEarned, note }
export function completeCurrentChallenge(state, draft) {
  const run = state.run;
  if (isCurrentChallengeCleared(run)) throw new Error(`Challenge ${run.currentChallenge} is already cleared.`);
  const challenge = CHALLENGES[run.currentChallenge];
  const participants = run.crew.members.filter((member) => member.status === 'active');
  const benchedLastChallenge = run.crew.members.filter((member) => member.status === 'recovering');

  // validate everything before changing anything
  const injuries = participants.filter((member) => draft.downed[member.id]).map((member) => {
    const outcome = injuryOutcomeForRoll(Number(draft.downed[member.id].roll));
    if (!outcome) throw new Error(`${member.name} needs an Injuries & Death roll between ${INJURY_ROLL_MIN} and ${INJURY_ROLL_MAX}.`);
    return { member, outcome, chosenStat: draft.downed[member.id].stat };
  });

  const injurySummaries = injuries.map(({ member, outcome, chosenStat }) => {
    applyInjury(member, outcome, chosenStat);
    return `${member.name}: ${outcome.label}`;
  });
  recordDeathLocations(run);

  for (const member of participants) {
    if (member.status === 'dead') continue;
    member.xp += XP_PER_SURVIVED_CHALLENGE + (member.isCommander ? COMMANDER_BONUS_XP_PER_CHALLENGE : 0)
      + Math.max(0, Math.trunc(Number(draft.bonusXp[member.id]) || 0));
  }
  for (const member of benchedLastChallenge) member.status = 'active';
  for (const member of run.crew.members) member.damage = 0;

  const logLines = [`Cleared Challenge ${run.currentChallenge} — ${challenge.name}.`, ...injurySummaries];

  if (draft.agendaPartFound && canAdvanceAgendaInCurrentChallenge(state)) {
    const progressBefore = agendaProgress(state);
    state.station.agendaProgress[progressBefore.agendaKey] = progressBefore.found + 1;
    const progressAfter = agendaProgress(state);
    logLines.push(`${AGENDAS[progressAfter.agendaKey].name} agenda: ${progressAfter.found}/${progressAfter.partsNeeded}`
      + (progressAfter.isComplete ? ' — complete.' : '.'));
  }
  if (draft.legacyEarned && challenge.canEarnLegacy) {
    state.station.legacyCount = Math.min(MAX_LEGACY_COUNT, state.station.legacyCount + 1);
    logLines.push('The station will remember this.');
  }

  run.cleared.push(run.currentChallenge);
  if (challenge.noReturn) {
    run.sealed = [...run.cleared];
    logLines.push('No way back.');
  }
  addLogEntry(run, logLines.join(' '));
  if (draft.note?.trim()) addLogEntry(run, draft.note.trim(), true);

  const hasExits = challenge.exits || challenge.exitRoll;
  if (run.crew.members.every((member) => member.status === 'dead')) {
    run.ended = 'lost';
    addLogEntry(run, 'The crew is lost to the station.');
  } else if (!hasExits) {
    run.ended = 'victory';
    addLogEntry(run, 'The journey ends here.');
  }
}

export function reachableClearedChallenges(run) {
  return run.cleared.filter((number) => number !== run.currentChallenge && !run.sealed.includes(number));
}

export function moveToChallenge(run, destination, viaLabel) {
  if (!isCurrentChallengeCleared(run)) throw new Error('Clear the current challenge before leaving it.');
  if (run.sealed.includes(destination)) throw new Error(`Challenge ${destination} is sealed behind you.`);
  addLogEntry(run, `${viaLabel} → Challenge ${destination}.`);
  run.currentChallenge = destination;
  run.route.push(destination);
}

export function retireCrew(state) {
  const run = state.run;
  state.station.pastCrews.push({
    name: run.crew.name,
    outcome: run.ended ?? 'retired',
    endedInChallenge: run.currentChallenge,
    challengesCleared: run.cleared.length,
    route: run.route,
    fallen: run.crew.members.filter((member) => member.status === 'dead')
      .map((member) => ({ name: member.name, challenge: member.diedInChallenge })),
  });
  state.run = null;
}

export function logAsMarkdown(run) {
  const lines = [`# Captain's Log — ${run.crew.name}`];
  let lastChallenge = null;
  for (const entry of run.log) {
    if (entry.challenge !== lastChallenge) {
      lines.push('', `## Challenge ${entry.challenge} — ${CHALLENGES[entry.challenge].name}`, '');
      lastChallenge = entry.challenge;
    }
    lines.push(entry.isNote ? `> ${entry.text.replace(/\n/g, '\n> ')}` : `- ${entry.text}`);
  }
  return lines.join('\n') + '\n';
}
