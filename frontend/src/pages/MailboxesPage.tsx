import React, { useEffect, useState, useCallback } from 'react';
import { mailboxesApi } from '../api/client';
import {
  Plus, Trash2, CheckCircle2, AlertCircle, Clock, Mail, Settings,
  RefreshCw, Eye, EyeOff, X, Star, Send, Pause,
} from 'lucide-react';

interface AwsSettings {
  configured: boolean;
  access_key_id_masked: string | null;
  region: string | null;
  set_at: string | null;
  in_sandbox: boolean;
  quota: { max_24_hour: number; max_send_rate: number; checked_at: string } | null;
}

interface Mailbox {
  id: string;
  from_email: string;
  from_name: string | null;
  reply_to_email: string | null;
  signature_html: string | null;
  status: 'pending' | 'verified' | 'failed' | 'disabled';
  daily_send_limit: number;
  daily_sent_count: number;
  total_sent_count: number;
  last_used_at: string | null;
  is_default: boolean;
  is_active: boolean;
  last_verification_check_at: string | null;
}

interface Capacity {
  totalCapacity: number;
  capacityRemaining: number;
  activeMailboxCount: number;
  verifiedMailboxCount: number;
}

const REGIONS = [
  { value: 'us-east-1', label: 'US East (N. Virginia) – us-east-1' },
  { value: 'us-east-2', label: 'US East (Ohio) – us-east-2' },
  { value: 'us-west-1', label: 'US West (N. California) – us-west-1' },
  { value: 'us-west-2', label: 'US West (Oregon) – us-west-2' },
  { value: 'eu-west-1', label: 'Europe (Ireland) – eu-west-1' },
  { value: 'eu-west-2', label: 'Europe (London) – eu-west-2' },
  { value: 'eu-central-1', label: 'Europe (Frankfurt) – eu-central-1' },
  { value: 'ap-south-1', label: 'Asia Pacific (Mumbai) – ap-south-1' },
  { value: 'ap-southeast-1', label: 'Asia Pacific (Singapore) – ap-southeast-1' },
  { value: 'ap-southeast-2', label: 'Asia Pacific (Sydney) – ap-southeast-2' },
  { value: 'ap-northeast-1', label: 'Asia Pacific (Tokyo) – ap-northeast-1' },
];

