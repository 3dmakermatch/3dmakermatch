import { useState, useEffect, lazy, Suspense, type FormEvent } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import BuildPlatePlanner, { type BuildPlan } from '../components/BuildPlatePlanner';

const ModelViewer = lazy(() => import('../components/ModelViewer'));

interface JobFile {
  id: string;
  fileUrl: string;
  thumbnailUrl: string | null;
  fileName: string;
  fileMetadata: { printabilityScore?: number } | null;
  displayOrder: number;
}

interface JobDetailData {
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
  files?: JobFile[];
}

interface BidBuildPlan {
  plates: Array<{
    machineId: string;
    machineName: string;
    parts: Array<{
      fileId: string;
      position: [number, number, number];
      rotation: [number, number, number];
    }>;
  }>;
}

interface MachineData {
  id: string;
  name: string;
  type: string;
  buildVolume: { x: number; y: number; z: number };
}

interface BidData {
  id: string;
  amountCents: number;
  shippingCostCents: number;
  estimatedDays: number;
  message: string | null;
  status: string;
  createdAt: string;
  buildPlan?: BidBuildPlan | null;
  printer: {
    id: string;
    averageRating: number;
    isVerified: boolean;
    user: { id: string; fullName: string };
  };
}

interface MessageData {
  id: string;
  content: string;
  createdAt: string;
  sender: { id: string; fullName: string };
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
  const [bids, setBids] = useState<BidData[]>([]);
  const [messages, setMessages] = useState<MessageData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [bidAmount, setBidAmount] = useState('');
  const [bidShipping, setBidShipping] = useState('0');
  const [bidDays, setBidDays] = useState('');
  const [bidMessage, setBidMessage] = useState('');
  const [bidSubmitting, setBidSubmitting] = useState(false);
  const [bidError, setBidError] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [activeFileIndex, setActiveFileIndex] = useState(0);
  const [printerMachines, setPrinterMachines] = useState<MachineData[]>([]);
  const [buildPlan, setBuildPlan] = useState<BuildPlan | null>(null);
  const [showPlanner, setShowPlanner] = useState(false);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      api<JobDetailData>(`/jobs/${id}`),
      api<{ data: BidData[] }>(`/jobs/${id}/bids`).catch(() => ({ data: [] })),
      user ? api<{ data: MessageData[] }>(`/messages/threads/${id}`).catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
    ])
      .then(([jobData, bidData, msgData]) => {
        setJob(jobData);
        setBids(bidData.data);
        setMessages(msgData.data);
      })
      .catch(() => setError('Job not found'))
      .finally(() => setLoading(false));
  }, [id, user]);

  // Fetch printer's machines for the build planner
  useEffect(() => {
    if (!user?.printer?.id) return;
    api<MachineData[]>(`/printers/${user.printer.id}/machines`)
      .then((data) => setPrinterMachines(Array.isArray(data) ? data : []))
      .catch(() => setPrinterMachines([]));
  }, [user?.printer?.id]);

  const handleBidSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBidError('');
    setBidSubmitting(true);
    try {
      const bid = await api<BidData>(`/jobs/${id}/bids`, {
        method: 'POST',
        body: JSON.stringify({
          amountCents: Math.round(Number(bidAmount) * 100),
          shippingCostCents: Math.round(Number(bidShipping) * 100),
          estimatedDays: Number(bidDays),
          message: bidMessage || undefined,
          buildPlan: buildPlan || undefined,
        }),
      });
      setBids((prev) => [...prev, bid].sort((a, b) => a.amountCents - b.amountCents));
      setBidAmount('');
      setBidShipping('0');
      setBidDays('');
      setBidMessage('');
      setBuildPlan(null);
      setShowPlanner(false);
    } catch (err: unknown) {
      setBidError((err as { error?: string }).error || 'Failed to submit bid');
    } finally {
      setBidSubmitting(false);
    }
  };

  const handleAcceptBid = async (bidId: string) => {
    try {
      await api(`/bids/${bidId}/accept`, { method: 'POST' });
      window.location.reload();
    } catch (err: unknown) {
      alert((err as { error?: string }).error || 'Failed to accept bid');
    }
  };

  const handleSendMessage = async (receiverId: string) => {
    if (!newMessage.trim()) return;
    try {
      const msg = await api<MessageData>('/messages', {
        method: 'POST',
        body: JSON.stringify({ jobId: id, receiverId, content: newMessage }),
      });
      setMessages((prev) => [...prev, msg]);
      setNewMessage('');
    } catch {
      alert('Failed to send message');
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" /></div>;
  }
  if (error || !job) {
    return <div className="max-w-3xl mx-auto px-4 py-16 text-center text-gray-500">{error || 'Job not found'}</div>;
  }

  const isOwner = user?.id === job.user.id;
  const isPrinter = user?.role === 'printer';
  const isExpired = new Date(job.expiresAt) < new Date();
  const alreadyBid = bids.some((b) => b.printer.user.id === user?.id);
  const meta = job.fileMetadata;
  const files = job.files ?? [];
  const activeFile = files[activeFileIndex] ?? null;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-2xl font-bold">{job.title}</h1>
              <span className={`text-xs px-2 py-1 rounded-full capitalize ${STATUS_COLORS[job.status] || 'bg-gray-100'}`}>{job.status}</span>
            </div>
            <p className="text-sm text-gray-500">Posted by {job.user.fullName} &middot; {new Date(job.createdAt).toLocaleDateString()}</p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-brand-600">{bids.length}</div>
            <div className="text-sm text-gray-500">bids</div>
          </div>
        </div>
        {job.description && <p className="text-gray-600 mt-4 whitespace-pre-wrap">{job.description}</p>}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
          <div className="bg-gray-50 rounded p-3"><div className="text-xs text-gray-500">Material</div><div className="font-medium">{job.materialPreferred || 'Any'}</div></div>
          <div className="bg-gray-50 rounded p-3"><div className="text-xs text-gray-500">Quantity</div><div className="font-medium">{job.quantity}</div></div>
          <div className="bg-gray-50 rounded p-3"><div className="text-xs text-gray-500">Expires</div><div className="font-medium">{isExpired ? <span className="text-red-600">Expired</span> : new Date(job.expiresAt).toLocaleDateString()}</div></div>
          {meta?.printabilityScore !== undefined && (
            <div className="bg-gray-50 rounded p-3"><div className="text-xs text-gray-500">Printability</div><div className={`font-medium ${meta.printabilityScore >= 80 ? 'text-green-600' : 'text-yellow-600'}`}>{meta.printabilityScore}/100</div></div>
          )}
        </div>
      </div>

      {files.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Files</h2>
          {files.length > 1 && (
            <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
              {files.map((f, i) => (
                <button
                  key={f.id}
                  onClick={() => setActiveFileIndex(i)}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-lg border text-sm font-mono truncate max-w-[160px] transition-colors ${
                    i === activeFileIndex
                      ? 'border-brand-500 bg-brand-50 text-brand-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                  title={f.fileName}
                >
                  {f.fileName}
                </button>
              ))}
            </div>
          )}
          {activeFile && (
            <div>
              {activeFile.fileName.toLowerCase().endsWith('.stl') ? (
                <Suspense
                  fallback={
                    <div className="h-64 w-full bg-gray-50 rounded-lg border flex items-center justify-center text-gray-400 text-sm">
                      Loading preview…
                    </div>
                  }
                >
                  <ModelViewer
                    fileUrl={activeFile.fileUrl}
                    fileName={activeFile.fileName}
                    className="h-64 w-full"
                  />
                </Suspense>
              ) : activeFile.thumbnailUrl ? (
                <img
                  src={activeFile.thumbnailUrl}
                  alt={activeFile.fileName}
                  className="h-64 w-full object-contain bg-gray-50 rounded-lg border"
                />
              ) : (
                <div className="h-64 w-full bg-gray-50 rounded-lg border flex flex-col items-center justify-center text-gray-400 gap-2">
                  <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  <span className="text-sm font-mono">{activeFile.fileName}</span>
                </div>
              )}
              {activeFile.fileMetadata?.printabilityScore !== undefined && (
                <div className="mt-2 text-sm text-gray-500">
                  Printability:{' '}
                  <span
                    className={`font-medium ${
                      activeFile.fileMetadata.printabilityScore >= 80
                        ? 'text-green-600'
                        : 'text-yellow-600'
                    }`}
                  >
                    {activeFile.fileMetadata.printabilityScore}/100
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">Bids</h2>
        {bids.length === 0 ? <p className="text-gray-500">No bids yet.</p> : (
          <div className="space-y-3">
            {bids.map((bid) => (
              <div key={bid.id} className="border rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Link to={`/printers/${bid.printer.id}`} className="font-medium text-brand-600 hover:text-brand-700">{bid.printer.user.fullName}</Link>
                    {bid.printer.isVerified && <span className="ml-1 text-xs bg-green-100 text-green-800 px-1.5 py-0.5 rounded-full">Verified</span>}
                    <span className="ml-2 text-sm text-gray-500">{bid.printer.averageRating > 0 ? `${bid.printer.averageRating.toFixed(1)}/5` : 'New'}</span>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-bold">${(bid.amountCents / 100).toFixed(2)}</div>
                    {bid.shippingCostCents > 0 && <div className="text-xs text-gray-500">+${(bid.shippingCostCents / 100).toFixed(2)} shipping</div>}
                  </div>
                </div>
                <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                  <span>{bid.estimatedDays} day{bid.estimatedDays !== 1 ? 's' : ''}</span>
                  <span className={`capitalize ${bid.status === 'accepted' ? 'text-green-600 font-medium' : bid.status === 'rejected' ? 'text-red-500' : ''}`}>{bid.status}</span>
                </div>
                {bid.message && <p className="text-sm text-gray-600 mt-2">{bid.message}</p>}
                {bid.buildPlan && bid.buildPlan.plates.length > 0 && (
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-indigo-600 bg-indigo-50 px-2.5 py-1.5 rounded-md w-fit">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                    Build plan: {bid.buildPlan.plates.reduce((sum, p) => sum + p.parts.length, 0)} part{bid.buildPlan.plates.reduce((sum, p) => sum + p.parts.length, 0) !== 1 ? 's' : ''} across {bid.buildPlan.plates.length} plate{bid.buildPlan.plates.length !== 1 ? 's' : ''} on {new Set(bid.buildPlan.plates.map((p) => p.machineId)).size} machine{new Set(bid.buildPlan.plates.map((p) => p.machineId)).size !== 1 ? 's' : ''}
                  </div>
                )}
                {isOwner && bid.status === 'pending' && (
                  <button onClick={() => handleAcceptBid(bid.id)} className="mt-3 bg-green-600 text-white px-4 py-1.5 rounded text-sm hover:bg-green-700">Accept Bid</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {isPrinter && job.status === 'bidding' && !isExpired && !alreadyBid && !isOwner && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Place Your Bid</h2>
          {bidError && <div className="bg-red-50 text-red-700 p-3 rounded-lg mb-4 text-sm">{bidError}</div>}
          <form onSubmit={handleBidSubmit} className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Price ($)</label><input type="number" step="0.01" min="1" required value={bidAmount} onChange={(e) => setBidAmount(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500" /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Shipping ($)</label><input type="number" step="0.01" min="0" value={bidShipping} onChange={(e) => setBidShipping(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500" /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Est. Days</label><input type="number" min="1" max="90" required value={bidDays} onChange={(e) => setBidDays(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500" /></div>
            </div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Message (optional)</label><textarea rows={2} maxLength={2000} value={bidMessage} onChange={(e) => setBidMessage(e.target.value)} placeholder="DfAM advice, material suggestions, etc." className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500" /></div>
            {files.filter((f) => f.fileName.toLowerCase().endsWith('.stl')).length > 0 && printerMachines.length > 0 && (
              <div className="border border-gray-200 rounded-lg p-4">
                <button
                  type="button"
                  onClick={() => setShowPlanner((v) => !v)}
                  className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-indigo-600 transition-colors w-full"
                >
                  <svg className={`w-4 h-4 transition-transform ${showPlanner ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  Build Plate Planner {buildPlan ? '(configured)' : '(optional)'}
                </button>
                {showPlanner && (
                  <div className="mt-3">
                    <BuildPlatePlanner
                      files={files.filter((f) => f.fileName.toLowerCase().endsWith('.stl')).map((f) => ({ id: f.id, fileName: f.fileName, fileUrl: f.fileUrl }))}
                      machines={printerMachines}
                      onBuildPlanChange={setBuildPlan}
                    />
                  </div>
                )}
              </div>
            )}
            <button type="submit" disabled={bidSubmitting} className="bg-brand-600 text-white px-6 py-2 rounded-lg hover:bg-brand-700 disabled:opacity-50">{bidSubmitting ? 'Submitting...' : 'Submit Bid'}</button>
          </form>
        </div>
      )}

      {user && (isOwner || alreadyBid) && (
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Messages</h2>
          {messages.length === 0 ? <p className="text-gray-500 text-sm">No messages yet.</p> : (
            <div className="space-y-3 max-h-64 overflow-y-auto mb-4">
              {messages.map((msg) => (
                <div key={msg.id} className={`p-3 rounded-lg ${msg.sender.id === user.id ? 'bg-brand-50 ml-8' : 'bg-gray-50 mr-8'}`}>
                  <div className="flex justify-between text-xs text-gray-500 mb-1"><span className="font-medium">{msg.sender.fullName}</span><span>{new Date(msg.createdAt).toLocaleString()}</span></div>
                  <p className="text-sm">{msg.content}</p>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input type="text" value={newMessage} onChange={(e) => setNewMessage(e.target.value)} placeholder="Type a message..."
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const rid = isOwner ? bids[0]?.printer.user.id : job.user.id; if (rid) handleSendMessage(rid); } }} />
            <button onClick={() => { const rid = isOwner ? bids[0]?.printer.user.id : job.user.id; if (rid) handleSendMessage(rid); }}
              className="bg-brand-600 text-white px-4 py-2 rounded-lg hover:bg-brand-700">Send</button>
          </div>
        </div>
      )}
    </div>
  );
}
