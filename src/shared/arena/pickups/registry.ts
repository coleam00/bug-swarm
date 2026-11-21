import { shield } from "./shield";
import type { PickupDefinition } from "./definition";
import type { PickupKind } from "../types";
export const PICKUPS = { shield } satisfies Record<string, PickupDefinition>;
export const PICKUP_KINDS = Object.keys(PICKUPS) as PickupKind[];
export function isPickupKind(value: unknown): value is PickupKind {
  return typeof value === "string" && Object.hasOwn(PICKUPS, value);
}
