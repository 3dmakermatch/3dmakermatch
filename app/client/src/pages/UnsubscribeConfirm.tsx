import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { api } from '../lib/api';

type PageState = 'loading' | 'confirm' | 'success' | 'error';

const CATEGORY_LABELS: Record<string, string> = {
  bids: 'bid',
  orders: 'order update',
  messages: 'message',
  reviews: 'review',
  marketing: 'marketing',
  jobAlerts: 'job alert',
};

export default function UnsubscribeConfirm() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const category = searchParams.get('category') || '';

  const [state, setState] = useState<PageState>('loading');
  const [confirmedCategory, setConfirmedCategory] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (!token || !category) {
      setErrorMsg('This unsubscribe link is missing required information.');
      setState('error');
      return;
    }

    async function validate() {
      try {
        const data = await api<{ valid: boolean; category: string }>(
          `/unsubscribe?token=${encodeURIComponent(token)}&category=${encodeURIComponent(category)}`,
        );
        if (data.valid) {
          setConfirmedCategory(data.category);
          setState('confirm');
        } else {
          setErrorMsg('This unsubscribe link is not valid.');
          setState('error');
        }
      } catch {
        setErrorMsg('This unsubscribe link is invalid or has expired.');
        setState('error');
      }
    }

    validate();
  }, [token, category]);

  async function handleConfirm() {
    setProcessing(true);
    try {
      await api('/unsubscribe', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });
      setState('success');
    } catch {
      setErrorMsg('Failed to process your unsubscribe request. Please try again.');
      setState('error');
    } finally {
      setProcessing(false);
    }
  }

  const categoryLabel = CATEGORY_LABELS[confirmedCategory] || confirmedCategory;

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-900">3dMakerMatch</h1>
          <p className="text-sm text-gray-400 mt-0.5">Email Preferences</p>
        </div>

        {state === 'loading' && (
          <div className="py-8">
            <div className="animate-spin h-8 w-8 border-2 border-purple-600 border-t-transparent rounded-full mx-auto mb-4" />
            <p className="text-gray-500 text-sm">Validating your unsubscribe link...</p>
          </div>
        )}

        {state === 'confirm' && (
          <div>
            <div className="w-14 h-14 bg-purple-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Unsubscribe from {categoryLabel} notifications?</h2>
            <p className="text-sm text-gray-500 mb-6">
              You will no longer receive <strong>{categoryLabel}</strong> emails from 3dMakerMatch.
              You can re-enable them anytime in your{' '}
              <Link to="/settings/notifications" className="text-purple-600 hover:underline">
                notification settings
              </Link>.
            </p>
            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={handleConfirm}
                disabled={processing}
                className="w-full px-4 py-2.5 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {processing ? 'Processing...' : `Yes, unsubscribe me`}
              </button>
              <Link
                to="/"
                className="w-full px-4 py-2.5 border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </Link>
            </div>
          </div>
        )}

        {state === 'success' && (
          <div>
            <div className="w-14 h-14 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">You've been unsubscribed</h2>
            <p className="text-sm text-gray-500 mb-6">
              You will no longer receive <strong>{categoryLabel}</strong> emails. You can re-enable
              notifications anytime in your account settings.
            </p>
            <Link
              to="/settings/notifications"
              className="inline-flex items-center px-4 py-2 text-sm font-medium text-purple-600 hover:text-purple-700 hover:underline"
            >
              Manage notification settings
            </Link>
          </div>
        )}

        {state === 'error' && (
          <div>
            <div className="w-14 h-14 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 3a9 9 0 110 18A9 9 0 0112 3z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Something went wrong</h2>
            <p className="text-sm text-gray-500 mb-6">{errorMsg}</p>
            <Link
              to="/"
              className="inline-flex items-center px-4 py-2 text-sm font-medium text-purple-600 hover:text-purple-700 hover:underline"
            >
              Return to homepage
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
