// What a crew does at the start of a challenge, before "Begin challenge" (p. 32–33): tune a weapon and a piece of armor.
// Pure: it works on the `tunings` list of a room (`run.roomSetup.tunings`), see docs/ANALYSIS.md § 19.
//
// tunings = [{ kind: 'weapon' | 'armor', tunerId: memberId, carrierId: memberId, item: 'Sidearm' }]
//
// Each Engineer (Weapon Tuning) or Scientist (Armor Tuning) taking part picks one item of any crew in the party; the same item cannot be
// tuned twice, so two Engineers tune two different weapons. A tuned weapon adds 1 die more, tuned armor has 2 more armor value, for this
// challenge only: the list is new for every room. Once the challenge has begun the tunings stand, even if the tuner goes down.
import { TUNINGS } from './data.js';
import { carriedArmor, carriedWeapons } from './combat.js';

const isTaking = (member) => member.status === 'active';

// members taking part who have the ability for this kind of tuning (a Chief Engineer or a Lead Scientist has it too)
export const tunersOf = (members, kind) => members.filter((member) => isTaking(member) && member.abilities.toLowerCase().includes(TUNINGS[kind].ability.toLowerCase()));

// every piece that can be tuned: [{ carrierId, carrierName, item }], any crew's, once for each carrier that holds it. A member's `edge`
// (their crew's) can give them Power Armor, which is armor like any other.
export function tuneableItems(members, kind) {
  return members.filter(isTaking).flatMap((member) => (kind === 'weapon' ? carriedWeapons(member.equipment) : carriedArmor(member.equipment, member.edge))
    .map((item) => ({ carrierId: member.id, carrierName: member.name, item })));
}

export const tuningOf = (tunings, kind, tunerId) => tunings.find((tuning) => tuning.kind === kind && tuning.tunerId === tunerId) ?? null;

// `target` is { carrierId, item }, or null to take this tuner's tuning back; each tuner has one tuning of its kind
export function setTuning(tunings, kind, tunerId, target) {
  if (target) {
    const taken = tunings.find((tuning) => tuning.kind === kind && tuning.carrierId === target.carrierId && tuning.item === target.item && tuning.tunerId !== tunerId);
    if (taken) throw new Error(`That ${kind} is already tuned: a ${kind} can be tuned only once.`);
  }
  const others = tunings.filter((tuning) => !(tuning.kind === kind && tuning.tunerId === tunerId));
  tunings.splice(0, tunings.length, ...others, ...(target ? [{ kind, tunerId, carrierId: target.carrierId, item: target.item }] : []));
}

// the names of the items one carrier has tuned (what js/combat.js takes)
export const tunedItemsOf = (tunings, carrierId) => tunings.filter((tuning) => tuning.carrierId === carrierId).map((tuning) => tuning.item);
