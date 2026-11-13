// Rendering and event handling. Every button re-renders the whole app; typing never does
// (a re-render while typing would drop focus and swallow the next tap).
import {
  ABILITY_PAGES, AGENDAS, AGENDA_ROLL_TARGET, BASE_STATS_BY_CREW_SIZE, CHALLENGES, COMMANDER_BONUS_XP_PER_CHALLENGE,
  COMMANDER_FREE_STAT_POINTS, CREW_TYPES, EDGES, EQUIPMENT_CATEGORIES, INJURY_ROLL_MAX, INJURY_ROLL_MIN,
  LEGACY_PAGE_REFERENCE, SHIP_TYPES, STARTING_OTHER_EQUIPMENT, STAT_KEYS, STAT_LABELS, WEAPONS,
  XP_PER_SURVIVED_CHALLENGE, exitForRoll, injuryOutcomeForRoll, injuryRollRangeLabel,
} from './data.js';
import * as store from './state.js';

const TABS = [['journey', 'Journey'], ['crew', 'Crew'], ['log', 'Log'], ['dice', 'Dice'], ['settings', 'Settings']];
const appElement = document.getElementById('app');

let state = null;
let unreadableSaveMessage = null;
const ui = {
  tab: 'journey',
  postGame: null,
  exitRoll: '',
  confirmKey: null,
  errorMessage: null,
  noticeMessage: null,
  logNote: '',
  dice: { pool: 5, target: '', rolled: null },
  newCrew: { name: '', commanderName: '', size: 6, shipType: 'Exploration', edge: EDGES[0], agenda: '',
    commanderPoints: store.zeroStats(), memberNames: Array(8).fill(''),
    memberTypes: Array(8).fill('Soldier') },
};

// ---------- helpers ----------

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function rollD12() {
  const buffer = new Uint8Array(1);
  // 252 = 21 × 12: reject the top values so every face is equally likely
  do crypto.getRandomValues(buffer); while (buffer[0] >= 252);
  return (buffer[0] % 12) + 1;
}

function getAtPath(root, path) {
  return path.split('.').reduce((object, key) => object[key], root);
}

function setAtPath(root, path, value) {
  const keys = path.split('.');
  const lastKey = keys.pop();
  const parent = keys.length ? getAtPath(root, keys.join('.')) : root;
  parent[lastKey] = value;
}

function options(values, selected) {
  return values.map(([value, label]) => (
    `<option value="${escapeHtml(value)}"${String(value) === String(selected) ? ' selected' : ''}>${escapeHtml(label)}</option>`
  )).join('');
}

function confirmButton(action, label, extraAttributes = '') {
  const isArmed = ui.confirmKey === action + extraAttributes;
  return `<button class="danger" data-action="${action}" data-confirm="${escapeHtml(action + extraAttributes)}" ${extraAttributes}>`
    + `${isArmed ? 'Tap again to confirm' : label}</button>`;
}

function downloadTextFile(filename, text, mimeType) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([text], { type: mimeType }));
  link.download = filename;
  link.click();
  // Safari reads the blob after the click returns; revoking at once cancels the download
  setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
}

function challengeTitle(number) {
  // spoiler safety: a room's name is known only once the crew has been there
  return store.visitedChallenges(state.run).includes(number) ? `${number} · ${CHALLENGES[number].name}` : `${number}`;
}

// ---------- journey ----------

