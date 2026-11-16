// Rendering and event handling. Every button re-renders the whole app; typing never does
// (a re-render while typing would drop focus and swallow the next tap).
import {
  ABILITY_PAGES, AGENDAS, AGENDA_ROLL_TARGET, BASE_STATS_BY_CREW_SIZE, CHALLENGES, COMMANDER_BONUS_XP_PER_CHALLENGE,
  COMMANDER_FREE_STAT_POINTS, COOP_REMINDERS, challengeName, CREW_TYPES, SKIRMISH_CHALLENGES, SKIRMISH_COMMANDER_XP_TOLERANCE, SKIRMISH_REMINDERS, SKIRMISH_TURNS, DICE_HELP, EDGES, EQUIPMENT_CATEGORIES, INJURY_ROLL_MAX, INJURY_ROLL_MIN,
  ARMOR_ITEMS, DRONES, EDGE_ARMOR, LEGACY_PAGE_REFERENCE, LIMITED_USE_LABELS, MED_PATCH, STIM_SHOT, TEST_KINDS, SHIP_TYPES, STARTING_OTHER_EQUIPMENT, STAT_KEYS, STAT_LABELS, TUNINGS, WEAPONS, WEAPON_PROFILES, startingGearRules,
  XP_PER_SURVIVED_CHALLENGE, exitForRoll, injuryOutcomeForRoll, injuryRollRangeLabel,
} from './data.js';
import { fallenByChallenge, knownChallenges, renderStationMapSvg } from './map.js';
import * as cloud from './cloud-sync.js';
import { checkedCrewRules, fetchLocalCrewRules, forgetCrewRules, loadCrewRules, ruleNotesMentionedIn, saveCrewRules } from './crew-rules.js';
import * as combat from './combat.js';
import * as enemyLogic from './enemies.js';
import * as gear from './gear.js';
import * as limitedUse from './limited-use.js';
import * as preparation from './preparation.js';
import * as skirmish from './skirmish.js';
import * as turnLogic from './turns.js';
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
  // the room's enemy list: the form for adding one by hand (never saved)
  isAddingEnemy: false,
  enemyDraft: { name: '', life: '', combat: '' },
  // the combat calculator in the room card (never saved)
  combat: blankCombat(),
  // the Dice tab's test for a crew member, and the Emergency Med-Patch's chosen target per carrier (never saved)
  testRoll: { member: '', test: 'reaction', extra: 0, needed: '', target: '', rolled: null },
  medPatchTarget: {},
  settingsSection: 'general',
  editingTemplateId: null,
  templateDraft: null,
  newCrew: { size: 6, shipType: 'Exploration', edge: EDGES[0], memberTypes: Array(8).fill('Soldier'), ...blankCrewFormFields() },
};

function blankCombat() {
  return {
    isOpen: false, attacker: '', defender: '', weapon: '', reach: 'close', hasCover: false, extraAttackDice: 0, extraDefenseDice: 0,
    armor: '', armorFor: '', isKinetic: false, isFar: false, isOwnDice: false, ownAttackDice: '', ownDefenseDice: '', result: null,
  };
}

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

const rollTwoD12 = () => rollD12() + rollD12();

// `count` d12 results (at most 40, the largest pool the app deals with)
const rollDice = (count) => Array.from({ length: Math.min(count, combat.MAX_DICE_IN_A_POOL) }, rollD12);

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

// `styleClass`: red ("danger") for things that delete; a step that only moves on, like the next turn, is pink
function confirmButton(action, label, extraAttributes = '', styleClass = 'danger') {
  const isArmed = ui.confirmKey === action + extraAttributes;
  return `<button class="${styleClass}" data-action="${action}" data-confirm="${escapeHtml(action + extraAttributes)}" ${extraAttributes}>`
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
      <h2>${escapeHtml(challengeName(number))}</h2>
      <p class="page-ref">Rulebook p. ${challenge.page}</p>
      ${isCleared ? '' : renderPreparedLine()}
      ${isCleared ? '' : renderTurnTracker(number)}
      ${isCleared ? '' : renderCombat()}
      ${isCleared ? '' : renderRoomTable(number, { isSettingUp: false })}
      ${renderReminders(reminders)}
      ${isCleared ? renderExits(challenge) : (ui.postGame ? '' : `<div class="action-bar"><button class="primary" data-action="openPostGame">Challenge over →</button>
        <button data-action="reopenRoomSetup">← Set-up</button></div>`)}
    </section>
    ${!isCleared && ui.postGame ? renderPostGame(challenge) : ''}
    ${renderStationMap()}`;
}

// a member's stat with what changes it in this room: Jump Boots, and a Stim-Shot used here (js/gear.js)
const isStimmed = (member) => state.run?.roomSetup.stimmed.includes(member.id) ?? false;
const effectiveStatOf = (member, stat) => gear.effectiveStat(member, stat, { isStimmed: isStimmed(member) });
const crewOfMember = (memberId) => state.run.crews.find((crew) => crew.members.some((member) => member.id === memberId));
const crewMembersInRoom = () => store.allMembers(state.run).filter((member) => member.status === 'active');

// "Move 6 (Jump Boots +2)": shown only for the stats something changes
function renderStatBoosts(member) {
  return ['lf', 'mv'].map((stat) => {
    const parts = gear.statBonusParts(member, stat, { isStimmed: isStimmed(member) });
    return parts.length ? `<span class="chip ok">${STAT_LABELS[stat]} ${effectiveStatOf(member, stat)} <small>(${parts.map((part) => `${escapeHtml(part.source)} +${part.amount}`).join(', ')})</small></span>` : '';
  }).filter(Boolean).join(' ');
}

// "Crew A & Crew B": what the party is called
const partyName = (run) => run.crews.map((crew) => crew.name).join(' & ');

function activeCrewModelCount() {
  return crewMembersInRoom().length;
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
  // "per crew" numbers scale with the crews; a fixed plain number above 1 ("2" Gun Turrets) is shown as it is
  const fixedCount = /^\d+$/.test(enemy.count) && Number(enemy.count) > 1 ? `${enemy.count}× ` : '';
  const total = enemy.perCrew ? `${enemy.perCrew * participatingCrewCount()}× ` : fixedCount;
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
const isStatBarForOtherPartySize = (name) => enemyLogic.isStatBarForOtherPartySize(name, participatingCrewCount());

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
      <h2>${escapeHtml(challengeName(number))}</h2>
      <p class="page-ref">Read the room's opening on p. ${challenge.page}, then set up the table.</p>
      ${renderRoomTable(number, { isSettingUp: true })}
      ${renderReminders(reminders)}
      ${renderPartyLine()}
      ${renderPreparation()}
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
  // each Stabilization Module carried by someone taking part lets the player reroll one injury roll after the challenge (p. 36–37)
  const rerollsLeft = crewMembersInRoom().filter((member) => gear.carries(member.equipment, 'Stabilization Module')).length - draft.rerollsUsed;
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
        ${downed.roll === '' ? `<button data-action="rollInjury" data-id="${memberId}">Roll 2d12</button>` : ''}
        ${downed.roll !== '' && !downed.isRerolled && rerollsLeft > 0 ? `<button data-action="rerollInjury" data-id="${memberId}">Reroll (Stabilization Module)</button>` : ''}
        <input type="number" min="${INJURY_ROLL_MIN}" max="${INJURY_ROLL_MAX}" inputmode="numeric" placeholder="${INJURY_ROLL_MIN}–${INJURY_ROLL_MAX}" data-bind-ui="postGame.downed.${memberId}.roll" data-outcome-element="outcome-${memberId}" data-dead-question-element="dead-question-${memberId}" value="${escapeHtml(downed.roll)}">
        <select data-bind-ui="postGame.downed.${memberId}.stat" title="Stat to raise on a roll of ${oneStatUpRange}">${options(STAT_KEYS.map((stat) => [stat, `+${STAT_LABELS[stat]} on ${oneStatUpRange}`]), downed.stat)}</select>
      </div><p class="outcome" id="outcome-${memberId}">${escapeHtml(outcome?.label ?? '')}${downed.isRerolled ? ' (rerolled with a Stabilization Module)' : ''}</p>
      <div class="dead-question" id="dead-question-${memberId}"${outcome?.key === 'hidden' ? '' : ' hidden'}>
        <p class="hint">A roll of 2 is "Dead?": read p. 114, #1 now, then say what it decided.</p>
        <select aria-label="What p. 114, #1 decided" data-bind-ui="postGame.downed.${memberId}.deadQuestion">${options([['', '— what did the page decide? —'], ['dead', 'They died'], ['survived', 'They survived (apply any penalty on the Crew tab)']], downed.deadQuestion)}</select>
      </div>` : ''}
    </div>`;
  };
  const waitingForRoll = Object.values(draft.downed).filter((entry) => entry.roll === '').length;
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
    <p class="hint">Everyone marked out of action in the turn tracker, or at 0 Life, is ticked already: tick or untick to fix it. Each ticked crew member needs a roll. Survivors get +${XP_PER_SURVIVED_CHALLENGE} XP (commander +${XP_PER_SURVIVED_CHALLENGE + COMMANDER_BONUS_XP_PER_CHALLENGE}) automatically.</p>
    ${waitingForRoll ? `<button class="primary" data-action="rollAllInjuries">Roll 2d12 for ${waitingForRoll === 1 ? 'the one who needs it' : `all ${waitingForRoll} who need it`}</button>` : ''}
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
    <p><b>${escapeHtml(challengeName(number))}</b> <span class="page-ref">p. ${challenge.page}</span></p>
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
      <span class="chip ${effectiveStatOf(member, 'lf') - member.damage <= 0 ? 'warn' : 'ok'}">Life ${effectiveStatOf(member, 'lf') - member.damage}/${effectiveStatOf(member, 'lf')}</span>
    </div>
    ${advancementHtml}
    <div class="stats">${STAT_KEYS.map((stat) => stepper(STAT_LABELS[stat], `${path}.stats.${stat}`, member.stats[stat])).join('')}</div>
    ${renderStatBoosts(member) ? `<p class="stat-boosts">${renderStatBoosts(member)}</p>` : ''}
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
  const successesNeeded = Number(rolled.needed) || 0;
  const { successes, isCriticalSuccess, isCriticalFailure } = combat.scorePool(rolled.faces, Number(rolled.target) || 0);
  if (isCriticalFailure) return 'Critical failure';
  const count = `${successes} success${successes === 1 ? '' : 'es'}`;
  if (isCriticalSuccess) return `Critical success — ${count}`;
  if (!successesNeeded) return count;
  return successes >= successesNeeded ? `${count} — passed` : `${count} — ${successesNeeded - successes} short`;
}

// A test for a crew member with what their gear adds (js/gear.js): the stat, then each piece of equipment that helps this kind of test
function renderTestRoller() {
  if (!state.run) return '';
  const candidates = state.run.crews.flatMap((crew) => crew.members.filter((member) => member.status === 'active').map((member) => ({ member, label: state.run.crews.length > 1 ? `${member.name} (${crew.name})` : member.name })));
  if (candidates.length === 0) return '';
  const draft = ui.testRoll;
  const chosen = candidates.find((candidate) => candidate.member.id === draft.member) ?? candidates[0];
  const pool = gear.testPool(chosen.member, draft.test, { isStimmed: isStimmed(chosen.member) });
  const breakdown = [...pool.parts, { source: 'extra', dice: draft.extra }].filter((part) => part.dice > 0).map((part) => `${part.source} ${part.dice}`).join(' + ');
  const rolled = draft.rolled;
  const isSuccess = (face) => face % 2 === 0 && face >= (rolled?.target ?? 0);
  const resultHtml = rolled ? `<p class="hint">${escapeHtml(rolled.name)} · ${escapeHtml(rolled.testLabel)}</p>
    <div class="dice">${rolled.faces.map((face, index) => `<span class="die ${index === rolled.discarded ? 'discarded' : (isSuccess(face) ? 'hit' : '')}">${face}</span>`).join('')}</div>
    <p class="result">${escapeHtml(diceResultText({ faces: rolled.kept, target: rolled.target, needed: rolled.needed }))}</p>
    ${rolled.discarded !== null ? '<p class="hint">The struck-out die is the one discarded (the Heads-Up Display): the worst die goes.</p>' : ''}` : '';
  return `<section class="card form"><h2>Test for a crew member</h2>
    <p class="hint">Rolls the stat plus what the equipment adds to this kind of test. Abilities and edges are not counted: add their dice under Extra.</p>
    <label class="stat"><span class="stat-label">Who</span><select data-bind-ui="testRoll.member" data-rerender aria-label="Crew member">${options(candidates.map((candidate) => [candidate.member.id, candidate.label]), chosen.member.id)}</select></label>
    <label class="stat"><span class="stat-label">Test</span><select data-bind-ui="testRoll.test" data-rerender aria-label="Kind of test">${options(Object.entries(TEST_KINDS).map(([key, kind]) => [key, kind.label]), draft.test)}</select></label>
    <div class="stats three">${stepper('Extra dice', 'extra', draft.extra, 'stepTest')}
      <label class="stat"><span class="stat-label">Needed</span><input type="number" min="0" max="99" inputmode="numeric" placeholder="any" data-bind-ui="testRoll.needed" value="${escapeHtml(draft.needed)}"></label>
      <label class="stat"><span class="stat-label">Target</span><input type="number" min="0" max="12" inputmode="numeric" placeholder="${pool.kind.defaultTarget ? `${pool.kind.defaultTarget}+` : 'n+'}" data-bind-ui="testRoll.target" value="${escapeHtml(draft.target)}"></label></div>
    <p class="combat-pools"><b>${pool.total + draft.extra} dice</b> <small>(${escapeHtml(breakdown)})</small></p>
    ${pool.notes.map((note) => `<p class="hint">${escapeHtml(note)}</p>`).join('')}
    <button class="primary" data-action="rollTest">Roll</button>${resultHtml}</section>`;
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
  return `${renderTestRoller()}<section class="card form"><h2>Dice</h2>
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

