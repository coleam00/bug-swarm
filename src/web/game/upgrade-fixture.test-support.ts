import type { UpgradeId } from "../../shared/upgrades";
import { openChoice } from "./upgrades";
import { chooseUpgrade, type Simulation } from "./simulation";

// Explicit offers isolate combat tests from the scheduler. Acquisition still
// passes through the production offer validation and selection behavior.
export function pick(state: Simulation, id: UpgradeId): void {
  do { state.upgrades.offer = null; openChoice(state.upgrades); } while (!state.upgrades.offer!.includes(id));
  state.upgrades.nextChoiceAt = Infinity;
  if (!chooseUpgrade(state, state.upgrades.choiceNumber, id)) throw new Error("Fixture selection failed");
}
