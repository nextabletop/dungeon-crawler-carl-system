import { beforeEach, describe, expect, it, vi } from 'vitest';
import { choosePotionSkill } from '../../module/applications/skill-potion.mjs';

foundry.applications.api = { DialogV2: { wait: vi.fn() } };
foundry.utils.escapeHTML = text => String(text).replaceAll('<', '&lt;');

describe('Skill Potion selection dialog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('offers owned custom Skills and Skills from accessible compendiums', async () => {
    const actor = { items: new Map([['custom', { id: 'custom', name: 'Custom Skill', type: 'skill' }]]) };
    const index = new Map([
      ['climb', { _id: 'climb', name: 'Climbing', type: 'skill' }],
      ['weapon', { _id: 'weapon', name: 'Weapon', type: 'weapon' }],
    ]);
    const packs = new Map([['core.skills', {
      collection: 'core.skills', title: 'Core Skills', visible: true, documentName: 'Item',
      getIndex: vi.fn(async () => index),
    }]]);
    foundry.applications.api.DialogV2.wait.mockImplementation(async dialog => {
      expect(dialog.content).toContain('Climbing (Core Skills)');
      expect(dialog.content).not.toContain('Weapon');
      return dialog.buttons[0].callback(null, { form: { elements: { namedItem: () => ({ value: '0' }) } } });
    });
    expect(await choosePotionSkill(actor, packs)).toMatchObject({
      kind: 'compendium', pack: 'core.skills', id: 'climb',
    });
  });

  it('collects a custom Skill name and leaves cancelled dialogs unchanged', async () => {
    const actor = { items: new Map() };
    foundry.applications.api.DialogV2.wait.mockResolvedValueOnce('custom').mockResolvedValueOnce({ name: 'My Skill' });
    expect(await choosePotionSkill(actor, new Map())).toEqual({ kind: 'custom', name: 'My Skill' });
    foundry.applications.api.DialogV2.wait.mockResolvedValueOnce(null);
    expect(await choosePotionSkill(actor, new Map())).toBeNull();
  });

  it('rejects a missing selection instead of consuming a potion', async () => {
    foundry.applications.api.DialogV2.wait.mockResolvedValue('');
    await expect(choosePotionSkill({ items: new Map() }, new Map())).rejects.toThrow('Select a Skill');
  });
});