// ---------- turn tracker ----------
// Who has the initiative, who has gone, what the next roll to keep it needs (p. 13–15): see js/turns.js.

function renderTurnChip(member, turns) {
  const isDone = turns.doneIds.includes(member.id);
  const isOut = turns.outIds.includes(member.id);
  const isLocked = !isDone && !isOut && (turns.side !== 'crew' || turns.awaitingRoll);
  const id = escapeHtml(member.id);
  return `<span class="turn-chip${isDone ? ' done' : ''}${isOut ? ' out' : ''}${isLocked ? ' locked' : ''}">
    <button class="turn-chip-main" data-action="turnToggleDone" data-id="${id}"${isOut || isLocked ? ' disabled' : ''} aria-pressed="${isDone}">${isDone ? '✓ ' : ''}${escapeHtml(member.name)}</button>
    <button class="turn-chip-out" data-action="turnToggleOut" data-id="${id}" aria-pressed="${isOut}" aria-label="${escapeHtml(member.name)}: out of action" title="Out of action">✕</button></span>`;
}

function renderRollLine(turns) {
  const needed = turnLogic.rollNeeded(turns);
  const sideName = turns.side === 'crew' ? 'your crew' : 'the enemies';
  if (needed !== null) {
    return `<div class="turn-roll"><p><b>Keep the initiative for ${sideName}?</b> Roll a d12: <b>${needed}+</b> keeps it.</p>
      <p class="hint">That was activation ${turns.run} in a row since the initiative came to this side. The count starts again each time it comes back.</p>
      <div class="row wrap"><button class="primary" data-action="turnRoll">Roll d12</button>
        <button data-action="turnKept">Rolled it: kept</button><button data-action="turnLost">Rolled it: lost</button></div></div>`;
  }
  const last = turns.lastRoll;
  if (!last) return '';
  const who = last.side === 'crew' ? 'Your crew' : 'The enemies';
  const result = last.kept ? `kept the initiative` : `lost the initiative`;
  return `<p class="turn-last ${last.kept ? 'kept' : 'lost'}">${who} ${last.roll === null ? `${result} (marked by hand)` : `rolled ${last.roll} (needed ${last.needed}+): ${result}`}.</p>`;
}

// who is able to act, for the turn logic: crew members still in the room, and the enemies still standing (null: no enemy list)
function turnSides() {
  const enemies = state.run.roomSetup.enemies;
  return { crewIds: crewMembersInRoom().map((member) => member.id), enemyIds: enemies.length ? enemyLogic.standingIds(enemies) : null };
}

// Any change can alter who is left to act in the room (a crew member's status, a member or crew added or removed, an enemy put down
// or back up): a side with nobody left hands the initiative on, and nobody rolls for a side that cannot take it. So this runs
// before every save, not at the few call sites that happen to know.
function settleTurnTracker() {
  if (state.run) turnLogic.settleInitiative(state.run.roomSetup.turns, turnSides());
}

function settleAndSave() {
  settleTurnTracker();
  store.saveState();
}

// a whole new list: nothing "done" from the old one counts any more
function replaceEnemies(enemies) {
  state.run.roomSetup.enemies = enemies;
  state.run.roomSetup.turns.enemyDoneIds = [];
}

// ---------- the room's enemies ----------
// The enemies of the room being played, each with its Life (p. 21): see js/enemies.js. Built from the room's briefing when the
// crew begins the challenge (the private room text), or by hand. Their rows are also their chips in the turn tracker.

