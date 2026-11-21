// Records observable paint operations for renderer and lifecycle tests, without a native canvas.
export interface Gradient {
  circles: [number, number, number, number, number, number];
  transform: number[];
  stops: { offset: number; colour: string }[];
  addColorStop(offset: number, colour: string): void;
}
export interface PathCommand { op: string; args: number[] }
interface PaintState {
  fillStyle: string | Gradient; strokeStyle: string | Gradient; lineWidth: number; shadowBlur: number;
  globalAlpha: number; globalCompositeOperation: string; font: string;
  textAlign: string; textBaseline: string; transform: number[];
}
export interface Paint extends PaintState { op: string; args: unknown[]; path: PathCommand[] }
export class RecordingContext {
  fillStyle: string | Gradient = "#000";
  strokeStyle: string | Gradient = "#000";
  lineWidth = 1;
  shadowBlur = 0;
  globalAlpha = 1;
  globalCompositeOperation = "source-over";
  font = "10px sans-serif";
  textAlign = "start";
  textBaseline = "alphabetic";
  readonly paints: Paint[] = [];
  private transform = [1, 0, 0, 1, 0, 0];
  private path: PathCommand[] = [];
  private readonly stack: PaintState[] = [];
  get depth(): number { return this.stack.length; }
  private state(): PaintState {
    return { fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, shadowBlur: this.shadowBlur,
      globalAlpha: this.globalAlpha, globalCompositeOperation: this.globalCompositeOperation,
      font: this.font, textAlign: this.textAlign, textBaseline: this.textBaseline, transform: [...this.transform] };
  }
  private paint(op: string, ...args: unknown[]): void { this.paints.push({ op, args, path: [...this.path], ...this.state() }); }
  save(): void { this.stack.push(this.state()); }
  restore(): void {
    const state = this.stack.pop();
    if (!state) throw new Error("Unbalanced canvas restore");
    Object.assign(this, state);
  }
  setTransform(...values: number[]): void { this.transform = values; }
  translate(x: number, y: number): void {
    const [a, b, c, d, e, f] = this.transform as [number, number, number, number, number, number];
    this.transform = [a, b, c, d, e + a * x + c * y, f + b * x + d * y];
  }
  scale(x: number, y: number): void {
    const [a, b, c, d, e, f] = this.transform as [number, number, number, number, number, number];
    this.transform = [a * x, b * x, c * y, d * y, e, f];
  }
  rotate(angle: number): void {
    const [a, b, c, d, e, f] = this.transform as [number, number, number, number, number, number];
    const cos = Math.cos(angle), sin = Math.sin(angle);
    this.transform = [a * cos + c * sin, b * cos + d * sin, c * cos - a * sin, d * cos - b * sin, e, f];
  }
  beginPath(): void { this.path = []; }
  moveTo(...args: number[]): void { this.path.push({ op: "moveTo", args }); }
  lineTo(...args: number[]): void { this.path.push({ op: "lineTo", args }); }
  arc(...args: number[]): void { this.path.push({ op: "arc", args }); }
  ellipse(...args: number[]): void { this.path.push({ op: "ellipse", args }); }
  roundRect(...args: number[]): void { this.path.push({ op: "roundRect", args }); }
  rect(...args: number[]): void { this.path.push({ op: "rect", args }); }
  clip(): void { this.paint("clip"); }
  fill(): void { this.paint("fill"); }
  stroke(): void { this.paint("stroke"); }
  fillRect(...args: number[]): void { this.paint("fillRect", ...args); }
  strokeRect(...args: number[]): void { this.paint("strokeRect", ...args); }
  createPattern(): CanvasPattern { return {} as CanvasPattern; }
  measureText(text: string): TextMetrics {
    const width = text.length * 13;
    return { width, actualBoundingBoxLeft: this.textAlign === "center" ? width / 2 : 0,
      actualBoundingBoxRight: this.textAlign === "center" ? width / 2 : width } as TextMetrics;
  }
  drawImage(...args: unknown[]): void { this.paint("drawImage", ...args); }
  fillText(...args: unknown[]): void { this.paint("fillText", ...args); }
  strokeText(...args: unknown[]): void { this.paint("strokeText", ...args); }
  createRadialGradient(...circles: Gradient["circles"]): Gradient {
    return { circles, transform: [...this.transform], stops: [],
      addColorStop(offset, colour) { this.stops.push({ offset, colour }); } };
  }
}
export function canvasFixture() {
  const context = new RecordingContext();
  const surfaces: { canvas: HTMLCanvasElement; context: RecordingContext }[] = [];
  const factory = () => {
    const offscreen = new RecordingContext();
    const canvas = { width: 0, height: 0, getContext: () => offscreen } as unknown as HTMLCanvasElement;
    surfaces.push({ canvas, context: offscreen }); return canvas;
  };
  return { context, surfaces, factory, get created() { return surfaces.length; }, get depth() { return context.depth; },
    source(paint: Paint): RecordingContext { return surfaces.find((surface) => surface.canvas === paint.args[0])!.context; },
  };
}
