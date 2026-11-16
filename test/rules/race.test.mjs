import { describe, expect, it, vi } from 'vitest';
import { dropClass, dropRace } from '../../module/rules/race.mjs';
import { grantedAttack } from '../../module/rules/item-links.mjs';
import { resolveModifiers } from '../../module/rules/modifiers.mjs';
import { deriveCreature } from '../../module/rules/derive.mjs';

const SYSTEM = 'dungeon-crawler-carl';
const PACK = 'core.skills';
game.items = { fromCompendium: document => document.toObject() };
const race = (overrides = {}) => ({
  name: 'Amazonian', uuid: 'Compendium.core.races.amazonian', img: 'race.svg',
  system: {
    size: 'M', effectDescription: '<p>Training coupon</p>',
    modifiers: [
      { target: 'strength', value: '6' },
      { target: 'dexterity', value: '3' },
      { target: 'damage_resistance', value: '2' },
    ],
    skillGrants: ['Bow', 'Endurance', 'Pugilism'].map(name => ({ name, pack: PACK, bonus: 2 })),
    choices: [], ...overrides,
  },
});
const source = (name, isAttack = false, die = '') => ({
  name, type: 'skill',
  toObject: () => ({
    name, type: 'skill', system: {
      rank: 0, stat: 'dexterity', isAttack, linkedItemIds: [],
      attackDefaults: { die, damageStat: 'strength', damageType: 'Piercing' },
    },
  }),
});
const packOf = entries => ({
  documentName: 'Item',
  getIndex: vi.fn(async () => entries.map((entry, index) => ({ _id: String(index), name: entry.name, type: entry.type }))),
  getDocument: vi.fn(async id => entries[Number(id)]),
});
const collection = () => ({
  contents: [],
  get(id) { return this.contents.find(document => document.id === id); },
});

function actorWith(...existing) {
  let next = 0;
  const items = collection();
  const effects = collection();
  const actor = {
    type: 'pc', isOwner: true, items, effects,
    system: { race: '', class: '', size: 'S', _source: { race: '', class: '', size: 'S' } },
    update: vi.fn(async data => {
      for (const [path, value] of Object.entries(data)) {
        const key = path.slice('system.'.length);
        actor.system[key] = value;
        actor.system._source[key] = value;
      }
    }),
    createEmbeddedDocuments: vi.fn(async (type, documents, options = {}) => documents.map(data => {
      const document = {
        ...structuredClone(data), id: options.keepId ? data._id : `new-${++next}`, parent: actor,
        toObject() {
          const { parent, toObject, id, ...rest } = this;
          return { ...structuredClone(rest), _id: id };
        },
      };
      document.system ??= {};
      if (type === 'Item') document.system.linkedItemIds ??= [];
      (type === 'Item' ? items : effects).contents.push(document);
      return document;
    })),
    updateEmbeddedDocuments: vi.fn(async (_type, updates) => {
      for (const update of updates) {
        const item = items.get(update._id);
        if (Object.hasOwn(update, 'system.linkedItemIds')) item.system.linkedItemIds = update['system.linkedItemIds'];
        if (Object.hasOwn(update, 'system.isAttack')) item.system.isAttack = update['system.isAttack'];
      }
    }),
    deleteEmbeddedDocuments: vi.fn(async (type, ids) => {
      const collection = type === 'Item' ? items : effects;
      collection.contents = collection.contents.filter(doc => !ids.includes(doc.id));
    }),
  };
  for (const item of existing) {
    item.parent = actor;
    items.contents.push(item);
  }
  return actor;
}

const packs = entries => new Map([[PACK, packOf(entries)]]);
const allSkills = () => [source('Bow', true, '1d6'), source('Endurance'), source('Pugilism', true, '1d2')];
const options = overrides => ({ packs: packs(allSkills()), confirmReplace: vi.fn(async () => true), choose: vi.fn(), ...overrides });

