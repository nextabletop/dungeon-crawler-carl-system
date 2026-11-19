import { describe, expect, it, vi } from 'vitest';

vi.mock('../../module/applications/creature-sheet.mjs', () => ({
  default: class {
    async _prepareContext() {
      return {
        preserved: true,
        skills: [{ id: 'skill', spell: false }],
        spells: [{ id: 'spell', spell: true }],
      };
    }
  },
}));
vi.mock('../../module/applications/actor-sheet-base.mjs', () => ({
  ACTOR_PARTIALS: {},
  templatePath: path => path,
}));

const { default: MobSheet } = await import('../../module/applications/mob-sheet.mjs');

describe('Mob inventory', () => {
  it('shows both gear and inventory-only weapons', async () => {
    const sheet = new MobSheet();
    const item = (id, type) => ({
      id, name: id, type, system: { slot: 'pack', quantity: 1, active: false, description: '' },
    });
    sheet.document = { itemTypes: { gear: [item('Potion', 'gear')], weapon: [item('Spear', 'weapon')] } };

    const context = await sheet._prepareContext({});
    expect(context.preserved).toBe(true);
    expect(context.skillsAndSpells).toEqual([
      { id: 'skill', spell: false }, { id: 'spell', spell: true },
    ]);
    expect(context.inventory.map(row => [row.name, row.isWeapon])).toEqual([
      ['Potion', false], ['Spear', true],
    ]);
  });

  it('exposes the Skill Potion use action only for configured potions', async () => {
    const sheet = new MobSheet();
    const potion = {
      id: 'potion', name: '+3 Skill Potion', type: 'gear',
      system: { slot: 'pack', quantity: 1, active: false, description: '' },
      flags: { 'dungeon-crawler-carl': { skillPotion: { rankBonus: 3 } } },
    };
    const gear = { ...potion, id: 'gear', flags: {} };
    sheet.document = { itemTypes: { gear: [potion, gear], weapon: [] } };
    const { inventory } = await sheet._prepareContext({});
    expect(inventory.map(row => row.isSkillPotion)).toEqual([true, false]);
  });
});
