import { app, BrowserWindow, Menu, protocol, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { getDb, closeDb } from './db/connection';
import { migrate } from './db/migrate';
import { registerIpcHandlers } from './ipc';

/**
 * Spec §3 and §11 put the food point's data in %APPDATA%/CodeHustlersFood/ —
 * no spaces — while the installer needs a readable product name. Electron
 * derives userData from the app NAME, so without this line the data would land
 * in a folder named after the product and the documented path would silently
 * be wrong. It must run before anything calls getPath('userData'), which is why
 * it sits at module top level rather than inside whenReady.
 */
app.setName('CodeHustlersFood');

const isDev = process.env.FOOD_DEV === '1';
const DEV_URL = 'http://localhost:3000';

/** The exported Next.js UI, served from disk over the app:// scheme. */
const UI_ROOT = path.join(__dirname, '..', '..', 'out');

let mainWindow: BrowserWindow | null = null;

// One counter, one window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain',
};

/**
 * Serving the UI over a custom scheme rather than file:// keeps absolute asset
 * paths (/_next/...) working and gives the renderer a real origin, so it can be
 * locked down with a Content-Security-Policy.
 */
function registerAppProtocol(): void {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    let pathname = decodeURIComponent(url.pathname);

    if (pathname.endsWith('/')) pathname += 'index.html';
    if (!path.extname(pathname)) pathname += '/index.html';

    const filePath = path.join(UI_ROOT, pathname);

    // Never serve anything outside the exported UI folder.
    if (!filePath.startsWith(UI_ROOT)) {
      return new Response('Not found', { status: 404 });
    }

    try {
      const body = await fs.promises.readFile(filePath);
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
          // No CDNs, no remote anything — the app is offline by design.
          'Content-Security-Policy':
            "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; " +
            "base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    // Warm paper, so the first paint already looks like the food app rather
    // than flashing white or the cool grey of the shop.
    backgroundColor: '#FAF7F3',
    title: 'Food Point',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // The renderer is untrusted: no Node, no database, no filesystem.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
    },
  });

  // A cashier does not need an application menu; the sidebar is the app.
  Menu.setApplicationMenu(null);
  mainWindow.setMenuBarVisibility(false);

  mainWindow.once('ready-to-show', () => {
    mainWindow?.maximize();
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Nothing may navigate or pop out to the web.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = isDev ? url.startsWith(DEV_URL) : url.startsWith('app://');
    if (!allowed) event.preventDefault();
  });

  if (isDev) {
    mainWindow.loadURL(DEV_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadURL('app://foodpoint/');
  }
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  registerAppProtocol();

  // Open and upgrade the database before the UI can ask for anything.
  getDb();
  migrate();

  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('will-quit', () => {
  // Checkpoint and close cleanly so the .db file on disk is complete — that
  // file is what a USB backup copies.
  closeDb();
});
