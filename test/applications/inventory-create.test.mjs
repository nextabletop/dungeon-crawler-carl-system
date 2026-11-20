import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../../module/applications/sheet-config.mjs', () => ({ default: class {} }));
vi.mock('../../module/rules/race.mjs', async importOriginal => ({
  ...await importOriginal(), dropRace: vi.fn(), dropClass: vi.fn(),
}));

foundry.applications.api = { HandlebarsApplicationMixin: base => base, DialogV2: { wait: vi.fn() } };
foundry.applications.sheets = { ActorSheet: class { async _onDropItem() { return 'core drop'; } } };
foundry.utils.escapeHTML = text => text.replaceAll('<', '&lt;');
globalThis.ui = { notifications: { error: vi.fn(), warn: vi.fn() } };

const { default: PcSheet } = await import('../../module/applications/pc-sheet.mjs');
const { default: MobSheet } = await import('../../module/applications/mob-sheet.mjs');
const { default: CreatureSheet } = await import('../../module/applications/creature-sheet.mjs');
const { default: ActorSheetBase } = await import('../../module/applications/actor-sheet-base.mjs');
const { dropRace, dropClass } = await import('../../module/rules/race.mjs');
const chooseItem = PcSheet.DEFAULT_OPTIONS.actions.createInventoryItem;
const createItem = ActorSheetBase.DEFAULT_OPTIONS.actions.createItem;
const chooseSkillOrSpell = CreatureSheet.DEFAULT_OPTIONS.actions.createSkillOrSpell;

const makeSheet = () => {
  const sheet = new PcSheet();
  sheet.isEditable = true;
  sheet.document = { createEmbeddedDocuments: vi.fn() };
  return sheet;
};

describe('Healing Potion drop', () => {
  const translations = JSON.parse(readFileSync(new URL('../../lang/en.json', import.meta.url), 'utf8'));
  const localize = game.i18n.localize;
  const originalItem = globalThis.Item;
  const originalItems = game.items;
  const potion = () => ({
    id: 'potion', type: 'gear', parent: null, inCompendium: true,
    getFlag: (_scope, key) => key === 'starterSetSourceId' ? 'standard-gear:healing-potion' : undefined,
    toObject: vi.fn(),
  });
  const makePotionSheet = () => {
    const sheet = makeSheet();
    sheet.actor = { uuid: 'Actor.target', isOwner: true, items: new Map() };
    return sheet;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    game.i18n.localize = key => key.split('.').reduce((value, part) => value?.[part], translations) ?? key;
    game.items = { fromCompendium: vi.fn(() => ({
      name: 'Healing Potion', system: { description: 'original', quantity: 2 },
      flags: { 'dungeon-crawler-carl': { starterSetSourceId: 'standard-gear:healing-potion' } },
    })) };
    globalThis.Item = { implementation: { create: vi.fn(async data => data) } };
  });

  afterEach(() => {
    game.i18n.localize = localize;
    game.items = originalItems;
    globalThis.Item = originalItem;
  });

  it.each([
    ['standard', 'Healing Potion', 'Heals 5 Health Bar slots.'],
    ['good', 'Good Healing Potion', 'Heals 6 Health Bar slots.'],
    ['gold', 'Gold Standard Healing Potion', 'Heals 7 Health Bar slots and mends one Minor Injury.'],
    ['supreme', 'Supreme Healing Potion', 'Heals 8 Health Bar slots and mends one Minor or Major Injury; or deals 8d8 Holy damage to an undead Mob.'],
  ])('creates the %s quality without changing the source', async (quality, name, description) => {
    const sheet = makePotionSheet();
    const source = potion();
    foundry.applications.api.DialogV2.wait.mockResolvedValue(quality);

    const result = await sheet._onDropItem({}, source);
    expect(foundry.applications.api.DialogV2.wait.mock.calls[0][0].buttons.map(button => button.action))
      .toEqual(['standard', 'good', 'gold', 'supreme', 'cancel']);
    expect(game.items.fromCompendium).toHaveBeenCalledWith(source, { clearFolder: true, keepId: true });
    expect(result.name).toBe(name);
    expect(result.system).toEqual({ description: `<p>${description}</p>`, quantity: 2 });
    expect(result.flags['dungeon-crawler-carl'].healingPotionQuality).toBe(quality);
    expect(Item.implementation.create).toHaveBeenCalledWith(result, { parent: sheet.actor, keepId: true });
    expect(source.toObject).not.toHaveBeenCalled();
  });

  it.each([null, 'cancel'])('does not create an item when the choice is %s', async choice => {
    foundry.applications.api.DialogV2.wait.mockResolvedValue(choice);
    expect(await makePotionSheet()._onDropItem({}, potion())).toBeNull();
    expect(Item.implementation.create).not.toHaveBeenCalled();
  });

  it('creates a world potion with a new ID when the actor already owns that ID', async () => {
    const sheet = makePotionSheet();
    const source = potion();
    source.inCompendium = false;
    source.toObject.mockReturnValue({ system: { description: 'original' } });
    sheet.actor.items.set(source.id, {});
    foundry.applications.api.DialogV2.wait.mockResolvedValue('good');
    const result = await sheet._onDropItem({}, source);
    expect(result.name).toBe('Good Healing Potion');
    expect(Item.implementation.create).toHaveBeenCalledWith(result, { parent: sheet.actor, keepId: false });
    expect(game.items.fromCompendium).not.toHaveBeenCalled();
  });

  it('leaves other Gear drops to Foundry', async () => {
    const source = potion();
    source.getFlag = () => undefined;
    expect(await makePotionSheet()._onDropItem({}, source)).toBe('core drop');
    expect(foundry.applications.api.DialogV2.wait).not.toHaveBeenCalled();
  });

  it('preserves selected actor-owned potions on transfer and same-actor sorting', async () => {
    const sheet = makePotionSheet();
    const source = potion();
    source.parent = { uuid: 'Actor.other' };
    expect(await sheet._onDropItem({}, source)).toBe('core drop');
    source.parent.uuid = sheet.actor.uuid;
    expect(await sheet._onDropItem({}, source)).toBe('core drop');
    expect(foundry.applications.api.DialogV2.wait).not.toHaveBeenCalled();
  });

  it('rechecks ownership after the choice and reports invalid choices', async () => {
    const sheet = makePotionSheet();
    foundry.applications.api.DialogV2.wait.mockImplementationOnce(async () => {
      sheet.actor.isOwner = false;
      return 'good';
    });
    expect(await sheet._onDropItem({}, potion())).toBeNull();
    sheet.actor.isOwner = true;
    foundry.applications.api.DialogV2.wait.mockResolvedValueOnce('unexpected');
    expect(await sheet._onDropItem({}, potion())).toBeNull();
    expect(ui.notifications.error).toHaveBeenCalledWith('Invalid Healing Potion quality.');
    expect(Item.implementation.create).not.toHaveBeenCalled();
  });
});

