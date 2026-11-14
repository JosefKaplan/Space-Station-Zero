// General terrain for the room about to be played (p. 43–44): one roll per board quadrant, then a sketch of where
// the pieces could go, drawn over the room's own footprint (fixed terrain, enemy areas, markers, crew zone) when the owner
// imported it (room-layouts.js). No DOM, no user text from outside: labels are escaped.
import {
  BOARD_HEIGHT_INCHES, BOARD_WIDTH_INCHES, LARGE_TERRAIN_INCHES, RANDOM_TERRAIN_TABLE, SMALL_TERRAIN_INCHES,
  TERRAIN_MIN_GAP_INCHES,
} from './data.js';

const QUADRANT_NAMES = ['Top left', 'Top right', 'Bottom left', 'Bottom right'];
const QUADRANT_WIDTH = BOARD_WIDTH_INCHES / 2;
const QUADRANT_HEIGHT = BOARD_HEIGHT_INCHES / 2;
const SVG_UNITS_PER_INCH = 10;
const MAX_LAYOUT_ATTEMPTS = 1000;
// a room can leave no way to place everything; past this many tries in a row without a better layout, stop looking
const ATTEMPTS_WITHOUT_IMPROVEMENT_LIMIT = 40;

const WHOLE_BOARD = { x: 0, y: 0, width: BOARD_WIDTH_INCHES, height: BOARD_HEIGHT_INCHES };

function quadrantArea(quadrant) {
  return { x: (quadrant % 2) * QUADRANT_WIDTH, y: Math.floor(quadrant / 2) * QUADRANT_HEIGHT, width: QUADRANT_WIDTH, height: QUADRANT_HEIGHT };
}

function randomInteger(lowest, highest) {
  return lowest + Math.floor(Math.random() * (highest - lowest + 1));
}

// random pieces are squares given by `size`; fixed terrain from a room layout is a rectangle
function asRectangle(piece) {
  return 'size' in piece ? { x: piece.x, y: piece.y, width: piece.size, height: piece.size } : piece;
}

function gapBetween(firstPiece, secondPiece) {
  const first = asRectangle(firstPiece);
  const second = asRectangle(secondPiece);
  const horizontal = Math.max(0, first.x - (second.x + second.width), second.x - (first.x + first.width));
  const vertical = Math.max(0, first.y - (second.y + second.height), second.y - (first.y + first.height));
  return Math.hypot(horizontal, vertical);
}

// two rectangles overlap when they are neither apart sideways nor apart lengthways
function overlap(firstPiece, secondPiece) {
  const first = asRectangle(firstPiece);
  const second = asRectangle(secondPiece);
  const apartSideways = first.x >= second.x + second.width || second.x >= first.x + first.width;
  const apartLengthways = first.y >= second.y + second.height || second.y >= first.y + first.height;
  return !apartSideways && !apartLengthways;
}

// whole-inch spots only, so every distance can be read straight off a tape measure
function freeSpots(size, area, obstacles) {
  const spots = [];
  for (let x = area.x; x <= area.x + area.width - size; x += 1) {
    for (let y = area.y; y <= area.y + area.height - size; y += 1) {
      const candidate = { x, y, width: size, height: size };
      if (obstacles.every((obstacle) => !overlap(candidate, obstacle) && gapBetween(candidate, obstacle) >= obstacle.requiredGap)) spots.push({ x, y });
    }
  }
  return spots;
}

// plain rectangles with their own required gap, made once per roll: the spot search runs for every spot of the board
// against every obstacle
function prepareObstacle(other) {
  return { ...asRectangle(other), requiredGap: other.minGap ?? TERRAIN_MIN_GAP_INCHES, soft: Boolean(other.soft) };
}

function randomFreeSpot(size, area, otherPieces) {
  const spots = freeSpots(size, area, otherPieces);
  return spots.length ? spots[randomInteger(0, spots.length - 1)] : null;
}

// its own quadrant first; only when the room's own terrain leaves no spot there, anywhere else on the board,
// the way it would go down at the table. `soft` obstacles (the crew's and the enemies' zones) are kept free while
// there is room, and only given up before a piece would have to be left out.
function randomFreeSpotPreferringQuadrant(size, quadrant, otherPieces) {
  const hardObstaclesOnly = otherPieces.filter((other) => !other.soft);
  return randomFreeSpot(size, quadrantArea(quadrant), otherPieces) ?? randomFreeSpot(size, WHOLE_BOARD, otherPieces)
    ?? randomFreeSpot(size, quadrantArea(quadrant), hardObstaclesOnly) ?? randomFreeSpot(size, WHOLE_BOARD, hardObstaclesOnly);
}