function renderJourney() {
  const run = state.run;
  if (!run) {
    return `<section class="card"><h2>No crew aboard</h2>
      <p>Build your crew with the rulebook (p. 24–39), then register it here.</p>
      <button class="primary" data-action="showTab" data-tab="crew">Create a crew</button></section>`;
  }
  if (run.ended) {
    return `<section class="card"><h2>${run.ended === 'victory' ? 'Journey complete' : 'Crew lost'}</h2>
      <p>${escapeHtml(run.crew.name)} — ${run.cleared.length} challenge(s) cleared, ended in Challenge ${challengeTitle(run.currentChallenge)}.</p>
      ${renderReminders(CHALLENGES[run.currentChallenge].reminders ?? [])}
      <p>Read back the Log, then retire this crew to send a new one in. The station remembers some things.</p>
      ${confirmButton('retireCrew', 'Retire crew')}</section>${renderStationMap()}`;
  }

  const number = run.currentChallenge;
  const challenge = CHALLENGES[number];
  const isCleared = store.isCurrentChallengeCleared(run);
  const benched = run.crew.members.filter((member) => member.status === 'recovering');
  const progress = store.agendaProgress(state);
  // page pointers stay up after the room is cleared (some apply only then); the rest matter only during play
  const reminders = [...(challenge.reminders ?? [])];
  if (!isCleared && challenge.turnLimit) reminders.unshift(`Time limit: end of turn ${challenge.turnLimit}.`);
  if (!isCleared && store.canAdvanceAgendaInCurrentChallenge(state)) {
    reminders.push(`${AGENDAS[progress.agendaKey].name} agenda can advance here — see "Secondary Agenda" in this challenge.`);
  }
  if (!isCleared && state.station.legacyCount > 0) {
    reminders.push(`Station legacy ×${state.station.legacyCount}: ${LEGACY_PAGE_REFERENCE} applies to crews that set out after it was earned.`);
  }
  if (!isCleared && benched.length) {
    reminders.push(`Sitting this one out: ${benched.map((member) => member.name).join(', ')}.`);
  }

  return `<section class="card room">
      <p class="eyebrow">Challenge ${number} <span class="chip ${isCleared ? 'ok' : 'warn'}">${isCleared ? 'cleared' : 'in progress'}</span></p>
      <h2>${escapeHtml(challenge.name)}</h2>
      <p class="page-ref">Rulebook p. ${challenge.page}</p>
      ${renderReminders(reminders)}
      ${isCleared ? renderExits(challenge) : (ui.postGame ? '' : '<button class="primary" data-action="openPostGame">Challenge over →</button>')}
    </section>
    ${!isCleared && ui.postGame ? renderPostGame(challenge, progress) : ''}
    ${renderStationMap()}`;
}

function renderReminders(reminders) {
  return reminders.length ? `<ul class="reminders">${reminders.map((text) => `<li>${escapeHtml(text)}</li>`).join('')}</ul>` : '';
}

function exitRollPreviewText(challenge, enteredRoll) {
  const destination = exitForRoll(challenge, Number(enteredRoll));
  return destination ? `${enteredRoll} → Challenge ${challengeTitle(destination)}` : '';
}

function renderExits(challenge) {
  const run = state.run;
  let exitsHtml;
  if (challenge.exitRoll) {
    exitsHtml = `<p>The way out is left to chance: roll a d12.</p>
      <div class="row">
        <button data-action="rollExit">Roll d12</button>
        <label class="inline">or enter <input type="number" min="1" max="12" inputmode="numeric" data-bind-ui="exitRoll" data-exit-roll-preview value="${escapeHtml(ui.exitRoll)}"></label>
        <button class="primary" data-action="takeRolledExit">Go</button>
      </div>
      <p class="outcome" id="exit-roll-preview">${escapeHtml(exitRollPreviewText(challenge, ui.exitRoll))}</p>`;
  } else {
    exitsHtml = `<div class="stack">${challenge.exits.map((exit) => (
      `<button class="exit" data-action="takeExit" data-to="${exit.to}" data-label="${escapeHtml(exit.label)}">
        <span>${escapeHtml(exit.label)}</span>
        <small>Challenge ${challengeTitle(exit.to)}${run.cleared.includes(exit.to) ? ' · cleared' : ''}</small></button>`
    )).join('')}</div>`;
  }
  const backtrackTargets = store.reachableClearedChallenges(run);
  return `<h3>Exits</h3>${exitsHtml}
    ${backtrackTargets.length ? `<h3>Backtrack (no replay, p. 43)</h3><div class="row wrap">${backtrackTargets.map((number) => (
      `<button data-action="takeExit" data-to="${number}" data-label="Backtracked">${challengeTitle(number)}</button>`)).join('')}</div>` : ''}`;
}

