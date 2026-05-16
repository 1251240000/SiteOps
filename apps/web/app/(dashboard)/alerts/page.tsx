import { getTranslations } from 'next-intl/server';

import { PageHeader } from '@/components/common/page-header';
import { AlertList } from '@/components/alerts/AlertList';
import { ChannelEditor } from '@/components/alerts/ChannelEditor';
import { RuleEditor } from '@/components/alerts/RuleEditor';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export const dynamic = 'force-dynamic';

export default async function AlertsPage() {
  const t = await getTranslations('pages.alerts');
  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('description')} />
      <Tabs defaultValue="history">
        <TabsList>
          <TabsTrigger value="history">{t('tabHistory')}</TabsTrigger>
          <TabsTrigger value="rules">{t('tabRules')}</TabsTrigger>
          <TabsTrigger value="channels">{t('tabChannels')}</TabsTrigger>
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
