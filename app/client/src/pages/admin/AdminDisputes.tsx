import { useEffect, useState, useCallback } from 'react';
import { api } from '../../lib/api';

interface AdminDispute {
  id: string;
  reason: string;
  status: string;
  resolution: string | null;
  createdAt: string;
  order: { id: string };
  creator: { id: string; fullName: string; email: string };
}

interface DisputesResponse {
  data: AdminDispute[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-red-100 text-red-700',
  under_review: 'bg-yellow-100 text-yellow-700',
  resolved: 'bg-green-100 text-green-700',
  closed: 'bg-gray-100 text-gray-700',
};

interface ResolveFormProps {
  dispute: AdminDispute;
  onDone: () => void;
}

function ResolveForm({ dispute, onDone }: ResolveFormProps) {
  const [status, setStatus] = useState<'under_review' | 'resolved' | 'closed'>('resolved');
  const [resolution, setResolution] = useState(dispute.resolution ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api(`/admin/disputes/${dispute.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, resolution: resolution || undefined }),
      });
      onDone();
    } catch {
      setError('Failed to update dispute');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mt-3 bg-gray-50 rounded-md p-4 flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-600">New Status</label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          className="px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="under_review">Under Review</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-600">Resolution Notes</label>
        <textarea
          value={resolution}
          onChange={(e) => setResolution(e.target.value)}
          rows={3}
          className="px-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
          placeholder="Describe the resolution..."
        />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-1.5 text-sm bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="px-4 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-100 transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function AdminDisputes() {
  const [disputes, setDisputes] = useState<AdminDispute[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchDisputes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (statusFilter) params.set('status', statusFilter);
      const res = await api<DisputesResponse>(`/admin/disputes?${params}`);
      setDisputes(res.data);
      setPagination(res.pagination);
    } catch {
      setError('Failed to load disputes');
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter]);

  useEffect(() => {
    fetchDisputes();
  }, [fetchDisputes]);

  const handleResolveDone = () => {
    setExpandedId(null);
    fetchDisputes();
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Disputes</h1>

      <div className="mb-4">
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="under_review">Under Review</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
        </div>
      ) : error ? (
        <p className="text-red-600">{error}</p>
      ) : (
        <>
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Order ID</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Creator</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Reason</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {disputes.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                      No disputes found
                    </td>
                  </tr>
                ) : (
                  disputes.map((dispute) => (
                    <>
                      <tr
                        key={dispute.id}
                        className="hover:bg-gray-50 cursor-pointer"
                        onClick={() =>
                          setExpandedId(expandedId === dispute.id ? null : dispute.id)
                        }
                      >
                        <td className="px-4 py-3 font-mono text-xs text-gray-600">
                          {dispute.order.id.slice(0, 8)}...
                        </td>
                        <td className="px-4 py-3 text-gray-700">{dispute.creator.fullName}</td>
                        <td className="px-4 py-3 text-gray-600 max-w-xs truncate">
                          {dispute.reason}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                              STATUS_COLORS[dispute.status] ?? 'bg-gray-100 text-gray-700'
                            }`}
                          >
                            {dispute.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedId(expandedId === dispute.id ? null : dispute.id);
                            }}
                            className="text-xs px-3 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors"
                          >
                            {expandedId === dispute.id ? 'Collapse' : 'Resolve'}
                          </button>
                        </td>
                      </tr>
                      {expandedId === dispute.id && (
                        <tr key={`${dispute.id}-form`}>
                          <td colSpan={5} className="px-4 pb-4">
                            <div className="text-xs text-gray-500 mb-1">
                              Full reason: {dispute.reason}
                              {dispute.resolution && (
                                <span className="ml-4">
                                  Previous resolution: {dispute.resolution}
                                </span>
                              )}
                            </div>
                            <ResolveForm dispute={dispute} onDone={handleResolveDone} />
                          </td>
                        </tr>
                      )}
                    </>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {pagination.totalPages > 1 && (
            <div className="mt-4 flex items-center gap-2 justify-end">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1 text-sm border border-gray-300 rounded disabled:opacity-40 hover:bg-gray-50"
              >
                Previous
              </button>
              <span className="text-sm text-gray-600">
                Page {page} of {pagination.totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                disabled={page === pagination.totalPages}
                className="px-3 py-1 text-sm border border-gray-300 rounded disabled:opacity-40 hover:bg-gray-50"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
