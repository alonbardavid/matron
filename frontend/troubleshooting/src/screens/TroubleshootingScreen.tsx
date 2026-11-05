import { Tabs } from "@mantine/core";
import { Card } from "@frontend/ds/Card";
import { Page } from "@frontend/ds/Page";
import { useTab } from "../urlState";
import { ContainersTab } from "../widgets/ContainersTab";
import { DatabasesTab } from "../widgets/DatabasesTab";

const TABS = ["databases", "containers"] as const;
type Tab = (typeof TABS)[number];

/** The deployment's own resources, read live from Cloudflare; owners only. The view is in the URL. */
export function TroubleshootingScreen() {
  const [tab, setTab] = useTab("databases");
  const shown: Tab = (TABS as readonly string[]).includes(tab)
    ? (tab as Tab)
    : "databases";
  return (
    <Page
      title="Troubleshooting"
      description="What this deployment holds at Cloudflare right now: its databases and the builder's containers."
      size="xl"
    >
      <Card>
        <Tabs
          value={shown}
          onChange={(value) => setTab(value ?? "databases")}
          keepMounted={false}
        >
          <Tabs.List mb="md">
            <Tabs.Tab value="databases">Databases</Tabs.Tab>
            <Tabs.Tab value="containers">Containers</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="databases">
            <DatabasesTab />
          </Tabs.Panel>
          <Tabs.Panel value="containers">
            <ContainersTab />
          </Tabs.Panel>
        </Tabs>
      </Card>
    </Page>
  );
}
