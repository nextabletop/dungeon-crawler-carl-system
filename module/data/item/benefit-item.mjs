import BaseItemModel from './base-item.mjs';
import { html } from '../_fields.mjs';

export default class BenefitItemModel extends BaseItemModel {
  static defineSchema() {
    const fields = foundry.data.fields;
    const objects = () => new fields.ArrayField(new fields.ObjectField(), {
      required: true, nullable: false, initial: [],
    });
    return {
      ...super.defineSchema(),
      effectDescription: html(),
      modifiers: objects(),
      skillGrants: objects(),
      choices: objects(),
    };
  }
}