function renderLifePips(enemy) {
  if (enemy.life > enemyLogic.MAX_LIFE_WITH_PIPS) return '';
  const left = enemyLogic.lifeLeft(enemy);
  const id = escapeHtml(enemy.id);
  const pips = Array.from({ length: enemy.life }, (_, index) => (
    `<button class="pip${index < left ? ' full' : ''}" data-action="enemyPip" data-id="${id}" data-pip="${index + 1}" aria-label="Life ${index + 1}" aria-pressed="${index < left}"></button>`)).join('');
  return `<span class="life-pips" role="group" aria-label="Life left: tap a pip to set it">${pips}</span>`;
}

function renderEnemyRow(enemy, turns) {
  const enemies = state.run.roomSetup.enemies;
  const isOut = enemyLogic.isOutOfAction(enemy);
  const isDone = turns.enemyDoneIds.includes(enemy.id);
  const isLocked = !isDone && !isOut && (turns.side !== 'enemy' || turns.awaitingRoll);
  const id = escapeHtml(enemy.id);
  const lifeButton = (change, label) => `<button class="life-step" data-action="enemyLife" data-id="${id}" data-change="${change}"
    aria-label="${label} Life: ${escapeHtml(enemyLogic.displayName(enemies, enemy))}">${change > 0 ? '+' : '−'}${Math.abs(change)}</button>`;
  return `<div class="enemy-row${isDone ? ' done' : ''}${isOut ? ' out' : ''}">
    <button class="enemy-activate" data-action="turnEnemyDone" data-id="${id}"${isOut || isLocked ? ' disabled' : ''} aria-pressed="${isDone}">
      <span>${isDone ? '✓ ' : ''}${escapeHtml(enemyLogic.displayName(enemies, enemy))}</span>
      <small>${isOut ? 'out of action' : `${enemy.armor ? `armor ${escapeHtml(enemy.armor)}` : 'no armor'}${enemy.isHidden ? ' · hidden: activates last' : ''}`}</small></button>
    <span class="enemy-life" aria-label="Life left"><b>${enemyLogic.lifeLeft(enemy)}</b>/${enemy.life}</span>
    <span class="life-steps">${enemy.life > enemyLogic.MAX_LIFE_WITH_PIPS ? lifeButton(-5, 'Take 5 from') : ''}${lifeButton(-1, 'Take 1 from')}${lifeButton(1, 'Give 1 to')}</span>
    ${renderLifePips(enemy)}
  </div>`;
}

// what is left to do about the list: fill it from the briefing, add the groups that come later, add one by hand
function renderEnemyListTools(number) {
  const enemies = state.run.roomSetup.enemies;
  const roomLayout = roomLayoutFor(roomLayouts, number);
  const { enemies: fromBriefing, later, notListed } = enemyLogic.startingEnemies(roomLayout, participatingCrewCount());
  const parts = [];
  if (enemies.length === 0 && fromBriefing.length > 0) {
    parts.push(`<button class="primary" data-action="fillEnemies">List this room's enemies (${fromBriefing.length})</button>`);
  }
  for (const group of later) {
    parts.push(`<button data-action="addEnemyGroup" data-index="${group.index}">Add ${group.size}× ${escapeHtml(group.stat.name)} <small>(${escapeHtml(group.when)})</small></button>`);
  }
  parts.push(ui.isAddingEnemy
    ? `<div class="enemy-add"><input type="text" placeholder="Enemy name" aria-label="Enemy name" maxlength="40" data-bind-ui="enemyDraft.name" value="${escapeHtml(ui.enemyDraft.name)}">
        <input type="number" inputmode="numeric" placeholder="Life" aria-label="Life" min="1" max="${enemyLogic.MAX_ENEMY_LIFE}" data-bind-ui="enemyDraft.life" value="${escapeHtml(ui.enemyDraft.life)}">
        <input type="number" inputmode="numeric" placeholder="Combat" aria-label="Combat, optional" min="0" max="${enemyLogic.MAX_ENEMY_LIFE}" data-bind-ui="enemyDraft.combat" value="${escapeHtml(ui.enemyDraft.combat)}">
        <button class="primary" data-action="addEnemyByHand">Add</button><button data-action="cancelAddEnemy">Cancel</button></div>`
    : '<button data-action="startAddEnemy">+ Add an enemy by hand</button>');
  if (enemies.length > 0) parts.push(confirmButton('clearEnemies', 'Clear the list'));
  const missing = notListed.length
    ? `<p class="hint">Not on the list for lack of a number or a Life stat in the briefing: ${notListed.map((group) => escapeHtml(group.name)).join(', ')}. Add them by hand.</p>` : '';
  return `<div class="row wrap enemy-tools">${parts.join('')}</div>${missing}`;
}

function renderEnemySide(number, turns, isEnemySide) {
  const enemies = state.run.roomSetup.enemies;
  const doneButton = `<button data-action="turnEnemiesDone" aria-pressed="${turns.enemiesDone}">${turns.enemiesDone ? 'Enemies are done ✓ (tap to undo)' : 'Enemies are done'}</button>`;
  if (enemies.length === 0) {
    return `<div class="turn-enemy">
      <span>Enemy activations: <b>${turns.enemyActivations}</b></span>
      <button data-action="turnEnemyPlus"${isEnemySide && !turns.awaitingRoll ? '' : ' disabled'}>+ An enemy activated</button>
      <button data-action="turnEnemyMinus" aria-label="One fewer enemy activation"${turns.enemyActivations ? '' : ' disabled'}>−</button>
      ${doneButton}
    </div>${renderEnemyListTools(number)}`;
  }
  const standing = enemyLogic.standingIds(enemies).length;
  return `<div class="enemy-roster">
    <h4>Enemies <span class="chip ${standing ? 'warn' : 'ok'}">${standing ? `${standing} of ${enemies.length} standing` : 'all out of action'}</span></h4>
    <div class="enemy-rows">${enemies.map((enemy) => renderEnemyRow(enemy, turns)).join('')}</div>
    <p class="hint">Tap an enemy when it activates. Take Life off with the − buttons, or tap a pip to set it. At 0 Life it is out of action and removed from play (p. 21); + gives a point back.</p>
    <div class="row wrap">${doneButton}</div>
    ${renderEnemyListTools(number)}
  </div>`;
}

function renderTurnTracker(number) {
  const run = state.run;
  const turns = run.roomSetup.turns;
  const sides = turnSides();
  const limit = CHALLENGES[number].turnLimit;
  const isComplete = turnLogic.isTurnComplete(turns, sides);
  const limitChip = !limit ? ''
    : turns.turn > limit ? `<span class="chip danger">past the limit (end of turn ${limit})</span>`
      : turns.turn === limit ? `<span class="chip warn">last turn: the limit is its end</span>`
        : `<span class="chip">limit: end of turn ${limit}</span>`;
  const crewGroups = run.crews.map((crew) => {
    const chips = crew.members.filter((member) => member.status === 'active').map((member) => renderTurnChip(member, turns)).join('');
    return chips ? `<div class="turn-crew-group">${run.crews.length > 1 ? `<small>${escapeHtml(crew.name)}</small>` : ''}<div class="turn-chips">${chips}</div></div>` : '';
  }).join('');
  const isEnemySide = turns.side === 'enemy';
  const nextTurnButton = isComplete
    ? `<button class="primary" data-action="turnNext">Turn ${turns.turn} is complete: start turn ${turns.turn + 1} →</button>`
    : confirmButton('turnNext', `Start turn ${turns.turn + 1} now`, '', 'next-step');
  return `<section class="turn-tracker side-${turns.side}">
    <div class="turn-head"><h3>Turn ${turns.turn}</h3>${limitChip}
      <span class="initiative">${isEnemySide ? 'Initiative: the enemies' : 'Initiative: your crew'}</span></div>
    ${renderRollLine(turns)}
    <div class="turn-crew">${crewGroups || '<p class="hint">Nobody from the crew is able to play this room.</p>'}</div>
    <p class="hint">Tap a crew member when they activate. ✕ marks someone put out of action.</p>
    ${renderLimitedUse()}
    ${renderEnemySide(number, turns, isEnemySide)}
    ${isEnemySide && !isComplete ? renderEnemyAi() : ''}
    <div class="row wrap">${nextTurnButton}</div>
  </section>`;
}

// the book's enemy action list: its own wording, so only from the private rules file; without it a pointer to the page
function renderEnemyAi() {
  const enemyAi = crewRules?.enemyAi;
  if (!enemyAi) return '<div class="enemy-ai"><p class="hint">When an enemy activates: the Enemy Action Priority list, p. 42 (hidden enemies go last, p. 22).</p></div>';
  return `<div class="enemy-ai"><h4>When an enemy activates (p. 42)</h4>
    <ol>${enemyAi.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol>
    <details class="rule-note"><summary>ⓘ Enemy AI, the book's introduction</summary><p>${escapeHtml(enemyAi.intro)}</p></details></div>`;
}

