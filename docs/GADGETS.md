# Utilities and special gadgets

> **All entries are PROVISIONAL.** The original Assailward project (`Aslkois/Assailward`) was checked for gadget, utility and weapon specifications. The repository contains only a README, so nothing could be ported. Every item, name and number below is an original Assailward 2D design, and the loadout screen tags each item `[PROVISIONAL]`. Data lives in `src/config/equipment.ts` and behaviour in `src/sim/equipment.ts`.

Each loadout takes **two utilities** and **two special gadgets**.

* Utilities come from the global pool plus the player's side pool.
* Special gadgets are strictly side-exclusive; there is no global gadget pool.
* Each item keeps its own charges and deployed state.
* Press **3** or **4** again to cycle between the two items in that category.

## Utility pools

| Item | Pool | Charges | Left click | Right click | Behaviour |
| --- | --- | --- | --- | --- | --- |
| Smoke Grenade | Global | 2 | throw toward cursor (max ~340 px) | short roll | 1.3 s fuse; 68 px cloud for ~12 s that blocks line of sight once a ray is 18 px deep in smoke |
| Flashbang | Global | 2 | throw | short roll | 1.4 s fuse, 230 px. Blinds enemies with line of sight for 0.5–3.9 s; weaker when they face away. Blinded bots cannot see. |
| Frag Grenade | Global | 2 | throw | short roll | 2.4 s fuse, 105 px, up to 140 damage; damages soft walls and barricades |
| Soft-Breach Charge | Attack | 2 | hold to place on a barricade or soft wall (1.0 s) | detonate | Destroys the barricade it is on and soft wall cells within 34 px; 80 damage within 64 px. Jammable. |
| Hard-Breach Charge | Attack | 1 | hold to place on a **reinforced** wall only (3.0 s) | detonate | Destroys reinforced and soft cells within 30 px (a passable hole); 100 damage within 72 px. Jammable. |
| Barbed Wire | Defend | 2 | hold to place (1.0 s) | — | 46×46 px floor trap: ×0.35 speed, no sprint, noisy to walk through; 80 HP. Pick up with F. |
| Deployable Shield | Defend | 1 | hold to place (1.0 s) | — | 44×8 px cover, 500 HP. Blocks bullets and movement but not vision; marks a doorway as **obstructed** for the AI. Pick up with F. |

## Attacker special gadgets

| Gadget | Charges | Use | Behaviour |
| --- | --- | --- | --- |
| Pulse Scanner | 3 | hold left click 1.2 s | Pings every defender within 260 px (through walls) to your team for 2.5 s |
| EMP Grenade | 2 | throw | 1.2 s fuse, 95 px. Disables defender cameras, bulletproof cameras, jammers, alarms and claymores for 10 s. |
| Breaching Hammer | unlimited | left click (0.35 s wind-up, 1 s cooldown) | 220 damage to barricade sections, soft wall cells, wire and shields in a 120° arc; 70 to operators |
| Claymore | 1 | hold to place (0.8 s) | Arms after 1.2 s. Triggers on a defender entering a 70 px, 80° cone with line of sight; 0.3 s delay, 130 damage within 90 px. Can be shot. |

## Defender special gadgets

| Gadget | Charges | Use | Behaviour |
| --- | --- | --- | --- |
| Signal Jammer | 2 | hold to place (0.8 s) | 82 px radius: attacker drones inside cannot move or see ("signal lost"), breach charges cannot detonate, claymores are disabled. 30 HP; EMP disables it. |
| Proximity Alarm | 2 | hold to place (0.6 s) | Attackers within 72 px set off a loud alarm and are pinged live to defenders. 20 HP. |
| Bulletproof Camera | 1 | hold to place against a wall (1.0 s) | Joins the defender camera network (slot 5). Immune to bullets; melee, explosives and EMP work. 60 HP. |
| Impact Grenade | 2 | throw | Explodes on contact (or after 3 s), 62 px, 90 damage. Very effective against soft walls (rotation holes) and barricades. |

## Baseline (not part of the loadout)

* **Drones:** every attacker has 2.
  * Press 5 to deploy and drive one; it can leave the spawn zone during preparation.
  * Drones are small, quick and slip under barricades. One bullet destroys them, and jammers stop them.
  * Left click marks enemies for the team.
* **Defender cameras:** six fixed map cameras plus any bulletproof cameras.
  * Press 5 to view them; the mouse pans ±60°, right click switches feeds, left click marks.
  * Attackers can shoot map cameras, and EMP disables them.
* **Fortification:**
  * Defenders can barricade any doorway (F).
  * The team shares **8 wall reinforcements** (F on a soft wall panel).
