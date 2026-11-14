// Saved state: loading, saving and every rule-driven change to it. No DOM in here.
import {
  ABILITY_PAGES, AGENDAS, BASE_STATS_BY_CREW_SIZE, CHALLENGES, COMMANDER_ADVANCEMENTS, COMMANDER_BONUS_XP_PER_CHALLENGE,
  COMMANDER_FREE_STAT_POINTS, CREW_ADVANCEMENTS, CREW_TYPES, INJURY_ROLL_MAX, INJURY_ROLL_MIN, MAX_LEGACY_COUNT,
  SHIP_TYPES, STARTING_CHALLENGE, STAT_KEYS, XP_PER_SURVIVED_CHALLENGE, equipmentLine, injuryOutcomeForRoll, startingGearRules,
} from './data.js';
import { isValidTerrain } from './terrain.js';

export const STORAGE_KEY = 'ssz-captains-log';
const SCHEMA_VERSION = 6;   // of one playthrough's state (station + run)
const STORE_VERSION = 7;    // of what is saved: a list of named playthroughs and the saved starting crews
const MAX_PLAYTHROUGH_NAME_LENGTH = 40;
export const MAX_CREWS = 4;   // crews travelling together in one playthrough
const MEMBER_STATUSES = ['active', 'recovering', 'dead'];

