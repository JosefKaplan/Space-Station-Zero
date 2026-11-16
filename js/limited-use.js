// Abilities, edges and equipment that can be used once per turn, once per challenge or once per game (names and how often are in
// js/data.js, LIMITED_USE). Pure: it reads a run and changes the lists of used ones in it.
//
// Where the "used" marks live: once per turn in `run.roomSetup.turns.used` (a new turn clears it), once per challenge in
// `run.roomSetup.used` (a new room clears it), once per game in `run.usedForGame` (kept for the whole run). Each entry is a key
// "<holder id>:<name>": the holder is a crew member, or the crew for its edge.
import { LIMITED_USE } from './data.js';

const mentions = (text, name) => String(text ?? '').toLowerCase().includes(name.toLowerCase());

// what the party can use right now: members taking part, and the crews' edges
export function limitedUseEntries(run) {
  const entries = [];
  for (const crew of run.crews) {
    for (const [name, frequency] of Object.entries(LIMITED_USE)) {
      if (mentions(crew.edge, name)) entries.push({ key: `crew:${crew.id}:${name}`, name, frequency, holder: crew.name, isCrewWide: true });
    }
    for (const member of crew.members.filter((candidate) => candidate.status === 'active')) {
      for (const [name, frequency] of Object.entries(LIMITED_USE)) {
        if (mentions(member.abilities, name) || mentions(member.equipment, name)) entries.push({ key: `${member.id}:${name}`, name, frequency, holder: member.name, isCrewWide: false });
      }
    }
  }
  return entries;
}

const usedListOf = (run, frequency) => ({ turn: run.roomSetup.turns.used, challenge: run.roomSetup.used, game: run.usedForGame })[frequency];

export const isUsed = (run, entry) => usedListOf(run, entry.frequency).includes(entry.key);

// marks it used, or takes the mark back (a tap too many)
export function toggleUsed(run, key) {
  const entry = limitedUseEntries(run).find((candidate) => candidate.key === key);
  if (!entry) throw new Error('That ability is not available any more.');
  const list = usedListOf(run, entry.frequency);
  if (list.includes(key)) list.splice(list.indexOf(key), 1);
  else list.push(key);
}
