import Dashboard from "@/components/Dashboard";
import seedData from "@/lib/seed-data.json";
import type { DashboardDataset } from "@/lib/dashboard-types";

export default function Home() {
  return <Dashboard initialDataset={seedData as DashboardDataset} />;
}
