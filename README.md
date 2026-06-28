# Space Rocks

An Asteroids-style space shooter built with HTML5 Canvas and vanilla JavaScript. No dependencies, no build step — just open `index.html` in a browser and play.

## Play

Clone or download the repo, then open `index.html` directly in any modern browser.

```bash
git clone https://github.com/TroyFluegge/space-rocks.git
cd space-rocks
open index.html   # macOS
# or just double-click index.html
```

## Controls

| Key | Action |
|---|---|
| `W` / `↑` | Thrust forward |
| `S` / `↓` | Reverse thrust |
| `A` / `←` | Rotate left |
| `D` / `→` | Rotate right |
| `Space` | Shoot / hold for laser |
| `B` | Detonate bomb |

## Gameplay

- Shoot space rocks to break them apart — large → medium → small → gone
- Avoid collisions or lose a life (3 lives total)
- Clear all rocks to advance to the next level
- Levels increase rock speed and spawn rate

## Power-ups

Colored diamond pickups drift across the field. Collect them by flying into them. They also have a 15% chance to drop from large rocks.

| Icon | Type | Effect | Duration |
|---|---|---|---|
| 🟡 **R** | Rapid Fire | Shoot cooldown drops from 0.25s → 0.08s | 15s |
| 🔵 **S** | Spread Shot | Fires 3 bullets in a fan | 15s |
| 🟣 **L** | Laser Beam | Hold Space for a continuous beam raycast | 15s |
| 🟠 **B** | Bomb | Stored (up to 3). Press `B` to split all rocks and destroy all enemies | One-use |

The active weapon is shown in the bottom-left with a countdown timer bar. Laser mode also shows a charge meter that depletes while firing and recharges when idle. If the laser overheats, it locks out briefly (bar turns red).

## Enemies

Green glowing UFO saucers enter from screen edges every 7–12 seconds. They are worth **500 points**. Starting at level 3 they gently home in on your position. One shot destroys them; colliding with one costs a life.

## Scoring

| Target | Points |
|---|---|
| Large rock | 20 |
| Medium rock | 50 |
| Small rock | 100 |
| Enemy saucer | 500 |

Hi-score is saved in `localStorage` and persists across sessions.

## Files

```
index.html   — canvas shell and CSS
game.js      — all game logic (~1,500 lines)
```
