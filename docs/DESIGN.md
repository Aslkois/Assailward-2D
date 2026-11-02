# Design and architecture

## Goals (from the implementation brief)

* A standalone 2D top-down 5v5 attacker-vs-defender shooter based on Assailward, with Phaser 3, TypeScript and Vite.
* The first deliverable is a playable offline match against AI, not a static demo.
* Must-haves:
  * open doorways with localized, destructible barricades (never doors);
  * directional centerline damage scaling;
  * strict information rules for both the player and the bots;
  * data-driven, modular code.

## Architecture

```
            ┌──────────────────────── src/game (Phaser) ────────────────────────┐
 keyboard → │ PlayerInput ──Intent──┐                 MapRenderer / WorldRenderer │ → screen
 mouse      │                       │   events        AudioDirector → Synth       │ → speakers
            │ GameScene (fixed 60 Hz step loop) ◄─────── HudScene                 │
            └───────────────────────┼─────────────────────────────────────────────┘
                                    ▼
            ┌──────────────────────── src/sim (pure TS) ────────────────────────┐
            │ BotDirector ─ TeamPlanner ─ BotBrain ──Intent──► World.step(dt)   │
            │   (perception: sight, sound, team intel)         ├ character.ts   │
            │                                                  ├ combat.ts      │
            │ GameMap (grid, doorways, panels, rooms)          ├ equipment.ts   │
            │ barricade.ts  collision.ts  raycast.ts  sight.ts ├ actions.ts     │
            │ damage.ts                                        └ round.ts       │
            └────────────────────────────────────────────────────────────────────┘
```

* **Simulation and presentation are separated.** `src/sim` never imports Phaser. The player and the bots both produce the same `Intent` structure (`move`, `aim`, `fire`, `secondary`, `interact`, `selectSlot`, …), so every rule applies identically to humans and AI. This also lets Vitest run full bot-vs-bot matches headlessly.
* **Fixed timestep.** `World.step(1/60)` runs from an accumulator fed by the raw frame delta, so the simulation stays real-time and deterministic per seed. Edge-triggered inputs (clicks, key presses) are queued until a step consumes them.
* **Data-driven.**
  * Weapons, equipment pools, armour, loadout rules and tuning constants live in `src/config`.
  * The map is ASCII plus metadata (`src/sim/maps`).
  * Round rules and match rules are plain objects (`DEFAULT_RULES`, `DEFAULT_MATCH`).
* **Events.** The world pushes `GameEvent`s (shots, hits, barricade changes, explosions, …), which the renderer, audio and HUD consume. Separately it records `SoundEvent`s each step for AI hearing.

### Step order (`World.step`)

1. Each operator applies its intent:
   * slot selection and the camera system;
   * movement and collision (with the prep spawn confinement);
   * melee;
   * contextual and hold actions;
   * weapon or equipment use.
2. Operators separate.
3. Drones, projectiles, deployables (claymores, alarms, attached charges) and smoke update.
4. A 10 Hz sighting pass runs: who can see whom, which feeds the team call-outs.
5. Intel expiry runs; marks and alarms track live.
6. The round state machine updates.

## Geometry and physics

* **Grid:** 16 px cells with materials `EMPTY`, `WALL`, `SOFT`, `REINF` and `PROP`. Soft cells have HP. Destroyed cells become rubble floor, so destruction changes collision, line of sight, ballistics and navigation immediately.
* **Collision:** circles are resolved against axis-aligned boxes — solid cells, **intact barricade sections** and shield rectangles — with sub-stepping so nothing tunnels. Drones ignore barricade sections; they slip underneath.
* **Ballistics and sight:** an Amanatides–Woo grid traversal plus ray-vs-box tests for barricade sections. Bullets also test shields, devices, drones and operators (operators via the centerline hit test). Smoke is a set of circles; sight is lost once a ray's accumulated depth inside smoke passes 18 px.

## Doorways and barricades

* Doorways are connected `D` cells in the map: 3 cells wide, 1 deep.
* A barricade is `{ segments: hp[6], complete, progress, team }` attached to a doorway. Only `complete` barricades are geometry, and only their sections with HP > 0.
* Passability is the widest contiguous run of destroyed sections, which must be at least 22 px (operator diameter plus a margin).
* `doorwayStatus()` reports `open | building | barricaded | damaged | breached`, plus `passable`, `obstructed`, `breachable` and `seeThrough`. Navigation, bots, the debug overlay and the tests all use it.

