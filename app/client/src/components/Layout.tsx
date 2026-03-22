import { Link, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-white border-b border-gray-200">
        <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link to="/" className="text-xl font-bold text-brand-700">
            3dMakerMatch
          </Link>

          <div className="flex items-center gap-6">
            <Link to="/jobs" className="text-sm text-gray-600 hover:text-gray-900">
              Print Jobs
            </Link>
            <Link to="/printers" className="text-sm text-gray-600 hover:text-gray-900">
              Find Printers
            </Link>

            {user ? (
              <>
                <Link to="/dashboard" className="text-sm text-gray-600 hover:text-gray-900">
                  Dashboard
                </Link>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-500">{user.fullName}</span>
                  <button
                    onClick={logout}
                    className="text-sm text-red-600 hover:text-red-800"
                  >
                    Logout
                  </button>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-3">
                <Link
                  to="/login"
                  className="text-sm text-gray-600 hover:text-gray-900"
                >
                  Login
                </Link>
                <Link
                  to="/register"
                  className="text-sm bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700"
                >
                  Sign Up
                </Link>
              </div>
            )}
          </div>
        </nav>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="bg-white border-t border-gray-200 py-8">
        <div className="max-w-7xl mx-auto px-4 text-center text-sm text-gray-500">
          &copy; {new Date().getFullYear()} 3dMakerMatch. Local 3D printing, expert results.
        </div>
      </footer>
    </div>
  );
}
