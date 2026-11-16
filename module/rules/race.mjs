import { FIELD_TARGETS, SYSTEM_ID } from '../config.mjs';
import { createGrantedAttack, grantedAttack, itemLinkState } from './item-links.mjs';
import { normName } from './items.mjs';
import { parseTarget } from './modifiers.mjs';

const contents = collection => Array.from(collection?.contents ?? collection ?? []);
const idOf = document => document.id ?? document._id;
const grantKey = grant => `${grant.type ?? 'skill'}:${normName(grant.name)}`;

const validateBenefits = (benefits, label) => {
  if (!Array.isArray(benefits.modifiers ?? []) || !Array.isArray(benefits.skillGrants ?? [])) {
    throw new Error(`${label}: modifiers and skill grants must be arrays`);
  }
  for (const modifier of benefits.modifiers ?? []) {
    const target = parseTarget(modifier.target);
    const validTarget = FIELD_TARGETS.includes(modifier.target)
      || (target?.kind === 'group' && target.section === 'skills' && target.aspect === 'rank'
        && target.attribute === 'stat' && target.operator === '='
        && ['strength', 'dexterity', 'constitution', 'intelligence', 'charisma'].includes(target.value));
    if (!validTarget || !/^[+-]?(?:\d+(?:\.\d+)?%?|\d+d\d+)$/i.test(String(modifier.value ?? '').trim())) {
      throw new Error(`${label}: invalid field modifier`);
    }
  }
  for (const grant of benefits.skillGrants ?? []) {
    if (typeof grant.name !== 'string' || !grant.name.trim()
      || typeof grant.pack !== 'string' || !grant.pack.trim()
      || !['skill', 'spell'].includes(grant.type ?? 'skill')
      || !Number.isInteger(grant.bonus)
      || (grant.manaCostPercent != null && (!Number.isFinite(grant.manaCostPercent) || grant.type !== 'spell'))) {
      throw new Error(`${label}: invalid skill grant`);
    }
  }
  if (benefits.effectDescription != null && typeof benefits.effectDescription !== 'string') {
    throw new Error(`${label}: invalid effect description`);
  }
};

/** Validate common Race and Class benefits before making any actor changes. */
export function validateBenefitItem(race) {
  const data = race.system;
  if (!race.name?.trim() || !race.uuid || !data) {
    throw new Error('Race or Class is missing a name, source UUID, or system data');
  }
  validateBenefits(data, race.name);
  if (!Array.isArray(data.choices)) throw new Error(`${race.name}: choices must be an array`);
  for (const choice of data.choices) {
    if (choice.kind === 'grant') {
      if (!choice.label?.trim() || !['skill', 'spell'].includes(choice.type)
        || !choice.pack?.trim() || !Number.isInteger(choice.bonus)
        || !Number.isInteger(choice.count) || choice.count < 1) {
        throw new Error(`${race.name}: invalid Skill or Spell choice`);
      }
      continue;
    }
    if (!choice.label?.trim() || !Array.isArray(choice.options)
      || !choice.options.length || !Number.isInteger(choice.count) || choice.count < 1
      || (choice.kind !== 'allocation' && choice.count > choice.options.length)) {
      throw new Error(`${race.name}: invalid choice`);
    }
    for (const option of choice.options) {
      if (!option.label?.trim()) throw new Error(`${race.name}: choice option is missing a label`);
      if (choice.kind === 'allocation' && !FIELD_TARGETS.includes(option.target)) {
        throw new Error(`${race.name}: invalid allocation target`);
      }
      validateBenefits(option, `${race.name}: ${option.label}`);
    }
    if (choice.kind === 'allocation'
      && new Set(choice.options.map(option => option.target)).size !== choice.options.length) {
      throw new Error(`${race.name}: duplicate allocation target`);
    }
  }
}

export function validateRace(race) {
  validateBenefitItem(race);
  if (typeof race.system.size !== 'string') throw new Error('Race is missing a valid size');
}

