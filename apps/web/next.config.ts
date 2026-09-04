import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source rather than a build artifact.
  transpilePackages: ["@ambatucode/shared", "@ambatucode/db"],
  // Native and Node-only modules must stay outside the bundle.
  serverExternalPackages: ["@node-rs/argon2", "@prisma/client", "bullmq", "ioredis"],
  typedRoutes: false,
};

export default nextConfig;
