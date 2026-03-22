import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

interface Stats {
  totalUsers: number;
  totalJobs: number;
  totalOrders: number;
  totalRevenueCents: number;
  activeDisputes: number;
}

interface StatCardProps {
  label: string;
  value: string | number;
}

function StatCard({ label, value }: StatCardProps) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 flex flex-col gap-2">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-3xl font-bold text-gray-900">{value}</span>
    </div>
  );
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<Stats>('/admin/stats')
      .then(setStats)
      .catch(() => setError('Failed to load stats'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-48">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
      </div>
    );
  }

  if (error || !stats) {
    return <p className="text-red-600">{error ?? 'Unknown error'}</p>;
  }

  const revenue = (stats.totalRevenueCents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard label="Total Users" value={stats.totalUsers} />
        <StatCard label="Total Jobs" value={stats.totalJobs} />
        <StatCard label="Total Orders" value={stats.totalOrders} />
        <StatCard label="Total Revenue" value={revenue} />
        <StatCard label="Active Disputes" value={stats.activeDisputes} />
      </div>
    </div>
  );
}
