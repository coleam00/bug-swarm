import { MAX_PENDING, PLAYER_RADIUS, STEP_MS, WORLD_HEIGHT, WORLD_WIDTH } from "../../shared/arena/constants";
import { movePlayer } from "../../shared/arena/movement";
import type { InputMessage } from "../../shared/arena/protocol";
import type { Input, CombatPlayer } from "../../shared/arena/types";
export class Prediction {
  player: CombatPlayer | null = null;
  pending: InputMessage[] = [];
  private correction = { x: 0, y: 0 };
  reset() { this.player = null; this.pending = []; this.correction = { x: 0, y: 0 }; }
  advance(input: InputMessage): boolean {
    if (!this.player || this.player.status !== "active") return true;
    if (this.pending.length >= MAX_PENDING) return false;
    this.pending.push(input); movePlayer(this.player, input); return true;
  }
  reconcile(authoritative: CombatPlayer & { ackSeq: number }) {
    const previous = this.player;
    if (previous && (previous.life !== authoritative.life || previous.status !== authoritative.status)) this.reset();
    this.player = { ...authoritative };
    this.pending = this.pending.filter(input => input.seq > authoritative.ackSeq);
    for (const input of this.pending) if (this.player.status === "active" && input.life === this.player.life) movePlayer(this.player, input);
    if (previous && previous.life === authoritative.life && previous.status === "active" && authoritative.status === "active") {
      const x = previous.x - this.player.x, y = previous.y - this.player.y;
      this.correction = Math.hypot(x, y) < 80 ? { x, y } : { x: 0, y: 0 };
    }
  }
  visual(input: Input, fraction: number, elapsed: number): CombatPlayer | null {
    if (!this.player) return null;
    const player = { ...this.player };
    if (player.status === "active") movePlayer(player, input, Math.max(0, Math.min(1, fraction)) * STEP_MS);
    const decay = Math.exp(-elapsed / 40); this.correction.x *= decay; this.correction.y *= decay;
    player.x = Math.max(PLAYER_RADIUS, Math.min(WORLD_WIDTH - PLAYER_RADIUS, player.x + this.correction.x));
    player.y = Math.max(PLAYER_RADIUS, Math.min(WORLD_HEIGHT - PLAYER_RADIUS, player.y + this.correction.y));
    return player;
  }
}