// ---------- preparation and once-per-X abilities ----------
// What the crew does at the start of the challenge (js/preparation.js) and the abilities that can be used once per turn, challenge or
// game (js/limited-use.js).


// "Ann (Crew A): Sidearm": the crew is named only when there are several
function carriedItemLabel(carrierId, carrierName, item) {
  return `${carrierName}${state.run.crews.length > 1 ? ` (${crewOfMember(carrierId)?.name ?? ''})` : ''}: ${item}`;
}

function tuningEffectText(kind, item) {
  if (kind === 'weapon') return `+${WEAPON_PROFILES[item].bonusDice} → +${combat.weaponDiceOf(item, [item])} dice`;
  const value = combat.armorValueOf(item);
  const only = ARMOR_ITEMS[item]?.onlyAgainst ? ' against Ranged Kinetic attacks' : '';
  return value === null ? `+${TUNINGS.armor.bonus} armor, raise it by hand` : `armor ${value} → ${value + TUNINGS.armor.bonus}${only}`;
}

function renderTuningSelect(kind, tuner, members) {
  const { tunings } = state.run.roomSetup;
  const current = preparation.tuningOf(tunings, kind, tuner.id);
  const isTakenByAnother = ({ carrierId, item }) => tunings.some((tuning) => tuning.kind === kind && tuning.carrierId === carrierId && tuning.item === item && tuning.tunerId !== tuner.id);
  const choices = preparation.tuneableItems(members, kind).filter((choice) => !isTakenByAnother(choice));
  const choiceOptions = choices.map((choice) => [`${choice.carrierId}|${choice.item}`, `${carriedItemLabel(choice.carrierId, choice.carrierName, choice.item)} (${tuningEffectText(kind, choice.item)})`]);
  const currentValue = current ? `${current.carrierId}|${current.item}` : '';
  // a tuning whose piece is no longer carried stays visible, so it can be taken back
  if (current && !choiceOptions.some(([value]) => value === currentValue)) choiceOptions.push([currentValue, `${current.item} (no longer carried)`]);
  return `<label class="stat"><span class="stat-label">${TUNINGS[kind].ability} · ${escapeHtml(tuner.name)}</span>
    <select data-input-action="setTuning" data-kind="${kind}" data-tuner="${escapeHtml(tuner.id)}" aria-label="${TUNINGS[kind].ability}: ${escapeHtml(tuner.name)}">
      ${options([['', '— nothing —'], ...choiceOptions], currentValue)}</select></label>`;
}

function renderPreparation() {
  // each member with their crew's edge: it can give them Power Armor to tune
  const members = state.run.crews.flatMap((crew) => crew.members.map((member) => ({ ...member, edge: crew.edge })));
  const selects = ['weapon', 'armor'].flatMap((kind) => preparation.tunersOf(members, kind).map((tuner) => renderTuningSelect(kind, tuner, members)));
  const stimShots = renderStimShots();
  const drones = renderDroneSelects();
  return `<section class="prep-card"><h3>Before you begin</h3>
    <p class="hint">At the start of a challenge each Engineer taking part tunes one weapon (+${TUNINGS.weapon.bonus} die, p. ${TUNINGS.weapon.page}) and each Scientist one piece of armor (+${TUNINGS.armor.bonus} armor, p. ${TUNINGS.armor.page}), for this challenge only. No piece twice; any crew's will do.</p>
    ${selects.join('') || '<p class="hint">Nobody taking part has Weapon Tuning or Armor Tuning: nothing to tune.</p>'}
    ${drones}
    ${stimShots ? `<h4>Stim-Shot (p. 37)</h4><p class="hint">Single use: +${STIM_SHOT.stat.lf} Life and +${STIM_SHOT.stat.mv} Move for one challenge. Using it takes it out of the equipment.</p>${stimShots}` : ''}</section>`;
}

// who has a Stim-Shot to use, and who has used one in this room (tap again to take it back)
function renderStimShots() {
  const { stimmed } = state.run.roomSetup;
  const buttons = crewMembersInRoom().filter((member) => stimmed.includes(member.id) || gear.carries(member.equipment, STIM_SHOT.item)).map((member) => {
    const isUsed = stimmed.includes(member.id);
    return `<button class="limited-chip${isUsed ? ' used' : ''}" data-action="toggleStimShot" data-id="${escapeHtml(member.id)}" aria-pressed="${isUsed}">
      ${isUsed ? '✓ ' : ''}${escapeHtml(member.name)} <small>${isUsed ? `used: Life ${effectiveStatOf(member, 'lf')}, Move ${effectiveStatOf(member, 'mv')} (tap to take it back)` : 'use a Stim-Shot'}</small></button>`;
  });
  return buttons.length ? `<div class="turn-chips">${buttons.join('')}</div>` : '';
}

// the Drone System is a Shielding or a Targeting Drone (p. 37–38); the book does not say when it is chosen, so it is set for each challenge
function renderDroneSelects() {
  const { drones } = state.run.roomSetup;
  return crewMembersInRoom().filter((member) => gear.carries(member.equipment, 'Drone System')).map((member) => `
    <label class="stat"><span class="stat-label">Drone System · ${escapeHtml(member.name)}</span>
      <select data-input-action="setDrone" data-member="${escapeHtml(member.id)}" aria-label="Drone of ${escapeHtml(member.name)}">
        ${options([['', '— not chosen —'], ...Object.entries(DRONES).map(([key, drone]) => [key, drone.name])], drones[member.id] ?? '')}</select></label>`).join('');
}

function renderPreparedLine() {
  const { tunings, stimmed, drones } = state.run.roomSetup;
  const members = store.allMembers(state.run);
  const nameOf = (id) => members.find((member) => member.id === id)?.name ?? '?';
  const chips = [
    ...tunings.map((tuning) => {
      const carrier = members.find((member) => member.id === tuning.carrierId);
      return `<span class="chip ok">${escapeHtml(carriedItemLabel(tuning.carrierId, carrier?.name ?? '?', tuning.item))} · ${escapeHtml(tuningEffectText(tuning.kind, tuning.item))}</span>`;
    }),
    ...stimmed.map((id) => `<span class="chip ok">${escapeHtml(nameOf(id))} · Stim-Shot: Life +${STIM_SHOT.stat.lf}, Move +${STIM_SHOT.stat.mv}</span>`),
    ...Object.entries(drones).map(([id, choice]) => `<span class="chip ok">${escapeHtml(nameOf(id))} · ${DRONES[choice].name}</span>`),
  ];
  return chips.length ? `<p class="prepared"><b>For this challenge:</b> ${chips.join(' ')}</p>` : '';
}

// an Emergency Med-Patch heals instead of only being ticked: pick who, tap Heal (once per challenge)
function renderMedPatches(entries) {
  const members = crewMembersInRoom();
  return entries.filter((entry) => entry.name === MED_PATCH.item).map((entry) => {
    const carrierId = entry.key.slice(0, entry.key.indexOf(':'));
    if (limitedUse.isUsed(state.run, entry)) return `<p class="hint">✓ ${escapeHtml(entry.holder)}'s ${MED_PATCH.item} is used (it is back in the next challenge).</p>`;
    const selected = medPatchTargetFor(carrierId);
    return `<div class="enemy-add med-patch"><span>${escapeHtml(entry.holder)}'s ${MED_PATCH.item} gives back ${MED_PATCH.heal} Life to</span>
      <select data-bind-ui="medPatchTarget.${escapeHtml(carrierId)}" aria-label="Who the Med-Patch heals">${options(members.map((member) => [member.id, `${member.name}${member.damage ? ` (${member.damage} damage)` : ''}`]), selected)}</select>
      <button class="primary" data-action="useMedPatch" data-carrier="${escapeHtml(carrierId)}">Heal</button></div>`;
  }).join('');
}

// who the Med-Patch of this carrier will heal: the choice made, else the first crew member with damage, else the carrier
function medPatchTargetFor(carrierId) {
  const members = crewMembersInRoom();
  const chosen = ui.medPatchTarget[carrierId];
  return members.some((member) => member.id === chosen) ? chosen : (members.find((member) => member.damage > 0)?.id ?? carrierId);
}

