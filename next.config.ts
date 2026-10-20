import type { NextConfig } from 'next';
const config: NextConfig = {
  output: 'standalone',
  devIndicators: false,
  // OAuth renewal, model discovery, and a complete reasoning reply can exceed
  // Next's 30-second rewrite proxy default.
  experimental: { proxyTimeout: 240000 },
  distDir: process.env.NEXT_BUILD_DIR || '.next',
  async rewrites() { return [{ source: '/api/:path*', destination: `${process.env.BACKEND_URL || 'http://127.0.0.1:8000'}/api/:path*` }]; },
};
export default config;