## Information model

* **Sighting:**
  * View cone (player 110°, bots 120°, precision aim 90°) plus a 42 px close-awareness radius.
  * Line of sight is checked to the target centre and two edge samples, through walls, intact barricade sections and smoke.
  * Cameras use a 100° cone and drones a 120° cone.
  * A blinded operator sees nothing.
* **Team intel:**
  * Every sighting updates a per-team map of last-known positions, which expires after 3 s.
  * Camera/drone *marks* (4.5 s) and alarms track live.
  * The pulse scanner gives 2.5 s snapshots.
  * Bots read intel as contacts; the player sees it as red diamonds.
* **Hearing:**
  * Each `SoundEvent` has a radius, cut by 22 % per wall cell crossed (to a minimum of 30 %).
  * Bots that hear an enemy source get an approximate contact whose error grows with distance.
* **Player rendering:**
  * The fog of war is an inverted stencil mask of the visibility polygon.
  * Enemies are drawn only when `canSeeCircle` passes, and are additionally clipped by the smoke-truncated polygon.
  * The environment is drawn from a `KnownMap` that updates only for cells the player's sight rays reach, or for their own team's changes.

## AI

* **Navigation (`ai/nav.ts`):**
  * Cell A* with diagonal moves and no corner-cutting, plus a wall-hugging penalty.
  * Per-agent policies:
    * barricades: `avoid` (defenders), `breach` (attackers, with an obstacle marker) or `ignore` (drones);
    * soft and reinforced walls are traversable only when carrying a matching tool;
    * defenders pay a cost for outdoor cells;
    * shields block and wire is expensive.
* **Brain (`ai/brain.ts`):**
  * Perception: contacts from sight, sound and intel.
  * Combat:
    * reaction delay and turn-rate-limited aim with a decaying sway;
    * burst control;
    * strafing only at close range; precision aim and crouch at range;
    * retreat at low health.
  * Path following with smoothing and stuck recovery.
  * Obstacle routines when the path meets a barricade or wall:
    * bash or hammer barricades;
    * place, retreat and detonate a breach charge;
    * shoot a soft wall open;
    * a defender removes their own barricade.
  * Equipment routines: throw, place, scan.
  * Utility decisions: flash an entry, frag a known contact, EMP visible electronics, smoke a plant, pulse-scan.
* **Planner (`ai/planner.ts`):**
  * Defenders:
    * Preparation jobs: barricades near the objective, reinforcements and personal gear. Anchors take jobs inside the objective room and roamers take the rest; everyone repositions in the last 5 s.
    * During action, anchors hold, may watch the cameras, and roamers patrol and investigate call-outs.
    * Everyone retakes a planted device.
  * Attackers:
    * Drone during preparation.
    * Push along assigned approach routes (the hard-breach carrier takes the reinforced-wall route).
    * One planter.
    * Post-plant guards hold sightlines onto the device.
* **Difficulty** changes reaction time, aim error, turn rate, burst length, strafing and how often bots use utility.

## Design decisions and assumptions

| Topic | Decision |
| --- | --- |
| Original specs | The original Assailward repository was checked and contains no specifications. All gadgets, utilities and weapons are original **provisional** designs, flagged in the UI and docs. |
| Ctrl / Alt | Toggles, to avoid browser shortcuts (Ctrl+W, Alt menus). **C** also crouches. A leave-page guard and fullscreen keyboard lock are added. |
| Melee | **V** (additional key) and F (bash a barricade, as an attacker). |
| Preparation | No operator can be damaged. Attackers are weapons-locked and confined to spawn, and scout with drones. Defenders fortify. |
| Barricade rebuild | An undamaged barricade can be removed and rebuilt. Tearing down a *damaged* one leaves that doorway open for the rest of the round, so damage persists. |
| Bullets vs structures | Bullets stop at intact barricade sections and soft wall cells and damage them (no penetration). Holes then allow sight and fire. |
| Friendly fire | Bullets pass through teammates. Your own explosives can hurt you; teammates' cannot. Flashbangs only affect the other team. |
| Drones | Two per attacker. They pass under barricades, and jammers stop them. |
| Camera knowledge | Map layout is known in advance; enemy-made changes are revealed by sight. |
| Match format | First to 4, sides switch every 2 rounds. Prep 40 s, action 2:50, fuse 35 s, plant 6 s, disable 8 s. |