function createEmptyState() {
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

// v3 had no set-up step before a challenge; a crew already in a room is treated as having started it
function migrateFromVersion3(saved) {
  if (saved.run) saved.run.roomSetup = { isMissionStarted: true, terrain: null };
  saved.schemaVersion = 4;
}

// v4 drew the board upright (22" × 30"); terrain rolled there does not fit the landscape board, so roll it again
function migrateFromVersion4(saved) {
  if (saved.run?.roomSetup) saved.run.roomSetup.terrain = null;
  saved.schemaVersion = 5;
}

// v5 had one crew per run; v6 has a party of crews that travel together
function migrateFromVersion5(saved) {
  if (saved.run) {
    saved.run.crews = [{ id: newId(), ...saved.run.crew }];
    delete saved.run.crew;
  }
  saved.schemaVersion = 6;
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

  requireValid(isPlainObject(run) && Array.isArray(run.crews) && run.crews.length >= 1 && run.crews.length <= MAX_CREWS, 'the crews');
  const crewIds = new Set();
  const memberIds = new Set();
  run.crews.forEach((crew, crewIndex) => {
    requireValid(isPlainObject(crew) && typeof crew.id === 'string' && crew.id !== '' && !crewIds.has(crew.id), `crew ${crewIndex + 1} id`);
    crewIds.add(crew.id);
    requireValid(typeof crew.name === 'string' && typeof crew.edge === 'string', 'crew name or edge');
    requireValid(crew.size in BASE_STATS_BY_CREW_SIZE && crew.shipType in SHIP_TYPES, 'crew size or ship type');
    requireValid(crew.agenda === '' || crew.agenda in AGENDAS, 'secondary agenda');
    requireValid(Array.isArray(crew.members) && crew.members.length > 0, 'crew members');
    crew.members.forEach((member, index) => {
      requireValid(isPlainObject(member)
        && ['id', 'name', 'type', 'abilities', 'equipment'].every((field) => typeof member[field] === 'string')
        && !memberIds.has(member.id)
        && typeof member.isCommander === 'boolean' && MEMBER_STATUSES.includes(member.status)
        && (member.diedInChallenge === null || isChallengeNumber(member.diedInChallenge))
        && isPlainObject(member.stats) && STAT_KEYS.every((stat) => isCount(member.stats[stat]))
        && ['damage', 'xp', 'advancementsTaken'].every((field) => isCount(member[field])), `crew ${crewIndex + 1}, member ${index + 1}`);
      memberIds.add(member.id);
    });
  });
  requireValid(isChallengeNumber(run.currentChallenge), 'current challenge');
  requireValid(isChallengeList(run.cleared) && isChallengeList(run.sealed), 'cleared or sealed challenges');
  requireValid(isChallengeList(run.route) && run.route.at(-1) === run.currentChallenge, 'route');
  requireValid([null, 'lost', 'victory'].includes(run.ended), 'campaign ending');
  requireValid(isPlainObject(run.roomSetup) && typeof run.roomSetup.isMissionStarted === 'boolean'
    && (run.roomSetup.terrain === null || isValidTerrain(run.roomSetup.terrain)), 'room set-up');
  requireValid(Array.isArray(run.log) && run.log.every((entry) => isPlainObject(entry) && isChallengeNumber(entry.challenge)
    && typeof entry.at === 'string' && typeof entry.text === 'string' && typeof entry.isNote === 'boolean'), 'log');
}

// one playthrough's state, brought up to the current version and checked
function migratedState(saved) {
  if (!isPlainObject(saved) || ![1, 2, 3, 4, 5, SCHEMA_VERSION].includes(saved.schemaVersion)) {
    throw new Error(`Not a Captain's Log save, or an unsupported version (schemaVersion: ${saved?.schemaVersion}).`);
  }
  if (saved.schemaVersion === 1) migrateFromVersion1(saved);
  if (saved.schemaVersion === 2) migrateFromVersion2(saved);
  if (saved.schemaVersion === 3) migrateFromVersion3(saved);
  if (saved.schemaVersion === 4) migrateFromVersion4(saved);
  if (saved.schemaVersion === 5) migrateFromVersion5(saved);
  assertValidState(saved);
  return saved;
}

// ---------- playthroughs ----------
// What is saved is { schemaVersion: 7, activeId, playthroughs: [{ id, name, state, updatedAt }], deletedIds: [{ id, at }],
// crewTemplates: [{ id, name, draft }], crewTemplatesUpdatedAt }. Each playthrough is a whole,
// separate campaign (its own station layer and run). The app works on the active one's `state` object directly, so
// everything that changes it only has to call saveState().

let store = null;
// what each playthrough looked like when it was last saved, by id: a save that changes nothing does not count as a change
const lastSavedJsonById = new Map();
const changeListeners = [];

const jsonOfEntry = (entry) => JSON.stringify([entry.name, entry.state]);

function rememberSavedEntries() {
  lastSavedJsonById.clear();
  for (const entry of store.playthroughs) lastSavedJsonById.set(entry.id, jsonOfEntry(entry));
}

// called (with the playthrough's id) after a save that really changed a playthrough, or deleted one
export function onPlaythroughChange(listener) {
  changeListeners.push(listener);
}

function newPlaythroughId() {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function validatedPlaythroughName(name, otherNames) {
  const trimmed = String(name ?? '').trim();
  if (trimmed === '') throw new Error('Give the playthrough a name.');
  if (trimmed.length > MAX_PLAYTHROUGH_NAME_LENGTH) throw new Error(`Keep the name to ${MAX_PLAYTHROUGH_NAME_LENGTH} characters.`);
  if (otherNames.some((other) => other.toLowerCase() === trimmed.toLowerCase())) throw new Error(`There is already a playthrough called "${trimmed}".`);
  return trimmed;
}

const isValidTemplate = (template) => isPlainObject(template) && typeof template.id === 'string' && template.id !== ''
  && typeof template.name === 'string' && template.name.trim() !== '' && isPlainObject(template.draft);
const validTemplates = (templates) => (Array.isArray(templates) ? templates.filter(isValidTemplate) : []);

function freshStore() {
  const id = newPlaythroughId();
  return { schemaVersion: STORE_VERSION, activeId: id, playthroughs: [{ id, name: 'Playthrough 1', state: createEmptyState(), updatedAt: Date.now() }], deletedIds: [], crewTemplates: [], crewTemplatesUpdatedAt: 0 };
}

// a save from before playthroughs existed is one playthrough
function storeFromSingleState(state) {
  const id = newPlaythroughId();
  return { schemaVersion: STORE_VERSION, activeId: id, playthroughs: [{ id, name: 'Playthrough 1', state: migratedState(state), updatedAt: Date.now() }], deletedIds: [], crewTemplates: [], crewTemplatesUpdatedAt: 0 };
}

function validatedStore(saved) {
  requireValid(Array.isArray(saved.playthroughs) && saved.playthroughs.length > 0, 'the list of playthroughs');
  const ids = new Set();
  for (const entry of saved.playthroughs) {
    requireValid(isPlainObject(entry) && typeof entry.id === 'string' && entry.id !== '' && !ids.has(entry.id), 'a playthrough id');
    requireValid(typeof entry.name === 'string' && entry.name.trim() !== '' && entry.name.length <= MAX_PLAYTHROUGH_NAME_LENGTH, 'a playthrough name');
    ids.add(entry.id);
    entry.state = migratedState(entry.state);
    // a store from before syncing has no change times: it counts as changed just now, so it wins the first sync
    if (!Number.isFinite(entry.updatedAt)) entry.updatedAt = Date.now();
  }
  saved.deletedIds = (Array.isArray(saved.deletedIds) ? saved.deletedIds : []).filter((marker) => isPlainObject(marker) && typeof marker.id === 'string' && Number.isFinite(marker.at));
  requireValid(ids.has(saved.activeId), 'the active playthrough');
  // a store from before saved starting crews has none
  saved.crewTemplates = validTemplates(saved.crewTemplates);
  if (!Number.isFinite(saved.crewTemplatesUpdatedAt)) saved.crewTemplatesUpdatedAt = 0;
  saved.schemaVersion = STORE_VERSION;
  return saved;
}

// a single campaign's save also has a schemaVersion that may equal STORE_VERSION: tell them apart by the list
const isStoreOfPlaythroughs = (saved) => isPlainObject(saved) && Array.isArray(saved.playthroughs);

function storeFromText(text) {
  const saved = JSON.parse(text);
  return isStoreOfPlaythroughs(saved) ? validatedStore(saved) : storeFromSingleState(saved);
}

function activeEntry() {
  return store.playthroughs.find((entry) => entry.id === store.activeId);
}

export function loadState() {
  const rawSave = localStorage.getItem(STORAGE_KEY);
  store = rawSave === null ? freshStore() : storeFromText(rawSave);
  rememberSavedEntries();
  return activeEntry().state;
}

// the active playthrough's state object: it is replaced when a sync brings in a newer copy of it
export function activeState() {
  return activeEntry().state;
}

// writes every playthrough: the active one's state is changed in place, so it is already what is stored
export function saveState() {
  const entry = activeEntry();
  const json = jsonOfEntry(entry);
  const hasChanged = lastSavedJsonById.get(entry.id) !== json;
  if (hasChanged) {
    entry.updatedAt = Date.now();
    lastSavedJsonById.set(entry.id, json);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  if (hasChanged) changeListeners.forEach((listener) => listener(entry.id));
}

export function listPlaythroughs() {
  return store.playthroughs.map((entry) => ({ id: entry.id, name: entry.name, isActive: entry.id === store.activeId, state: entry.state }));
}

export function activePlaythroughName() {
  return activeEntry().name;
}

export function switchPlaythrough(id) {
  const entry = store.playthroughs.find((candidate) => candidate.id === id);
  if (!entry) throw new Error('That playthrough no longer exists.');
  store.activeId = id;
  saveState();
  return entry.state;
}

export function addPlaythrough(name) {
  const trimmed = validatedPlaythroughName(name, store.playthroughs.map((entry) => entry.name));
  const entry = { id: newPlaythroughId(), name: trimmed, state: createEmptyState(), updatedAt: Date.now() };
  store.playthroughs.push(entry);
  store.activeId = entry.id;
  saveState();
  return entry.state;
}

export function renameActivePlaythrough(name) {
  const others = store.playthroughs.filter((entry) => entry.id !== store.activeId).map((entry) => entry.name);
  activeEntry().name = validatedPlaythroughName(name, others);
  saveState();
}

// the one after it (or before, for the last) becomes active; the only playthrough cannot be deleted
export function deleteActivePlaythrough() {
  if (store.playthroughs.length === 1) throw new Error('This is the only playthrough: add another one first, or wipe everything.');
  const index = store.playthroughs.findIndex((entry) => entry.id === store.activeId);
  const [removed] = store.playthroughs.splice(index, 1);
  lastSavedJsonById.delete(removed.id);
  store.deletedIds.push({ id: removed.id, at: Date.now() });
  store.activeId = store.playthroughs[Math.min(index, store.playthroughs.length - 1)].id;
  saveState();
  changeListeners.forEach((listener) => listener(removed.id));
  return activeEntry().state;
}

export function wipeEverything() {
  const removedIds = store.playthroughs.map((entry) => entry.id);
  store = freshStore();
  store.deletedIds = removedIds.map((id) => ({ id, at: Date.now() }));
  rememberSavedEntries();
  saveState();
  removedIds.forEach((id) => changeListeners.forEach((listener) => listener(id)));
  return activeEntry().state;
}

export function exportSaveText() {
  return JSON.stringify(store, null, 2);
}

// A backup of everything replaces everything; the save of a single campaign (from before playthroughs, or one
// exported long ago) is added as a new playthrough, so nothing you have is overwritten. Returns the active state.
export function importSave(text) {
  const saved = JSON.parse(text);
  if (isStoreOfPlaythroughs(saved)) {
    store = validatedStore(saved);
    rememberSavedEntries();
  } else {
    const state = migratedState(saved);
    const baseName = 'Imported save';
    const names = store.playthroughs.map((entry) => entry.name);
    let name = baseName;
    for (let number = 2; names.includes(name); number += 1) name = `${baseName} ${number}`;
    const entry = { id: newPlaythroughId(), name, state, updatedAt: Date.now() };
    store.playthroughs.push(entry);
    store.activeId = entry.id;
  }
  saveState();
  return activeEntry().state;
}

// ---------- saved starting crews ----------
// A starting crew is the creator's form as it was when saved: name, ship, edge, commander, crew and the starting gear.
// It is a recipe, never a live crew: a campaign that uses it gets its own fresh crew, and nothing a crew earns in a
// campaign (XP, boosts, equipment) ever flows back. So a template stays the same, always.

export const CREW_TEMPLATES_ROW_ID = 'crew-templates';   // how the whole list travels through the cloud table

function notifyCrewTemplatesChanged() {
  store.crewTemplatesUpdatedAt = Date.now();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  changeListeners.forEach((listener) => listener(CREW_TEMPLATES_ROW_ID));
}

export const listCrewTemplates = () => store.crewTemplates;

// Without an id, saving under a name that exists replaces that template. With the id of the template being edited the
// name may change, but not to another template's name.
export function saveCrewTemplate(draft, id = null) {
  const name = String(draft.name ?? '').trim();
  if (name === '') throw new Error('Give the crew a name first: it is the name of the saved starting crew.');
  const sameName = store.crewTemplates.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());
  if (id && sameName && sameName.id !== id) throw new Error(`There is already a starting crew called "${sameName.name}".`);
  const existing = id ? store.crewTemplates.find((candidate) => candidate.id === id) : sameName;
  if (id && !existing) throw new Error('That starting crew no longer exists.');
  const template = { id: existing?.id ?? newId(), name, draft: structuredClone(draft) };
  store.crewTemplates = [...store.crewTemplates.filter((candidate) => candidate !== existing), template]
    .sort((a, b) => a.name.localeCompare(b.name));
  notifyCrewTemplatesChanged();
  return { template, replaced: Boolean(existing) };
}

export function deleteCrewTemplate(id) {
  store.crewTemplates = store.crewTemplates.filter((template) => template.id !== id);
  notifyCrewTemplatesChanged();
}

// ---------- for syncing (js/cloud-sync.js) ----------

// the empty "Playthrough 1" a brand-new browser starts with, never touched: it is not worth uploading, and it makes
// way for playthroughs that arrive from the cloud
const isUntouchedStarter = (entry) => entry.name === 'Playthrough 1' && JSON.stringify(entry.state) === JSON.stringify(createEmptyState());

// Rows from the cloud are untrusted: each one is checked like an imported save, and a bad one is skipped and reported.
// Returns { changed: boolean (anything local changed), activeReplaced: boolean (the active state object is a new one) }.
export function mergeRemotePlaythroughs(allRows) {
  const result = { changed: false, activeReplaced: false, skipped: [] };
  const templatesRow = allRows.find((row) => row.id === CREW_TEMPLATES_ROW_ID);
  const rows = allRows.filter((row) => row !== templatesRow);
  if (templatesRow && !templatesRow.deleted && templatesRow.updated_at > store.crewTemplatesUpdatedAt) {
    try {
      store.crewTemplates = validTemplates(templatesRow.state?.templates);
      store.crewTemplatesUpdatedAt = templatesRow.updated_at;
      result.changed = true;
    } catch (error) {
      result.skipped.push(`saved starting crews: ${error.message}`);
    }
  }
  const deletedLocally = new Set(store.deletedIds.map((marker) => marker.id));
  for (const row of rows) {
    if (deletedLocally.has(row.id)) continue;   // deleted here: the marker is uploaded instead
    const local = store.playthroughs.find((entry) => entry.id === row.id);
    try {
      if (row.deleted) {
        if (local && row.updated_at >= local.updatedAt && store.playthroughs.length > 1) {
          store.playthroughs = store.playthroughs.filter((entry) => entry !== local);
          lastSavedJsonById.delete(local.id);
          if (store.activeId === local.id) { store.activeId = store.playthroughs[0].id; result.activeReplaced = true; }
          result.changed = true;
        }
        continue;
      }
      if (local && row.updated_at <= local.updatedAt) continue;
      requireValid(typeof row.id === 'string' && row.id !== '' && typeof row.name === 'string' && row.name.trim() !== ''
        && row.name.length <= MAX_PLAYTHROUGH_NAME_LENGTH && Number.isFinite(row.updated_at), 'a playthrough from the cloud');
      const state = migratedState(structuredClone(row.state));
      if (local) {
        Object.assign(local, { name: row.name, state, updatedAt: row.updated_at });
        if (store.activeId === local.id) result.activeReplaced = true;
      } else {
        store.playthroughs.push({ id: row.id, name: row.name, state, updatedAt: row.updated_at });
      }
      lastSavedJsonById.set(row.id, jsonOfEntry(store.playthroughs.find((entry) => entry.id === row.id)));
      result.changed = true;
    } catch (error) {
      result.skipped.push(`${row.name ?? row.id}: ${error.message}`);
    }
  }
  const starter = store.playthroughs.find(isUntouchedStarter);
  if (result.changed && starter && store.playthroughs.length > 1) {
    store.playthroughs = store.playthroughs.filter((entry) => entry !== starter);
    lastSavedJsonById.delete(starter.id);
    if (store.activeId === starter.id) { store.activeId = store.playthroughs[0].id; result.activeReplaced = true; }
  }
  if (result.changed) localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  return result;
}

// what the cloud lacks or has an older version of, as rows ready to upload (tombstones for deletions included)
export function rowsToUpload(remoteUpdatedAtById) {
  const rows = store.playthroughs
    .filter((entry) => !isUntouchedStarter(entry))
    .filter((entry) => !remoteUpdatedAtById.has(entry.id) || entry.updatedAt > remoteUpdatedAtById.get(entry.id))
    .map((entry) => ({ id: entry.id, name: entry.name, state: entry.state, updated_at: entry.updatedAt, deleted: false }));
  if (store.crewTemplatesUpdatedAt > 0 && (!remoteUpdatedAtById.has(CREW_TEMPLATES_ROW_ID) || store.crewTemplatesUpdatedAt > remoteUpdatedAtById.get(CREW_TEMPLATES_ROW_ID))) {
    rows.push({ id: CREW_TEMPLATES_ROW_ID, name: 'Saved starting crews', state: { templates: store.crewTemplates }, updated_at: store.crewTemplatesUpdatedAt, deleted: false });
  }
  // a deletion only needs telling to the cloud if the cloud has the playthrough at all
  const tombstones = store.deletedIds
    .filter((marker) => remoteUpdatedAtById.has(marker.id))
    .map((marker) => ({ id: marker.id, name: 'deleted', state: {}, updated_at: marker.at, deleted: true }));
  return { rows, tombstones };
}

// markers that reached the cloud (or concern things the cloud never had) are no longer needed
export function forgetDeletionMarkers(ids) {
  store.deletedIds = store.deletedIds.filter((marker) => !ids.includes(marker.id));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function pendingDeletionIds() {
  return store.deletedIds.map((marker) => marker.id);
}

export function isCurrentChallengeCleared(run) {
  return run.cleared.includes(run.currentChallenge);
}

// a room can only be left once cleared, so the rooms seen so far are the cleared ones plus the current one
export function visitedChallenges(run) {
  return isCurrentChallengeCleared(run) ? run.cleared : [...run.cleared, run.currentChallenge];
}

// every room starts with the table still to be laid out
function newRoomSetup() {
  return { isMissionStarted: false, terrain: null };
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function statsWithBonus(baseStats, bonus) {
  const stats = { ...baseStats };
  for (const [stat, amount] of Object.entries(bonus)) stats[stat] += amount;
  return stats;
}

export function createMember({ name, type, isCommander, stats, abilities = '', equipment = '' }) {
  return {
    id: newId(), name, type, isCommander, stats,
    damage: 0, xp: 0, advancementsTaken: 0, abilities, equipment, status: 'active', diedInChallenge: null,
  };
}

// What the creator form's gear picks come to for this ship and edge: picks the rules do not allow (left over from another
// ship, say) are dropped and a carrier outside the crew becomes the commander. weapons[0] is the commander's; carriers are
// 0 (commander) to size (the last crew member).
export function sanitizedStartingGear({ size, shipType, edge, weapons = [], bonusItem = '', otherItems = [], otherCarriers = [] }) {
  const rules = startingGearRules(shipType, edge);
  const allowedOr = (items, item) => (items.includes(item) ? item : '');
  return {
    weapons: Array.from({ length: size + 1 }, (_, index) => allowedOr(rules.weaponItems, weapons[index])),
    bonusItem: allowedOr(rules.bonusItems, bonusItem),
    others: rules.otherSlots.map((slot, index) => ({
      item: allowedOr(slot.items, otherItems[index]),
      carrier: Number.isInteger(otherCarriers[index]) && otherCarriers[index] >= 0 && otherCarriers[index] <= size ? otherCarriers[index] : 0,
    })),
  };
}

// the equipment text of the commander (index 0) and of each crew member, one piece per line like the roster's picker writes it
function startingEquipmentByMember(gear, size) {
  const lines = Array.from({ length: size + 1 }, () => []);
  gear.weapons.forEach((item, index) => { if (item) lines[index].push(equipmentLine(item)); });
  if (gear.bonusItem) lines[0].push(equipmentLine(gear.bonusItem));
  gear.others.forEach(({ item, carrier }) => { if (item) lines[carrier].push(equipmentLine(item)); });
  return lines.map((memberLines) => memberLines.join('\n'));
}

function abilityLines(abilityNames) {
  return abilityNames.map((abilityName) => `${abilityName} (p. ${ABILITY_PAGES[abilityName]})`).join('\n');
}

export function addLogEntry(run, text, isNote = false) {
  run.log.push({ challenge: run.currentChallenge, at: new Date().toISOString(), text, isNote });
}

export const allMembers = (run) => run.crews.flatMap((crew) => crew.members);

// the first crew starts the run; the others join it (up to MAX_CREWS), all travelling together from then on
export function addCrew(state, { name, size, shipType, edge, agenda, commanderName, commanderPoints, memberNames, memberTypes, weapons, bonusItem, otherItems, otherCarriers }) {
  if (state.run?.ended) throw new Error('This run has ended: retire the party to start a new one.');
  if (state.run && state.run.crews.length >= MAX_CREWS) throw new Error(`A party has at most ${MAX_CREWS} crews.`);
  const rival = agenda && state.run?.crews.find((crew) => crew.agenda === agenda);
  if (rival) throw new Error(`${rival.name} is already chasing the ${AGENDAS[agenda].name} agenda: progress is counted per agenda, so pick another.`);
  const baseStats = BASE_STATS_BY_CREW_SIZE[size];
  const ship = SHIP_TYPES[shipType];
  const chosenTypes = memberTypes.slice(0, size);
  const unavailableType = chosenTypes.find((type) => !ship.crewTypes.includes(type));
  if (unavailableType) throw new Error(`${unavailableType} cannot be recruited on a ${shipType} ship (p. ${ship.page}).`);
  if (commanderPointsSpent(commanderPoints) > COMMANDER_FREE_STAT_POINTS) throw new Error(`The commander has only ${COMMANDER_FREE_STAT_POINTS} free stat points.`);

  const startingEquipment = startingEquipmentByMember(sanitizedStartingGear({ size, shipType, edge, weapons, bonusItem, otherItems, otherCarriers }), size);
  const members = [
    createMember({ name: commanderName || 'Commander', type: 'Commander', isCommander: true,
      stats: statsWithBonus(statsWithBonus(baseStats, ship.commanderBonus), commanderPoints),
      abilities: abilityLines([ship.commanderAbility]), equipment: startingEquipment[0] }),
    ...chosenTypes.map((type, index) => createMember({
      name: memberNames[index]?.trim() || `Crew ${index + 1}`, type, isCommander: false, stats: statsWithBonus(baseStats, CREW_TYPES[type].bonus),
      abilities: abilityLines(CREW_TYPES[type].abilities), equipment: startingEquipment[index + 1],
    })),
  ];
  // a finished agenda can be taken again by a new crew; unfinished progress carries over
  if (agenda && (state.station.agendaProgress[agenda] ?? 0) >= AGENDAS[agenda].partsNeeded) {
    state.station.agendaProgress[agenda] = 0;
  }
  const crew = { id: newId(), name: name || 'Unnamed crew', size, shipType, edge, agenda, members };
  if (state.run) {
    state.run.crews.push(crew);
    addLogEntry(state.run, `${crew.name} joins the party.`);
    return;
  }
  state.run = {
    crews: [crew],
    currentChallenge: STARTING_CHALLENGE, route: [STARTING_CHALLENGE], cleared: [], sealed: [], log: [], ended: null,
    roomSetup: newRoomSetup(),
  };
  addLogEntry(state.run, `${crew.name} leaves Dock Zero.`);
}

// a crew leaves the party (the last one cannot: retire the party instead); it is remembered like a retired crew
export function removeCrew(state, crewId) {
  const run = state.run;
  if (run.crews.length === 1) throw new Error('This is the only crew: retire the party instead.');
  const crew = run.crews.find((candidate) => candidate.id === crewId);
  run.crews = run.crews.filter((candidate) => candidate !== crew);
  state.station.pastCrews.push(pastCrewRecord(run, crew, 'left the party'));
  addLogEntry(run, `${crew.name} leaves the party.`);
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

export function agendaProgress(state, crew) {
  const agendaKey = crew.agenda;
  if (!agendaKey) return null;
  const found = state.station.agendaProgress[agendaKey] ?? 0;
  const { partsNeeded } = AGENDAS[agendaKey];
  return { agendaKey, found, partsNeeded, isComplete: found >= partsNeeded };
}

export function canAdvanceAgendaInCurrentChallenge(state, crew) {
  const progress = agendaProgress(state, crew);
  return Boolean(progress && !progress.isComplete
    && CHALLENGES[state.run.currentChallenge].agendas?.includes(progress.agendaKey));
}

// the map marks where each crew member fell; a death undone on the roster loses its mark
export function recordDeathLocations(run) {
  for (const member of allMembers(run)) {
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
//          agendaPartFoundByCrew: { [crewId]: boolean }, legacyEarned, note }   (member ids are unique across crews)
export function completeCurrentChallenge(state, draft) {
  const run = state.run;
  if (isCurrentChallengeCleared(run)) throw new Error(`Challenge ${run.currentChallenge} is already cleared.`);
  const challenge = CHALLENGES[run.currentChallenge];
  const participants = allMembers(run).filter((member) => member.status === 'active');
  const benchedLastChallenge = allMembers(run).filter((member) => member.status === 'recovering');

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
  for (const member of allMembers(run)) member.damage = 0;

  const logLines = [`Cleared Challenge ${run.currentChallenge} — ${challenge.name}.`, ...injurySummaries];

  for (const crew of run.crews) {
    if (!draft.agendaPartFoundByCrew?.[crew.id] || !canAdvanceAgendaInCurrentChallenge(state, crew)) continue;
    const progressBefore = agendaProgress(state, crew);
    state.station.agendaProgress[progressBefore.agendaKey] = progressBefore.found + 1;
    const progressAfter = agendaProgress(state, crew);
    logLines.push(`${crew.name}, ${AGENDAS[progressAfter.agendaKey].name} agenda: ${progressAfter.found}/${progressAfter.partsNeeded}`
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
  if (allMembers(run).every((member) => member.status === 'dead')) {
    run.ended = 'lost';
    addLogEntry(run, run.crews.length > 1 ? 'The whole party is lost to the station.' : 'The crew is lost to the station.');
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
  run.roomSetup = newRoomSetup();
}

function pastCrewRecord(run, crew, outcome) {
  return {
    name: crew.name,
    outcome,
    endedInChallenge: run.currentChallenge,
    challengesCleared: run.cleared.length,
    route: [...run.route],
    fallen: crew.members.filter((member) => member.status === 'dead')
      .map((member) => ({ name: member.name, challenge: member.diedInChallenge })),
  };
}

// the whole party is archived, every crew on its own; the station keeps agenda progress and legacy
export function retireParty(state) {
  const run = state.run;
  for (const crew of run.crews) state.station.pastCrews.push(pastCrewRecord(run, crew, run.ended ?? 'retired'));
  state.run = null;
}

export function logAsMarkdown(run) {
  const lines = [`# Captain's Log — ${run.crews.map((crew) => crew.name).join(' & ')}`];
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
