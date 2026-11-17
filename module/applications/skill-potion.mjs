import { APP_CLASSES } from '../config.mjs';

const values = collection => Array.from(collection?.contents ?? collection?.values() ?? []);

/** Select an owned Skill, an available compendium Skill, or a new custom Skill. */
export async function choosePotionSkill(actor, packs) {
  const escape = foundry.utils.escapeHTML;
  const choices = values(actor.items)
    .filter(item => item.type === 'skill')
    .map(item => ({ label: game.i18n.format('DCC.SkillPotion.Owned', { name: item.name }), kind: 'owned', id: item.id }));
  const itemPacks = values(packs).filter(pack => pack.documentName === 'Item' && pack.visible !== false);
  const indexes = await Promise.all(itemPacks.map(pack => pack.getIndex({ fields: ['type'] })));
  itemPacks.forEach((pack, index) => {
    for (const entry of values(indexes[index])) {
      if (entry.type === 'skill') choices.push({
        label: `${entry.name} (${pack.title})`, kind: 'compendium', pack: pack.collection, id: entry._id,
      });
    }
  });
  choices.sort((a, b) => a.label.localeCompare(b.label));
  const selected = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize('DCC.SkillPotion.ChooseSkill') },
    content: `<div class="form-group"><label for="dcc-potion-skill">${escape(game.i18n.localize('DCC.SkillPotion.Skill'))}</label>
      <select id="dcc-potion-skill" name="skill">
        <option value="" selected disabled>—</option>
        ${choices.map((choice, index) => `<option value="${index}">${escape(choice.label)}</option>`).join('')}
        <option value="custom">${escape(game.i18n.localize('DCC.SkillPotion.Custom'))}</option>
      </select></div>`,
    buttons: [
      { action: 'apply', label: game.i18n.localize('DCC.SkillPotion.Continue'),
        callback: (_event, button) => button.form.elements.namedItem('skill').value },
      { action: 'cancel', label: game.i18n.localize('DCC.Inventory.Cancel') },
    ],
    classes: [...APP_CLASSES], rejectClose: false, modal: true,
  });
  if (selected == null || selected === 'cancel') return null;
  if (selected === 'custom') {
    const name = await foundry.applications.api.DialogV2.wait({
      window: { title: game.i18n.localize('DCC.SkillPotion.Custom') },
      content: `<div class="form-group"><label for="dcc-potion-name">${escape(game.i18n.localize('DCC.Sheet.Name'))}</label>
        <input id="dcc-potion-name" name="name" type="text"></div>`,
      buttons: [
        { action: 'apply', label: game.i18n.localize('DCC.SkillPotion.Use'),
          callback: (_event, button) => ({ name: button.form.elements.namedItem('name').value }) },
        { action: 'cancel', label: game.i18n.localize('DCC.Inventory.Cancel') },
      ],
      classes: [...APP_CLASSES], rejectClose: false, modal: true,
    });
    if (name == null || name === 'cancel') return null;
    return { kind: 'custom', name: name.name };
  }
  if (!/^\d+$/.test(selected) || !choices[Number(selected)]) throw new Error('Select a Skill before using the potion.');
  return choices[Number(selected)];
}
