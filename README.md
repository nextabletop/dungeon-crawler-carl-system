# Dungeon Crawler Carl Foundry VTT system

An official Foundry VTT **v14** game system. System id: `dungeon-crawler-carl`

Actor types: **Crawler** (`pc`), **Mob** (`mob`), and **Vehicle / Mount** (`vehicle`). Item types: weapon, skill, spell, gear, attack, race, class.

## Healing Potions

Drop the reusable Healing Potion Gear Item on a Crawler or Mob and choose Standard, Good, Gold Standard, or Supreme. The resulting Item records that quality and its description; healing and injury effects are applied manually. Existing owned potions and transfers between actors keep their existing details.

## Skill Potions

Drop a Skill Potion on a Crawler or Mob and enter its rank bonus. Use its flask button in Inventory (or its Crawler hotlist entry) to select an owned Skill, add a Skill from an accessible compendium, or create a custom Skill. This permanently increases base Rank and consumes one potion. A new custom Skill opens for editing. The lifetime limit of two Skill Potions per Crawler is not tracked or enforced.

Gear can specify `flags.dungeon-crawler-carl.grantedAttack` with `die`, `damageType`, and `range` to create a linked Attack when added to an Actor. The Attack starts without a To-Hit Ability or damage Ability and can be edited independently.

## Starting-loot Gear

Drop Mundane Armor or a Shiny Accessory onto an Actor to choose its gear slot. Existing items in that slot move to the pack. Shiny Accessories also let you select a +3 Stat and Skill pair; a missing Skill is added at base Rank 0 from the Core Rulebook Skills compendium. The bonuses apply while the item is equipped or active.

Quality Armor uses the same slot selection and offers Silver, Gold, or Platinum. Gold selects an uncommon damage Resistance; Platinum selects Catcher or Taunt, adding a missing Skill at Rank 0. Silver's Anti-Piercing and Gold's Resistance appear as gear-linked Buffs while the numeric modifiers apply automatically. Apply the damage effects of those Buffs manually.

## Races

Drop a Race Item on an owned Crawler to set its Race and size and create a Race Buff. Skill bonuses apply to effective Rank, not base Rank. Existing Skills are reused; missing Skills are loaded from the compendium named by the Race, and Attack Skills grant linked Attacks. Replacing a Race requires confirmation and removes the previous Race Buff, while keeping Skills and their base Ranks. Prerequisites are not enforced. Required benefit choices are made before applying the Race.

Race Item data uses `system.modifiers` entries `{target, value}` for DCC field targets and `system.skillGrants` entries `{name, pack, bonus, type}` for Skill or Spell Rank bonuses (`type` defaults to `skill`). A Spell grant may also specify `manaCostPercent`. `system.effectDescription` holds benefits that are not automatic. A blank `size` preserves the Crawler's existing size; `inheritRace` keeps an existing Race Buff, as required for Primal.

`system.choices` supports groups `{label, count, options}` with explicit benefit options, `kind: "allocation"` for distributing points across option `target` fields, and `kind: "grant"` with `type`, `pack`, and `bonus` to select owned or compendium Skills or Spells. Broad categories such as crafting are not classified in the Items; the player must select an eligible Skill. Referenced compendiums must be enabled and contain exactly one matching Item per missing grant.

## Classes

Drop a Class Item on an owned Crawler to set its Class and create a Class Buff using the same structured benefits and choices as a Race. Replacing a Class requires confirmation and leaves the Race Buff, Skills, Spells, and base Ranks intact. Prerequisites and conditional benefits are not enforced. For broad choices such as crafting, weapon, or damage-type Spells, the player must select an eligible Item.

## Install

In Foundry's **Game Systems** tab, choose **Install System** and enter this manifest URL:

`https://raw.githubusercontent.com/nextabletop/foundry-dungeon-crawler-carl/main/system.json`

Releases publish an installable ZIP automatically when a version tag matching `system.json` is pushed (for example, `v0.1.0`). The first release must be published before Foundry can download the system.
