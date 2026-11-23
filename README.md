# Dungeon Crawler Carl Foundry VTT system

An official Foundry VTT **v14** game system. System id: `dungeon-crawler-carl`

Actor types: **Crawler** (`pc`), **Mob** (`mob`), and **Vehicle / Mount** (`vehicle`). Item types: weapon, skill, spell, gear.

Token Bar 1 tracks Health Bar slots. When a GM first opens the updated world, existing actor prototypes and scene tokens using the former `healthPoints` default are switched to `healthBar`; other bar choices are preserved. Compendium actors are not modified, but their former `healthPoints` default is switched when they are imported into a world, including when dropped onto a scene.

## Install

In Foundry's **Game Systems** tab, choose **Install System** and enter this manifest URL:

`https://raw.githubusercontent.com/nextabletop/foundry-dungeon-crawler-carl/main/system.json`

Releases publish an installable ZIP automatically when a version tag matching `system.json` is pushed (for example, `v0.1.0`). The first release must be published before Foundry can download the system.