// a piece with no free spot is returned as unplaced; the owner puts it where it fits on the table
function layOutPieces(pieceSizesByQuadrant, preparedObstacles) {
  const piecesToPlace = pieceSizesByQuadrant.flatMap((sizes, quadrant) => sizes.map((size) => ({ quadrant, size })));
  // big pieces first, across the whole board: small ones fit into what is left, not the other way round
  const placementOrder = [...piecesToPlace].sort((first, second) => second.size - first.size);
  const unplacedPieces = [];
  const placedObstacles = [];
  for (const piece of placementOrder) {
    const spot = randomFreeSpotPreferringQuadrant(piece.size, piece.quadrant, [...preparedObstacles, ...placedObstacles]);
    if (spot) {
      Object.assign(piece, spot);
      placedObstacles.push(prepareObstacle(piece));
    } else {
      unplacedPieces.push({ quadrant: piece.quadrant, size: piece.size });
    }
  }
  // listed quadrant by quadrant, so the letters on the sketch read in order
  return { pieces: piecesToPlace.filter((piece) => 'x' in piece), unplacedPieces };
}

// obstacles: rectangles from the room's layout; random pieces keep the same gap from them as from each other.
// Random terrain only ever comes from this roll: pieces are never moved by hand.
export function generateTerrain(rollD12, obstacles = []) {
  const quadrantRolls = QUADRANT_NAMES.map(() => rollD12());
  const pieceSizesByQuadrant = quadrantRolls.map((roll) => {
    const row = RANDOM_TERRAIN_TABLE.find((tableRow) => roll <= tableRow.max);
    const smallPieces = row.smallPiecesDieSides ? randomInteger(1, row.smallPiecesDieSides) : 0;
    return [...Array(row.largePieces).fill(LARGE_TERRAIN_INCHES), ...Array(smallPieces).fill(SMALL_TERRAIN_INCHES)];
  });
  // an unlucky first piece can box the rest out; the dice stand, only the positions are tried again.
  // Some rooms leave no room for everything at all: then the attempt that placed the most pieces wins.
  const preparedObstacles = obstacles.map(prepareObstacle);
  let bestLayout = null;
  let attemptsWithoutImprovement = 0;
  for (let attempt = 0; attempt < MAX_LAYOUT_ATTEMPTS && attemptsWithoutImprovement < ATTEMPTS_WITHOUT_IMPROVEMENT_LIMIT; attempt += 1) {
    const layout = layOutPieces(pieceSizesByQuadrant, preparedObstacles);
    if (bestLayout === null || layout.unplacedPieces.length < bestLayout.unplacedPieces.length) {
      bestLayout = layout;
      attemptsWithoutImprovement = 0;
    } else {
      attemptsWithoutImprovement += 1;
    }
    if (bestLayout.unplacedPieces.length === 0) break;
  }
  return { quadrantRolls, ...bestLayout };
}

export function isValidTerrain(terrain) {
  const isRoll = (value) => Number.isInteger(value) && value >= 1 && value <= 12;
  const isUnplacedPiece = (piece) => piece !== null && typeof piece === 'object'
    && Number.isInteger(piece.quadrant) && piece.quadrant >= 0 && piece.quadrant < QUADRANT_NAMES.length
    && [LARGE_TERRAIN_INCHES, SMALL_TERRAIN_INCHES].includes(piece.size);
  return terrain !== null && typeof terrain === 'object'
    // unplacedPieces came later than the first saves: absent means none
    && (terrain.unplacedPieces === undefined || (Array.isArray(terrain.unplacedPieces) && terrain.unplacedPieces.every(isUnplacedPiece)))
    && Array.isArray(terrain.quadrantRolls) && terrain.quadrantRolls.length === QUADRANT_NAMES.length && terrain.quadrantRolls.every(isRoll)
    && Array.isArray(terrain.pieces) && terrain.pieces.every((piece) => piece !== null && typeof piece === 'object'
      && Number.isInteger(piece.quadrant) && piece.quadrant >= 0 && piece.quadrant < QUADRANT_NAMES.length
      && [LARGE_TERRAIN_INCHES, SMALL_TERRAIN_INCHES].includes(piece.size)
      && Number.isInteger(piece.x) && piece.x >= 0 && piece.x + piece.size <= BOARD_WIDTH_INCHES
      && Number.isInteger(piece.y) && piece.y >= 0 && piece.y + piece.size <= BOARD_HEIGHT_INCHES);
}

