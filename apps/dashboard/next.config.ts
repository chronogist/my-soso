import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  poweredByHeader: false,
};

export default nextConfig;
