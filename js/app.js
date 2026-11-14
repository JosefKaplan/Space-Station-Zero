// Rendering and event handling. Every button re-renders the whole app; typing never does
// (a re-render while typing would drop focus and swallow the next tap).
import {
  ABILITY_PAGES, AGENDAS, AGENDA_ROLL_TARGET, BASE_STATS_BY_CREW_SIZE, CHALLENGES, COMMANDER_BONUS_XP_PER_CHALLENGE,
  COMMANDER_FREE_STAT_POINTS, COOP_REMINDERS, CREW_TYPES, SKIRMISH_CHALLENGES, SKIRMISH_COMMANDER_XP_TOLERANCE, SKIRMISH_REMINDERS, SKIRMISH_TURNS, DICE_HELP, EDGES, EQUIPMENT_CATEGORIES, INJURY_ROLL_MAX, INJURY_ROLL_MIN,
  LEGACY_PAGE_REFERENCE, SHIP_TYPES, STARTING_OTHER_EQUIPMENT, STAT_KEYS, STAT_LABELS, WEAPONS, startingGearRules,
  XP_PER_SURVIVED_CHALLENGE, exitForRoll, injuryOutcomeForRoll, injuryRollRangeLabel,
} from './data.js';
import { fallenByChallenge, knownChallenges, renderStationMapSvg } from './map.js';
import * as cloud from './cloud-sync.js';
import { checkedCrewRules, fetchLocalCrewRules, forgetCrewRules, loadCrewRules, ruleNotesMentionedIn, saveCrewRules } from './crew-rules.js';
import * as skirmish from './skirmish.js';
import * as store from './state.js';
import {
  checkedPrivateRoomLayouts, fetchPrivateRoomLayouts, fetchPublicFootprints, loadRoomLayouts, mergeRoomLayouts, obstaclesForRandomTerrain,
  roomLayoutFor, saveRoomLayouts,
} from './room-layouts.js';
import { generateTerrain, renderBoardSvg, renderMeasurementLinesSvg, roomLayoutLines, terrainPlacementsByQuadrant } from './terrain.js';

const TABS = [['journey', 'Journey'], ['crew', 'Crew'], ['log', 'Log'], ['dice', 'Dice'], ['versus', 'Versus'], ['settings', 'Settings']];
const SYNC_PULL_INTERVAL_MS = 60 * 1000;
const MAX_VERSUS_HISTORY = 20;
const appElement = document.getElementById('app');

let state = null;
let roomLayouts = null;
let publicFootprints = null;
let privateRoomLayouts = null;   // the briefings and book text: from the local file, or from the owner's private database
let hasLocalPrivateFiles = false;   // the project folder serves the private files: they win over the database
let crewRules = null;   // what abilities, equipment and edges do: the book's wording, only from the private local file
let unreadableSaveMessage = null;
const ui = {
  tab: 'journey',
  // which kind of thing is lit up on the room's map (see renderBoardLegend); never saved
  boardFocus: null,
  // what the info line under the map shows after a tap (hover only previews it); never saved
  boardInfo: null,
  // set by a terrain roll, used up by the next render: only freshly rolled pieces drop in
  isTerrainJustRolled: false,
  // whether the lore at the top of the room card is open; starts open in every room, remembered while you stay
  isLoreOpen: true,
  // the playthrough picker in the header: open or not, and the two name fields in it
  isPlaythroughMenuOpen: false,
  // the Crew tab shows the form for another crew joining the party
  isAddingCrew: false,
  // sign-in to the save sync (Settings): which step, what was typed (never saved), the QR of a first-time enrolment
  syncStep: 'signin',
  syncEmail: '',
  syncPassword: '',
  syncCode: '',
  syncEnrollment: null,
  isSyncBusy: false,
  newPlaythroughName: '',
  renamePlaythroughName: '',
  postGame: null,
  exitRoll: '',
  mapSelected: null,
  confirmKey: null,
  errorMessage: null,
  noticeMessage: null,
  logNote: '',
  dice: { pool: 5, needed: '', target: '', rolled: null, isHelpOpen: false },
  // Settings → Starting crews: the section shown, and the saved starting crew being edited ('new' for a new one) with its form
  // the versus start form: which skirmish challenge, how many players, their names (never saved)
  versusDraft: blankVersusDraft(),
  settingsSection: 'general',
  editingTemplateId: null,
  templateDraft: null,
  newCrew: { size: 6, shipType: 'Exploration', edge: EDGES[0], memberTypes: Array(8).fill('Soldier'), ...blankCrewFormFields() },
};

function blankVersusDraft() {
  return { challengeKey: '', playerCount: 2, names: ['', '', '', ''] };
}

