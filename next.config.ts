import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: { root: __dirname },
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
  devIndicators: false,
};

export default nextConfig;
