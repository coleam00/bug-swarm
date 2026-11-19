export const UPGRADE_IDS = ["review-laser", "test-shield", "refactor-bomb", "ci-drone"] as const;
export type UpgradeId = typeof UPGRADE_IDS[number];
export const [REVIEW_LASER, TEST_SHIELD, REFACTOR_BOMB, CI_DRONE] = UPGRADE_IDS;
export const CHOICE_INTERVAL = 20;
// Pick counts remain independent of spent combat resources.
export function shieldCapacity(picks: number): number { return Math.min(picks, 4); }
export function bombRecharge(picks: number): number { return picks > 0 ? 15 + 15 / picks : Infinity; }
export interface AcquiredUpgrade { readonly id: UpgradeId; readonly count: number }
export const UPGRADE_NAMES: Record<UpgradeId, string> = {
  [REVIEW_LASER]: "Review laser", [TEST_SHIELD]: "Test shield",
  [REFACTOR_BOMB]: "Refactor bomb", [CI_DRONE]: "CI drone",
};
export function nextPickDescription(id: UpgradeId, count: number): string {
  switch (id) {
    case REVIEW_LASER: return `Shots hit up to ${count + 2} bugs`;
    case TEST_SHIELD: return `Refill to block ${shieldCapacity(count + 1)} ${count ? "hits" : "hit"}${count >= 3 ? " (maximum capacity)" : ""}`;
    case REFACTOR_BOMB: return `Clear bugs automatically; ${Number(bombRecharge(count + 1).toFixed(1))}s recharge`;
    case CI_DRONE: return count === 1 ? "Add a second firing drone" : `Add firing drone ${count + 1}`;
  }
}
