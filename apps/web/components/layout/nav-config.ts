import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bug,
  CircleDollarSign,
  Globe,
  type LucideIcon,
  PlugZap,
  Rocket,
  Settings,
  ServerCog,
  TrendingUp,
} from 'lucide-react';

/** i18n key under the `nav` namespace, e.g. `messages.nav.overview`. */
export type NavKey =
  | 'overview'
  | 'sites'
  | 'traffic'
  | 'revenue'
  | 'roi'
  | 'domains'
  | 'deployments'
  | 'errors'
  | 'alerts'
  | 'integrations'
  | 'settings';

export type NavItem = {
  href: string;
  /** Translation key — resolved at render time via `useTranslations('nav')`. */
  key: NavKey;
  icon: LucideIcon;
};

/**
 * Primary navigation surfaced in the sidebar / mobile drawer.
 *
 * Each entry must correspond to an `app/(dashboard)/<segment>/page.tsx`
 * placeholder; routes are also pre-cleared by `lib/auth.config`'s
 * `PROTECTED_PREFIXES` list.
 *
 * Labels are i18n keys (resolved by callers), not hardcoded strings — see
 * `messages/<locale>.json` under the `nav` namespace.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', key: 'overview', icon: BarChart3 },
  { href: '/sites', key: 'sites', icon: Globe },
  { href: '/traffic', key: 'traffic', icon: Activity },
  { href: '/revenue', key: 'revenue', icon: CircleDollarSign },
  { href: '/roi', key: 'roi', icon: TrendingUp },
  { href: '/domains', key: 'domains', icon: ServerCog },
  { href: '/deployments', key: 'deployments', icon: Rocket },
  { href: '/errors', key: 'errors', icon: Bug },
  { href: '/alerts', key: 'alerts', icon: AlertTriangle },
  { href: '/integrations', key: 'integrations', icon: PlugZap },
  { href: '/settings', key: 'settings', icon: Settings },
];
