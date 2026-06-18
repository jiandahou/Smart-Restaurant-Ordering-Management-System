import type { LucideIcon } from 'lucide-react'
import { BarChart3, ClipboardList, ListOrdered } from 'lucide-react'
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
