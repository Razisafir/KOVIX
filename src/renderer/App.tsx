import { lazy, Suspense } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import Sidebar from "./components/Sidebar";
import StatusBar from "./components/StatusBar";
import useAppStore from "./stores/useAppStore";
import OnboardingModal from "./components/OnboardingModal";
import ToastContainer from "./components/ToastContainer";
import { AnimatedBackground } from "./components/premium/AnimatedBackground";
import { SkeletonLine } from "./components/Skeleton";

const Editor = lazy(() => import("./components/Editor"));
const Panel = lazy(() => import("./components/Panel"));

function App() {
  const sidebarVisible = useAppStore((s) => s.sidebarVisible);
  const panelVisible = useAppStore((s) => s.panelVisible);
  const onboardingComplete = useAppStore((s) => s.onboardingComplete);
  const location = useLocation();

  return (
    <div className="flex flex-col w-full h-full mesh-gradient-bg">
      {/* Animated background overlay */}
      <AnimatedBackground />

      {/* Toast container - fixed bottom-right */}
      <ToastContainer />

      {/* Onboarding modal - first run only */}
      {!onboardingComplete && <OnboardingModal />}

      {/* Toolbar */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="flex items-center h-9 px-3 glass-panel border-b border-construct-border/50 shrink-0 z-10"
      >
        <span className="text-xs font-semibold tracking-widest text-construct-accent uppercase select-none">
          Construct
        </span>
        <div className="flex-1" />
        <span className="text-[10px] text-construct-textMuted select-none">v0.1.0</span>
      </motion.div>

      {/* Main Layout */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Sidebar with animation */}
        <AnimatePresence initial={false}>
          {sidebarVisible && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 240, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="shrink-0 glass-panel border-r border-construct-border/50 overflow-hidden"
            >
              <Sidebar />
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Center - Editor + Panel */}
        <main className="flex flex-col flex-1 min-w-0">
          <div className="flex-1 min-h-0">
            <AnimatePresence mode="wait">
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.2 }}
                className="w-full h-full"
              >
                <Suspense fallback={<EditorSkeleton />}>
                  <Routes location={location}>
                    <Route path="/" element={<Editor />} />
                    <Route path="/editor" element={<Editor />} />
                  </Routes>
                </Suspense>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Bottom Panel with animation */}
          <AnimatePresence initial={false}>
            {panelVisible && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 192, opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="shrink-0 glass-panel border-t border-construct-border/50 overflow-hidden"
              >
                <Panel />
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      <StatusBar />
    </div>
  );
}

function EditorSkeleton() {
  return (
    <div className="w-full h-full p-4 space-y-3">
      <SkeletonLine width="75%" height="16px" />
      <SkeletonLine width="50%" height="16px" />
      <SkeletonLine width="83%" height="16px" />
      <SkeletonLine width="66%" height="16px" />
      <SkeletonLine width="80%" height="16px" />
      <div className="pt-4 space-y-2">
        <SkeletonLine width="90%" height="12px" />
        <SkeletonLine width="70%" height="12px" />
        <SkeletonLine width="85%" height="12px" />
      </div>
    </div>
  );
}

export default App;