/** Resolve the choices to the exact benefits to apply. */
export function raceBenefits(race, selections, choices = race.system.choices) {
  validateBenefitItem(race);
  const { modifiers, skillGrants, effectDescription } = race.system;
  if (!Array.isArray(selections) || selections.length !== choices.length) {
    throw new Error(`${race.name}: incomplete choices`);
  }
  const chosen = [];
  for (const [index, choice] of choices.entries()) {
    const selected = selections[index];
    if (choice.kind === 'allocation') {
      if (!Array.isArray(selected) || selected.length !== choice.options.length
        || selected.some(value => !Number.isInteger(value) || value < 0)
        || selected.reduce((sum, value) => sum + value, 0) !== choice.count) {
        throw new Error(`${race.name}: invalid allocation for ${choice.label}`);
      }
      chosen.push({ modifiers: selected.flatMap((value, i) => value
        ? [{ target: choice.options[i].target, value }] : []) });
      continue;
    }
    if (!Array.isArray(selected) || selected.length !== choice.count || new Set(selected).size !== selected.length
      || selected.some(value => !Number.isInteger(value) || value < 0 || value >= choice.options.length)) {
      throw new Error(`${race.name}: invalid selection for ${choice.label}`);
    }
    chosen.push(...selected.map(value => choice.options[value]));
  }
  return {
    modifiers: [...modifiers, ...chosen.flatMap(option => option.modifiers ?? [])],
    skillGrants: [...skillGrants, ...chosen.flatMap(option => option.skillGrants ?? [])],
    descriptions: [effectDescription, ...chosen.map(option => option.effectDescription)].filter(Boolean),
  };
}

export async function resolveRaceChoices(actor, choices, packs) {
  return Promise.all(choices.map(async choice => {
    if (choice.kind !== 'grant') return choice;
    const pack = packs.get(choice.pack);
    if (!pack || pack.documentName !== 'Item') throw new Error(`Compendium not found: ${choice.pack}`);
    const index = await pack.getIndex({ fields: ['type'] });
    const names = new Map();
    for (const item of [...contents(index), ...contents(actor.items)]) {
      if (item.type === choice.type && item.name?.trim()) names.set(normName(item.name), item.name);
    }
    const options = [...names.values()].sort((a, b) => a.localeCompare(b)).map(name => ({
      label: name, skillGrants: [{ name, type: choice.type, pack: choice.pack, bonus: choice.bonus }],
    }));
    if (options.length < choice.count) throw new Error(`${choice.label}: not enough available ${choice.type} Items`);
    return { ...choice, options };
  }));
}

/** Prepare skill documents without changing the actor. */
export async function resolveRaceSkills(actor, grants, packs) {
  const resolved = new Map();
  for (const grant of grants) {
    const key = grantKey(grant);
    if (resolved.has(key)) continue;
    const type = grant.type ?? 'skill';
    const existing = contents(actor.items).filter(item => item.type === type && normName(item.name) === normName(grant.name));
    if (existing.length > 1) throw new Error(`Multiple owned Skills named "${grant.name}"; resolve the duplicate first`);
    if (existing.length) {
      resolved.set(key, { existing: existing[0] });
      continue;
    }
    const pack = packs.get(grant.pack);
    if (!pack || pack.documentName !== 'Item') throw new Error(`Skill compendium not found: ${grant.pack}`);
    const index = await pack.getIndex({ fields: ['type'] });
    const matches = contents(index).filter(item => item.type === type && normName(item.name) === normName(grant.name));
    if (matches.length !== 1) throw new Error(`Expected one ${grant.name} Skill in ${grant.pack}; found ${matches.length}`);
    const document = await pack.getDocument(idOf(matches[0]));
    if (!document || document.type !== type) throw new Error(`Unable to load ${grant.name} from ${grant.pack}`);
    resolved.set(key, { source: document });
  }
  return resolved;
}

export const appliedRaceEffects = actor => contents(actor.effects).filter(
  effect => Boolean(effect.flags?.[SYSTEM_ID]?.raceSource),
);

