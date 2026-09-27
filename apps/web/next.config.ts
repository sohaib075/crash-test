import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@crash/shared"],
  reactStrictMode: true,
};

export default nextConfig;