describe('Skill Potion drop', () => {
  it('sets the chosen bonus on the owned copy without altering the template', async () => {
    const originalItem = globalThis.Item;
    const originalItems = game.items;
    const template = {
      id: 'potion', type: 'gear', parent: null, inCompendium: true,
      getFlag: (_scope, key) => key === 'skillPotion' ? { rankBonus: null } : undefined,
    };
    const sheet = makeSheet();
    sheet.actor = { uuid: 'Actor.target', isOwner: true, items: new Map() };
    game.items = { fromCompendium: vi.fn(() => ({
      system: { quantity: 1 }, flags: { 'dungeon-crawler-carl': { skillPotion: { rankBonus: null } } },
    })) };
    globalThis.Item = { implementation: { create: vi.fn(async data => data) } };
    foundry.applications.api.DialogV2.wait.mockImplementationOnce(async dialog => (
      dialog.buttons[0].callback(null, { form: { elements: { namedItem: () => ({ value: '3' }) } } })
    ));
    try {
      const result = await sheet._onDropItem({}, template);
      expect(result.flags['dungeon-crawler-carl'].skillPotion.rankBonus).toBe(3);
      expect(result.system.quantity).toBe(1);
      expect(Item.implementation.create).toHaveBeenCalledWith(result, { parent: sheet.actor, keepId: true });
    } finally {
      globalThis.Item = originalItem;
      game.items = originalItems;
    }
  });
});

