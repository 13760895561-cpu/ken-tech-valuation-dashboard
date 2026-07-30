import type { NextConfig } from "next";

const repositoryName =
  process.env.GITHUB_REPOSITORY?.split("/")[1] ??
  "ken-tech-valuation-dashboard";
const isGitHubPages = process.env.GITHUB_ACTIONS === "true";
const basePath = isGitHubPages ? `/${repositoryName}` : "";
const siteUrl = isGitHubPages
  ? `https://${process.env.GITHUB_REPOSITORY_OWNER}.github.io/${repositoryName}`
  : "http://localhost:3000";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath,
  assetPrefix: basePath,
  images: {
    unoptimized: true,
  },
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
    NEXT_PUBLIC_SITE_URL: siteUrl,
  },
};

export default nextConfig;
