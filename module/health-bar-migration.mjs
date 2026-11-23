import { SYSTEM_ID } from './config.mjs';

const SETTING = 'healthBarTokenMigration';
const HEALTH_TYPES = new Set(['pc', 'mob', 'vehicle']);

export const registerHealthBarMigration = () => {
  game.settings.register(SYSTEM_ID, SETTING, {
    scope: 'world', config: false, type: Boolean, default: false,
  });
};

/** Migrate only the former system default, leaving custom Bar 1 choices intact. */
export const migrateHealthBarTokens = async () => {
  if (!game.user?.isActiveGM || game.settings.get(SYSTEM_ID, SETTING)) return;
  for (const actor of game.actors) {
    if (HEALTH_TYPES.has(actor.type) && actor.prototypeToken?.bar1?.attribute === 'healthPoints') {
      await actor.update({ 'prototypeToken.bar1.attribute': 'healthBar' });
      if (actor.prototypeToken?.bar1?.attribute !== 'healthBar') {
        throw new Error(`Could not update Bar 1 for actor ${actor.id}`);
      }
    }
  }
  for (const scene of game.scenes) {
    const tokens = scene.tokens.filter(token => HEALTH_TYPES.has(token.actor?.type) && token.bar1?.attribute === 'healthPoints');
    if (tokens.length) {
      await scene.updateEmbeddedDocuments('Token', tokens.map(token => ({ _id: token.id, 'bar1.attribute': 'healthBar' })));
      const failed = tokens.find(token => token.bar1?.attribute !== 'healthBar');
      if (failed) throw new Error(`Could not update Bar 1 for token ${failed.id} in scene ${scene.id}`);
    }
  }
  await game.settings.set(SYSTEM_ID, SETTING, true);
};
