export default class DCCTokenDocument extends foundry.documents.TokenDocument {
  /** Expose the stored slot count as a graphical Foundry resource bar. */
  getBarAttribute(barName, options = {}) {
    const data = super.getBarAttribute(barName, options);
    if (data?.attribute !== 'healthBar' || data.type !== 'value') return data;
    const system = this.actor.system;
    if (!Number.isFinite(system.healthBarSlots)) return data;
    return {
      ...data,
      type: 'bar',
      value: system.healthBarDisplay ?? data.value,
      max: system.healthBarSlots,
    };
  }
}
