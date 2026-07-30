import type {
  CreateRestaurantUserRole,
  ManagedUserRole,
  UserListItem,
} from '../../api/auth'

export const roleRank: Record<ManagedUserRole | 'PlatformOwner', number> = {
  PlatformOwner: 4,
  RestaurantOwner: 3,
  Admin: 2,
  Staff: 1,
  Customer: 0,
}

export const creatableRoles = [
  'RestaurantOwner',
  'Admin',
  'Staff',
] as const satisfies readonly CreateRestaurantUserRole[]

export const userRoleLabels: Record<ManagedUserRole | 'PlatformOwner', string> = {
  PlatformOwner: 'Platform owner',
  RestaurantOwner: 'Restaurant owner',
  Admin: 'Administrator',
  Staff: 'Staff',
  Customer: 'Customer',
}

export function canManageUser(
  targetUser: UserListItem,
  currentUserId: string | undefined,
  currentUserRank: number,
) {
  const targetRank = Math.max(
    -1,
    ...targetUser.roles.map((role) => roleRank[role as keyof typeof roleRank] ?? -1),
  )

  return targetUser.id !== currentUserId && targetRank < currentUserRank
}
