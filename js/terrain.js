// General terrain for the room about to be played (p. 43–44): one roll per board quadrant, then a sketch of where
// the pieces could go. No DOM, no user text. The room's own terrain is only on the book's map, so it is not known here.
import {
  BOARD_HEIGHT_INCHES, BOARD_WIDTH_INCHES, LARGE_TERRAIN_INCHES, RANDOM_TERRAIN_TABLE, SMALL_TERRAIN_INCHES,
  TERRAIN_MIN_GAP_INCHES,
} from './data.js';

const QUADRANT_NAMES = ['Top left', 'Top right', 'Bottom left', 'Bottom right'];
const QUADRANT_WIDTH = BOARD_WIDTH_INCHES / 2;
const QUADRANT_HEIGHT = BOARD_HEIGHT_INCHES / 2;
const SVG_UNITS_PER_INCH = 10;
const MAX_LAYOUT_ATTEMPTS = 3000;

function quadrantOrigin(quadrant) {
  return { x: (quadrant % 2) * QUADRANT_WIDTH, y: Math.floor(quadrant / 2) * QUADRANT_HEIGHT };
}

function randomInteger(lowest, highest) {
  return lowest + Math.floor(Math.random() * (highest - lowest + 1));
}

function gapBetween(first, second) {
  const horizontal = Math.max(0, first.x - (second.x + second.size), second.x - (first.x + first.size));
  const vertical = Math.max(0, first.y - (second.y + second.size), second.y - (first.y + first.size));
  return Math.hypot(horizontal, vertical);
}

// whole-inch spots only, so every distance can be read straight off a tape measure
function freeSpots(size, quadrant, otherPieces) {
  const origin = quadrantOrigin(quadrant);
  const spots = [];
  for (let x = origin.x; x <= origin.x + QUADRANT_WIDTH - size; x += 1) {
    for (let y = origin.y; y <= origin.y + QUADRANT_HEIGHT - size; y += 1) {
      if (otherPieces.every((other) => gapBetween({ x, y, size }, other) >= TERRAIN_MIN_GAP_INCHES)) spots.push({ x, y });
    }
  }
  return spots;
}

function randomFreeSpot(size, quadrant, otherPieces) {
  const spots = freeSpots(size, quadrant, otherPieces);
  return spots.length ? spots[randomInteger(0, spots.length - 1)] : null;
}

function layOutPieces(pieceSizesByQuadrant) {
  const piecesToPlace = pieceSizesByQuadrant.flatMap((sizes, quadrant) => sizes.map((size) => ({ quadrant, size })));
  // big pieces first, across the whole board: small ones fit into what is left, not the other way round
  const placementOrder = [...piecesToPlace].sort((first, second) => second.size - first.size);
  for (const piece of placementOrder) {
    const spot = randomFreeSpot(piece.size, piece.quadrant, placementOrder.filter((other) => 'x' in other));
    if (!spot) return null;
    Object.assign(piece, spot);
  }
  // listed quadrant by quadrant, so the letters on the sketch read in order
  return piecesToPlace;
}

export function generateTerrain(rollD12) {
  const quadrantRolls = QUADRANT_NAMES.map(() => rollD12());
  const pieceSizesByQuadrant = quadrantRolls.map((roll) => {
    const row = RANDOM_TERRAIN_TABLE.find((tableRow) => roll <= tableRow.max);
    const smallPieces = row.smallPiecesDieSides ? randomInteger(1, row.smallPiecesDieSides) : 0;
    return [...Array(row.largePieces).fill(LARGE_TERRAIN_INCHES), ...Array(smallPieces).fill(SMALL_TERRAIN_INCHES)];
  });
  // an unlucky first piece can box the rest out; the dice stand, only the positions are tried again
  for (let attempt = 0; attempt < MAX_LAYOUT_ATTEMPTS; attempt += 1) {
    const pieces = layOutPieces(pieceSizesByQuadrant);
    if (pieces) return { quadrantRolls, pieces };
  }
  throw new Error('Could not fit the rolled terrain on the board. Roll again.');
}

