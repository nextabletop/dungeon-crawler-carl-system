import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../../module/applications/sheet-config.mjs', () => ({ default: class {} }));
vi.mock('../../module/applications/creature-sheet.mjs', async () => ({
  default: (await import('../../module/applications/actor-sheet-base.mjs')).default,
}));
vi.mock('../../module/rules/race.mjs', () => ({ dropRace: vi.fn(), dropClass: vi.fn() }));

foundry.applications.api = { HandlebarsApplicationMixin: base => base, DialogV2: { wait: vi.fn() } };
foundry.applications.sheets = { ActorSheet: class {} };
foundry.utils.escapeHTML = text => text.replaceAll('<', '&lt;');
globalThis.ui = { notifications: { error: vi.fn(), warn: vi.fn() } };

const { default: PcSheet } = await import('../../module/applications/pc-sheet.mjs');
const { default: ActorSheetBase } = await import('../../module/applications/actor-sheet-base.mjs');
const { dropRace, dropClass } = await import('../../module/rules/race.mjs');
const chooseItem = PcSheet.DEFAULT_OPTIONS.actions.createInventoryItem;
const createItem = ActorSheetBase.DEFAULT_OPTIONS.actions.createItem;
const chooseSkillOrSpell = PcSheet.DEFAULT_OPTIONS.actions.createSkillOrSpell;

const makeSheet = () => {
  const sheet = new PcSheet();
  sheet.isEditable = true;
  sheet.document = { createEmbeddedDocuments: vi.fn() };
  return sheet;
};

describe('Crawler Race drop', () => {
  beforeEach(() => vi.clearAllMocks());

  it('flushes the sheet and passes a choice dialog to the Race handler', async () => {
    const sheet = makeSheet();
    sheet.actor = { isOwner: true };
    sheet._flushForm = vi.fn(async () => true);
    const item = { type: 'race', name: 'Test' };
    foundry.applications.api.DialogV2.wait.mockImplementation(async dialog => (
      dialog.buttons[0].callback(null, {
        form: { elements: { namedItem: () => ({ selectedOptions: [{ value: '1' }] }) } },
      })
    ));
    dropRace.mockImplementation(async (_actor, _item, handlers) => {
      const selected = await handlers.choose([{
        label: 'Choose', count: 1, options: [{ label: 'A' }, { label: 'B' }],
      }]);
      expect(selected).toEqual([[1]]);
    });

    await sheet._onDropItem({}, item);
    expect(sheet._flushForm).toHaveBeenCalledOnce();
    expect(dropRace).toHaveBeenCalledWith(sheet.actor, item, expect.any(Object));
    expect(ui.notifications.error).not.toHaveBeenCalled();
  });

  it('does not apply a Race if saving pending edits fails', async () => {
    const sheet = makeSheet();
    sheet.actor = { isOwner: true };
    sheet._flushForm = vi.fn(async () => false);
    await sheet._onDropItem({}, { type: 'race' });
    expect(dropRace).not.toHaveBeenCalled();
  });

  it('treats the Race choice dialog cancel action as cancellation', async () => {
    const sheet = makeSheet();
    sheet.actor = { isOwner: true };
    sheet._flushForm = vi.fn(async () => true);
    foundry.applications.api.DialogV2.wait.mockResolvedValue('cancel');
    dropRace.mockImplementation(async (_actor, _item, handlers) => {
      expect(await handlers.choose([{
        label: 'Choose', count: 1, options: [{ label: 'A' }],
      }])).toBeNull();
    });
    await sheet._onDropItem({}, { type: 'race' });
    expect(ui.notifications.error).not.toHaveBeenCalled();
  });

  it('collects a valid Stat allocation from the Race choice dialog', async () => {
    const sheet = makeSheet();
    sheet.actor = { isOwner: true };
    sheet._flushForm = vi.fn(async () => true);
    const values = ['4', '2', '0'];
    foundry.applications.api.DialogV2.wait.mockImplementation(async dialog => (
      dialog.buttons[0].callback(null, {
        form: { elements: { namedItem: name => ({ value: values[Number(name.at(-1))] }) } },
      })
    ));
    dropRace.mockImplementation(async (_actor, _item, handlers) => {
      expect(await handlers.choose([{
        kind: 'allocation', label: 'Stats', count: 6,
        options: [{ label: 'Int' }, { label: 'Dex' }, { label: 'Cha' }],
      }])).toEqual([[4, 2, 0]]);
    });
    await sheet._onDropItem({}, { type: 'race' });
    expect(ui.notifications.error).not.toHaveBeenCalled();
  });
});