function renderPostGame(challenge, progress) {
  const draft = ui.postGame;
  const participants = state.run.crew.members.filter((member) => member.status === 'active');
  const canAdvanceAgenda = store.canAdvanceAgendaInCurrentChallenge(state);
  const willCompleteAgenda = canAdvanceAgenda && progress.found + 1 >= progress.partsNeeded;

  const oneStatUpRange = injuryRollRangeLabel('oneStatUp');
  const memberRows = participants.map((member) => {
    const downed = draft.downed[member.id];
    const memberId = escapeHtml(member.id);
    const outcome = downed ? injuryOutcomeForRoll(Number(downed.roll)) : null;
    return `<div class="post-member">
      <div class="row">
        <label class="grow"><input type="checkbox" data-action="toggleDowned" data-id="${memberId}"${downed ? ' checked' : ''}> ${escapeHtml(member.name)}</label>
        <label class="inline">bonus XP <input type="number" min="0" inputmode="numeric" data-bind-ui="postGame.bonusXp.${memberId}" value="${escapeHtml(draft.bonusXp[member.id] ?? '')}"></label>
      </div>
      ${downed ? `<div class="row injury">
        <button data-action="rollInjury" data-id="${memberId}">Roll 2d12</button>
        <input type="number" min="${INJURY_ROLL_MIN}" max="${INJURY_ROLL_MAX}" inputmode="numeric" placeholder="${INJURY_ROLL_MIN}–${INJURY_ROLL_MAX}" data-bind-ui="postGame.downed.${memberId}.roll" data-outcome-element="outcome-${memberId}" value="${escapeHtml(downed.roll)}">
        <select data-bind-ui="postGame.downed.${memberId}.stat" title="Stat to raise on a roll of ${oneStatUpRange}">${options(STAT_KEYS.map((stat) => [stat, `+${STAT_LABELS[stat]} on ${oneStatUpRange}`]), downed.stat)}</select>
      </div><p class="outcome" id="outcome-${memberId}">${escapeHtml(outcome?.label ?? '')}</p>` : ''}
    </div>`;
  }).join('');

  return `<section class="card">
    <h2>After the challenge</h2>
    <h3>1 · Injuries &amp; death (p. 40)</h3>
    <p class="hint">Tick everyone who was put Out of Action and needs a roll. Survivors get +${XP_PER_SURVIVED_CHALLENGE} XP (commander +${XP_PER_SURVIVED_CHALLENGE + COMMANDER_BONUS_XP_PER_CHALLENGE}) automatically.</p>
    ${memberRows}
    ${canAdvanceAgenda ? `<h3>2 · ${AGENDAS[progress.agendaKey].name} agenda (${progress.found}/${progress.partsNeeded})</h3>
      <p class="hint">Roll a d12: on ${AGENDA_ROLL_TARGET}+ follow the Secondary Agenda section of this challenge.</p>
      <label><input type="checkbox" data-bind-ui="postGame.agendaPartFound"${draft.agendaPartFound ? ' checked' : ''}> We secured what we came for</label>
      ${willCompleteAgenda ? `<p class="hint">If that completes it: ${escapeHtml(AGENDAS[progress.agendaKey].onCompletion)}</p>` : ''}` : ''}
    ${challenge.canEarnLegacy ? `<h3>Rewards</h3>
      <label><input type="checkbox" data-bind-ui="postGame.legacyEarned"${draft.legacyEarned ? ' checked' : ''}> The Rewards section sent us to ${LEGACY_PAGE_REFERENCE}</label>` : ''}
    <h3>Captain's note</h3>
    <textarea rows="3" placeholder="What happened in here?" data-bind-ui="postGame.note">${escapeHtml(draft.note)}</textarea>
    <div class="row">
      <button data-action="cancelPostGame">Back</button>
      <button class="primary grow" data-action="applyPostGame">Apply &amp; clear the room</button>
    </div>
  </section>`;
}

function renderStationMap() {
  const run = state.run;
  const rows = store.visitedChallenges(run).map((number) => {
    const challenge = CHALLENGES[number];
    const isCurrent = number === run.currentChallenge;
    const status = run.sealed.includes(number) ? 'sealed' : run.cleared.includes(number) ? 'cleared' : 'in progress';
    // doors are only known once the room has been searched
    const knownExits = run.cleared.includes(number)
      ? (challenge.exits ? challenge.exits.map((exit) => exit.to).join(', ') : challenge.exitRoll ? 'd12' : '—')
      : '?';
    return `<li class="${isCurrent ? 'current' : ''} ${status === 'sealed' ? 'sealed' : ''}">
      <span class="map-number">${number}</span>
      <span class="grow">${escapeHtml(challenge.name)}<small> → ${knownExits}</small></span>
      <span class="chip">${isCurrent ? 'here' : status}</span></li>`;
  }).join('');
  return `<section class="card"><h3>Station map</h3><ul class="map">${rows}</ul></section>`;
}

