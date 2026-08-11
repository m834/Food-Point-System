/** @type {import('next').NextConfig} */
const nextConfig = {
  // The UI runs from disk inside Electron — there is no Next.js server.
  output: 'export',
  // Every route exports as a folder with an index.html, which the app://
  // protocol handler in electron/main.ts resolves without having to guess.
  trailingSlash: true,
  // The image optimizer needs a server; this app never has one.
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default nextConfig;