function pieceLetter(pieceIndex) {
  return String.fromCharCode(65 + pieceIndex);
}

// measurements come off a printed map, so quarter inches at best: no float noise on screen
const roundedInches = (inches) => Number(inches.toFixed(2));

// how far a rectangle (or a point, when width and height are 0) is from each of the four board edges, in inches
function edgeDistances(piece) {
  const rectangle = asRectangle(piece);
  return {
    left: roundedInches(rectangle.x), right: roundedInches(BOARD_WIDTH_INCHES - rectangle.x - rectangle.width),
    top: roundedInches(rectangle.y), bottom: roundedInches(BOARD_HEIGHT_INCHES - rectangle.y - rectangle.height),
  };
}

function edgeDistancesText(piece) {
  const { left, right, top, bottom } = edgeDistances(piece);
  return `from the edges: left ${left}″ · right ${right}″ · top ${top}″ · bottom ${bottom}″`;
}

const pointAsBox = (point) => ({ x: point.x, y: point.y, width: 0, height: 0 });

// one entry per quadrant, for the list under the sketch
export function terrainPlacementsByQuadrant(terrain) {
  return QUADRANT_NAMES.map((name, quadrant) => ({
    name,
    roll: terrain.quadrantRolls[quadrant],
    unplacedFootprints: (terrain.unplacedPieces ?? []).filter((piece) => piece.quadrant === quadrant).map((piece) => `${piece.size}" × ${piece.size}"`),
    pieces: terrain.pieces.map((piece, pieceIndex) => ({ piece, pieceIndex })).filter(({ piece }) => piece.quadrant === quadrant)
      .map(({ piece, pieceIndex }) => ({
        letter: pieceLetter(pieceIndex), footprint: `${piece.size}" × ${piece.size}"`, where: edgeDistancesText(piece).replace('from the edges: ', ''),
      })),
  }));
}

const inchesToSvg = (inches) => inches * SVG_UNITS_PER_INCH;

