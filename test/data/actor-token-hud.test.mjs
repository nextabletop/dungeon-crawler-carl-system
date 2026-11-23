import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A token bar edit that resolves to no change (sub-slot HP, mana at max) fires
// no update, so the Token HUD kept showing the typed entry. DCCActor re-renders
// a HUD bound to itself after every modifyTokenAttribute.
const { default: DCCActor } = await import('../../module/documents/actor.mjs');

const base = Object.getPrototypeOf(DCCActor.prototype);
const makeActor = () => new DCCActor({ type: 'pc', name: 'Carl', system: {} });

beforeEach(() => {
  base.modifyTokenAttribute = vi.fn(async function () { return this; });
});
afterEach(() => {
  delete base.modifyTokenAttribute;
  delete globalThis.canvas;
  delete globalThis.Hooks;
  delete globalThis.ui;
});

describe('modifyTokenAttribute', () => {
  it('passes through to core and re-renders a HUD bound to this actor', async () => {
    const actor = makeActor();
    const hud = { rendered: true, actor, render: vi.fn() };
    globalThis.canvas = { hud: { token: hud } };
    await actor.modifyTokenAttribute('healthPoints', -1, true, true);
    expect(base.modifyTokenAttribute).toHaveBeenCalledWith('healthPoints', -1, true, true);
    expect(hud.render).toHaveBeenCalledOnce();
  });
  it('leaves a HUD bound to another actor alone', async () => {
    const hud = { rendered: true, actor: makeActor(), render: vi.fn() };
    globalThis.canvas = { hud: { token: hud } };
    await makeActor().modifyTokenAttribute('mana', 5, false, true);
    expect(hud.render).not.toHaveBeenCalled();
  });
  it('no canvas (e.g. no scene) is fine', async () => {
    await expect(makeActor().modifyTokenAttribute('mana', 5, false, true)).resolves.toBeDefined();
  });
  it('updates healthBar in whole slots, clamps it, and calls the standard hook', async () => {
    const actor = new DCCActor({ type: 'pc', system: { healthBar: 7, healthBarDisplay: 7, healthBarSlots: 10 } });
    actor.update = vi.fn(async () => actor);
    globalThis.Hooks = { call: vi.fn(() => true) };
    const hud = { rendered: true, actor, render: vi.fn() };
    globalThis.canvas = { hud: { token: hud } };
    await actor.modifyTokenAttribute('healthBar', -3, true, true);
    expect(actor.update).toHaveBeenLastCalledWith({ 'system.healthBar': 4 });
    expect(Hooks.call).toHaveBeenCalledWith('modifyTokenAttribute',
      { attribute: 'healthBar', value: -3, isDelta: true, isBar: true }, { 'system.healthBar': 4 }, actor);
    await actor.modifyTokenAttribute('healthBar', 30, false, true);
    expect(actor.update).toHaveBeenLastCalledWith({ 'system.healthBar': 10 });
    expect(hud.render).toHaveBeenCalledTimes(2);
  });
  it('honors hook vetoes and reports invalid values without changing health', async () => {
    const actor = new DCCActor({ type: 'mob', system: { healthBar: 3, healthBarDisplay: 3, healthBarSlots: 5 } });
    actor.update = vi.fn();
    globalThis.Hooks = { call: vi.fn(() => false) };
    globalThis.ui = { notifications: { warn: vi.fn() } };
    await actor.modifyTokenAttribute('healthBar', 2, false, true);
    await actor.modifyTokenAttribute('healthBar', NaN, false, true);
    expect(actor.update).not.toHaveBeenCalled();
    expect(ui.notifications.warn).toHaveBeenCalledWith('DCC.Token.InvalidHealthBar');
  });
});
