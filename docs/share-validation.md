# Sharing and phone gesture validation

Issue #58 changes entry to a clean title/name/team screen and a returning-player Play button. The entry copy and automatic-return timings below are historical; see [current entry evidence](start-validation.md). The probe now activates Play before expecting gameplay.

2026-11-20, Windows factory desktop, Bun 1.4.2, headless Chrome for Testing 156.0.8078.4. The [artwork probe](share-validation.probe.ts) now checks only shared generated images; its scratch directory must be under this checkout's `.evidence/`. Current root, input and results validation uses [scripts/validate-cutover.ts](../scripts/validate-cutover.ts). The older gameplay captures below record release 1 history.

Repeat after `bun install --frozen-lockfile` and `bun run build`: create a scratch directory with its own `package.json`, install `playwright-core` there, set `SCRATCH` to its absolute path, and run `bun docs/share-validation.probe.ts`. Set `CHROME` to a Chrome for Testing executable when the installed Chrome channel cannot enable debugging. The factory's installed Chrome refused its first debugging launch; Chrome for Testing succeeded with an explicit scratch profile. `--artwork-only` repeats image decoding and visual inspection. Screenshots and `measurements.json` go to `SCRATCH/share-evidence`, never to tracked artwork files. As Playwright bypasses interception for URLs ending `/favicon.ico`, the decode probe uses `/favicon.ico?decode=1`, which reaches the same Hono route. Unit, Vite and container checks fetch the unadorned path.

| Check | 390 x 844 portrait | 844 x 390 landscape |
| --- | --- | --- |
| First entry, automated name + team | 271 ms | 278 ms |
| Return entry | 108 ms | 93 ms |
| Canvas touch steering distance | 101 logical units | 145 logical units |
| HUD 750 ms long-press | No selected text or menu | No selected text or menu |
| Result scroll | Content fits, no overflow | 226 px scrolled of 449 px range |
| `/board` and `/board/` touch scroll | 209 px | 275–277 px |

Both orientations retain text selection/editing in the name field, compute `overscroll-behavior: none` on html/body, suppress HUD selection, and compute `touch-action: manipulation` on entry/upgrade buttons. Two rapid entry taps leave viewport scale at 1 and start one run. Canvas retains `touch-action: none`. Upgrade choices open and accept a touch choice; the dialog computes vertical overflow `auto`, selection `none`, and overscroll `none`. Swiping results never changes the run token; a stationary overlay tap then starts exactly one new run. HUD swipes do not scroll the page. Both board routes retain ordinary vertical scrolling and `user-select: auto`, with page overscroll disabled. Offline entry and steering work in both orientations. No uncaught page errors occurred. This verifies Chrome emulation, not WebKit's context menu: `-webkit-touch-callout: none` and the name input's `default` exception are checked in the source declaration because Chrome does not implement that property. No physical-device evidence is required by the owner ruling.

Chrome decoded SVG, ICO, touch PNG and preview PNG with natural dimensions 180 x 180, 32 x 32, 180 x 180 and 1200 x 630 respectively. Visual inspection confirmed the rounded robot, side blocks and mint core remain readable at 16/32 px; the opaque preview shows coral/gold beetles, shots, trail, grid and vignette with crop margins. Gameplay's request trace contains no preview request; all generated browser JavaScript was also inspected for rasterizer/share-asset imports and contains none. No renderer or frame-loop changes were made.

Validation completed:

- `bun run check`: strict TypeScript and 237 tests pass (86,801 assertions), including binary image structure, repeated bytes, origin precedence/validation/escaping, all HTML entry routes, and Vite with no dist. The Vite tests own their API and frontend loopback listeners, force an occupied frontend port to verify Vite's actual resolved port, and check the explicit public-origin override. Children exit and handles/watchers close before scratch cleanup on Windows.
- `bun run build`: succeeds. The built shared page stylesheet is 36 bytes and the rasterizer remains server-only.
- `docker build -t bug-swarm-share-ae799aa6 .`: succeeds with Linux native resvg installation. An isolated `docker run --rm --network none --tmpfs /scratch`, scratch `HOME`/`DATA_DIR`, and a mounted probe captured the actual startup handler without opening a listener. It returned 200 and the exact MIME types for all four image routes (593/1,478/32,043/296,234 bytes), validated PNG signatures, and confirmed substituted metadata at `/`, `/index.html`, `/board` and `/board/`.

External Discord, X and LinkedIn preview services were not contacted. Their initial-HTML tags and absolute PNG URLs are covered locally; their own caching and presentation remain external behavior. `PUBLIC_ORIGIN` configuration and image caching are documented in [architecture.md](../architecture.md). The [resvg-js documentation](https://github.com/thx/resvg-js) describes its Bun support and server rasterization; this dependency removes the need for a browser or a handwritten SVG renderer on the server.
