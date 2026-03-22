import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

interface JobItem {
  id: string;
  title: string;
  description: string | null;
  materialPreferred: string | null;
  quantity: number;
  status: string;
  expiresAt: string;
  createdAt: string;
  bidCount: number;
  fileMetadata: {
    fileName?: string;
    printabilityScore?: number;
  } | null;
  user: { id: string; fullName: string };
}

interface JobResponse {
  data: JobItem[];
  total: number;
  page: number;
  totalPages: number;
}

export default function JobList() {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [materialFilter, setMaterialFilter] = useState('');

  useEffect(() => {
    const params = new URLSearchParams();
    if (materialFilter) params.set('material', materialFilter);

    api<JobResponse>(`/jobs?${params}`)
      .then((res) => {
        setJobs(res.data);
        setTotal(res.total);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [materialFilter]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Print Jobs</h1>
          <p className="text-gray-500 mt-1">{total} open jobs</p>
        </div>
        {user && (
          <Link
            to="/jobs/new"
            className="bg-brand-600 text-white px-5 py-2 rounded-lg hover:bg-brand-700 font-medium"
          >
            Post a Job
          </Link>
        )}
      </div>

      <div className="mb-6">
        <select
          value={materialFilter}
          onChange={(e) => setMaterialFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
        >
          <option value="">All Materials</option>
          {['PLA', 'PETG', 'ABS', 'TPU', 'Nylon', 'Resin'].map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      {jobs.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          No open print jobs right now.
          {user && ' Be the first to post one!'}
        </div>
      ) : (
        <div className="space-y-4">
          {jobs.map((job) => (
            <Link
              key={job.id}
              to={`/jobs/${job.id}`}
              className="block bg-white rounded-lg shadow p-6 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900">{job.title}</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    Posted by {job.user.fullName} &middot;{' '}
                    {new Date(job.createdAt).toLocaleDateString()}
                  </p>
                  {job.description && (
                    <p className="text-gray-600 mt-2 line-clamp-2">{job.description}</p>
                  )}
                  <div className="flex items-center gap-4 mt-3 text-sm">
                    {job.materialPreferred && (
                      <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded">
                        {job.materialPreferred}
                      </span>
                    )}
                    <span className="text-gray-500">Qty: {job.quantity}</span>
                    {job.fileMetadata?.fileName && (
                      <span className="text-gray-500">{job.fileMetadata.fileName}</span>
                    )}
                  </div>
                </div>
                <div className="text-right ml-6">
                  <div className="text-2xl font-bold text-brand-600">{job.bidCount}</div>
                  <div className="text-xs text-gray-500">bids</div>
                  <div className="text-xs text-gray-400 mt-2">
                    Expires {new Date(job.expiresAt).toLocaleDateString()}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
