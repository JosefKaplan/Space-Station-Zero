// Station map: an SVG drawn from what crews have actually seen. No DOM, no user text — numbers and shapes only.
// Layout coordinates live with the campaign graph in data.js (`map` per challenge, `via` per exit).
import { CHALLENGES } from './data.js';
import { visitedChallenges } from './state.js';

const CELL_WIDTH = 72;
const CELL_HEIGHT = 84;
const MAP_COLUMNS = 5;
const ROOM_HALF_SIZE = 22;
const STUB_LENGTH = 46;
const MAX_DEATH_MARKS_DRAWN = 3;

function toPixels([column, row]) {
  return { x: CELL_WIDTH / 2 + column * CELL_WIDTH, y: CELL_HEIGHT / 2 + row * CELL_HEIGHT };
}

function exitDefinition(from, to) {
  const challenge = CHALLENGES[from];
  return (challenge.exits ?? challenge.exitRoll ?? []).find((exit) => exit.to === to) ?? null;
}

// grid points of the corridor between two rooms, or null when no door joins them (a long backtrack)
function corridorGridPoints(from, to) {
  const forward = exitDefinition(from, to);
  if (forward) return [CHALLENGES[from].map, ...(forward.via ?? []), CHALLENGES[to].map];
  const backward = exitDefinition(to, from);
  if (backward) return [CHALLENGES[from].map, ...[...(backward.via ?? [])].reverse(), CHALLENGES[to].map];
  return null;
}

function svgPath(gridPoints) {
  return gridPoints.map(toPixels).map(({ x, y }, index) => `${index ? 'L' : 'M'}${x} ${y}`).join('');
}

function routeSegments(route) {
  return route.slice(1).map((to, index) => corridorGridPoints(route[index], to)).filter(Boolean);
}

export function fallenByChallenge(state) {
  const fallen = {};
  const add = (challenge, entry) => { if (challenge) (fallen[challenge] ??= []).push(entry); };
  for (const crew of state.station.pastCrews) {
    for (const { name, challenge } of crew.fallen) add(challenge, { name, crewName: crew.name, isCurrentCrew: false });
  }
  for (const crew of state.run?.crews ?? []) {
    for (const member of crew.members) {
      if (member.status === 'dead') add(member.diedInChallenge, { name: member.name, crewName: crew.name, isCurrentCrew: true });
    }
  }
  return fallen;
}

// rooms any crew has stood in: the current one's are lit, earlier crews' are ghosts
export function knownChallenges(state) {
  const current = state.run ? visitedChallenges(state.run) : [];
  const ghosts = state.station.pastCrews.flatMap((crew) => crew.route).filter((number) => !current.includes(number));
  return { current, ghosts: [...new Set(ghosts)] };
}

function deathMarks(entries, x, y, cssClass) {
  if (!entries.length) return '';
  const drawn = Math.min(entries.length, MAX_DEATH_MARKS_DRAWN);
  const crosses = Array.from({ length: drawn }, (_, index) => {
    const left = x + index * 11;
    return `<path d="M${left - 4} ${y - 4}l8 8m0 -8l-8 8"/>`;
  }).join('');
  const overflow = entries.length > drawn ? `<text x="${x + drawn * 11}" y="${y + 4}">+${entries.length - drawn}</text>` : '';
  return `<g class="${cssClass}">${crosses}${overflow}</g>`;
}