// what the creator form starts from for each new crew (size, ship, edge and the crew types are kept between crews)
function blankCrewFormFields() {
  return {
    name: '', commanderName: '', agenda: '', commanderPoints: store.zeroStats(), memberNames: Array(8).fill(''),
    weapons: Array(9).fill(''), bonusItem: '', otherItems: Array(8).fill(''), otherCarriers: Array(8).fill(0),
  };
}

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
      <button class="primary" data-action="showTab" data-tab="crew">Create a crew</button></section>${renderStationMap()}`;
  }
  if (run.ended) {
    return `<section class="card"><h2>${run.ended === 'victory' ? 'Journey complete' : run.crews.length > 1 ? 'Party lost' : 'Crew lost'}</h2>
      <p>${escapeHtml(partyName(run))} — ${run.cleared.length} challenge(s) cleared, ended in Challenge ${challengeTitle(run.currentChallenge)}.</p>
      ${renderReminders(CHALLENGES[run.currentChallenge].reminders ?? [])}
      <p>Read back the Log, then retire the party to send a new one in. The station remembers some things.</p>
      ${confirmButton('retireParty', 'Retire the party')}</section>${renderStationMap()}`;
  }

  const number = run.currentChallenge;
  const challenge = CHALLENGES[number];
  const isCleared = store.isCurrentChallengeCleared(run);
  const benched = store.allMembers(run).filter((member) => member.status === 'recovering');
  // page pointers stay up after the room is cleared (some apply only then); the rest matter only during play
  const reminders = [...(challenge.reminders ?? [])];
  if (!isCleared && challenge.turnLimit) reminders.unshift(`Time limit: end of turn ${challenge.turnLimit}.`);
  for (const crew of run.crews) {
    if (isCleared || !store.canAdvanceAgendaInCurrentChallenge(state, crew)) continue;
    const { agendaKey } = store.agendaProgress(state, crew);
    reminders.push(`${run.crews.length > 1 ? `${crew.name}: ` : ''}${AGENDAS[agendaKey].name} agenda can advance here — see "Secondary Agenda" in this challenge.`);
  }
  if (!isCleared && state.station.legacyCount > 0) {
    reminders.push(`Station legacy ×${state.station.legacyCount}: ${LEGACY_PAGE_REFERENCE} applies to crews that set out after it was earned.`);
  }
  if (!isCleared && benched.length) {
    reminders.push(`Sitting this one out: ${benched.map((member) => member.name).join(', ')}.`);
  }

  if (!isCleared && !run.roomSetup.isMissionStarted) {
    return `${renderRoomSetup(number, challenge, reminders)}${renderStationMap()}`;
  }

  return `<section class="card room">
      <p class="eyebrow">Challenge ${number} <span class="chip ${isCleared ? 'ok' : 'warn'}">${isCleared ? 'cleared' : 'in progress'}</span></p>
      <h2>${escapeHtml(challenge.name)}</h2>
      <p class="page-ref">Rulebook p. ${challenge.page}</p>
      ${isCleared ? '' : renderRoomTable(number, { isSettingUp: false })}
      ${renderReminders(reminders)}
      ${isCleared ? renderExits(challenge) : (ui.postGame ? '' : `<div class="action-bar"><button class="primary" data-action="openPostGame">Challenge over →</button>
        <button data-action="reopenRoomSetup">← Set-up</button></div>`)}
    </section>
    ${!isCleared && ui.postGame ? renderPostGame(challenge) : ''}
    ${renderStationMap()}`;
}

// "Crew A & Crew B": what the party is called
const partyName = (run) => run.crews.map((crew) => crew.name).join(' & ');

function activeCrewModelCount() {
  return store.allMembers(state.run).filter((member) => member.status === 'active').length;
}

// the book's "per crew" counts crews that take part: those with someone able to play this room
function participatingCrewCount() {
  return state.run.crews.filter((crew) => crew.members.some((member) => member.status === 'active')).length;
}

// "per crew" times the crews taking part; areas share it evenly, the first ones taking the odd models
function enemyShares(enemy) {
  const total = enemy.perCrew * participatingCrewCount();
  return (enemy.areas ?? []).map((area, index) => ({
    area, count: Math.floor(total / enemy.areas.length) + (index < total % enemy.areas.length ? 1 : 0) }));
}

function enemyCaptionsByArea(roomLayout) {
  const captions = {};
  for (const enemy of roomLayout.enemies ?? []) {
    for (const { area, count } of enemy.areas ? enemyShares(enemy) : []) {
      if (count > 0) (captions[area] ??= []).push(`${count}× ${enemy.name}${enemy.hidden ? ' (hidden)' : ''}${enemy.when ? ' *' : ''}`);
    }
  }
  return captions;
}

function renderEnemyLine(enemy) {
  const where = enemy.areas ? enemyShares(enemy).map(({ area, count }) => `${area}: ${count}`).join(' · ') : enemy.where;
  const total = enemy.perCrew ? `${enemy.perCrew * participatingCrewCount()}× ` : '';
  return `<li><b>${total}${escapeHtml(enemy.name)}</b> — ${escapeHtml(where)}${enemy.hidden ? ' <span class="chip warn">hidden</span>' : ''}
    ${enemy.when ? `<br><i>${escapeHtml(enemy.when)}</i>` : ''}${enemy.hidden && enemy.areas ? '<br><i>placed once revealed</i>' : ''}</li>`;
}

// without the private briefing (the public footprints only) an empty enemy list means "not known here", not "none"
function enemyLineWithoutBriefing(roomLayout) {
  if (roomLayout.lore !== undefined) return 'None.';
  const areas = (roomLayout.enemyAreas ?? []).map((area) => area.label);
  return areas.length ? `Set up in ${areas.join(', ')} (marked on the map). Which enemies and how many: see the book.` : 'Which enemies, if any: see the book.';
}

// the room in a few lines: who sets up where, what to beat, what can kill the crew
function renderRoomSummary(roomLayout) {
  const crewLine = roomLayoutLines(roomLayout).find((line) => line.group.startsWith('Your crew'));
  const crewHtml = crewLine
    ? `<b>${activeCrewModelCount()} models</b>${participatingCrewCount() > 1 ? ` (${participatingCrewCount()} crews)` : ''} set up anywhere inside the start zone, ${escapeHtml(crewLine.text.replace('Zone · ', ''))} (${crewLine.where}).`
    : escapeHtml(roomLayout.crewNote ?? 'No starting zone is drawn on this map.');
  const hasEnemies = (roomLayout.enemies ?? []).length > 0;
  const hasSetUpInfo = Boolean(crewLine || roomLayout.crewNote || hasEnemies || roomLayout.enemyNote);
  return `<div class="glance">
    ${roomLayout.note ? `<p class="hint">${escapeHtml(roomLayout.note)}</p>` : ''}
    ${hasSetUpInfo ? `<div class="glance-row crew"><span class="swatch crew"></span><div><h4>Your crew</h4><p>${crewHtml}</p>
      ${crewLine && roomLayout.crewNote ? `<p>${escapeHtml(roomLayout.crewNote)}</p>` : ''}</div></div>
    <div class="glance-row enemy"><span class="swatch enemy"></span><div><h4>Enemies</h4>
      ${roomLayout.enemyNote ? `<p>${escapeHtml(roomLayout.enemyNote)}</p>` : ''}
      ${hasEnemies ? `<ul class="plain">${roomLayout.enemies.map(renderEnemyLine).join('')}</ul>` : (roomLayout.enemyNote ? '' : `<p>${enemyLineWithoutBriefing(roomLayout)}</p>`)}</div></div>` : ''}
    ${roomLayout.deadline ? `<p class="deadline">⏱ ${escapeHtml(roomLayout.deadline)}</p>` : ''}
    ${roomLayout.goal ? `<p class="goal"><b>Goal:</b> ${escapeHtml(roomLayout.goal)}</p>` : ''}
    ${(roomLayout.hazards ?? []).length ? `<h4 class="plain-heading">Hazards and objectives</h4><ul class="plain">${roomLayout.hazards.map((hazard) => `<li>${escapeHtml(hazard)}</li>`).join('')}</ul>` : ''}
  </div>`;
}

// the book's text is shown as stored: **bold** runs are the book's run-in headings, nothing else is markup
function renderBookText(text) {
  return escapeHtml(text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

// one enemy stat bar per row, as printed (Lf Mv Co Re In, and armor when the room gives it)
// some enemies have a solo and a co-op stat bar: with two or more crews taking part the co-op one is yours
function isStatBarForOtherPartySize(name) {
  const isCoop = participatingCrewCount() >= 2;
  return (name.includes('(solo play)') && isCoop) || (name.includes('(co-op play)') && !isCoop);
}

function renderEnemyStats(stats) {
  if (!stats?.length) return '';
  return `<h4 class="plain-heading">Enemy stats</h4><div class="stats-wrap"><table class="enemy-stats">
    <thead><tr><th></th><th>Lf</th><th>Mv</th><th>Co</th><th>Re</th><th>In</th><th>Armor</th></tr></thead>
    <tbody>${stats.map((stat) => `<tr class="${isStatBarForOtherPartySize(stat.name) ? 'not-yours' : ''}"><th scope="row">${escapeHtml(stat.name)}</th><td>${stat.lf}</td><td>${stat.mv}</td><td>${stat.co}</td><td>${stat.re}</td><td>${stat.in}</td>
      <td>${stat.armor ? escapeHtml(stat.armor) : '–'}</td></tr>`).join('')}</tbody></table></div>`;
}

function renderRulesSection(section) {
  const blocksHtml = [];
  for (const block of section.blocks) {
    if (block.t === 'table') {
      blocksHtml.push(`<div class="stats-wrap"><table class="rules-table"><tbody>${block.rows.map((row, rowIndex) => (
        `<tr>${row.map((cell) => (rowIndex === 0 ? `<th>${escapeHtml(cell)}</th>` : `<td>${escapeHtml(cell)}</td>`)).join('')}</tr>`)).join('')}</tbody></table></div>`);
    } else if (block.t === 'li') {
      const previousHtml = blocksHtml[blocksHtml.length - 1];
      const item = `<li>${renderBookText(block.x)}</li>`;
      if (previousHtml?.startsWith('<ul class="plain rules-list">')) blocksHtml[blocksHtml.length - 1] = `${previousHtml.slice(0, -'</ul>'.length)}${item}</ul>`;
      else blocksHtml.push(`<ul class="plain rules-list">${item}</ul>`);
    } else {
      blocksHtml.push(`<p>${renderBookText(block.x)}</p>`);
    }
  }
  return `<h5>${renderBookText(section.title)}</h5>${blocksHtml.join('')}`;
}

// the room's lore and rules in the book's words, folded away: open them when needed
function renderRoomRules(roomLayout) {
  return roomLayout.rules?.length ? `<details><summary>Rules for this room</summary><div class="rules">${roomLayout.rules.map(renderRulesSection).join('')}</div></details>` : '';
}

// the read-aloud text is the first thing in a room's card, open when the room is entered; folding it sticks for that room
function renderLore(roomLayout) {
  return roomLayout?.lore
    ? `<details class="lore-box" data-lore ${ui.isLoreOpen ? 'open' : ''}><summary>Lore</summary><p class="lore">${renderBookText(roomLayout.lore)}</p></details>` : '';
}

// With several crews: the app's own reminders, plus the sentences of this room's rules (the book's text, when it is loaded)
// that speak of crews, so nothing that depends on the number of crews is missed in a long rules section
const CREW_COUNT_PATTERN = /number of crews|per crew|each crew|every crew|crews? participating|beyond the first|co-?op/i;
function renderCoopNotes(roomLayout) {
  const crewCount = participatingCrewCount();
  if (crewCount < 2) return '';
  const bookLines = (roomLayout?.rules ?? []).flatMap((section) => section.blocks
    .filter((block) => block.t !== 'table' && CREW_COUNT_PATTERN.test(block.x))
    .map((block) => `<li><b>${escapeHtml(section.title)}:</b> ${renderBookText(block.x)}</li>`));
  return `<details class="coop-notes"><summary>Co-op: ${crewCount} crews</summary>
    <ul class="plain">${COOP_REMINDERS.map((reminder) => `<li>${escapeHtml(reminder)}</li>`).join('')}</ul>
    ${bookLines.length ? `<h4 class="plain-heading">In this room's rules, about crews</h4><ul class="plain">${bookLines.join('')}</ul>` : ''}</details>`;
}

function renderRoomInfo(roomLayout) {
  if (!roomLayout) return `${renderCoopNotes(null)}<p class="hint">No room layout loaded for this challenge: the footprints come from <code>data/room-footprints.json</code>.</p>`;
  return `${renderRoomSummary(roomLayout)}${renderCoopNotes(roomLayout)}${renderEnemyStats(roomLayout.stats)}${renderRoomRules(roomLayout)}`;
}

const BOARD_INFO_HINT = 'Hover or tap an area, object or piece on the map for its details.';

// the table: one board with the room's own layout (grey/black/teal/pink, as in the book) and the app's random terrain (amber)
function renderRoomTable(number, { isSettingUp }) {
  const roomLayout = roomLayoutFor(roomLayouts, number);
  const terrain = state.run.roomSetup.terrain;
  const spoilersHtml = renderRoomInfo(roomLayout);
  const isFirstDrawOfNewTerrain = ui.isTerrainJustRolled;
  ui.isTerrainJustRolled = false;
  const boardHtml = roomLayout || terrain
    ? `${renderBoardSvg(terrain, roomLayout, { enemyCaptions: roomLayout ? enemyCaptionsByArea(roomLayout) : {}, crewCaption: `${activeCrewModelCount()} models`, focus: ui.boardFocus, dropIn: isFirstDrawOfNewTerrain })}
       <p class="board-info" id="board-info">${escapeHtml(ui.boardInfo ?? BOARD_INFO_HINT)}</p>
       ${renderBoardLegend(Boolean(terrain), Boolean(roomLayout))}` : '';
  const rollHtml = isSettingUp
    ? (terrain ? confirmButton('rollTerrain', 'Roll random terrain again') : '<button data-action="rollTerrain">Roll random terrain</button>') : '';
  const unplacedHtml = terrain?.unplacedPieces?.length
    ? `<p class="hint terrain-unplaced">${terrain.unplacedPieces.length} random piece(s) marked "no room" do not fit 2" away from the room's terrain and objectives: put them where they fit.</p>` : '';
  const tableHtml = `<h4 class="plain-heading">${isSettingUp ? 'Set up the table' : 'The table'}</h4>
    ${boardHtml}${rollHtml}${unplacedHtml}
    ${roomLayout ? `<details><summary>Measurements for the room</summary>${renderRoomLayoutLines(roomLayout)}</details>` : ''}
    ${terrain ? `<details><summary>Random terrain pieces</summary>${renderRandomTerrainList(terrain)}</details>` : ''}`;
  // setting up: what is in the room first, then the table; playing: the table first, the summary as a reference below
  const loreHtml = renderLore(roomLayout);
  return isSettingUp ? `${loreHtml}${spoilersHtml}${tableHtml}` : `${loreHtml}${tableHtml}<h4 class="plain-heading">What is in this room</h4>${spoilersHtml}`;
}

// the step between walking in and playing: the order follows the book's own set-up (p. 43–44)
// who is in the party, and the way to bring a friend's crew in before the room starts (co-op)
function renderPartyLine() {
  const run = state.run;
  const canAddCrew = !run.ended && run.crews.length < store.MAX_CREWS;
  return `<p class="hint">Party: ${escapeHtml(partyName(run))} (${run.crews.length} crew${run.crews.length > 1 ? 's' : ''}).${run.crews.length > 1 ? ' Enemy numbers and the co-op rules follow the crews.' : ' Playing co-op? Add the other player\'s crew first: enemy numbers and the co-op rules follow the crews.'}</p>
    ${canAddCrew ? `<button data-action="addCrewToParty">+ Add another crew (${run.crews.length}/${store.MAX_CREWS})</button>` : ''}`;
}

function renderRoomSetup(number, challenge, reminders) {
  return `<section class="card room">
      <p class="eyebrow">Challenge ${number} <span class="chip warn">setting up</span></p>
      <h2>${escapeHtml(challenge.name)}</h2>
      <p class="page-ref">Read the room's opening on p. ${challenge.page}, then set up the table.</p>
      ${renderRoomTable(number, { isSettingUp: true })}
      ${renderReminders(reminders)}
      ${renderPartyLine()}
      <div class="action-bar"><button class="primary" data-action="beginChallenge">Begin challenge →</button></div>
    </section>`;
}

function renderRoomLayoutLines(roomLayout) {
  const lines = roomLayoutLines(roomLayout);
  const groupNames = [...new Set(lines.map((line) => line.group))];
  return `${groupNames.map((group) => `<h4>${escapeHtml(group)}</h4><ul class="plain terrain-list">${lines.filter((line) => line.group === group).map(({ tag, text, where }) => (
    `<li><b>${escapeHtml(tag)}</b> ${escapeHtml(text)} <span class="terrain-where">${where}</span></li>`)).join('')}</ul>`).join('')}
    <p class="hint">Distances are from the board edges, as the sketch is drawn (top-left corner = 0", 0"). Rough to about ¼".</p>`;
}

// what each colour on the sketch is. Each entry is a button: tap it to light that kind up on the map, tap again to stop.
function renderBoardLegend(hasRandomTerrain, hasRoomLayout) {
  const entries = [
    ...(hasRandomTerrain ? [['random', 'random terrain']] : []),
    ...(hasRoomLayout ? [['crew', 'your crew'], ['enemy', 'enemies'], ['terrain', "room's terrain"], ['marker', 'objectives']] : []),
  ];
  return entries.length ? `<div class="legend">${entries.map(([kind, label]) => (
    `<button class="legend-item ${ui.boardFocus === kind ? 'active' : ''}" data-action="toggleBoardFocus" data-kind="${kind}" aria-pressed="${ui.boardFocus === kind}">
      <span class="swatch ${kind}"></span>${label}</button>`)).join('')}</div>` : '';
}

