import { MotionConfig, motion } from "motion/react";
import * as React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { Stage } from "./stage/Stage";
import { installUrlSync, useApp } from "./state/store";
import { About, EmptyState, Readout, TopBar, Welcome } from "./ui/Chrome";
import { Dock } from "./ui/Dock";
import { Player } from "./ui/Player";
import { STAGE_BG, useResolvedTheme } from "./ui/theme";

// The index view and its DOM grid are only needed once someone opens it.
const IndexView = React.lazy(() => import("./ui/IndexView"));

const MemoStage = React.memo(Stage);

function App() {
  const theme = useResolvedTheme();
  const view = useApp((s) => s.view);
  React.useEffect(installUrlSync, []);

  return (
    // "user": honour prefers-reduced-motion across every Motion animation.
    <MotionConfig reducedMotion="user">
      <motion.div
        className="fixed inset-0"
        animate={{ opacity: view === "index" ? 0 : 1, scale: view === "index" ? 0.985 : 1 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        style={{ pointerEvents: view === "index" ? "none" : "auto" }}
      >
        <MemoStage background={STAGE_BG[theme]} />
        {/* Edge fades so the chrome stays legible over artwork. Plain gradients, not
            backdrop-filter, which would force a canvas snapshot per composite. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-bg via-bg/80 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-bg via-bg/70 to-transparent" />
      </motion.div>
      {view === "index" && (
        <React.Suspense fallback={null}>
          <IndexView />
        </React.Suspense>
      )}
      <EmptyState />
      <TopBar />
      <Readout />
      <Dock />
      <Player />
      <About />
      <Welcome />
    </MotionConfig>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("No #root element");
createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
