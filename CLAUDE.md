# Space Rocks — Claude Code Guide

## Running the game

Use the score server (zero extra dependencies — Python stdlib only):

```bash
python3 server.py
# then open http://localhost:8765
```

The server serves static files AND handles the `/api/scores` REST API.
Scores are stored in `scores.db` (SQLite, auto-created on first run).

Opening `index.html` as a `file://` URL still works but the leaderboard
falls back to localStorage-only (no shared global scores).

## File structure

```
index.html   — canvas element + minimal CSS
game.js      — all game logic (~2,600 lines, no modules)
server.py    — Python score server (stdlib only, no pip install)
scores.db    — SQLite score database (auto-created on first run)
```

## Score API

| Method | Path | Body | Returns |
|---|---|---|---|
| GET  | `/api/scores` | —              | `[{name, score, created_at}]` top 10 |
| POST | `/api/scores` | `{name, score}` | `[{name, score, created_at}]` updated top 10 |

`game.js` leaderboard functions are async (`fetchLeaderboard`, `submitScore`).
On startup, localStorage is read synchronously for instant display, then the
server is fetched in the background. Optimistic local update on submit; server
response replaces it with the authoritative list.

## game.js section order

1. **Constants** — canvas size, physics tuning, scoring, powerup/friendly config
2. **Canvas / Context** — single `canvas` + `ctx` reference; `resizeCanvas()` (calls `generateStars` + `generateBackground`)
3. **Input** — `keys` object; `keydown` also captures name-entry characters when `state === 'name_entry'`
4. **Audio** — lazy `AudioContext` (created on first keypress); all sounds synthesized with oscillators/noise buffers
5. **Factory functions** — `createShip`, `createBullet`, `createDebris` (includes `craters[]`), `createEnemy`, `createFriendly`, `createPowerup`
6. **Level config** — `getLevelConfig(n)` returns spawn rate, max debris, speed multiplier
7. **Game state** — all mutable state as module-level `let` variables
8. **Stars** — `generateStars()` creates 220 colored/twinkling stars
9. **Background** — `generateBackground()` pre-renders sky gradient, nebula, and celestial body into an offscreen `bgCanvas`; 8 themes cycle by `(level-1) % 8`
10. **Spawning** — edge-spawn helpers for debris, enemies, powerups, friendlies; `splitDebris`; `detonateBomb`
11. **Level/game start** — `resetWeapon`, `startLevel` (calls `generateBackground`), `startGame`
12. **Update** — `update(dt)` dispatches by state; `updatePlaying` calls all subsystem updaters
13. **Leaderboard** — `loadLeaderboardCache`, `fetchLeaderboard` (async), `submitScore` (async), `qualifiesForLeaderboard`, `topScore`
14. **Render** — `render()` dispatches by state; `renderPlaying` calls all draw functions in painter's order

## Game loop

```
requestAnimationFrame(gameLoop)
  → delta capped at 50ms to prevent physics explosion on tab re-focus
  → update(dt)  then  render()
```

All movement is `pos += vel * dt` (frame-rate independent).

## State machine

```
'menu'  ──(Space/Enter)──►  'playing'  ──(lives===0, no qualify)──►  'game_over'
                                │                                           │
                          (wave cleared)                          (2s lockout, Space)
                                ▼                                           ▼
                         levelTransitionTimer                           'menu'
                         (2.5s overlay, then startLevel(n+1))
                                                 │
                                    (lives===0, qualifies for top 10)
                                                 ▼
                                          'name_entry'
                                    (Enter → submitScore → 'menu')
```

## Entity patterns

Every entity has `{ x, y, vx, vy, radius, active }`. Collision is always circle-circle (`circlesOverlap`). Entities are marked `active = false` during a loop pass and filtered out after — never splice mid-iteration.

```javascript
// Standard update pattern
for (const e of arr) {
    if (!e.active) continue;
    // ... mutate e ...
}
arr = arr.filter(e => e.active);   // after the loop
arr.push(...newItems);             // new children appended after filter
```

## Friendly entity system

