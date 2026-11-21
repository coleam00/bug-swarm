import { expect, test } from "bun:test";
import { canvasFixture, RecordingContext } from "./canvas-fixture.test-support";

test.each(["width", "height"] as const)("assigning canvas %s clears retained artwork and resets drawing state, including same-size and zero assignments", dimension => {
  const fixture = canvasFixture(), canvas = fixture.factory(), context = fixture.surfaces[0]!.context;
  const other = dimension === "width" ? "height" : "width";
  canvas[other] = 123;
  const retained = context.paints;
  for (const size of [64, 64, 0]) {
    Object.assign(context, { fillStyle: "#123456", strokeStyle: "#abcdef", lineWidth: 7, lineCap: "round",
      shadowBlur: 12, globalAlpha: 0.25, globalCompositeOperation: "lighter", font: "bold 24px serif", textAlign: "center", textBaseline: "top" });
    context.translate(20, 30); context.scale(2, 3); context.rotate(0.7); context.save();
    context.beginPath(); context.rect(0, 0, 50, 50); context.clip(); context.fill();
    expect(retained.length).toBeGreaterThan(0);

    canvas[dimension] = size;
    expect(canvas[dimension]).toBe(size); expect(canvas[other]).toBe(123);
    expect(canvas.getContext("2d") as unknown).toBe(context);
    expect(retained).toHaveLength(0); expect(context.depth).toBe(0);

    // Compare observable paint against a fresh context: empty path, identity transform and all defaults.
    const fresh = new RecordingContext();
    context.stroke(); fresh.stroke();
    expect(context.paints).toEqual(fresh.paints);
    context.save(); context.translate(1, 2); context.fillStyle = "#fedcba"; context.restore();
    context.fillRect(0, 0, 1, 1); fresh.fillRect(0, 0, 1, 1);
    expect(context.paints).toEqual(fresh.paints);
  }
});
