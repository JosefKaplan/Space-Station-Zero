// What each crew ability, piece of equipment, edge and commander ability does. This is the book's own wording, so it is
// NEVER in the repo: it comes from the owner's gitignored local/crew-rules.json (built by local/extract-crew-rules.py),
// is fetched when the app is served from the project folder, and is kept in this browser's localStorage.
// Without the file the app simply shows no notes.

const CREW_RULES_STORAGE_KEY = 'ssz-crew-rules';
const CREW_RULES_FILE_PATH = 'local/crew-rules.json';
const CREW_RULES_SCHEMA_VERSION = 1;
const TEXT_SECTIONS = ['abilities', 'commanderAbilities', 'edges'];

function parseCrewRules(text) {
  const rules = JSON.parse(text);
  if (rules?.schemaVersion !== CREW_RULES_SCHEMA_VERSION) throw new Error(`schemaVersion must be ${CREW_RULES_SCHEMA_VERSION}`);
  for (const section of [...TEXT_SECTIONS, 'equipment']) {
    if (typeof rules[section] !== 'object' || rules[section] === null) throw new Error(`${section} must be an object`);
  }
  for (const section of TEXT_SECTIONS) {
    for (const [name, description] of Object.entries(rules[section])) {
      if (typeof description !== 'string' || !description) throw new Error(`${section}.${name} must be a non-empty text`);
    }
  }
  // the skirmish challenges' text (optional: older files have none): { lore, sections: [{ title, blocks }] } per challenge
  rules.skirmishes ??= {};
  for (const [key, entry] of Object.entries(rules.skirmishes)) {
    if (typeof entry?.lore !== 'string' || !Array.isArray(entry.sections)) throw new Error(`skirmishes.${key} needs "lore" and "sections"`);
  }
  for (const [name, item] of Object.entries(rules.equipment)) {
    if (typeof item?.text !== 'string' || !item.text || typeof item.tags !== 'string') throw new Error(`equipment.${name} needs "tags" and "text"`);
  }
  return rules;
}

export function saveCrewRules(rules) {
  localStorage.setItem(CREW_RULES_STORAGE_KEY, JSON.stringify(rules));
}

export function forgetCrewRules() {
  localStorage.removeItem(CREW_RULES_STORAGE_KEY);
}

// null when never fetched; a stored copy that no longer validates is an error, not a silent "none"
export function loadCrewRules() {
  const storedText = localStorage.getItem(CREW_RULES_STORAGE_KEY);
  return storedText === null ? null : parseCrewRules(storedText);
}

// text that came from the private database instead of the file: same checks
export const checkedCrewRules = (rules) => parseCrewRules(JSON.stringify(rules));

export async function fetchLocalCrewRules() {
  let response;
  try {
    response = await fetch(CREW_RULES_FILE_PATH, { cache: 'no-cache' });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  return parseCrewRules(await response.text());
}

// the known entries of one kind that a free-text field mentions, in the order they appear: [{ name, tags?, text }]
export function ruleNotesMentionedIn(rules, kind, freeText) {
  if (!rules || !freeText) return [];
  const entries = kind === 'equipment'
    ? Object.entries(rules.equipment).map(([name, item]) => ({ name, tags: item.tags, text: item.text }))
    : Object.entries({ ...rules.abilities, ...rules.commanderAbilities }).map(([name, text]) => ({ name, text }));
  const lowerCaseText = freeText.toLowerCase();
  return entries
    .map((entry) => ({ entry, position: lowerCaseText.indexOf(entry.name.toLowerCase()) }))
    .filter(({ position }) => position !== -1)
    .sort((a, b) => a.position - b.position)
    .map(({ entry }) => entry)
    // "Medical Attention" inside "Improved Medical Attention" is the same mention
    .filter((entry, _, mentioned) => !mentioned.some((other) => other !== entry && other.name.toLowerCase().includes(entry.name.toLowerCase())));
}
