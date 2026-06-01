import { useEffect, useMemo, useState } from 'react'
import { ArrowDownAZ, ArrowUpAZ, ChevronLeft, ChevronRight, RefreshCw, Search, UsersRound, X } from 'lucide-react'
import { toast } from 'sonner'
import { getRestaurantUsers, type ManagedUserRole, type UserListItem } from '../api/auth'
import { useAuth } from '../auth/AuthContext'
import { CreateUserCard, CreateUserDialog, creatableRoles, roleRank } from '../components/admin/CreateUserCard'
import { EmailTestCard } from '../components/admin/EmailTestCard'
import { UserRowActions } from '../components/admin/UserRowActions'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Separator } from '../components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'

type SortKey = 'name' | 'email' | 'restaurant' | 'roles'
type SortDirection = 'asc' | 'desc'
type ScopeFilter = 'all' | 'platform' | 'restaurant'
const manageableRoles = ['RestaurantOwner', 'Admin', 'Staff', 'Customer'] as const satisfies readonly ManagedUserRole[]

export function AdminUsersPage() {
  const { user } = useAuth()
  const [users, setUsers] = useState<UserListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [restaurantFilter, setRestaurantFilter] = useState('all')
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
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

  const roleOptions = useMemo(() => {
    return Array.from(new Set(users.flatMap((user) => user.roles))).sort((first, second) =>
      first.localeCompare(second),
    )
  }, [users])

  const restaurantOptions = useMemo(() => {
    return Array.from(
      new Set(users.map((user) => user.restaurantId).filter((restaurantId): restaurantId is string => Boolean(restaurantId))),
    ).sort((first, second) => first.localeCompare(second))
  }, [users])

  const filteredUsers = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase()

    return users
      .filter((user) => {
        if (!normalizedSearch) {
          return true
        }

        return [
          user.fullName,
          user.email,
          user.restaurantId,
          user.roles.join(' '),
        ]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(normalizedSearch))
      })
      .filter((user) => (roleFilter === 'all' ? true : user.roles.includes(roleFilter)))
      .filter((user) => (restaurantFilter === 'all' ? true : user.restaurantId === restaurantFilter))
      .filter((user) => {
        if (scopeFilter === 'platform') {
          return !user.restaurantId
        }

        if (scopeFilter === 'restaurant') {
          return Boolean(user.restaurantId)
        }

        return true
      })
      .toSorted((first, second) => {
        const direction = sort.direction === 'asc' ? 1 : -1
        const getValue = (item: UserListItem) => {
          switch (sort.key) {
            case 'name':
              return item.fullName || ''
            case 'restaurant':
              return item.restaurantId || 'Platform scope'
            case 'roles':
              return item.roles.join(', ')
            case 'email':
            default:
              return item.email || ''
          }
        }

        return getValue(first).localeCompare(getValue(second)) * direction
      })
  }, [restaurantFilter, roleFilter, scopeFilter, search, sort, users])

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / pageSize))
  const pageStart = filteredUsers.length === 0 ? 0 : (page - 1) * pageSize + 1
  const pageEnd = Math.min(page * pageSize, filteredUsers.length)
  const paginatedUsers = useMemo(() => {
    const start = (page - 1) * pageSize

    return filteredUsers.slice(start, start + pageSize)
  }, [filteredUsers, page, pageSize])

  const hasActiveFilters =
    search.trim() !== '' || roleFilter !== 'all' || restaurantFilter !== 'all' || scopeFilter !== 'all'

  const loadUsers = async (showToast = false) => {
    setLoading(true)
    setError(null)

    try {
      setUsers(await getRestaurantUsers())
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
  }

  useEffect(() => {
    void loadUsers()
  }, [])

  useEffect(() => {
    setPage(1)
  }, [restaurantFilter, roleFilter, scopeFilter, search, sort])

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages))
  }, [totalPages])

  const updateSort = (key: SortKey) => {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }))
  }

  const resetFilters = () => {
    setSearch('')
    setRoleFilter('all')
    setRestaurantFilter('all')
    setScopeFilter('all')
  }

  const updateRestaurantFilter = (value: string) => {
    setRestaurantFilter(value)

    if (value !== 'all') {
      setScopeFilter('restaurant')
    }
  }

  const SortIcon = sort.direction === 'asc' ? ArrowDownAZ : ArrowUpAZ
  const createUserProps = {
    availableRoles,
    currentUserRank,
    needsRestaurantId,
    restaurantId: user?.restaurantId,
    onUserCreated: () => loadUsers(),
  }

  return (
    <main className="content-grid">
      <Tabs defaultValue="users" orientation="vertical" className="admin-tabs">
        <TabsList className="admin-tabs-list" aria-label="Admin sections">
          <TabsTrigger value="users">Admin User Center</TabsTrigger>
          <TabsTrigger value="create">Create User</TabsTrigger>
          <TabsTrigger value="email">Email</TabsTrigger>
          <TabsTrigger value="permissions">Permission Guard</TabsTrigger>
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
                <div className="directory-stack">
                  <div className="directory-tools">
                    <div className="directory-search">
                      <Search size={16} />
                      <Input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Filter by name, email, restaurant, or role"
                      />
                    </div>
                    <Select value={roleFilter} onValueChange={setRoleFilter}>
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
                        {restaurantOptions.map((restaurantId) => (
                          <SelectItem key={restaurantId} value={restaurantId}>
                            {restaurantId}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={scopeFilter} onValueChange={(value) => setScopeFilter(value as ScopeFilter)}>
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
                      title="Clear filters"
                      aria-label="Clear filters"
                    >
                      <X size={16} />
                    </Button>
                  </div>

                  <div className="table-wrap">
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
                        {paginatedUsers.map((directoryUser) => (
                          <tr key={directoryUser.id}>
                            <td>
                              <span className="table-name">
                                <UsersRound size={16} />
                                {directoryUser.fullName || 'Not set'}
                              </span>
                            </td>
                            <td>{directoryUser.email}</td>
                            <td>{directoryUser.restaurantId || 'Platform scope'}</td>
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
                                onUsersChanged={() => loadUsers()}
                              />
                            </td>
                          </tr>
                        ))}
                        {paginatedUsers.length === 0 && (
                          <tr>
                            <td colSpan={5} className="empty-cell">
                              No users match the current filters.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="pagination-bar">
                    <span>
                      Showing {pageStart}-{pageEnd} of {filteredUsers.length}
                    </span>
                    <div className="pagination-actions">
                      <Select value={String(pageSize)} onValueChange={(value) => setPageSize(Number(value))}>
                        <SelectTrigger className="page-size-select">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent position="popper">
                          <SelectItem value="10">10 / page</SelectItem>
                          <SelectItem value="20">20 / page</SelectItem>
                          <SelectItem value="50">50 / page</SelectItem>
                        </SelectContent>
                      </Select>
                      <span>
                        Page {page} of {totalPages}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => setPage((current) => Math.max(1, current - 1))}
                        disabled={page === 1}
                        aria-label="Previous page"
                      >
                        <ChevronLeft size={16} />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                        disabled={page === totalPages}
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
          <EmailTestCard users={users} canSendEmail={isPlatformOwner} />
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
