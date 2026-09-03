import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // `standalone` keeps the production image small: Docker copies only the
  // server bundle plus the traced subset of node_modules.
  output: 'standalone',
  reactStrictMode: true,
};

export default nextConfig;
