export function getTrackerScriptUrl(appOrigin: string): string {
  return new URL('/tracker.js', appOrigin).toString();
}

export function buildAnalyticsInstallSnippet({
  appOrigin,
  publicAnalyticsKey,
}: {
  appOrigin: string;
  publicAnalyticsKey: string;
  siteId?: string;
}): string {
  return [
    '<script',
    '  async',
    `  src="${getTrackerScriptUrl(appOrigin)}"`,
    `  data-site-key="${publicAnalyticsKey}"`,
    '></script>',
  ].join('\n');
}
