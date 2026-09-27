# SkyHop — Product Requirements & Progress

## Original Problem Statement
Build an original browser game "SkyHop", inspired only by the general one-button obstacle-dodging pattern (Flappy Bird-style). Original assets only. Player controls a flying character passing through gaps between moving obstacles for as long as possible. High score saved locally. Responsive desktop/tablet/mobile.

## User Choices
- Visual style: Bright & playful daytime sky
- Sound: Built-in Web Audio sounds (no external service)
- Character: A little bird

## Architecture
- Frontend-only React app (no backend needed). MongoDB/API unused for this game.
- Single canvas-based game component: `/app/frontend/src/SkyHop.jsx`
- Rendering via `requestAnimationFrame`, delta-time physics (clamped MAX_DT) for smooth frame-rate-independent play.
- Coordinates normalized (vertical = fraction of height, horizontal = fraction of width) so proportions stay sensible across screen sizes; ResizeObserver + devicePixelRatio for crisp responsive canvas.
- Web Audio API generates jump/score/crash sounds (no assets).
- High score persisted in `localStorage` key `skyhop_highscore_v1`.

## Core Requirements (static)
- One-button control: Space / mouse click / tap → single consistent upward impulse.
- Continuous gravity; obstacles enter right → move left; passable gaps with varied but fair position.
- +1 score per obstacle passed, exactly once. Collision with obstacle or lower ground ends run.
- States: Start (title, instructions, Start), Playing (bird, obstacles, live score), Game Over (final score, high score, restart).
- Gradual difficulty via obstacle speed (capped, no spikes). Restart fully resets.

## Implemented (2026-06-27)
- Full game loop, physics, spawning, collision, scoring, difficulty ramp.
- Start / Playing / Game Over states with original bird, green pipe obstacles, clouds, sun, hills, ground.
- Built-in sounds + mute toggle. localStorage high score with "New Best" indicator.
- Responsive canvas (desktop/tablet/mobile), tap/click/Space input.
- Tested by testing agent (frontend, 92%): all core flows pass. Fixed mute-toggle z-index over overlays.

### Iteration 2 (2026-06-27)
- **Medals**: Bronze (>=5) / Silver (>=15) / Gold (>=30) badge on Game Over screen.
- **Day/Night themes**: sky shifts day (0-14) -> sunset (15-29) -> starry night (30+) as score climbs.
- **Power-Up Feathers**: rare floating gold feather grants a one-hit shield (bubble + top-left indicator, brief invulnerability + bounce on absorb).
- **Tab Pause**: auto-pauses on tab blur (visibilitychange); Resume button / Space / tap resumes without losing the run.
- Testing agent frontend 100% pass, no bugs. Feather spawn rate tuned to rare (0.14).

## Backlog
- P2: Pause when tab backgrounded (currently pipes advance while hidden; mitigated by dt clamp).
- P2: try/catch around localStorage for private-mode browsers.
- P2: Optional day/night theme variation, medals/streaks.

## Next Tasks
- Await user feedback for polish or feature additions.
