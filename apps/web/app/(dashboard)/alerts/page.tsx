import { PageHeader } from '@/components/common/page-header';
import { AlertList } from '@/components/alerts/AlertList';
import { ChannelEditor } from '@/components/alerts/ChannelEditor';
import { RuleEditor } from '@/components/alerts/RuleEditor';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export const dynamic = 'force-dynamic';

export default function AlertsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Alerts"
        description="Rules evaluate every metric; channels send the notification. Channel configs are encrypted at rest (AES-256-GCM)."
      />
      <Tabs defaultValue="history">
        <TabsList>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="rules">Rules</TabsTrigger>
          <TabsTrigger value="channels">Channels</TabsTrigger>
        </TabsList>
        <TabsContent value="history" className="mt-4">
          <AlertList />
        </TabsContent>
        <TabsContent value="rules" className="mt-4">
          <RuleEditor />
        </TabsContent>
        <TabsContent value="channels" className="mt-4">
          <ChannelEditor />
        </TabsContent>
      </Tabs>
    </div>
  );
}
