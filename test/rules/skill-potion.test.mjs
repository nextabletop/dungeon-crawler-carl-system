import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSkillPotion } from '../../module/rules/skill-potion.mjs';

const potion = (bonus = 3, quantity = 2) => ({
  id: 'potion', type: 'gear', name: 'Skill Potion', system: { quantity },
  flags: { 'dungeon-crawler-carl': { skillPotion: { rankBonus: bonus } } },
});
const skill = (id, name, rank = 0) => ({ id, name, type: 'skill', system: { rank, linkedItemIds: [] } });
function makeActor(...initial) {
  const items = new Map(initial.map(item => [item.id, item]));
  Object.defineProperty(items, 'contents', { get: () => [...items.values()] });
  const actor = {
    isOwner: true, items,
    updateEmbeddedDocuments: vi.fn(async (_type, updates) => updates.map(update => {
      const item = items.get(update._id);
      for (const [field, value] of Object.entries(update)) {
        if (field.startsWith('system.')) item.system[field.slice(7)] = value;
      }
      return item;
    })),
    createEmbeddedDocuments: vi.fn(async (_type, [data]) => {
      const created = { ...structuredClone(data), id: 'new', parent: actor };
      created.delete = vi.fn(async () => items.delete(created.id));
      items.set(created.id, created);
      return [created];
    }),
    deleteEmbeddedDocuments: vi.fn(async (_type, ids) => ids.map(id => {
      const item = items.get(id);
      items.delete(id);
      return item;
    })),
  };
  for (const item of initial) item.parent = actor;
  return actor;
}

