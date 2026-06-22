import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['pg', '@modelcontextprotocol/sdk'],
};

export default nextConfig;
