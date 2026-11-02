# Damage model

Implementation: `src/sim/damage.ts` (pure functions), applied by `src/sim/combat.ts` (bullets), `src/sim/equipment.ts` (explosions) and `src/sim/world.ts` (`damageCharacter`). Tests: `tests/damage.test.ts`.

Operators have **100 HP**. A hitbox is a circle with radius **R = 9 px**.

## 1. Hit resolution (firearms)

Every bullet (and every shotgun pellet) is a hitscan ray from the shooter's centre along the fired direction, which includes spread and recoil. The ray is traced against all of these, and the **nearest** hit wins:

* grid walls and props;
* intact barricade sections;
* shields and enemy devices;
* enemy drones;
* enemy operators.

Teammates and friendly devices are passed through, so there is no friendly fire with bullets. Shields stop every bullet regardless of team.

Operators are resolved with `evaluateCenterlineHit(origin, dir, centre, R, maxRange)`. It returns `null` (a miss, no damage) when:
* the trajectory never touches the circle (perpendicular distance > R);
* the circle is entirely behind the muzzle;
* the entry point is farther than the nearest obstacle, or beyond the weapon's range.

Damage scaling is only produced **after** that intersection is confirmed.

## 2. Directional centerline scaling

```
C = target centre          P = any point on the shot trajectory
D = normalised direction   R = effective collision radius
d = |cross(D, C - P)|                       perpendicular distance
proximity  = clamp(1 - d / R, 0, 1)
multiplier = 1 + 0.5 * proximity            (hard cap 1.5)
```

| Shot position (d / R) | Multiplier |
| --- | --- |
| 0 (dead centre) | 1.50× |
| 0.25 | 1.375× |
| 0.50 | 1.25× |
| 0.75 | 1.125× |
| 1.00 (tangent / edge) | 1.00× |
| > 1 | miss — no damage |

* **Orientation independent:** the function has no facing input. A shot through the centre gets 1.5× from the front, back or side.
* **Trajectory based:** it uses the actual (spread-perturbed) bullet ray, never the mouse position or a random roll.
* **Per pellet:** each shotgun pellet gets its own multiplier.
* **No headshots:** there is no other location multiplier, and nothing can push the result above 1.5×.
* Hitboxes are circles. If a different silhouette is ever used, normalise `d` against that silhouette's boundary along the perpendicular so the 1.0–1.5 mapping is preserved.

## 3. Damage pipeline (fixed order)

For each bullet or pellet that hits an operator:

| Step | Factor | Source |
| --- | --- | --- |
| 1 | `base` | weapon damage per projectile (`config/weapons.ts`) |
| 2 | × `rangeFalloff(distance)` | 1.0 up to `falloff.start`, then linear to `falloff.min` at `falloff.end` |
| 3 | × `centerline` | 1.0 – 1.5 (section 2) |
| 4 | × `(1 − armour)` | Light 0 %, Medium 10 %, Heavy 20 % |
| 5 | = HP removed | no further multipliers |

`computeBulletDamage()` returns every factor (`DamageBreakdown`) so the order is explicit and testable. In-game floating numbers show the final damage and the centerline multiplier.

## 4. Explosions

Explosions (frag, impact, breach charges, claymore) use `computeExplosionDamage`:

```
damage = maxDamage × (1 − distance / radius) × (1 − armour)
```

* Distance is measured to the target's centre minus half its radius.
* Concrete walls block the blast; barricades and holes do not.
* Explosions have **no centerline scaling**: that is a firearm mechanic.
* Own explosives hurt yourself but never teammates.

Structure is processed **before** operators, so a breach blast also reaches whoever was standing behind the wall it destroyed.

## 5. Material damage

| Target | Bullet | Melee (V / F bash) | Breaching Hammer | Explosions |
| --- | --- | --- | --- | --- |
| Barricade section (60 HP each, 6 per doorway) | `damage × materialMult × 0.5` to the section hit | 40 to each section in a 120° arc | 220 per section in arc | per section by distance |
| Soft wall cell (100 HP) | `damage × materialMult × 0.25` | 24 | 220 | frag 160, impact 260 (falloff), breach charges destroy |
| Reinforced wall | none | none | none | hard-breach charge only |
| Concrete / props | none | none | none | none |

`materialMult` is a per-weapon value. Shotguns are 2.5×, so a Breacher-12 opens barricades and soft walls quickly.
