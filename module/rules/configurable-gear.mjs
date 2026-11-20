import { GEAR_SLOTS, SYSTEM_ID } from '../config.mjs';
import { resolveRaceSkills } from './race.mjs';
import { normName } from './items.mjs';

export const ACCESSORY_CHOICES = Object.freeze([
  { stat: 'strength', skill: 'Climbing' },
  { stat: 'dexterity', skill: 'Lockpicking' },
  { stat: 'intelligence', skill: 'Fabricate' },
  { stat: 'constitution', skill: 'Survival' },
  { stat: 'charisma', skill: 'Streetwise' },
]);
export const ARMOR_QUALITIES = Object.freeze(['silver', 'gold', 'platinum']);
export const ARMOR_RESISTANCES = Object.freeze(['Acid', 'Electric', 'Force', 'Holy', 'Ice', 'Necrotic', 'Psychic', 'Sonic']);
export const ARMOR_SKILLS = Object.freeze(['Catcher', 'Taunt']);

const SKILL_PACK = 'dungeon-crawler-carl-core-rulebook.skills';
const contents = collection => Array.from(collection?.contents ?? collection?.values() ?? []);
const pending = new WeakSet();

/** Configure and equip a starting-loot item, restoring the actor if application fails. */
export async function dropConfigurableGear(actor, item, { choose, packs, canEdit }) {
  const kind = item.getFlag(SYSTEM_ID, 'configurableGear');
  if (!['armor', 'accessory', 'qualityArmor'].includes(kind)) throw new Error('Invalid configurable Gear.');
  if (!actor.isOwner || !canEdit()) throw new Error('The Actor is not editable.');
  if (pending.has(actor)) throw new Error('Another configurable Gear drop is in progress.');
  pending.add(actor);
  try {
    const selection = await choose(kind);
    if (!selection) return null;
    if (!GEAR_SLOTS.includes(selection.slot)
      || (kind === 'accessory' && (!Number.isInteger(selection.choice) || !ACCESSORY_CHOICES[selection.choice]))
      || (kind === 'qualityArmor' && (!ARMOR_QUALITIES.includes(selection.quality)
        || (selection.quality === 'gold' && !ARMOR_RESISTANCES.includes(selection.resistance))
        || (selection.quality === 'platinum' && !ARMOR_SKILLS.includes(selection.skill))))) {
      throw new Error('Select a valid Gear slot and accessory bonus.');
    }
    if (!actor.isOwner || !canEdit()) throw new Error('The Actor is no longer editable.');

    const pair = kind === 'accessory' ? ACCESSORY_CHOICES[selection.choice] : null;
    const skillName = pair?.skill ?? (selection.quality === 'platinum' && kind === 'qualityArmor' ? selection.skill : null);
    const resolved = skillName && await resolveRaceSkills(actor, [{
      name: skillName, pack: SKILL_PACK, bonus: 3,
    }], packs);
    const skillEntry = resolved && [...resolved.values()][0];
    if (!actor.isOwner || !canEdit()) throw new Error('The Actor is no longer editable.');

    const operationId = foundry.utils.randomID();
    const originalSlots = contents(actor.items)
      .filter(existing => existing.system?.slot === selection.slot)
      .map(existing => ({ id: existing.id, slot: existing.system.slot, active: existing.system.active }));
    let slotUpdateAttempted = false;
    try {
      let skill = skillEntry?.existing;
      if (skillEntry?.source) {
        if (contents(actor.items).some(owned => owned.type === 'skill' && normName(owned.name) === normName(skillName))) {
          throw new Error(`The ${skillName} Skill changed during the drop. Try again.`);
        }
        const data = game.items.fromCompendium(skillEntry.source, { clearFolder: true, keepId: false });
        data.system.rank = 0;
        data.system.linkedItemIds = [];
        data.flags ??= {};
        data.flags[SYSTEM_ID] ??= {};
        data.flags[SYSTEM_ID].configurableGearApplication = operationId;
        [skill] = await actor.createEmbeddedDocuments('Item', [data], { dccSkipGrantedAttack: true });
        if (!skill?.id) throw new Error(`Failed to create Skill: ${skillName}`);
      }
      if (skillName && actor.items.get(skill?.id) !== skill) throw new Error(`The ${skillName} Skill is no longer available.`);

      const data = item.inCompendium
        ? game.items.fromCompendium(item, { clearFolder: true, keepId: false })
        : item.toObject();
      delete data._id;
      data.system.slot = 'pack';
      data.system.active = false;
      data.system.linkedItemIds = [];
      data.flags ??= {};
      data.flags[SYSTEM_ID] ??= {};
      data.flags[SYSTEM_ID].configurableGearApplication = operationId;
      if (pair) {
        const effects = (data.effects ?? []).filter(effect => effect.flags?.[SYSTEM_ID]?.configurableGearBonus);
        if (effects.length !== 1 || !skill?.id) throw new Error('The Shiny Accessory bonus is invalid.');
        effects[0].system.changes = [
          { key: pair.stat, type: 'dcc', value: '+3', phase: 'initial', priority: 20 },
          { key: `item-id:${skill.id}:rank`, type: 'dcc', value: '+3', phase: 'initial', priority: 20 },
        ];
      }
      if (kind === 'qualityArmor') {
        const effects = (data.effects ?? []).filter(effect => effect.flags?.[SYSTEM_ID]?.configurableGearBonus);
        if (effects.length !== 1) throw new Error('The Quality Armor bonus is invalid.');
        const dr = { silver: 2, gold: 3, platinum: 4 }[selection.quality];
        effects[0].system.changes = [
          { key: 'damage_resistance', type: 'dcc', value: `+${dr}`, phase: 'initial', priority: 20 },
          ...(selection.quality === 'platinum' ? [
            { key: 'constitution', type: 'dcc', value: '+5', phase: 'initial', priority: 20 },
            { key: `item-id:${skill.id}:rank`, type: 'dcc', value: '+3', phase: 'initial', priority: 20 },
          ] : []),
        ];
        data.effects = data.effects.filter(effect => !effect.flags?.[SYSTEM_ID]?.qualityArmorBuff);
        if (selection.quality !== 'platinum') {
          const gold = selection.quality === 'gold';
          const name = gold
            ? game.i18n.format('DCC.QualityArmor.ResistanceName', { type: selection.resistance })
            : game.i18n.localize('DCC.QualityArmor.AntiPiercing');
          const description = gold
            ? game.i18n.format('DCC.QualityArmor.ResistanceDescription', { type: selection.resistance })
            : game.i18n.localize('DCC.QualityArmor.AntiPiercingDescription');
          data.effects.push({
            name, img: 'icons/svg/upgrade.svg', transfer: true, disabled: false,
            description: `<p>${foundry.utils.escapeHTML(description)}</p>`,
            system: { changes: [] },
            flags: { [SYSTEM_ID]: { category: 'buff', buffType: 'internal', showInBuffs: true, qualityArmorBuff: true } },
          });
        }
        data.name = game.i18n.format('DCC.QualityArmor.Name', {
          quality: game.i18n.localize(`DCC.QualityArmor.${selection.quality}`),
        });
      }
      const [gear] = await actor.createEmbeddedDocuments('Item', [data]);
      if (!gear?.id) throw new Error('Failed to create configurable Gear.');
      if (!actor.isOwner || !canEdit()) throw new Error('The Actor is no longer editable.');
      if (skillName && actor.items.get(skill.id) !== skill) throw new Error(`The ${skillName} Skill is no longer available.`);
      const currentOccupants = contents(actor.items).filter(existing => existing.system?.slot === selection.slot);
      if (currentOccupants.length !== originalSlots.length
        || originalSlots.some(old => !currentOccupants.some(current =>
          current.id === old.id && current.system.active === old.active))) {
        throw new Error('The selected Gear slot changed during the drop. Try again.');
      }
      const updates = [
        ...originalSlots.map(old => ({ _id: old.id, 'system.slot': 'pack', 'system.active': false })),
        { _id: gear.id, 'system.slot': selection.slot },
      ];
      slotUpdateAttempted = true;
      const updated = await actor.updateEmbeddedDocuments('Item', updates);
      if (updated.length !== updates.length) throw new Error('The Gear slot update was incomplete.');
      return gear;
    } catch (error) {
      try {
        const restores = [];
        for (const old of slotUpdateAttempted ? originalSlots : []) {
          const current = actor.items.get(old.id);
          if (!current) throw new Error('An existing Gear item disappeared during rollback.');
          if (current.system.slot === 'pack' && current.system.active === false) {
            restores.push({ _id: old.id, 'system.slot': old.slot, 'system.active': old.active });
          } else if (current.system.slot !== old.slot || current.system.active !== old.active) {
            throw new Error('An existing Gear item changed during rollback.');
          }
        }
        if (restores.length) {
          const restored = await actor.updateEmbeddedDocuments('Item', restores);
          if (restored.length !== restores.length) throw new Error('Gear slot rollback was incomplete.');
        }
        const createdIds = contents(actor.items)
          .filter(created => created.flags?.[SYSTEM_ID]?.configurableGearApplication === operationId)
          .map(created => created.id);
        if (createdIds.length) {
          const deleted = await actor.deleteEmbeddedDocuments('Item', createdIds, { dccLinkedCascade: true });
          if (deleted.length !== createdIds.length) throw new Error('New Gear or Skill rollback was incomplete.');
        }
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'Configurable Gear drop failed and rollback was incomplete.');
      }
      throw error;
    }
  } finally {
    pending.delete(actor);
  }
}
