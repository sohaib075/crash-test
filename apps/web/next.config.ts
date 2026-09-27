import type { NextConfig } from "next";

// The browser calls this app's own origin; these rewrites forward /api and
// /socket.io to the API server, so a deployment needs one public URL and no CORS.
// INTERNAL_API_URL is read when the app is built (next build) and when dev starts.
const api = (process.env.INTERNAL_API_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");

const nextConfig: NextConfig = {
  transpilePackages: ["@crash/shared"],
  reactStrictMode: true,
  poweredByHeader: false,
  // socket.io requests "/socket.io/?EIO=4…"; the default trailing-slash redirect would break them.
  skipTrailingSlashRedirect: true,
  experimental: {
    // The rewrite proxy's default timeout is 30 s; Reset demo or a first graph8 discovery can take longer.
    proxyTimeout: 300_000,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          // Share links carry their token in the URL: never pass it on as a Referer.
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${api}/api/:path*` },
      { source: "/socket.io/:path*", destination: `${api}/socket.io/:path*` },
      { source: "/socket.io", destination: `${api}/socket.io/` },
    ];
  },
};

export default nextConfig;