/** Apply one Race or Class, restoring prior actor data if any operation fails. */
export async function applyRace(actor, race, benefits, resolved, previousEffects = [], kind = 'race') {
  if (!['race', 'class'].includes(kind)) throw new Error(`Unknown benefit type: ${kind}`);
  const label = kind === 'race' ? 'Race' : 'Class';
  if (actor.type !== 'pc' || !actor.isOwner) throw new Error(`A ${label} can only be applied to an owned Crawler`);
  const originalItems = contents(actor.items);
  const originalIds = new Set(originalItems.map(idOf));
  const affectedSkillIds = new Set([...resolved.values()].filter(entry => entry.existing).map(entry => idOf(entry.existing)));
  const previous = { name: actor.system._source[kind], size: actor.system._source.size };
  const previousEffectData = previousEffects.map(effect => effect.toObject());
  const operationId = foundry.utils.randomID();

  try {
    for (const [key, entry] of resolved) {
      if (!entry.existing) {
        const data = game.items.fromCompendium(entry.source, { clearFolder: true, keepId: false });
        data.system.linkedItemIds = [];
        data.flags ??= {};
        data.flags[SYSTEM_ID] ??= {};
        data.flags[SYSTEM_ID][`${kind}Application`] = operationId;
        const [created] = await actor.createEmbeddedDocuments('Item', [data], { dccSkipGrantedAttack: true });
        if (!created) throw new Error(`Failed to create Skill: ${entry.source.name}`);
        entry.existing = created;
      }
      if (entry.existing.system.isAttack && !grantedAttack(entry.existing, actor.items)) {
        if (itemLinkState(entry.existing, actor.items).asymmetric.some(item => item.type === 'attack')) {
          throw new Error(`Skill "${entry.existing.name}" has a broken Attack link; repair it before applying the Race`);
        }
        await createGrantedAttack(entry.existing);
      }
      if (!idOf(entry.existing)) throw new Error(`Skill has no ID: ${key}`);
    }

    const changes = [
      ...benefits.modifiers.map(modifier => ({
        key: modifier.target, type: 'dcc', value: String(modifier.value), phase: 'initial',
      })),
      ...benefits.skillGrants.map(grant => ({
        key: `item-id:${idOf(resolved.get(grantKey(grant)).existing)}:rank`,
        type: 'dcc', value: String(grant.bonus), phase: 'initial',
      })),
      ...benefits.skillGrants.filter(grant => grant.manaCostPercent != null).map(grant => ({
        key: `item-id:${idOf(resolved.get(grantKey(grant)).existing)}:mana_cost`,
        type: 'dcc', value: `${grant.manaCostPercent}%`, phase: 'initial',
      })),
    ];
    const [effect] = await actor.createEmbeddedDocuments('ActiveEffect', [{
      name: race.name,
      img: race.img,
      description: benefits.descriptions.join(''),
      disabled: false,
      system: { changes },
      flags: { [SYSTEM_ID]: { [`${kind}Source`]: race.uuid, [`${kind}Application`]: operationId,
        ...(kind === 'race' ? { raceLayer: race.system.inheritRace ? 'overlay' : 'base' } : {}) } },
    }]);
    if (!effect) throw new Error(`Failed to create ${label} Buff: ${race.name}`);
    await actor.update({ [`system.${kind}`]: race.name,
      ...(kind === 'race' && race.system.size ? { 'system.size': race.system.size } : {}) });
    if (previousEffects.length) await actor.deleteEmbeddedDocuments('ActiveEffect', previousEffects.map(idOf));
    return effect;
  } catch (error) {
    try {
      const newEffects = contents(actor.effects)
        .filter(effect => effect.flags?.[SYSTEM_ID]?.[`${kind}Application`] === operationId).map(idOf);
      if (newEffects.length) await actor.deleteEmbeddedDocuments('ActiveEffect', newEffects);
      const currentItems = contents(actor.items);
      const newSkills = currentItems.filter(item => item.flags?.[SYSTEM_ID]?.[`${kind}Application`] === operationId);
      const skillIds = new Set([...affectedSkillIds, ...newSkills.map(idOf)]);
      const newItems = currentItems.filter(item => !originalIds.has(idOf(item)) && (
        newSkills.includes(item) || (item.type === 'attack' && skillIds.has(item.system.primarySkillId))
      )).map(idOf);
      if (newItems.length) await actor.deleteEmbeddedDocuments('Item', newItems, { dccLinkedCascade: true });
      const linkUpdates = [...affectedSkillIds].flatMap(id => {
        const item = actor.items.get(id);
        const links = item?.system.linkedItemIds ?? [];
        const remaining = links.filter(link => !newItems.includes(link));
        return remaining.length === links.length ? [] : [{ _id: id, 'system.linkedItemIds': remaining }];
      });
      if (linkUpdates.length) await actor.updateEmbeddedDocuments('Item', linkUpdates);
      const restore = {};
      if (actor.system._source[kind] === race.name) restore[`system.${kind}`] = previous.name;
      if (kind === 'race' && race.system.size && actor.system._source.size === race.system.size) {
        restore['system.size'] = previous.size;
      }
      if (Object.keys(restore).length) await actor.update(restore);
      const missingEffects = previousEffectData.filter(effect => !actor.effects.get(effect._id));
      if (missingEffects.length) await actor.createEmbeddedDocuments('ActiveEffect', missingEffects, { keepId: true });
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], `${label} application failed and rollback was incomplete: ${race.name}`);
    }
    throw error;
  }
}