export default function MailboxesPage() {
  const [tab, setTab] = useState<'mailboxes' | 'aws'>('mailboxes');
  const [aws, setAws] = useState<AwsSettings | null>(null);
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [capacity, setCapacity] = useState<Capacity | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddMailbox, setShowAddMailbox] = useState(false);
  const [showAwsForm, setShowAwsForm] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [awsRes, mbRes] = await Promise.all([
        mailboxesApi.getAwsSettings(),
        mailboxesApi.list().catch(() => ({ data: { mailboxes: [], capacity: null } })),
      ]);
      setAws(awsRes.data);
      setMailboxes(mbRes.data.mailboxes || []);
      setCapacity(mbRes.data.capacity || null);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Email Sending</h1>
          <p className="text-surface-500 text-sm mt-0.5">
            Configure AWS SES and manage sender mailboxes for your sequences
          </p>
        </div>
        {tab === 'mailboxes' && aws?.configured && (
          <button onClick={() => setShowAddMailbox(true)} className="btn-primary">
            <Plus className="w-4 h-4" />Add Sender
          </button>
        )}
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 border-b border-surface-200">
        <button
          onClick={() => setTab('mailboxes')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === 'mailboxes' ? 'border-brand-500 text-brand-700' : 'border-transparent text-surface-500 hover:text-surface-900'
          }`}
        >
          <Mail className="w-4 h-4 inline mr-1.5" />Mailboxes ({mailboxes.length})
        </button>
        <button
          onClick={() => setTab('aws')}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === 'aws' ? 'border-brand-500 text-brand-700' : 'border-transparent text-surface-500 hover:text-surface-900'
          }`}
        >
          <Settings className="w-4 h-4 inline mr-1.5" />AWS Credentials
        </button>
      </div>

      {/* Tab content */}
      {tab === 'aws' ? (
        <AwsTab aws={aws} onSave={() => { setShowAwsForm(false); fetchAll(); }} showForm={showAwsForm} setShowForm={setShowAwsForm} />
      ) : (
        <MailboxesTab
          mailboxes={mailboxes} capacity={capacity}
          aws={aws}
          onRefresh={fetchAll}
        />
      )}

      {showAddMailbox && (
        <AddMailboxModal
          onClose={() => setShowAddMailbox(false)}
          onSuccess={() => { setShowAddMailbox(false); fetchAll(); }}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════
// AWS CREDENTIALS TAB
// ════════════════════════════════════════════════════
function AwsTab({
  aws, onSave, showForm, setShowForm,
}: {
  aws: AwsSettings | null;
  onSave: () => void;
  showForm: boolean;
  setShowForm: (b: boolean) => void;
}) {
  const [accessKey, setAccessKey] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [region, setRegion] = useState('us-east-1');
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await mailboxesApi.saveAwsSettings({
        access_key_id: accessKey.trim(),
        secret_access_key: secretKey.trim(),
        region,
      });
      if (res.data.warning) alert(res.data.warning);
      setAccessKey('');
      setSecretKey('');
      onSave();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to save credentials');
    } finally {
      setSaving(false);
    }
  };

  const handleRefreshQuota = async () => {
    setRefreshing(true);
    try {
      await mailboxesApi.refreshQuota();
      onSave();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to refresh quota');
    } finally {
      setRefreshing(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Remove AWS credentials? Existing mailboxes will be retained but cannot send until credentials are re-added.')) return;
    try {
      await mailboxesApi.deleteAwsSettings();
      onSave();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to delete');
    }
  };

  return (
    <div className="space-y-4">
      {!aws?.configured || showForm ? (
        <div className="card p-6">
          <h3 className="font-semibold mb-1">{aws?.configured ? 'Update AWS credentials' : 'Connect AWS SES'}</h3>
          <p className="text-sm text-surface-500 mb-4">
            Your AWS Access Key + Secret will be encrypted at rest. The key needs <code className="bg-surface-100 px-1 rounded">AmazonSESFullAccess</code> permission.
          </p>

          <div className="space-y-3">
            <div>
              <label className="label">AWS Access Key ID *</label>
              <input
                type="text"
                placeholder="AKIA..."
                className="input font-mono text-sm"
                value={accessKey}
                onChange={(e) => setAccessKey(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div>
              <label className="label">AWS Secret Access Key *</label>
              <div className="relative">
                <input
                  type={showSecret ? 'text' : 'password'}
                  placeholder="••••••••••••••••••••••••••"
                  className="input pr-10 font-mono text-sm"
                  value={secretKey}
                  onChange={(e) => setSecretKey(e.target.value)}
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret(!showSecret)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-surface-400 hover:text-surface-700"
                >
                  {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="label">AWS Region *</label>
              <select className="input" value={region} onChange={(e) => setRegion(e.target.value)}>
                {REGIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
              <p className="text-xs text-surface-400 mt-1">
                Pick the region where you'll verify your sender domain. Cannot be changed easily later.
              </p>
            </div>
          </div>

          <div className="flex gap-2 mt-5">
            {aws?.configured && (
              <button onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
            )}
            <button onClick={handleSave} disabled={saving || !accessKey || !secretKey} className="btn-primary">
              {saving ? 'Validating...' : 'Save & Validate'}
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Currently connected */}
          <div className="card p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                  <h3 className="font-semibold">AWS SES Connected</h3>
                </div>
                <p className="text-sm text-surface-500 mb-3">
                  Region: <span className="font-mono text-surface-700">{aws.region}</span>
                  {aws.set_at && <span className="ml-3 text-xs">Set {new Date(aws.set_at).toLocaleDateString()}</span>}
                </p>

                {aws.in_sandbox && (
                  <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-3 py-2 mb-3 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium">SES is in Sandbox mode</p>
                      <p className="text-xs mt-0.5">
                        You can only send to verified email addresses. Request production access in the AWS SES Console to send to anyone.
                      </p>
                    </div>
                  </div>
                )}

                {aws.quota && (
                  <div className="grid grid-cols-2 gap-3 mt-3">
                    <div className="bg-surface-50 rounded-lg p-3">
                      <p className="text-xs text-surface-500">24-hour limit</p>
                      <p className="text-lg font-semibold">{aws.quota.max_24_hour.toLocaleString()}</p>
                    </div>
                    <div className="bg-surface-50 rounded-lg p-3">
                      <p className="text-xs text-surface-500">Max send rate</p>
                      <p className="text-lg font-semibold">{aws.quota.max_send_rate}/sec</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2 flex-shrink-0">
                <button onClick={handleRefreshQuota} disabled={refreshing} className="btn-secondary text-sm">
                  <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />Refresh quota
                </button>
                <button onClick={() => setShowForm(true)} className="btn-secondary text-sm">
                  Replace keys
                </button>
                <button onClick={handleDelete} className="btn-ghost text-sm text-red-600">
                  Remove
                </button>
              </div>
            </div>
          </div>

          <div className="card p-5 bg-surface-50/50">
            <h4 className="font-medium text-sm mb-2">📚 Setup checklist</h4>
            <ol className="text-sm text-surface-600 space-y-1.5 list-decimal list-inside">
              <li>Create an IAM user in AWS with <code className="bg-white px-1 rounded text-xs">AmazonSESFullAccess</code></li>
              <li>Generate an Access Key + Secret for that user (shown once)</li>
              <li>Add credentials above</li>
              <li>Switch to the <strong>Mailboxes</strong> tab and add a sender email</li>
              <li>Click the verification link sent to that email by AWS</li>
              <li>Click "Re-check" on the mailbox to confirm it's verified</li>
              <li>Request production access in SES Console to send to non-verified addresses</li>
            </ol>
          </div>
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════
// MAILBOXES TAB
// ════════════════════════════════════════════════════
function MailboxesTab({
  mailboxes, capacity, aws, onRefresh,
}: {
  mailboxes: Mailbox[];
  capacity: Capacity | null;
  aws: AwsSettings | null;
  onRefresh: () => void;
}) {
  if (!aws?.configured) {
    return (
      <div className="card p-12 text-center">
        <Settings className="w-10 h-10 text-surface-300 mx-auto mb-3" />
        <h3 className="font-medium mb-1">AWS not configured yet</h3>
        <p className="text-sm text-surface-500 mb-4">
          Add your AWS credentials first, then come back to add sender mailboxes.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Capacity overview */}
      {capacity && (
        <div className="grid grid-cols-3 gap-3">
          <div className="card p-4">
            <p className="text-xs text-surface-500 uppercase tracking-wider">Verified Mailboxes</p>
            <p className="text-2xl font-bold mt-1">{capacity.verifiedMailboxCount} <span className="text-sm font-normal text-surface-400">/ {capacity.activeMailboxCount}</span></p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-surface-500 uppercase tracking-wider">Daily Capacity</p>
            <p className="text-2xl font-bold mt-1">{capacity.totalCapacity.toLocaleString()}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-surface-500 uppercase tracking-wider">Remaining Today</p>
            <p className="text-2xl font-bold mt-1 text-emerald-600">{capacity.capacityRemaining.toLocaleString()}</p>
          </div>
        </div>
      )}

      {/* Mailboxes list */}
      {mailboxes.length === 0 ? (
        <div className="card p-12 text-center">
          <Mail className="w-10 h-10 text-surface-300 mx-auto mb-3" />
          <h3 className="font-medium mb-1">No mailboxes yet</h3>
          <p className="text-sm text-surface-500">
            Add a sender email address. AWS will send a verification link to that address.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {mailboxes.map((m) => (
            <MailboxCard key={m.id} mailbox={m} onRefresh={onRefresh} />
          ))}
        </div>
      )}
    </div>
  );
}

function MailboxCard({ mailbox: m, onRefresh }: { mailbox: Mailbox; onRefresh: () => void }) {
  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);

  const handleCheckVerification = async () => {
    setChecking(true);
    try {
      const res = await mailboxesApi.checkVerification(m.id);
      if (res.data.status === 'verified') {
        alert('✅ Mailbox verified! It will now be used in sends.');
      } else if (res.data.status === 'pending') {
        alert(`Still pending. Make sure you clicked the verification link sent to ${m.from_email}.`);
      } else {
        alert(`Status: ${res.data.ses_status}`);
      }
      onRefresh();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to check');
    } finally {
      setChecking(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    try {
      await mailboxesApi.resendVerification(m.id);
      alert(`Verification email re-sent to ${m.from_email}`);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to resend');
    } finally {
      setResending(false);
    }
  };

  const handleSetDefault = async () => {
    try {
      await mailboxesApi.setDefault(m.id);
      onRefresh();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to set default');
    }
  };

  const handleToggleActive = async () => {
    try {
      await mailboxesApi.update(m.id, { is_active: !m.is_active });
      onRefresh();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to toggle');
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Remove sender ${m.from_email}? It will be removed from AWS SES too.`)) return;
    try {
      await mailboxesApi.delete(m.id);
      onRefresh();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to delete');
    }
  };

  const statusBadge = () => {
    if (m.status === 'verified') return <span className="badge-green flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Verified</span>;
    if (m.status === 'pending') return <span className="badge-yellow flex items-center gap-1"><Clock className="w-3 h-3" />Pending verification</span>;
    if (m.status === 'failed') return <span className="badge-red flex items-center gap-1"><AlertCircle className="w-3 h-3" />Failed</span>;
    return <span className="badge-gray">Disabled</span>;
  };

  const usagePercent = m.daily_send_limit > 0 ? Math.min(100, (m.daily_sent_count / m.daily_send_limit) * 100) : 0;

  return (
    <div className="card p-4">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-lg bg-brand-100 text-brand-700 flex items-center justify-center flex-shrink-0">
          <Mail className="w-5 h-5" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="font-semibold truncate">{m.from_name || m.from_email}</h3>
            {m.from_name && <span className="text-sm text-surface-500 truncate">&lt;{m.from_email}&gt;</span>}
            {m.is_default && <span className="badge-blue text-xs flex items-center gap-1"><Star className="w-3 h-3" />Default</span>}
            {!m.is_active && <span className="badge-gray text-xs">Paused</span>}
            {statusBadge()}
          </div>

          {m.status === 'verified' && (
            <div className="space-y-1 mt-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-surface-500">
                  Today: {m.daily_sent_count.toLocaleString()} / {m.daily_send_limit.toLocaleString()}
                </span>
                <span className="text-surface-400">Total: {m.total_sent_count.toLocaleString()}</span>
              </div>
              <div className="h-1.5 bg-surface-100 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${usagePercent > 90 ? 'bg-red-500' : usagePercent > 70 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                  style={{ width: `${usagePercent}%` }}
                />
              </div>
              {m.last_used_at && (
                <p className="text-xs text-surface-400">
                  Last used: {new Date(m.last_used_at).toLocaleString()}
                </p>
              )}
            </div>
          )}

          {m.status === 'pending' && (
            <p className="text-xs text-surface-500 mt-1">
              AWS sent a verification email to <strong>{m.from_email}</strong>. Click the link in that email, then "Re-check" below.
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-1 flex-shrink-0">
          {m.status === 'pending' && (
            <>
              <button onClick={handleCheckVerification} disabled={checking} className="btn-primary text-xs py-1.5 px-3">
                <RefreshCw className={`w-3 h-3 ${checking ? 'animate-spin' : ''}`} />Re-check
              </button>
              <button onClick={handleResend} disabled={resending} className="btn-ghost text-xs">
                Resend email
              </button>
            </>
          )}
          {m.status === 'verified' && !m.is_default && (
            <button onClick={handleSetDefault} className="btn-ghost text-xs"><Star className="w-3 h-3" />Make default</button>
          )}
          {m.status === 'verified' && (
            <button onClick={handleToggleActive} className="btn-ghost text-xs">
              {m.is_active ? <><Pause className="w-3 h-3" />Pause</> : <><Send className="w-3 h-3" />Resume</>}
            </button>
          )}
          <button onClick={handleDelete} className="btn-ghost text-xs text-red-600">
            <Trash2 className="w-3 h-3" />Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════
// ADD MAILBOX MODAL
// ════════════════════════════════════════════════════
function AddMailboxModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [dailyLimit, setDailyLimit] = useState(50);
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await mailboxesApi.create({
        from_email: email.trim(),
        from_name: name.trim() || null,
        reply_to_email: replyTo.trim() || null,
        daily_send_limit: dailyLimit,
      });
      alert(res.data.message || 'Mailbox created. Check your email for verification link.');
      onSuccess();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to add mailbox');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="card w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Add Sender Mailbox</h3>
          <button onClick={onClose} className="btn-ghost p-1.5"><X className="w-4 h-4" /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="label">Sender email *</label>
            <input
              type="email"
              placeholder="you@yourdomain.com"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
            <p className="text-xs text-surface-400 mt-1">
              AWS will send a verification email to this address — you must click the link to activate.
            </p>
          </div>

          <div>
            <label className="label">Sender name</label>
            <input
              type="text"
              placeholder="Your Name or Company"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <p className="text-xs text-surface-400 mt-1">Recipients see this as "Your Name &lt;you@example.com&gt;"</p>
          </div>

          <div>
            <label className="label">Reply-to email <span className="text-xs text-surface-400">(optional)</span></label>
            <input
              type="email"
              placeholder="Same as sender if blank"
              className="input"
              value={replyTo}
              onChange={(e) => setReplyTo(e.target.value)}
            />
          </div>

          <div>
            <label className="label">Daily send limit</label>
            <input
              type="number"
              min={1} max={500}
              className="input"
              value={dailyLimit}
              onChange={(e) => setDailyLimit(parseInt(e.target.value) || 50)}
            />
            <p className="text-xs text-surface-400 mt-1">
              Recommended: start at 50/day for new senders, increase gradually for deliverability.
            </p>
          </div>
        </div>

        <div className="flex gap-2 justify-end mt-5 pt-4 border-t border-surface-100">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={handleCreate} disabled={creating || !email} className="btn-primary">
            {creating ? 'Creating...' : 'Add & Verify'}
          </button>
        </div>
      </div>
    </div>
  );
}