describe('Race drops', () => {
  it('creates Skills and linked Attacks and applies field and stable-ID Rank modifiers', async () => {
    const actor = actorWith();
    const effect = await dropRace(actor, race(), options());
    expect(actor.system).toMatchObject({ race: 'Amazonian', size: 'M' });
    expect(effect.description).toBe('<p>Training coupon</p>');
    const skills = actor.items.contents.filter(item => item.type === 'skill');
    expect(skills.map(skill => skill.name)).toEqual(['Bow', 'Endurance', 'Pugilism']);
    expect(skills.every(skill => skill.system.rank === 0)).toBe(true);
    expect(grantedAttack(skills[0], actor.items).system.die).toBe('1d6');
    expect(grantedAttack(skills[1], actor.items)).toBeNull();
    expect(grantedAttack(skills[2], actor.items).system.die).toBe('1d2');
    const changes = effect.system.changes.map(change => ({ target: change.key, value: change.value }));
    const resolved = resolveModifiers(changes, actor.items.contents);
    expect(resolved.bonus).toMatchObject({ strength: 6, dexterity: 3, damage_resistance: 2 });
    for (const skill of skills) expect(resolved.itemBonus[skill.id].rank).toBe(2);
    expect(resolved.unresolved).toEqual([]);
    const derived = deriveCreature({ type: 'pc', items: actor.items.contents, modifiers: changes });
    for (const skill of skills) expect(derived.items[skill.id].rankEffective).toBe(2);
    expect(derived.items[grantedAttack(skills[0], actor.items).id].rank).toBe(2);
  });

  it('reuses an existing Skill and linked Attack, and replaces only the old Race Buff', async () => {
    const bow = { id: 'bow', name: 'Bow', type: 'skill', system: { rank: 4, isAttack: true, linkedItemIds: ['attack'] } };
    const attack = { id: 'attack', name: 'Bow', type: 'attack', system: { linkedItemIds: ['bow'] } };
    const actor = actorWith(bow, attack);
    actor.system.race = actor.system._source.race = 'Old Race';
    actor.effects.contents.push({ id: 'old', name: 'Old Race', flags: { [SYSTEM]: { raceSource: 'old' } }, toObject: () => ({ _id: 'old' }) });
    actor.effects.contents.push({ id: 'unrelated', flags: {} });
    const controls = options();
    const effect = await dropRace(actor, race(), controls);
    expect(controls.confirmReplace).toHaveBeenCalledOnce();
    expect(actor.items.contents.filter(item => item.name === 'Bow')).toEqual([bow, attack]);
    expect(bow.system.rank).toBe(4);
    expect(actor.effects.contents.map(doc => doc.id)).toEqual(['unrelated', effect.id]);
    expect(effect.system.changes).toContainEqual({ key: 'item-id:bow:rank', type: 'dcc', value: '2', phase: 'initial' });
  });

  it('creates a missing linked Attack for an existing Attack Skill', async () => {
    const bow = { id: 'bow', name: 'Bow', type: 'skill', system: { rank: 3, isAttack: true, linkedItemIds: [] } };
    const actor = actorWith(bow);
    await dropRace(actor, race(), options());
    expect(grantedAttack(bow, actor.items)).not.toBeNull();
    expect(bow.system.rank).toBe(3);
  });

  it('cancels replacement or choices without actor writes', async () => {
    const actor = actorWith();
    actor.system.race = actor.system._source.race = 'Old Race';
    await dropRace(actor, race(), options({ confirmReplace: async () => false }));
    const withChoice = race({ choices: [{ label: 'Benefit', count: 1, options: [{ label: 'A' }] }] });
    await dropRace(actor, withChoice, options({ choose: async () => null }));
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.update).not.toHaveBeenCalled();
    expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it('applies only the selected benefits', async () => {
    const actor = actorWith();
    const withChoice = race({
      modifiers: [], skillGrants: [],
      choices: [{ label: 'Benefit', count: 1, options: [
        { label: 'Strong', modifiers: [{ target: 'strength', value: '2' }] },
        { label: 'Fast', modifiers: [{ target: 'dexterity', value: '4' }], effectDescription: '<p>Fast</p>' },
      ] }],
    });
    const effect = await dropRace(actor, withChoice, options({ choose: async () => [[1]] }));
    expect(effect.system.changes).toEqual([{ key: 'dexterity', type: 'dcc', value: '4', phase: 'initial' }]);
    expect(effect.description).toContain('<p>Fast</p>');
  });

    it('distributes exactly six stat points and rejects invalid allocations before writes', async () => {
      const actor = actorWith();
      const city = race({ modifiers: [], skillGrants: [], choices: [{
        kind: 'allocation', label: 'Stats', count: 6, options: [
          { label: 'Intelligence', target: 'intelligence' },
          { label: 'Dexterity', target: 'dexterity' },
          { label: 'Charisma', target: 'charisma' },
        ],
      }] });
      await expect(dropRace(actor, city, options({ choose: async () => [[4, 1, 0]] })))
        .rejects.toThrow('invalid allocation');
      expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
      const effect = await dropRace(actor, city, options({ choose: async () => [[4, 2, 0]] }));
      expect(effect.system.changes).toEqual([
        { key: 'intelligence', type: 'dcc', value: '4', phase: 'initial' },
        { key: 'dexterity', type: 'dcc', value: '2', phase: 'initial' },
      ]);
    });

    it('lets a category choice reuse an owned custom Skill or create a compendium Skill', async () => {
      const custom = { id: 'custom', name: 'Custom Craft', type: 'skill',
        system: { rank: 4, isAttack: false, linkedItemIds: [] } };
      const actor = actorWith(custom);
      const dwarf = race({ modifiers: [], skillGrants: [], choices: [{
        kind: 'grant', label: 'Crafting Skills', type: 'skill', pack: PACK, count: 2, bonus: 3,
      }] });
      const effect = await dropRace(actor, dwarf, options({ choose: async choices => [
        ['Custom Craft', 'Endurance'].map(name => choices[0].options.findIndex(option => option.label === name)),
      ] }));
      expect(custom.system.rank).toBe(4);
      expect(effect.system.changes).toContainEqual({ key: 'item-id:custom:rank', type: 'dcc', value: '3', phase: 'initial' });
      expect(actor.items.contents.filter(item => item.name === 'Endurance')).toHaveLength(1);
    });

    it('grants an Attack Spell and applies its Rank and half-Mana modifiers', async () => {
      const web = {
        name: 'Web', type: 'spell',
        toObject: () => ({ name: 'Web', type: 'spell', system: {
          rank: 0, manaCost: 4, isAttack: true, stat: 'intelligence', linkedItemIds: [],
          attackDefaults: { die: '1d4', damageStat: 'intelligence', damageType: 'Necrotic' },
        } }),
      };
      const actor = actorWith();
      const arachnid = race({ modifiers: [], skillGrants: [
        { name: 'Web', type: 'spell', pack: 'core.spells', bonus: 3, manaCostPercent: -50 },
      ] });
      const effect = await dropRace(actor, arachnid, options({ packs: new Map([['core.spells', packOf([web])]]) }));
      const spell = actor.items.contents.find(item => item.type === 'spell');
      expect(grantedAttack(spell, actor.items)).not.toBeNull();
      const derived = deriveCreature({ type: 'pc', items: actor.items.contents,
        modifiers: effect.system.changes.map(change => ({ target: change.key, value: change.value })) });
      expect(derived.items[spell.id]).toMatchObject({ rankEffective: 3, manaCostEffective: 2 });
    });

    it('keeps the previous Race Buff and size for Primal, then removes both layers on replacement', async () => {
      const actor = actorWith();
      const original = race({ modifiers: [], skillGrants: [] });
      const base = await dropRace(actor, original, options());
      const primal = { ...race({ size: '', inheritRace: true, skillGrants: [],
        modifiers: [{ target: 'strength', value: '-1' }] }), name: 'Primal' };
      const overlay = await dropRace(actor, primal, options());
      expect(actor.system).toMatchObject({ race: 'Primal', size: 'M' });
      expect(actor.effects.contents).toEqual([base, overlay]);
      const replacement = await dropRace(actor, original, options());
      expect(actor.effects.contents).toEqual([replacement]);
    });

    it('applies dice to Evade and stat-filtered Skill Rank bonuses', async () => {
      const actor = actorWith({ id: 'social', name: 'Persuasion', type: 'skill',
        system: { stat: 'charisma', rank: 1, linkedItemIds: [] } });
      const skyfowl = race({ skillGrants: [], modifiers: [
        { target: 'evade', value: '1d4' },
        { target: 'group:skills:stat=charisma:rank', value: '2' },
      ] });
      const effect = await dropRace(actor, skyfowl, options());
      const derived = deriveCreature({ type: 'pc', items: actor.items.contents,
        modifiers: effect.system.changes.map(change => ({ target: change.key, value: change.value })) });
      expect(derived.evadeDice).toBe('+1d4');
      expect(derived.items.social.rankEffective).toBe(3);
    });
  it('rejects missing and ambiguous Skills before any writes', async () => {
    for (const entries of [[source('Bow')], [...allSkills(), source('Bow')]]) {
      const actor = actorWith();
      await expect(dropRace(actor, race(), options({ packs: packs(entries) }))).rejects.toThrow('Expected one');
      expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    }
    const actor = actorWith(
      { id: 'a', name: 'Bow', type: 'skill', system: {} },
      { id: 'b', name: 'bow', type: 'skill', system: {} },
    );
    await expect(dropRace(actor, race(), options())).rejects.toThrow('Multiple owned Skills');
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it('rolls back newly created Items, links, actor values, and Buff on failure', async () => {
    const bow = { id: 'bow', name: 'Bow', type: 'skill', system: { rank: 3, isAttack: true, linkedItemIds: [] } };
    const actor = actorWith(bow);
    actor.system.race = actor.system._source.race = 'Old Race';
    const update = actor.update.getMockImplementation();
    actor.update.mockImplementationOnce(async () => { throw new Error('update failed'); }).mockImplementation(update);
    await expect(dropRace(actor, race(), options())).rejects.toThrow('update failed');
    expect(actor.items.contents).toEqual([bow]);
    expect(bow.system.linkedItemIds).toEqual([]);
    expect(actor.effects.contents).toEqual([]);
    expect(actor.system).toMatchObject({ race: 'Old Race', size: 'S' });
  });

  it('restores a Race Buff if replacement deletion fails after removing it', async () => {
    const actor = actorWith();
    actor.system.race = actor.system._source.race = 'Old Race';
    const old = {
      id: 'old', name: 'Old Race', flags: { [SYSTEM]: { raceSource: 'old' } },
      toObject: () => ({ _id: 'old', name: 'Old Race', flags: { [SYSTEM]: { raceSource: 'old' } } }),
    };
    actor.effects.contents.push(old);
    const remove = actor.deleteEmbeddedDocuments.getMockImplementation();
    actor.deleteEmbeddedDocuments.mockImplementationOnce(async (type, ids) => {
      await remove(type, ids);
      throw new Error('delete failed');
    }).mockImplementation(remove);
    await expect(dropRace(actor, race(), options())).rejects.toThrow('delete failed');
    expect(actor.effects.get('old').name).toBe('Old Race');
    expect(actor.effects.contents).toHaveLength(1);
    expect(actor.items.contents).toHaveLength(0);
    expect(actor.system).toMatchObject({ race: 'Old Race', size: 'S' });
  });

  it('restores both Primal and the inherited Race after a partial replacement failure', async () => {
    const actor = actorWith();
    const baseRace = race({ modifiers: [], skillGrants: [] });
    const base = await dropRace(actor, baseRace, options());
    const primalRace = { ...race({ size: '', inheritRace: true, modifiers: [], skillGrants: [] }), name: 'Primal' };
    const overlay = await dropRace(actor, primalRace, options());
    const remove = actor.deleteEmbeddedDocuments.getMockImplementation();
    actor.deleteEmbeddedDocuments.mockImplementationOnce(async (type, ids) => {
      await remove(type, [ids[0]]);
      throw new Error('partial deletion');
    }).mockImplementation(remove);
    await expect(dropRace(actor, baseRace, options())).rejects.toThrow('partial deletion');
    expect(actor.effects.get(base.id)).toBeDefined();
    expect(actor.effects.get(overlay.id)).toBeDefined();
    expect(actor.effects.contents).toHaveLength(2);
    expect(actor.system.race).toBe('Primal');
  });
});

describe('Class drops', () => {
  const fighter = () => ({
    ...race({ modifiers: [{ target: 'strength', value: '2' }],
      skillGrants: [{ name: 'Bow', pack: PACK, bonus: 3 }] }),
    name: 'Fighter', uuid: 'Compendium.core.classes.fighter',
  });

  it('stacks with the Race and replaces only the Class Buff', async () => {
    const actor = actorWith();
    const raceEffect = await dropRace(actor, race(), options());
    const bow = actor.items.contents.find(item => item.name === 'Bow' && item.type === 'skill');
    const attack = grantedAttack(bow, actor.items);
    const classEffect = await dropClass(actor, fighter(), options());
    expect(actor.system).toMatchObject({ race: 'Amazonian', class: 'Fighter', size: 'M' });
    expect(actor.items.contents.filter(item => item.type === 'skill' && item.name === 'Bow')).toEqual([bow]);
    expect(grantedAttack(bow, actor.items)).toBe(attack);
    expect(bow.system.rank).toBe(0);
    const changes = [raceEffect, classEffect].flatMap(effect => effect.system.changes)
      .map(change => ({ target: change.key, value: change.value }));
    expect(deriveCreature({ type: 'pc', items: actor.items.contents, modifiers: changes })
      .items[bow.id].rankEffective).toBe(5);
    const controls = options();
    const replacement = await dropClass(actor, {
      ...fighter(), name: 'Ranger', system: { ...fighter().system, skillGrants: [] },
    }, controls);
    expect(controls.confirmReplace).toHaveBeenCalledOnce();
    expect(actor.effects.contents).toEqual([raceEffect, replacement]);
    expect(actor.system).toMatchObject({ race: 'Amazonian', class: 'Ranger', size: 'M' });
    const newRace = await dropRace(actor, race({ skillGrants: [] }), options());
    expect(actor.effects.contents).toEqual([replacement, newRace]);
  });

  it('creates linked Attacks and handles chosen Skill benefits', async () => {
    const actor = actorWith();
    const item = fighter();
    item.system.choices = [{ kind: 'grant', label: 'Choose a Skill', type: 'skill',
      pack: PACK, count: 1, bonus: 2 }];
    const effect = await dropClass(actor, item, options({ choose: async choices =>
      [[choices[0].options.findIndex(option => option.label === 'Pugilism')]] }));
    for (const name of ['Bow', 'Pugilism']) {
      const skill = actor.items.contents.find(entry => entry.type === 'skill' && entry.name === name);
      expect(grantedAttack(skill, actor.items)).not.toBeNull();
      expect(effect.system.changes).toContainEqual({ key: `item-id:${skill.id}:rank`, type: 'dcc',
        value: name === 'Bow' ? '3' : '2', phase: 'initial' });
    }
  });

  it('does not modify the actor when replacement or choices are cancelled', async () => {
    const actor = actorWith();
    actor.system.class = actor.system._source.class = 'Old Class';
    await dropClass(actor, fighter(), options({ confirmReplace: async () => false }));
    const item = fighter();
    item.system.choices = [{ label: 'Choose', count: 1, options: [{ label: 'One' }] }];
    await dropClass(actor, item, options({ choose: async () => null }));
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(actor.update).not.toHaveBeenCalled();
    expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it('restores the previous Class and preserves the Race after a failed replacement', async () => {
    const actor = actorWith();
    const raceEffect = await dropRace(actor, race({ skillGrants: [] }), options());
    const previous = await dropClass(actor, { ...fighter(), system: { ...fighter().system, skillGrants: [] } }, options());
    const remove = actor.deleteEmbeddedDocuments.getMockImplementation();
    actor.deleteEmbeddedDocuments.mockImplementationOnce(async (type, ids) => {
      await remove(type, ids);
      throw new Error('delete failed');
    }).mockImplementation(remove);
    await expect(dropClass(actor, { ...fighter(), name: 'Ranger' }, options())).rejects.toThrow('delete failed');
    expect(actor.effects.get(raceEffect.id)).toBe(raceEffect);
    expect(actor.effects.get(previous.id).name).toBe('Fighter');
    expect(actor.effects.contents).toHaveLength(2);
    expect(actor.items.contents).toHaveLength(0);
    expect(actor.system).toMatchObject({ race: 'Amazonian', class: 'Fighter', size: 'M' });
  });
});
