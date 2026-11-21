import { shield } from "./shield";
import { spread } from "./spread";
import { rapid } from "./rapid";
import type { PickupDefinition } from "./definition";
import type { PickupKind } from "../types";
export const PICKUPS = { shield, spread, rapid } satisfies Record<string, PickupDefinition>;
export const PICKUP_KINDS = Object.keys(PICKUPS) as PickupKind[];
export function isPickupKind(value: unknown): value is PickupKind {
  return typeof value === "string" && Object.hasOwn(PICKUPS, value);
}