function renderRandomTerrainList(terrain) {
  return `<ul class="plain terrain-list">${terrainPlacementsByQuadrant(terrain).map(({ name, roll, pieces, unplacedFootprints }) => (
    `<li><span class="terrain-quadrant">${name} · rolled ${roll}</span>
      <ul class="plain">${pieces.map(({ letter, footprint, where }) => `<li><b>${letter}</b> ${footprint} <span class="terrain-where">${where}</span></li>`).join('')}
        ${unplacedFootprints.map((footprint) => `<li class="terrain-unplaced"><b>?</b> ${footprint} <span class="terrain-where">no room</span></li>`).join('')}</ul></li>`
  )).join('')}</ul>`;
}

function renderReminders(reminders) {
  return reminders.length ? `<ul class="reminders">${reminders.map((text) => `<li>${escapeHtml(text)}</li>`).join('')}</ul>` : '';
}

function exitRollPreviewText(challenge, enteredRoll) {
  const destination = exitForRoll(challenge, Number(enteredRoll));
  return destination ? `${enteredRoll} → Challenge ${challengeTitle(destination)}` : '';
}

// said before a room is entered: the room's card shows everything about it at once
const SPOILER_WARNING_HTML = '<p class="spoiler-warning">⚠ Spoilers: the next room shows everything about it as soon as you enter: enemies, hazards, deadlines, the map.</p>';

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
  return `<h3>Exits</h3>${SPOILER_WARNING_HTML}${exitsHtml}
    ${backtrackTargets.length ? `<h3>Backtrack (no replay, p. 43)</h3><div class="row wrap">${backtrackTargets.map((number) => (
      `<button data-action="takeExit" data-to="${number}" data-label="Backtracked">${challengeTitle(number)}</button>`)).join('')}</div>` : ''}`;
}

function renderPostGame(challenge) {
  const draft = ui.postGame;
  const run = state.run;
  const oneStatUpRange = injuryRollRangeLabel('oneStatUp');
  const memberRow = (member) => {
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
  };
  const crewsHtml = run.crews.map((crew) => {
    const participants = crew.members.filter((member) => member.status === 'active');
    return `${run.crews.length > 1 ? `<h4 class="plain-heading">${escapeHtml(crew.name)}</h4>` : ''}${participants.map(memberRow).join('') || '<p class="hint">Nobody from this crew took part.</p>'}`;
  }).join('');
  const agendaHtml = run.crews.map((crew) => {
    if (!store.canAdvanceAgendaInCurrentChallenge(state, crew)) return '';
    const progress = store.agendaProgress(state, crew);
    const willComplete = progress.found + 1 >= progress.partsNeeded;
    return `<h3>2 · ${run.crews.length > 1 ? `${escapeHtml(crew.name)}: ` : ''}${AGENDAS[progress.agendaKey].name} agenda (${progress.found}/${progress.partsNeeded})</h3>
      <p class="hint">Roll a d12: on ${AGENDA_ROLL_TARGET}+ follow the Secondary Agenda section of this challenge.</p>
      <label><input type="checkbox" data-bind-ui="postGame.agendaPartFoundByCrew.${escapeHtml(crew.id)}"${draft.agendaPartFoundByCrew[crew.id] ? ' checked' : ''}> We secured what we came for</label>
      ${willComplete ? `<p class="hint">If that completes it: ${escapeHtml(AGENDAS[progress.agendaKey].onCompletion)}</p>` : ''}`;
  }).join('');

  return `<section class="card">
    <h2>After the challenge</h2>
    <h3>1 · Injuries &amp; death (p. 40)</h3>
    <p class="hint">Tick everyone who was put Out of Action and needs a roll. Survivors get +${XP_PER_SURVIVED_CHALLENGE} XP (commander +${XP_PER_SURVIVED_CHALLENGE + COMMANDER_BONUS_XP_PER_CHALLENGE}) automatically.</p>
    ${crewsHtml}
    ${agendaHtml}
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
  const { current, ghosts } = knownChallenges(state);
  const run = state.run;
  const selected = [...current, ...ghosts].includes(ui.mapSelected) ? ui.mapSelected : run?.currentChallenge;
  const mapSvg = renderStationMapSvg(state, selected);
  if (!mapSvg) return '';
  return `<section class="card map-card"><h3>Station map</h3>
    ${mapSvg}
    <p class="hint map-legend"><span class="legend-route"></span> your route <span class="legend-ghost"></span> earlier crews <span class="legend-death">✕</span> fallen · tap a room</p>
    ${selected ? renderMapRoomDetail(selected, ghosts.includes(selected)) : ''}
  </section>`;
}

function renderMapRoomDetail(number, isGhost) {
  const run = state.run;
  const challenge = CHALLENGES[number];
  const status = isGhost ? 'earlier crew only'
    : number === run.currentChallenge ? 'here'
      : run.sealed.includes(number) ? 'sealed' : 'cleared';
  // doors are only known once this crew has searched the room
  const doors = !isGhost && run.cleared.includes(number)
    ? (challenge.exits ? challenge.exits.map((exit) => `${escapeHtml(exit.label)} → ${challengeTitle(exit.to)}`) : challenge.exitRoll ? ['Way out decided by a d12'] : [])
    : [];
  const fallenHere = fallenByChallenge(state)[number] ?? [];
  const logEntries = isGhost ? [] : run.log.filter((entry) => entry.challenge === number);
  return `<div class="map-detail">
    <p class="eyebrow">Challenge ${number} <span class="chip">${status}</span></p>
    <p><b>${escapeHtml(challenge.name)}</b> <span class="page-ref">p. ${challenge.page}</span></p>
    ${doors.length ? `<ul class="plain doors">${doors.map((door) => `<li>${door}</li>`).join('')}</ul>` : ''}
    ${fallenHere.length ? `<ul class="plain fallen">${fallenHere.map((entry) => `<li>✕ ${escapeHtml(entry.name)} <small>${escapeHtml(entry.crewName)}</small></li>`).join('')}</ul>` : ''}
    ${logEntries.length ? `<ul class="plain room-log">${logEntries.map((entry) => `<li class="${entry.isNote ? 'note' : ''}">${escapeHtml(entry.text)}</li>`).join('')}</ul>` : ''}
  </div>`;
}

// ---------- crew ----------

// a crew that has not entered its first room yet: the way on is one tap, at the top and the bottom of a long roster
function renderSetOutBar() {
  const run = state.run;
  const hasNotSetOut = run.cleared.length === 0 && run.route.length === 1 && !run.roomSetup.isMissionStarted;
  return hasNotSetOut ? `<div class="setout-bar"><span>Crew registered. Add gear below, then set out.</span>
    ${SPOILER_WARNING_HTML}
    <button class="primary" data-action="showTab" data-tab="journey">Set out to Challenge ${run.currentChallenge} →</button></div>` : '';
}

function renderCrew() {
  if (!state.run) return renderCrewForm({ draftName: 'newCrew', isFirstCrew: true });
  if (ui.isAddingCrew) return renderCrewForm({ draftName: 'newCrew' });
  const run = state.run;
  const addCrewButton = !run.ended && run.crews.length < store.MAX_CREWS
    ? `<button data-action="startAddingCrew">+ Add another crew to the party (${run.crews.length}/${store.MAX_CREWS})</button>` : '';
  // at the top too: a long roster pushes the button far down, and co-op starts here
  return `${renderSetOutBar()}${addCrewButton}${run.crews.map(renderCrewGroup).join('')}
    ${addCrewButton}
    ${renderSetOutBar()}`;
}

// one crew: its header card, its members, its add button. Crews have a coloured rule so they are told apart at a glance.
function renderCrewGroup(crew, crewIndex) {
  const run = state.run;
  const progress = store.agendaProgress(state, crew);
  return `<div class="crew-group crew-${crewIndex % store.MAX_CREWS}">
    <section class="card">
      <input class="title-input" data-bind="run.crews.${crewIndex}.name" value="${escapeHtml(crew.name)}" aria-label="Crew name">
      <p class="hint">${crew.size}-person crew · ${escapeHtml(crew.shipType)} ship · ${escapeHtml(crew.edge)}
      ${progress ? ` · ${AGENDAS[progress.agendaKey].name} agenda ${progress.found}/${progress.partsNeeded}` : ''}</p>
      ${renderEdgeNote(crew.edge)}
      <p class="hint">Starting gear (p. 36): one weapon each, plus ${STARTING_OTHER_EQUIPMENT + SHIP_TYPES[crew.shipType].extraStartingEquipment} other pieces for the whole crew. Commander's bonus piece: p. 32.</p>
      ${run.crews.length > 1 ? confirmButton('removeCrew', 'Remove this crew from the party', `data-crew-id="${escapeHtml(crew.id)}"`) : ''}
    </section>
    ${crew.members.map((member, index) => renderMember(member, index, crewIndex, crew)).join('')}
    <button data-action="addMember" data-crew="${crewIndex}">+ Add member to ${escapeHtml(crew.name)}</button>
  </div>`;
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

// folded notes: what the abilities / equipment named in a free-text field do (nothing when the private rules file is absent)
function renderRuleNotes(kind, freeText) {
  const notes = ruleNotesMentionedIn(crewRules, kind, freeText);
  return notes.length ? `<div class="rule-notes">${notes.map((note) => `<details class="rule-note"><summary>ⓘ ${escapeHtml(note.name)}${note.tags ? ` · ${escapeHtml(note.tags)}` : ''}</summary>
    <p>${escapeHtml(note.text)}</p></details>`).join('')}</div>` : '';
}

function renderEdgeNote(edge) {
  const text = crewRules?.edges[edge];
  return text ? `<details class="rule-note"><summary>ⓘ Edge: ${escapeHtml(edge)}</summary><p>${escapeHtml(text)}</p></details>` : '';
}

function renderMember(member, index, crewIndex, crew) {
  const path = `run.crews.${crewIndex}.members.${index}`;
  const advancement = store.pendingAdvancement(member);
  const advancementHtml = advancement ? `<div class="advancement"><b>Advancement at ${advancement.xp} XP</b>
    <div class="row wrap">${advancement.statOptions
      ? advancement.statOptions.map((stat) => `<button data-action="takeAdvancement" data-crew="${crewIndex}" data-index="${index}" data-stat="${stat}">+1 ${STAT_LABELS[stat]}</button>`).join('')
      : `<button data-action="takeAdvancement" data-crew="${crewIndex}" data-index="${index}">Gain ${escapeHtml(advancement.ability)}</button>`}</div></div>` : '';
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
    ${renderRuleNotes('abilities', member.abilities)}
    <textarea rows="2" placeholder="Equipment" data-bind="${path}.equipment">${escapeHtml(member.equipment)}</textarea>
    ${appendPicker(`${path}.equipment`, '+ Add equipment…', equipmentPickerOptions(crew.shipType))}
    ${renderRuleNotes('equipment', member.equipment)}
    ${member.isCommander ? '' : confirmButton('removeMember', 'Remove', `data-crew="${crewIndex}" data-index="${index}"`)}
  </section>`;
}

// a crew type picked for one ship may not exist on another; fall back to the ship's first type
function newCrewMemberTypes(draft) {
  const availableTypes = SHIP_TYPES[draft.shipType].crewTypes;
  return draft.memberTypes.slice(0, draft.size).map((type) => (availableTypes.includes(type) ? type : availableTypes[0]));
}

