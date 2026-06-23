# HETRIS — Android APK (Capacitor)

The game is now wrapped with [Capacitor](https://capacitorjs.com) so you can
build a fully offline Android APK in Android Studio.

## What was added

- `mobile/index.html` + `mobile/main.tsx` — a standalone SPA entry that mounts
  the `<NeonStack />` game without TanStack Router / SSR.
- `vite.mobile.config.ts` — separate Vite config that produces a static
  bundle in `dist/spa/` (relative asset paths, fully offline-capable).
- `capacitor.config.ts` — Capacitor config (app id `app.lovable.hetris`,
  `webDir: dist/spa`).
- Capacitor packages: `@capacitor/core`, `@capacitor/cli`, `@capacitor/android`,
  `@capacitor/app`, `@capacitor/status-bar`, `@capacitor/splash-screen`.
- npm scripts: `build:mobile`, `cap:add:android`, `cap:sync`, `cap:open:android`.

## One-time setup (on your machine)

Requirements: Node 18+, **Android Studio** (with Android SDK + an emulator
or a real device with USB debugging), and JDK 17.

```bash
# 1. Clone the repo and install deps
bun install        # or: npm install

# 2. Build the static SPA + create the Android project
bun run cap:add:android
#   ⇒ generates dist/spa/  and  android/

# 3. Open in Android Studio
bun run cap:open:android
```

Android Studio will index the project. Click **Run ▶** to launch on an
emulator / device, or use **Build → Build Bundle(s) / APK(s) → Build APK(s)**
to produce a release-ready `.apk` under
`android/app/build/outputs/apk/`.

## After code changes

```bash
bun run cap:sync          # rebuild SPA + copy into android/
# then hit Run ▶ in Android Studio again
```

## Offline behavior

- All game logic, rendering, controls, themes and CSS animations are bundled
  into the APK and run with **no network connection**.
- The intro image and soundtrack are currently served from Lovable's CDN
  (`*.asset.json` URLs). If you want them fully offline inside the APK, drop
  the real files into `mobile/public/` and replace the imports in
  `src/components/NeonStack.tsx` with local paths (e.g. `./haider-intro.png`).

## App identity

Change `appId` / `appName` in `capacitor.config.ts` before publishing to the
Play Store. App icons and splash screen go under
`android/app/src/main/res/` (Android Studio → Image Asset wizard).