const pendingActors = new WeakSet();

/** Coordinate confirmation, choices, preflight, and application for a drop. */
export async function dropRace(actor, race, { confirmReplace, choose, packs }) {
  if (!actor.isOwner || actor.type !== 'pc') throw new Error('A Race can only be applied to an owned Crawler');
  if (pendingActors.has(actor)) throw new Error('A Race is already being applied to this Crawler');
  pendingActors.add(actor);
  try {
    validateRace(race);
    const previousEffects = appliedRaceEffects(actor);
    const baseEffects = previousEffects.filter(effect => effect.flags?.[SYSTEM_ID]?.raceLayer !== 'overlay');
    const overlayEffects = previousEffects.filter(effect => effect.flags?.[SYSTEM_ID]?.raceLayer === 'overlay');
    if (baseEffects.length > 1 || overlayEffects.length > 1) {
      throw new Error('Multiple Race Buffs are applied; resolve them before replacing the Race');
    }

    if ((actor.system.race || previousEffects.length) && !await confirmReplace()) return null;
    const choices = await resolveRaceChoices(actor, race.system.choices, packs);
    const selections = choices.length ? await choose(choices) : [];
    if (selections === null) return null;
    const benefits = raceBenefits(race, selections, choices);
    const skills = await resolveRaceSkills(actor, benefits.skillGrants, packs);
    return await applyRace(actor, race, benefits, skills,
      race.system.inheritRace ? overlayEffects : previousEffects);
  } finally {
    pendingActors.delete(actor);
  }
}

export async function dropClass(actor, item, { confirmReplace, choose, packs }) {
  if (!actor.isOwner || actor.type !== 'pc') throw new Error('A Class can only be applied to an owned Crawler');
  if (pendingActors.has(actor)) throw new Error('A Race or Class is already being applied to this Crawler');
  pendingActors.add(actor);
  try {
    validateBenefitItem(item);
    const previousEffects = contents(actor.effects).filter(effect => Boolean(effect.flags?.[SYSTEM_ID]?.classSource));
    if (previousEffects.length > 1) throw new Error('Multiple Class Buffs are applied; resolve them before replacing the Class');
    if ((actor.system.class || previousEffects.length) && !await confirmReplace()) return null;
    const choices = await resolveRaceChoices(actor, item.system.choices, packs);
    const selections = choices.length ? await choose(choices) : [];
    if (selections === null) return null;
    const benefits = raceBenefits(item, selections, choices);
    const skills = await resolveRaceSkills(actor, benefits.skillGrants, packs);
    return await applyRace(actor, item, benefits, skills, previousEffects, 'class');
  } finally {
    pendingActors.delete(actor);
  }
}
