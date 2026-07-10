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
- `capacitor.config.ts` — Capacitor config (`appId: com.haider.hetris`,
  `webDir: dist/spa`).
- Capacitor packages: `@capacitor/core`, `@capacitor/cli`, `@capacitor/android`,
  `@capacitor/app`, `@capacitor/status-bar`, `@capacitor/splash-screen`.
- npm scripts: `build:mobile`, `cap:add:android`, `cap:sync`,
  `cap:open:android`, `clean:android`, `clean:spa`.

> **IMPORTANT — do not run `npx cap sync` / `npx cap add android` directly.**
> They skip the SPA build and fail with
> `Could not find the web assets directory: ./dist/spa`.
> Always use the `bun run cap:*` scripts below — they build the offline SPA
> into `dist/spa/` first, then invoke Capacitor.

## One-time setup (on your machine)

Requirements: **Node 18+**, **JDK 17** (Android Gradle Plugin 8 refuses JDK 21+),
**Android Studio** with Android SDK Platform 34 + Build-Tools 34, and either an
emulator or a device with USB debugging on.

### macOS / Linux

```bash
# 1. Install deps
bun install                       # or: npm install

# 2. If an old android/ folder exists (e.g. from a previous appId), delete it.
#    Capacitor bakes appId into the folder and won't rename in place.
bun run clean:android             # cross-platform; or: rm -rf android

# 3. Build the offline SPA and generate the native Android project
bun run cap:add:android
#   ⇒ dist/spa/  (offline web bundle)
#   ⇒ android/   (Gradle project with appId com.haider.hetris)

# 4. Open in Android Studio
bun run cap:open:android
```

### Windows (PowerShell or cmd)

```powershell
# 1. Install deps
bun install                       # or: npm install

# 2. Remove any old android/ folder (works in PowerShell AND cmd)
bun run clean:android

# 3. Build the offline SPA + generate the native Android project
bun run cap:add:android

# 4. Open in Android Studio
bun run cap:open:android
```

If you see `Could not find the web assets directory: .\dist\spa`, you either
ran `cap sync` directly (skip that — use `bun run cap:sync`) or the
`build:mobile` step failed earlier. Run it standalone to see the real error:

```powershell
bun run build:mobile
```

It must finish with `✓ built in …` and leave a `dist/spa/index.html` on disk.

In Android Studio: **File → Sync Project with Gradle Files**, then
**Build → Build Bundle(s) / APK(s) → Build APK(s)**. The APK is written to
`android/app/build/outputs/apk/debug/app-debug.apk`.

## Build the APK from the terminal (no Android Studio)

On macOS/Linux:

```bash
bun run cap:sync                       # rebuild SPA + sync into android/
cd android
./gradlew assembleDebug                # → app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleRelease              # release build
```

On Windows (PowerShell / cmd), use `gradlew.bat` and backslashes are fine:

```powershell
bun run cap:sync
cd android
.\gradlew.bat assembleDebug            # → app\build\outputs\apk\debug\app-debug.apk
.\gradlew.bat assembleRelease
```

If Gradle fails with **"Unsupported class file major version"**, you are on
the wrong JDK (JDK 21+ is not supported by AGP 8). Force JDK 17:

```bash
# macOS
export JAVA_HOME="$(/usr/libexec/java_home -v 17)"

# Linux (adjust path to your JDK 17 install)
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk

# Windows PowerShell (adjust path to your JDK 17 install)
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-17.0.12.7-hotspot"

# then restart the Gradle daemon and rebuild
./gradlew --stop
./gradlew assembleDebug          # .\gradlew.bat assembleDebug on Windows
```

If Gradle can't find the Android SDK, create `android/local.properties`:

```
# macOS/Linux
sdk.dir=/Users/you/Library/Android/sdk

# Windows — use forward slashes OR escape the backslashes
sdk.dir=C:/Users/you/AppData/Local/Android/Sdk
```

## After code changes

```bash
bun run cap:sync          # rebuild SPA + copy into android/
# then Run ▶ in Android Studio, or ./gradlew assembleDebug
```

If something looks stale (old assets, wrong appId, weird Gradle cache), do a
clean rebuild:

```bash
bun run clean:spa
bun run clean:android
bun run cap:add:android
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