function escapeSvgText(text) {
  return String(text).replace(/[&<>"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]);
}

// centred lines of text, stacked around (centreX, centreY); each line is { text, size, bold }
function textLinesSvg(centreX, centreY, lines) {
  const lineHeights = lines.map((line) => line.size * 1.25);
  const totalHeight = lineHeights.reduce((sum, height) => sum + height, 0);
  let nextTop = centreY - totalHeight / 2;
  return lines.map((line, index) => {
    const lineCentre = nextTop + lineHeights[index] / 2;
    nextTop += lineHeights[index];
    return `<text x="${centreX}" y="${lineCentre}" font-size="${line.size}" class="${line.bold ? 'bold' : ''}">${escapeSvgText(line.text)}</text>`;
  }).join('');
}

// greedy word wrap for SVG text, assuming an average glyph is about half an em wide
function wrapCaption(text, size, maxWidth) {
  const maxCharacters = Math.max(6, Math.floor(maxWidth / (size * 0.52)));
  const lines = [];
  for (const word of text.split(' ')) {
    const last = lines.length - 1;
    if (last >= 0 && `${lines[last]} ${word}`.length <= maxCharacters) lines[last] += ` ${word}`;
    else lines.push(word);
  }
  return lines;
}

const ENEMY_LABEL_HEIGHT = 17;
const SIZE_CAPTION_HEIGHT = 12;

// the largest caption text (8 down to 5.5) whose wrapped lines still fit the room left inside the area
function fittingCaptionLines(captions, maxWidth, availableHeight) {
  let lines = [];
  for (let size = 8; size >= 5.5; size -= 0.5) {
    lines = captions.flatMap((caption) => wrapCaption(caption, size, maxWidth).map((text) => ({ text, size })));
    if (lines.length * size * 1.25 <= availableHeight) break;
  }
  return lines;
}

function sizeCaption(rectangle) {
  return `${roundedInches(rectangle.width)}″ × ${roundedInches(rectangle.height)}″`;
}

// a labelled rectangle drawn like the book's maps: label in the middle, size in the corner.
// Returned in two parts so a zone's label can be drawn above random terrain that happens to sit on it.
// hover or tap: the app shows this text under the map (see showBoardInfo in app.js)
// `box` is where the item sits in inches (x y width height; a point has no size): the app draws measuring lines from it
const infoAttributes = (text, box) => ` data-action="showBoardInfo" data-info="${escapeSvgText(text)}" data-box="${[box.x, box.y, box.width, box.height].map(roundedInches).join(' ')}"`;

function rectangleParts(cssClass, rectangle, lines, { showSize = true, info = '' } = {}) {
  const x = inchesToSvg(rectangle.x);
  const y = inchesToSvg(rectangle.y);
  const width = inchesToSvg(rectangle.width);
  const height = inchesToSvg(rectangle.height);
  const sizeSvg = showSize && width >= 45 && height >= 30
    ? `<text class="size" x="${x + width - 3}" y="${y + height - 3}" font-size="6.5">${escapeSvgText(sizeCaption(rectangle))}</text>` : '';
  return {
    shape: `<g class="${cssClass}"${info ? infoAttributes(info, rectangle) : ''}><rect x="${x}" y="${y}" width="${width}" height="${height}"/></g>`,
    labels: `<g class="${cssClass} labels">${textLinesSvg(x + width / 2, y + height / 2, lines)}${sizeSvg}</g>`,
  };
}

const rectangleSvg = (cssClass, rectangle, lines, options) => {
  const { shape, labels } = rectangleParts(cssClass, rectangle, lines, options);
  return shape + labels;
};

function fixedTerrainSvg(piece, fallbackTag) {
  const look = piece.look ?? 'black';
  const labelSize = Math.min(10, Math.max(6, Math.min(piece.width, piece.height) * SVG_UNITS_PER_INCH * 0.5));
  // an unlabelled hatched area is printed bare on the maps
  const lines = look === 'hatched' && !piece.label ? [] : [{ text: piece.label ?? fallbackTag, size: labelSize, bold: true }];
  const name = piece.label ?? fallbackTag;
  const info = `${name} · part of the room (${look === 'hatched' ? 'impassable' : 'fixed terrain'}) · ${sizeCaption(piece)} · ${edgeDistancesText(piece)}`;
  return rectangleSvg(`fixed-terrain ${look}`, piece, lines, { showSize: look !== 'hatched', info });
}

// the places crew models set up: one zone in a campaign room, one per player in a versus match
export const crewZonesOf = (roomLayout) => roomLayout.crewZones ?? (roomLayout.crewZone ? [roomLayout.crewZone] : []);

function markerSvg(marker) {
  const centreX = inchesToSvg(marker.x);
  const centreY = inchesToSvg(marker.y);
  if (!marker.diameter) {
    // a point (a drop spot): a small dot with its label beside it, like the plain labels on the printed maps
    return `<g class="marker point"${infoAttributes(`${marker.label} · drop point · ${edgeDistancesText(pointAsBox(marker))}`, pointAsBox(marker))}><circle cx="${centreX}" cy="${centreY}" r="2.5"/>
      <text x="${centreX + 5}" y="${centreY}" font-size="8" class="start">${escapeSvgText(marker.label)}</text></g>`;
  }
  const radius = inchesToSvg(marker.diameter) / 2;
  const labelSize = Math.min(10, Math.max(5.5, (radius * 2 * 1.6) / (marker.label.length + 1)));
  const markerInfo = `${marker.label}${marker.note ? ` (${marker.note})` : ''} · objective · ${marker.diameter}″ circle · centre ${edgeDistancesText(pointAsBox(marker))}`;
  return `<g class="marker"${infoAttributes(markerInfo, pointAsBox(marker))}><circle class="ping" cx="${centreX}" cy="${centreY}" r="${radius}"/><circle cx="${centreX}" cy="${centreY}" r="${radius}"/>${textLinesSvg(centreX, centreY, [{ text: marker.label, size: labelSize, bold: true }])}</g>`;
}

// options.enemyCaptions: area label -> ["2× Starving Mutants", ...]; options.crewCaption: e.g. "7 models"
function roomLayoutSvg(roomLayout, { enemyCaptions = {}, crewCaption = '' } = {}) {
  const hatchedAndGray = (roomLayout.fixedTerrain ?? []).map((piece, index) => ({ piece, index })).filter(({ piece }) => piece.look === 'hatched' || piece.look === 'gray');
  const solidObjects = (roomLayout.fixedTerrain ?? []).map((piece, index) => ({ piece, index })).filter(({ piece }) => !hatchedAndGray.some((other) => other.piece === piece));
  const crewZoneParts = crewZonesOf(roomLayout).map((crewZone) => {
    const caption = crewZone.caption ?? crewCaption;
    return rectangleParts('crew-zone', crewZone, [{ text: crewZone.label && crewZone.label !== 'Start' ? crewZone.label : 'YOUR CREW', size: 12, bold: true }, ...(caption ? [{ text: caption, size: 8 }] : []), { text: 'sets up here', size: 7.5 }],
      { info: `${crewZone.owner ?? 'Your crew'} · ${caption || 'models'} set up anywhere inside this zone · ${sizeCaption(crewZone)} · ${edgeDistancesText(crewZone)}` });
  });
  const enemyAreaParts = (roomLayout.enemyAreas ?? []).map((area, index) => {
    const tag = area.label ?? `E${index + 1}`;
    const captionLines = fittingCaptionLines(enemyCaptions[tag] ?? [], inchesToSvg(area.width) - 8, inchesToSvg(area.height) - ENEMY_LABEL_HEIGHT - SIZE_CAPTION_HEIGHT);
    const enemies = (enemyCaptions[tag] ?? []).join(', ').replaceAll(' *', '');
    return rectangleParts('enemy-area', area, [{ text: tag, size: 13, bold: true }, ...captionLines],
      { info: `${tag} · enemy area · ${enemies || 'enemies set up here'} · ${sizeCaption(area)} · ${edgeDistancesText(area)}` });
  });
  const zoneParts = [...crewZoneParts, ...enemyAreaParts];
  return {
    underneath: [...hatchedAndGray, ...solidObjects].map(({ piece, index }) => fixedTerrainSvg(piece, `F${index + 1}`)).join('')
      + zoneParts.map((parts) => parts.shape).join(''),
    zoneLabels: zoneParts.map((parts) => parts.labels).join(''),
    onTop: (roomLayout.markers ?? []).map(markerSvg).join(''),
  };
}

// terrain and roomLayout may each be missing: the sketch shows whatever is known
// Dashed lines from each board edge to an item, with the distance on each: what to measure when setting it up.
// Returned as SVG markup for the empty #board-measure group; `box` is [x, y, width, height] in inches.
export function renderMeasurementLinesSvg([x, y, width, height]) {
  const centreX = x + width / 2;
  const centreY = y + height / 2;
  const lines = [
    [0, centreY, x, centreY], [x + width, centreY, BOARD_WIDTH_INCHES, centreY],
    [centreX, 0, centreX, y], [centreX, y + height, centreX, BOARD_HEIGHT_INCHES],
  ];
  return lines.filter(([x1, y1, x2, y2]) => Math.hypot(x2 - x1, y2 - y1) > 0.01).map(([x1, y1, x2, y2]) => {
    const [ux1, uy1, ux2, uy2] = [x1, y1, x2, y2].map(inchesToSvg);
    return `<line x1="${ux1}" y1="${uy1}" x2="${ux2}" y2="${uy2}"/><circle cx="${ux1}" cy="${uy1}" r="1.6"/><circle cx="${ux2}" cy="${uy2}" r="1.6"/>
      <text x="${(ux1 + ux2) / 2}" y="${(uy1 + uy2) / 2}" font-size="8">${roundedInches(Math.hypot(x2 - x1, y2 - y1))}″</text>`;
  }).join('');
}

// captions.focus: one kind of thing ('crew', 'enemy', 'terrain', 'marker', 'random') to light up while the rest dims
export function renderBoardSvg(terrain, roomLayout, captions = {}) {
  const width = BOARD_WIDTH_INCHES * SVG_UNITS_PER_INCH;
  const height = BOARD_HEIGHT_INCHES * SVG_UNITS_PER_INCH;
  const zones = roomLayout ? [...crewZonesOf(roomLayout), ...(roomLayout.enemyAreas ?? [])] : [];
  const layoutSvg = roomLayout ? roomLayoutSvg(roomLayout, captions) : { underneath: '', zoneLabels: '', onTop: '' };
  const piecesSvg = (terrain?.pieces ?? []).map((piece, pieceIndex) => {
    const side = piece.size * SVG_UNITS_PER_INCH;
    const x = piece.x * SVG_UNITS_PER_INCH;
    const y = piece.y * SVG_UNITS_PER_INCH;
    const isOverAZone = zones.some((zone) => overlap(piece, zone));
    return `<g class="terrain-piece ${piece.size === LARGE_TERRAIN_INCHES ? 'large' : 'small'}${isOverAZone ? ' over-zone' : ''}" style="animation-delay: ${pieceIndex * 70}ms"${infoAttributes(`Random terrain ${pieceLetter(pieceIndex)} · rolled by the app · ${piece.size}″ × ${piece.size}″ · ${edgeDistancesText(piece)}`, asRectangle(piece))}>
      <title>Random terrain ${pieceLetter(pieceIndex)}</title>
      <rect class="terrain-shadow" x="${x + 2.5}" y="${y + 2.5}" width="${side}" height="${side}" rx="2"/>
      <rect class="terrain-box" x="${x}" y="${y}" width="${side}" height="${side}" rx="2"/>
      <text x="${x + side / 2}" y="${y + side / 2}" font-size="${piece.size === LARGE_TERRAIN_INCHES ? 18 : 10}">${pieceLetter(pieceIndex)}</text>
    </g>`;
  }).join('');
  return `<svg class="terrain-board${captions.focus ? ` focus-${captions.focus}` : ''}${captions.dropIn ? ' drop-in' : ''}" viewBox="-3 -3 ${width + 6} ${height + 6}" role="img" aria-label="The ${BOARD_WIDTH_INCHES} by ${BOARD_HEIGHT_INCHES} inch board, as the book's map is printed">
    <defs>
      <pattern id="board-inches" width="${SVG_UNITS_PER_INCH}" height="${SVG_UNITS_PER_INCH}" patternUnits="userSpaceOnUse"><path d="M${SVG_UNITS_PER_INCH} 0H0V${SVG_UNITS_PER_INCH}" class="board-grid"/></pattern>
      <pattern id="hatch" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(-60)"><rect width="18" height="18" class="hatch-light"/><rect width="9" height="18" class="hatch-dark"/></pattern>
    </defs>
    <rect class="board-fill" width="${width}" height="${height}"/>
    <rect width="${width}" height="${height}" fill="url(#board-inches)"/>
    <path class="quadrant-line" d="M${width / 2} 0V${height}M0 ${height / 2}H${width}"/>
    ${layoutSvg.underneath}
    ${piecesSvg}
    ${layoutSvg.zoneLabels}
    ${layoutSvg.onTop}
    <rect class="board-edge" width="${width}" height="${height}"/>
    <g id="board-measure" class="measure"></g>
  </svg>`;
}

// the room's own footprint as text lines, grouped for the set-up list; tags match the sketch
export function roomLayoutLines(roomLayout) {
  const rectangleLines = (group, rectangles, defaultName, tagPrefix) => (rectangles ?? []).map((rectangle, index) => ({
    group,
    tag: rectangle.label ?? `${tagPrefix}${index + 1}`,
    text: `${defaultName} · ${roundedInches(rectangle.width)}" × ${roundedInches(rectangle.height)}"`,
    where: edgeDistancesText(rectangle).replace('from the edges: ', ''),
  }));
  const markerLines = (roomLayout.markers ?? []).map((marker) => ({
    group: 'Objectives and points',
    tag: marker.label,
    text: marker.diameter ? `${marker.diameter}" circle, centre` : 'point',
    where: edgeDistancesText(pointAsBox(marker)).replace('from the edges: ', ''),
  }));
  const crewZones = crewZonesOf(roomLayout).map((zone) => ({ label: 'Start', ...zone }));
  return [
    ...rectangleLines('Your crew starts here', crewZones, 'Zone', 'Start'),
    ...rectangleLines('Enemy areas', roomLayout.enemyAreas, 'Enemy area', 'E'),
    ...rectangleLines('Fixed terrain (part of the room)', roomLayout.fixedTerrain, 'Fixed terrain', 'F'),
    ...markerLines,
  ];
}
