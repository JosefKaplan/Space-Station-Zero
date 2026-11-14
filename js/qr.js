// A small QR code generator: byte mode, error correction level M, versions 1 to 10 (up to 213 bytes). It exists to
// draw the authenticator setup link without any library. Pure: text in, SVG text out. Follows ISO/IEC 18004.

// per version: error-correction codewords per block, and the blocks as [count, data codewords each]
const VERSIONS = [
  null,
  { ecPerBlock: 10, groups: [[1, 16]] },
  { ecPerBlock: 16, groups: [[1, 28]] },
  { ecPerBlock: 26, groups: [[1, 44]] },
  { ecPerBlock: 18, groups: [[2, 32]] },
  { ecPerBlock: 24, groups: [[2, 43]] },
  { ecPerBlock: 16, groups: [[4, 27]] },
  { ecPerBlock: 18, groups: [[4, 31]] },
  { ecPerBlock: 22, groups: [[2, 38], [2, 39]] },
  { ecPerBlock: 22, groups: [[3, 36], [2, 37]] },
  { ecPerBlock: 26, groups: [[4, 43], [1, 44]] },
];
const ALIGNMENT_POSITIONS = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const MAX_VERSION = 10;

const dataCodewordsOf = (version) => VERSIONS[version].groups.reduce((sum, [count, size]) => sum + count * size, 0);

// ---------- Reed-Solomon over GF(256), polynomial 0x11D ----------

const EXP = new Array(512);
const LOG = new Array(256);
{
  let value = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = value;
    LOG[value] = i;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
}
const multiply = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function generatorPolynomial(degree) {
  let polynomial = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(polynomial.length + 1).fill(0);
    polynomial.forEach((coefficient, index) => {
      next[index] ^= coefficient;
      next[index + 1] ^= multiply(coefficient, EXP[i]);
    });
    polynomial = next;
  }
  return polynomial;
}

function errorCorrectionFor(data, count) {
  const generator = generatorPolynomial(count);
  const remainder = new Array(count).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder.shift();
    remainder.push(0);
    for (let i = 0; i < count; i += 1) remainder[i] ^= multiply(generator[i + 1], factor);
  }
  return remainder;
}

// ---------- the codewords ----------

function encodeBytes(bytes) {
  const version = Array.from({ length: MAX_VERSION }, (_, index) => index + 1)
    .find((candidate) => bytes.length <= Math.floor((dataCodewordsOf(candidate) * 8 - 4 - (candidate < 10 ? 8 : 16)) / 8));
  if (!version) throw new Error('That text is too long for the QR code.');
  const bits = [];
  const push = (value, length) => { for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1); };
  push(0b0100, 4);
  push(bytes.length, version < 10 ? 8 : 16);
  bytes.forEach((byte) => push(byte, 8));
  const capacityBits = dataCodewordsOf(version) * 8;
  push(0, Math.min(4, capacityBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) codewords.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; codewords.length < dataCodewordsOf(version); pad = pad === 0xec ? 0x11 : 0xec) codewords.push(pad);

  // split into blocks, add error correction to each, and interleave
  const { ecPerBlock, groups } = VERSIONS[version];
  const blocks = [];
  let offset = 0;
  for (const [count, size] of groups) {
    for (let i = 0; i < count; i += 1) {
      const data = codewords.slice(offset, offset + size);
      offset += size;
      blocks.push({ data, ec: errorCorrectionFor(data, ecPerBlock) });
    }
  }
  const interleaved = [];
  const longest = Math.max(...blocks.map((block) => block.data.length));
  for (let i = 0; i < longest; i += 1) blocks.forEach((block) => { if (i < block.data.length) interleaved.push(block.data[i]); });
  for (let i = 0; i < ecPerBlock; i += 1) blocks.forEach((block) => interleaved.push(block.ec[i]));
  return { version, codewords: interleaved };
}

// ---------- the matrix ----------

