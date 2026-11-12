import { Tabs } from "@mantine/core";
import { Card } from "@frontend/ds/Card";
import { Page } from "@frontend/ds/Page";
import { useTab } from "../urlState";
import { BranchesTab } from "../widgets/BranchesTab";
import { ContainersTab } from "../widgets/ContainersTab";
import { DatabasesTab } from "../widgets/DatabasesTab";
import { MergesTab } from "../widgets/MergesTab";

const TABS = ["databases", "containers", "branches", "merges"] as const;
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
      description="What this deployment holds right now: its databases, the builder's containers, every branch with updates from the repository it was released from, and the merges that can be reverted."
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
            <Tabs.Tab value="branches">Branches</Tabs.Tab>
            <Tabs.Tab value="merges">Merges</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="databases">
            <DatabasesTab />
          </Tabs.Panel>
          <Tabs.Panel value="containers">
            <ContainersTab />
          </Tabs.Panel>
          <Tabs.Panel value="branches">
            <BranchesTab />
          </Tabs.Panel>
          <Tabs.Panel value="merges">
            <MergesTab />
          </Tabs.Panel>
        </Tabs>
      </Card>
    </Page>
  );
}
