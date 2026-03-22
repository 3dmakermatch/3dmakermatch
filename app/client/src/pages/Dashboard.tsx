import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';

interface JobSummary {
  id: string;
  title: string;
  status: string;
  bidCount: number;
  createdAt: string;
  materialPreferred: string | null;
}

interface JobResponse {
  data: JobSummary[];
  total: number;
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  bidding: 'bg-green-100 text-green-700',
  active: 'bg-blue-100 text-blue-700',
  completed: 'bg-purple-100 text-purple-700',
  cancelled: 'bg-red-100 text-red-700',
};

export default function Dashboard() {
  const { user } = useAuth();
  const [myJobs, setMyJobs] = useState<JobSummary[]>([]);
  const [openJobs, setOpenJobs] = useState<JobSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        if (user?.role === 'buyer') {
          const res = await api<JobResponse>('/jobs/mine');
          setMyJobs(res.data);
        } else if (user?.role === 'printer') {
          const res = await api<JobResponse>('/jobs?limit=10');
          setOpenJobs(res.data);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Dashboard</h1>

      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Welcome, {user?.fullName}</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Role:</span>{' '}
            <span className="capitalize font-medium">{user?.role}</span>
          </div>
          <div>
            <span className="text-gray-500">Email:</span>{' '}
            <span className="font-medium">{user?.email}</span>
          </div>
        </div>
      </div>

      {user?.role === 'buyer' && (
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Your Print Jobs</h2>
            <Link
              to="/jobs/new"
              className="bg-brand-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-brand-700"
            >
              Post a Job
            </Link>
          </div>
          {myJobs.length === 0 ? (
            <p className="text-gray-500">No print jobs yet. Upload a design to get started!</p>
          ) : (
            <div className="space-y-3">
              {myJobs.map((job) => (
                <Link
                  key={job.id}
                  to={`/jobs/${job.id}`}
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 border"
                >
                  <div>
                    <span className="font-medium">{job.title}</span>
                    <span className={`ml-2 text-xs px-2 py-0.5 rounded-full capitalize ${STATUS_COLORS[job.status] || ''}`}>
                      {job.status}
                    </span>
                  </div>
                  <div className="text-sm text-gray-500">
                    {job.bidCount} bids
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {user?.role === 'printer' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Open Jobs Near You</h2>
              <Link to="/jobs" className="text-sm text-brand-600 hover:text-brand-700">
                View All
              </Link>
            </div>
            {openJobs.length === 0 ? (
              <p className="text-gray-500">No open jobs right now. Check back soon!</p>
            ) : (
              <div className="space-y-3">
                {openJobs.map((job) => (
                  <Link
                    key={job.id}
                    to={`/jobs/${job.id}`}
                    className="flex items-center justify-between p-3 rounded-lg hover:bg-gray-50 border"
                  >
                    <div>
                      <span className="font-medium">{job.title}</span>
                      {job.materialPreferred && (
                        <span className="ml-2 text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">
                          {job.materialPreferred}
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-gray-500">
                      {job.bidCount} bids
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
