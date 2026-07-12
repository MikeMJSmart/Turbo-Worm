# Turbo Worm — Build Summary

**Status:** Complete, QA'd, deployed.
**Deployed URL:** https://www.perplexity.ai/computer/a/turbo-worm-ckUFjDSES16qmu4pkf_B2g
**Project path:** `/home/user/workspace/turbo-worm-game`
**Git:** initialized, 1 commit (`df73191` — "Complete Turbo Worm game: entities, levels, boss, HUD, screens, audio, testing hooks")

## Game Concept
Original IP inspired by (not copying) Earthworm Jim's tone: wacky cartoon-action-comedy 2D run-and-gun platformer.
- **Title:** TURBO WORM — "Suit Up. Blast Off."
- **Hero:** Wally, an earthworm zapped by a crashed alien battle-suit, now a cybernetic commando with a plasma blaster and whip-tail attack.

## Controls
| Action | Keys |
|---|---|
| Move | Arrow Keys / A D |
| Jump (hold for higher jump, coyote time) | Space / W / Up |
| Shoot plasma gun | Z or Left Click |
| Whip-tail attack (close range, breaks crates) | X or Right Click |
| Pause | Esc / P |

## Level Design
1. **Junkyard Planet** — rusty scrap platforms, purple sky, patrol-bot enemies, crates, energy orbs + 2 health pickups.
2. **Toxic Swamp** — glowing green ooze aesthetic, mushroom platforms, chaser "swamp critter" enemies + shooter "drones".
3. **Alien Factory** — neon industrial pipes/conveyor belts, patrol bots + drones + chasers, ends in an open boss arena.
   - **Boss:** Mutatron the Catfish — a giant mutant catfish-robot with 3 behavior phases (chase, charge, triple-shot spit) and a health bar HUD element.

Score, lives (3 start), health (100), and energy (100, regenerates when not firing; each shot costs energy) persist across levels. Falling into a pit or losing all health costs a life and respawns at the level's start with full health; losing the last life triggers Game Over. Defeating the boss triggers Victory.

## Screens
Title (Start/How-to-Play buttons + splash art) → Instructions (control legend) → Playing → Pause (Resume/Restart Level/Mute) → Level Transition banners → Game Over (retry/title) → Victory (play again). All rendered directly on canvas using the Bungee (display) + Space Grotesk (body/HUD) font pairing loaded from Google Fonts.

## Audio
Fully procedural Web Audio API — no external audio files, avoiding CORS/CDN risk entirely. Each level has a distinct oscillator-based chiptune loop (junkyard/swamp/factory scales), plus SFX for jump, shoot, whip, hit, pickup, enemy defeat, player hurt, boss hit, boss defeat, and menu select. Audio initializes on the required "Click to Power On" gesture gate.

## Art Assets (all AI-generated, no placeholders)
- `title_splash.png`, `bg_junkyard.png`, `bg_swamp.png`, `bg_factory.png`
- `hero_idle/run/jump/shoot/whip.png` (5 poses, chroma-keyed transparent)
- `enemy_patrol_bot_t.png`, `enemy_swamp_critter_t.png`, `enemy_drone_t.png`
- `boss_catfish_t.png`
- `screen_gameover.png`, `screen_victory.png`

## Technical Notes
- Single-file `game.js` (constants/utils/input/audio + entities/camera/particles + level data + game state machine/HUD/screens + bootstrap), loaded as a plain `<script>` (no ES modules) alongside `index.html` / `style.css`.
- Fixed-timestep game loop (`TICK = 1/60`) driven by `requestAnimationFrame`.
- Debug overlay (FPS counter, bottom-left, green/red threshold at 30fps) visible by default.
- **Testing hooks implemented and verified:**
  - `window.render_game_to_text()` — JSON dump of mode, player, enemies, boss, collectibles, camera, fps.
  - `window.advanceTime(ms)` — steps fixed-timestep update deterministically, then renders.
  - `window.simulateInput({keys, mouse, click, startGame})` — programmatic key/mouse/click injection.
- No sandbox-forbidden APIs used (no localStorage/sessionStorage/IndexedDB, no Pointer Lock, no Fullscreen API, no alert/confirm/prompt).
- Verified via Playwright: title, instructions, gameplay (all 3 levels), HUD, jump/shoot/whip mechanics, collectible pickup, enemy contact damage + respawn/lives, level transitions 1→2→3, boss fight + defeat, victory screen, game-over screen, pause menu, mobile viewport (480px) responsiveness. No console errors.

## Update: Procedural Levels and Platform Camera Fix

- Fixed platforms appearing to move with the player by rendering them relative to camera.x.
- Replaced fixed platform layouts with controlled procedural generation.
- Platform count, width, height, and spacing now vary on each level load.
- Enemy placement/types, collectibles, and crates now vary each run.
- Vertical changes and gaps are constrained to keep routes playable.
- Level 3 keeps a consistent open boss arena while randomizing the approach.
- Restarting a level generates a fresh layout.