// ---------- crew ----------

function renderCrew() {
  if (!state.run) return renderNewCrewForm();
  const { crew } = state.run;
  const progress = store.agendaProgress(state);
  return `<section class="card">
      <input class="title-input" data-bind="run.crew.name" value="${escapeHtml(crew.name)}" aria-label="Crew name">
      <p class="hint">${crew.size}-person crew · ${escapeHtml(crew.shipType)} ship · ${escapeHtml(crew.edge)}
      ${progress ? ` · ${AGENDAS[progress.agendaKey].name} agenda ${progress.found}/${progress.partsNeeded}` : ''}</p>
      <p class="hint">Starting gear (p. 36): one weapon each, plus ${STARTING_OTHER_EQUIPMENT + SHIP_TYPES[crew.shipType].extraStartingEquipment} other pieces for the whole crew. Commander's bonus piece: p. 32.</p>
    </section>
    ${crew.members.map(renderMember).join('')}
    <button data-action="addMember">+ Add member</button>`;
}

function stepper(label, path, value, action = 'step') {
  return `<div class="stat"><span class="stat-label">${label}</span>
    <div class="stepper"><button data-action="${action}" data-path="${path}" data-delta="-1" aria-label="${label} minus">−</button>
    <b>${value}</b><button data-action="${action}" data-path="${path}" data-delta="1" aria-label="${label} plus">+</button></div></div>`;
}

function appendPicker(path, placeholder, groupsHtml) {
  return `<select class="picker" data-append-to="${path}" aria-label="${placeholder}"><option value="">${placeholder}</option>${groupsHtml}</select>`;
}

function abilityPickerOptions() {
  return options(Object.entries(ABILITY_PAGES).map(([ability, page]) => `${ability} (p. ${page})`).sort().map((line) => [line, line]));
}

function equipmentPickerOptions(shipType) {
  const startingCategories = SHIP_TYPES[shipType].equipmentCategories;
  return Object.entries(EQUIPMENT_CATEGORIES).map(([key, category]) => (
    `<optgroup label="${escapeHtml(category.name)} (p. ${category.page})${startingCategories.includes(key) ? '' : ' — not in starting lists'}">${
      options(category.items.map((item) => [`${item} (p. ${category.page})`, WEAPONS.includes(item) ? `${item} · weapon` : item]))
    }</optgroup>`)).join('');
}

function renderMember(member, index) {
  const path = `run.crew.members.${index}`;
  const advancement = store.pendingAdvancement(member);
  const advancementHtml = advancement ? `<div class="advancement"><b>Advancement at ${advancement.xp} XP</b>
    <div class="row wrap">${advancement.statOptions
      ? advancement.statOptions.map((stat) => `<button data-action="takeAdvancement" data-index="${index}" data-stat="${stat}">+1 ${STAT_LABELS[stat]}</button>`).join('')
      : `<button data-action="takeAdvancement" data-index="${index}">Gain ${escapeHtml(advancement.ability)}</button>`}</div></div>` : '';
  return `<section class="card member ${member.status}">
    <div class="row">
      <input class="grow name-input" data-bind="${path}.name" value="${escapeHtml(member.name)}" aria-label="Name">
      <select data-bind="${path}.status" data-rerender>${options([['active', 'active'], ['recovering', 'recovering'], ['dead', 'dead']], member.status)}</select>
    </div>
    <div class="row">
      <input class="grow" data-bind="${path}.type" value="${escapeHtml(member.type)}" aria-label="Type">
      <span class="chip ${member.stats.lf - member.damage <= 0 ? 'warn' : 'ok'}">Life ${member.stats.lf - member.damage}/${member.stats.lf}</span>
    </div>
    ${advancementHtml}
    <div class="stats">${STAT_KEYS.map((stat) => stepper(STAT_LABELS[stat], `${path}.stats.${stat}`, member.stats[stat])).join('')}</div>
    <div class="stats two">${stepper('Damage', `${path}.damage`, member.damage)}${stepper('XP', `${path}.xp`, member.xp)}</div>
    <textarea rows="2" placeholder="Special abilities" data-bind="${path}.abilities">${escapeHtml(member.abilities)}</textarea>
    ${appendPicker(`${path}.abilities`, '+ Add ability…', abilityPickerOptions())}
    <textarea rows="2" placeholder="Equipment" data-bind="${path}.equipment">${escapeHtml(member.equipment)}</textarea>
    ${appendPicker(`${path}.equipment`, '+ Add equipment…', equipmentPickerOptions(state.run.crew.shipType))}
    ${member.isCommander ? '' : confirmButton('removeMember', 'Remove', `data-index="${index}"`)}
  </section>`;
}