function buildMatrix(version, codewords, mask) {
  const size = 17 + 4 * version;
  const dark = Array.from({ length: size }, () => new Array(size).fill(false));
  const isFunction = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, isDark) => { dark[y][x] = isDark; isFunction[y][x] = true; };

  for (let i = 0; i < size; i += 1) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [centreX, centreY] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const x = centreX + dx;
        const y = centreY + dy;
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, distance !== 2 && distance !== 4);
      }
    }
  }
  const positions = ALIGNMENT_POSITIONS[version];
  positions.forEach((centreX, i) => positions.forEach((centreY, j) => {
    const isFinderCorner = (i === 0 && j === 0) || (i === 0 && j === positions.length - 1) || (i === positions.length - 1 && j === 0);
    if (isFinderCorner) return;
    for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) set(centreX + dx, centreY + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));

  // format bits: error correction level M (00) and the mask, protected by a BCH code
  const formatData = mask;
  let remainder = formatData;
  for (let i = 0; i < 10; i += 1) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  const formatBits = ((formatData << 10) | remainder) ^ 0x5412;
  const bit = (value, index) => ((value >>> index) & 1) === 1;
  for (let i = 0; i <= 5; i += 1) set(8, i, bit(formatBits, i));
  set(8, 7, bit(formatBits, 6));
  set(8, 8, bit(formatBits, 7));
  set(7, 8, bit(formatBits, 8));
  for (let i = 9; i < 15; i += 1) set(14 - i, 8, bit(formatBits, i));
  for (let i = 0; i < 8; i += 1) set(size - 1 - i, 8, bit(formatBits, i));
  for (let i = 8; i < 15; i += 1) set(8, size - 15 + i, bit(formatBits, i));
  set(8, size - 8, true);
  if (version >= 7) {
    let versionRemainder = version;
    for (let i = 0; i < 12; i += 1) versionRemainder = (versionRemainder << 1) ^ ((versionRemainder >>> 11) * 0x1f25);
    const versionBits = (version << 12) | versionRemainder;
    for (let i = 0; i < 18; i += 1) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, bit(versionBits, i));
      set(b, a, bit(versionBits, i));
    }
  }

  // the data, in two-column strips from the bottom right, then masked
  let bitIndex = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical += 1) {
      for (let column = 0; column < 2; column += 1) {
        const x = right - column;
        const y = ((right + 1) & 2) === 0 ? size - 1 - vertical : vertical;
        if (!isFunction[y][x] && bitIndex < codewords.length * 8) {
          dark[y][x] = bit(codewords[bitIndex >>> 3], 7 - (bitIndex & 7));
          bitIndex += 1;
        }
      }
    }
  }
  const MASKS = [
    (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) if (!isFunction[y][x] && MASKS[mask](x, y)) dark[y][x] = !dark[y][x];
  return dark;
}

// the mask with the fewest of the patterns that make a code hard to read (the four standard penalty rules)
function penaltyOf(dark) {
  const size = dark.length;
  let penalty = 0;
  const scanLine = (line) => {
    let run = 1;
    for (let i = 1; i <= line.length; i += 1) {
      if (i < line.length && line[i] === line[i - 1]) { run += 1; continue; }
      if (run >= 5) penalty += 3 + (run - 5);
      run = 1;
    }
    const text = line.map((cell) => (cell ? '1' : '0')).join('');
    for (const finderLike of ['10111010000', '00001011101']) {
      for (let at = text.indexOf(finderLike); at !== -1; at = text.indexOf(finderLike, at + 1)) penalty += 40;
    }
  };
  for (let y = 0; y < size; y += 1) scanLine(dark[y]);
  for (let x = 0; x < size; x += 1) scanLine(dark.map((row) => row[x]));
  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      if (dark[y][x] === dark[y][x + 1] && dark[y][x] === dark[y + 1][x] && dark[y][x] === dark[y + 1][x + 1]) penalty += 3;
    }
  }
  const darkCount = dark.flat().filter(Boolean).length;
  penalty += 10 * Math.max(0, Math.ceil(Math.abs((darkCount * 20) / (size * size) - 10)) - 1);
  return penalty;
}

// ---------- public ----------

function qrMatrix(text) {
  const { version, codewords } = encodeBytes([...new TextEncoder().encode(text)]);
  const candidates = Array.from({ length: 8 }, (_, mask) => buildMatrix(version, codewords, mask));
  return candidates.reduce((best, candidate) => (penaltyOf(candidate) < penaltyOf(best) ? candidate : best));
}

// the code as SVG text, with the 4-module quiet zone scanners need
function qrSvg(text) {
  const dark = qrMatrix(text);
  const size = dark.length + 8;
  let path = '';
  dark.forEach((row, y) => row.forEach((isDark, x) => { if (isDark) path += `M${x + 4} ${y + 4}h1v1h-1z`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

export const qrDataUrl = (text) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg(text))}`;