import { useState, useEffect, useRef } from 'react';
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

interface PrinterMachine {
  id: string;
  name: string;
  type: string;
  materials: string[];
  buildVolume: { x: number; y: number; z: number };
}

interface PrinterProfile {
  id: string;
  stripeAccountId: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  bidding: 'bg-green-100 text-green-700',
  active: 'bg-blue-100 text-blue-700',
  completed: 'bg-purple-100 text-purple-700',
  cancelled: 'bg-red-100 text-red-700',
};

const MACHINE_TYPES = ['FDM', 'SLA', 'SLS'];

const BLANK_FORM = {
  name: '',
  type: 'FDM',
  materialsRaw: '',
  bvX: '',
  bvY: '',
  bvZ: '',
};

export default function Dashboard() {
  const { user } = useAuth();
  const [myJobs, setMyJobs] = useState<JobSummary[]>([]);
  const [openJobs, setOpenJobs] = useState<JobSummary[]>([]);
  const [machines, setMachines] = useState<PrinterMachine[]>([]);
  const [printerProfile, setPrinterProfile] = useState<PrinterProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Add machine form state
  const [showAddMachine, setShowAddMachine] = useState(false);
  const [machineForm, setMachineForm] = useState(BLANK_FORM);
  const [machineFormError, setMachineFormError] = useState('');
  const [savingMachine, setSavingMachine] = useState(false);

  // Edit machine state
  const [editingMachine, setEditingMachine] = useState<PrinterMachine | null>(null);
  const [editForm, setEditForm] = useState(BLANK_FORM);
  const [editFormError, setEditFormError] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const [deletingMachineId, setDeletingMachineId] = useState<string | null>(null);

  const printerId = user?.printer?.id;
  const addFormRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = async () => {
      try {
        if (user?.role === 'buyer') {
          const res = await api<JobResponse>('/jobs/mine');
          setMyJobs(res.data);
        } else if (user?.role === 'printer') {
          const [jobsRes, machinesRes, profileRes] = await Promise.all([
            api<JobResponse>('/jobs?limit=10'),
            printerId
              ? api<PrinterMachine[]>(`/printers/${printerId}/machines`).catch(() => [])
              : Promise.resolve([]),
            printerId
              ? api<PrinterProfile>(`/printers/${printerId}`).catch(() => null)
              : Promise.resolve(null),
          ]);
          setOpenJobs(jobsRes.data);
          setMachines(machinesRes);
          setPrinterProfile(profileRes);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user, printerId]);

  const parseMaterials = (raw: string): string[] =>
    raw.split(',').map((s) => s.trim()).filter(Boolean);

  const handleAddMachine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!printerId) return;
    setMachineFormError('');
    const bvX = parseFloat(machineForm.bvX);
    const bvY = parseFloat(machineForm.bvY);
    const bvZ = parseFloat(machineForm.bvZ);
    if (!machineForm.name.trim()) { setMachineFormError('Name is required'); return; }
    if (isNaN(bvX) || bvX <= 0 || isNaN(bvY) || bvY <= 0 || isNaN(bvZ) || bvZ <= 0) {
      setMachineFormError('Build volume X, Y, Z must be positive numbers'); return;
    }
    setSavingMachine(true);
    try {
      const created = await api<PrinterMachine>(`/printers/${printerId}/machines`, {
        method: 'POST',
        body: JSON.stringify({
          name: machineForm.name.trim(),
          type: machineForm.type,
          materials: parseMaterials(machineForm.materialsRaw),
          buildVolume: { x: bvX, y: bvY, z: bvZ },
        }),
      });
      setMachines((prev) => [...prev, created]);
      setMachineForm(BLANK_FORM);
      setShowAddMachine(false);
    } catch (err: unknown) {
      const msg = (err as { error?: string })?.error ?? 'Failed to add machine';
      setMachineFormError(msg);
    } finally {
      setSavingMachine(false);
    }
  };

  const startEdit = (machine: PrinterMachine) => {
    setEditingMachine(machine);
    setEditFormError('');
    setEditForm({
      name: machine.name,
      type: machine.type,
      materialsRaw: machine.materials.join(', '),
      bvX: String(machine.buildVolume.x),
      bvY: String(machine.buildVolume.y),
      bvZ: String(machine.buildVolume.z),
    });
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!printerId || !editingMachine) return;
    setEditFormError('');
    const bvX = parseFloat(editForm.bvX);
    const bvY = parseFloat(editForm.bvY);
    const bvZ = parseFloat(editForm.bvZ);
    if (!editForm.name.trim()) { setEditFormError('Name is required'); return; }
    if (isNaN(bvX) || bvX <= 0 || isNaN(bvY) || bvY <= 0 || isNaN(bvZ) || bvZ <= 0) {
      setEditFormError('Build volume X, Y, Z must be positive numbers'); return;
    }
    setSavingEdit(true);
    try {
      const updated = await api<PrinterMachine>(`/printers/${printerId}/machines/${editingMachine.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: editForm.name.trim(),
          type: editForm.type,
          materials: parseMaterials(editForm.materialsRaw),
          buildVolume: { x: bvX, y: bvY, z: bvZ },
        }),
      });
      setMachines((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
      setEditingMachine(null);
    } catch (err: unknown) {
      const msg = (err as { error?: string })?.error ?? 'Failed to update machine';
      setEditFormError(msg);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteMachine = async (machineId: string) => {
    if (!printerId || !window.confirm('Delete this machine?')) return;
    setDeletingMachineId(machineId);
    try {
      await api(`/printers/${printerId}/machines/${machineId}`, { method: 'DELETE' });
      setMachines((prev) => prev.filter((m) => m.id !== machineId));
    } catch {
      alert('Failed to delete machine');
    } finally {
      setDeletingMachineId(null);
    }
  };

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
          {/* Stripe payment status banner */}
          {printerProfile && !printerProfile.stripeAccountId && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <svg className="w-5 h-5 text-yellow-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
                <p className="text-sm text-yellow-800">
                  Set up Stripe to receive payments when buyers accept your bids.
                </p>
              </div>
              <Link
                to="/printers/stripe/onboard"
                className="ml-4 shrink-0 bg-yellow-600 text-white px-4 py-1.5 rounded-lg text-sm hover:bg-yellow-700 font-medium"
              >
                Set Up Payments
              </Link>
            </div>
          )}
          {printerProfile?.stripeAccountId && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-3">
              <svg className="w-5 h-5 text-green-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-sm text-green-800 font-medium">Payments enabled</span>
            </div>
          )}

          {/* My Machines */}
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">My Machines</h2>
              {printerId && (
                <button
                  onClick={() => { setShowAddMachine((v) => !v); setMachineFormError(''); }}
                  className="bg-brand-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-brand-700"
                >
                  {showAddMachine ? 'Cancel' : 'Add Machine'}
                </button>
              )}
            </div>

            {showAddMachine && (
              <div ref={addFormRef} className="mb-6 border border-gray-200 rounded-lg p-4 bg-gray-50">
                <h3 className="font-medium mb-3 text-sm">New Machine</h3>
                <form onSubmit={handleAddMachine} className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Name *</label>
                      <input
                        type="text"
                        required
                        value={machineForm.name}
                        onChange={(e) => setMachineForm((f) => ({ ...f, name: e.target.value }))}
                        placeholder="e.g. Prusa MK4"
                        className="w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Type *</label>
                      <select
                        value={machineForm.type}
                        onChange={(e) => setMachineForm((f) => ({ ...f, type: e.target.value }))}
                        className="w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
                      >
                        {MACHINE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Materials (comma-separated)</label>
                    <input
                      type="text"
                      value={machineForm.materialsRaw}
                      onChange={(e) => setMachineForm((f) => ({ ...f, materialsRaw: e.target.value }))}
                      placeholder="e.g. PLA, PETG, ABS"
                      className="w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Build Volume (mm) *</label>
                    <div className="grid grid-cols-3 gap-2">
                      {(['bvX', 'bvY', 'bvZ'] as const).map((k, i) => (
                        <input
                          key={k}
                          type="number"
                          min="0.1"
                          step="0.1"
                          required
                          placeholder={['X', 'Y', 'Z'][i]}
                          value={machineForm[k]}
                          onChange={(e) => setMachineForm((f) => ({ ...f, [k]: e.target.value }))}
                          className="w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
                        />
                      ))}
                    </div>
                  </div>
                  {machineFormError && <p className="text-xs text-red-600">{machineFormError}</p>}
                  <button
                    type="submit"
                    disabled={savingMachine}
                    className="bg-brand-600 text-white px-4 py-2 rounded text-sm hover:bg-brand-700 disabled:opacity-50"
                  >
                    {savingMachine ? 'Saving...' : 'Add Machine'}
                  </button>
                </form>
              </div>
            )}

            {machines.length === 0 ? (
              <p className="text-gray-500 text-sm">No machines added yet. Add your first machine above!</p>
            ) : (
              <div className="space-y-3">
                {machines.map((machine) => (
                  <div key={machine.id}>
                    {editingMachine?.id === machine.id ? (
                      <div className="border border-brand-200 rounded-lg p-4 bg-brand-50">
                        <h3 className="font-medium mb-3 text-sm">Edit Machine</h3>
                        <form onSubmit={handleSaveEdit} className="space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Name *</label>
                              <input
                                type="text"
                                required
                                value={editForm.name}
                                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                                className="w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-700 mb-1">Type *</label>
                              <select
                                value={editForm.type}
                                onChange={(e) => setEditForm((f) => ({ ...f, type: e.target.value }))}
                                className="w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
                              >
                                {MACHINE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                              </select>
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Materials (comma-separated)</label>
                            <input
                              type="text"
                              value={editForm.materialsRaw}
                              onChange={(e) => setEditForm((f) => ({ ...f, materialsRaw: e.target.value }))}
                              className="w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Build Volume (mm) *</label>
                            <div className="grid grid-cols-3 gap-2">
                              {(['bvX', 'bvY', 'bvZ'] as const).map((k, i) => (
                                <input
                                  key={k}
                                  type="number"
                                  min="0.1"
                                  step="0.1"
                                  required
                                  placeholder={['X', 'Y', 'Z'][i]}
                                  value={editForm[k]}
                                  onChange={(e) => setEditForm((f) => ({ ...f, [k]: e.target.value }))}
                                  className="w-full border rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
                                />
                              ))}
                            </div>
                          </div>
                          {editFormError && <p className="text-xs text-red-600">{editFormError}</p>}
                          <div className="flex gap-2">
                            <button
                              type="submit"
                              disabled={savingEdit}
                              className="bg-brand-600 text-white px-4 py-2 rounded text-sm hover:bg-brand-700 disabled:opacity-50"
                            >
                              {savingEdit ? 'Saving...' : 'Save'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingMachine(null)}
                              className="border border-gray-300 text-gray-700 px-4 py-2 rounded text-sm hover:bg-gray-50"
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between p-3 rounded-lg border border-gray-200 hover:bg-gray-50">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-sm">{machine.name}</span>
                            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{machine.type}</span>
                          </div>
                          {machine.materials.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-1">
                              {machine.materials.map((mat) => (
                                <span key={mat} className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">{mat}</span>
                              ))}
                            </div>
                          )}
                          <p className="text-xs text-gray-500">
                            {machine.buildVolume.x}&times;{machine.buildVolume.y}&times;{machine.buildVolume.z} mm
                          </p>
                        </div>
                        <div className="flex items-center gap-2 ml-3 shrink-0">
                          <button
                            onClick={() => startEdit(machine)}
                            className="text-xs text-brand-600 hover:text-brand-700"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteMachine(machine.id)}
                            disabled={deletingMachineId === machine.id}
                            className="text-xs text-red-600 hover:text-red-700 disabled:opacity-50"
                          >
                            {deletingMachineId === machine.id ? 'Deleting...' : 'Delete'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Open Jobs */}
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