// a crew type picked for one ship may not exist on another; fall back to the ship's first type
function newCrewMemberTypes(draft) {
  const availableTypes = SHIP_TYPES[draft.shipType].crewTypes;
  return draft.memberTypes.slice(0, draft.size).map((type) => (availableTypes.includes(type) ? type : availableTypes[0]));
}

function renderNewCrewForm() {
  const draft = ui.newCrew;
  const ship = SHIP_TYPES[draft.shipType];
  const crewTypeOptions = ship.crewTypes.map((type) => [type, CREW_TYPES[type].isAdvanced ? `${type} (advanced)` : type]);
  const memberSelects = newCrewMemberTypes(draft).map((type, index) => (
    `<label>Crew ${index + 1}<div class="row">
      <input class="grow" placeholder="Name" aria-label="Crew ${index + 1} name" data-bind-ui="newCrew.memberNames.${index}" value="${escapeHtml(draft.memberNames[index])}">
      <select aria-label="Crew ${index + 1} type" data-bind-ui="newCrew.memberTypes.${index}">${options(crewTypeOptions, type)}</select>
    </div></label>`
  )).join('');
  const pointsLeft = COMMANDER_FREE_STAT_POINTS - store.commanderPointsSpent(draft.commanderPoints);
  const commanderStat = (stat) => BASE_STATS_BY_CREW_SIZE[draft.size][stat] + (ship.commanderBonus[stat] ?? 0) + draft.commanderPoints[stat];
  return `<section class="card form">
    <h2>New crew</h2>
    <p class="hint">Follow p. 24–39 of the rulebook. The app fills in stats and abilities; pick equipment on the roster afterwards.</p>
    <label>Crew name<input data-bind-ui="newCrew.name" value="${escapeHtml(draft.name)}"></label>
    <label>Crew size<select data-bind-ui="newCrew.size" data-rerender data-number>${options(Object.keys(BASE_STATS_BY_CREW_SIZE).map((size) => [size, `${size} + commander`]), draft.size)}</select></label>
    <label>Ship type<select data-bind-ui="newCrew.shipType" data-rerender>${options(Object.keys(SHIP_TYPES).map((type) => [type, type]), draft.shipType)}</select></label>
    <label>Edge (p. 34–36)<select data-bind-ui="newCrew.edge">${options(EDGES.map((edge) => [edge, edge]), draft.edge)}</select></label>
    <label>Secondary agenda (optional, d12 on p. 39)<select data-bind-ui="newCrew.agenda">${options([['', 'None'], ...Object.entries(AGENDAS).map(([key, agenda]) => [key, agenda.name])], draft.agenda)}</select></label>
    <h3>Commander</h3>
    <label>Commander name<input data-bind-ui="newCrew.commanderName" value="${escapeHtml(draft.commanderName)}"></label>
    <p class="hint">${escapeHtml(ship.commanderAbility)} (p. ${ABILITY_PAGES[ship.commanderAbility]}) · free stat points left: <b>${pointsLeft}</b> of ${COMMANDER_FREE_STAT_POINTS}</p>
    <div class="stats">${STAT_KEYS.map((stat) => stepper(STAT_LABELS[stat], stat, commanderStat(stat), 'spendCommanderPoint')).join('')}</div>
    <h3>Crew</h3>
    <p class="hint">Who you may recruit, and how many of each: p. ${ship.page}. At most one advanced crew member.</p>
    ${memberSelects}
    <button class="primary" data-action="createCrew">Enter the station</button>
  </section>`;
}

