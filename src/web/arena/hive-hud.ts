import type { Bug, CombatEvent } from "../../shared/arena/types";
import { helpArrow } from "./help-arrow";
import { MAX_PLAYERS } from "../../shared/arena/constants";

export class HiveHud {
  private bannerAt = -Infinity;
  private awards = Array.from({ length: MAX_PLAYERS }, () => ({ x: 0, y: 0, amount: 0, at: -Infinity }));
  reset() { this.bannerAt = -Infinity; for (const a of this.awards) a.at = -Infinity; }
  event(event: CombatEvent, now: number) {
    if (event.type !== "kill" || event.kind !== "hive") return;
    this.bannerAt = now;
    event.rewards?.forEach((r, i) => Object.assign(this.awards[i]!, r, { at: now }));
  }
  world(c: CanvasRenderingContext2D, now: number) {
    for (const r of this.awards) {
      const age = now - r.at; if (age < 0 || age > 1600) continue;
      c.save(); c.globalAlpha = Math.min(1, (1600 - age) / 400); c.font = "bold 32px system-ui"; c.textAlign = "center";
      c.strokeStyle = "#060b12"; c.lineWidth = 5; c.strokeText(`+${r.amount}`, r.x, r.y - 65 - age / 35);
      c.fillStyle = "#edff9c"; c.fillText(`+${r.amount}`, r.x, r.y - 65 - age / 35); c.restore();
    }
  }
  private bannerPosition(width: number, height: number, camera: { x: number; y: number }, scale: number, now: number, panelWidth: number, awardHalf: number, top: number) {
    const bottom = height - 66, preferred = height < 500 ? bottom : Math.max(top, height * 0.3 - 34);
    // Try the centre, then either side. Reserve each award's entire 1.6-second
    // trajectory so the banner stays clear without chasing the rising numbers.
    for (let column = 0; column < 3; column++) {
      const x = column === 0 ? (width - panelWidth) / 2 : column === 1 ? 8 : width - panelWidth - 8;
      for (let candidate = -3; candidate < this.awards.length * 2; candidate++) {
        const r = candidate >= 0 ? this.awards[Math.floor(candidate / 2)]! : undefined;
        if (r && (now < r.at || now - r.at >= 2000)) continue;
        let y = candidate === -3 ? preferred : candidate === -2 ? bottom : top;
        if (r) {
          const firstY = (r.y - camera.y - 65) * scale;
          y = candidate % 2 ? firstY - (1600 / 35 + 36) * scale - 54 - 8 : firstY + 10 * scale + 8;
        }
        if (y < top || y + 54 > height - 8) continue;
        let overlaps = false;
        for (const a of this.awards) {
          if (now < a.at || now - a.at >= 2000) continue;
          const ax = (a.x - camera.x) * scale, firstY = (a.y - camera.y - 65) * scale;
          if (ax + awardHalf * scale > x && ax - awardHalf * scale < x + panelWidth &&
            firstY + 10 * scale + 8 > y && firstY - (1600 / 35 + 36) * scale - 8 < y + 54) { overlaps = true; break; }
        }
        if (!overlaps) return { x, y };
      }
    }
    return { x: (width - panelWidth) / 2, y: bottom };
  }
  draw(c: CanvasRenderingContext2D, width: number, height: number, camera: { x: number; y: number }, scale: number, boss: Bug | undefined, visible: Bug | undefined, now: number, arrowTop: number) {
    c.save();
    if (boss) {
      const w = width - 32;
      c.fillStyle = "#060b12ee"; c.fillRect(8, 46, width - 16, 40);
      c.fillStyle = "#364326"; c.fillRect(16, 69, w, 10);
      c.fillStyle = "#d9f278"; c.fillRect(16, 69, w * boss.hp / boss.maxHp!, 10);
      c.font = "bold 16px system-ui"; c.textAlign = "center"; c.fillStyle = "#efffc2";
      c.fillText(`${boss.phase === "arrival" ? "Hive incoming" : "HIVE"}  ${boss.hp} / ${boss.maxHp}`, width / 2, 63);
    }
    if (visible) {
      const arrow = helpArrow((visible.x - camera.x) * scale, (visible.y - camera.y) * scale, width, height, arrowTop);
      if (arrow) {
        c.save(); c.translate(arrow.x, arrow.y); c.rotate(arrow.angle); c.fillStyle = "#d9f278";
        c.beginPath(); c.moveTo(15, 0); c.lineTo(-10, -10); c.lineTo(-10, 10); c.lineTo(15, 0); c.fill(); c.restore();
        c.font = "bold 16px system-ui"; c.textAlign = "center"; c.fillStyle = "#efffc2"; c.fillText("Hive", arrow.x, arrow.y + 28);
      }
    }
    if (now >= this.bannerAt && now - this.bannerAt < 2000) {
      c.font = "bold 32px system-ui"; c.textAlign = "center";
      const w = Math.min(width - 16, c.measureText("Hive down!").width + 32);
      const { x, y } = this.bannerPosition(width, height, camera, scale, now, w, c.measureText("+350").width / 2 + 5, boss ? 94 : 46);
      c.fillStyle = "#060b12dd"; c.fillRect(x, y, w, 54);
      c.fillStyle = "#edff9c"; c.fillText("Hive down!", x + w / 2, y + 38);
    }
    c.restore();
  }
}
