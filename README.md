# horizon

A restrained, full-bleed wave-field visualization. Strands of vertical strokes
arc across the field; quiet kiosk events surface as labeled pills with leader
lines. Designed to be alive, not loud — for a 4K show server.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build
npm run preview
```

## Tuners

Press `` ` `` (or `~`) to toggle the right-edge operator panel. Groups:

- **Waves** — count, amplitude, spacing, phase speed, secondary wave scale and density
- **Strands** — per-wave density, stroke width, endpoint radius, length, length jitter
- **Color** — top / mid / bottom stops, background, vignette, pulse band Y/height
- **Motion** — speed and alpha multipliers
- **Telemetry** — FPS, active strand count, renderer name, backing-buffer size at current DPR

Color and vignette changes invalidate the cached static layer; everything else
is per-frame.

## Architecture

- [src/loop.ts](src/loop.ts) — fixed-dt rAF accumulator, `STEP=1/60`, `MAX_DT=0.05`
- [src/state.ts](src/state.ts) — tunable parameter store with key-set change notifications
- [src/config.ts](src/config.ts) — quiet defaults; entity caps (`STRAND_CAP=600`, `HIGHLIGHT_CAP=6`)
- [src/entities/pool.ts](src/entities/pool.ts) — generic capped object pool
- [src/entities/Strand.ts](src/entities/Strand.ts), [src/entities/Highlight.ts](src/entities/Highlight.ts) — pooled entities
- [src/waves/WaveField.ts](src/waves/WaveField.ts) — distributes pooled strands across primary + secondary wave layers
- [src/waves/curves.ts](src/waves/curves.ts) — bell-curve arc sampler
- [src/render/Renderer.ts](src/render/Renderer.ts) — renderer interface; same surface a future WebGL impl will satisfy
- [src/render/Canvas2DRenderer.ts](src/render/Canvas2DRenderer.ts) — strands bucketed by `lineWidth`; gradient cache + offscreen static layer
- [src/render/staticLayer.ts](src/render/staticLayer.ts) — vignette, field wash, pulse-band band; redrawn only on resize or color change
- [src/render/gradients.ts](src/render/gradients.ts) — keyed gradient cache; per-frame gradients only when their parameters change
- [src/events/EventBus.ts](src/events/EventBus.ts), [src/events/kioskMock.ts](src/events/kioskMock.ts), [src/events/kioskSocket.ts](src/events/kioskSocket.ts) — pub/sub + slow synthetic mock + production WS bridge (same payload shape)
- [src/ui/Overlay.ts](src/ui/Overlay.ts), [src/ui/controls.ts](src/ui/controls.ts) — vanilla DOM operator overlay
- [src/util/dpr.ts](src/util/dpr.ts) — DPR clamp at 2

## Performance contract

- Single 4K output, 60fps sustained, ≤600 active strands enforced by the pool.
- DPR clamped to `min(devicePixelRatio, 2)`; the overlay shows the effective backing-buffer size so an operator can verify they aren't paying 7680x4320 by accident on a high-density display.
- Gradients are cached by signature; static background layers are painted once per resize/color change and `drawImage`d each frame.
- After a tab blur, the loop's `MAX_DT=0.05` clamp prevents catch-up jumps.

## Connecting a real kiosk feed

```ts
import { connectKioskSocket } from "./events/kioskSocket.js";
connectKioskSocket(app.bus, "wss://your.show.server/kiosk");
```

The mock and the socket emit identical `kiosk:event` payloads
(`{ id, label, ttlMs }`), so swapping is a one-line change.

## Future: WebGL renderer

`Renderer` is the only contract the rest of the system depends on. To scale
beyond ~2k strands or stack additive passes, add a `WebGLRenderer` that
implements the same interface and inject it in [src/app.ts](src/app.ts). No
other module should need to change.

## Tone

The defaults err on the quiet side: `phaseSpeed: 0.05`, `alphaMultiplier: 0.45`,
1px strokes, 1.5px endpoints, 0.55 secondary scale. When in doubt, halve the
opacity, halve the speed, and make the moment quieter than feels natural.
