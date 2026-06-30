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

## Mobile / touch input

Touch events are attached to `canvas` (not `window`) so `touch-action: none` is respected. Two independent fingers are tracked by identifier — a virtual joystick (left half of screen) and a continuous-fire zone (right half):

```javascript
let joystick = { active: false, id: null, curX: 0, curY: 0 };
let touchShootActive = false;
let touchShootId     = null;
let nameInputMode    = false;
```

- **Joystick** (left half): `touchstart` on the left half activates it and records the touch `identifier`; `touchmove` updates `curX/curY` only for the matching `identifier`; `touchend`/`touchcancel` deactivate it when that `identifier` lifts or gets hijacked. `joystickInput()` returns `{dx, dy}` clamped to `JOYSTICK_BASE_R`. `updateShip` uses **direct-vector control** when `joystick.active`: the stick's deflection angle directly becomes `ship.rotation` via `Math.atan2(dx, -dy)` and thrust is applied along that same heading, scaled by deflection magnitude (0..1) — pushing up-right snaps the ship to face and move up-right immediately, rather than the keyboard's rotate-then-thrust scheme. Keyboard controls (`isLeft/isRight/isForward/isBack`) are unaffected and keep the classic tank-style behavior (left/right rotate in place, up/down thrust along current facing) in the `else` branch of `updateShip`. Rendered by `renderJoystick()` — transparent outer ring, tick marks, and a knob that follows the drag — only drawn when `'ontouchstart' in window`.
- **Continuous fire** (right half): `touchstart` on the right half sets `touchShootActive = true` and records its own `identifier` in `touchShootId`; `isShoot()` returns true for as long as that finger is held, enabling laser beam and rapid fire to work continuously. Cleared on matching `touchend`/`touchcancel`.
- Both zones use `e.changedTouches` so the two fingers never interfere with each other. `releaseTouch(identifier)` is the shared cleanup helper both `touchend` and `touchcancel` call into.
- **Interrupted touches**: an in-progress drag can get hijacked by the OS/browser (Android's "swipe down to exit fullscreen", iOS's pull-to-refresh bounce) — the browser fires `touchcancel` instead of `touchend` for the hijacked touch. Without handling it, `joystick.active`/`touchShootActive` stayed stuck "true" with stale coordinates and the ship kept thrusting/firing with no finger on screen. Fixed by treating `touchcancel` the same as `touchend` (via `releaseTouch`), plus a `document` `visibilitychange` listener that force-clears all touch state if the page is backgrounded mid-touch. `overscroll-behavior: none` and `touch-action: none` on `html, body` in `index.html` also suppress the native gesture at the CSS level where the browser supports it.
- **Bomb button**: drawn bottom-right when `bombs > 0 && 'ontouchstart' in window`; hit-tested on `touchstart` via `isBombButtonHit()` (checked before the joystick/shoot zone routing).
- **Name entry**: when the game transitions to `name_entry` state, the hidden `<input id="nameInput">` (`type="text"`, `autocapitalize="off"` — both `type="search"` and native `autocapitalize` were tried and each independently caused various mobile IMEs to reset the caret mid-entry, seen as reversed text or just the first two letters swapped) is focused and `nameInputMode = true` is set. This first `.focus()` call happens inside collision-handling code at the moment of death, which is **not** a user gesture, so iOS Safari silently refuses to raise the keyboard for it (Android is more lenient). The canvas `touchstart` listener therefore re-focuses `#nameInput` on every tap while `state === 'name_entry'` — a real user gesture iOS will honor — as the actual mechanism that opens the keyboard on iPhone/iPad. While `nameInputMode` is true, the `window` `keydown` handler does not touch `nameEntryText`. The hidden input no longer trusts the native caret at all for plain typing: a `beforeinput` listener intercepts `insertText`/`deleteContentBackward`, calls `preventDefault()`, and builds `nameEntryText` itself from `e.data` — so wherever the OS keyboard's caret actually lands is irrelevant. `oninput` is kept only as a fallback for input types `beforeinput` doesn't handle (composition, paste), re-pinning the caret to the end the old way. `onblur` resets `nameInputMode = false`.