// ---------- log ----------

function renderLog() {
  const run = state.run;
  const pastCrews = state.station.pastCrews;
  const graveyard = `${run ? run.crew.members.filter((member) => member.status === 'dead').map((member) => `<li>${escapeHtml(member.name)} <small>${escapeHtml(member.type)}</small></li>`).join('') : ''}`;
  const pastCrewsHtml = pastCrews.length ? `<section class="card"><h3>Previous crews</h3><ul class="plain">${pastCrews.map((crew) => (
    `<li><b>${escapeHtml(crew.name)}</b> — ${escapeHtml(crew.outcome)}, ${crew.challengesCleared} cleared, ended in Challenge ${crew.endedInChallenge}${crew.fallen.length ? `<br><small>Fallen: ${escapeHtml(crew.fallen.join(', '))}</small>` : ''}</li>`)).join('')}</ul></section>` : '';
  if (!run) return `<section class="card"><h2>Captain's log</h2><p>No crew aboard.</p></section>${pastCrewsHtml}`;

  const entries = run.log.map((entry, index) => ({ entry, index })).reverse().map(({ entry, index }) => (
    `<li><small>Challenge ${entry.challenge} · ${new Date(entry.at).toLocaleString()}</small>
      ${entry.isNote ? `<textarea rows="2" data-bind="run.log.${index}.text">${escapeHtml(entry.text)}</textarea>` : `<p>${escapeHtml(entry.text)}</p>`}</li>`
  )).join('');
  return `<section class="card"><h2>Captain's log</h2>
      <textarea rows="3" placeholder="Add a note for Challenge ${run.currentChallenge}…" data-bind-ui="logNote">${escapeHtml(ui.logNote)}</textarea>
      <div class="row"><button class="primary" data-action="addNote">Add note</button><button data-action="exportMarkdown">Export as Markdown</button></div>
    </section>
    <section class="card"><ul class="log">${entries}</ul></section>
    ${graveyard ? `<section class="card"><h3>Fallen</h3><ul class="plain">${graveyard}</ul></section>` : ''}
    ${pastCrewsHtml}`;
}

// ---------- dice ----------

function renderDice() {
  const { pool, target, rolled } = ui.dice;
  let resultHtml = '';
  if (rolled) {
    const targetNumber = Number(rolled.target) || 0;
    const isSuccess = (face) => face % 2 === 0 && face >= targetNumber;
    const successes = rolled.faces.filter(isSuccess).length;
    const isCriticalSuccess = rolled.faces.filter((face) => face === 12).length >= 2;
    const isCriticalFailure = !isCriticalSuccess && rolled.faces.filter((face) => face === 1).length >= 2;
    resultHtml = `<div class="dice">${rolled.faces.map((face) => `<span class="die ${isSuccess(face) ? 'hit' : ''}">${face}</span>`).join('')}</div>
      <p class="result">${isCriticalFailure ? 'Critical failure' : `${isCriticalSuccess ? successes * 2 : successes} success(es)${isCriticalSuccess ? ' — critical success, doubled' : ''}`}</p>`;
  }
  return `<section class="card form"><h2>Dice</h2>
    <p class="hint">d12 pool, evens succeed. Two 12s: critical success. Two 1s: critical failure (p. 15–17).</p>
    <div class="stats two">${stepper('Dice', 'dice.pool', pool, 'stepUi')}
      <label class="stat"><span class="stat-label">Target (n+)</span><input type="number" min="0" max="12" inputmode="numeric" data-bind-ui="dice.target" value="${escapeHtml(target)}"></label></div>
    <button class="primary" data-action="rollPool">Roll</button>
    ${resultHtml}</section>`;
}

// ---------- settings ----------

