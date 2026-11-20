import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { ACCESSORY_CHOICES, ARMOR_RESISTANCES, dropConfigurableGear } from '../../module/rules/configurable-gear.mjs';
import { resolveModifiers } from '../../module/rules/modifiers.mjs';
import { isItemActive } from '../../module/rules/inventory.mjs';

const scope = 'dungeon-crawler-carl';
const template = kind => ({
  type: 'gear', inCompendium: true,
  getFlag: (_scope, key) => key === 'configurableGear' ? kind : undefined,
  data: {
    name: kind === 'armor' ? 'Mundane Armor' : 'Shiny Accessory',
    type: 'gear', system: { slot: 'pack', active: false, linkedItemIds: [] },
    effects: ['accessory', 'qualityArmor'].includes(kind) ? [{
      flags: { [scope]: { configurableGearBonus: true } }, system: { changes: [] },
    }] : [],
    flags: { [scope]: { configurableGear: kind } },
  },
});

function actorWith(...initial) {
  const items = new Map(initial.map(item => [item.id, structuredClone(item)]));
  Object.defineProperty(items, 'contents', { get: () => [...items.values()] });
  let nextId = 0;
  return {
    isOwner: true, items,
    createEmbeddedDocuments: vi.fn(async (_type, data) => data.map(entry => {
      const item = { ...structuredClone(entry), id: `created${++nextId}` };
      items.set(item.id, item);
      return item;
    })),
    updateEmbeddedDocuments: vi.fn(async (_type, updates) => updates.map(update => {
      const item = items.get(update._id);
      for (const [key, value] of Object.entries(update)) {
        if (key.startsWith('system.')) item.system[key.slice(7)] = value;
      }
      return item;
    })),
    deleteEmbeddedDocuments: vi.fn(async (_type, ids) => ids.map(id => {
      const item = items.get(id);
      items.delete(id);
      return item;
    })),
  };
}

const options = (selection, packs = new Map()) => ({
  choose: async () => selection, packs, canEdit: () => true,
});
const sourcePack = name => new Map([['dungeon-crawler-carl-core-rulebook.skills', {
  documentName: 'Item',
  getIndex: async () => [{ _id: 'source', type: 'skill', name }],
  getDocument: async () => ({
    type: 'skill', name, data: { name, type: 'skill', system: { rank: 0, linkedItemIds: [] } },
  }),
}]]);