function renderLimitedUse() {
  const entries = limitedUse.limitedUseEntries(state.run);
  const stimShots = renderStimShots();
  if (entries.length === 0 && !stimShots) return '';
  const groups = Object.entries(LIMITED_USE_LABELS).map(([frequency, label]) => {
    const chips = entries.filter((entry) => entry.frequency === frequency && entry.name !== MED_PATCH.item).map((entry) => {
      const isUsed = limitedUse.isUsed(state.run, entry);
      return `<button class="limited-chip${isUsed ? ' used' : ''}" data-action="toggleLimitedUse" data-key="${escapeHtml(entry.key)}" aria-pressed="${isUsed}">
        ${isUsed ? '✓ ' : ''}${escapeHtml(entry.name)} <small>${escapeHtml(entry.holder)}</small></button>`;
    }).join('');
    return chips ? `<div class="turn-crew-group"><small>${label}</small><div class="turn-chips">${chips}</div></div>` : '';
  }).join('');
  return `<div class="limited-use"><h4>Special abilities</h4>${groups}
    ${stimShots ? `<div class="turn-crew-group"><small>Stim-Shot: single use, for this challenge</small>${stimShots}</div>` : ''}${renderMedPatches(entries)}
    <p class="hint">Tap one when it is used. A new turn frees the once-per-turn ones; the once-per-challenge ones come back in the next room.</p></div>`;
}

// ---------- combat ----------
// One attack and the defence against it (p. 20–21): the rules are in js/combat.js. Nothing here is saved; applying the damage
// changes the Life of a crew member or of an enemy on the room's list.

const OTHER_COMBATANT = { key: 'other', kind: 'other', name: 'Someone else' };

function combatantsInRoom() {
  const { run } = state;
  const crew = run.crews.flatMap((party) => party.members.filter((member) => member.status === 'active').map((member) => ({
    key: `crew:${member.id}`, kind: 'crew', member, name: run.crews.length > 1 ? `${member.name} (${party.name})` : member.name })));
  const enemies = run.roomSetup.enemies.map((enemy) => ({
    key: `enemy:${enemy.id}`, kind: 'enemy', enemy, name: enemyLogic.displayName(run.roomSetup.enemies, enemy), isOut: enemyLogic.isOutOfAction(enemy) }));
  return { crew, enemies };
}

const combatStatOf = (combatant) => ({ crew: combatant.member?.stats.co, enemy: combatant.enemy?.combat }[combatant.kind] ?? 0);

// who fights whom and with how many dice, from the choices made so far (a choice that no longer exists falls back to a default)
function combatSetup() {
  const { crew, enemies } = combatantsInRoom();
  const standing = enemies.filter((enemy) => !enemy.isOut);
  const pick = (key, fallback) => [...crew, ...standing, OTHER_COMBATANT].find((candidate) => candidate.key === key) ?? fallback;
  const attacker = pick(ui.combat.attacker, crew[0] ?? OTHER_COMBATANT);
  const defender = pick(ui.combat.defender, standing[0] ?? OTHER_COMBATANT);
  const attackerWeapons = attacker.kind === 'crew' ? combat.carriedWeapons(attacker.member.equipment) : [];
  const weapon = ui.combat.weapon === 'none' ? '' : (attackerWeapons.includes(ui.combat.weapon) ? ui.combat.weapon : (attackerWeapons[0] ?? ''));
  const weaponProfile = WEAPON_PROFILES[weapon];
  // a Ranged attack needs a weapon without the Close keyword (p. 21): a crew member with none, or a Close-only one, attacks within 1"
  const mayShoot = attacker.kind !== 'crew' || weaponProfile?.reach === 'ranged';
  const reach = !mayShoot || weaponProfile?.reach === 'close' ? 'close' : ui.combat.reach;
  const isKinetic = attacker.kind === 'crew' ? Boolean(weaponProfile?.isKinetic) : ui.combat.isKinetic;
  const isRangedKinetic = reach === 'ranged' && isKinetic;
  // the Drone System (p. 37–38): chosen for this challenge in the set-up; the Targeting Drone helps a Ranged weapon at a far target
  const { drones } = state.run.roomSetup;
  const droneOf = (combatant) => (combatant.kind === 'crew' && gear.carries(combatant.member.equipment, 'Drone System') ? drones[combatant.member.id] : undefined);
  const attackerDrone = droneOf(attacker);
  const targetingDice = attackerDrone === 'targeting' && reach === 'ranged' && ui.combat.isFar ? DRONES.targeting.bonusDice : 0;
  // what this challenge's tunings (js/preparation.js) add to the pieces each of them carries
  const { tunings } = state.run.roomSetup;
  const tunedAttacker = attacker.kind === 'crew' ? preparation.tunedItemsOf(tunings, attacker.member.id) : [];
  const tunedDefender = defender.kind === 'crew' ? preparation.tunedItemsOf(tunings, defender.member.id) : [];
  const weaponDice = weapon ? combat.weaponDiceOf(weapon, tunedAttacker) : 0;
  const defenseWeaponDice = defender.kind === 'crew' ? combat.defenseBonusOf(defender.member.equipment, tunedDefender) : 0;
  const defenderEdge = defender.kind === 'crew' ? crewOfMember(defender.member.id).edge : '';
  const defaultArmor = defender.kind === 'crew' ? combat.armorOf(defender.member.equipment, { tunedItems: tunedDefender, edge: defenderEdge, isRangedKinetic }) : (defender.kind === 'enemy' ? (parseInt(defender.enemy.armor, 10) || null) : null);
  // a hand-set armor belongs to the defender it was set for
  const chosenArmor = ui.combat.armor !== '' && ui.combat.armorFor === defender.key ? ui.combat.armor : defaultArmor;
  return {
    attacker, defender, attackerWeapons, weapon, reach, hasCover: reach === 'ranged' && ui.combat.hasCover, tunedAttacker, tunedDefender,
    mayShoot, isRangedKinetic, defenderEdge, attackerDrone, defenderDrone: droneOf(defender), targetingDice,
    attackBaseDice: combatStatOf(attacker), weaponDice, defenseBaseDice: combatStatOf(defender), defenseWeaponDice,
    attackDice: combatStatOf(attacker) + weaponDice + targetingDice + ui.combat.extraAttackDice,
    defenseDice: combatStatOf(defender) + defenseWeaponDice + ui.combat.extraDefenseDice,
    armor: weaponProfile?.ignoresArmor ? null : chosenArmor, ignoresArmor: Boolean(weaponProfile?.ignoresArmor),
  };
}

function renderCombatantOptions(selected) {
  const { crew, enemies } = combatantsInRoom();
  const listOf = (combatants) => options(combatants.map((combatant) => [combatant.key, combatant.name]), selected);
  return `${crew.length ? `<optgroup label="Crew">${listOf(crew)}</optgroup>` : ''}
    ${enemies.some((enemy) => !enemy.isOut) ? `<optgroup label="Enemies">${listOf(enemies.filter((enemy) => !enemy.isOut))}</optgroup>` : ''}
    ${options([[OTHER_COMBATANT.key, `${OTHER_COMBATANT.name} (set the dice by hand)`]], selected)}`;
}

function renderCombatDice(scored) {
  return `<div class="dice small">${scored.dice.map(({ face, isSuccess }) => `<span class="die ${isSuccess ? 'hit' : ''}">${face}</span>`).join('')}</div>`;
}

function combatPoolText(label, total, parts) {
  const breakdown = parts.filter(([, dice]) => dice > 0).map(([name, dice]) => `${name} ${dice}`).join(' + ');
  return `<b>${label}: ${total} dice</b>${breakdown ? ` <small>(${escapeHtml(breakdown)})</small>` : ''}`;
}

// who the damage of a result hurts (null when it hurts nobody, or they are gone)
function combatVictimOf(result) {
  if (!result.outcome.victim) return null;
  const victimKey = result.outcome.victim === 'defender' ? result.defenderKey : result.attackerKey;
  const { crew, enemies } = combatantsInRoom();
  return [...crew, ...enemies].find((candidate) => candidate.key === victimKey) ?? null;
}

// the victim's Shielding Drone, when it can step in: chosen, damage within its limit, and not used this turn (p. 37–38)
function shieldingDroneEntryFor(victim, damage) {
  if (victim?.kind !== 'crew' || state.run.roomSetup.drones[victim.member.id] !== 'shielding' || damage > DRONES.shielding.stopsUpTo) return null;
  const entry = limitedUse.limitedUseEntries(state.run).find((candidate) => candidate.key === `${victim.member.id}:Drone System`);
  return entry && !limitedUse.isUsed(state.run, entry) ? entry : null;
}

