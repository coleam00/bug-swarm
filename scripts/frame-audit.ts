/** Developer benchmark diagnostics; every interval still counts toward FPS. */
export class FrameAudit {
  readonly windows: { endMs: number; durationMs: number; frames: number; fps: number; maxCallbackMs: number; maxDelayMs: number }[] = [];
  readonly gaps: { atMs: number; intervalMs: number; previousCallbackMs: number; betweenCallbacksMs: number;
    callbackDelayMs: number; callbackMs: number; updateMs: number; drawMs: number; fixtureMs: number }[] = [];
  private start = NaN;
  private previous = 0;
  private previousBegin = 0;
  private previousEnd = 0;
  private windowStart = 0;
  private frames = 0;
  private windowCallback = 0;
  private windowDelay = 0;
  private maxCallback = 0;
  private maxInterval = 0;

  record(timestamp: number, begin: number, end: number, updateMs: number, drawMs: number, fixtureMs: number): void {
    const work = end - begin, delay = begin - timestamp;
    this.maxCallback = Math.max(this.maxCallback, work);
    if (Number.isNaN(this.start)) {
      this.start = this.windowStart = timestamp;
    } else {
      const interval = timestamp - this.previous;
      this.maxInterval = Math.max(this.maxInterval, interval);
      // 25 ms only selects diagnostic detail, never excludes a frame from FPS.
      if (interval > 25) this.gaps.push({ atMs: timestamp - this.start, intervalMs: interval,
        previousCallbackMs: this.previousEnd - this.previousBegin, betweenCallbacksMs: begin - this.previousEnd,
        callbackDelayMs: delay, callbackMs: work, updateMs, drawMs, fixtureMs });
      this.frames++;
      this.windowCallback = Math.max(this.windowCallback, work);
      this.windowDelay = Math.max(this.windowDelay, delay);
      const duration = timestamp - this.windowStart;
      if (duration >= 1000) {
        this.windows.push({ endMs: timestamp - this.start, durationMs: duration, frames: this.frames,
          fps: this.frames * 1000 / duration, maxCallbackMs: this.windowCallback, maxDelayMs: this.windowDelay });
        this.windowStart = timestamp; this.frames = 0; this.windowCallback = this.windowDelay = 0;
      }
    }
    this.previous = timestamp; this.previousBegin = begin; this.previousEnd = end;
  }

  report() {
    return { maxCallbackMs: this.maxCallback, maxIntervalMs: this.maxInterval, windows: this.windows, gaps: this.gaps };
  }
}
