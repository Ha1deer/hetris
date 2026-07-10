# HETRIS — Android APK (Capacitor)

App ID: **`com.haider.hetris`**  ·  App name: **HETRIS**  ·  100% offline.

All game assets (intro image, menu background, soundtrack) are downloaded at
build time by `scripts/fetch-mobile-assets.mjs` and bundled into
`dist/spa/bundled/`, so the APK runs with **no network access**.

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

Requirements: **Node 18+**, **JDK 17** (Android Gradle Plugin 8 refuses JDK 21+),
**Android Studio** with Android SDK Platform 34 + Build-Tools 34, and either an
emulator or a device with USB debugging on.

```bash
# 1. Install deps
bun install                       # or: npm install

# 2. If an old android/ folder exists (e.g. from a previous appId), delete it.
#    Capacitor bakes appId into the folder and won't rename in place.
rm -rf android

# 3. Build the offline SPA and generate the native Android project
bun run cap:add:android
#   ⇒ dist/spa/  (offline web bundle)
#   ⇒ android/   (Gradle project with appId com.haider.hetris)

# 4. Open in Android Studio
bun run cap:open:android
```

In Android Studio: **File → Sync Project with Gradle Files**, then
**Build → Build Bundle(s) / APK(s) → Build APK(s)**. The APK is written to
`android/app/build/outputs/apk/debug/app-debug.apk`.

Android Studio will index the project. Click **Run ▶** to launch on an
emulator / device, or use **Build → Build Bundle(s) / APK(s) → Build APK(s)**
to produce a release-ready `.apk` under
`android/app/build/outputs/apk/`.

## Build the APK from the terminal (no Android Studio)

```bash
bun run cap:sync                       # rebuild SPA + sync into android/
cd android
./gradlew assembleDebug                # → app/build/outputs/apk/debug/app-debug.apk
# For a release build:
./gradlew assembleRelease
```

If Gradle fails with **"Unsupported class file major version"**, you are on
the wrong JDK. Force JDK 17:

```bash
export JAVA_HOME="$(/usr/libexec/java_home -v 17)"   # macOS
# or point to your JDK 17 install on Linux/Windows
./gradlew --stop && ./gradlew assembleDebug
```

If Gradle can't find the Android SDK, create `android/local.properties`:

```
sdk.dir=/absolute/path/to/Android/sdk
```

## After code changes

```bash
bun run cap:sync          # rebuild SPA + copy into android/
# then Run ▶ in Android Studio, or ./gradlew assembleDebug
```

## Offline behavior

- Game logic, rendering, controls, themes, CSS animations, intro image, menu
  background and soundtrack are all bundled into `dist/spa/` and shipped
  inside the APK. The app never contacts the network at runtime.
- `capacitor.config.ts` sets `androidScheme: "https"` with `hostname: localhost`
  and `cleartext: false`, so the WebView only ever loads bundled resources.

## App identity

Current `appId` is `com.haider.hetris`. If you change it, delete the existing
`android/` folder and re-run `bun run cap:add:android`. App icons and splash
screen go under `android/app/src/main/res/` (Android Studio → Image Asset).