function gearPickerOptions(allowedItems, selectedItem) {
  const groups = Object.values(EQUIPMENT_CATEGORIES).map((category) => ({ category, items: category.items.filter((item) => allowedItems.includes(item)) }))
    .filter((group) => group.items.length > 0);
  return `<option value="">— none —</option>${groups.map(({ category, items }) => (
    `<optgroup label="${escapeHtml(category.name)} (p. ${category.page})">${options(items.map((item) => [item, WEAPONS.includes(item) ? `${item} · weapon` : item]), selectedItem)}</optgroup>`)).join('')}`;
}

// the starting gear of the new crew (p. 36): what the ship and edge allow, with empty slots to fill
function renderStartingGearForm(draft, draftName) {
  const rules = startingGearRules(draft.shipType, draft.edge);
  const gear = store.sanitizedStartingGear(draft);
  // plain "Crew N" like the rows above: typing a name does not re-render the form, so a name here would go stale
  const names = ['Commander', ...Array.from({ length: draft.size }, (_, index) => `Crew ${index + 1}`)];
  const baseSlotCount = STARTING_OTHER_EQUIPMENT + SHIP_TYPES[draft.shipType].extraStartingEquipment;
  const weaponRows = names.map((name, index) => `<label>${escapeHtml(name)}'s weapon<select data-bind-ui="${draftName}.weapons.${index}">${gearPickerOptions(rules.weaponItems, gear.weapons[index])}</select></label>`).join('');
  const otherRows = rules.otherSlots.map((slot, index) => `<label>${index < baseSlotCount ? `Piece ${index + 1}` : `${escapeHtml(draft.edge)} piece ${index - baseSlotCount + 1}`}<div class="row">
      <select class="grow" aria-label="Piece ${index + 1}" data-bind-ui="${draftName}.otherItems.${index}">${gearPickerOptions(slot.items, gear.others[index].item)}</select>
      <select aria-label="Piece ${index + 1} carried by" data-bind-ui="${draftName}.otherCarriers.${index}" data-number>${options(names.map((name, who) => [who, name]), gear.others[index].carrier)}</select>
    </div></label>`).join('');
  return `<h3>Starting gear</h3>
    <p class="hint">One weapon each, ${rules.otherSlots.length} other pieces for the whole crew (p. 36), and a bonus piece for the commander (p. 32). Leave a slot empty to skip it; the crew starts fully equipped.</p>
    ${weaponRows}${otherRows}
    <label>Commander's bonus piece<select data-bind-ui="${draftName}.bonusItem">${gearPickerOptions(rules.bonusItems, gear.bonusItem)}</select></label>`;
}

// starting crews saved earlier: each campaign that uses one gets its own fresh copy
function renderCrewTemplates() {
  const templates = store.listCrewTemplates();
  if (templates.length === 0) return '';
  return `<section class="card form"><h2>Saved starting crews</h2>
    <p class="hint">Fully geared and ready. Using one makes a fresh crew from it; what that crew earns later never changes the saved one.</p>
    ${templates.map((template) => `<div class="template-row"><div class="grow"><b>${escapeHtml(template.name)}</b>
        <small>${escapeHtml(template.draft.shipType)} ship · ${Number(template.draft.size) + 1} members · ${escapeHtml(template.draft.edge)}</small></div>
      <button class="primary" data-action="useCrewTemplate" data-id="${escapeHtml(template.id)}">Use</button>
      <button data-action="loadCrewTemplate" data-id="${escapeHtml(template.id)}">Adjust</button></div>`).join('')}
    <p class="hint">Adjust loads one into the form below without changing the saved one. To change or delete saved crews: Settings → Starting crews.</p></section>`;
}

// The creator form, for a crew about to join the campaign (draftName 'newCrew') or for editing a saved starting crew in Settings
// (draftName 'templateDraft'): the same form, so a starting crew is built exactly like a real one.
function renderCrewForm({ draftName, isFirstCrew = false, isTemplate = false }) {
  const draft = ui[draftName];
  const ship = SHIP_TYPES[draft.shipType];
  const crewTypeOptions = ship.crewTypes.map((type) => [type, CREW_TYPES[type].isAdvanced ? `${type} (advanced)` : type]);
  const memberSelects = newCrewMemberTypes(draft).map((type, index) => (
    `<label>Crew ${index + 1}<div class="row">
      <input class="grow" placeholder="Name" aria-label="Crew ${index + 1} name" data-bind-ui="${draftName}.memberNames.${index}" value="${escapeHtml(draft.memberNames[index])}">
      <select aria-label="Crew ${index + 1} type" data-bind-ui="${draftName}.memberTypes.${index}">${options(crewTypeOptions, type)}</select>
    </div></label>`
  )).join('');
  const pointsLeft = COMMANDER_FREE_STAT_POINTS - store.commanderPointsSpent(draft.commanderPoints);
  const commanderStat = (stat) => BASE_STATS_BY_CREW_SIZE[draft.size][stat] + (ship.commanderBonus[stat] ?? 0) + draft.commanderPoints[stat];
  return `${isTemplate ? '' : renderCrewTemplates()}<section class="card form">
    <h2>${isTemplate ? (ui.editingTemplateId === 'new' ? 'New starting crew' : 'Edit starting crew') : isFirstCrew ? 'New crew' : 'Add a crew to the party'}</h2>
    <p class="hint">Follow p. 24–39 of the rulebook. The app fills in stats and abilities; choose the starting gear below.${isFirstCrew ? '' : ' The new crew travels with the others from the room you are in. Each crew needs its own secondary agenda.'}</p>
    <label>Crew name<input data-bind-ui="${draftName}.name" value="${escapeHtml(draft.name)}"></label>
    <label>Crew size<select data-bind-ui="${draftName}.size" data-rerender data-number>${options(Object.keys(BASE_STATS_BY_CREW_SIZE).map((size) => [size, `${size} + commander`]), draft.size)}</select></label>
    <label>Ship type<select data-bind-ui="${draftName}.shipType" data-rerender>${options(Object.keys(SHIP_TYPES).map((type) => [type, type]), draft.shipType)}</select></label>
    <label>Edge (p. 34–36)<select data-bind-ui="${draftName}.edge" data-rerender>${options(EDGES.map((edge) => [edge, edge]), draft.edge)}</select></label>
    ${renderEdgeNote(draft.edge)}
    ${isTemplate ? '' : `<label>Secondary agenda (optional, d12 on p. 39)<select data-bind-ui="${draftName}.agenda">${options([['', 'None'], ...Object.entries(AGENDAS).map(([key, agenda]) => [key, agenda.name])], draft.agenda)}</select></label>`}
    <h3>Commander</h3>
    <label>Commander name<input data-bind-ui="${draftName}.commanderName" value="${escapeHtml(draft.commanderName)}"></label>
    <p class="hint">${escapeHtml(ship.commanderAbility)} (p. ${ABILITY_PAGES[ship.commanderAbility]}) · free stat points left: <b>${pointsLeft}</b> of ${COMMANDER_FREE_STAT_POINTS}</p>
    ${renderRuleNotes('abilities', ship.commanderAbility)}
    <div class="stats">${STAT_KEYS.map((stat) => stepper(STAT_LABELS[stat], `${draftName}:${stat}`, commanderStat(stat), 'spendCommanderPoint')).join('')}</div>
    <h3>Crew</h3>
    <p class="hint">Who you may recruit, and how many of each: p. ${ship.page}. At most one advanced crew member.</p>
    ${memberSelects}
    ${renderStartingGearForm(draft, draftName)}
    ${isTemplate ? `<button class="primary" data-action="saveTemplateEdits">Save starting crew</button>
    <button data-action="cancelTemplateEdit">Cancel</button>` : `<button class="primary" data-action="createCrew">${isFirstCrew ? 'Enter the station' : 'Join the party'}</button>
    <button data-action="saveCrewTemplate">Save as a starting crew</button>
    ${isFirstCrew ? '' : '<button data-action="cancelAddingCrew">Cancel</button>'}`}
  </section>`;
}

// ---------- log ----------

