import { SYSTEM_ID } from '../config.mjs';
import { createGrantedAttack } from './item-links.mjs';
import { normName } from './items.mjs';

const pending = new WeakSet();
const itemsOf = actor => Array.from(actor.items?.contents ?? actor.items?.values() ?? []);
export const skillPotionBonus = item => item?.type === 'gear'
  ? item.flags?.[SYSTEM_ID]?.skillPotion?.rankBonus : undefined;

async function restoreUpdates(actor, changes, error) {
  try {
    const updates = [];
    for (const { id, field, before, after } of changes) {
      const current = actor.items.get(id);
      if (!current) throw new Error(`Item ${id} is no longer available for rollback.`);
      const value = current.system[field];
      if (value === after) updates.push({ _id: id, [`system.${field}`]: before });
      else if (value !== before) throw new Error(`Item ${id} changed during rollback.`);
    }
    if (updates.length) {
      const restored = await actor.updateEmbeddedDocuments('Item', updates);
      if (restored.length !== updates.length) throw new Error('Some Skill Potion changes could not be restored.');
    }
  } catch (rollbackError) {
    throw new AggregateError([error, rollbackError], 'Skill Potion use failed and rollback was incomplete.');
  }
}

/** Consume a potion after the player selects an owned, compendium, or custom Skill. */
export async function useSkillPotion(actor, potion, { choose, packs }) {
  if (!actor?.isOwner || !actor.items || actor.items.get(potion?.id) !== potion) {
    throw new Error('The Skill Potion must be owned by an editable Actor.');
  }
  if (pending.has(actor)) throw new Error('A Skill Potion is already being used on this Actor.');
  pending.add(actor);
  try {
    const bonus = skillPotionBonus(potion);
    if (!Number.isSafeInteger(bonus) || bonus < 1) throw new Error('The Skill Potion has an invalid rank bonus.');
    if (!Number.isSafeInteger(potion.system.quantity) || potion.system.quantity < 1) {
      throw new Error('There are no Skill Potions remaining.');
    }
    const choice = await choose(actor, packs);
    if (!choice) return null;
    if (!actor.isOwner || actor.items.get(potion.id) !== potion) throw new Error('The Skill Potion is no longer available.');
    if (!Number.isSafeInteger(potion.system.quantity) || potion.system.quantity < 1
      || skillPotionBonus(potion) !== bonus) throw new Error('The Skill Potion changed while selecting a Skill.');

    if (choice.kind === 'owned') {
      const skill = actor.items.get(choice.id);
      if (!skill || skill.type !== 'skill') throw new Error('The selected Skill is no longer available.');
      const rank = skill.system.rank;
      if (!Number.isSafeInteger(rank) || !Number.isSafeInteger(rank + bonus)) throw new Error('The selected Skill has an invalid Rank.');
      const quantity = potion.system.quantity;
      try {
        const updated = await actor.updateEmbeddedDocuments('Item', [
          { _id: skill.id, 'system.rank': rank + bonus },
          { _id: potion.id, 'system.quantity': quantity - 1 },
        ]);
        if (updated.length !== 2) throw new Error('The Skill Potion update was not fully applied.');
      } catch (error) {
        await restoreUpdates(actor, [
          { id: skill.id, field: 'rank', before: rank, after: rank + bonus },
          { id: potion.id, field: 'quantity', before: quantity, after: quantity - 1 },
        ], error);
        throw error;
      }
      return skill;
    }

    let data;
    if (choice.kind === 'compendium') {
      const pack = packs.get(choice.pack);
      if (!pack || pack.documentName !== 'Item') throw new Error('The selected Skill compendium is no longer available.');
      const source = await pack.getDocument(choice.id);
      if (!source || source.type !== 'skill') throw new Error('The selected compendium Skill is no longer available.');
      data = game.items.fromCompendium(source, { clearFolder: true, keepId: false });
    } else if (choice.kind === 'custom') {
      if (typeof choice.name !== 'string' || !choice.name.trim()) throw new Error('A custom Skill needs a name.');
      data = { type: 'skill', name: choice.name.trim(), system: {} };
    } else {
      throw new Error('Invalid Skill Potion selection.');
    }
    if (itemsOf(actor).some(item => item.type === 'skill' && normName(item.name) === normName(data.name))) {
      throw new Error(`"${data.name}" is already owned; select the existing Skill instead.`);
    }
    if (!actor.isOwner || actor.items.get(potion.id) !== potion
      || !Number.isSafeInteger(potion.system.quantity) || potion.system.quantity < 1
      || skillPotionBonus(potion) !== bonus) throw new Error('The Skill Potion changed while selecting a Skill.');
    data.system ??= {};
    data.system.rank = bonus;
    data.system.linkedItemIds = [];
    const originalIds = new Set(itemsOf(actor).map(item => item.id));
    const [skill] = await actor.createEmbeddedDocuments('Item', [data], { dccSkipGrantedAttack: true });
    if (!skill) throw new Error('The new Skill could not be created.');
    const quantity = potion.system.quantity;
    try {
      if (skill.system.isAttack) await createGrantedAttack(skill);
      const updated = await actor.updateEmbeddedDocuments('Item', [
        { _id: potion.id, 'system.quantity': quantity - 1 },
      ]);
      if (updated.length !== 1) throw new Error('The Skill Potion could not be consumed.');
    } catch (error) {
      try {
        await restoreUpdates(actor, [
          { id: potion.id, field: 'quantity', before: quantity, after: quantity - 1 },
        ], error);
        const newIds = itemsOf(actor).filter(item => !originalIds.has(item.id)
          && (item.id === skill.id || (item.type === 'attack' && item.system.primarySkillId === skill.id)))
          .map(item => item.id);
        const deleted = await actor.deleteEmbeddedDocuments('Item', newIds, { dccLinkedCascade: true });
        if (deleted.length !== newIds.length) throw new Error('Some newly created Items could not be removed.');
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], 'Skill Potion use failed and rollback was incomplete.');
      }
      throw error;
    }
    return skill;
  } finally {
    pending.delete(actor);
  }
}
