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

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

/**
 * Primary navigation surfaced in the sidebar / mobile drawer.
 *
 * Each entry must correspond to an `app/(dashboard)/<segment>/page.tsx`
 * placeholder; routes are also pre-cleared by `lib/auth.config`'s
 * `PROTECTED_PREFIXES` list.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Overview', icon: BarChart3 },
  { href: '/sites', label: 'Sites', icon: Globe },
  { href: '/traffic', label: 'Traffic', icon: Activity },
  { href: '/revenue', label: 'Revenue', icon: CircleDollarSign },
  { href: '/roi', label: 'ROI', icon: TrendingUp },
  { href: '/domains', label: 'Domains', icon: ServerCog },
  { href: '/deployments', label: 'Deployments', icon: Rocket },
  { href: '/errors', label: 'Errors', icon: Bug },
  { href: '/alerts', label: 'Alerts', icon: AlertTriangle },
  { href: '/integrations', label: 'Integrations', icon: PlugZap },
  { href: '/settings', label: 'Settings', icon: Settings },
];