describe('Skill Potions', () => {
  beforeEach(() => {
    game.items = { fromCompendium: vi.fn(source => structuredClone(source.data)) };
  });

  it('permanently increases an owned custom Skill and consumes one potion', async () => {
    const gear = potion();
    const custom = skill('custom', 'My custom Skill', 4);
    const actor = makeActor(gear, custom);
    expect(await useSkillPotion(actor, gear, {
      choose: async () => ({ kind: 'owned', id: custom.id }), packs: new Map(),
    })).toBe(custom);
    expect(custom.system.rank).toBe(7);
    expect(gear.system.quantity).toBe(1);
    expect(actor.updateEmbeddedDocuments).toHaveBeenCalledOnce();
  });

  it('adds a chosen compendium Skill at the potion Rank', async () => {
    const gear = potion(2, 1);
    const actor = makeActor(gear);
    const source = { type: 'skill', data: { name: 'Climbing', type: 'skill',
      system: { rank: 0, linkedItemIds: ['stale'], description: 'Climb.' } } };
    const packs = new Map([['core.skills', { documentName: 'Item', getDocument: vi.fn(async () => source) }]]);
    const result = await useSkillPotion(actor, gear, {
      choose: async () => ({ kind: 'compendium', pack: 'core.skills', id: 'climbing' }), packs,
    });
    expect(result.name).toBe('Climbing');
    expect(result.system).toEqual({ rank: 2, linkedItemIds: [], description: 'Climb.' });
    expect(gear.system.quantity).toBe(0);
    expect(game.items.fromCompendium).toHaveBeenCalledWith(source, { clearFolder: true, keepId: false });
  });

  it('creates a new custom Skill at the potion Rank', async () => {
    const gear = potion(5);
    const actor = makeActor(gear);
    const result = await useSkillPotion(actor, gear, {
      choose: async () => ({ kind: 'custom', name: '  My New Skill  ' }), packs: new Map(),
    });
    expect(result.name).toBe('My New Skill');
    expect(result.system.rank).toBe(5);
    expect(gear.system.quantity).toBe(1);
  });

  it('creates a linked Attack when the new compendium Skill grants one', async () => {
    const gear = potion(2, 1);
    const actor = makeActor(gear);
    let id = 0;
    actor.createEmbeddedDocuments.mockImplementation(async (_type, [data]) => {
      const created = { ...structuredClone(data), id: `new-${++id}`, parent: actor };
      created.system.linkedItemIds ??= [];
      created.delete = vi.fn(async () => actor.items.delete(created.id));
      actor.items.set(created.id, created);
      return [created];
    });
    const source = { type: 'skill', data: { name: 'Bow', type: 'skill', system: {
      isAttack: true, stat: 'dexterity', rank: 0, attackDefaults: { die: '1d6', damageType: 'Piercing' },
    } } };
    const packs = new Map([['skills', { documentName: 'Item', getDocument: vi.fn(async () => source) }]]);
    const result = await useSkillPotion(actor, gear, {
      choose: async () => ({ kind: 'compendium', pack: 'skills', id: 'bow' }), packs,
    });
    const attack = actor.items.get(result.system.linkedItemIds[0]);
    expect(attack.type).toBe('attack');
    expect(attack.system).toMatchObject({ primarySkillId: result.id, die: '1d6', damageType: 'Piercing' });
    expect(attack.system.linkedItemIds).toEqual([result.id]);
    expect(gear.system.quantity).toBe(0);
  });

  it('does nothing on cancellation and rejects exhausted potions', async () => {
    const gear = potion();
    const actor = makeActor(gear);
    expect(await useSkillPotion(actor, gear, { choose: async () => null, packs: new Map() })).toBeNull();
    expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
    gear.system.quantity = 0;
    await expect(useSkillPotion(actor, gear, { choose: async () => null, packs: new Map() }))
      .rejects.toThrow('no Skill Potions remaining');
  });

  it.each([null, 0, -1, 1.5])('rejects invalid bonus %s before selection', async bonus => {
    const gear = potion(bonus);
    const actor = makeActor(gear);
    const choose = vi.fn();
    await expect(useSkillPotion(actor, gear, { choose, packs: new Map() }))
      .rejects.toThrow('invalid rank bonus');
    expect(choose).not.toHaveBeenCalled();
    expect(gear.system.quantity).toBe(2);
  });

  it('rejects new Skills with an already-owned name', async () => {
    const gear = potion();
    const actor = makeActor(gear, skill('old', 'Climbing'));
    await expect(useSkillPotion(actor, gear, {
      choose: async () => ({ kind: 'custom', name: ' climbing ' }), packs: new Map(),
    })).rejects.toThrow('already owned');
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(gear.system.quantity).toBe(2);
  });

  it('rolls back a partial update to an owned Skill', async () => {
    const gear = potion();
    const custom = skill('custom', 'Custom', 4);
    const actor = makeActor(gear, custom);
    actor.updateEmbeddedDocuments.mockImplementationOnce(async () => {
      custom.system.rank = 7;
      return [custom];
    });
    await expect(useSkillPotion(actor, gear, {
      choose: async () => ({ kind: 'owned', id: custom.id }), packs: new Map(),
    })).rejects.toThrow('not fully applied');
    expect(custom.system.rank).toBe(4);
    expect(gear.system.quantity).toBe(2);
  });

  it('removes a newly created Skill when consuming the potion fails', async () => {
    const gear = potion();
    const actor = makeActor(gear);
    actor.updateEmbeddedDocuments.mockRejectedValueOnce(new Error('Update failed'));
    await expect(useSkillPotion(actor, gear, {
      choose: async () => ({ kind: 'custom', name: 'New Skill' }), packs: new Map(),
    })).rejects.toThrow('Update failed');
    expect(actor.items.has('new')).toBe(false);
    expect(gear.system.quantity).toBe(2);
  });

  it('prevents a second use while the selection is open', async () => {
    const gear = potion();
    const actor = makeActor(gear);
    let finish;
    const first = useSkillPotion(actor, gear, { choose: () => new Promise(resolve => { finish = resolve; }), packs: new Map() });
    await expect(useSkillPotion(actor, gear, { choose: async () => null, packs: new Map() }))
      .rejects.toThrow('already being used');
    finish(null);
    await first;
  });
});
