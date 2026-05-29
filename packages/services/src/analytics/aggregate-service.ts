import { analyticsRepo, type Db } from '@siteops/db';

function toInclusiveTo(date: string): Date {
  return new Date(`${date}T23:59:59.999Z`);
}

export const analyticsAggregateService = {
  getSiteOverview(db: Db, siteId: string, range: { from: string; to: string }) {
    return analyticsRepo.getOverview(db, siteId, {
      from: new Date(`${range.from}T00:00:00.000Z`),
      to: toInclusiveTo(range.to),
    });
  },
};
