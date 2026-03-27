import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';

interface EmailPreferences {
  bids?: boolean;
  orders?: boolean;
  messages?: boolean;
  reviews?: boolean;
  marketing?: boolean;
  jobAlerts?: 'instant' | 'hourly' | 'daily' | 'weekly' | 'off';
}

interface UserWithPrefs {
  id: string;
  email: string;
  fullName: string;
  role: string;
  emailPreferences?: EmailPreferences;
  printer?: { id: string } | null;
}

const JOB_ALERT_OPTIONS: { value: string; label: string }[] = [
  { value: 'instant', label: 'Instant' },
  { value: 'hourly', label: 'Hourly digest' },
  { value: 'daily', label: 'Daily digest' },
  { value: 'weekly', label: 'Weekly digest' },
  { value: 'off', label: 'Off' },
];

const TOGGLE_PREFS: { key: keyof EmailPreferences; label: string; description: string }[] = [
  { key: 'bids', label: 'Bid notifications', description: 'Get notified when someone bids on your job or your bid status changes.' },
  { key: 'orders', label: 'Order updates', description: 'Receive updates on order status changes, shipping, and delivery.' },
  { key: 'messages', label: 'Message notifications', description: 'Get notified when you receive a new message about a job.' },
  { key: 'reviews', label: 'Review notifications', description: 'Get notified when a customer leaves you a review.' },
  { key: 'marketing', label: 'Marketing emails', description: 'Receive tips, platform news, and promotional content.' },
];

export default function NotificationSettings() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<EmailPreferences>({});
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [error, setError] = useState('');
  const [isPrinter, setIsPrinter] = useState(false);

  useEffect(() => {
    async function fetchPrefs() {
      try {
        const data = await api<UserWithPrefs>('/auth/me');
        setPrefs(data.emailPreferences || {});
        setIsPrinter(!!data.printer);
      } catch {
        setError('Failed to load notification preferences.');
      }
    }
    fetchPrefs();
  }, []);

  function getToggleValue(key: keyof EmailPreferences): boolean {
    const val = prefs[key];
    if (val === undefined || val === null) return true;
    return val as boolean;
  }

  function handleToggle(key: keyof EmailPreferences) {
    setPrefs((prev) => ({ ...prev, [key]: !getToggleValue(key) }));
  }

  function handleJobAlerts(value: string) {
    setPrefs((prev) => ({ ...prev, jobAlerts: value as EmailPreferences['jobAlerts'] }));
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    setSavedMsg('');
    try {
      await api('/users/me/email-preferences', {
        method: 'PATCH',
        body: JSON.stringify(prefs),
      });
      setSavedMsg('Preferences saved!');
      setTimeout(() => setSavedMsg(''), 3000);
    } catch {
      setError('Failed to save preferences. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Notification Settings</h1>
      <p className="text-gray-500 mb-8">
        Control which emails you receive from 3dMakerMatch.
      </p>

      {error && (
        <div className="mb-6 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-red-700 text-sm">
          {error}
        </div>
      )}

      <div className="space-y-6">
        {TOGGLE_PREFS.map(({ key, label, description }) => (
          <div key={key} className="flex items-start justify-between gap-6 py-4 border-b border-gray-100">
            <div>
              <p className="text-sm font-medium text-gray-900">{label}</p>
              <p className="text-sm text-gray-500 mt-0.5">{description}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={getToggleValue(key)}
              onClick={() => handleToggle(key)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-purple-600 focus:ring-offset-2 ${
                getToggleValue(key) ? 'bg-purple-600' : 'bg-gray-200'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
                  getToggleValue(key) ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        ))}

        {isPrinter && (
          <div className="py-4 border-b border-gray-100">
            <p className="text-sm font-medium text-gray-900 mb-1">Job alert frequency</p>
            <p className="text-sm text-gray-500 mb-3">
              How often to notify you when new jobs matching your capabilities are posted.
            </p>
            <div className="flex flex-wrap gap-3">
              {JOB_ALERT_OPTIONS.map(({ value, label }) => (
                <label
                  key={value}
                  className={`flex items-center gap-2 px-4 py-2 rounded-full border cursor-pointer text-sm transition-colors ${
                    (prefs.jobAlerts || 'instant') === value
                      ? 'border-purple-600 bg-purple-50 text-purple-700 font-medium'
                      : 'border-gray-200 text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="jobAlerts"
                    value={value}
                    checked={(prefs.jobAlerts || 'instant') === value}
                    onChange={() => handleJobAlerts(value)}
                    className="sr-only"
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-8 flex items-center gap-4">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center px-6 py-2.5 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? 'Saving...' : 'Save preferences'}
        </button>
        {savedMsg && (
          <span className="text-sm text-green-600 font-medium">{savedMsg}</span>
        )}
      </div>

      {user && (
        <p className="mt-6 text-xs text-gray-400">
          Notifications are sent to <strong>{user.email}</strong>. You can always unsubscribe from any email using the link at the bottom of that message.
        </p>
      )}
    </div>
  );
}
