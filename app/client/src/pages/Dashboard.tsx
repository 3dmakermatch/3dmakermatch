import { useAuth } from '../context/AuthContext';

export default function Dashboard() {
  const { user } = useAuth();

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
          <h2 className="text-lg font-semibold mb-4">Your Print Jobs</h2>
          <p className="text-gray-500">No print jobs yet. Upload a design to get started!</p>
        </div>
      )}

      {user?.role === 'printer' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">Available Jobs</h2>
            <p className="text-gray-500">No open jobs in your area yet. Check back soon!</p>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">Your Bids</h2>
            <p className="text-gray-500">You haven't placed any bids yet.</p>
          </div>
        </div>
      )}
    </div>
  );
}
