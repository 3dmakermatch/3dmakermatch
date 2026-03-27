import { useState, useEffect } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { api } from '../lib/api';

export default function StripeOnboard() {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const isRefresh = searchParams.get('refresh') === 'true';

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mockSuccess, setMockSuccess] = useState(false);

  useEffect(() => {
    // If redirected back with ?refresh=true, just show the retry message
  }, [isRefresh]);

  const handleSetupPayments = async () => {
    setLoading(true);
    setError('');
    try {
      const { onboardingUrl } = await api<{ onboardingUrl: string }>(
        '/printers/stripe/onboard',
        { method: 'POST' },
      );
      if (onboardingUrl.includes('?mock=true')) {
        setMockSuccess(true);
      } else {
        window.location.href = onboardingUrl;
      }
    } catch (err: unknown) {
      setError((err as { error?: string }).error ?? 'Failed to start onboarding');
    } finally {
      setLoading(false);
    }
  };

  if (isRefresh) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16 text-center">
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-8">
          <div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold mb-2 text-yellow-800">Onboarding Incomplete</h2>
          <p className="text-yellow-700 mb-6 text-sm">
            Your Stripe onboarding session expired or was not completed. Please try again to finish setting up your payment account.
          </p>
          <button
            onClick={handleSetupPayments}
            disabled={loading}
            className="bg-brand-600 text-white px-6 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-50 text-sm font-medium"
          >
            {loading ? 'Loading...' : 'Retry Setup'}
          </button>
          {error && <p className="mt-3 text-red-600 text-sm">{error}</p>}
          <div className="mt-4">
            <Link to="/dashboard" className="text-sm text-gray-500 hover:text-gray-700">
              Back to Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (mockSuccess) {
    return (
      <div className="max-w-lg mx-auto px-4 py-16 text-center">
        <div className="bg-green-50 border border-green-200 rounded-xl p-8">
          <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold mb-2 text-green-800">Payments Enabled</h2>
          <p className="text-green-700 mb-6 text-sm">
            Your payment account has been set up successfully. You can now receive payments for accepted bids.
          </p>
          <Link
            to="/dashboard"
            className="bg-brand-600 text-white px-6 py-2 rounded-lg hover:bg-brand-700 text-sm font-medium inline-block"
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-16">
      <div className="bg-white rounded-xl shadow p-8">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-brand-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold mb-2">Connect Your Stripe Account</h1>
          <p className="text-gray-600 text-sm">
            Connect your Stripe account to receive payments when buyers accept your bids.
          </p>
        </div>

        <div className="space-y-4 mb-8">
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 bg-brand-100 rounded-full flex items-center justify-center shrink-0 mt-0.5">
              <span className="text-xs font-bold text-brand-600">1</span>
            </div>
            <div>
              <p className="text-sm font-medium">Secure & trusted</p>
              <p className="text-xs text-gray-500">Stripe handles all payment processing. 3dMakerMatch never stores your banking details.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 bg-brand-100 rounded-full flex items-center justify-center shrink-0 mt-0.5">
              <span className="text-xs font-bold text-brand-600">2</span>
            </div>
            <div>
              <p className="text-sm font-medium">Fast payouts</p>
              <p className="text-xs text-gray-500">Funds are transferred to your bank account after jobs are completed.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 bg-brand-100 rounded-full flex items-center justify-center shrink-0 mt-0.5">
              <span className="text-xs font-bold text-brand-600">3</span>
            </div>
            <div>
              <p className="text-sm font-medium">One-time setup</p>
              <p className="text-xs text-gray-500">Complete the Stripe onboarding once, then receive payments for all future jobs.</p>
            </div>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">
            {error}
          </div>
        )}

        <button
          onClick={handleSetupPayments}
          disabled={loading}
          className="w-full bg-brand-600 text-white py-3 rounded-lg hover:bg-brand-700 disabled:opacity-50 font-medium transition-colors"
        >
          {loading ? 'Loading...' : 'Set Up Payments'}
        </button>

        <div className="mt-4 text-center">
          <Link to="/dashboard" className="text-sm text-gray-500 hover:text-gray-700">
            Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