describe('configurable starting Gear', () => {
  beforeEach(() => {
    game.items = { fromCompendium: vi.fn(source => structuredClone(source.data)) };
    vi.spyOn(game.i18n, 'localize').mockImplementation(key => key.split('.').at(-1));
    vi.spyOn(game.i18n, 'format').mockImplementation((key, values) => `${key} ${Object.values(values).join(' ')}`);
    foundry.utils.escapeHTML = text => text;
  });
  afterEach(() => vi.restoreAllMocks());

  it('equips armor and moves every existing occupant to the pack, deactivating them', async () => {
    const actor = actorWith(
      { id: 'old', type: 'gear', system: { slot: 'head', active: true } },
      { id: 'other', type: 'gear', system: { slot: 'head', active: false } },
    );
    const gear = await dropConfigurableGear(actor, template('armor'), options({ slot: 'head' }));
    expect(gear.system.slot).toBe('head');
    expect(actor.items.get('old').system).toMatchObject({ slot: 'pack', active: false });
    expect(actor.items.get('other').system).toMatchObject({ slot: 'pack', active: false });
    expect(isItemActive(gear)).toBe(true);
    expect(isItemActive(actor.items.get('old'))).toBe(false);
  });

  it.each(ACCESSORY_CHOICES.map((pair, index) => [index, pair]))(
    'applies accessory choice %i to the existing Skill without changing its base Rank',
    async (index, pair) => {
      const actor = actorWith({ id: 'owned', type: 'skill', name: pair.skill, system: { rank: 2 } });
      const gear = await dropConfigurableGear(actor, template('accessory'), options({ slot: 'torso', choice: index }));
      const changes = gear.effects[0].system.changes;
      const modifiers = resolveModifiers(changes.map(change => ({ target: change.key, value: change.value })), actor.items.contents);
      expect(modifiers.bonus[pair.stat]).toBe(3);
      expect(modifiers.itemBonus.owned.rank).toBe(3);
      expect(actor.items.get('owned').system.rank).toBe(2);
      expect(actor.items.contents.filter(item => item.type === 'skill')).toHaveLength(1);
    },
  );

  it('adds a missing Skill from the compendium at Rank 0 and targets its new ID', async () => {
    const actor = actorWith();
    const gear = await dropConfigurableGear(actor, template('accessory'),
      options({ slot: 'hands', choice: 0 }, sourcePack('Climbing')));
    const skill = actor.items.contents.find(item => item.type === 'skill');
    expect(skill).toMatchObject({ name: 'Climbing', system: { rank: 0 } });
    expect(gear.effects[0].system.changes[1].key).toBe(`item-id:${skill.id}:rank`);
  });

  it('preserves the actor on cancellation or a missing Skill compendium', async () => {
    const actor = actorWith({ id: 'old', type: 'gear', system: { slot: 'head', active: true } });
    expect(await dropConfigurableGear(actor, template('armor'), options(null))).toBeNull();
    await expect(dropConfigurableGear(actor, template('accessory'), options({ slot: 'head', choice: 0 })))
      .rejects.toThrow('Skill compendium not found');
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.items.get('old').system).toEqual({ slot: 'head', active: true });
  });

  it('restores displaced gear and removes newly created items after an incomplete update', async () => {
    const actor = actorWith({ id: 'old', type: 'gear', system: { slot: 'head', active: true } });
    actor.updateEmbeddedDocuments.mockImplementationOnce(async (_type, updates) => {
      const old = actor.items.get(updates[0]._id);
      old.system.slot = 'pack';
      old.system.active = false;
      return [old];
    });
    await expect(dropConfigurableGear(actor, template('accessory'),
      options({ slot: 'head', choice: 0 }, sourcePack('Climbing')))).rejects.toThrow('incomplete');
    expect(actor.items.contents).toHaveLength(1);
    expect(actor.items.get('old').system).toEqual({ slot: 'head', active: true });
  });

  it('does not overwrite a concurrent slot change before the equip update', async () => {
    const actor = actorWith({ id: 'old', type: 'gear', system: { slot: 'head', active: true } });
    const create = actor.createEmbeddedDocuments;
    actor.createEmbeddedDocuments = vi.fn(async (...args) => {
      const created = await create(...args);
      actor.items.get('old').system = { slot: 'pack', active: false };
      return created;
    });
    await expect(dropConfigurableGear(actor, template('armor'), options({ slot: 'head' })))
      .rejects.toThrow('slot changed');
    expect(actor.items.contents).toHaveLength(1);
    expect(actor.items.get('old').system).toEqual({ slot: 'pack', active: false });
    expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it('reconfigures an actor-owned accessory copy without changing the source', async () => {
    const actor = actorWith({ id: 'owned', type: 'skill', name: 'Survival', system: { rank: 1 } });
    const source = template('accessory');
    source.inCompendium = false;
    source.toObject = () => structuredClone(source.data);
    source.data.effects[0].system.changes = [{ key: 'item-id:otherActorSkill:rank', value: '+3' }];
    const gear = await dropConfigurableGear(actor, source, options({ slot: 'legs', choice: 3 }));
    expect(gear.effects[0].system.changes[1].key).toBe('item-id:owned:rank');
    expect(source.data.effects[0].system.changes[0].key).toBe('item-id:otherActorSkill:rank');
  });

  it('creates Silver armor with +2 DR and an item-linked Anti-Piercing Buff', async () => {
    const gear = await dropConfigurableGear(actorWith(), template('qualityArmor'),
      options({ slot: 'arms', quality: 'silver' }));
    expect(gear.effects[0].system.changes).toContainEqual(expect.objectContaining({ key: 'damage_resistance', value: '+2' }));
    expect(gear.effects[1]).toMatchObject({
      name: 'AntiPiercing', transfer: true,
      flags: { [scope]: { showInBuffs: true, qualityArmorBuff: true } },
    });
  });

  it.each(ARMOR_RESISTANCES)('creates Gold armor with a %s Resistance Buff', async resistance => {
    const gear = await dropConfigurableGear(actorWith(), template('qualityArmor'),
      options({ slot: 'torso', quality: 'gold', resistance }));
    expect(gear.effects[0].system.changes).toContainEqual(expect.objectContaining({ key: 'damage_resistance', value: '+3' }));
    expect(gear.effects[1]).toMatchObject({
      name: `DCC.QualityArmor.ResistanceName ${resistance}`, transfer: true, disabled: false,
      flags: { [scope]: { category: 'buff', showInBuffs: true } },
    });
    expect(gear.effects[1].description).toContain(resistance);
  });

  it.each(['Catcher', 'Taunt'])('creates Platinum armor and targets existing %s without changing base Rank', async skillName => {
    const actor = actorWith({ id: 'skill', type: 'skill', name: skillName, system: { rank: 2 } });
    const gear = await dropConfigurableGear(actor, template('qualityArmor'),
      options({ slot: 'head', quality: 'platinum', skill: skillName }));
    expect(gear.effects).toHaveLength(1);
    expect(gear.effects[0].system.changes).toEqual([
      expect.objectContaining({ key: 'damage_resistance', value: '+4' }),
      expect.objectContaining({ key: 'constitution', value: '+5' }),
      expect.objectContaining({ key: 'item-id:skill:rank', value: '+3' }),
    ]);
    expect(actor.items.get('skill').system.rank).toBe(2);
  });

  it('adds a missing Platinum Skill at Rank 0 and rejects invalid resistance', async () => {
    const actor = actorWith();
    const gear = await dropConfigurableGear(actor, template('qualityArmor'),
      options({ slot: 'head', quality: 'platinum', skill: 'Taunt' }, sourcePack('Taunt')));
    const skill = actor.items.contents.find(item => item.type === 'skill');
    expect(skill.system.rank).toBe(0);
    expect(gear.effects[0].system.changes[2].key).toBe(`item-id:${skill.id}:rank`);
    await expect(dropConfigurableGear(actor, template('qualityArmor'),
      options({ slot: 'head', quality: 'gold', resistance: 'Fire' }))).rejects.toThrow('valid Gear slot');
    expect(gear.system.slot).toBe('head');
  });

  it('replaces an old armor Buff when a copy is configured for a different quality', async () => {
    const actor = actorWith();
    const source = template('qualityArmor');
    source.inCompendium = false;
    source.toObject = () => structuredClone(source.data);
    source.data.effects.push({ flags: { [scope]: { showInBuffs: true, qualityArmorBuff: true } } });
    const gear = await dropConfigurableGear(actor, source,
      options({ slot: 'legs', quality: 'gold', resistance: 'Ice' }));
    expect(gear.effects).toHaveLength(2);
    expect(gear.effects[1].name).toContain('Ice');
    expect(source.data.effects).toHaveLength(2);
  });
});
