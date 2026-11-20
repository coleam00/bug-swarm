import { expect, test } from "bun:test";
import { FloatingText } from "./floating-text";

test.each([249, 250, 251])("grouping window is measured from first emission (%i ms)", ms => {
  const labels = new FloatingText(); labels.pop(100, 200); labels.update(ms / 1000); labels.pop(100, 200);
  expect(labels.count).toBe(ms <= 250 ? 1 : 2);
  expect(labels.total[0]).toBe(ms <= 250 ? 20 : 10);
  expect(labels.life[0]).toBeCloseTo(0.65 - ms / 1000);
});

test.each([39.99, 40, 40.01])("grouping uses inclusive Euclidean world distance (%i)", distance => {
  const labels = new FloatingText(); labels.pop(100, 200);
  labels.pop(100 + distance * 0.6, 200 + distance * 0.8);
  expect(labels.count).toBe(distance <= 40 ? 1 : 2);
});

test("nearest group wins, ties use slot order, anchors and the original window never move", () => {
  const labels = new FloatingText(); labels.pop(100, 200); labels.pop(160, 200);
  labels.pop(135, 200); expect(labels.total[1]).toBe(20);
  labels.pop(130, 200); expect(labels.total[0]).toBe(20);
  labels.update(0.2); labels.pop(100, 240); // 40 from anchor, 46 from rising text
  expect(labels.total[0]).toBe(30); expect(labels.y[0]).toBeCloseTo(194);
  expect(labels.anchorX[0]).toBe(100); expect(labels.anchorY[0]).toBe(200);
  labels.update(0.051); labels.pop(100, 200);
  expect(labels.count).toBe(3); expect(labels.total[2]).toBe(10);
});

test("capacity is twelve: merge when full, drop unmatched cosmetics, reuse expired slots and reset metadata", () => {
  const labels = new FloatingText(); expect(labels.capacity).toBe(12);
  const storage = [labels.x, labels.y, labels.life, labels.total, labels.anchorX, labels.anchorY];
  for (let round = 0; round < 100; round++) {
    for (let i = 0; i < 12; i++) labels.pop(i * 100, 100);
    labels.pop(5000, 100); expect(labels.count).toBe(12);
    for (let i = 0; i < 149; i++) labels.pop(0, 100);
    expect(labels.total[0]).toBe(1500);
    expect([...labels.total].reduce((a, b) => a + b, 0)).toBe(1610);
    labels.update(0.65); expect(labels.count).toBe(0);
    labels.pop(7000, 300); expect(labels.count).toBe(1);
    const slot = labels.life.findIndex(life => life > 0);
    expect(labels.total[slot]).toBe(10); expect(labels.anchorX[slot]).toBe(7000); expect(labels.anchorY[slot]).toBe(300);
    labels.reset(); expect(labels.count).toBe(0); expect(labels.total.every(value => value === 0)).toBe(true);
  }
  [labels.x, labels.y, labels.life, labels.total, labels.anchorX, labels.anchorY].forEach((value, i) => expect(value).toBe(storage[i]!));
  labels.pop(0, 100); expect(labels.total[0]).toBe(10);
});