describe('Configurable Gear drop', () => {
  const originalItems = game.items;
  const originalPacks = game.packs;
  const source = () => ({
    id: 'template', type: 'gear', parent: null, inCompendium: true,
    getFlag: (_scope, key) => key === 'configurableGear' ? 'accessory' : undefined,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    game.packs = new Map();
    game.items = { fromCompendium: vi.fn(() => ({
      type: 'gear', system: { slot: 'pack', active: false, linkedItemIds: [] },
      flags: { 'dungeon-crawler-carl': { configurableGear: 'accessory' } },
      effects: [{ flags: { 'dungeon-crawler-carl': { configurableGearBonus: true } }, system: { changes: [] } }],
    })) };
  });

  afterEach(() => {
    game.items = originalItems;
    game.packs = originalPacks;
  });

  it('collects a slot and bonus, and equips the configured copy', async () => {
    const sheet = makeSheet();
    const skill = { id: 'skill', type: 'skill', name: 'Climbing', system: { rank: 1 } };
    const items = new Map([[skill.id, skill]]);
    Object.defineProperty(items, 'contents', { get: () => [...items.values()] });
    sheet.actor = {
      uuid: 'Actor.target', isOwner: true, items,
      createEmbeddedDocuments: vi.fn(async (_type, [data]) => {
        const gear = { ...data, id: 'new' };
        items.set(gear.id, gear);
        return [gear];
      }),
      updateEmbeddedDocuments: vi.fn(async (_type, updates) => updates.map(update => {
        const item = items.get(update._id);
        item.system.slot = update['system.slot'];
        return item;
      })),
    };
    foundry.applications.api.DialogV2.wait.mockImplementationOnce(async dialog =>
      dialog.buttons[0].callback(null, { form: { elements: { namedItem: name =>
        ({ value: name === 'slot' ? 'head' : '0' }) } } }));
    const gear = await sheet._onDropItem({}, source());
    expect(gear.system.slot).toBe('head');
    expect(gear.effects[0].system.changes.map(change => change.key)).toEqual(['strength', 'item-id:skill:rank']);
    expect(ui.notifications.error).not.toHaveBeenCalled();
  });

  it('cancels without creating anything', async () => {
    const sheet = makeSheet();
    sheet.actor = { uuid: 'Actor.target', isOwner: true, items: new Map(), createEmbeddedDocuments: vi.fn() };
    foundry.applications.api.DialogV2.wait.mockResolvedValueOnce('cancel');
    expect(await sheet._onDropItem({}, source())).toBeNull();
    expect(sheet.actor.createEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it('collects Gold armor quality and resistance in sequence', async () => {
    const sheet = makeSheet();
    const items = new Map();
    Object.defineProperty(items, 'contents', { get: () => [...items.values()] });
    sheet.actor = {
      uuid: 'Actor.target', isOwner: true, items,
      createEmbeddedDocuments: vi.fn(async (_type, [data]) => {
        const gear = { ...data, id: 'armor' };
        items.set(gear.id, gear);
        return [gear];
      }),
      updateEmbeddedDocuments: vi.fn(async (_type, updates) => updates.map(update => {
        const item = items.get(update._id);
        item.system.slot = update['system.slot'];
        return item;
      })),
    };
    const armor = source();
    armor.getFlag = (_scope, key) => key === 'configurableGear' ? 'qualityArmor' : undefined;
    foundry.applications.api.DialogV2.wait
      .mockImplementationOnce(async dialog => dialog.buttons[0].callback(null, {
        form: { elements: { namedItem: name => ({ value: name === 'slot' ? 'torso' : 'gold' }) } },
      }))
      .mockImplementationOnce(async dialog => dialog.buttons[0].callback(null, {
        form: { elements: { namedItem: () => ({ value: 'Ice' }) } },
      }));
    const gear = await sheet._onDropItem({}, armor);
    expect(gear.system.slot).toBe('torso');
    expect(gear.effects[0].system.changes[0]).toMatchObject({ key: 'damage_resistance', value: '+3' });
    expect(gear.effects[1].flags['dungeon-crawler-carl'].showInBuffs).toBe(true);
    expect(foundry.applications.api.DialogV2.wait).toHaveBeenCalledTimes(2);
  });

  it('cancels the armor drop if the second selection is cancelled', async () => {
    const sheet = makeSheet();
    sheet.actor = { uuid: 'Actor.target', isOwner: true, items: new Map(), createEmbeddedDocuments: vi.fn() };
    const armor = source();
    armor.getFlag = (_scope, key) => key === 'configurableGear' ? 'qualityArmor' : undefined;
    foundry.applications.api.DialogV2.wait
      .mockImplementationOnce(async dialog => dialog.buttons[0].callback(null, {
        form: { elements: { namedItem: name => ({ value: name === 'slot' ? 'head' : 'gold' }) } },
      }))
      .mockResolvedValueOnce('cancel');
    expect(await sheet._onDropItem({}, armor)).toBeNull();
    expect(sheet.actor.createEmbeddedDocuments).not.toHaveBeenCalled();
  });
});

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

describe.each([['Crawler', PcSheet], ['Mob', MobSheet]])('%s combined Skill and Spell creation', (_name, Sheet) => {
  beforeEach(() => vi.clearAllMocks());

  const makeSheet = () => {
    const sheet = new Sheet();
    sheet.isEditable = true;
    sheet.document = { createEmbeddedDocuments: vi.fn() };
    return sheet;
  };

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
