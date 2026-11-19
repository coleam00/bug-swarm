import { expect, test } from "bun:test";
import { readConfig } from "./config";

test("load limit defaults to 30 and accepts only positive safe integers", () => {
  expect(readConfig({}).startLimit).toBe(30);
  expect(readConfig({ LOAD_TEST_START_LIMIT: "10000" }).startLimit).toBe(10000);
  for (const value of ["", "0", "-1", "1.5", "NaN", "Infinity", "1e3", " 31", "31 ", "9007199254740992"]) {
    expect(() => readConfig({ LOAD_TEST_START_LIMIT: value })).toThrow("positive safe integer");
  }
});
