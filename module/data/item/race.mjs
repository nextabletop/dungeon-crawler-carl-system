import BenefitItemModel from './benefit-item.mjs';
import { bool, str } from '../_fields.mjs';

export default class RaceModel extends BenefitItemModel {
  static defineSchema() {
    return {
      ...super.defineSchema(),
      size: str(),
      inheritRace: bool(false),
    };
  }
}
