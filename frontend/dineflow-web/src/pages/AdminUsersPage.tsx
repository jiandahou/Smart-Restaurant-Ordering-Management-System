import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownAZ,
  ArrowUpAZ,
  Building2,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Mail,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  UserPlus,
  UsersRound,
  X,
} from 'lucide-react'
import { motion } from 'motion/react'
import { toast } from 'sonner'
import { useSearchParams } from 'react-router-dom'
import {
  getRestaurantUserPage,
  getRestaurantUsers,
  getRestaurants,
  updateUser,
  updateUserStatus,
  type ManagedUserRole,
  type Restaurant,
  type UserListItem,
} from '../api/auth'
import { useAuth } from '../auth/AuthContext'
import {
  CreateUserCard,
  CreateUserDialog,
} from '../components/admin/CreateUserCard'
import { EmailTestCard } from '../components/admin/EmailTestCard'
import { UserRowActions } from '../components/admin/UserRowActions'
import {
  canManageUser,
  creatableRoles,
  roleRank,
  userRoleLabels,
} from '../components/admin/userRoles'
import { Badge } from '../components/ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../components/ui/alert-dialog'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'

type SortKey = 'name' | 'email' | 'restaurant' | 'roles' | 'created'
type SortDirection = 'asc' | 'desc'
type ScopeFilter = 'all' | 'platform' | 'restaurant'
type AudienceFilter = 'staff' | 'customers' | 'all'
type StatusFilter = 'all' | 'active' | 'disabled' | 'locked' | 'unverified' | 'mfa'
type UserSection = 'users' | 'create' | 'email'
const manageableRoles = ['RestaurantOwner', 'Admin', 'Staff', 'Customer'] as const satisfies readonly ManagedUserRole[]
const userSections = ['users', 'create', 'email'] as const satisfies readonly UserSection[]
const roleOptions = ['PlatformOwner', 'RestaurantOwner', 'Admin', 'Staff', 'Customer'] as const
const sortKeys = ['name', 'email', 'restaurant', 'roles', 'created'] as const satisfies readonly SortKey[]
const scopeFilters = ['all', 'platform', 'restaurant'] as const satisfies readonly ScopeFilter[]
const audienceFilters = ['staff', 'customers', 'all'] as const satisfies readonly AudienceFilter[]
const statusFilters = ['all', 'active', 'disabled', 'locked', 'unverified', 'mfa'] as const satisfies readonly StatusFilter[]
const pageSizes = [10, 20, 50] as const
const searchDebounceMs = 250

function getUserSection(value: string | null): UserSection {
  return userSections.includes(value as UserSection) ? (value as UserSection) : 'users'
}

function getArrayValue<T extends string>(value: string | null, values: readonly T[], fallback: T): T {
  return values.includes(value as T) ? (value as T) : fallback
}