function renderCombatResult(result) {
  const victim = combatVictimOf(result);
  const badge = (scored) => `${scored.isCriticalSuccess ? ' <span class="chip ok">critical: doubled</span>' : ''}${scored.isCriticalFailure ? ' <span class="chip danger">critical failure</span>' : ''}`;
  const targetText = result.targetNumber === null ? 'every even result counts' : `evens of ${result.targetNumber}+ count`;
  const { attackerName, defenderName, outcome } = result;
  const summary = {
    hit: `${attackerName} hits ${defenderName}: ${result.attack.successes} − ${result.defense.successes} = ${outcome.damage} damage.`,
    tie: `Tied at ${result.attack.successes}: nothing happens.`,
    reflected: `${defenderName} turns the Close attack back: ${attackerName} takes ${result.defense.successes} − ${result.attack.successes} = ${outcome.damage} damage.`,
    blocked: `${defenderName} had more successes against a Ranged attack: no damage.`,
  }[outcome.kind];
  let applyHtml = '';
  if (victim && outcome.damage > 0) {
    applyHtml = result.isApplied ? `<p class="turn-last kept">${result.isShielded ? 'The Shielding Drone stopped the damage.' : 'Damage applied.'}</p>`
      : `<button class="primary" data-action="applyCombatDamage">Apply ${outcome.damage} damage to ${escapeHtml(victim.name)}</button>
        ${shieldingDroneEntryFor(victim, outcome.damage) ? `<button data-action="combatDroneShield">${escapeHtml(victim.name)}'s Shielding Drone stops it (${DRONES.shielding.stopsUpTo} or less, once per turn)</button>` : ''}`;
  }
  return `<div class="combat-result">
    <p>${escapeHtml(attackerName)} attacks: <b>${result.attack.successes}</b> success${result.attack.successes === 1 ? '' : 'es'} <small>(${targetText})</small>${badge(result.attack)}</p>
    ${renderCombatDice(result.attack)}
    <p>${escapeHtml(defenderName)} defends: <b>${result.defense.successes}</b> success${result.defense.successes === 1 ? '' : 'es'}${badge(result.defense)}</p>
    ${renderCombatDice(result.defense)}
    <p class="result">${escapeHtml(summary)}</p>${applyHtml}</div>`;
}

function renderCombat() {
  if (!ui.combat.isOpen) return '<div class="row"><button data-action="toggleCombat">⚔ Combat calculator</button></div>';
  const setup = combatSetup();
  const { attacker, defender } = setup;
  const weaponSelect = setup.attackerWeapons.length
    ? `<label class="stat"><span class="stat-label">Weapon</span><select data-bind-ui="combat.weapon" data-rerender aria-label="Weapon">${options([
      ...setup.attackerWeapons.map((name) => [name, `${name} (+${combat.weaponDiceOf(name, setup.tunedAttacker)} dice${setup.tunedAttacker.includes(name) ? ', tuned' : ''}, ${WEAPON_PROFILES[name].reach === 'close' ? 'Close only' : 'Ranged or Close'})`]),
      ['none', 'No weapon']], setup.weapon || 'none')}</select></label>` : '';
  const armorText = setup.ignoresArmor ? 'ignored' : (setup.armor && setup.armor > combat.NO_ARMOR_NUMBER ? `${setup.armor}+` : 'none');
  const targetNumber = combat.attackTargetNumber({ armor: setup.armor, reach: setup.reach, hasCover: setup.hasCover });
  const notes = [];
  if (attacker.kind === 'enemy' && attacker.enemy.combat === null) notes.push(`${attacker.name} has no Combat stat on the list: put its dice under "Extra attack dice".`);
  if (defender.kind === 'enemy' && defender.enemy.combat === null) notes.push(`${defender.name} has no Combat stat on the list: put its dice under "Extra defence dice".`);
  if (setup.ignoresArmor) notes.push('This weapon ignores armor.');
  if (setup.attacker.kind === 'crew' && !setup.mayShoot) notes.push('Ranged attacks need a weapon without the Close keyword: this one attacks within 1" only.');
  if (setup.defender.kind === 'crew') {
    if (gear.carries(setup.defender.member.equipment, 'Ablative Shields')) notes.push(`Ablative Shields: Armor ${ARMOR_ITEMS['Ablative Shields'].value} against Ranged Kinetic attacks only (${setup.isRangedKinetic ? 'counted here' : 'not counted: this attack is not one'}).`);
    if (EDGE_ARMOR[setup.defenderEdge]) notes.push(`${EDGE_ARMOR[setup.defenderEdge].item} (${setup.defenderEdge}): Armor ${EDGE_ARMOR[setup.defenderEdge].value} is counted.`);
    if (gear.carries(setup.defender.member.equipment, 'Chem-Protection Suit')) notes.push('Chem-Protection Suit: it cuts Chemical damage by 2, not combat damage.');
  }
  // tuned armor with no plain value of its own cannot be added up here
  for (const item of setup.tunedDefender.filter((name) => combat.armorValueOf(name) === null)) notes.push(`${item} is tuned for this challenge: add ${TUNINGS.armor.bonus} to its armor under Armor.`);
  if (setup.tunedDefender.some((name) => combat.armorValueOf(name) !== null)) notes.push(`Armor tuned for this challenge (+${TUNINGS.armor.bonus}) is counted.`);
  return `<section class="combat-card">
    <div class="row"><h3 class="grow">Combat (p. 20)</h3><button data-action="toggleCombat" aria-label="Close the combat calculator">✕</button></div>
    <label class="stat"><span class="stat-label">Attacker</span><select data-bind-ui="combat.attacker" data-rerender aria-label="Attacker">${renderCombatantOptions(attacker.key)}</select></label>
    ${weaponSelect}
    <label class="stat"><span class="stat-label">Defender</span><select data-bind-ui="combat.defender" data-rerender aria-label="Defender">${renderCombatantOptions(defender.key)}</select></label>
    <div class="row wrap reach-buttons">
      <button data-action="setCombatReach" data-reach="close" aria-pressed="${setup.reach === 'close'}">Close (within 1")</button>
      <button data-action="setCombatReach" data-reach="ranged" aria-pressed="${setup.reach === 'ranged'}"${setup.mayShoot && !(setup.weapon && WEAPON_PROFILES[setup.weapon].reach === 'close') ? '' : ' disabled'}>Ranged</button>
      ${setup.reach === 'ranged' ? `<label><input type="checkbox" data-bind-ui="combat.hasCover" data-rerender${ui.combat.hasCover ? ' checked' : ''}> Defender has cover</label>` : ''}
      ${setup.attackerDrone === 'targeting' && setup.reach === 'ranged' ? `<label><input type="checkbox" data-bind-ui="combat.isFar" data-rerender${ui.combat.isFar ? ' checked' : ''}> Target more than ${DRONES.targeting.beyondInches}" away (Targeting Drone +${DRONES.targeting.bonusDice})</label>` : ''}
      ${setup.attacker.kind !== 'crew' && setup.reach === 'ranged' && setup.defender.kind === 'crew' && gear.carries(setup.defender.member.equipment, 'Ablative Shields')
    ? `<label><input type="checkbox" data-bind-ui="combat.isKinetic" data-rerender${ui.combat.isKinetic ? ' checked' : ''}> Kinetic weapon</label>` : ''}
      <button data-action="swapCombatants" aria-label="Swap attacker and defender">⇄ Swap</button>
    </div>
    <div class="stats three">${stepper('Extra attack', 'extraAttackDice', ui.combat.extraAttackDice, 'stepCombat')}
      ${stepper('Extra defence', 'extraDefenseDice', ui.combat.extraDefenseDice, 'stepCombat')}
      ${stepper('Armor', 'armor', armorText, 'stepCombat')}</div>
    <p class="combat-pools">${combatPoolText('Attack', setup.attackDice, [['Combat', setup.attackBaseDice], [setup.tunedAttacker.includes(setup.weapon) ? 'weapon, tuned' : 'weapon', setup.weaponDice], ['Targeting Drone', setup.targetingDice], ['extra', ui.combat.extraAttackDice]])}
      · ${targetNumber === null ? 'every even result counts' : `evens of ${targetNumber}+ count`}${setup.hasCover ? ' <small>(cover: armor +2)</small>' : ''}<br>
      ${combatPoolText('Defence', setup.defenseDice, [['Combat', setup.defenseBaseDice], ['weapon', setup.defenseWeaponDice], ['extra', ui.combat.extraDefenseDice]])}</p>
    ${notes.map((note) => `<p class="hint">${escapeHtml(note)}</p>`).join('')}
    <div class="row wrap"><button class="primary" data-action="combatRoll">Roll both</button>
      <button data-action="toggleOwnDice" aria-pressed="${ui.combat.isOwnDice}">I rolled my own dice</button></div>
    ${ui.combat.isOwnDice ? `<div class="enemy-add"><input type="text" inputmode="numeric" placeholder="Attack: 2 5 6 10" aria-label="Attack dice you rolled" data-bind-ui="combat.ownAttackDice" value="${escapeHtml(ui.combat.ownAttackDice)}">
      <input type="text" inputmode="numeric" placeholder="Defence: 3 8 12" aria-label="Defence dice you rolled" data-bind-ui="combat.ownDefenseDice" value="${escapeHtml(ui.combat.ownDefenseDice)}">
      <button class="primary" data-action="combatScoreOwnDice">Score them</button></div>` : ''}
    ${ui.combat.result ? renderCombatResult(ui.combat.result) : ''}
  </section>`;
}

function runCombat(typedFaces) {
  const setup = combatSetup();
  const attackFaces = typedFaces?.attack ?? rollDice(setup.attackDice);
  const defenseFaces = typedFaces?.defense ?? rollDice(setup.defenseDice);
  if (attackFaces.length === 0) throw new Error('The attacker has no dice: add some under "Extra attack dice".');
  if (defenseFaces.length === 0) throw new Error('The defender has no dice: add some under "Extra defence dice".');
  ui.combat.result = {
    ...combat.resolveAttack({ attackFaces, defenseFaces, armor: setup.armor, reach: setup.reach, hasCover: setup.hasCover }),
    attackerKey: setup.attacker.key, defenderKey: setup.defender.key, attackerName: setup.attacker.name, defenderName: setup.defender.name, isApplied: false,
  };
}

// the damage of the shown result goes to whoever it hurt: an enemy on the list loses Life, a crew member takes damage
// (and is marked out of action in the turn tracker at 0 Life)
function applyCombatDamage() {
  const { result } = ui.combat;
  if (!result || result.isApplied || !result.outcome.victim) return;
  const victim = combatVictimOf(result);
  if (!victim) throw new Error('That one is no longer in the room: change the damage by hand.');
  const { damage } = result.outcome;
  if (victim.kind === 'enemy') {
    enemyLogic.changeLife(state.run.roomSetup.enemies, victim.enemy.id, -damage);
    ui.noticeMessage = enemyLogic.isOutOfAction(victim.enemy) ? `${victim.name} is out of action.` : `${victim.name} has ${enemyLogic.lifeLeft(victim.enemy)} Life left.`;
  } else {
    const { member } = victim;
    const lifeStat = effectiveStatOf(member, 'lf');
    member.damage = Math.min(lifeStat, member.damage + damage);
    const lifeLeft = lifeStat - member.damage;
    const turns = state.run.roomSetup.turns;
    if (lifeLeft === 0 && !turns.outIds.includes(member.id)) turnLogic.toggleOut(turns, member.id, turnSides());
    ui.noticeMessage = lifeLeft === 0 ? `${victim.name} is out of action (marked ✕ in the turn tracker).` : `${victim.name} has ${lifeLeft} Life left.`;
  }
  result.isApplied = true;
}

// ---------- shell ----------

// everything on screen that belonged to the previous playthrough (or to the save that was just replaced)
function resetViewForOtherPlaythrough() {
  Object.assign(ui, { tab: 'journey', combat: blankCombat(), medPatchTarget: {}, postGame: null, exitRoll: '', mapSelected: null, confirmKey: null, boardInfo: null, boardFocus: null,
    isLoreOpen: true, isPlaythroughMenuOpen: false, isAddingCrew: false, newPlaythroughName: '', versusDraft: blankVersusDraft() });
  roomTheViewBelongsTo = null;   // the next render clears what belonged to the old room, whatever its number
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

// What the room card shows belongs to one room, so a new room starts clean: the board's info line and lit-up kind could name things
// from the last room, and enemy ids (e1, e2 ...) start again in every room, so a combat result, a combatant or a half-typed enemy
// left over would point at the wrong one. The combat calculator stays open if it was.
let roomTheViewBelongsTo = null;

function resetViewWhenRoomChanged() {
  const room = state?.run?.currentChallenge ?? null;
  if (room !== roomTheViewBelongsTo) {
    roomTheViewBelongsTo = room;
    Object.assign(ui, {
      boardInfo: null, boardFocus: null, isLoreOpen: true,
      combat: { ...blankCombat(), isOpen: ui.combat.isOpen }, isAddingEnemy: false, enemyDraft: { name: '', life: '', combat: '' },
      testRoll: { ...ui.testRoll, rolled: null },
    });
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
  resetViewWhenRoomChanged();
  const views = { journey: renderJourney, crew: renderCrew, log: renderLog, dice: renderDice, versus: renderVersus, settings: renderSettings };
  appElement.innerHTML = `<header><img src="icons/icon.svg" alt="" width="48" height="48"><div><h1>Captain's Log</h1><span>Space Station Zero</span></div>
      ${navigator.onLine ? '' : '<span class="offline-chip" title="No connection: everything still works, saved here, and syncing waits">offline</span>'}
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
  markWhatIsNew();
}

