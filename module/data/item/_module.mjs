import WeaponModel from './weapon.mjs';
import SkillModel from './skill.mjs';
import SpellModel from './spell.mjs';
import GearModel from './gear.mjs';
import AttackModel from './attack.mjs';
import RaceModel from './race.mjs';
import ClassModel from './class.mjs';

export { default as BaseItemModel } from './base-item.mjs';
export { WeaponModel, SkillModel, SpellModel, GearModel, AttackModel, RaceModel, ClassModel };
export const itemModels = {
  weapon: WeaponModel,
  skill: SkillModel,
  spell: SpellModel,
  gear: GearModel,
  attack: AttackModel,
  race: RaceModel,
  class: ClassModel,
};
