// Each room's own footprint on the board: fixed terrain, enemy starting areas, objective and drop-point markers,
// the crew's starting zone, plus a short briefing.
// The footprints are public (data/room-footprints.json, the owner's decision: CLAUDE.md, hard rule 1). The briefing and
// the book's own text come from the owner's private file local/room-layouts.json (gitignored), loaded by itself where the
// app is served from the project folder and merged over the footprints. Both are kept in this browser's localStorage.
// All numbers are inches on the board as the book prints it (30" across, 22" deep), measured from its top-left corner.
import { BOARD_HEIGHT_INCHES, BOARD_WIDTH_INCHES, CHALLENGES } from './data.js';

const ROOM_LAYOUTS_STORAGE_KEY = 'ssz-room-layouts';
const ROOM_LAYOUTS_SCHEMA_VERSION = 2;

function expect(isOk, whereInFile, problem) {
  if (!isOk) throw new Error(`${whereInFile}: ${problem}`);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateRectangle(rectangle, whereInFile) {
  expect(isPlainObject(rectangle), whereInFile, 'expected { x, y, width, height }');
  for (const key of ['x', 'y', 'width', 'height']) expect(Number.isFinite(rectangle[key]), whereInFile, `"${key}" must be a number`);
  expect(rectangle.width > 0 && rectangle.height > 0, whereInFile, 'width and height must be above 0');
  expect(rectangle.x >= 0 && rectangle.x + rectangle.width <= BOARD_WIDTH_INCHES, whereInFile, `sticks out of the ${BOARD_WIDTH_INCHES}" board width`);
  expect(rectangle.y >= 0 && rectangle.y + rectangle.height <= BOARD_HEIGHT_INCHES, whereInFile, `sticks out of the ${BOARD_HEIGHT_INCHES}" board length`);
  expect(rectangle.label === undefined || typeof rectangle.label === 'string', whereInFile, '"label" must be text');
}

// a marker is a point (objective, drop point); with a diameter it is a circle centred on the point
function validateMarker(marker, whereInFile) {
  expect(isPlainObject(marker), whereInFile, 'expected { x, y, label }');
  expect(Number.isFinite(marker.x) && marker.x >= 0 && marker.x <= BOARD_WIDTH_INCHES, whereInFile, '"x" must be a number on the board');
  expect(Number.isFinite(marker.y) && marker.y >= 0 && marker.y <= BOARD_HEIGHT_INCHES, whereInFile, '"y" must be a number on the board');
  expect(typeof marker.label === 'string' && marker.label !== '', whereInFile, '"label" must be text');
  expect(marker.diameter === undefined || (Number.isFinite(marker.diameter) && marker.diameter > 0), whereInFile, '"diameter" must be a number above 0');
}

const FIXED_TERRAIN_LOOKS = ['black', 'gray', 'hatched'];

function validateOptionalText(value, whereInFile) {
  expect(value === undefined || (typeof value === 'string' && value !== ''), whereInFile, 'must be text');
}

const STAT_KEYS = ['lf', 'mv', 'co', 're', 'in'];

function validateStatBar(stat, whereInFile) {
  expect(isPlainObject(stat) && typeof stat.name === 'string' && stat.name !== '', whereInFile, 'expected { name, lf, mv, co, re, in }');
  for (const key of STAT_KEYS) expect(Number.isInteger(stat[key]) && stat[key] >= 0, whereInFile, `"${key}" must be a whole number`);
  validateOptionalText(stat.armor, `${whereInFile}.armor`);
}

function validateRulesSection(section, whereInFile) {
  expect(isPlainObject(section) && typeof section.title === 'string' && Array.isArray(section.blocks), whereInFile, 'expected { title, blocks }');
  section.blocks.forEach((block, index) => {
    const where = `${whereInFile}.blocks[${index}]`;
    expect(isPlainObject(block) && ['p', 'li', 'table'].includes(block.t), where, '"t" must be p, li or table');
    if (block.t === 'table') {
      expect(Array.isArray(block.rows) && block.rows.every((row) => Array.isArray(row) && row.every((cell) => typeof cell === 'string')), where, '"rows" must be lists of text');
    } else {
      expect(typeof block.x === 'string' && block.x !== '', where, '"x" must be text');
    }
  });
}

function validateEnemy(enemy, whereInFile) {
  expect(isPlainObject(enemy), whereInFile, 'expected { name, count, where }');
  for (const key of ['name', 'count', 'where']) expect(typeof enemy[key] === 'string' && enemy[key] !== '', whereInFile, `"${key}" must be text`);
  validateOptionalText(enemy.when, `${whereInFile}.when`);
  expect(enemy.perCrew === undefined || (Number.isInteger(enemy.perCrew) && enemy.perCrew > 0), whereInFile, '"perCrew" must be a whole number above 0');
  expect(enemy.areas === undefined || (Array.isArray(enemy.areas) && enemy.areas.length > 0 && enemy.areas.every((area) => typeof area === 'string')), whereInFile, '"areas" must be a list of area labels');
  expect(enemy.areas === undefined || enemy.perCrew !== undefined, whereInFile, '"areas" needs "perCrew", the number to split between them');
  expect(enemy.hidden === undefined || typeof enemy.hidden === 'boolean', whereInFile, '"hidden" must be true or false');
}

function parseRoomLayouts(fileText) {
  let layouts;
  try {
    layouts = JSON.parse(fileText);
  } catch {
    throw new Error('that is not a JSON file.');
  }
  expect(isPlainObject(layouts), 'file', 'expected an object');
  expect(layouts.schemaVersion === ROOM_LAYOUTS_SCHEMA_VERSION, 'schemaVersion', `must be ${ROOM_LAYOUTS_SCHEMA_VERSION}`);
  expect(isPlainObject(layouts.rooms), 'rooms', 'expected an object keyed by challenge number');
  for (const [challengeNumber, room] of Object.entries(layouts.rooms)) {
    const whereInFile = `rooms.${challengeNumber}`;
    expect(Object.hasOwn(CHALLENGES, challengeNumber), whereInFile, 'no such challenge');
    expect(isPlainObject(room), whereInFile, 'expected an object');
    const fixedTerrain = room.fixedTerrain ?? [];
    const enemyAreas = room.enemyAreas ?? [];
    const markers = room.markers ?? [];
    expect(Array.isArray(fixedTerrain), `${whereInFile}.fixedTerrain`, 'expected a list');
    expect(Array.isArray(enemyAreas), `${whereInFile}.enemyAreas`, 'expected a list');
    expect(Array.isArray(markers), `${whereInFile}.markers`, 'expected a list');
    expect(room.note === undefined || typeof room.note === 'string', `${whereInFile}.note`, 'must be text');
    fixedTerrain.forEach((piece, index) => {
      validateRectangle(piece, `${whereInFile}.fixedTerrain[${index}]`);
      expect(piece.look === undefined || FIXED_TERRAIN_LOOKS.includes(piece.look), `${whereInFile}.fixedTerrain[${index}]`, `"look" must be one of ${FIXED_TERRAIN_LOOKS.join(', ')}`);
    });
    enemyAreas.forEach((area, index) => validateRectangle(area, `${whereInFile}.enemyAreas[${index}]`));
    markers.forEach((marker, index) => validateMarker(marker, `${whereInFile}.markers[${index}]`));
    if (room.crewZone !== undefined) validateRectangle(room.crewZone, `${whereInFile}.crewZone`);
    // the briefing: what is in the room
    const enemies = room.enemies ?? [];
    const hazards = room.hazards ?? [];
    expect(Array.isArray(enemies), `${whereInFile}.enemies`, 'expected a list');
    expect(Array.isArray(hazards), `${whereInFile}.hazards`, 'expected a list');
    enemies.forEach((enemy, index) => {
      validateEnemy(enemy, `${whereInFile}.enemies[${index}]`);
      for (const area of enemy.areas ?? []) {
        expect(enemyAreas.some((enemyArea) => enemyArea.label === area), `${whereInFile}.enemies[${index}]`, `area "${area}" is not one of the enemyAreas labels`);
      }
    });
    hazards.forEach((hazard, index) => expect(typeof hazard === 'string' && hazard !== '', `${whereInFile}.hazards[${index}]`, 'must be text'));
    for (const key of ['enemyNote', 'crewNote', 'deadline', 'goal']) validateOptionalText(room[key], `${whereInFile}.${key}`);
    // the book's own text for the room: lore, rules sections, enemy stat bars
    validateOptionalText(room.lore, `${whereInFile}.lore`);
    expect(room.rules === undefined || Array.isArray(room.rules), `${whereInFile}.rules`, 'expected a list');
    expect(room.stats === undefined || Array.isArray(room.stats), `${whereInFile}.stats`, 'expected a list');
    (room.rules ?? []).forEach((section, index) => validateRulesSection(section, `${whereInFile}.rules[${index}]`));
    (room.stats ?? []).forEach((stat, index) => validateStatBar(stat, `${whereInFile}.stats[${index}]`));
  }
  return layouts;
}

export function saveRoomLayouts(layouts) {
  localStorage.setItem(ROOM_LAYOUTS_STORAGE_KEY, JSON.stringify(layouts));
}

// null when nothing was imported; a stored file that no longer validates is an error, not a silent "none"
export function loadRoomLayouts() {
  const storedText = localStorage.getItem(ROOM_LAYOUTS_STORAGE_KEY);
  return storedText === null ? null : parseRoomLayouts(storedText);
}

const PUBLIC_FOOTPRINTS_FILE_PATH = 'data/room-footprints.json';
const PRIVATE_ROOM_LAYOUTS_FILE_PATH = 'local/room-layouts.json';

// null when the file is not there (a normal case for the private one); a file that is there but bad is an error naming it
async function fetchRoomLayoutsFile(path) {
  let response;
  try {
    response = await fetch(path, { cache: 'no-cache' });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  try {
    return parseRoomLayouts(await response.text());
  } catch (error) {
    throw new Error(`${path} is not valid, nothing was loaded: ${error.message}`);
  }
}

// the public footprints, with each room's private briefing and book text added when the private file is there
export async function fetchRoomLayouts() {
  const [publicLayouts, privateLayouts] = await Promise.all([fetchRoomLayoutsFile(PUBLIC_FOOTPRINTS_FILE_PATH), fetchRoomLayoutsFile(PRIVATE_ROOM_LAYOUTS_FILE_PATH)]);
  if (!publicLayouts) return privateLayouts;
  if (!privateLayouts) return publicLayouts;
  const rooms = { ...publicLayouts.rooms };
  for (const [number, privateRoom] of Object.entries(privateLayouts.rooms)) rooms[number] = { ...rooms[number], ...privateRoom };
  return { ...publicLayouts, rooms };
}

export function roomLayoutFor(layouts, challengeNumber) {
  return layouts && Object.hasOwn(layouts.rooms, challengeNumber) ? layouts.rooms[challengeNumber] : null;
}

// General terrain stays 2" from other terrain and from objectives (p. 43). Fixed terrain counts as it is;
// a circular marker counts as the square around it, a little stricter than a circle and simpler to check.
// Markers without a diameter are drop points, not objectives, so they do not count.
// The crew's zone and the enemy areas are kept free too, so the models can be set up in them (no overlap, touching is
// fine), but only as long as that leaves room for every piece.
export function obstaclesForRandomTerrain(roomLayout) {
  const circularMarkers = (roomLayout.markers ?? []).filter((marker) => marker.diameter !== undefined).map((marker) => ({
    x: marker.x - marker.diameter / 2, y: marker.y - marker.diameter / 2, width: marker.diameter, height: marker.diameter,
  }));
  const zones = [roomLayout.crewZone, ...(roomLayout.enemyAreas ?? [])].filter(Boolean);
  const zonesToKeepFree = zones.map((zone) => ({ ...zone, minGap: 0, soft: true }));
  // the middle of a zone holds its label and captions on the sketch: never covered, even as a last resort
  const labelBoxes = zones.map((zone) => ({
    x: zone.x + zone.width * 0.1, y: zone.y + zone.height * 0.2, width: zone.width * 0.8, height: zone.height * 0.6, minGap: 0 }));
  return [...(roomLayout.fixedTerrain ?? []), ...circularMarkers, ...zonesToKeepFree, ...labelBoxes];
}
