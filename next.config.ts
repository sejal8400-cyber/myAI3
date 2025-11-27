import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    allowedOrigins: ['*'],
  },
};

export default nextConfig;
