import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["unpdf", "mammoth"],
  experimental: {
    serverActions: { bodySizeLimit: "4.5mb" },
  },
  // The Queue became the Inbox; send old links there before any page renders.
  async redirects() {
    return [{ source: "/queue", destination: "/inbox", permanent: false }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
