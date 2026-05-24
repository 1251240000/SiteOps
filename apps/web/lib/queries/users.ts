/**
 * React-Query keys + wire types for the team members (users) settings page.
 */
export type UserRole = 'admin' | 'operator' | 'viewer';
export type UserStatus = 'active' | 'suspended';

export type UserRow = {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  status: UserStatus;
  invitedBy: string | null;
  invitedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InvitationResponse = {
  invitation: {
    id: string;
    email: string;
    role: string;
    expiresAt: string;
  };
  inviteUrl: string;
};

export const usersKeys = {
  all: ['users'] as const,
  lists: () => [...usersKeys.all, 'list'] as const,
  list: (filters: { role?: string; status?: string }) => [...usersKeys.lists(), filters] as const,
};
