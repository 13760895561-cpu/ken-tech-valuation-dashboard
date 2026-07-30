import { mkdir, readFile, writeFile } from "node:fs/promises";
import { refreshMarketDataset } from "../lib/market-refresh";
import type { DashboardDataset } from "../lib/dashboard-types";

const seedUrl = new URL("../lib/seed-data.json", import.meta.url);
const publicDataDirectory = new URL("../public/data/", import.meta.url);
const publicDataUrl = new URL(
  "../public/data/dashboard.json",
  import.meta.url,
);
const shouldRefresh = process.argv.includes("--refresh");

const current = JSON.parse(
  await readFile(seedUrl, "utf8"),
) as DashboardDataset;
const next = shouldRefresh
  ? (await refreshMarketDataset(current)).dataset
  : current;
const serialized = `${JSON.stringify(next, null, 2)}\n`;

await mkdir(publicDataDirectory, { recursive: true });
await Promise.all([
  writeFile(publicDataUrl, serialized, "utf8"),
  ...(shouldRefresh
    ? [writeFile(seedUrl, serialized, "utf8")]
    : []),
]);

console.log(
  shouldRefresh
    ? `已保存 ${next.snapshot.companies.length} 家公司的最新共享快照`
    : `已同步 ${next.snapshot.companies.length} 家公司的静态数据`,
);
