import { expect, test } from "bun:test";
import { IDENTITY_KEY, loadIdentity, storeIdentity, type Storage } from "./identity";
test("validated browser identity persists; corrupt, blocked, or old invalid names require entry", () => {
  let saved: string | null = null;
  const storage: Storage = { getItem: () => saved, setItem: (key, value) => { expect(key).toBe(IDENTITY_KEY); saved = value; } };
  expect(loadIdentity(storage)).toBeNull();
  const identity = { playerId: crypto.randomUUID(), name: "Robot" };
  storeIdentity(storage, identity); expect(loadIdentity(storage)).toEqual(identity);
  for (const value of ["{", "null", JSON.stringify({ ...identity, name: "5h1t" }), JSON.stringify({ ...identity, playerId: "invalid" })]) {
    saved = value; expect(loadIdentity(storage)).toBeNull();
  }
});
test("storage read/write failure does not prevent in-memory play", () => {
  const storage: Storage = { getItem: () => { throw new Error("disabled"); }, setItem: () => { throw new Error("disabled"); } };
  expect(loadIdentity(storage)).toBeNull();
  const original = console.error; const messages: string[] = [];
  console.error = (message) => { messages.push(message); };
  try { expect(() => storeIdentity(storage, { playerId: crypto.randomUUID(), name: "Robot" })).not.toThrow(); }
  finally { console.error = original; }
  expect(messages).toHaveLength(1);
});
