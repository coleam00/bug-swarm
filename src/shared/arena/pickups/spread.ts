import { SPREAD_MS, SPREAD_FAN_DEGREES } from "../constants";
import type { PickupDefinition } from "./definition";
const halfFan = SPREAD_FAN_DEGREES * Math.PI / 360;
export const spread: PickupDefinition = { duration: SPREAD_MS, angles: [-halfFan, 0, halfFan] };