function getPositiveInteger(value: string | null, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function getPageSize(value: string | null) {
  const parsed = Number(value)
  return pageSizes.includes(parsed as (typeof pageSizes)[number]) ? parsed : 10
}

function getUserLocale() {
  return document.documentElement.lang || 'en'
}

function formatUserDate(value: string | null | undefined, includeTime = false) {
  if (!value) {
    return 'Never'
  }

  return new Intl.DateTimeFormat(getUserLocale(), {
    dateStyle: 'medium',
    ...(includeTime ? { timeStyle: 'short' as const } : {}),
  }).format(new Date(value))
}

/**
 * Account state at a glance. A disabled account and one temporarily locked out by failed sign-ins
 * both block login but need different fixes, so they never share a badge.
 */
function UserStatusBadges({ user }: { user: UserListItem }) {
  return (
    <div className="badge-row user-status-badges">
      {user.isDisabled ? (
        <Badge variant="destructive" title="An admin disabled this account">Disabled</Badge>
      ) : user.isLockedOut ? (
        <Badge variant="destructive" title={`Locked after ${user.accessFailedCount} failed sign-ins`}>
          Locked
        </Badge>
      ) : (
        <Badge variant="secondary">Active</Badge>
      )}
      {!user.emailConfirmed && (
        <Badge variant="outline" title="This user has not confirmed their email address">
          Unverified
        </Badge>
      )}
      {user.twoFactorEnabled && <Badge variant="outline" title="Two-factor authentication is on">MFA</Badge>}
    </div>
  )
}

export function AdminUsersPage() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeSection = getUserSection(searchParams.get('section'))
  const urlSearch = searchParams.get('q')?.trim() ?? ''
  const roleFilter = roleOptions.includes(searchParams.get('role') as (typeof roleOptions)[number])
    ? searchParams.get('role')!
    : 'all'
  const restaurantFilter = searchParams.get('restaurant') || 'all'
  const scopeFilter = getArrayValue(searchParams.get('scope'), scopeFilters, 'all')
  const audienceFilter = getArrayValue(searchParams.get('audience'), audienceFilters, 'staff')
  const statusFilter = getArrayValue(searchParams.get('status'), statusFilters, 'all')
  const page = getPositiveInteger(searchParams.get('page'), 1)
  const pageSize = getPageSize(searchParams.get('pageSize'))
  const sort: { key: SortKey; direction: SortDirection } = {
    key: getArrayValue(searchParams.get('sort'), sortKeys, 'email'),
    direction: searchParams.get('direction') === 'desc' ? 'desc' : 'asc',
  }
  const [users, setUsers] = useState<UserListItem[]>([])
  const [emailUsers, setEmailUsers] = useState<UserListItem[]>([])
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [initialLoading, setInitialLoading] = useState(true)
  const [isFetching, setIsFetching] = useState(false)
  const [optionsLoading, setOptionsLoading] = useState(true)
  const [optionsError, setOptionsError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState(urlSearch)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkDisableOpen, setBulkDisableOpen] = useState(false)
  // Guards against an earlier response landing after a later one and overwriting it.
  const requestIdRef = useRef(0)
  const selectAllRef = useRef<HTMLInputElement>(null)
  const mobileSelectAllRef = useRef<HTMLInputElement>(null)
  const committedSearchRef = useRef<string | null>(null)
  const [totalItems, setTotalItems] = useState(0)
  const [totalPages, setTotalPages] = useState(0)

  const updateDirectoryParams = useCallback((
    updates: Record<string, string | null>,
    replace = false,
  ) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current)

      Object.entries(updates).forEach(([key, value]) => {
        if (value === null || value === '') {
          next.delete(key)
        } else {
          next.set(key, value)
        }
      })

      return next
    }, { replace })
  }, [setSearchParams])

  const currentUserRank = useMemo(() => {
    return Math.max(0, ...(user?.roles.map((role) => roleRank[role as keyof typeof roleRank] ?? 0) ?? []))
  }, [user])

  const availableRoles = useMemo(() => {
    return creatableRoles.filter((role) => roleRank[role] < currentUserRank)
  }, [currentUserRank])

  const manageableRoleOptions = useMemo(() => {
    return manageableRoles.filter((role) => roleRank[role] < currentUserRank)
  }, [currentUserRank])

  const needsRestaurantId = user?.roles.includes('PlatformOwner') ?? false
  const isPlatformOwner = user?.roles.includes('PlatformOwner') ?? false

  const pageStart = totalItems === 0 ? 0 : (page - 1) * pageSize + 1
  const pageEnd = Math.min(page * pageSize, totalItems)
  const restaurantNameById = useMemo(
    () => new Map(restaurants.map((restaurant) => [restaurant.id, restaurant.name])),
    [restaurants],
  )

  const hasActiveFilters =
    search.trim() !== '' ||
    roleFilter !== 'all' ||
    restaurantFilter !== 'all' ||
    scopeFilter !== 'all' ||
    audienceFilter !== 'staff' ||
    statusFilter !== 'all'

  const loadUsers = useCallback(async (showToast = false) => {
    const requestId = ++requestIdRef.current
    setIsFetching(true)
    setError(null)

    try {
      const response = await getRestaurantUserPage({
        page,
        pageSize,
        search: urlSearch || undefined,
        sortBy: sort.key === 'name'
          ? 'fullName'
          : sort.key === 'roles'
            ? 'role'
            : sort.key === 'created'
              ? 'createdAt'
              : sort.key,
        sortDirection: sort.direction,
        role: roleFilter === 'all' ? undefined : roleFilter,
        restaurantId: restaurantFilter === 'all' ? undefined : restaurantFilter,
        scope: scopeFilter,
        audience: audienceFilter,
        status: statusFilter,
      })

      // A slower earlier request must not clobber the newest result.
      if (requestId !== requestIdRef.current) {
        return
      }

      setUsers(response.items)
      setTotalItems(response.totalItems)
      setTotalPages(response.totalPages)

      if (response.totalPages > 0 && page > response.totalPages) {
        updateDirectoryParams({
          page: response.totalPages === 1 ? null : String(response.totalPages),
        }, true)
      }
      if (showToast) {
        toast.success('User directory refreshed')
      }
    } catch (loadError) {
      if (requestId !== requestIdRef.current) {
        return
      }

      const message = loadError instanceof Error ? loadError.message : 'Failed to load users'
      setError(message)
      toast.error('Could not load users', {
        description: message,
      })
    } finally {
      if (requestId === requestIdRef.current) {
        setInitialLoading(false)
        setIsFetching(false)
      }
    }
  }, [
    audienceFilter,
    page,
    pageSize,
    restaurantFilter,
    roleFilter,
    scopeFilter,
    sort.direction,
    sort.key,
    statusFilter,
    updateDirectoryParams,
    urlSearch,
  ])

  const loadUserOptions = useCallback(async (showToast = false) => {
    setOptionsLoading(true)
    setOptionsError(null)
    const [allUsersResult, restaurantsResult] = await Promise.allSettled([
      getRestaurantUsers(),
      getRestaurants(),
    ])

    if (allUsersResult.status === 'fulfilled') {
      setEmailUsers(allUsersResult.value)
    }
    if (restaurantsResult.status === 'fulfilled') {
      setRestaurants(restaurantsResult.value)
    }

    const failures = [allUsersResult, restaurantsResult]
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')

    if (failures.length > 0) {
      const message = failures
        .map((failure) => failure.reason instanceof Error ? failure.reason.message : 'Request failed')
        .filter((value, index, values) => values.indexOf(value) === index)
        .join(' ')
      setOptionsError(message)
      if (showToast) {
        toast.error('Could not refresh user options', { description: message })
      }
    }
    setOptionsLoading(false)
  }, [])

  // The URL is the source of truth for refresh/share/back navigation; the text input remains local
  // while typing and commits after a short debounce.
  useEffect(() => {
    if (committedSearchRef.current === urlSearch) {
      committedSearchRef.current = null
      return
    }

    setSearch(urlSearch)
  }, [urlSearch])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const nextSearch = search.trim()
      if (nextSearch !== urlSearch) {
        committedSearchRef.current = nextSearch
        updateDirectoryParams({
          q: nextSearch || null,
          page: null,
        }, true)
      }
    }, searchDebounceMs)

    return () => window.clearTimeout(timer)
  }, [search, updateDirectoryParams, urlSearch])

  useEffect(() => {
    void Promise.resolve().then(() => loadUsers())
  }, [loadUsers])

  useEffect(() => {
    void Promise.resolve().then(() => loadUserOptions())
  }, [loadUserOptions])

  useEffect(() => {
    void Promise.resolve().then(() => setSelectedIds([]))
  }, [
    audienceFilter,
    page,
    pageSize,
    restaurantFilter,
    roleFilter,
    scopeFilter,
    sort.direction,
    sort.key,
    statusFilter,
    urlSearch,
  ])

  const updateSort = (key: SortKey) => {
    const direction = sort.key === key && sort.direction === 'asc' ? 'desc' : 'asc'
    updateDirectoryParams({
      page: null,
      sort: key === 'email' ? null : key,
      direction: direction === 'asc' ? null : direction,
    })
  }

  const resetFilters = () => {
    setSearch('')
    updateDirectoryParams({
      page: null,
      q: null,
      role: null,
      restaurant: null,
      scope: null,
      audience: null,
      status: null,
    })
  }

  const selectedUsers = users.filter((directoryUser) => selectedIds.includes(directoryUser.id))
  const manageableSelection = selectedUsers.filter((directoryUser) =>
    canManageUser(directoryUser, user?.id, currentUserRank))
  const manageableUsersOnPage = users.filter((directoryUser) =>
    canManageUser(directoryUser, user?.id, currentUserRank))
  const allManageableSelected =
    manageableUsersOnPage.length > 0 &&
    manageableUsersOnPage.every((directoryUser) => selectedIds.includes(directoryUser.id))
  const someManageableSelected = manageableUsersOnPage.some((directoryUser) =>
    selectedIds.includes(directoryUser.id))

  useEffect(() => {
    const indeterminate = someManageableSelected && !allManageableSelected
    if (selectAllRef.current) selectAllRef.current.indeterminate = indeterminate
    if (mobileSelectAllRef.current) mobileSelectAllRef.current.indeterminate = indeterminate
  }, [allManageableSelected, someManageableSelected])

  const toggleSelection = (userId: string) => {
    setSelectedIds((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId],
    )
  }

  const togglePageSelection = () => {
    const pageIds = manageableUsersOnPage.map((directoryUser) => directoryUser.id)
    setSelectedIds((current) => allManageableSelected
      ? current.filter((id) => !pageIds.includes(id))
      : [...new Set([...current, ...pageIds])])
  }

  /** Runs one admin action across the selection, reporting how many actually went through. */
  const runBulkAction = async (
    label: string,
    action: (directoryUser: UserListItem) => Promise<unknown>,
  ) => {
    if (manageableSelection.length === 0) {
      return
    }

    setBulkBusy(true)

    try {
      const results = await Promise.allSettled(manageableSelection.map(action))
      const failed = results.filter((result) => result.status === 'rejected').length

      if (failed > 0) {
        toast.warning(`${label}: ${results.length - failed} of ${results.length} succeeded`, {
          description: 'Some accounts could not be changed. Refresh to see the current state.',
        })
      } else {
        toast.success(`${label}: ${results.length} account${results.length === 1 ? '' : 's'} updated`)
      }

      setSelectedIds([])
      await refreshUserData()
    } finally {
      setBulkBusy(false)
    }
  }

  const updateRestaurantFilter = (value: string) => {
    updateDirectoryParams({
      page: null,
      restaurant: value === 'all' ? null : value,
      scope: value === 'all'
        ? (scopeFilter === 'platform' ? 'platform' : null)
        : 'restaurant',
    })
  }

  const SortIcon = sort.direction === 'asc' ? ArrowDownAZ : ArrowUpAZ
  const getAriaSort = (key: SortKey): 'ascending' | 'descending' | 'none' =>
    sort.key === key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'
  const refreshUserData = async () => {
    await Promise.all([loadUsers(), loadUserOptions()])
  }
  const createUserProps = {
    availableRoles,
    currentUserRank,
    needsRestaurantId,
    restaurantId: user?.restaurantId,
    restaurants,
    restaurantsLoading: optionsLoading,
    restaurantLoadError: optionsError,
    onUserCreated: refreshUserData,
  }
  const getRestaurantLabel = (restaurantId?: string | null) => {
    if (!restaurantId) {
      return 'Platform scope'
    }

    return restaurantNameById.get(restaurantId) ?? `Unknown restaurant (${restaurantId.slice(0, 8)}…)`
  }
  const activeDropdownFilterCount = [
    roleFilter !== 'all',
    restaurantFilter !== 'all',
    scopeFilter !== 'all',
    statusFilter !== 'all',
  ].filter(Boolean).length
  const selectedRestaurantFilterLabel = restaurantFilter === 'all' ? '' : getRestaurantLabel(restaurantFilter)
  const selectedScopeFilterLabel =
    scopeFilter === 'platform' ? 'Platform scope' : scopeFilter === 'restaurant' ? 'Restaurant scope' : ''
  const selectedStatusFilterLabel =
    statusFilter === 'all' ? '' : statusFilter === 'mfa' ? 'MFA enabled' : `${statusFilter[0].toUpperCase()}${statusFilter.slice(1)}`

  const setActiveSection = (value: string) => {
    const section = getUserSection(value)
    updateDirectoryParams({ section: section === 'users' ? null : section }, true)
  }

  return (
    <main className="content-grid">
      <h1 className="admin-users-page-heading">User management</h1>
      <Tabs value={activeSection} onValueChange={setActiveSection} orientation="horizontal" className="admin-tabs">
        <TabsList className="admin-tabs-list" aria-label="Admin sections">
          <TabsTrigger value="users">
            <UsersRound size={16} />
            <span>Users</span>
          </TabsTrigger>
          <TabsTrigger value="create">
            <UserPlus size={16} />
            <span>Create</span>
          </TabsTrigger>
          <TabsTrigger value="email">
            <Mail size={16} />
            <span>Email</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="users">
          <Card>
            <CardHeader className="section-header">
              <div>
                <CardTitle>Admin User Center</CardTitle>
                <CardDescription>User directory for the permitted scope.</CardDescription>
              </div>
              <div className="section-actions">
                <CreateUserDialog {...createUserProps} />
                <Button type="button" variant="secondary" onClick={() => void loadUsers(true)} disabled={isFetching}>
                  <RefreshCw size={18} className={isFetching ? 'spinner' : undefined} />
                  {isFetching ? 'Refreshing' : 'Refresh'}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {error && <p className="form-error">{error}</p>}
              {optionsError && (
                <div className="user-options-error" role="alert">
                  <span>Some supporting user and restaurant options could not be loaded. {optionsError}</span>
                  <Button type="button" variant="outline" size="sm" onClick={() => void loadUserOptions(true)}>
                    Retry
                  </Button>
                </div>
              )}
              <div className="directory-stack user-directory-stack" aria-busy={isFetching}>
                {isFetching && !initialLoading && (
                  <motion.div
                    className="user-directory-fetch-status"
                    role="status"
                    aria-live="polite"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    <RefreshCw size={14} className="spinner" />
                    Updating directory…
                  </motion.div>
                )}
                  <div className="directory-tools user-directory-tools">
                    <div className="user-directory-search-row">
                      <div className="directory-search">
                        <Search size={16} />
                        <Input
                          aria-label="Search users"
                          value={search}
                          onChange={(event) => setSearch(event.target.value)}
                          placeholder="Filter by name, email, or role"
                        />
                      </div>
                      <div className="user-audience-filter" role="group" aria-label="Directory audience">
                        {([
                          { value: 'staff', label: 'Staff' },
                          { value: 'customers', label: 'Customers' },
                          { value: 'all', label: 'All' },
                        ] as const).map((option) => (
                          <Button
                            key={option.value}
                            type="button"
                            size="sm"
                            variant={audienceFilter === option.value ? 'default' : 'outline'}
                            aria-pressed={audienceFilter === option.value}
                            onClick={() => updateDirectoryParams({
                              page: null,
                              audience: option.value === 'staff' ? null : option.value,
                            })}
                          >
                            {option.label}
                          </Button>
                        ))}
                      </div>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="user-directory-filter-trigger"
                            aria-label="Filter users"
                          >
                            <SlidersHorizontal size={16} />
                            {activeDropdownFilterCount > 0 && (
                              <span className="user-directory-filter-count">{activeDropdownFilterCount}</span>
                            )}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="user-directory-filter-popover" align="end">
                          <div className="user-directory-filter-popover-header">
                            <strong>Filters</strong>
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              onClick={resetFilters}
                              disabled={!hasActiveFilters}
                            >
                              <X size={13} />
                              Clear all
                            </Button>
                          </div>
                          <div className="user-directory-filter-fields">
                            <div className="user-directory-filter-field">
                              <span>Role</span>
                              <Select
                                value={roleFilter}
                                onValueChange={(value) => updateDirectoryParams({
                                  page: null,
                                  role: value === 'all' ? null : value,
                                })}
                              >
                                <SelectTrigger className="filter-select" aria-label="Filter by role">
                                  <SelectValue placeholder="Role" />
                                </SelectTrigger>
                                <SelectContent position="popper">
                                  <SelectItem value="all">All roles</SelectItem>
                                  {roleOptions.map((role) => (
                                    <SelectItem key={role} value={role}>
                                      {userRoleLabels[role]}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="user-directory-filter-field">
                              <span>Restaurant</span>
                              <Select value={restaurantFilter} onValueChange={updateRestaurantFilter}>
                                <SelectTrigger className="filter-select" aria-label="Filter by restaurant">
                                  <SelectValue placeholder="Restaurant" />
                                </SelectTrigger>
                                <SelectContent position="popper">
                                  <SelectItem value="all">All restaurants</SelectItem>
                                  {restaurants.map((restaurant) => (
                                    <SelectItem key={restaurant.id} value={restaurant.id}>
                                      {restaurant.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="user-directory-filter-field">
                              <span>Scope</span>
                              <Select
                                value={scopeFilter}
                                onValueChange={(value) => updateDirectoryParams({
                                  page: null,
                                  scope: value === 'all' ? null : value,
                                })}
                              >
                                <SelectTrigger className="filter-select" aria-label="Filter by scope">
                                  <SelectValue placeholder="Scope" />
                                </SelectTrigger>
                                <SelectContent position="popper">
                                  <SelectItem value="all">All scopes</SelectItem>
                                  <SelectItem value="platform">Platform scope</SelectItem>
                                  <SelectItem value="restaurant">Restaurant scope</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="user-directory-filter-field">
                              <span>Status</span>
                              <Select
                                value={statusFilter}
                                onValueChange={(value) => updateDirectoryParams({
                                  page: null,
                                  status: value === 'all' ? null : value,
                                })}
                              >
                                <SelectTrigger className="filter-select" aria-label="Filter by account status">
                                  <SelectValue placeholder="Status" />
                                </SelectTrigger>
                                <SelectContent position="popper">
                                  <SelectItem value="all">All statuses</SelectItem>
                                  <SelectItem value="active">Active</SelectItem>
                                  <SelectItem value="disabled">Disabled</SelectItem>
                                  <SelectItem value="locked">Locked</SelectItem>
                                  <SelectItem value="unverified">Unverified</SelectItem>
                                  <SelectItem value="mfa">MFA enabled</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>

                    <div className="user-directory-inline-filters">
                      <Select
                        value={roleFilter}
                        onValueChange={(value) => updateDirectoryParams({
                          page: null,
                          role: value === 'all' ? null : value,
                        })}
                      >
                        <SelectTrigger className="filter-select" aria-label="Filter by role">
                          <SelectValue placeholder="Role" />
                        </SelectTrigger>
                        <SelectContent position="popper">
                          <SelectItem value="all">All roles</SelectItem>
                          {roleOptions.map((role) => (
                            <SelectItem key={role} value={role}>
                              {userRoleLabels[role]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select value={restaurantFilter} onValueChange={updateRestaurantFilter}>
                        <SelectTrigger className="filter-select" aria-label="Filter by restaurant">
                          <SelectValue placeholder="Restaurant" />
                        </SelectTrigger>
                        <SelectContent position="popper">
                          <SelectItem value="all">All restaurants</SelectItem>
                          {restaurants.map((restaurant) => (
                            <SelectItem key={restaurant.id} value={restaurant.id}>
                              {restaurant.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={scopeFilter}
                        onValueChange={(value) => updateDirectoryParams({
                          page: null,
                          scope: value === 'all' ? null : value,
                        })}
                      >
                        <SelectTrigger className="filter-select" aria-label="Filter by scope">
                          <SelectValue placeholder="Scope" />
                        </SelectTrigger>
                        <SelectContent position="popper">
                          <SelectItem value="all">All scopes</SelectItem>
                          <SelectItem value="platform">Platform scope</SelectItem>
                          <SelectItem value="restaurant">Restaurant scope</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select
                        value={statusFilter}
                        onValueChange={(value) => updateDirectoryParams({
                          page: null,
                          status: value === 'all' ? null : value,
                        })}
                      >
                        <SelectTrigger className="filter-select" aria-label="Filter by account status">
                          <SelectValue placeholder="Status" />
                        </SelectTrigger>
                        <SelectContent position="popper">
                          <SelectItem value="all">All statuses</SelectItem>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="disabled">Disabled</SelectItem>
                          <SelectItem value="locked">Locked</SelectItem>
                          <SelectItem value="unverified">Unverified</SelectItem>
                          <SelectItem value="mfa">MFA enabled</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={resetFilters}
                        disabled={!hasActiveFilters}
                        className="directory-clear-filter"
                        title="Clear filters"
                        aria-label="Clear filters"
                      >
                        <X size={16} />
                        <span>Clear</span>
                      </Button>
                    </div>

                    {hasActiveFilters && (
                      <div className="user-filter-chips" aria-label="Active filters">
                        {search.trim() && (
                          <button
                            type="button"
                            className="user-filter-chip"
                            onClick={() => {
                              setSearch('')
                              updateDirectoryParams({ page: null, q: null })
                            }}
                            title={`Search: ${search.trim()}`}
                          >
                            <span>Search: {search.trim()}</span>
                            <X size={13} />
                          </button>
                        )}
                        {roleFilter !== 'all' && (
                          <button
                            type="button"
                            className="user-filter-chip"
                            onClick={() => updateDirectoryParams({ page: null, role: null })}
                            title={`Role: ${userRoleLabels[roleFilter as keyof typeof userRoleLabels]}`}
                          >
                            <span>Role: {userRoleLabels[roleFilter as keyof typeof userRoleLabels]}</span>
                            <X size={13} />
                          </button>
                        )}
                        {restaurantFilter !== 'all' && (
                          <button
                            type="button"
                            className="user-filter-chip"
                            onClick={() => updateRestaurantFilter('all')}
                            title={`Restaurant: ${selectedRestaurantFilterLabel}`}
                          >
                            <span>Restaurant: {selectedRestaurantFilterLabel}</span>
                            <X size={13} />
                          </button>
                        )}
                        {scopeFilter !== 'all' && (
                          <button
                            type="button"
                            className="user-filter-chip"
                            onClick={() => updateDirectoryParams({ page: null, scope: null })}
                            title={`Scope: ${selectedScopeFilterLabel}`}
                          >
                            <span>Scope: {selectedScopeFilterLabel}</span>
                            <X size={13} />
                          </button>
                        )}
                        {statusFilter !== 'all' && (
                          <button
                            type="button"
                            className="user-filter-chip"
                            onClick={() => updateDirectoryParams({ page: null, status: null })}
                            title={`Status: ${selectedStatusFilterLabel}`}
                          >
                            <span>Status: {selectedStatusFilterLabel}</span>
                            <X size={13} />
                          </button>
                        )}
                        {audienceFilter !== 'staff' && (
                          <button
                            type="button"
                            className="user-filter-chip"
                            onClick={() => updateDirectoryParams({ page: null, audience: null })}
                            title={`Audience: ${audienceFilter}`}
                          >
                            <span>Audience: {audienceFilter === 'all' ? 'All users' : 'Customers'}</span>
                            <X size={13} />
                          </button>
                        )}
                        <button type="button" className="user-filter-chip user-filter-chip-clear" onClick={resetFilters}>
                          <X size={13} />
                          <span>Clear all</span>
                        </button>
                      </div>
                    )}
                  </div>

                  {manageableSelection.length > 0 && (
                    <div className="user-bulk-bar" role="region" aria-label="Bulk actions">
                      <strong>{manageableSelection.length} selected</strong>
                      <Select
                        onValueChange={(role) => void runBulkAction(
                          `Role set to ${role}`,
                          (directoryUser) => updateUser(directoryUser.id, {
                            fullName: directoryUser.fullName ?? '',
                            email: directoryUser.email ?? '',
                            restaurantId: directoryUser.restaurantId ?? undefined,
                            role: role as ManagedUserRole,
                          }),
                        )}
                        disabled={bulkBusy}
                      >
                        <SelectTrigger className="user-bulk-role" aria-label="Change role for selected users">
                          <SelectValue placeholder="Change role" />
                        </SelectTrigger>
                        <SelectContent position="popper">
                          {manageableRoleOptions.map((role) => (
                            <SelectItem key={role} value={role}>{userRoleLabels[role]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={bulkBusy}
                        onClick={() => void runBulkAction('Enabled', (directoryUser) =>
                          updateUserStatus(directoryUser.id, false))}
                      >
                        Enable
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={bulkBusy}
                        onClick={() => setBulkDisableOpen(true)}
                      >
                        Disable
                      </Button>
                      <Button type="button" variant="ghost" size="sm" disabled={bulkBusy} onClick={() => setSelectedIds([])}>
                        Clear
                      </Button>
                    </div>
                  )}

                  <AlertDialog open={bulkDisableOpen} onOpenChange={setBulkDisableOpen}>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Disable {manageableSelection.length} selected account{manageableSelection.length === 1 ? '' : 's'}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          These users will be unable to sign in until an administrator enables them again.
                          Existing audit history will be preserved.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel disabled={bulkBusy}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          variant="destructive"
                          disabled={bulkBusy}
                          onClick={() => void runBulkAction(
                            'Disabled',
                            (directoryUser) => updateUserStatus(directoryUser.id, true),
                          )}
                        >
                          {bulkBusy ? 'Disabling' : 'Disable accounts'}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>

                  <div className="table-wrap user-directory-table-wrap">
                    <table className={`data-table${isFetching ? ' is-fetching' : ''}`}>
                      <caption className="admin-users-table-caption">
                        Users in the permitted administration scope
                      </caption>
                      <thead>
                        <tr>
                          <th aria-sort={getAriaSort('name')}>
                            <span className="user-name-header">
                              <input
                                ref={selectAllRef}
                                type="checkbox"
                                className="user-select-checkbox"
                                checked={allManageableSelected}
                                disabled={manageableUsersOnPage.length === 0}
                                aria-label="Select all manageable users on this page"
                                onChange={togglePageSelection}
                              />
                              <button type="button" className="sort-button" onClick={() => updateSort('name')}>
                                Name
                                {sort.key === 'name' && <SortIcon size={15} aria-hidden="true" />}
                              </button>
                            </span>
                          </th>
                          <th aria-sort={getAriaSort('email')}>
                            <button type="button" className="sort-button" onClick={() => updateSort('email')}>
                              Email
                              {sort.key === 'email' && <SortIcon size={15} aria-hidden="true" />}
                            </button>
                          </th>
                          <th aria-sort={getAriaSort('restaurant')}>
                            <button type="button" className="sort-button" onClick={() => updateSort('restaurant')}>
                              Restaurant
                              {sort.key === 'restaurant' && <SortIcon size={15} aria-hidden="true" />}
                            </button>
                          </th>
                          <th aria-sort={getAriaSort('roles')}>
                            <button type="button" className="sort-button" onClick={() => updateSort('roles')}>
                              Roles
                              {sort.key === 'roles' && <SortIcon size={15} aria-hidden="true" />}
                            </button>
                          </th>
                          <th>Status</th>
                          <th aria-sort={getAriaSort('created')}>
                            <button type="button" className="sort-button" onClick={() => updateSort('created')}>
                              Activity
                              {sort.key === 'created' && <SortIcon size={14} aria-hidden="true" />}
                            </button>
                          </th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* Selection toolbar lives above the table body via the bulk bar below. */}
                        {users.map((directoryUser) => {
                          const isSelf = directoryUser.id === user?.id
                          const manageable = canManageUser(directoryUser, user?.id, currentUserRank)

                          return (
                          <tr key={directoryUser.id} className={isSelf ? 'is-current-user' : undefined}>
                            <td>
                              <span className="table-name">
                                <input
                                  type="checkbox"
                                  className="user-select-checkbox"
                                  checked={selectedIds.includes(directoryUser.id)}
                                  disabled={!manageable}
                                  aria-label={`Select ${directoryUser.email ?? directoryUser.id}`}
                                  title={manageable ? undefined : 'You cannot manage this account'}
                                  onChange={() => toggleSelection(directoryUser.id)}
                                />
                                <UsersRound size={16} />
                                {directoryUser.fullName || 'Not set'}
                                {isSelf && <Badge variant="outline">You</Badge>}
                              </span>
                            </td>
                            <td>{directoryUser.email}</td>
                            <td>{getRestaurantLabel(directoryUser.restaurantId)}</td>
                            <td>
                              <div className="badge-row">
                                {directoryUser.roles.map((role) => (
                                  <Badge key={role}>
                                    {userRoleLabels[role as keyof typeof userRoleLabels] ?? role}
                                  </Badge>
                                ))}
                              </div>
                            </td>
                            <td>
                              <UserStatusBadges user={directoryUser} />
                            </td>
                            <td className="user-created-cell">
                              <span>Created {formatUserDate(directoryUser.createdAt)}</span>
                              <small>Last login {formatUserDate(directoryUser.lastLoginAt, true)}</small>
                            </td>
                            <td>
                              <UserRowActions
                                user={directoryUser}
                                currentUserId={user?.id}
                                currentUserRank={currentUserRank}
                                isPlatformOwner={isPlatformOwner}
                                availableRoles={manageableRoleOptions}
                                restaurants={restaurants}
                                onUsersChanged={refreshUserData}
                              />
                            </td>
                          </tr>
                          )
                        })}
                        {users.length === 0 && (
                          <tr>
                            <td colSpan={7} className="empty-cell">
                              {initialLoading
                                ? 'Loading users…'
                                : hasActiveFilters
                                ? 'No users match the current filters.'
                                : 'No users exist in this scope yet.'}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <label className="user-mobile-select-all">
                    <input
                      ref={mobileSelectAllRef}
                      type="checkbox"
                      className="user-select-checkbox"
                      checked={allManageableSelected}
                      disabled={manageableUsersOnPage.length === 0}
                      aria-label="Select all manageable users on this page"
                      onChange={togglePageSelection}
                    />
                    <span>
                      Select all manageable users on this page
                      <small>{manageableUsersOnPage.length} available</small>
                    </span>
                  </label>
                  <div className="user-mobile-list" aria-label="Users">
                    {users.map((directoryUser) => {
                      const emailLabel = directoryUser.email ?? 'No email'
                      const restaurantLabel = getRestaurantLabel(directoryUser.restaurantId)
                      const isSelf = directoryUser.id === user?.id
                      const manageable = canManageUser(directoryUser, user?.id, currentUserRank)

                      return (
                        <article className="user-mobile-card" key={directoryUser.id}>
                          <header className="user-mobile-card-header">
                            <span className="user-mobile-identity-control">
                              <input
                                type="checkbox"
                                className="user-select-checkbox"
                                checked={selectedIds.includes(directoryUser.id)}
                                disabled={!manageable}
                                aria-label={`Select ${emailLabel}`}
                                title={manageable ? undefined : 'You cannot manage this account'}
                                onChange={() => toggleSelection(directoryUser.id)}
                              />
                              <span className="user-mobile-avatar">
                                <UsersRound size={18} />
                              </span>
                            </span>
                            <div className="user-mobile-primary">
                              <strong title={directoryUser.fullName || 'Not set'}>
                                {directoryUser.fullName || 'Not set'}
                                {isSelf && <Badge variant="outline">You</Badge>}
                              </strong>
                              <span title={emailLabel}>{emailLabel}</span>
                            </div>
                            <div className="user-mobile-actions">
                              <UserRowActions
                                user={directoryUser}
                                currentUserId={user?.id}
                                currentUserRank={currentUserRank}
                                isPlatformOwner={isPlatformOwner}
                                availableRoles={manageableRoleOptions}
                                restaurants={restaurants}
                                onUsersChanged={refreshUserData}
                              />
                            </div>
                          </header>

                          <div className="user-mobile-meta-grid">
                            <div className="user-mobile-meta">
                              <Building2 size={15} />
                              <div>
                                <span>Restaurant</span>
                                <strong title={restaurantLabel}>{restaurantLabel}</strong>
                              </div>
                            </div>
                            <div className="user-mobile-meta">
                              <ShieldCheck size={15} />
                              <div>
                                <span>Roles</span>
                                <div className="badge-row user-mobile-role-row">
                                  {directoryUser.roles.map((role) => (
                                    <Badge key={role}>
                                      {userRoleLabels[role as keyof typeof userRoleLabels] ?? role}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            </div>
                            <div className="user-mobile-meta">
                              <ShieldCheck size={15} />
                              <div>
                                <span>Status</span>
                                <UserStatusBadges user={directoryUser} />
                              </div>
                            </div>
                            <div className="user-mobile-meta">
                              <CalendarDays size={15} />
                              <div>
                                <span>Activity</span>
                                <strong>Created {formatUserDate(directoryUser.createdAt)}</strong>
                                <small><Clock3 size={12} /> Last login {formatUserDate(directoryUser.lastLoginAt, true)}</small>
                              </div>
                            </div>
                          </div>
                        </article>
                      )
                    })}
                    {users.length === 0 && (
                      <div className="user-mobile-empty">
                        {initialLoading
                          ? 'Loading users…'
                          : hasActiveFilters
                            ? 'No users match the current filters.'
                            : 'No users exist in this scope yet.'}
                      </div>
                    )}
                  </div>
                  <div className="pagination-bar user-directory-pagination">
                    <span className="pagination-range">
                      <span className="pagination-full">
                        Showing {pageStart}-{pageEnd} of {totalItems}
                      </span>
                      <span className="pagination-compact">
                        {pageStart}-{pageEnd} / {totalItems}
                      </span>
                    </span>
                    <div className="pagination-actions">
                      <Select
                        value={String(pageSize)}
                        onValueChange={(value) => updateDirectoryParams({
                          page: null,
                          pageSize: value === '10' ? null : value,
                        })}
                      >
                        <SelectTrigger className="page-size-select" aria-label="Users per page">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent position="popper">
                          <SelectItem value="10">10 / page</SelectItem>
                          <SelectItem value="20">20 / page</SelectItem>
                          <SelectItem value="50">50 / page</SelectItem>
                        </SelectContent>
                      </Select>
                      <span className="pagination-page">
                        <span className="pagination-full">
                          Page {totalPages === 0 ? 0 : page} of {totalPages}
                        </span>
                        <span className="pagination-compact">
                          {totalPages === 0 ? 0 : page} / {totalPages}
                        </span>
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => updateDirectoryParams({
                          page: page - 1 <= 1 ? null : String(page - 1),
                        })}
                        disabled={isFetching || page <= 1}
                        aria-label="Previous page"
                      >
                        <ChevronLeft size={16} />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => updateDirectoryParams({
                          page: String(Math.min(totalPages, page + 1)),
                        })}
                        disabled={isFetching || page >= totalPages}
                        aria-label="Next page"
                      >
                        <ChevronRight size={16} />
                      </Button>
                    </div>
                  </div>
                </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="create">
          <CreateUserCard {...createUserProps} />
        </TabsContent>

        <TabsContent value="email">
          <EmailTestCard
            users={emailUsers}
            canSendEmail={isPlatformOwner}
            usersLoading={optionsLoading}
            usersError={optionsError}
          />
        </TabsContent>

      </Tabs>
    </main>
  )
}
