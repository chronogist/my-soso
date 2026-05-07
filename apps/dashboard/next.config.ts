import type { NextConfig } from 'next';

if (process.env.NODE_ENV !== 'production') {
  process.loadEnvFile(new URL('../../.env', import.meta.url));
}

const nextConfig: NextConfig = {
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  poweredByHeader: false,
};

export default nextConfig;