## game.js section order

1. **Constants** — canvas size, physics tuning, scoring, powerup/friendly config
2. **Canvas / Context** — single `canvas` + `ctx` reference; `resizeCanvas()` (calls `generateStars` + `generateBackground`)
3. **Input** — `keys` object; touch event listeners on canvas; `joystick`/`touchShootActive` state; `isLeft/isRight/isForward/isBack/isShoot/isStart`; `keydown` also captures name-entry characters when `state === 'name_entry'` (gated by `nameInputMode`)
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

`weaponMode` is `'normal' | 'rapid' | 'laser'` — these three are mutually exclusive. `spreadActive`
is a separate boolean that can stack on top of either one (or run standalone over `'normal'`).
Managed by `updateWeaponState(dt)` which runs every frame in `updatePlaying`.

- **Rapid**: handled in `updateShip` — shortens `ship.shootCooldown` to `0.08`
- **Spread**: also handled in `updateShip` — when `spreadActive`, fires 3 bullets in a fan
  (`[-0.32, 0, 0.32]` rad offsets) instead of 1, regardless of `weaponMode`; adds `+0.05` to
  whatever cooldown is active (normal or rapid)
- **Laser**: fully handled in `updateWeaponState`; sets `laserBeams = [{sx,sy,ex,ey,target}, ...]`
  each frame while Space is held — one beam normally, three fanned beams (same offsets as spread
  bullets) when `spreadActive` is also true; `renderLaserBeam` iterates the array
- **Stacking duration**: `collectPowerup()` checks whether the *other* slot is already active when
  a pickup is collected (e.g. collecting `spread` while `weaponMode === 'rapid'`). If so, both
  timers are set to `WEAPON_DURATION_STACKED` (30s) instead of `WEAPON_DURATION` (15s) —
  `weaponMaxDuration`/`spreadMaxDuration` record which one applies so the HUD bar fill stays
  accurate after a stack forms or one side expires early
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
- **Laser beam in tests**: `laserBeams` is reset to `[]` at the top of `updateWeaponState` each frame, so injecting it via CDP between frames won't produce a visible beam. Works correctly during real gameplay.
- **AudioContext suspended**: Chrome may suspend the context even after creation. `ensureAudio()` calls `audioCtx.resume()` defensively on each keypress.
- **bgCanvas on resize**: `generateBackground()` must be called after every resize because the offscreen canvas is sized to `CANVAS_W × CANVAS_H`.
- **Touch audio gate**: `ensureAudio()` is called in the `touchstart` handler so the first tap (which could be a menu tap before any key is pressed) properly unlocks the `AudioContext` on mobile Chrome/Safari.
- **iOS Safari has no in-tab Fullscreen API**: `document.documentElement.requestFullscreen` is `undefined` in Safari on iPhone/iPad for ordinary page content (only `<video>` gets a non-standard fullscreen via `webkitEnterFullscreen`), so `ensureFullscreen()`'s feature-detect guard makes it a permanent no-op there — this is a WebKit platform restriction, not a bug. The only way to get a true fullscreen, no-chrome experience on iOS is launching from the home screen icon (Add to Home Screen), which is why `manifest.json` sets `"display": "fullscreen"` and `index.html` has the `apple-mobile-web-app-capable` meta tags — those only take effect for that standalone launch, not a regular Safari tab. `isIosBrowserTab()` (UA sniff + `navigator.standalone`/`display-mode: standalone` check) and `updateIosInstallBanner()`, called every frame from `update(dt)`, show `#iosInstallBanner` (a plain HTML div, not canvas-rendered) on the menu screen to nudge these users toward Add to Home Screen; dismissing it persists `spaceRocksIosInstallDismissed` in `localStorage` so it doesn't reappear.