function renderLog() {
  const run = state.run;
  const pastCrews = state.station.pastCrews;
  const graveyard = run ? store.allMembers(run).filter((member) => member.status === 'dead')
    .map((member) => `<li>${escapeHtml(member.name)} <small>${escapeHtml(member.type)}</small></li>`).join('') : '';
  const pastCrewsHtml = pastCrews.length ? `<section class="card"><h3>Previous crews</h3><ul class="plain">${pastCrews.map((crew) => (
    `<li><b>${escapeHtml(crew.name)}</b> — ${escapeHtml(crew.outcome)}, ${crew.challengesCleared} cleared, ended in Challenge ${crew.endedInChallenge}${crew.fallen.length ? `<br><small>Fallen: ${escapeHtml(crew.fallen.map((entry) => entry.name).join(', '))}</small>` : ''}</li>`)).join('')}</ul></section>` : '';
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

function diceResultText(rolled) {
  const targetNumber = Number(rolled.target) || 0;
  const successesNeeded = Number(rolled.needed) || 0;
  const evenSuccesses = rolled.faces.filter((face) => face % 2 === 0 && face >= targetNumber).length;
  const isCriticalSuccess = rolled.faces.filter((face) => face === 12).length >= 2;
  const isCriticalFailure = !isCriticalSuccess && rolled.faces.filter((face) => face === 1).length >= 2;
  if (isCriticalFailure) return 'Critical failure';
  const successes = isCriticalSuccess ? evenSuccesses * 2 : evenSuccesses;
  const count = `${successes} success${successes === 1 ? '' : 'es'}`;
  if (isCriticalSuccess) return `Critical success — ${count}`;
  if (!successesNeeded) return count;
  return successes >= successesNeeded ? `${count} — passed` : `${count} — ${successesNeeded - successes} short`;
}

function renderDice() {
  const { pool, target, needed, rolled, isHelpOpen } = ui.dice;
  let resultHtml = '';
  if (rolled) {
    const targetNumber = Number(rolled.target) || 0;
    const isSuccess = (face) => face % 2 === 0 && face >= targetNumber;
    resultHtml = `<div class="dice">${rolled.faces.map((face) => `<span class="die ${isSuccess(face) ? 'hit' : ''}">${face}</span>`).join('')}</div>
      <p class="result">${escapeHtml(diceResultText(rolled))}</p>`;
  }
  const numberField = (label, key, value, max, placeholder) => `<label class="stat"><span class="stat-label">${label}</span>
    <input type="number" min="0" max="${max}" inputmode="numeric" placeholder="${placeholder}" data-bind-ui="dice.${key}" value="${escapeHtml(value)}"></label>`;
  return `<section class="card form"><h2>Dice</h2>
    <p class="hint">A test reads like <b>Reaction 2 (6+)</b>: roll your Reaction in d12s, you need 2 successes, evens of 6 or more count.</p>
    <div class="stats three">${stepper('Dice', 'dice.pool', pool, 'stepUi')}
      ${numberField('Needed', 'needed', needed, 99, 'any')}${numberField('Target', 'target', target, 12, 'n+')}</div>
    <button class="primary" data-action="rollPool">Roll</button>
    ${resultHtml}</section>
    <section class="card"><button class="help-toggle" data-action="toggleDiceHelp" aria-expanded="${isHelpOpen}">${isHelpOpen ? 'Hide' : 'How do I make a test?'}</button>
      ${isHelpOpen ? `<dl class="help">${DICE_HELP.map(({ question, answer }) => `<dt>${escapeHtml(question)}</dt><dd>${escapeHtml(answer)}</dd>`).join('')}</dl>` : ''}
    </section>`;
}

// ---------- settings ----------

function obstaclesForRandomTerrainInCurrentRoom() {
  const roomLayout = roomLayoutFor(roomLayouts, state.run.currentChallenge);
  return roomLayout ? obstaclesForRandomTerrain(roomLayout) : [];
}

function syncStatusText(sync) {
  if (sync.phase === 'syncing') return 'Syncing…';
  if (sync.phase === 'error') return `Sync failed: ${sync.message}`;
  if (sync.phase === 'synced') return `Synced ${new Date(sync.lastSyncedAt).toLocaleTimeString()}${sync.message ? ` · ${sync.message}` : ''}.`;
  return 'Signed in. Changes upload a moment after you make them.';
}

// Sign-ups are off by design, so an account is made by hand in the owner's own Supabase project (docs/SYNC.md has the full setup)
const HOW_TO_GET_AN_ACCOUNT = `<details class="how-to"><summary>No account yet? How to add one</summary>
  <ol class="hint">
    <li>Create a free project at supabase.com, then open <b>SQL Editor</b>, paste the contents of <code>docs/supabase-setup.sql</code> and run it.</li>
    <li><b>Authentication → Sign In / Providers</b>: switch off "Allow new users to sign up" and set the minimum password length to 12 or more.</li>
    <li><b>Authentication → Users → Add user → Create new user</b>: type your email and a long password, tick "Auto Confirm User", create.</li>
    <li><b>Authentication → Multi-Factor</b>: make sure TOTP is enabled.</li>
    <li><b>Project Settings → API Keys</b>: copy the project URL and the publishable key (never a secret key) into <code>js/config.js</code>, then reload the app.</li>
    <li>Come back here and sign in with that email and password. The first time, scan the QR code with an authenticator app and type the 6-digit code.</li>
  </ol></details>`;

// the save sync: off until js/config.js is filled in, then email + password, then a TOTP code
function renderSyncCard() {
  const sync = cloud.getSyncStatus();
  const busy = ui.isSyncBusy ? ' disabled' : '';
  const codeInput = `<label>6-digit code from your authenticator app<input inputmode="numeric" autocomplete="one-time-code" maxlength="6" data-bind-ui="syncCode" value="${escapeHtml(ui.syncCode)}"></label>`;
  let body;
  if (!sync.isConfigured) {
    body = '<p class="hint">Not set up. Your playthroughs live in this browser only. To keep a copy in your own free database too, set one up first:</p>' + HOW_TO_GET_AN_ACCOUNT;
  } else if (sync.isSignedIn) {
    body = `<p class="hint">${escapeHtml(sync.email ?? '')} · ${escapeHtml(syncStatusText(sync))}</p>
      <p class="hint">Automatic: changes upload a moment after you make them, and other devices' changes arrive every minute and when you come back to the app.</p>
      <div class="row"><button data-async-action="syncNow"${busy}>Sync now</button><button data-async-action="syncSignOut"${busy}>Sign out</button></div>
      ${hasLocalPrivateFiles ? `<p class="hint">The room texts and crew notes in <code>local/</code> are the book's text: they are not in the public site. Copy them to your private database to see them on the deployed app too (after signing in there).</p>
      <button data-async-action="syncUploadPrivateFiles"${busy}>Copy room texts to my database</button>` : ''}`;
  } else if (ui.syncStep === 'enroll' && ui.syncEnrollment) {
    body = `<p class="hint">First time: scan this with an authenticator app (or type the secret in), then enter the code it shows.</p>
      ${ui.syncEnrollment.qrCode ? `<img class="totp-qr" alt="QR code for your authenticator app" src="${escapeHtml(ui.syncEnrollment.qrCode)}">`
        : '<p class="hint">No QR image came back from the server: use the secret below, or the link, instead.</p>'}
      <p class="hint">Secret: <code>${escapeHtml(ui.syncEnrollment.secret)}</code></p>
      ${ui.syncEnrollment.uri ? `<p class="hint"><a href="${escapeHtml(ui.syncEnrollment.uri)}">Open in an authenticator app on this device</a> (on a phone)</p>` : ''}
      ${codeInput}<div class="row"><button class="primary" data-async-action="syncVerify"${busy}>Verify</button><button data-async-action="syncSignOut"${busy}>Cancel</button></div>`;
  } else if (ui.syncStep === 'code') {
    body = `<p class="hint">Password accepted. Now the code from your authenticator app.</p>${codeInput}
      <div class="row"><button class="primary" data-async-action="syncVerify"${busy}>Verify</button><button data-async-action="syncSignOut"${busy}>Cancel</button></div>`;
  } else {
    body = `<p class="hint">Sign in to keep a copy of all playthroughs in your own database. Without signing in, nothing leaves this browser.</p>
      <label>Email<input type="email" autocomplete="username" data-bind-ui="syncEmail" value="${escapeHtml(ui.syncEmail)}"></label>
      <label>Password<input type="password" autocomplete="current-password" data-bind-ui="syncPassword"></label>
      <button class="primary" data-async-action="syncSignIn"${busy}>Sign in</button>
      ${HOW_TO_GET_AN_ACCOUNT}`;
  }
  return `<section class="card form"><h2>Sync</h2>${body}</section>`;
}

// Settings → Starting crews: the saved crews, made and changed here whatever campaign is running
function renderStartingCrewsSettings() {
  if (ui.editingTemplateId) return renderCrewForm({ draftName: 'templateDraft', isTemplate: true });
  const templates = store.listCrewTemplates();
  return `<section class="card form"><h2>Starting crews</h2>
    <p class="hint">Crews built once, fully geared as the book allows (p. 24–39), to use in any campaign: you always get a fresh copy, and what a crew earns later never changes the saved one. They sync with your saves.</p>
    ${templates.length ? templates.map((template) => `<div class="template-row"><div class="grow"><b>${escapeHtml(template.name)}</b>
        <small>${escapeHtml(template.draft.shipType)} ship · ${Number(template.draft.size) + 1} members · ${escapeHtml(template.draft.edge)}</small></div>
      <button data-action="editStartingCrew" data-id="${escapeHtml(template.id)}">Edit</button>
      ${confirmButton('deleteCrewTemplate', 'Delete', `data-id="${escapeHtml(template.id)}"`)}</div>`).join('') : '<p class="hint">None saved yet.</p>'}
    <button class="primary" data-action="newStartingCrew">+ New starting crew</button></section>`;
}

function renderSettings() {
  const sections = [['general', 'General'], ['starting-crews', 'Starting crews']];
  const sectionButtons = `<div class="subtabs" role="tablist">${sections.map(([key, label]) => (
    `<button role="tab" aria-selected="${ui.settingsSection === key}" class="${ui.settingsSection === key ? 'active' : ''}" data-action="showSettingsSection" data-section="${key}">${label}</button>`)).join('')}</div>`;
  if (ui.settingsSection === 'starting-crews') return `${sectionButtons}${renderStartingCrewsSettings()}`;
  return `${sectionButtons}${renderSyncCard()}
    <section class="card form"><h2>Party</h2>
      ${state.run ? `<p class="hint">Retiring archives the whole party (every crew) and lets a new one set out. Agenda progress and station legacy are kept.</p>${confirmButton('retireParty', 'Retire the party')}` : '<p class="hint">No crew aboard.</p>'}
    </section>
    <section class="card form"><h2>Save data</h2>
      <p class="hint">Everything lives in this browser (and in your cloud copy, when sync is on), all playthroughs together. Export to back up or move to another device. Importing a backup replaces everything; importing the save of a single campaign adds it as a new playthrough.</p>
      <button data-action="exportSave">Export save (JSON)</button>
      <label class="file">Import save<input type="file" accept="application/json,.json" data-import></label>
    </section>
    <section class="card form"><h2>Danger</h2>${confirmButton('wipeEverything', 'Wipe everything (all playthroughs)')}</section>
    <section class="card"><p class="hint">Unofficial fan-made companion for Space Station Zero by Snarling Badger Studios. Contains no rules text — you need the rulebook to play.</p></section>`;
}

// ---------- versus (skirmish) ----------
// Crews fighting each other on one of the book's skirmish challenges (p. 100–112). Apart from the campaign: a match lives in
// `state.versus.match` (js/skirmish.js), and the players are people at the table, not crews of the campaign.

const challengeOptions = () => Object.entries(SKIRMISH_CHALLENGES)
  .map(([key, challenge]) => [key, `${challenge.name} (p. ${challenge.page}) · ${challenge.players[0]}–${challenge.players[1]} players`]);

const SKIRMISH_BOOK_HINT = 'The book\'s own text for this challenge appears here when your private rules file is loaded.';

function renderSkirmishBookText(key, title) {
  const entry = crewRules?.skirmishes?.[key];
  if (!entry) return '';
  const lore = entry.lore ? `<p class="lore">${escapeHtml(entry.lore)}</p>` : '';
  return `<details><summary>${escapeHtml(title)}</summary><div class="rules">${lore}${entry.sections.map(renderRulesSection).join('')}</div></details>`;
}

function renderVersusHistory() {
  const history = state.versus.history;
  if (history.length === 0) return '';
  return `<section class="card"><h3>Earlier matches</h3><ul class="plain">${history.map((record) => (
    `<li><b>${escapeHtml(SKIRMISH_CHALLENGES[record.challengeKey].name)}</b> — ${record.winners.length > 1 ? 'draw between ' : 'won by '}${escapeHtml(record.winners.join(' & '))}
      <small>${record.players.map((player) => `${escapeHtml(player.name)} ${player.total}`).join(' · ')} · ${escapeHtml(new Date(record.finishedAt).toLocaleDateString())}</small></li>`)).join('')}</ul></section>`;
}

function renderVersusStart() {
  const draft = ui.versusDraft;
  const challenge = SKIRMISH_CHALLENGES[draft.challengeKey];
  const [fewest, most] = challenge?.players ?? [2, 4];
  const playerCount = Math.min(most, Math.max(fewest, draft.playerCount));
  const playerOptions = Array.from({ length: most - fewest + 1 }, (_, index) => [fewest + index, `${fewest + index} players`]);
  const nameInputs = Array.from({ length: playerCount }, (_, index) => `<label>Player ${index + 1}
      <input placeholder="Player ${index + 1}" data-bind-ui="versusDraft.names.${index}" value="${escapeHtml(draft.names[index])}"></label>`).join('');
  return `<section class="card form"><h2>Versus</h2>
      <p class="hint">Crews fight each other instead of exploring (p. 100–112): pick a skirmish challenge, set up, and keep the score turn by turn. Bring one crew per player, ideally new ones of about equal strength: build them once under Settings → Starting crews.</p>
      <label>Skirmish challenge<select data-bind-ui="versusDraft.challengeKey" data-rerender>${options([['', '— choose, or roll a d12 —'], ...challengeOptions()], draft.challengeKey)}</select></label>
      <button data-action="versusRollChallenge">Roll a d12 for the challenge</button>
      ${challenge ? `<p class="hint"><b>${escapeHtml(challenge.name)}:</b> ${escapeHtml(challenge.goal)} Obstacle: ${escapeHtml(challenge.obstacle)}.</p>` : ''}
      <label>Players<select data-bind-ui="versusDraft.playerCount" data-rerender data-number>${options(playerOptions, playerCount)}</select></label>
      ${nameInputs}
      <button class="primary" data-action="versusStart">Set up the match</button></section>
    ${renderSkirmishBookText('general', 'How skirmish games work (the book)')}
    ${renderVersusHistory()}`;
}

function versusMatchBoard(match) {
  const layout = skirmish.skirmishLayout(match);
  const isFirstDrawOfNewTerrain = ui.isTerrainJustRolled;
  ui.isTerrainJustRolled = false;
  const legendEntries = [...(match.terrain ? [['random', 'random terrain']] : []), ['crew', 'start areas'], ...(layout.markers.length ? [['marker', 'objectives']] : [])];
  return `${renderBoardSvg(match.terrain, layout, { focus: ui.boardFocus, dropIn: isFirstDrawOfNewTerrain })}
    <p class="board-info" id="board-info">${escapeHtml(ui.boardInfo ?? BOARD_INFO_HINT)}</p>
    <div class="legend">${legendEntries.map(([kind, label]) => (
    `<button class="legend-item ${ui.boardFocus === kind ? 'active' : ''}" data-action="toggleBoardFocus" data-kind="${kind}" aria-pressed="${ui.boardFocus === kind}"><span class="swatch ${kind}"></span>${label}</button>`)).join('')}</div>
    ${match.phase === 'setup' ? (match.terrain ? confirmButton('versusRollTerrain', 'Roll random terrain again') : '<button data-action="versusRollTerrain">Roll random terrain</button>') : ''}
    ${match.terrain?.unplacedPieces?.length ? `<p class="hint terrain-unplaced">${match.terrain.unplacedPieces.length} random piece(s) marked "no room" do not fit 2" away from the start areas and objectives: put them where they fit.</p>` : ''}`;
}

// who plays from where: the start order (Crew 1, 2, ...) or, in Base Attack, the roles
function renderVersusSeating(match) {
  const nameOf = (playerId) => match.players.find((player) => player.id === playerId).name;
  const isSetup = match.phase === 'setup';
  if (match.roles) {
    const sorted = [...match.roles].sort((a, b) => (a.role === b.role ? a.slot - b.slot : a.role === 'attacker' ? -1 : 1));
    return `<ul class="plain">${sorted.map((entry) => `<li><b>${escapeHtml(nameOf(entry.playerId))}</b> — ${entry.role} ${entry.slot}${entry.role === 'attacker' && entry.slot === 1 ? ' <span class="chip ok">first activation</span>' : ''}</li>`).join('')}</ul>
      ${match.players.length === 3 ? '<p class="hint">The book describes this challenge for one or two attackers and defenders; with three players the app splits one attacker against two defenders. Agree at the table if you would rather split it differently.</p>' : ''}
      ${isSetup ? '<button data-action="versusRerollRoles">Re-roll the roles</button>' : ''}`;
  }
  const order = skirmish.activationOrder(match);
  return `<ol class="plain seating">${match.order.map((playerId, index) => `<li><b>Crew ${index + 1}</b> · ${escapeHtml(nameOf(playerId))} <small>start area Player ${['One', 'Two', 'Three', 'Four'][index]}</small>${playerId === match.firstPlayerId ? ' <span class="chip ok">first activation</span>' : ''}</li>`).join('')}</ol>
    ${match.firstPlayerId ? `<p class="hint">Activation order: ${order.map((playerId) => escapeHtml(nameOf(playerId))).join(' → ')} (clockwise round the table: sit in that order).</p>` : ''}
    ${isSetup ? `<div class="row wrap"><button data-action="versusRandomiseOrder">Roll for start positions</button><button data-action="versusPickFirst">Roll for first activation</button></div>` : ''}`;
}

function renderVersusScoring(match) {
  const challenge = SKIRMISH_CHALLENGES[match.challengeKey];
  const lines = skirmish.scoringLinesOnTurn(challenge, match.turn);
  const rows = skirmish.standings(match);
  return `${rows.map(({ player, total, thisTurn, isLeading }) => `<section class="card versus-player${isLeading ? ' leading' : ''}">
      <h3>${escapeHtml(player.name)} <span class="chip ${isLeading ? 'ok' : ''}">${total} VP</span>${thisTurn ? ` <span class="chip warn">+${thisTurn} this turn</span>` : ''}</h3>
      ${lines.map((line) => `<div class="count-row"><span>${escapeHtml(line.label)} <small>× ${line.vp} VP</small></span>
        <span class="counter"><button data-action="versusCount" data-player="${player.id}" data-line="${line.key}" data-delta="-1" aria-label="One fewer: ${escapeHtml(line.label)}">−</button>
        <b>${match.counts[player.id][line.key] ?? 0}</b>
        <button data-action="versusCount" data-player="${player.id}" data-line="${line.key}" data-delta="1" aria-label="One more: ${escapeHtml(line.label)}">+</button></span></div>`).join('')}
    </section>`).join('')}
    ${challenge.scoring.some((line) => line.finalOnly) && match.turn < SKIRMISH_TURNS ? '<p class="hint">Some of this challenge\'s score is counted once, at the end of the last turn; its counters appear then.</p>' : ''}`;
}

function renderVersusResult(match) {
  const rows = skirmish.standings(match);
  const winning = skirmish.winners(match);
  return `<section class="card versus-result"><h3>${winning.length > 1 ? 'A draw' : 'Winner'}: ${escapeHtml(winning.map((player) => player.name).join(' & '))}</h3>
    <div class="stats-wrap"><table class="rules-table"><thead><tr><th>Player</th>${match.turns.map((_, index) => `<th>T${index + 1}</th>`).join('')}<th>Total</th></tr></thead>
    <tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.player.name)}</td>${row.perTurn.map((points) => `<td>${points}</td>`).join('')}<td><b>${row.total}</b></td></tr>`).join('')}</tbody></table></div></section>`;
}

function renderVersusMatch(match) {
  const challenge = SKIRMISH_CHALLENGES[match.challengeKey];
  const phaseChip = { setup: 'setting up', playing: `turn ${match.turn} of ${SKIRMISH_TURNS}`, finished: 'finished' }[match.phase];
  const header = `<section class="card room"><p class="eyebrow">Skirmish · p. ${challenge.page} <span class="chip ${match.phase === 'finished' ? 'ok' : 'warn'}">${phaseChip}</span></p>
      <h2>${escapeHtml(challenge.name)}</h2>
      <p class="goal"><b>Goal:</b> ${escapeHtml(challenge.goal)}</p>
      <p class="hint">Obstacle: ${escapeHtml(challenge.obstacle)}. Scoring: ${challenge.scoring.map((line) => `${escapeHtml(line.label.toLowerCase())} × ${line.vp}${line.finalOnly ? ' (at the end)' : ''}`).join('; ')}.</p>
      ${renderEnemyStats(challenge.stats)}`;
  const reminders = `<details><summary>What changes in a skirmish</summary><ul class="plain">${SKIRMISH_REMINDERS.map((reminder) => `<li>${escapeHtml(reminder)}</li>`).join('')}</ul></details>`;
  const book = renderSkirmishBookText(match.challengeKey, 'The book\'s text for this challenge');
  const abandon = confirmButton('versusAbandon', match.phase === 'finished' ? 'Discard this match' : 'Abandon this match');
  if (match.phase === 'setup') {
    return `${header}
      <h4 class="plain-heading">Players</h4>${renderVersusSeating(match)}
      <h4 class="plain-heading">Set up the table</h4>${versusMatchBoard(match)}
      ${reminders}${book}
      <div class="action-bar"><button class="primary" data-action="versusBegin">Start the match →</button></div>${abandon}</section>`;
  }
  if (match.phase === 'playing') {
    return `${header}</section>
      ${renderVersusScoring(match)}
      <div class="action-bar"><button class="primary" data-action="versusEndTurn">${match.turn >= SKIRMISH_TURNS ? 'End the last turn and finish' : `End turn ${match.turn}`} →</button>
        ${match.turns.length ? '<button data-action="versusUndoTurn">Take back the last turn</button>' : ''}</div>
      <section class="card"><details><summary>Players, positions and map</summary>${renderVersusSeating(match)}${versusMatchBoard(match)}</details>${reminders}${book}${abandon}</section>`;
  }
  return `${header}</section>${renderVersusResult(match)}
    <section class="card"><button class="primary" data-action="versusClose">Save to earlier matches</button>
      <button data-action="versusUndoTurn">Take back the last turn</button>${abandon}</section>`;
}

function renderVersus() {
  return state.versus.match ? renderVersusMatch(state.versus.match) : renderVersusStart();
}

// ---------- shell ----------

// everything on screen that belonged to the previous playthrough (or to the save that was just replaced)
function resetViewForOtherPlaythrough() {
  Object.assign(ui, { tab: 'journey', postGame: null, exitRoll: '', mapSelected: null, confirmKey: null, boardInfo: null, boardFocus: null,
    isLoreOpen: true, isPlaythroughMenuOpen: false, isAddingCrew: false, newPlaythroughName: '', versusDraft: blankVersusDraft() });
  roomOfBoardView = null;
}

function renderPlaythroughMenu() {
  const items = store.listPlaythroughs().map(({ id, name, isActive, state: playthroughState }) => {
    const run = playthroughState.run;
    const summary = run ? `${partyName(run)} · Challenge ${run.currentChallenge}${run.ended ? ' · ended' : ''}` : 'no crew yet';
    return `<button class="exit playthrough-item ${isActive ? 'active' : ''}" data-action="switchPlaythrough" data-id="${escapeHtml(id)}">
      <span>${escapeHtml(name)}${isActive ? ' · playing' : ''}</span><small>${escapeHtml(summary)}</small></button>`;
  }).join('');
  return `<section class="card form playthrough-menu"><h2>Playthroughs</h2>
    <p class="hint">Each one is a separate campaign: its own crews, route, log, agenda progress and station legacy.</p>
    <div class="stack">${items}</div>
    <h3>Start a new one</h3>
    <div class="row"><input class="grow" maxlength="40" placeholder="Name, e.g. Solo with Maya" aria-label="Name of the new playthrough" data-bind-ui="newPlaythroughName" value="${escapeHtml(ui.newPlaythroughName)}">
      <button class="primary" data-action="addPlaythrough">Add</button></div>
    <h3>The one you are playing</h3>
    <div class="row"><input class="grow" maxlength="40" aria-label="Rename this playthrough" data-bind-ui="renamePlaythroughName" value="${escapeHtml(ui.renamePlaythroughName)}">
      <button data-action="renamePlaythrough">Rename</button></div>
    ${confirmButton('deletePlaythrough', 'Delete this playthrough')}
    <button class="quiet" data-action="togglePlaythroughMenu">Close</button></section>`;
}

// the info line and the lit-up kind belong to one room's map: a new room starts clean (they could name things from the last room)
let roomOfBoardView = null;

function resetBoardViewWhenRoomChanged() {
  const room = state?.run?.currentChallenge ?? null;
  if (room !== roomOfBoardView) {
    roomOfBoardView = room;
    ui.boardInfo = null;
    ui.boardFocus = null;
    ui.isLoreOpen = true;
  }
}

function render() {
  if (unreadableSaveMessage) {
    appElement.innerHTML = `<main><section class="card"><h2>Save data could not be read</h2>
      <p class="error">${escapeHtml(unreadableSaveMessage)}</p>
      <p>Nothing has been overwritten. Download the raw data to rescue it, or wipe it to start fresh.</p>
      <div class="row"><button data-action="downloadRawSave">Download raw save</button>${confirmButton('wipeEverything', 'Wipe everything')}</div>
    </section></main>`;
    return;
  }
  resetBoardViewWhenRoomChanged();
  const views = { journey: renderJourney, crew: renderCrew, log: renderLog, dice: renderDice, versus: renderVersus, settings: renderSettings };
  appElement.innerHTML = `<header><img src="icons/icon.svg" alt="" width="48" height="48"><div><h1>Captain's Log</h1><span>Space Station Zero</span></div>
      <button class="playthrough-button" data-action="togglePlaythroughMenu" aria-expanded="${ui.isPlaythroughMenuOpen}" aria-label="Playthroughs">
        <small>Playthrough</small>${escapeHtml(store.activePlaythroughName())} ▾</button></header>
    <main>
      ${ui.isPlaythroughMenuOpen ? renderPlaythroughMenu() : ''}
      ${ui.errorMessage ? `<p class="error" role="alert">${escapeHtml(ui.errorMessage)}</p>` : ''}
      ${ui.noticeMessage ? `<p class="notice">${escapeHtml(ui.noticeMessage)}</p>` : ''}
      ${views[ui.tab]()}
    </main>
    <nav>${TABS.map(([tab, label]) => `<button data-action="showTab" data-tab="${tab}" class="${ui.tab === tab ? 'active' : ''}">${label}</button>`).join('')}</nav>`;
  refreshBoardInteractions();
}

const actions = {
  showTab: ({ tab }) => { ui.tab = tab; },
  selectMapRoom: ({ number }) => { ui.mapSelected = Number(number); },
  step: ({ path, delta }) => { setAtPath(state, path, Math.max(0, getAtPath(state, path) + Number(delta))); },
  stepUi: ({ path, delta }) => { setAtPath(ui, path, Math.max(1, getAtPath(ui, path) + Number(delta))); },

  spendCommanderPoint: ({ path, delta }) => {
    const [draftName, stat] = path.split(':');
    const points = ui[draftName].commanderPoints;
    const newValue = points[stat] + Number(delta);
    if (newValue < 0) return;
    if (store.commanderPointsSpent(points) + Number(delta) > COMMANDER_FREE_STAT_POINTS) throw new Error(`All ${COMMANDER_FREE_STAT_POINTS} free points are spent.`);
    points[stat] = newValue;
  },
  createCrew: () => { createCrewFromForm(); },
  // a template is only a recipe: the form takes a copy, so nothing a crew earns can reach it
  useCrewTemplate: ({ id }) => { loadTemplateIntoForm(id); createCrewFromForm(); },
  loadCrewTemplate: ({ id }) => {
    loadTemplateIntoForm(id);
    ui.noticeMessage = `Loaded "${ui.newCrew.name}": change what you like, then enter the station. The saved one stays as it was.`;
  },
  saveCrewTemplate: () => {
    // the secondary agenda is rolled per campaign, so it is not part of a starting crew
    const { agenda, ...recipe } = structuredClone(ui.newCrew);
    const { replaced } = store.saveCrewTemplate({ ...recipe, memberTypes: newCrewMemberTypes(ui.newCrew) });
    ui.noticeMessage = `${replaced ? 'Updated' : 'Saved'} the starting crew "${recipe.name.trim()}". Use it from the Saved starting crews list for any campaign.`;
  },
  deleteCrewTemplate: ({ id }) => { store.deleteCrewTemplate(id); ui.noticeMessage = 'Deleted the saved starting crew.'; },
  // versus (skirmish) matches: see renderVersus
  versusRollChallenge: () => {
    const roll = rollD12();
    ui.versusDraft.challengeKey = skirmish.challengeKeyForRoll(roll);
    ui.noticeMessage = `Rolled ${roll}: ${SKIRMISH_CHALLENGES[ui.versusDraft.challengeKey].name}.`;
  },
  versusStart: () => {
    const { challengeKey, playerCount, names } = ui.versusDraft;
    state.versus.match = skirmish.createMatch({ challengeKey, playerNames: names.slice(0, playerCount) });
    ui.boardInfo = null;
    ui.boardFocus = null;
  },
  versusRandomiseOrder: () => { skirmish.randomiseOrder(state.versus.match); },
  versusRerollRoles: () => { skirmish.rerollRoles(state.versus.match); },
  versusPickFirst: () => { skirmish.pickFirstPlayer(state.versus.match); },
  versusRollTerrain: () => {
    const match = state.versus.match;
    match.terrain = generateTerrain(rollD12, obstaclesForRandomTerrain(skirmish.skirmishLayout(match)));
    ui.isTerrainJustRolled = true;
    ui.boardInfo = null;
  },
  versusBegin: () => { skirmish.beginMatch(state.versus.match); },
  versusCount: ({ player, line, delta }) => { skirmish.changeCount(state.versus.match, player, line, Number(delta)); },
  versusEndTurn: () => { skirmish.endTurn(state.versus.match); },
  versusUndoTurn: () => { skirmish.undoTurn(state.versus.match); },
  versusAbandon: () => { state.versus.match = null; ui.noticeMessage = 'Match discarded.'; },
  // a finished match goes to the list of earlier ones
  versusClose: () => {
    const match = state.versus.match;
    state.versus.history = [{
      challengeKey: match.challengeKey, finishedAt: new Date().toISOString(),
      players: skirmish.standings(match).map((row) => ({ name: row.player.name, total: row.total })),
      winners: skirmish.winners(match).map((player) => player.name),
    }, ...state.versus.history].slice(0, MAX_VERSUS_HISTORY);
    state.versus.match = null;
  },
  // Settings → Starting crews: made and edited without touching the running campaign
  showSettingsSection: ({ section }) => { ui.settingsSection = section; },
  newStartingCrew: () => {
    ui.templateDraft = { size: 6, shipType: 'Exploration', edge: EDGES[0], memberTypes: Array(8).fill('Soldier'), ...blankCrewFormFields() };
    ui.editingTemplateId = 'new';
  },
  editStartingCrew: ({ id }) => {
    const template = store.listCrewTemplates().find((candidate) => candidate.id === id);
    if (!template) throw new Error('That saved starting crew no longer exists.');
    ui.templateDraft = { ...blankCrewFormFields(), ...structuredClone(template.draft) };
    ui.editingTemplateId = id;
  },
  saveTemplateEdits: () => {
    const { agenda, ...recipe } = structuredClone(ui.templateDraft);
    const { replaced } = store.saveCrewTemplate({ ...recipe, memberTypes: newCrewMemberTypes(ui.templateDraft) }, ui.editingTemplateId === 'new' ? null : ui.editingTemplateId);
    ui.noticeMessage = `${replaced ? 'Updated' : 'Saved'} the starting crew "${recipe.name.trim()}".`;
    ui.editingTemplateId = null;
    ui.templateDraft = null;
  },
  cancelTemplateEdit: () => { ui.editingTemplateId = null; ui.templateDraft = null; },
  startAddingCrew: () => { ui.isAddingCrew = true; },
  addCrewToParty: () => { ui.isAddingCrew = true; ui.tab = 'crew'; },
  cancelAddingCrew: () => { ui.isAddingCrew = false; },
  removeCrew: ({ crewId }) => { store.removeCrew(state, crewId); ui.postGame = null; },
  addMember: ({ crew }) => {
    state.run.crews[Number(crew)].members.push(store.createMember({
      name: 'New member', type: 'Soldier', isCommander: false, stats: store.zeroStats() }));
  },
  removeMember: ({ crew, index }) => { state.run.crews[Number(crew)].members.splice(Number(index), 1); },
  takeAdvancement: ({ crew, index, stat }) => { store.takeAdvancement(state.run.crews[Number(crew)].members[Number(index)], stat); },

  openPostGame: () => { ui.postGame = { downed: {}, bonusXp: {}, agendaPartFoundByCrew: {}, legacyEarned: false, note: '' }; },
  cancelPostGame: () => { ui.postGame = null; },
  toggleDowned: ({ id }) => {
    if (ui.postGame.downed[id]) delete ui.postGame.downed[id];
    else ui.postGame.downed[id] = { roll: '', stat: 'lf' };
  },
  rollInjury: ({ id }) => { ui.postGame.downed[id].roll = rollD12() + rollD12(); },
  applyPostGame: () => { store.completeCurrentChallenge(state, ui.postGame); ui.postGame = null; ui.exitRoll = ''; },

  rollTerrain: () => {
    state.run.roomSetup.terrain = generateTerrain(rollD12, obstaclesForRandomTerrainInCurrentRoom());
    ui.isTerrainJustRolled = true;
    ui.boardInfo = null;   // it may have described a piece that is gone now
  },
  showBoardInfo: ({ info }) => { ui.boardInfo = ui.boardInfo === info ? null : info; },
  togglePlaythroughMenu: () => {
    ui.isPlaythroughMenuOpen = !ui.isPlaythroughMenuOpen;
    ui.renamePlaythroughName = store.activePlaythroughName();
  },
  switchPlaythrough: ({ id }) => {
    state = store.switchPlaythrough(id);
    resetViewForOtherPlaythrough();
    ui.noticeMessage = `Now playing: ${store.activePlaythroughName()}.`;
  },
  addPlaythrough: () => {
    state = store.addPlaythrough(ui.newPlaythroughName);
    resetViewForOtherPlaythrough();
    ui.noticeMessage = `Started "${store.activePlaythroughName()}": create its crew on the Crew tab.`;
  },
  renamePlaythrough: () => {
    store.renameActivePlaythrough(ui.renamePlaythroughName);
    ui.noticeMessage = 'Renamed.';
  },
  deletePlaythrough: () => {
    state = store.deleteActivePlaythrough();
    resetViewForOtherPlaythrough();
    ui.noticeMessage = `Deleted. Now playing: ${store.activePlaythroughName()}.`;
  },
  toggleBoardFocus: ({ kind }) => { ui.boardFocus = ui.boardFocus === kind ? null : kind; },
  beginChallenge: () => { state.run.roomSetup.isMissionStarted = true; },
  reopenRoomSetup: () => { state.run.roomSetup.isMissionStarted = false; },

  rollExit: () => { ui.exitRoll = rollD12(); },
  takeRolledExit: () => {
    const destination = exitForRoll(CHALLENGES[state.run.currentChallenge], Number(ui.exitRoll));
    if (!destination) throw new Error('Enter a d12 result between 1 and 12.');
    store.moveToChallenge(state.run, destination, `Rolled ${ui.exitRoll}`);
    ui.exitRoll = '';
    ui.mapSelected = null;
  },
  takeExit: ({ to, label }) => { store.moveToChallenge(state.run, Number(to), label); ui.exitRoll = ''; ui.mapSelected = null; },

  addNote: () => {
    if (!ui.logNote.trim()) throw new Error('Write the note first.');
    store.addLogEntry(state.run, ui.logNote.trim(), true);
    ui.logNote = '';
  },
  exportMarkdown: () => { downloadTextFile('captains-log.md', store.logAsMarkdown(state.run), 'text/markdown'); },
  rollPool: () => { ui.dice.rolled = { faces: Array.from({ length: ui.dice.pool }, rollD12), target: ui.dice.target, needed: ui.dice.needed }; },
  toggleDiceHelp: () => { ui.dice.isHelpOpen = !ui.dice.isHelpOpen; },

  exportSave: () => { downloadTextFile('ssz-captains-log.json', store.exportSaveText(), 'application/json'); },
  downloadRawSave: () => { downloadTextFile('ssz-raw-save.txt', localStorage.getItem(store.STORAGE_KEY), 'text/plain'); },
  retireParty: () => { store.retireParty(state); ui.postGame = null; ui.mapSelected = null; ui.tab = 'crew'; ui.isAddingCrew = false; },
  wipeEverything: () => { state = store.wipeEverything(); unreadableSaveMessage = null; resetViewForOtherPlaythrough(); },
};

// taps on the map and its legend only change how the map looks: update it in place, so nothing re-renders, the
// animations keep running and the tapped item stays lit
const MAP_ONLY_ACTIONS = new Set(['showBoardInfo', 'toggleBoardFocus']);

// what a sync action does when the merge brought newer data from the cloud: use it
function useSyncedData(merge) {
  if (!merge?.changed) return;
  if (merge.activeReplaced) {
    state = store.activeState();
    resetViewForOtherPlaythrough();
  }
  if (!isTypingInAField()) render();
}

// actions that talk to the sync server: they wait for it, so they cannot go through the plain `actions` table
const asyncActions = {
  syncSignIn: async () => {
    const { next } = await cloud.signIn(ui.syncEmail, ui.syncPassword);
    ui.syncPassword = '';
    ui.syncStep = next;
    if (next === 'enroll') ui.syncEnrollment = await cloud.startEnrollment();
  },
  syncVerify: async () => {
    await cloud.verifyCode(ui.syncCode, ui.syncEnrollment?.factorId);
    Object.assign(ui, { syncCode: '', syncStep: 'signin', syncEnrollment: null });
    useSyncedData(await cloud.syncNow({ force: true }));
    await pullPrivateFilesFromDatabase();
  },
  syncNow: async () => {
    useSyncedData(await cloud.syncNow({ force: true }));
    await pullPrivateFilesFromDatabase();
  },
  // from the project folder: copy the private room texts and crew notes into the owner's database, for the other devices
  syncUploadPrivateFiles: async () => {
    const [roomLayoutsFile, crewRulesFile] = await Promise.all([fetchPrivateRoomLayouts(), fetchLocalCrewRules()]);
    if (!roomLayoutsFile && !crewRulesFile) throw new Error('No private files found: open the app from the project folder (where local/ is) and try again.');
    await cloud.uploadPrivateFiles({ ...(roomLayoutsFile ? { 'room-layouts': roomLayoutsFile } : {}), ...(crewRulesFile ? { 'crew-rules': crewRulesFile } : {}) });
    ui.noticeMessage = 'Copied the room texts and crew notes to your database. Your other devices get them after signing in.';
  },
  syncSignOut: async () => {
    await cloud.signOut();
    forgetPrivateFilesFromDatabase();
    Object.assign(ui, { syncStep: 'signin', syncCode: '', syncPassword: '', syncEnrollment: null });
  },
};

async function runAsyncAction(name) {
  ui.errorMessage = null;
  ui.noticeMessage = null;
  ui.isSyncBusy = true;
  render();
  try {
    await asyncActions[name]();
  } catch (error) {
    ui.errorMessage = error.message;
  } finally {
    ui.isSyncBusy = false;
    render();
  }
}

// measuring lines from the board edges to an item (the tapped one, or the one under the pointer); none for no item
function showMeasurementsOf(item) {
  const group = document.getElementById('board-measure');
  if (!group) return;
  group.innerHTML = item?.dataset.box ? renderMeasurementLinesSvg(item.dataset.box.split(' ').map(Number)) : '';
}

function refreshBoardInteractions() {
  const board = document.querySelector('.terrain-board');
  if (!board) return;
  [...board.classList].filter((name) => name.startsWith('focus-')).forEach((name) => board.classList.remove(name));
  if (ui.boardFocus) board.classList.add(`focus-${ui.boardFocus}`);
  board.querySelectorAll('[data-info]').forEach((item) => item.classList.toggle('selected', item.dataset.info === ui.boardInfo));
  document.getElementById('board-info').textContent = ui.boardInfo ?? BOARD_INFO_HINT;
  showMeasurementsOf(board.querySelector('.selected'));
  document.querySelectorAll('.legend-item').forEach((button) => {
    const isOn = button.dataset.kind === ui.boardFocus;
    button.classList.toggle('active', isOn);
    button.setAttribute('aria-pressed', String(isOn));
  });
}

function handleClick(event) {
  const asyncButton = event.target.closest('[data-async-action]');
  if (asyncButton) {
    runAsyncAction(asyncButton.dataset.asyncAction);
    return;
  }
  const element = event.target.closest('[data-action]');
  if (!element) return;
  if (MAP_ONLY_ACTIONS.has(element.dataset.action)) {
    actions[element.dataset.action](element.dataset);
    refreshBoardInteractions();
    return;
  }
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
    if (!unreadableSaveMessage) store.saveState();
  } catch (error) {
    ui.errorMessage = error.message;
  }
  render();
}

function createCrewFromForm() {
  store.addCrew(state, { ...ui.newCrew, memberTypes: newCrewMemberTypes(ui.newCrew) });
  // the next crew starts from a clean form
  Object.assign(ui.newCrew, blankCrewFormFields());
  ui.isAddingCrew = false;
  ui.tab = 'crew';
}

function loadTemplateIntoForm(id) {
  const template = store.listCrewTemplates().find((candidate) => candidate.id === id);
  if (!template) throw new Error('That saved starting crew no longer exists.');
  Object.assign(ui.newCrew, blankCrewFormFields(), structuredClone(template.draft));
}

function applyInput(element) {
  const statePath = element.dataset.bind;
  const uiPath = element.dataset.bindUi;
  if (element.dataset.appendTo && element.value) {
    const path = element.dataset.appendTo;
    setAtPath(state, path, [getAtPath(state, path), element.value].filter(Boolean).join('\n'));
    store.saveState();
    render();
    return;
  }
  if (!statePath && !uiPath) return;
  let value = element.type === 'checkbox' ? element.checked : element.value;
  if ((element.type === 'number' || 'number' in element.dataset) && value !== '') value = Number(value);
  if (statePath) {
    setAtPath(state, statePath, value);
    if (state.run) store.recordDeathLocations(state.run);
    store.saveState();
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
    state = store.importSave(await file.text());
    resetViewForOtherPlaythrough();
    ui.noticeMessage = `Save imported. Playing: ${store.activePlaythroughName()}.`;
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
try {
  roomLayouts = loadRoomLayouts();
  crewRules = loadCrewRules();
} catch (error) {
  ui.errorMessage = `Stored room layouts are unreadable (they are loaded again from the layout files at the next start): ${error.message}`;
}
appElement.addEventListener('click', handleClick);
// a <details> reports opening and closing with a `toggle` event that does not bubble, hence the capture
appElement.addEventListener('toggle', (event) => {
  if (event.target.matches?.('details[data-lore]')) ui.isLoreOpen = event.target.open;
}, true);
// hovering previews an item's details in the info line without re-rendering; leaving it shows the tapped item again
appElement.addEventListener('mouseover', (event) => {
  const hovered = event.target.closest?.('[data-info]');
  if (!hovered) return;
  document.getElementById('board-info').textContent = hovered.dataset.info;
  showMeasurementsOf(hovered);
});
appElement.addEventListener('mouseout', (event) => {
  const panel = document.getElementById('board-info');
  if (!panel || !event.target.closest?.('[data-info]') || event.relatedTarget?.closest?.('[data-info]')) return;
  panel.textContent = ui.boardInfo ?? BOARD_INFO_HINT;   // the pointer left the item: show the tapped one again
  showMeasurementsOf(document.querySelector('.terrain-board .selected'));
});
appElement.addEventListener('input', handleInput);
appElement.addEventListener('change', handleImport);

// the public footprints, and from the project folder also the private briefings and book text
// A re-render drops focus and swallows keystrokes, so it is skipped while a field is being edited (the layouts are
// then used from the next render) and when the file is what is already loaded.
const isTypingInAField = () => ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);

function useRoomLayouts() {
  const merged = mergeRoomLayouts(publicFootprints, privateRoomLayouts);
  if (!merged) return;
  const isNewContent = JSON.stringify(merged) !== JSON.stringify(roomLayouts);
  saveRoomLayouts(merged);
  roomLayouts = merged;
  if ((isNewContent || ui.errorMessage) && !isTypingInAField()) {
    ui.errorMessage = null;
    render();
  }
}

function useCrewRules(rules) {
  const isNewContent = JSON.stringify(rules) !== JSON.stringify(crewRules);
  saveCrewRules(rules);
  crewRules = rules;
  if (isNewContent && !isTypingInAField()) render();
}

Promise.all([fetchPublicFootprints(), fetchPrivateRoomLayouts()]).then(([footprints, privateLayouts]) => {
  publicFootprints = footprints;
  if (privateLayouts) {
    privateRoomLayouts = privateLayouts;
    hasLocalPrivateFiles = true;
  }
  useRoomLayouts();
}).catch((error) => {
  ui.errorMessage = error.message;
  if (!isTypingInAField()) render();
});

fetchLocalCrewRules().then((localRules) => {
  if (!localRules) return;
  hasLocalPrivateFiles = true;
  useCrewRules(localRules);
}).catch((error) => {
  ui.errorMessage = `local/crew-rules.json is not valid, nothing was loaded: ${error.message}`;
  if (!isTypingInAField()) render();
});

// Signed in and not served from the project folder: the briefings and book text come from the owner's private database.
// They never are in the public repo (CLAUDE.md rule 1).
async function pullPrivateFilesFromDatabase() {
  if (hasLocalPrivateFiles) return;
  const files = await cloud.downloadPrivateFiles();
  if (!files) return;
  if (files['room-layouts']) {
    privateRoomLayouts = checkedPrivateRoomLayouts(files['room-layouts']);
    useRoomLayouts();
  }
  if (files['crew-rules']) useCrewRules(checkedCrewRules(files['crew-rules']));
}

// signed out on a device that got them from the database: they go, so a shared phone does not keep the book's text
function forgetPrivateFilesFromDatabase() {
  if (hasLocalPrivateFiles) return;
  privateRoomLayouts = null;
  crewRules = null;
  forgetCrewRules();
  if (publicFootprints) {
    saveRoomLayouts(publicFootprints);
    roomLayouts = publicFootprints;
  }
}

// save sync: when signed in, every real change uploads a moment later, and everything is pulled when the app opens and
// whenever you come back to it. All of this does nothing when signed out or not set up.
// (Not when the save could not be read: syncing must never overwrite what is still recoverable.)
if (!unreadableSaveMessage) {
  cloud.restoreSession();
  store.onPlaythroughChange(() => cloud.schedulePush(useSyncedData));
  cloud.onSyncStatusChange(() => { if (ui.tab === 'settings' && !isTypingInAField() && !ui.isSyncBusy) render(); });
  // leaving the tab uploads at once (the 1.5 s upload delay must not lose a last change); coming back pulls
  document.addEventListener('visibilitychange', async () => {
    useSyncedData(await cloud.syncNow({ force: document.visibilityState === 'hidden' }));
  });
  window.addEventListener('online', async () => useSyncedData(await cloud.syncNow({ force: true })));
  // a second device may have changed something while this one stays open
  setInterval(async () => { if (document.visibilityState === 'visible') useSyncedData(await cloud.syncNow()); }, SYNC_PULL_INTERVAL_MS);
}
render();
if (!unreadableSaveMessage) cloud.syncNow({ force: true }).then(useSyncedData).then(pullPrivateFilesFromDatabase).catch(() => { /* optional: the sync card shows the real errors */ });
