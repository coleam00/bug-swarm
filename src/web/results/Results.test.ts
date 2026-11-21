import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PersonalStanding, TeamRace } from "./Results";

test("shared standings preserve release 1 acknowledgement and arena targets at every rank", () => {
  const render = (rank: number | null, showNextInTopTen = false) => renderToStaticMarkup(createElement(PersonalStanding, {
    status: "ready", standing: { rank, total: 20, next: rank && rank > 1 ? { rank: rank - 1, pointsToBeat: 1 } : null }, showNextInTopTen,
  }));
  expect(render(null)).toContain("Not ranked");
  expect(render(1, true)).toContain("You&#x27;re in the top 10!"); expect(render(1, true)).not.toContain("to beat");
  expect(render(2)).not.toContain("to beat");
  expect(render(2, true)).toContain("1 point to beat #1"); expect(render(2, true)).toContain("Your best is #2 of 20");
  expect(render(11)).toContain("1 point to beat #10");
  expect(renderToStaticMarkup(createElement(PersonalStanding, { status: "loading", standing: null }))).toContain("Loading ranking");
  expect(renderToStaticMarkup(createElement(PersonalStanding, { status: "failed", standing: null }))).toContain("Ranking unavailable");
});
test("shared team race handles zero totals, loading and independent failure", () => {
  expect(renderToStaticMarkup(createElement(TeamRace, { status: "loading", totals: null }))).toContain("Loading team totals");
  expect(renderToStaticMarkup(createElement(TeamRace, { status: "failed", totals: { tabs: 9, spaces: 0 } }))).toContain("Couldn&#x27;t load team totals");
  const empty = renderToStaticMarkup(createElement(TeamRace, { status: "ready", totals: { tabs: 0, spaces: 0 } }));
  expect(empty).toContain("No team scores yet"); expect(empty).toContain("width:50%");
  const race = renderToStaticMarkup(createElement(TeamRace, { status: "ready", totals: { tabs: 30, spaces: 10 } }));
  expect(race).toContain("Tabs <strong>30</strong>"); expect(race).toContain("width:75%");
});
