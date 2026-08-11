---
name: offline-desktop-packaging
description: Package Code Hustlers' offline retail desktop apps (Shop Inventory, Pharmacy, Food-Point) into a distributable Windows .exe installer using Electron + electron-builder. Use this whenever the task involves building, bundling, packaging, or shipping the app as an .exe — including electron-builder config, rebuilding native modules like better-sqlite3 for Electron, the build pipeline (Next.js export → Electron → installer), installer options, or code-signing / SmartScreen questions. Trigger even if the user only says "make the exe", "build the installer", "package it", or "it crashes after I build it".
---

# Offline Desktop Packaging (Electron → Windows .exe)

You package Code Hustlers' offline retail desktop apps into a single Windows `.exe` installer with **electron-builder**. The output is what the sales team installs on a shop's PC. Get this reliable and boring — a broken installer at the shop is a reputation problem.

In this repo the governing spec is `Food_Point_System_Build_Spec_v1.md`. This skill is the *how* for packaging.

**Carrying this to the food app:** the config below is the shop's. Change `appId` to `com.codehustlers.foodpoint`, `productName` to the food product name, and — the one that is easy to miss — call `app.setName('CodeHustlersFood')` before `app.whenReady()` in `electron/main.ts`, or the data lands in a folder named after the product instead of the `%APPDATA%/CodeHustlersFood/` the spec promises. The pharmacy does exactly this at `electron/main.ts:15`.

## The build pipeline

Three stages, in order:

1. **Build the UI:** `next build` with `output: 'export'` → produces a static `out/` folder (plain HTML/JS/CSS, no server).
2. **Compile the main process:** bundle `electron/main.ts` and `electron/preload.ts` (esbuild/tsc) into `dist-electron/`.
3. **Package:** `electron-builder` bundles the compiled main process + the `out/` UI + native modules into an NSIS `.exe` installer.

Wire these into `package.json` scripts so one command produces the installer:

```json
{
  "scripts": {
    "build:ui": "next build",
    "build:main": "tsc -p electron/tsconfig.json",
    "build": "npm run build:ui && npm run build:main",
    "dist": "npm run build && electron-builder --win --x64"
  }
}
```

## Native modules — the #1 thing that breaks

`better-sqlite3` is a **native** module. It must be compiled for **Electron's** Node ABI, not your system Node, or the app crashes on launch with a version-mismatch error. This is the most common packaging failure.

- Install `electron-rebuild` (or rely on electron-builder's built-in rebuild) and rebuild after every `npm install`:
  ```json
  "postinstall": "electron-builder install-app-deps"
  ```
- Keep `better-sqlite3` in **`dependencies`**, not `devDependencies`, so it ships.
- In electron-builder, **unpack** the native binary from the asar archive, or SQLite won't load:
  ```json
  "build": { "asarUnpack": ["**/node_modules/better-sqlite3/**"] }
  ```

## electron-builder config

```json
"build": {
  "appId": "com.codehustlers.shopinventory",
  "productName": "Code Hustlers Shop Inventory",
  "directories": { "output": "release" },
  "files": ["dist-electron/**", "out/**", "package.json"],
  "asarUnpack": ["**/node_modules/better-sqlite3/**"],
  "win": { "target": ["nsis"], "artifactName": "${productName}-Setup-${version}.exe" },
  "nsis": {
    "oneClick": false,
    "perMachine": true,
    "allowToChangeInstallationDirectory": true,
    "createDesktopShortcut": true,
    "createStartMenuShortcut": true,
    "deleteAppDataOnUninstall": false
  }
}
```

Key choices explained:
- **`deleteAppDataOnUninstall: false`** — never delete the shop's database or backups on uninstall. Their data is sacred.
- **`perMachine: true`** — the app is for the shop counter, installed once for all users of that PC.
- **`allowToChangeInstallationDirectory: true`** — some shop PCs have a tiny C: drive.

## Data & licensing at install time

- The app stores its database and license in `app.getPath('userData')` (e.g. `%APPDATA%/Code Hustlers Shop Inventory/`), **created at first run**, never inside the install directory. The installer should not seed data there.
- On first launch the app runs the licensing/activation flow before it becomes usable — packaging just needs to ship the app; it does not embed any license. Ship the **public** verification key only (baked into the compiled main process); the private signing key never leaves the founder's office.

## Code signing & SmartScreen

- An **unsigned** installer works, but Windows SmartScreen shows a "unknown publisher" warning on first run. Shopkeepers may hesitate. Tell the founder this plainly.
- To remove the warning you need a **code-signing certificate** (OV or EV) — a paid, business-verification purchase. This is a business decision, not a code fix. If/when a cert exists, add `win.certificateFile` + password (via env var, never committed). Until then, brief the sales team to click "More info → Run anyway".

## Versioning & updates

- Bump `version` in `package.json` for every build; it shows in the installer filename and the app's About/Settings.
- **No auto-update in v1.** The app is offline; auto-update needs the internet and is out of scope. New versions are re-installed manually by the team. Do not add `electron-updater`.

## Sanity checklist before handing an installer to the sales team

- [ ] Fresh install on a clean Windows machine launches without a native-module error.
- [ ] Database and license file are created in `%APPDATA%`, not in the install folder.
- [ ] Activation screen appears on first run; app unlocks with a valid founder-issued key.
- [ ] A test sale prints to a thermal printer.
- [ ] Backup writes to a USB drive.
- [ ] Uninstall leaves the database and backups intact.
- [ ] Installer filename carries the correct version number.

## Do not

- Do not bundle `electron` or build tools into `dependencies` (they belong in `devDependencies`).
- Do not add auto-update, crash reporting to a remote server, or any network feature.
- Do not delete user data on uninstall.
- Do not commit signing certificates or passwords to the repo.