// Animations. The page is rebuilt on every click, so a plain CSS animation would replay each time: only an element that was not
// there (or not in this state) before the click gets the class `is-new`, and css/style.css animates that. A change of view
// (another tab, another room, the set-up to the room) fades the whole view in instead, without marking every piece of it.
const ANIMATED_SELECTORS = ['.turn-roll', '.turn-last', '.turn-head h3', '.initiative', '.turn-chip', '.limited-chip', '.enemy-row', '.enemy-life', '.pip',
  '.dice', '.combat-result', '.prepared', '.error', '.notice', '.advancement'];
let animationKeysOfLastRender = null;
let viewOfLastRender = null;

function markWhatIsNew() {
  const view = `${ui.tab}|${state?.run?.currentChallenge ?? ''}|${state?.run?.roomSetup.isMissionStarted ?? ''}|${Boolean(ui.postGame)}`;
  const keys = new Set();
  const isSameView = view === viewOfLastRender && animationKeysOfLastRender !== null;
  for (const selector of ANIMATED_SELECTORS) {
    appElement.querySelectorAll(selector).forEach((element, index) => {
      const key = `${selector}|${index}|${element.className}|${element.textContent}`;
      keys.add(key);
      if (isSameView && !animationKeysOfLastRender.has(key)) element.classList.add('is-new');
    });
  }
  if (!isSameView && viewOfLastRender !== null) appElement.querySelector('main')?.classList.add('view-enter');
  animationKeysOfLastRender = keys;
  viewOfLastRender = view;
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
  // the turn tracker (js/turns.js)
  turnToggleDone: ({ id }) => { turnLogic.toggleDone(state.run.roomSetup.turns, id, turnSides()); },
  turnToggleOut: ({ id }) => { turnLogic.toggleOut(state.run.roomSetup.turns, id, turnSides()); },
  turnEnemyDone: ({ id }) => { turnLogic.toggleEnemyDone(state.run.roomSetup.turns, id, turnSides()); },
  turnEnemyPlus: () => { turnLogic.changeEnemyActivations(state.run.roomSetup.turns, 1, turnSides()); },
  turnEnemyMinus: () => { turnLogic.changeEnemyActivations(state.run.roomSetup.turns, -1, turnSides()); },
  turnEnemiesDone: () => { const turns = state.run.roomSetup.turns; turnLogic.setEnemiesDone(turns, !turns.enemiesDone, turnSides()); },
  turnRoll: () => {
    const turns = state.run.roomSetup.turns;
    const roll = rollD12();
    turnLogic.resolveRoll(turns, { kept: roll >= turnLogic.rollNeeded(turns), roll }, turnSides());
  },
  turnKept: () => { turnLogic.resolveRoll(state.run.roomSetup.turns, { kept: true }, turnSides()); },
  turnLost: () => { turnLogic.resolveRoll(state.run.roomSetup.turns, { kept: false }, turnSides()); },
  // the room's enemies (js/enemies.js): changing who is standing can finish the enemies' side of the turn
  enemyLife: ({ id, change }) => { enemyLogic.changeLife(state.run.roomSetup.enemies, id, Number(change)); },
  enemyPip: ({ id, pip }) => { enemyLogic.setLifeFromPip(state.run.roomSetup.enemies, id, Number(pip)); },
  fillEnemies: () => {
    const { enemies } = enemyLogic.startingEnemies(roomLayoutFor(roomLayouts, state.run.currentChallenge), participatingCrewCount());
    if (enemies.length === 0) throw new Error('This room\'s briefing does not list enemies with a number and a Life stat: add them by hand.');
    replaceEnemies(enemies);
  },
  addEnemyGroup: ({ index }) => {
    const group = enemyLogic.enemyGroups(roomLayoutFor(roomLayouts, state.run.currentChallenge), participatingCrewCount()).find((candidate) => candidate.index === Number(index));
    enemyLogic.addGroups(state.run.roomSetup.enemies, [group]);
  },
  // preparation (js/preparation.js) and once-per-X abilities (js/limited-use.js)
  setTuning: ({ kind, tuner, value }) => {
    const [carrierId, item] = value === '' ? [] : value.split('|');
    preparation.setTuning(state.run.roomSetup.tunings, kind, tuner, value === '' ? null : { carrierId, item });
  },
  toggleLimitedUse: ({ key }) => { limitedUse.toggleUsed(state.run, key); },
  toggleStimShot: ({ id }) => {
    if (state.run.roomSetup.stimmed.includes(id)) store.takeStimShotBack(state.run, id);
    else store.useStimShot(state.run, id);
  },
  setDrone: ({ member, value }) => {
    const { drones } = state.run.roomSetup;
    if (value === '') delete drones[member];
    else if (value in DRONES) drones[member] = value;
    else throw new Error('Unknown drone.');
  },
  useMedPatch: ({ carrier }) => {
    const { target, healed } = store.useMedPatch(state.run, carrier, medPatchTargetFor(carrier));
    ui.noticeMessage = `${target.name} gets back ${healed} Life.`;
  },
  // the combat calculator (js/combat.js)
  toggleCombat: () => { ui.combat.isOpen = !ui.combat.isOpen; },
  setCombatReach: ({ reach }) => { ui.combat.reach = reach; ui.combat.result = null; },
  toggleOwnDice: () => { ui.combat.isOwnDice = !ui.combat.isOwnDice; },
  swapCombatants: () => {
    const { attacker, defender } = combatSetup();
    Object.assign(ui.combat, { attacker: defender.key, defender: attacker.key, weapon: '', armor: '', extraAttackDice: ui.combat.extraDefenseDice, extraDefenseDice: ui.combat.extraAttackDice, result: null });
  },
  stepCombat: ({ path, delta }) => {
    if (path === 'armor') {
      const setup = combatSetup();
      Object.assign(ui.combat, { armor: Math.min(12, Math.max(0, (setup.armor ?? 0) + Number(delta))), armorFor: setup.defender.key });
    } else {
      ui.combat[path] = Math.min(20, Math.max(0, ui.combat[path] + Number(delta)));
    }
  },
  combatRoll: () => { runCombat(null); },
  combatScoreOwnDice: () => { runCombat({ attack: combat.parseFaces(ui.combat.ownAttackDice), defense: combat.parseFaces(ui.combat.ownDefenseDice) }); },
  applyCombatDamage: () => { applyCombatDamage(); },
  combatDroneShield: () => {
    const { result } = ui.combat;
    if (!result || result.isApplied) return;
    const victim = combatVictimOf(result);
    const entry = shieldingDroneEntryFor(victim, result.outcome.damage);
    if (!entry) throw new Error('The Shielding Drone cannot step in: it was used this turn, or the damage is too high.');
    limitedUse.toggleUsed(state.run, entry.key);
    Object.assign(result, { isApplied: true, isShielded: true });
    ui.noticeMessage = `${victim.name}'s Shielding Drone stops the damage.`;
  },
  stepTest: ({ path, delta }) => { ui.testRoll[path] = Math.min(20, Math.max(0, ui.testRoll[path] + Number(delta))); },
  rollTest: () => {
    const draft = ui.testRoll;
    const members = crewMembersInRoom();
    const member = members.find((candidate) => candidate.id === draft.member) ?? members[0];
    const pool = gear.testPool(member, draft.test, { isStimmed: isStimmed(member) });
    const target = draft.target === '' ? (pool.kind.defaultTarget ?? 0) : Number(draft.target);
    const count = pool.total + draft.extra + (pool.hasExtraDie ? 1 : 0);
    if (count < 1) throw new Error('No dice to roll: add some under "Extra dice".');
    const faces = rollDice(count);
    // the Heads-Up Display rolls one die more and discards one of the player's choice: the app discards the worst
    const discarded = pool.hasExtraDie ? gear.discardedIndex(faces, target) : null;
    draft.rolled = { faces, discarded, kept: faces.filter((_, index) => index !== discarded), target, needed: draft.needed, name: member.name, testLabel: pool.kind.label };
  },
  startAddEnemy: () => { ui.isAddingEnemy = true; },
  cancelAddEnemy: () => { Object.assign(ui, { isAddingEnemy: false, enemyDraft: { name: '', life: '', combat: '' } }); },
  addEnemyByHand: () => {
    enemyLogic.addEnemyByHand(state.run.roomSetup.enemies, { name: ui.enemyDraft.name, life: ui.enemyDraft.life, combat: ui.enemyDraft.combat });
    Object.assign(ui, { isAddingEnemy: false, enemyDraft: { name: '', life: '', combat: '' } });
  },
  clearEnemies: () => { replaceEnemies([]); },
  turnNext: () => { turnLogic.nextTurn(state.run.roomSetup.turns, turnSides()); },
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
  removeMember: ({ crew, index }) => { store.removeMember(state.run, Number(crew), Number(index)); },
  takeAdvancement: ({ crew, index, stat }) => { store.takeAdvancement(state.run.crews[Number(crew)].members[Number(index)], stat); },

  // everyone put out of action in this room is ticked already: marked ✕ in the turn tracker, or at 0 Life (the combat calculator marks both)
  openPostGame: () => {
    const { turns } = state.run.roomSetup;
    const downed = {};
    for (const member of store.allMembers(state.run)) {
      const isDown = turns.outIds.includes(member.id) || (effectiveStatOf(member, 'lf') > 0 && member.damage >= effectiveStatOf(member, 'lf'));
      if (member.status === 'active' && isDown) downed[member.id] = { roll: '', stat: 'lf', deadQuestion: '' };
    }
    ui.postGame = { downed, bonusXp: {}, agendaPartFoundByCrew: {}, legacyEarned: false, note: '', rerollsUsed: 0 };
  },
  cancelPostGame: () => { ui.postGame = null; },
  toggleDowned: ({ id }) => {
    if (ui.postGame.downed[id]) delete ui.postGame.downed[id];
    else ui.postGame.downed[id] = { roll: '', stat: 'lf', deadQuestion: '' };
  },
  rollInjury: ({ id }) => { ui.postGame.downed[id].roll = rollTwoD12(); },
  rerollInjury: ({ id }) => {
    Object.assign(ui.postGame.downed[id], { roll: rollTwoD12(), isRerolled: true });
    ui.postGame.rerollsUsed += 1;
  },
  // one roll for each ticked crew member who has none yet (a roll already typed or made stays)
  rollAllInjuries: () => {
    for (const entry of Object.values(ui.postGame.downed)) if (entry.roll === '') entry.roll = rollTwoD12();
  },
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
  beginChallenge: () => {
    state.run.roomSetup.isMissionStarted = true;
    // the list from the briefing, when the private room text is loaded (otherwise by hand, see renderEnemyListTools);
    // going back to the set-up and in again keeps the list, and the damage on it
    if (state.run.roomSetup.enemies.length === 0) {
      replaceEnemies(enemyLogic.startingEnemies(roomLayoutFor(roomLayouts, state.run.currentChallenge), participatingCrewCount()).enemies);
    }
  },
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
    if (!unreadableSaveMessage) settleAndSave();
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
  if (element.dataset.inputAction) {
    actions[element.dataset.inputAction]({ ...element.dataset, value: element.value });
    settleAndSave();
    render();
    return;
  }
  const statePath = element.dataset.bind;
  const uiPath = element.dataset.bindUi;
  if (element.dataset.appendTo && element.value) {
    const path = element.dataset.appendTo;
    setAtPath(state, path, [getAtPath(state, path), element.value].filter(Boolean).join('\n'));
    settleAndSave();
    render();
    return;
  }
  if (!statePath && !uiPath) return;
  let value = element.type === 'checkbox' ? element.checked : element.value;
  if ((element.type === 'number' || 'number' in element.dataset) && value !== '') value = Number(value);
  if (statePath) {
    setAtPath(state, statePath, value);
    if (state.run) store.recordDeathLocations(state.run);
    settleAndSave();
  } else {
    setAtPath(ui, uiPath, value);
  }
  if (element.dataset.outcomeElement) {
    const outcome = injuryOutcomeForRoll(value);
    document.getElementById(element.dataset.outcomeElement).textContent = outcome?.label ?? '';
    document.getElementById(element.dataset.deadQuestionElement).hidden = outcome?.key !== 'hidden';
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
// offline use (sw.js keeps the app's own files): say when there is no connection, and start syncing again when it is back
window.addEventListener('offline', () => { if (!isTypingInAField()) render(); });
window.addEventListener('online', () => { if (!isTypingInAField()) render(); });
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((error) => console.error(`Offline use is off: the service worker could not start (${error.message}).`));
}
render();
if (!unreadableSaveMessage) cloud.syncNow({ force: true }).then(useSyncedData).then(pullPrivateFilesFromDatabase).catch(() => { /* optional: the sync card shows the real errors */ });
