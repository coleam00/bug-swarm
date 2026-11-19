import type { Arena } from "./arena";

export type CanvasFactory = () => HTMLCanvasElement;
const makeCanvas: CanvasFactory = () => document.createElement("canvas");

/** Procedural art built on resize, never during steady-state drawing. */
export class Assets {
  readonly floor: HTMLCanvasElement;
  readonly vignette: HTMLCanvasElement;
  readonly core: HTMLCanvasElement;
  readonly shot: HTMLCanvasElement;
  readonly spark: HTMLCanvasElement;
  readonly label: HTMLCanvasElement;
  readonly labelWidth: number;
  readonly labelHeight: number;

  constructor(density: number, scale: number, arena: Arena, factory: CanvasFactory = makeCanvas) {
    const { width, height } = arena;
    const surface = (width: number, height: number): HTMLCanvasElement => {
      const canvas = factory();
      canvas.width = Math.ceil(width * density); canvas.height = Math.ceil(height * density);
      canvas.getContext("2d")!.scale(density, density);
      return canvas;
    };
    this.floor = surface(width, height);
    const floor = this.floor.getContext("2d")!;
    floor.fillStyle = "#101d2a"; floor.fillRect(0, 0, width, height);
    floor.beginPath();
    for (let x = 0; x <= width; x += 40) { floor.moveTo(x, 0); floor.lineTo(x, height); }
    for (let y = 0; y <= height; y += 40) { floor.moveTo(0, y); floor.lineTo(width, y); }
    floor.lineWidth = 4; floor.strokeStyle = "#173542"; floor.stroke();
    floor.lineWidth = 0.8; floor.strokeStyle = "#26515c"; floor.stroke();
    this.vignette = surface(width, height);
    const edge = this.vignette.getContext("2d")!;
    // Normalize the radial mask so its falloff follows every world aspect ratio.
    edge.scale(width / 600, height / 600);
    const gradient = edge.createRadialGradient(300, 300, 130, 300, 300, 415);
    gradient.addColorStop(0, "#030a1200"); gradient.addColorStop(0.7, "#030a1230"); gradient.addColorStop(1, "#030a12df");
    edge.fillStyle = gradient; edge.fillRect(0, 0, 600, 600);
    const glow = (colour: string): HTMLCanvasElement => {
      const canvas = surface(64, 64), ctx = canvas.getContext("2d")!;
      const light = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      light.addColorStop(0, colour + "cc"); light.addColorStop(0.25, colour + "70"); light.addColorStop(1, colour + "00");
      ctx.fillStyle = light; ctx.fillRect(0, 0, 64, 64); return canvas;
    };
    this.core = glow("#5bffe0"); this.shot = glow("#ffd36c"); this.spark = glow("#ff9a70");
    const fontSize = Math.max(22, 18 / scale);
    this.labelWidth = fontSize * 2.5; this.labelHeight = fontSize * 1.5;
    this.label = surface(this.labelWidth, this.labelHeight);
    const text = this.label.getContext("2d")!;
    text.font = `900 ${fontSize}px system-ui, sans-serif`; text.textAlign = "center"; text.textBaseline = "middle";
    text.lineWidth = 4; text.strokeStyle = "#102131";
    text.strokeText("+10", this.labelWidth / 2, this.labelHeight / 2);
    text.fillStyle = "#fff1b9"; text.fillText("+10", this.labelWidth / 2, this.labelHeight / 2);
  }
  dispose(): void {
    // Release the browser backing stores on replacement/unmount.
    this.floor.width = this.vignette.width = this.core.width = this.shot.width = this.spark.width = this.label.width = 0;
  }
}