`friendlies[]` holds spacemen and ISS objects. They spawn from edges and drift off-screen on a straight trajectory (no wrapping). Extra fields beyond the standard entity:

```javascript
{ type: 'spaceman'|'iss', bobTimer, shipTouching, rotation }
```

**Collision order in `checkCollisions`** is critical:
1. Ship vs Friendlies runs **first** — sets `f.shipTouching` and calls `collectFriendly(f)`
2. Bullets vs Friendlies runs **after** — skips any friendly where `f.shipTouching || f === assistSource`

This ordering prevents "friendly fire" when the player flies into a friendly
while shooting — bullets that would hit the spaceman are suppressed that frame.

**Assist state variables:**
```javascript
assistActive    // bool — auto-fire is running
assistSource    // reference to the friendly providing assist
assistTimer     // seconds remaining
assistFireRate  // SHOOT_COOLDOWN for spaceman; 0.5 for ISS
assistFireTimer // countdown to next shot
```

Spaceman fires one aimed bullet at nearest threat. ISS fires 8 bullets
simultaneously in a star pattern (every 45°). Both fire from the
friendly's current position (`assistSource.x/y`).

## Weapon system

`weaponMode` is `'normal' | 'rapid' | 'spread' | 'laser'`. Managed by `updateWeaponState(dt)` which runs every frame in `updatePlaying`.

- **Rapid / Spread**: handled in `updateShip` — cooldown and bullet count differ per mode
- **Laser**: fully handled in `updateWeaponState`; sets `laserBeam = {sx,sy,ex,ey,target}` each frame while Space is held; `renderLaserBeam` reads it
- **Bomb**: `detonateBomb()` called from `updateShip` on `KeyB` press; uses a key-used guard (`keys['_bUsed']`) to prevent repeat

## Background system

`generateBackground()` draws into an offscreen `bgCanvas` (recreated on level change and window resize). It is blitted to the main canvas at the start of each `renderBackground()` call, then dynamic twinkling stars are drawn on top.

Eight themes cycle by `(level - 1) % 8`:

| # | Theme | Key feature |
|---|---|---|
| 0 | Earth Orbit | Blue planet + grey moon |
| 1 | Inner Solar System | Sun with corona rays |
| 2 | Jupiter Region | Banded gas giant + moon |
| 3 | Nebula Cluster | Three overlapping vivid nebulae |
| 4 | Binary Stars | Hot orange + cool blue sun |
| 5 | Saturn Ring System | Ringed planet |
| 6 | Deep Space | Spiral galaxy, near-black sky |
| 7 | Solar Corona | Massive sun half-visible at edge |

## Audio

`AudioContext` is created lazily in `ensureAudio()` on the first `keydown`. Always call `ensureAudio()` before playing anything — browsers block audio until a user gesture.

Noise-based sounds (explosions, bomb) use `AudioBufferSourceNode` with a random float32 buffer — not the deprecated `ScriptProcessorNode`.

## Rendering tips

- Always wrap draw calls in `ctx.save()` / `ctx.restore()` — transforms accumulate
- Debris is filled with a radial gradient + craters; outline color lightens for smaller sizes
- Ship uses layered paths: wings → fuselage → cockpit → engine nozzle → flame (when thrusting)
- `ctx.shadowBlur` is expensive; keep it scoped inside `save/restore` blocks
- Render order: background (bgCanvas + stars) → particles → debris → powerups → friendlies → enemies → laser beam → bullets → ship → floating texts → HUD → notification → bomb flash → level overlay

## Known quirks

- **Headless Chrome viewport**: `100vh` in headless resolves smaller than the canvas. Fixed with `min-height: 100vh` on `body`. Real browsers unaffected.
- **Laser beam in tests**: `laserBeam` is reset to `null` at the top of `updateWeaponState` each frame, so injecting it via CDP between frames won't produce a visible beam. Works correctly during real gameplay.
- **AudioContext suspended**: Chrome may suspend the context even after creation. `ensureAudio()` calls `audioCtx.resume()` defensively on each keypress.
- **bgCanvas on resize**: `generateBackground()` must be called after every resize because the offscreen canvas is sized to `CANVAS_W × CANVAS_H`.
