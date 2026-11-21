import { expect, test } from "bun:test";
import { botName, parseBotArgs } from "./bots";
import { validateName } from "../src/server/rules";
test("bots CLI defaults, optional separator, origin and bounded positive argument validation", () => {
  expect(parseBotArgs([])).toEqual({ url: "http://127.0.0.1:3000", count: 18, seconds: 60 });
  expect(parseBotArgs(["--", "--url", "https://swarm.test/", "--count", "20", "--seconds", "1"])).toEqual({ url: "https://swarm.test", count: 20, seconds: 1 });
  for (const args of [["--count", "0"], ["--seconds", "1.5"], ["--seconds", "2147484"], ["--count", "2", "--count", "3"], ["--url", "ws://swarm.test"], ["--url", "https://swarm.test/path"], ["--unknown", "1"], ["--count"]]) expect(() => parseBotArgs(args)).toThrow();
});
test("all supported bot identities pass the live name rules", () => {
  for (let i = 0; i < 10000; i++) expect(validateName(botName(i)).error).toBeUndefined();
});
