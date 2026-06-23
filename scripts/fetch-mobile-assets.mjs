#!/usr/bin/env node
// Downloads every src/assets/*.asset.json file from the Lovable CDN into
// mobile/public/bundled/ and emits local-override pointer files under
// mobile/assets-local/ so the Capacitor APK can run with zero network.
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC_ASSETS = path.join(root, "src/assets");
const OUT_BUNDLED = path.join(root, "mobile/public/bundled");
const OUT_POINTERS = path.join(root, "mobile/assets-local");
const CDN_ORIGIN = process.env.LOVABLE_ASSET_ORIGIN || "https://hetris.lovable.app";

await mkdir(OUT_BUNDLED, { recursive: true });
await mkdir(OUT_POINTERS, { recursive: true });

const files = (await readdir(SRC_ASSETS)).filter((f) => f.endsWith(".asset.json"));
if (files.length === 0) {
  console.log("[mobile-assets] no .asset.json pointers found.");
  process.exit(0);
}

for (const file of files) {
  const pointerPath = path.join(SRC_ASSETS, file);
  const pointer = JSON.parse(await readFile(pointerPath, "utf8"));
  const filename = pointer.original_filename || path.basename(pointer.url);
  const remoteUrl = `${CDN_ORIGIN}${pointer.url}`;
  const localFile = path.join(OUT_BUNDLED, filename);

  console.log(`[mobile-assets] ${filename}  <-  ${remoteUrl}`);
  const res = await fetch(remoteUrl);
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download ${remoteUrl}: ${res.status} ${res.statusText}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(localFile));

  // Local override pointer with same shape, url relative to the SPA root.
  const localPointer = { ...pointer, url: `bundled/${filename}` };
  await writeFile(
    path.join(OUT_POINTERS, file),
    JSON.stringify(localPointer, null, 2) + "\n",
  );
}

console.log(`[mobile-assets] bundled ${files.length} asset(s) into mobile/public/bundled/`);