function renderSettings() {
  return `<section class="card form"><h2>Save data</h2>
      <p class="hint">Everything lives in this browser only. Export to back up or move to another device.</p>
      <button data-action="exportSave">Export save (JSON)</button>
      <label class="file">Import save<input type="file" accept="application/json,.json" data-import></label>
    </section>
    <section class="card form"><h2>Crew</h2>
      ${state.run ? `<p class="hint">Retiring archives this crew and lets a new one set out. Agenda progress and station legacy are kept.</p>${confirmButton('retireCrew', 'Retire crew')}` : '<p class="hint">No crew aboard.</p>'}
    </section>
    <section class="card form"><h2>Danger</h2>${confirmButton('wipeEverything', 'Wipe everything')}</section>
    <section class="card"><p class="hint">Unofficial fan-made companion for Space Station Zero by Snarling Badger Studios. Contains no rules text — you need the rulebook to play.</p></section>`;
}

// ---------- shell ----------

function render() {
  if (unreadableSaveMessage) {
    appElement.innerHTML = `<main><section class="card"><h2>Save data could not be read</h2>
      <p class="error">${escapeHtml(unreadableSaveMessage)}</p>
      <p>Nothing has been overwritten. Download the raw data to rescue it, or wipe it to start fresh.</p>
      <div class="row"><button data-action="downloadRawSave">Download raw save</button>${confirmButton('wipeEverything', 'Wipe everything')}</div>
    </section></main>`;
    return;
  }
  const views = { journey: renderJourney, crew: renderCrew, log: renderLog, dice: renderDice, settings: renderSettings };
  appElement.innerHTML = `<header><h1>Captain's Log</h1><span>Space Station Zero</span></header>
    <main>
      ${ui.errorMessage ? `<p class="error" role="alert">${escapeHtml(ui.errorMessage)}</p>` : ''}
      ${ui.noticeMessage ? `<p class="notice">${escapeHtml(ui.noticeMessage)}</p>` : ''}
      ${views[ui.tab]()}
    </main>
    <nav>${TABS.map(([tab, label]) => `<button data-action="showTab" data-tab="${tab}" class="${ui.tab === tab ? 'active' : ''}">${label}</button>`).join('')}</nav>`;
}

const actions = {
  showTab: ({ tab }) => { ui.tab = tab; },
  step: ({ path, delta }) => { setAtPath(state, path, Math.max(0, getAtPath(state, path) + Number(delta))); },
  stepUi: ({ path, delta }) => { setAtPath(ui, path, Math.max(1, getAtPath(ui, path) + Number(delta))); },

  spendCommanderPoint: ({ path: stat, delta }) => {
    const points = ui.newCrew.commanderPoints;
    const newValue = points[stat] + Number(delta);
    if (newValue < 0) return;
    if (store.commanderPointsSpent(points) + Number(delta) > COMMANDER_FREE_STAT_POINTS) throw new Error(`All ${COMMANDER_FREE_STAT_POINTS} free points are spent.`);
    points[stat] = newValue;
  },
  createCrew: () => {
    store.startNewCrew(state, { ...ui.newCrew, memberTypes: newCrewMemberTypes(ui.newCrew) });
    ui.newCrew.commanderPoints = store.zeroStats();
    ui.newCrew.memberNames = Array(8).fill('');
    ui.tab = 'crew';
  },
  addMember: () => {
    state.run.crew.members.push(store.createMember({
      name: 'New member', type: 'Soldier', isCommander: false, stats: store.zeroStats() }));
  },
  removeMember: ({ index }) => { state.run.crew.members.splice(Number(index), 1); },
  takeAdvancement: ({ index, stat }) => { store.takeAdvancement(state.run.crew.members[Number(index)], stat); },

  openPostGame: () => { ui.postGame = { downed: {}, bonusXp: {}, agendaPartFound: false, legacyEarned: false, note: '' }; },
  cancelPostGame: () => { ui.postGame = null; },
  toggleDowned: ({ id }) => {
    if (ui.postGame.downed[id]) delete ui.postGame.downed[id];
    else ui.postGame.downed[id] = { roll: '', stat: 'lf' };
  },
  rollInjury: ({ id }) => { ui.postGame.downed[id].roll = rollD12() + rollD12(); },
  applyPostGame: () => { store.completeCurrentChallenge(state, ui.postGame); ui.postGame = null; ui.exitRoll = ''; },

  rollExit: () => { ui.exitRoll = rollD12(); },
  takeRolledExit: () => {
    const destination = exitForRoll(CHALLENGES[state.run.currentChallenge], Number(ui.exitRoll));
    if (!destination) throw new Error('Enter a d12 result between 1 and 12.');
    store.moveToChallenge(state.run, destination, `Rolled ${ui.exitRoll}`);
    ui.exitRoll = '';
  },
  takeExit: ({ to, label }) => { store.moveToChallenge(state.run, Number(to), label); ui.exitRoll = ''; },

  addNote: () => {
    if (!ui.logNote.trim()) throw new Error('Write the note first.');
    store.addLogEntry(state.run, ui.logNote.trim(), true);
    ui.logNote = '';
  },
  exportMarkdown: () => { downloadTextFile('captains-log.md', store.logAsMarkdown(state.run), 'text/markdown'); },
  rollPool: () => { ui.dice.rolled = { faces: Array.from({ length: ui.dice.pool }, rollD12), target: ui.dice.target }; },

  exportSave: () => { downloadTextFile('ssz-captains-log.json', JSON.stringify(state, null, 2), 'application/json'); },
  downloadRawSave: () => { downloadTextFile('ssz-raw-save.txt', localStorage.getItem(store.STORAGE_KEY), 'text/plain'); },
  retireCrew: () => { store.retireCrew(state); ui.postGame = null; ui.tab = 'crew'; },
  wipeEverything: () => { state = store.createEmptyState(); unreadableSaveMessage = null; ui.postGame = null; ui.tab = 'journey'; },
};

