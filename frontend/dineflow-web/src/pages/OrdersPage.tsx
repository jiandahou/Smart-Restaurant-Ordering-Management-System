import { useEffect, useState } from 'react'
import type { Order, OrderItem } from '../hooks/useOrders'
import { useOrders } from '../hooks/useOrders'
import './OrdersPage.css'

export function OrdersPage() {
  const { orders, loading, error, fetchOrders, createOrder, deleteOrder } = useOrders()
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState<Order>({
    restaurantId: '',
    tableId: null,
    customerId: null,
    orderNumber: '',
    orderType: 0,
    status: 0,
    totalAmount: 0,
    customerNote: '',
    scheduledTime: null,
    orderItems: [],
  })
  const [newItem, setNewItem] = useState<OrderItem>({
    menuItemId: '',
    quantity: 1,
    unitPrice: 0,
    note: '',
  })

  useEffect(() => {
    fetchOrders()
  }, [fetchOrders])

  const handleAddItem = () => {
    if (newItem.menuItemId && newItem.quantity > 0 && newItem.unitPrice > 0) {
      setFormData((prev) => ({
        ...prev,
        orderItems: [...(prev.orderItems || []), { ...newItem }],
      }))
      setNewItem({ menuItemId: '', quantity: 1, unitPrice: 0, note: '' })
    }
  }

  const handleRemoveItem = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      orderItems: (prev.orderItems || []).filter((_, i) => i !== index),
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.restaurantId || !formData.orderNumber) {
      alert('Please fill in required fields')
      return
    }
    
    const totalAmount = (formData.orderItems || []).reduce(
      (sum, item) => sum + item.quantity * item.unitPrice,
      0
    )

    const order = { ...formData, totalAmount }
    const result = await createOrder(order)
    
    if (result) {
      setShowForm(false)
      setFormData({
        restaurantId: '',
        tableId: null,
        customerId: null,
        orderNumber: '',
        orderType: 0,
        status: 0,
        totalAmount: 0,
        customerNote: '',
        scheduledTime: null,
        orderItems: [],
      })
    }
  }

  const getOrderTypeLabel = (type: number): string => {
    const labels = ['Dine In', 'Takeaway', 'Scheduled']
    return labels[type] || 'Unknown'
  }

  const getStatusLabel = (status: number): string => {
    const labels = ['Pending', 'Accepted', 'Preparing', 'Ready', 'Completed', 'Cancelled', 'Rejected']
    return labels[status] || 'Unknown'
  }

  const getStatusColor = (status: number): string => {
    const colors = {
      0: '#ffc107', // Pending - yellow
      1: '#17a2b8', // Accepted - cyan
      2: '#6f42c1', // Preparing - purple
      3: '#28a745', // Ready - green
      4: '#6c757d', // Completed - gray
      5: '#dc3545', // Cancelled - red
      6: '#e83e8c', // Rejected - pink
    }
    return colors[status as keyof typeof colors] || '#6c757d'
  }

  return (
    <div className="orders-page">
      <div className="orders-header">
        <h1>Orders Management</h1>
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : '+ New Order'}
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {showForm && (
        <div className="form-container">
          <h2>Create New Order</h2>
          <form onSubmit={handleSubmit}>
            <div className="form-row">
              <div className="form-group">
                <label>Restaurant ID *</label>
                <input
                  type="text"
                  placeholder="Enter restaurant ID"
                  value={formData.restaurantId}
                  onChange={(e) => setFormData({ ...formData, restaurantId: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Order Number *</label>
                <input
                  type="text"
                  placeholder="e.g., ORD-2026-05-23-001"
                  value={formData.orderNumber}
                  onChange={(e) => setFormData({ ...formData, orderNumber: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Table ID</label>
                <input
                  type="text"
                  placeholder="Leave empty for takeaway"
                  value={formData.tableId || ''}
                  onChange={(e) => setFormData({ ...formData, tableId: e.target.value || null })}
                />
              </div>
              <div className="form-group">
                <label>Customer ID</label>
                <input
                  type="text"
                  placeholder="Optional"
                  value={formData.customerId || ''}
                  onChange={(e) => setFormData({ ...formData, customerId: e.target.value || null })}
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Order Type</label>
                <select
                  value={formData.orderType}
                  onChange={(e) => setFormData({ ...formData, orderType: parseInt(e.target.value) as 0 | 1 | 2 })}
                >
                  <option value={0}>Dine In</option>
                  <option value={1}>Takeaway</option>
                  <option value={2}>Scheduled</option>
                </select>
              </div>
              <div className="form-group">
                <label>Status</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: parseInt(e.target.value) as any })}
                >
                  <option value={0}>Pending</option>
                  <option value={1}>Accepted</option>
                  <option value={2}>Preparing</option>
                  <option value={3}>Ready</option>
                  <option value={4}>Completed</option>
                  <option value={5}>Cancelled</option>
                  <option value={6}>Rejected</option>
                </select>
              </div>
            </div>

            {formData.orderType === 2 && (
              <div className="form-group">
                <label>Scheduled Time</label>
                <input
                  type="datetime-local"
                  value={formData.scheduledTime ? new Date(formData.scheduledTime).toISOString().slice(0, 16) : ''}
                  onChange={(e) => setFormData({ ...formData, scheduledTime: e.target.value || null })}
                />
              </div>
            )}

            <div className="form-group">
              <label>Customer Note</label>
              <textarea
                placeholder="Special instructions..."
                value={formData.customerNote || ''}
                onChange={(e) => setFormData({ ...formData, customerNote: e.target.value })}
                rows={3}
              />
            </div>

            <h3>Order Items</h3>
            <div className="items-section">
              <div className="add-item-form">
                <div className="form-row">
                  <div className="form-group">
                    <label>Menu Item ID</label>
                    <input
                      type="text"
                      placeholder="Item ID"
                      value={newItem.menuItemId}
                      onChange={(e) => setNewItem({ ...newItem, menuItemId: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label>Quantity</label>
                    <input
                      type="number"
                      placeholder="1"
                      min="1"
                      value={newItem.quantity}
                      onChange={(e) => setNewItem({ ...newItem, quantity: parseInt(e.target.value) || 1 })}
                    />
                  </div>
                  <div className="form-group">
                    <label>Unit Price</label>
                    <input
                      type="number"
                      placeholder="0.00"
                      min="0"
                      step="0.01"
                      value={newItem.unitPrice}
                      onChange={(e) => setNewItem({ ...newItem, unitPrice: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                  <div className="form-group">
                    <label>Note</label>
                    <input
                      type="text"
                      placeholder="Item notes"
                      value={newItem.note || ''}
                      onChange={(e) => setNewItem({ ...newItem, note: e.target.value })}
                    />
                  </div>
                  <button type="button" className="btn btn-secondary" onClick={handleAddItem}>
                    Add Item
                  </button>
                </div>
              </div>

              {formData.orderItems && formData.orderItems.length > 0 && (
                <div className="items-list">
                  <table>
                    <thead>
                      <tr>
                        <th>Menu Item ID</th>
                        <th>Qty</th>
                        <th>Unit Price</th>
                        <th>Subtotal</th>
                        <th>Note</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {formData.orderItems.map((item, idx) => (
                        <tr key={idx}>
                          <td>{item.menuItemId}</td>
                          <td>{item.quantity}</td>
                          <td>${item.unitPrice.toFixed(2)}</td>
                          <td>${(item.quantity * item.unitPrice).toFixed(2)}</td>
                          <td>{item.note || '-'}</td>
                          <td>
                            <button
                              type="button"
                              className="btn btn-sm btn-danger"
                              onClick={() => handleRemoveItem(idx)}
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="total">
                    <strong>
                      Total: $
                      {formData.orderItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0).toFixed(2)}
                    </strong>
                  </div>
                </div>
              )}
            </div>

            <div className="form-actions">
              <button type="submit" className="btn btn-success">
                Create Order
              </button>
              <button type="button" className="btn btn-cancel" onClick={() => setShowForm(false)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="orders-list">
        <h2>Orders List ({orders.length})</h2>
        {loading && <p className="loading">Loading orders...</p>}
        {!loading && orders.length === 0 && <p className="empty">No orders found</p>}

        {!loading && orders.length > 0 && (
          <div className="orders-grid">
            {orders.map((order) => (
              <div key={order.id} className="order-card">
                <div className="order-header">
                  <h3>{order.orderNumber}</h3>
                  <span
                    className="status-badge"
                    style={{ backgroundColor: getStatusColor(order.status) }}
                  >
                    {getStatusLabel(order.status)}
                  </span>
                </div>

                <div className="order-details">
                  <p>
                    <strong>Type:</strong> {getOrderTypeLabel(order.orderType)}
                  </p>
                  <p>
                    <strong>Total:</strong> ${order.totalAmount.toFixed(2)}
                  </p>
                  {order.tableId && (
                    <p>
                      <strong>Table:</strong> {order.tableId}
                    </p>
                  )}
                  {order.customerNote && (
                    <p>
                      <strong>Note:</strong> {order.customerNote}
                    </p>
                  )}
                  {order.scheduledTime && (
                    <p>
                      <strong>Scheduled:</strong> {new Date(order.scheduledTime).toLocaleString()}
                    </p>
                  )}
                </div>

                {order.orderItems && order.orderItems.length > 0 && (
                  <div className="order-items">
                    <strong>Items ({order.orderItems.length}):</strong>
                    <ul>
                      {order.orderItems.map((item, idx) => (
                        <li key={idx}>
                          {item.quantity}x - ${(item.unitPrice * item.quantity).toFixed(2)}
                          {item.note && ` (${item.note})`}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="order-actions">
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => {
                      if (window.confirm('Are you sure?')) {
                        deleteOrder(order.id!)
                      }
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