export function moveTerrainPiece(terrain, pieceIndex) {
  const piece = terrain.pieces[pieceIndex];
  const otherPieces = terrain.pieces.filter((other) => other !== piece);
  const spots = freeSpots(piece.size, piece.quadrant, otherPieces).filter((spot) => spot.x !== piece.x || spot.y !== piece.y);
  if (!spots.length) throw new Error('There is no other free spot for that piece in its quadrant.');
  Object.assign(piece, spots[randomInteger(0, spots.length - 1)]);
}

export function isValidTerrain(terrain) {
  const isRoll = (value) => Number.isInteger(value) && value >= 1 && value <= 12;
  return terrain !== null && typeof terrain === 'object'
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

function distanceFromNearestEdges(piece) {
  const fromRight = BOARD_WIDTH_INCHES - piece.x - piece.size;
  const fromBottom = BOARD_HEIGHT_INCHES - piece.y - piece.size;
  const sideways = piece.x <= fromRight ? `left ${piece.x}"` : `right ${fromRight}"`;
  const lengthways = piece.y <= fromBottom ? `top ${piece.y}"` : `bottom ${fromBottom}"`;
  return `${sideways} · ${lengthways}`;
}

// one entry per quadrant, for the list under the sketch
export function terrainPlacementsByQuadrant(terrain) {
  return QUADRANT_NAMES.map((name, quadrant) => ({
    name,
    roll: terrain.quadrantRolls[quadrant],
    pieces: terrain.pieces.map((piece, pieceIndex) => ({ piece, pieceIndex })).filter(({ piece }) => piece.quadrant === quadrant)
      .map(({ piece, pieceIndex }) => ({
        letter: pieceLetter(pieceIndex), footprint: `${piece.size}" × ${piece.size}"`, where: distanceFromNearestEdges(piece),
      })),
  }));
}

export function renderTerrainSvg(terrain) {
  const width = BOARD_WIDTH_INCHES * SVG_UNITS_PER_INCH;
  const height = BOARD_HEIGHT_INCHES * SVG_UNITS_PER_INCH;
  const piecesSvg = terrain.pieces.map((piece, pieceIndex) => {
    const side = piece.size * SVG_UNITS_PER_INCH;
    const x = piece.x * SVG_UNITS_PER_INCH;
    const y = piece.y * SVG_UNITS_PER_INCH;
    const isLarge = piece.size === LARGE_TERRAIN_INCHES;
    return `<g class="terrain-piece ${isLarge ? 'large' : 'small'}" data-action="moveTerrainPiece" data-index="${pieceIndex}" role="button" aria-label="Move piece ${pieceLetter(pieceIndex)}">
      <rect class="terrain-shadow" x="${x + 3}" y="${y + 3}" width="${side}" height="${side}" rx="3"/>
      <rect class="terrain-box" x="${x}" y="${y}" width="${side}" height="${side}" rx="3"/>
      <text x="${x + side / 2}" y="${y + side / 2}">${pieceLetter(pieceIndex)}</text>
    </g>`;
  }).join('');
  return `<svg class="terrain-board" viewBox="-2 -2 ${width + 4} ${height + 4}" role="img" aria-label="Terrain sketch of the ${BOARD_WIDTH_INCHES} by ${BOARD_HEIGHT_INCHES} inch board">
    <defs><pattern id="board-inches" width="${SVG_UNITS_PER_INCH}" height="${SVG_UNITS_PER_INCH}" patternUnits="userSpaceOnUse"><path d="M${SVG_UNITS_PER_INCH} 0H0V${SVG_UNITS_PER_INCH}" class="map-tile"/></pattern></defs>
    <rect class="board-edge" width="${width}" height="${height}"/>
    <rect width="${width}" height="${height}" fill="url(#board-inches)"/>
    <path class="quadrant-line" d="M${width / 2} 0V${height}M0 ${height / 2}H${width}"/>
    ${piecesSvg}
  </svg>`;
}
