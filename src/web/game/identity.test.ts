import { expect, test } from "bun:test";
import { IDENTITY_KEY, loadIdentity, storeIdentity, type Storage } from "./identity";
test("validated browser identity persists; corrupt, blocked, or old invalid names require entry", () => {
  const saved = new Map<string, string>();
  const storage: Storage = { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => { saved.set(key, value); } };
  expect(loadIdentity(storage)).toBeNull();
  const identity = { playerId: crypto.randomUUID(), name: "Robot" };
  storeIdentity(storage, identity); expect(loadIdentity(storage)).toEqual(identity);
  for (const team of [null, "invalid", {}, 3]) {
    saved.set(IDENTITY_KEY, JSON.stringify({ ...identity, team }));
    expect(loadIdentity(storage)).toEqual(identity);
  }
  storeIdentity(storage, { ...identity, team: "spaces" });
  expect(loadIdentity(storage)).toEqual({ ...identity, team: "spaces" });
  for (const value of ["{", "null",
    ...["5h1t", "nigga", "f u c k", "fuuuck", "cole medin", "M0D3R470R"].map(name => JSON.stringify({ ...identity, name })),
    JSON.stringify({ ...identity, playerId: "invalid" })]) {
    saved.set(IDENTITY_KEY, value); expect(loadIdentity(storage)).toBeNull();
  }
  for (const name of ["Scunthorpe", "Hancock", "Annalise", "Jason", "therapist"]) {
    storeIdentity(storage, { ...identity, name });
    expect(loadIdentity(storage)).toEqual({ ...identity, name });
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
