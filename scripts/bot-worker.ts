import { createCohort } from "./bot-cohort";
let cohort: ReturnType<typeof createCohort> | undefined;
self.onmessage = async (event: MessageEvent) => {
  const message = event.data;
  try {
    if (message.type === "start") {
      cohort = createCohort(message.options, message.index, error => postMessage({ type: "failure", message: error.message }));
      await cohort.ready; postMessage({ type: "ready", stats: cohort.stats() });
    } else if (message.type === "window") cohort!.window(message.start, message.end);
    else if (message.type === "stats") postMessage({ type: "stats", id: message.id, stats: cohort!.stats() });
    else if (message.type === "close") { await cohort!.close(); postMessage({ type: "closed", id: message.id, stats: cohort!.stats() }); self.close(); }
  } catch (error) { postMessage({ type: "failure", message: String(error) }); }
};
