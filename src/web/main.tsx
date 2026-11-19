import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { loadView } from "./route";

void loadView(window.location.pathname).then(View => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <View />
    </StrictMode>,
  );
});
