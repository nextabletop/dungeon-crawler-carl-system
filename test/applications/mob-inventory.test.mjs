import { describe, expect, it, vi } from 'vitest';

vi.mock('../../module/applications/creature-sheet.mjs', () => ({
  default: class {
    async _prepareContext() { return { preserved: true }; }
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
    expect(context.inventory.map(row => [row.name, row.isWeapon])).toEqual([
      ['Potion', false], ['Spear', true],
    ]);
  });
});
