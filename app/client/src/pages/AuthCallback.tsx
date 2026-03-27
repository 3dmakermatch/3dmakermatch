import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { setAccessToken } from '../lib/api';

export default function AuthCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  useEffect(() => {
    const token = params.get('token');
    if (token) {
      setAccessToken(token);
      // Reload so AuthProvider re-initialises and fetches the user
      window.location.replace('/dashboard');
    } else {
      navigate('/login');
    }
  }, [params, navigate]);

  return (
    <div className="flex items-center justify-center h-64">
      <p className="text-gray-600">Signing in...</p>
    </div>
  );
}
