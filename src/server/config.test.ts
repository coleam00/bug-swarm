import { expect, test } from "bun:test";
import { readConfig } from "./config";

test("load limit defaults to 300 and accepts only positive safe integers", () => {
  expect(readConfig({}).startLimit).toBe(300);
  expect(readConfig({ LOAD_TEST_START_LIMIT: "10000" }).startLimit).toBe(10000);
  for (const value of ["", "0", "-1", "1.5", "NaN", "Infinity", "1e3", " 31", "31 ", "9007199254740992"]) {
    expect(() => readConfig({ LOAD_TEST_START_LIMIT: value })).toThrow("positive safe integer");
  }
});

test("proxy hops default to zero and accept only canonical nonnegative safe integers", () => {
  expect(readConfig({}).trustProxyHops).toBe(0);
  for (const value of ["0", "1", "2", "9007199254740991"]) {
    expect(readConfig({ TRUST_PROXY_HOPS: value }).trustProxyHops).toBe(Number(value));
  }
  for (const value of ["", " ", "01", "00", "+1", "-1", "1.5", "NaN", "Infinity", "1e3", " 1", "1 ", "1\n", "0\r\n", "\t2", "9007199254740992"]) {
    expect(() => readConfig({ TRUST_PROXY_HOPS: value })).toThrow("nonnegative safe integer");
  }
});
