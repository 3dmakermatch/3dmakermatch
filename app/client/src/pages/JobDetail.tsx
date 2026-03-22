import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

interface JobDetailData {
  id: string;
  title: string;
  description: string | null;
  fileUrl: string;
  thumbnailUrl: string | null;
  materialPreferred: string | null;
  quantity: number;
  status: string;
  expiresAt: string;
  createdAt: string;
  bidCount: number;
  fileMetadata: {
    fileName?: string;
    dimensions?: { x: number; y: number; z: number };
    volumeCm3?: number;
    polygonCount?: number;
    isManifold?: boolean;
    printabilityScore?: number;
  } | null;
  user: { id: string; fullName: string };
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  bidding: 'bg-green-100 text-green-700',
  active: 'bg-blue-100 text-blue-700',
  completed: 'bg-purple-100 text-purple-700',
  cancelled: 'bg-red-100 text-red-700',
};

export default function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [job, setJob] = useState<JobDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    api<JobDetailData>(`/jobs/${id}`)
      .then(setJob)
      .catch(() => setError('Job not found'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center text-gray-500">
        {error || 'Job not found'}
      </div>
    );
  }

  const isOwner = user?.id === job.user.id;
  const isExpired = new Date(job.expiresAt) < new Date();
  const meta = job.fileMetadata;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="bg-white rounded-lg shadow">
        <div className="p-6 border-b">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-2xl font-bold">{job.title}</h1>
                <span className={`text-xs px-2 py-1 rounded-full capitalize ${STATUS_COLORS[job.status] || 'bg-gray-100'}`}>
                  {job.status}
                </span>
              </div>
              <p className="text-sm text-gray-500">
                Posted by {job.user.fullName} &middot;{' '}
                {new Date(job.createdAt).toLocaleDateString()}
              </p>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold text-brand-600">{job.bidCount}</div>
              <div className="text-sm text-gray-500">bids</div>
            </div>
          </div>
        </div>

        <div className="p-6 grid md:grid-cols-3 gap-6">
          <div className="md:col-span-2 space-y-4">
            {job.description && (
              <div>
                <h2 className="font-semibold text-gray-700 mb-2">Description</h2>
                <p className="text-gray-600 whitespace-pre-wrap">{job.description}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="text-sm text-gray-500">Material</div>
                <div className="font-medium">{job.materialPreferred || 'Any'}</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="text-sm text-gray-500">Quantity</div>
                <div className="font-medium">{job.quantity}</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="text-sm text-gray-500">Expires</div>
                <div className="font-medium">
                  {isExpired ? (
                    <span className="text-red-600">Expired</span>
                  ) : (
                    new Date(job.expiresAt).toLocaleDateString()
                  )}
                </div>
              </div>
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="text-sm text-gray-500">Status</div>
                <div className="font-medium capitalize">{job.status}</div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="bg-gray-50 rounded-lg p-4">
              <h3 className="font-semibold text-gray-700 mb-3">File Info</h3>
              {meta ? (
                <div className="space-y-2 text-sm">
                  {meta.fileName && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">File</span>
                      <span className="font-medium truncate ml-2">{meta.fileName}</span>
                    </div>
                  )}
                  {meta.dimensions && meta.dimensions.x > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Size (mm)</span>
                      <span className="font-medium">
                        {meta.dimensions.x.toFixed(1)} x {meta.dimensions.y.toFixed(1)} x {meta.dimensions.z.toFixed(1)}
                      </span>
                    </div>
                  )}
                  {meta.volumeCm3 !== undefined && meta.volumeCm3 > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Volume</span>
                      <span className="font-medium">{meta.volumeCm3.toFixed(1)} cm³</span>
                    </div>
                  )}
                  {meta.printabilityScore !== undefined && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Printability</span>
                      <span className={`font-medium ${meta.printabilityScore >= 80 ? 'text-green-600' : meta.printabilityScore >= 50 ? 'text-yellow-600' : 'text-red-600'}`}>
                        {meta.printabilityScore}/100
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-500">Processing file...</p>
              )}
            </div>

            {job.status === 'bidding' && !isOwner && !isExpired && user?.role === 'printer' && (
              <div className="bg-brand-50 rounded-lg p-4 text-center">
                <p className="text-sm text-brand-700 mb-2">Want to print this?</p>
                <p className="text-xs text-gray-500">Bidding will be available in Sprint 3</p>
              </div>
            )}

            {isOwner && (
              <Link
                to="/dashboard"
                className="block text-center text-sm text-brand-600 hover:text-brand-700"
              >
                Manage in Dashboard
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
