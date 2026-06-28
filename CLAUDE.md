# Space Rocks — Claude Code Guide

## Running the game

No build step. Serve the directory over HTTP (required for reliable audio context init):

```bash
python3 -m http.server 8765
# then open http://localhost:8765/index.html
```

Opening `index.html` as a `file://` URL also works but Web Audio may be restricted in some browsers.

## File structure

```
index.html   — canvas element (800×600) + minimal CSS centering
game.js      — everything else (~1,500 lines, no modules)
```

`game.js` is organized into clearly commented sections in this order:

1. **Constants** — canvas size, physics tuning, scoring, powerup config
2. **Canvas / Context** — single `canvas` + `ctx` reference
3. **Input** — `keys` object populated by `keydown`/`keyup`; helper functions `isLeft()`, `isForward()`, etc.
4. **Audio** — lazy `AudioContext` (created on first keypress); all sounds synthesized with oscillators/noise buffers
5. **Factory functions** — `createShip`, `createBullet`, `createDebris`, `createEnemy`, `createPowerup`
6. **Level config** — `getLevelConfig(n)` returns spawn rate, max debris, speed multiplier
7. **Game state** — all mutable state as module-level `let` variables
8. **Stars** — generated once at init, static
9. **Spawning** — edge-spawn helpers for debris, enemies, powerups; `splitDebris`; `detonateBomb`
10. **Level/game start** — `resetWeapon`, `startLevel`, `startGame`
11. **Update** — `update(dt)` dispatches by state; `updatePlaying` calls all subsystem updaters
12. **Render** — `render()` dispatches by state; `renderPlaying` calls all draw functions in painter's order

## Game loop

```
requestAnimationFrame(gameLoop)
  → delta capped at 50ms to prevent physics explosion on tab re-focus
  → update(dt)  then  render()
```

All movement is `pos += vel * dt` (frame-rate independent).

## State machine

```
'menu'  ──(Space/Enter)──►  'playing'  ──(lives===0)──►  'game_over'
                                │                               │
                          (wave cleared)               (2s lockout, then)
                                ▼                               ▼
                         levelTransitionTimer              'menu'
                         (2.5s overlay, then startLevel(n+1))
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

## Weapon system

`weaponMode` is `'normal' | 'rapid' | 'spread' | 'laser'`. Managed by `updateWeaponState(dt)` which runs every frame in `updatePlaying`.

- **Rapid / Spread**: handled in `updateShip` — cooldown and bullet count differ per mode
- **Laser**: fully handled in `updateWeaponState`; sets `laserBeam = {sx,sy,ex,ey,target}` each frame while Space is held; `renderLaserBeam` reads it
- **Bomb**: `detonateBomb()` called from `updateShip` on `KeyB` press; uses a key-used guard (`keys['_bUsed']`) to prevent repeat

## Audio

`AudioContext` is created lazily in `ensureAudio()` on the first `keydown`. Always call `ensureAudio()` before playing anything — browsers block audio until a user gesture.

Noise-based sounds (explosions, bomb) use `AudioBufferSourceNode` with a random float32 buffer — not the deprecated `ScriptProcessorNode`.

## Rendering tips

- Always wrap draw calls in `ctx.save()` / `ctx.restore()` — transforms accumulate
- Debris is drawn by scaling the unit-polygon `DEBRIS_SHAPES` arrays with `ctx.scale(radius, radius)`
- `ctx.shadowBlur` is expensive; keep it scoped inside `save/restore` blocks
- Render order: stars → particles → debris → powerups → enemies → laser beam → bullets → ship → floating texts → HUD → notification → bomb flash → level overlay

## Known quirks

- **Headless Chrome viewport**: `100vh` in headless resolves smaller than the canvas, clipping the top of the canvas. Fixed by using `min-height: 100vh` on `body` so it grows to fit. Real browsers are unaffected.
- **Laser beam in tests**: `laserBeam` is reset to `null` at the top of `updateWeaponState` each frame, so injecting it via CDP between frames won't produce a visible beam in a screenshot. Works correctly during real gameplay.
- **AudioContext suspended**: Chrome may suspend the context even after creation. `ensureAudio()` calls `audioCtx.resume()` defensively on each keypress.
