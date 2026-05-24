import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bot,
  Bug,
  CircleDollarSign,
  Globe,
  KeyRound,
  ListChecks,
  type LucideIcon,
  PlugZap,
  Rocket,
  Settings,
  ServerCog,
  TrendingUp,
  Users,
  Webhook,
} from 'lucide-react';

// Narrow subpath import — see `sidebar.tsx` for the rationale.
import type { Permission } from '@siteops/shared/constants';

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
  | 'agentRuns'
  | 'tasks'
  | 'webhooks'
  | 'apiKeys'
  | 'users'
  | 'settings';

export type NavItem = {
  href: string;
  /** Translation key — resolved at render time via `useTranslations('nav')`. */
  key: NavKey;
  icon: LucideIcon;
  /**
   * RBAC gate (T40). When set, the entry is hidden from users whose role
   * does not have this permission. Items with no `permission` are shown to
   * every authenticated session.
   */
  permission?: Permission;
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
  { href: '/agent-runs', key: 'agentRuns', icon: Bot },
  { href: '/tasks', key: 'tasks', icon: ListChecks },
  { href: '/webhooks', key: 'webhooks', icon: Webhook },
  { href: '/settings/api-keys', key: 'apiKeys', icon: KeyRound, permission: 'api_keys.read' },
  { href: '/settings/users', key: 'users', icon: Users, permission: 'users.read' },
  { href: '/settings', key: 'settings', icon: Settings, permission: 'settings.read' },
];
