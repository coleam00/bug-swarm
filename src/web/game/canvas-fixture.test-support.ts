// Canvas command stub for lifecycle/cache tests; no native canvas required.
export function canvasFixture() {
  let created = 0, depth = 0, draws = 0;
  const context = {
    fillStyle: "", strokeStyle: "", lineWidth: 1, globalAlpha: 1, globalCompositeOperation: "source-over",
    font: "", textAlign: "", textBaseline: "",
    fillRect() {}, translate() {}, scale() {}, rotate() {}, beginPath() {}, arc() {}, ellipse() {},
    roundRect() {}, rect() {}, clip() {}, moveTo() {}, lineTo() {}, stroke() {}, fill() {}, setTransform() {},
    save() { depth++; }, restore() { depth--; }, drawImage() { draws++; },
    strokeText() {}, fillText() {}, createRadialGradient() { return { addColorStop() {} }; },
  };
  const factory = () => { created++; return { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement; };
  return { context, factory, get created() { return created; }, get depth() { return depth; }, get draws() { return draws; } };
}
