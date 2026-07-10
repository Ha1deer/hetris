import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.haider.hetris",
  appName: "HETRIS",
  webDir: "dist/spa",
  bundledWebRuntime: false,
  // Fully offline app: no network, no mixed content, no dev server URL.
  android: {
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
  },
  server: {
    // http scheme is required so relative "./" asset URLs in the SPA bundle
    // resolve correctly from the local file:// -> http://localhost bridge.
    androidScheme: "http",
    hostname: "localhost",
    cleartext: false,
  },
};

export default config;