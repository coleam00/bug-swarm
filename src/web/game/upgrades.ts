import { CHOICE_INTERVAL, UPGRADE_IDS, type AcquiredUpgrade, type UpgradeId } from "../../shared/upgrades";

export interface UpgradeState {
  counts: Record<UpgradeId, number>;
  nextChoiceAt: number;
  offer: readonly UpgradeId[] | null;
  choiceNumber: number;
  choiceSeed: number;
}
export function createUpgrades(seed: number): UpgradeState {
  return { counts: Object.fromEntries(UPGRADE_IDS.map(id => [id, 0])) as Record<UpgradeId, number>,
    nextChoiceAt: CHOICE_INTERVAL, offer: null, choiceNumber: 0, choiceSeed: (seed ^ 0x9e3779b9) >>> 0 };
}
export function openChoice(state: UpgradeState): void {
  if (state.offer) return;
  const ids = [...UPGRADE_IDS];
  for (let i = ids.length - 1; i > 0; i--) {
    state.choiceSeed = (Math.imul(state.choiceSeed, 1664525) + 1013904223) >>> 0;
    const j = Math.floor(state.choiceSeed / 4294967296 * (i + 1));
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  }
  state.offer = Object.freeze(ids.slice(0, 3)); state.choiceNumber++;
}
export function selectUpgrade(state: UpgradeState, choiceNumber: number, id: UpgradeId): boolean {
  if (choiceNumber !== state.choiceNumber || !state.offer?.includes(id)) return false;
  state.counts[id]++; state.offer = null; state.nextChoiceAt += CHOICE_INTERVAL;
  return true;
}
export function acquiredUpgrades(state: UpgradeState): readonly AcquiredUpgrade[] {
  return Object.freeze(UPGRADE_IDS.filter(id => state.counts[id] > 0)
    .map(id => Object.freeze({ id, count: state.counts[id] })));
}