function handleClick(event) {
  const element = event.target.closest('[data-action]');
  if (!element) return;
  const confirmKey = element.dataset.confirm;
  ui.errorMessage = null;
  ui.noticeMessage = null;
  if (confirmKey && ui.confirmKey !== confirmKey) {
    ui.confirmKey = confirmKey;
    render();
    return;
  }
  ui.confirmKey = null;
  try {
    actions[element.dataset.action](element.dataset);
    if (!unreadableSaveMessage) store.saveState(state);
  } catch (error) {
    ui.errorMessage = error.message;
  }
  render();
}

function applyInput(element) {
  const statePath = element.dataset.bind;
  const uiPath = element.dataset.bindUi;
  if (element.dataset.appendTo && element.value) {
    const path = element.dataset.appendTo;
    setAtPath(state, path, [getAtPath(state, path), element.value].filter(Boolean).join('\n'));
    store.saveState(state);
    render();
    return;
  }
  if (!statePath && !uiPath) return;
  let value = element.type === 'checkbox' ? element.checked : element.value;
  if ((element.type === 'number' || 'number' in element.dataset) && value !== '') value = Number(value);
  if (statePath) {
    setAtPath(state, statePath, value);
    store.saveState(state);
  } else {
    setAtPath(ui, uiPath, value);
  }
  if (element.dataset.outcomeElement) {
    document.getElementById(element.dataset.outcomeElement).textContent = injuryOutcomeForRoll(value)?.label ?? '';
  }
  if ('exitRollPreview' in element.dataset) {
    document.getElementById('exit-roll-preview').textContent = exitRollPreviewText(CHALLENGES[state.run.currentChallenge], value);
  }
  if ('rerender' in element.dataset) render();
}

function handleInput(event) {
  try {
    applyInput(event.target);
  } catch (error) {
    // e.g. browser storage full or blocked: the edit is not saved, so say so
    ui.errorMessage = `Could not save that change: ${error.message}`;
    render();
  }
}

async function handleImport(event) {
  if (!('import' in event.target.dataset)) return;
  const file = event.target.files[0];
  if (!file) return;
  try {
    const importedState = store.parseSavedState(await file.text());
    store.saveState(importedState);
    state = importedState;
    ui.postGame = null;
    ui.noticeMessage = 'Save imported.';
    ui.errorMessage = null;
  } catch (error) {
    ui.errorMessage = `Import failed, nothing was changed: ${error.message}`;
  }
  render();
}

try {
  state = store.loadState();
} catch (error) {
  unreadableSaveMessage = error.message;
}
appElement.addEventListener('click', handleClick);
appElement.addEventListener('input', handleInput);
appElement.addEventListener('change', handleImport);
render();
