import type { LucideIcon } from 'lucide-react'
import { BarChart3, ClipboardList, LayoutDashboard, ListOrdered, Store, Utensils } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'

type AdminPlaceholderPageProps = {
  title: string
  description: string
  icon: LucideIcon
  items: string[]
}

function AdminPlaceholderPage({ title, description, icon: Icon, items }: AdminPlaceholderPageProps) {
  return (
    <main className="content-grid">
      <Card>
        <CardHeader>
          <div className="admin-page-title">
            <Icon size={22} />
            <div>
              <CardTitle>{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="placeholder-grid">
            {items.map((item) => (
              <div className="placeholder-item" key={item}>
                <span>{item}</span>
                <strong>Coming soon</strong>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </main>
  )
}

export function AdminDashboardPage() {
  return (
    <AdminPlaceholderPage
      title="Admin Dashboard"
      description="A starting point for restaurant operations and platform oversight."
      icon={LayoutDashboard}
      items={['Today at a glance', 'Open operational alerts', 'Recent admin activity', 'Quick links']}
    />
  )
}

export function AdminRestaurantsPage() {
  return (
    <AdminPlaceholderPage
      title="Restaurant Management"
      description="Manage restaurant profiles, ownership, and operating status."
      icon={Store}
      items={['Restaurant directory', 'Ownership assignment', 'Operating status', 'Location details']}
    />
  )
}

export function AdminOrdersPage() {
  return (
    <AdminPlaceholderPage
      title="Order Management"
      description="Review incoming, active, and historical restaurant orders."
      icon={ClipboardList}
      items={['Live order queue', 'Order history', 'Payment state', 'Fulfillment exceptions']}
    />
  )
}

export function AdminMenuPage() {
  return (
    <AdminPlaceholderPage
      title="Menu Management"
      description="Create menu sections, items, pricing, and availability controls."
      icon={Utensils}
      items={['Menu sections', 'Menu items', 'Pricing rules', 'Availability schedule']}
    />
  )
}

export function AdminReportsPage() {
  return (
    <AdminPlaceholderPage
      title="Reports"
      description="Track sales, ordering trends, and restaurant performance."
      icon={BarChart3}
      items={['Sales summary', 'Order volume', 'Popular items', 'Restaurant performance']}
    />
  )
}

export function AdminListsPage() {
  return (
    <AdminPlaceholderPage
      title="Admin Lists"
      description="Shared operational lists and configuration will live here."
      icon={ListOrdered}
      items={['Reusable tags', 'Service categories', 'Operational presets', 'Audit filters']}
    />
  )
}
