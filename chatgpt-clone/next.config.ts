import type { NextConfig } from "next";

const fastapiOrigin = process.env.NEXT_PUBLIC_FASTAPI_ORIGIN ?? "http://127.0.0.1:8002";

const nextConfig: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  /** Dev only: proxy /v1/* to FastAPI so `npm run dev` works with same-origin fetch paths. */
  async rewrites() {
    return [
      {
        source: "/v1/:path*",
        destination: `${fastapiOrigin}/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
