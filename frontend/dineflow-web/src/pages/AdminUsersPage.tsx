import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowDownAZ,
  ArrowUpAZ,
  Building2,
  ChevronLeft,
  ChevronRight,
  Mail,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  UserPlus,
  UsersRound,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { useSearchParams } from 'react-router-dom'
import {
  getRestaurantUserPage,
  getRestaurantUsers,
  getRestaurants,
  type ManagedUserRole,
  type Restaurant,
  type UserListItem,
} from '../api/auth'
import { useAuth } from '../auth/AuthContext'
import { CreateUserCard, CreateUserDialog, creatableRoles, roleRank } from '../components/admin/CreateUserCard'
import { EmailTestCard } from '../components/admin/EmailTestCard'
import { UserRowActions } from '../components/admin/UserRowActions'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Separator } from '../components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'

type SortKey = 'name' | 'email' | 'restaurant' | 'roles'
type SortDirection = 'asc' | 'desc'
type ScopeFilter = 'all' | 'platform' | 'restaurant'
type UserSection = 'users' | 'create' | 'email' | 'permissions'
const manageableRoles = ['RestaurantOwner', 'Admin', 'Staff', 'Customer'] as const satisfies readonly ManagedUserRole[]
const userSections = ['users', 'create', 'email', 'permissions'] as const satisfies readonly UserSection[]

function getUserSection(value: string | null): UserSection {
  return userSections.includes(value as UserSection) ? (value as UserSection) : 'users'
}

