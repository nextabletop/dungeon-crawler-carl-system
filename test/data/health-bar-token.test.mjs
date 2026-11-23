import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { migrateHealthBarTokens } from '../../module/health-bar-migration.mjs';
import DCCActor from '../../module/documents/actor.mjs';

foundry.documents.TokenDocument = class {
  constructor(data) { Object.assign(this, data); }
  getBarAttribute(name, options = {}) {
    const attribute = options.alternative || this[name]?.attribute;
    if (!attribute || !this.actor) return null;
    const value = this.actor.system[attribute];
    if (typeof value === 'number') return { attribute, type: 'value', value, editable: true };
    return value ? { attribute, type: 'bar', ...value, editable: true } : null;
  }
};
const { default: DCCTokenDocument } = await import('../../module/documents/token.mjs');
const saved = { actors: game.actors, scenes: game.scenes, settings: game.settings, user: game.user };
afterEach(() => Object.assign(game, saved));

describe('Health Bar token attribute', () => {
  it('uses healthBar as the default and exposes clamped slots as a graphical bar', () => {
    const manifest = JSON.parse(readFileSync(new URL('../../system.json', import.meta.url), 'utf8'));
    expect(manifest.primaryTokenAttribute).toBe('healthBar');
    const token = new DCCTokenDocument({
      actor: { system: { healthBar: 14, healthBarDisplay: 10, healthBarSlots: 10, mana: { value: 3, max: 5 } } },
      bar1: { attribute: 'healthBar' }, bar2: { attribute: 'mana' },
    });
    expect(token.getBarAttribute('bar1')).toEqual({ attribute: 'healthBar', type: 'bar', value: 10, max: 10, editable: true });
    expect(token.getBarAttribute('bar2')).toEqual({ attribute: 'mana', type: 'bar', value: 3, max: 5, editable: true });
    expect(token.getBarAttribute('', { alternative: 'healthBar' }).max).toBe(10);
  });
  it('leaves other token attributes and actors without health untouched', () => {
    const token = new DCCTokenDocument({ actor: { system: { healthBar: 3 } }, bar1: { attribute: 'healthBar' } });
    expect(token.getBarAttribute('bar1')).toEqual({ attribute: 'healthBar', type: 'value', value: 3, editable: true });
    token.actor = null;
    expect(token.getBarAttribute('bar1')).toBeNull();
  });
});

describe('existing Health Bar token migration', () => {
  it('updates only old defaults on world actors and linked or unlinked scene tokens, once', async () => {
    const actor = { type: 'pc', prototypeToken: { bar1: { attribute: 'healthPoints' } } };
    actor.update = vi.fn(async () => { actor.prototypeToken.bar1.attribute = 'healthBar'; });
    const custom = { type: 'mob', prototypeToken: { bar1: { attribute: 'mana' } }, update: vi.fn() };
    const scene = {
      tokens: [
        { id: 'linked', actor: { type: 'pc' }, bar1: { attribute: 'healthPoints' } },
        { id: 'unlinked', actor: { type: 'mob' }, bar1: { attribute: 'healthPoints' } },
        { id: 'custom', actor: { type: 'vehicle' }, bar1: { attribute: 'mana' } },
        { id: 'missing', actor: null, bar1: { attribute: 'healthPoints' } },
      ],
      updateEmbeddedDocuments: vi.fn(async (_type, updates) => {
        for (const update of updates) scene.tokens.find(token => token.id === update._id).bar1.attribute = update['bar1.attribute'];
      }),
    };
    game.user = { isActiveGM: true };
    game.actors = [actor, custom];
    game.scenes = [scene];
    game.settings = { get: vi.fn(() => false), set: vi.fn() };
    await migrateHealthBarTokens();
    expect(actor.update).toHaveBeenCalledWith({ 'prototypeToken.bar1.attribute': 'healthBar' });
    expect(custom.update).not.toHaveBeenCalled();
    expect(scene.updateEmbeddedDocuments).toHaveBeenCalledWith('Token', [
      { _id: 'linked', 'bar1.attribute': 'healthBar' },
      { _id: 'unlinked', 'bar1.attribute': 'healthBar' },
    ]);
    expect(game.settings.set).toHaveBeenCalledWith('dungeon-crawler-carl', 'healthBarTokenMigration', true);
    game.settings.get.mockReturnValue(true);
    await migrateHealthBarTokens();
    expect(scene.updateEmbeddedDocuments).toHaveBeenCalledTimes(1);
  });

  describe('compendium actor imports', () => {
    it.each(['pc', 'mob', 'vehicle'])('converts the old default on an imported %s before its token is created', async type => {
      const actor = new DCCActor({ type, prototypeToken: { bar1: { attribute: 'healthPoints' } } });
      actor.updateSource = vi.fn();
      await actor._preCreate({}, { fromCompendium: true }, {});
      expect(actor.updateSource).toHaveBeenCalledWith({ 'prototypeToken.bar1.attribute': 'healthBar' });
    });

    it.each([
      ['mob', 'mana', true, false],
      ['mob', null, true, false],
      ['mob', 'healthPoints', false, false],
      ['gmscreen', 'healthPoints', true, false],
      ['mob', 'healthPoints', true, true],
    ])('preserves other choices and non-world imports', async (type, attribute, fromCompendium, inCompendium) => {
      const actor = new DCCActor({ type, inCompendium, prototypeToken: { bar1: { attribute } } });
      actor.updateSource = vi.fn();
      await actor._preCreate({}, { fromCompendium }, {});
      expect(actor.updateSource).not.toHaveBeenCalled();
    });
  });
  it('does not mark a failed migration complete, so it can be retried', async () => {
    game.user = { isActiveGM: true };
    game.actors = [{ type: 'pc', prototypeToken: { bar1: { attribute: 'healthPoints' } }, update: vi.fn().mockRejectedValue(new Error('failed')) }];
    game.scenes = [];
    game.settings = { get: () => false, set: vi.fn() };
    await expect(migrateHealthBarTokens()).rejects.toThrow('failed');
    expect(game.settings.set).not.toHaveBeenCalled();
  });
  it('does not mark the migration complete if an update is vetoed', async () => {
    game.user = { isActiveGM: true };
    game.actors = [{ id: 'a', type: 'pc', prototypeToken: { bar1: { attribute: 'healthPoints' } }, update: vi.fn() }];
    game.scenes = [];
    game.settings = { get: () => false, set: vi.fn() };
    await expect(migrateHealthBarTokens()).rejects.toThrow('Could not update Bar 1 for actor a');
    expect(game.settings.set).not.toHaveBeenCalled();
  });
  it('does nothing on non-active GM clients', async () => {
    game.user = { isActiveGM: false };
    game.settings = { get: vi.fn(), set: vi.fn() };
    await migrateHealthBarTokens();
    expect(game.settings.get).not.toHaveBeenCalled();
    expect(game.settings.set).not.toHaveBeenCalled();
  });
});
