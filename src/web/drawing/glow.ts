export type CanvasFactory = () => HTMLCanvasElement;
const makeCanvas: CanvasFactory = () => document.createElement("canvas");
/** A single cached glow, also used by the entry scene. Caller releases its backing store. */
export function createGlow(colour: string, density = 1, factory: CanvasFactory = makeCanvas): HTMLCanvasElement {
  const canvas = factory();
  canvas.width = canvas.height = Math.ceil(64 * density);
  const ctx = canvas.getContext("2d")!; ctx.scale(density, density);
  const light = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  light.addColorStop(0, colour + "cc"); light.addColorStop(0.25, colour + "70"); light.addColorStop(1, colour + "00");
  ctx.fillStyle = light; ctx.fillRect(0, 0, 64, 64); return canvas;
}