export function renderStationMapSvg(state, selectedChallenge) {
  const run = state.run;
  const { current, ghosts } = knownChallenges(state);
  const known = [...current, ...ghosts];
  if (!known.length) return '';

  const ghostSegments = state.station.pastCrews.flatMap((crew) => routeSegments(crew.route));
  const currentSegments = run ? routeSegments(run.route) : [];

  // corridors: every door a crew walked through, plus doors of searched rooms; doors to the unknown are stubs
  const corridors = new Map();
  const stubs = [];
  const addCorridor = (gridPoints) => corridors.set(svgPath(gridPoints), gridPoints);
  [...ghostSegments, ...currentSegments].forEach(addCorridor);
  for (const number of run?.cleared ?? []) {
    for (const exit of CHALLENGES[number].exits ?? []) {
      const gridPoints = corridorGridPoints(number, exit.to);
      if (known.includes(exit.to)) addCorridor(gridPoints);
      else stubs.push(gridPoints);
    }
  }

  const drawnRows = [...known.map((number) => CHALLENGES[number].map), ...[...corridors.values()].flat()].map(([, row]) => row);
  const top = (Math.min(...drawnRows) - 0.25) * CELL_HEIGHT;
  const bottom = (Math.max(...drawnRows) + 1.3) * CELL_HEIGHT;
  const width = MAP_COLUMNS * CELL_WIDTH;

  const corridorsSvg = [...corridors.keys()].map((d) => `<path class="corridor-wall" d="${d}"/><path class="corridor-floor" d="${d}"/>`).join('');
  const stubsSvg = stubs.map((gridPoints) => {
    const start = toPixels(gridPoints[0]);
    const towards = toPixels(gridPoints[1]);
    const distance = Math.hypot(towards.x - start.x, towards.y - start.y);
    const end = { x: start.x + (towards.x - start.x) / distance * STUB_LENGTH, y: start.y + (towards.y - start.y) / distance * STUB_LENGTH };
    return `<path class="corridor-wall" d="M${start.x} ${start.y}L${end.x} ${end.y}"/><path class="corridor-floor unknown" d="M${start.x} ${start.y}L${end.x} ${end.y}"/>
      <circle class="unknown-door" cx="${end.x}" cy="${end.y}" r="9"/><text class="unknown-door-label" x="${end.x}" y="${end.y + 4}">?</text>`;
  }).join('');
  const ghostRoutesSvg = ghostSegments.map((gridPoints) => `<path class="ghost-route" d="${svgPath(gridPoints)}"/>`).join('');
  const routeSvg = currentSegments.map((gridPoints) => `<path class="route" d="${svgPath(gridPoints)}"/>`).join('');

  // a cleared No Return room drops a bulkhead behind the crew
  const bulkheadsSvg = (run?.sealed ?? []).filter((number) => CHALLENGES[number].noReturn).map((number) => {
    const y = toPixels(CHALLENGES[number].map).y + CELL_HEIGHT * 0.42;
    return `<path class="bulkhead" d="M8 ${y}H${width - 8}"/><text class="bulkhead-label" x="12" y="${y - 6}">SEALED ▲</text>`;
  }).join('');

  const fallen = fallenByChallenge(state);
  const roomsSvg = known.map((number) => {
    const { x, y } = toPixels(CHALLENGES[number].map);
    const isGhost = ghosts.includes(number);
    const classes = ['room',
      isGhost ? 'ghost' : '',
      run && number === run.currentChallenge ? 'here' : '',
      run?.sealed.includes(number) ? 'sealed' : '',
      number === selectedChallenge ? 'selected' : ''].filter(Boolean).join(' ');
    const fallenHere = fallen[number] ?? [];
    return `<g class="${classes}" data-action="selectMapRoom" data-number="${number}" role="button" aria-label="Challenge ${number}">
      <rect class="tap-area" x="${x - 34}" y="${y - 34}" width="68" height="68"/>
      <rect class="room-shadow" x="${x - ROOM_HALF_SIZE + 4}" y="${y - ROOM_HALF_SIZE + 4}" width="${ROOM_HALF_SIZE * 2}" height="${ROOM_HALF_SIZE * 2}" rx="5"/>
      <rect class="room-box" x="${x - ROOM_HALF_SIZE}" y="${y - ROOM_HALF_SIZE}" width="${ROOM_HALF_SIZE * 2}" height="${ROOM_HALF_SIZE * 2}" rx="5"/>
      <text class="room-number" x="${x}" y="${y + 8}">${number}</text>
      ${deathMarks(fallenHere.filter((entry) => entry.isCurrentCrew), x - ROOM_HALF_SIZE + 2, y - ROOM_HALF_SIZE - 2, 'death-marks')}
      ${deathMarks(fallenHere.filter((entry) => !entry.isCurrentCrew), x - ROOM_HALF_SIZE + 2, y + ROOM_HALF_SIZE + 4, 'death-marks old')}
    </g>`;
  }).join('');

  return `<svg class="station-map" viewBox="0 ${top} ${width} ${bottom - top}" role="img" aria-label="Station map">
    <defs>
      <pattern id="map-tiles" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" class="map-tile"/></pattern>
      <filter id="spray-paint" x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="7" result="noise"/>
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="5"/>
      </filter>
    </defs>
    <rect x="0" y="${top}" width="${width}" height="${bottom - top}" fill="url(#map-tiles)"/>
    ${corridorsSvg}${stubsSvg}
    <g filter="url(#spray-paint)">${ghostRoutesSvg}${routeSvg}</g>
    ${bulkheadsSvg}${roomsSvg}
  </svg>`;
}
