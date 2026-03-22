import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

interface OrderItem {
  id: string;
  status: string;
  trackingNumber: string | null;
  createdAt: string;
  job: { id: string; title: string; materialPreferred: string | null };
  bid: { id: string; amountCents: number; shippingCostCents: number; estimatedDays: number };
  buyer: { id: string; fullName: string };
  printer: { id: string; user: { id: string; fullName: string } };
}

const STATUS_STEPS = ['paid', 'printing', 'shipped', 'delivered', 'confirmed'];
const STATUS_COLORS: Record<string, string> = {
  paid: 'bg-yellow-100 text-yellow-700',
  printing: 'bg-blue-100 text-blue-700',
  shipped: 'bg-indigo-100 text-indigo-700',
  delivered: 'bg-purple-100 text-purple-700',
  confirmed: 'bg-green-100 text-green-700',
  disputed: 'bg-red-100 text-red-700',
  refunded: 'bg-gray-100 text-gray-700',
};

export default function Orders() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    api<{ data: OrderItem[] }>('/orders')
      .then((res) => setOrders(res.data))
      .catch(() => setLoadError('Failed to load orders'))
      .finally(() => setLoading(false));
  }, []);

  const updateStatus = async (orderId: string, status: string, trackingNumber?: string) => {
    try {
      await api(`/orders/${orderId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, ...(trackingNumber && { trackingNumber }) }),
      });
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status, ...(trackingNumber && { trackingNumber }) } : o)),
      );
    } catch (err: unknown) {
      alert((err as { error?: string }).error || 'Failed to update');
    }
  };

  const confirmDelivery = async (orderId: string) => {
    try {
      await api(`/orders/${orderId}/confirm`, { method: 'POST' });
      setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status: 'confirmed' } : o)));
    } catch (err: unknown) {
      alert((err as { error?: string }).error || 'Failed to confirm');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Orders</h1>

      {loadError ? (
        <div className="bg-red-50 text-red-700 p-4 rounded-lg">{loadError}</div>
      ) : orders.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">No orders yet.</div>
      ) : (
        <div className="space-y-4">
          {orders.map((order) => {
            const isBuyer = user?.id === order.buyer.id;
            const isPrinter = user?.id === order.printer.user.id;
            const currentStep = STATUS_STEPS.indexOf(order.status);

            return (
              <div key={order.id} className="bg-white rounded-lg shadow p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <Link to={`/jobs/${order.job.id}`} className="text-lg font-semibold text-brand-600 hover:text-brand-700">
                      {order.job.title}
                    </Link>
                    <p className="text-sm text-gray-500 mt-1">
                      {isBuyer ? `Printer: ${order.printer.user.fullName}` : `Buyer: ${order.buyer.fullName}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-bold">${(order.bid.amountCents / 100).toFixed(2)}</div>
                    <span className={`text-xs px-2 py-1 rounded-full capitalize ${STATUS_COLORS[order.status] || ''}`}>
                      {order.status}
                    </span>
                  </div>
                </div>

                {/* Status timeline */}
                <div className="flex items-center gap-1 mb-4">
                  {STATUS_STEPS.map((step, i) => (
                    <div key={step} className="flex items-center flex-1">
                      <div className={`h-2 flex-1 rounded-full ${i <= currentStep ? 'bg-brand-500' : 'bg-gray-200'}`} />
                    </div>
                  ))}
                </div>
                <div className="flex justify-between text-xs text-gray-400 mb-4">
                  {STATUS_STEPS.map((step) => (
                    <span key={step} className="capitalize">{step}</span>
                  ))}
                </div>

                {order.trackingNumber && (
                  <p className="text-sm text-gray-600 mb-3">Tracking: {order.trackingNumber}</p>
                )}

                {/* Actions */}
                <div className="flex gap-2">
                  {isPrinter && order.status === 'paid' && (
                    <button onClick={() => updateStatus(order.id, 'printing')}
                      className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm hover:bg-blue-700">
                      Start Printing
                    </button>
                  )}
                  {isPrinter && order.status === 'printing' && (
                    <button onClick={() => {
                      const tracking = prompt('Enter tracking number (optional):');
                      updateStatus(order.id, 'shipped', tracking || undefined);
                    }}
                      className="bg-indigo-600 text-white px-4 py-1.5 rounded text-sm hover:bg-indigo-700">
                      Mark Shipped
                    </button>
                  )}
                  {isPrinter && order.status === 'shipped' && (
                    <button onClick={() => updateStatus(order.id, 'delivered')}
                      className="bg-purple-600 text-white px-4 py-1.5 rounded text-sm hover:bg-purple-700">
                      Mark Delivered
                    </button>
                  )}
                  {isBuyer && (order.status === 'shipped' || order.status === 'delivered') && (
                    <button onClick={() => confirmDelivery(order.id)}
                      className="bg-green-600 text-white px-4 py-1.5 rounded text-sm hover:bg-green-700">
                      Confirm Received
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