describe('Crawler Class drop', () => {
  beforeEach(() => vi.clearAllMocks());

  it('flushes pending edits and invokes the Class handler', async () => {
    const sheet = makeSheet();
    sheet.actor = { isOwner: true };
    sheet._flushForm = vi.fn(async () => true);
    const item = { type: 'class', name: 'Fighter' };
    await sheet._onDropItem({}, item);
    expect(dropClass).toHaveBeenCalledWith(sheet.actor, item, expect.any(Object));
    expect(dropRace).not.toHaveBeenCalled();
    expect(ui.notifications.error).not.toHaveBeenCalled();
  });
});

describe('Crawler combined Skill and Spell creation', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['skill', 'icons/svg/book.svg'],
    ['spell', 'icons/svg/daze.svg'],
  ])('creates and opens a separate %s Item', async (type, img) => {
    const sheet = makeSheet();
    const render = vi.fn();
    sheet.document.createEmbeddedDocuments.mockResolvedValue([{ sheet: { render } }]);
    foundry.applications.api.DialogV2.wait.mockResolvedValue(type);
    await chooseSkillOrSpell.call(sheet);
    const dialog = foundry.applications.api.DialogV2.wait.mock.calls[0][0];
    expect(dialog.buttons.map(button => button.action)).toEqual(['skill', 'spell', 'cancel']);
    expect(dialog.rejectClose).toBe(false);
    expect(dialog.modal).toBe(true);
    expect(sheet.document.createEmbeddedDocuments).toHaveBeenCalledWith('Item', [{
      type, name: 'DCC.Items.New', img,
    }]);
    expect(render).toHaveBeenCalledWith(true);
  });

  it.each([null, 'cancel'])('creates nothing when dismissed with %s', async choice => {
    const sheet = makeSheet();
    foundry.applications.api.DialogV2.wait.mockResolvedValue(choice);
    await chooseSkillOrSpell.call(sheet);
    expect(sheet.document.createEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it('guards permissions before and after the chooser', async () => {
    const sheet = makeSheet();
    sheet.isEditable = false;
    await chooseSkillOrSpell.call(sheet);
    expect(foundry.applications.api.DialogV2.wait).not.toHaveBeenCalled();
    sheet.isEditable = true;
    foundry.applications.api.DialogV2.wait.mockImplementation(async () => {
      sheet.isEditable = false;
      return 'spell';
    });
    await chooseSkillOrSpell.call(sheet);
    expect(sheet.document.createEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it('prevents duplicate pending dialogs', async () => {
    const sheet = makeSheet();
    let resolve;
    foundry.applications.api.DialogV2.wait.mockReturnValue(new Promise(r => { resolve = r; }));
    const first = chooseSkillOrSpell.call(sheet);
    await chooseSkillOrSpell.call(sheet);
    expect(foundry.applications.api.DialogV2.wait).toHaveBeenCalledOnce();
    resolve(null);
    await first;
  });

  it('reports invalid selections and creation failures', async () => {
    const sheet = makeSheet();
    foundry.applications.api.DialogV2.wait.mockResolvedValueOnce('gear').mockResolvedValueOnce('skill');
    await chooseSkillOrSpell.call(sheet);
    expect(ui.notifications.error).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Unexpected skill or spell item type: gear' }), { console: true },
    );
    const error = new Error('Cannot create skill');
    sheet.document.createEmbeddedDocuments.mockRejectedValue(error);
    await chooseSkillOrSpell.call(sheet);
    expect(ui.notifications.error).toHaveBeenLastCalledWith(error, { console: true });
  });
});

describe('Crawler inventory item creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a single owner-only Add Item button', () => {
    const template = readFileSync(new URL('../../templates/actor/pc/inventory.hbs', import.meta.url), 'utf8');
    expect(template).toMatch(/{{#if editable}}\s*<button[^>]*data-action="createInventoryItem"[\s\S]*?DCC\.Inventory\.AddItem[\s\S]*?<\/button>\s*{{\/if}}/);
    expect(template).not.toContain('inv-add-gear');
    expect(template).not.toContain('inv-add-weapon');
  });

  it.each(['gear', 'weapon'])('creates and opens the selected %s item', async type => {
    const sheet = makeSheet();
    const render = vi.fn();
    sheet.document.createEmbeddedDocuments.mockResolvedValue([{ sheet: { render } }]);
    foundry.applications.api.DialogV2.wait.mockResolvedValue(type);
    await chooseItem.call(sheet);
    expect(foundry.applications.api.DialogV2.wait).toHaveBeenCalledOnce();
    const dialog = foundry.applications.api.DialogV2.wait.mock.calls[0][0];
    expect(dialog.buttons.map(button => button.action)).toEqual(['gear', 'weapon', 'cancel']);
    expect(dialog.buttons.map(button => button.label)).toEqual(['TYPES.Item.gear', 'TYPES.Item.weapon', 'DCC.Inventory.Cancel']);
    expect(dialog.modal).toBe(true);
    expect(dialog.rejectClose).toBe(false);
    expect(sheet.document.createEmbeddedDocuments).toHaveBeenCalledWith('Item', [{
      type,
      name: 'DCC.Items.New',
      ...(type === 'gear' ? { img: 'icons/svg/chest.svg' } : {}),
    }]);
    expect(render).toHaveBeenCalledWith(true);
  });

  it.each([null, 'cancel'])('creates nothing when the choice is %s', async choice => {
    const sheet = makeSheet();
    foundry.applications.api.DialogV2.wait.mockResolvedValue(choice);
    await chooseItem.call(sheet);
    expect(sheet.document.createEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it('does not open the chooser for a non-owner and rechecks editability after the dialog', async () => {
    const sheet = makeSheet();
    sheet.isEditable = false;
    await chooseItem.call(sheet);
    expect(foundry.applications.api.DialogV2.wait).not.toHaveBeenCalled();
    sheet.isEditable = true;
    foundry.applications.api.DialogV2.wait.mockImplementation(async () => {
      sheet.isEditable = false;
      return 'gear';
    });
    await chooseItem.call(sheet);
    expect(sheet.document.createEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it('prevents duplicate dialogs while the first choice is pending', async () => {
    const sheet = makeSheet();
    let resolve;
    foundry.applications.api.DialogV2.wait.mockReturnValue(new Promise(r => { resolve = r; }));
    const first = chooseItem.call(sheet);
    await chooseItem.call(sheet);
    expect(foundry.applications.api.DialogV2.wait).toHaveBeenCalledOnce();
    resolve(null);
    await first;
  });

  it('reports creation failures and unexpected choices', async () => {
    const sheet = makeSheet();
    const error = new Error('Cannot create');
    foundry.applications.api.DialogV2.wait.mockResolvedValueOnce('gear').mockResolvedValueOnce('unexpected');
    sheet.document.createEmbeddedDocuments.mockRejectedValue(error);
    await chooseItem.call(sheet);
    expect(ui.notifications.error).toHaveBeenCalledWith(error, { console: true });
    await chooseItem.call(sheet);
    expect(ui.notifications.error).toHaveBeenLastCalledWith(expect.objectContaining({ message: 'Unexpected inventory item type: unexpected' }), { console: true });
  });

  it('preserves the shared create action and its allowed-type check', async () => {
    const sheet = makeSheet();
    const render = vi.fn();
    sheet.document.createEmbeddedDocuments.mockResolvedValue([{ sheet: { render } }]);
    await createItem.call(sheet, null, { dataset: { type: 'attack' } });
    expect(sheet.document.createEmbeddedDocuments).toHaveBeenCalledWith('Item', [{
      type: 'attack',
      name: 'DCC.Items.New',
      img: 'icons/svg/combat.svg',
    }]);
    expect(render).toHaveBeenCalledWith(true);
    sheet.document.createEmbeddedDocuments.mockClear();
    await createItem.call(sheet, null, { dataset: { type: 'unknown' } });
    expect(sheet.document.createEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it.each([
    ['skill', 'icons/svg/book.svg'],
    ['spell', 'icons/svg/daze.svg'],
    ['gear', 'icons/svg/chest.svg'],
  ])('uses the default %s icon for shared item creation', async (type, img) => {
    const sheet = makeSheet();
    sheet.document.createEmbeddedDocuments.mockResolvedValue([{ sheet: { render: vi.fn() } }]);
    await createItem.call(sheet, null, { dataset: { type } });
    expect(sheet.document.createEmbeddedDocuments).toHaveBeenCalledWith('Item', [{
      type,
      name: 'DCC.Items.New',
      img,
    }]);
  });

  it('respects the allowed-type check after a choice', async () => {
    const sheet = makeSheet();
    sheet.constructor = { ALLOWED_ITEM_TYPES: ['gear'] };
    foundry.applications.api.DialogV2.wait.mockResolvedValue('weapon');
    await chooseItem.call(sheet);
    expect(sheet.document.createEmbeddedDocuments).not.toHaveBeenCalled();
  });
});
