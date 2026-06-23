import React from "react";
import ReactDOM from "react-dom/client";
import NeonStack from "@/components/NeonStack";
import "@/styles.css";

// Capacitor-only init (safe no-ops in browser if plugins missing)
async function initNative() {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return;
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: "#0b0518" });
    await StatusBar.hide().catch(() => {});
    const { SplashScreen } = await import("@capacitor/splash-screen");
    await SplashScreen.hide().catch(() => {});
  } catch {
    /* not in a Capacitor container */
  }
}

initNative();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <div className="min-h-screen w-full bg-[#0b0518] text-white">
      <NeonStack />
    </div>
  </React.StrictMode>,
);