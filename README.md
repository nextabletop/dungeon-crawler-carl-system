# Dungeon Crawler Carl Foundry VTT system

An official Foundry VTT **v14** game system. System id: `dungeon-crawler-carl`

Actor types: **Crawler** (`pc`), **Mob** (`mob`), and **Vehicle / Mount** (`vehicle`). Item types: weapon, skill, spell, gear, attack, race, class.

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
