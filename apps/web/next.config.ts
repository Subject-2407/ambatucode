import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source rather than a build artifact.
  transpilePackages: ["@ambatucode/shared", "@ambatucode/db"],
  // Native and Node-only modules must stay outside the bundle.
  serverExternalPackages: ["@node-rs/argon2", "@prisma/client", "bullmq", "ioredis"],
  typedRoutes: false,
  experimental: {
    // Chakra and lucide are barrel files. Without this, importing a single
    // component from a Server Component drags the whole client-reference graph
    // into that route's chunk — /profile measured 534 kB before, 210 kB after.
    optimizePackageImports: ["@chakra-ui/react", "lucide-react"],
  },
};

export default nextConfig;