export function AdminUsersPage() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [users, setUsers] = useState<UserListItem[]>([])
  const [emailUsers, setEmailUsers] = useState<UserListItem[]>([])
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [restaurantFilter, setRestaurantFilter] = useState('all')
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [totalItems, setTotalItems] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({
    key: 'email',
    direction: 'asc',
  })

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

  const roleOptions = ['PlatformOwner', 'RestaurantOwner', 'Admin', 'Staff', 'Customer']
  const pageStart = totalItems === 0 ? 0 : (page - 1) * pageSize + 1
  const pageEnd = Math.min(page * pageSize, totalItems)
  const restaurantNameById = useMemo(
    () => new Map(restaurants.map((restaurant) => [restaurant.id, restaurant.name])),
    [restaurants],
  )

  const hasActiveFilters =
    search.trim() !== '' || roleFilter !== 'all' || restaurantFilter !== 'all' || scopeFilter !== 'all'

  const loadUsers = useCallback(async (showToast = false) => {
    setLoading(true)
    setError(null)

    try {
      const response = await getRestaurantUserPage({
        page,
        pageSize,
        search: search.trim() || undefined,
        sortBy: sort.key === 'name' ? 'fullName' : sort.key === 'roles' ? 'role' : sort.key,
        sortDirection: sort.direction,
        role: roleFilter === 'all' ? undefined : roleFilter,
        restaurantId: restaurantFilter === 'all' ? undefined : restaurantFilter,
        scope: scopeFilter,
      })
      setUsers(response.items)
      setTotalItems(response.totalItems)
      setTotalPages(response.totalPages)

      if (response.totalPages > 0 && page > response.totalPages) {
        setPage(response.totalPages)
      }
      if (showToast) {
        toast.success('User directory refreshed')
      }
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Failed to load users'
      setError(message)
      toast.error('Could not load users', {
        description: message,
      })
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, restaurantFilter, roleFilter, scopeFilter, search, sort])

  const loadUserOptions = useCallback(async () => {
    const [allUsers, availableRestaurants] = await Promise.all([
      getRestaurantUsers(),
      getRestaurants(),
    ])
    setEmailUsers(allUsers)
    setRestaurants(availableRestaurants)
  }, [])

  useEffect(() => {
    void Promise.resolve().then(() => loadUsers())
  }, [loadUsers])

  useEffect(() => {
    void Promise.resolve().then(() => loadUserOptions())
  }, [loadUserOptions])

  const updateSort = (key: SortKey) => {
    setPage(1)
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }))
  }

  const resetFilters = () => {
    setPage(1)
    setSearch('')
    setRoleFilter('all')
    setRestaurantFilter('all')
    setScopeFilter('all')
  }

  const updateRestaurantFilter = (value: string) => {
    setPage(1)
    setRestaurantFilter(value)

    if (value !== 'all') {
      setScopeFilter('restaurant')
    }
  }

  const SortIcon = sort.direction === 'asc' ? ArrowDownAZ : ArrowUpAZ
  const refreshUserData = async () => {
    await Promise.all([loadUsers(), loadUserOptions()])
  }
  const createUserProps = {
    availableRoles,
    currentUserRank,
    needsRestaurantId,
    restaurantId: user?.restaurantId,
    onUserCreated: refreshUserData,
  }
  const getRestaurantLabel = (restaurantId?: string | null) => {
    if (!restaurantId) {
      return 'Platform scope'
    }

    return restaurantNameById.get(restaurantId) ?? restaurantId
  }
  const activeDropdownFilterCount = [
    roleFilter !== 'all',
    restaurantFilter !== 'all',
    scopeFilter !== 'all',
  ].filter(Boolean).length
  const selectedRestaurantFilterLabel = restaurantFilter === 'all' ? '' : getRestaurantLabel(restaurantFilter)
  const selectedScopeFilterLabel =
    scopeFilter === 'platform' ? 'Platform scope' : scopeFilter === 'restaurant' ? 'Restaurant scope' : ''
  const activeSection = getUserSection(searchParams.get('section'))

  const setActiveSection = (value: string) => {
    const section = getUserSection(value)

    setSearchParams((current) => {
      const next = new URLSearchParams(current)

      if (section === 'users') {
        next.delete('section')
      } else {
        next.set('section', section)
      }

      return next
    }, { replace: true })
  }

  return (
    <main className="content-grid">
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
          <TabsTrigger value="permissions">
            <ShieldCheck size={16} />
            <span>Permissions</span>
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
                <Button type="button" variant="secondary" onClick={() => void loadUsers(true)} disabled={loading}>
                  <RefreshCw size={18} />
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {error && <p className="form-error">{error}</p>}
              {loading ? (
                <p>Loading users...</p>
              ) : (
                <div className="directory-stack user-directory-stack">
                  <div className="directory-tools user-directory-tools">
                    <div className="user-directory-search-row">
                      <div className="directory-search">
                        <Search size={16} />
                        <Input
                          value={search}
                          onChange={(event) => { setPage(1); setSearch(event.target.value) }}
                          placeholder="Filter by name, email, or role"
                        />
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
                              <Select value={roleFilter} onValueChange={(value) => { setPage(1); setRoleFilter(value) }}>
                                <SelectTrigger className="filter-select">
                                  <SelectValue placeholder="Role" />
                                </SelectTrigger>
                                <SelectContent position="popper">
                                  <SelectItem value="all">All roles</SelectItem>
                                  {roleOptions.map((role) => (
                                    <SelectItem key={role} value={role}>
                                      {role}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="user-directory-filter-field">
                              <span>Restaurant</span>
                              <Select value={restaurantFilter} onValueChange={updateRestaurantFilter}>
                                <SelectTrigger className="filter-select">
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
                              <Select value={scopeFilter} onValueChange={(value) => { setPage(1); setScopeFilter(value as ScopeFilter) }}>
                                <SelectTrigger className="filter-select">
                                  <SelectValue placeholder="Scope" />
                                </SelectTrigger>
                                <SelectContent position="popper">
                                  <SelectItem value="all">All scopes</SelectItem>
                                  <SelectItem value="platform">Platform scope</SelectItem>
                                  <SelectItem value="restaurant">Restaurant scope</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>

                    <div className="user-directory-inline-filters">
                      <Select value={roleFilter} onValueChange={(value) => { setPage(1); setRoleFilter(value) }}>
                        <SelectTrigger className="filter-select">
                          <SelectValue placeholder="Role" />
                        </SelectTrigger>
                        <SelectContent position="popper">
                          <SelectItem value="all">All roles</SelectItem>
                          {roleOptions.map((role) => (
                            <SelectItem key={role} value={role}>
                              {role}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select value={restaurantFilter} onValueChange={updateRestaurantFilter}>
                        <SelectTrigger className="filter-select">
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
                      <Select value={scopeFilter} onValueChange={(value) => { setPage(1); setScopeFilter(value as ScopeFilter) }}>
                        <SelectTrigger className="filter-select">
                          <SelectValue placeholder="Scope" />
                        </SelectTrigger>
                        <SelectContent position="popper">
                          <SelectItem value="all">All scopes</SelectItem>
                          <SelectItem value="platform">Platform scope</SelectItem>
                          <SelectItem value="restaurant">Restaurant scope</SelectItem>
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
                            onClick={() => { setPage(1); setSearch('') }}
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
                            onClick={() => { setPage(1); setRoleFilter('all') }}
                            title={`Role: ${roleFilter}`}
                          >
                            <span>Role: {roleFilter}</span>
                            <X size={13} />
                          </button>
                        )}
                        {restaurantFilter !== 'all' && (
                          <button
                            type="button"
                            className="user-filter-chip"
                            onClick={() => { setPage(1); setRestaurantFilter('all') }}
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
                            onClick={() => { setPage(1); setScopeFilter('all') }}
                            title={`Scope: ${selectedScopeFilterLabel}`}
                          >
                            <span>Scope: {selectedScopeFilterLabel}</span>
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

                  <div className="table-wrap user-directory-table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>
                            <button type="button" className="sort-button" onClick={() => updateSort('name')}>
                              Name
                              {sort.key === 'name' && <SortIcon size={15} />}
                            </button>
                          </th>
                          <th>
                            <button type="button" className="sort-button" onClick={() => updateSort('email')}>
                              Email
                              {sort.key === 'email' && <SortIcon size={15} />}
                            </button>
                          </th>
                          <th>
                            <button type="button" className="sort-button" onClick={() => updateSort('restaurant')}>
                              Restaurant
                              {sort.key === 'restaurant' && <SortIcon size={15} />}
                            </button>
                          </th>
                          <th>
                            <button type="button" className="sort-button" onClick={() => updateSort('roles')}>
                              Roles
                              {sort.key === 'roles' && <SortIcon size={15} />}
                            </button>
                          </th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {users.map((directoryUser) => (
                          <tr key={directoryUser.id}>
                            <td>
                              <span className="table-name">
                                <UsersRound size={16} />
                                {directoryUser.fullName || 'Not set'}
                              </span>
                            </td>
                            <td>{directoryUser.email}</td>
                            <td>{getRestaurantLabel(directoryUser.restaurantId)}</td>
                            <td>
                              <div className="badge-row">
                                {directoryUser.roles.map((role) => (
                                  <Badge key={role}>{role}</Badge>
                                ))}
                              </div>
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
                        ))}
                        {users.length === 0 && (
                          <tr>
                            <td colSpan={5} className="empty-cell">
                              No users match the current filters.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="user-mobile-list" aria-label="Users">
                    {users.map((directoryUser) => {
                      const emailLabel = directoryUser.email ?? 'No email'
                      const restaurantLabel = getRestaurantLabel(directoryUser.restaurantId)

                      return (
                        <article className="user-mobile-card" key={directoryUser.id}>
                          <header className="user-mobile-card-header">
                            <span className="user-mobile-avatar">
                              <UsersRound size={18} />
                            </span>
                            <div className="user-mobile-primary">
                              <strong title={directoryUser.fullName || 'Not set'}>
                                {directoryUser.fullName || 'Not set'}
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
                                    <Badge key={role}>{role}</Badge>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                        </article>
                      )
                    })}
                    {users.length === 0 && (
                      <div className="user-mobile-empty">
                        No users match the current filters.
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
                      <Select value={String(pageSize)} onValueChange={(value) => { setPage(1); setPageSize(Number(value)) }}>
                        <SelectTrigger className="page-size-select">
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
                        onClick={() => setPage((current) => Math.max(1, current - 1))}
                        disabled={loading || page <= 1}
                        aria-label="Previous page"
                      >
                        <ChevronLeft size={16} />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                        disabled={loading || page >= totalPages}
                        aria-label="Next page"
                      >
                        <ChevronRight size={16} />
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="create">
          <CreateUserCard {...createUserProps} />
        </TabsContent>

        <TabsContent value="email">
          <EmailTestCard users={emailUsers} canSendEmail={isPlatformOwner} />
        </TabsContent>

        <TabsContent value="permissions">
          <Card>
            <CardHeader>
              <CardTitle>Permission Guard</CardTitle>
              <CardDescription>Your role controls both the UI options and server-side authorization.</CardDescription>
            </CardHeader>
            <CardContent className="permission-panel">
              <div>
                <span>Signed in as</span>
                <strong>{user?.email}</strong>
              </div>
              <Separator />
              <div>
                <span>Available roles</span>
                <div className="badge-row">
                  {availableRoles.map((role) => (
                    <Badge key={role}>{role}</Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </main>
  )
}
