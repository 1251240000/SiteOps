import { analyticsRepo, type Db } from '@siteops/db';

export const analyticsAggregateService = {
  getSiteOverview(db: Db, siteId: string, range: { from: string; to: string }) {
    return analyticsRepo.getOverview(db, siteId, {
      from: `${range.from}T00:00:00.000Z`,
      to: `${range.to}T23:59:59.999Z`,
    });
  },
};
