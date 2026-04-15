import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, NavLink, Routes, Route, Navigate } from 'react-router-dom';
import { sequencesApi, contactsApi } from '../../api/client';
import {
  ChevronLeft, Star, Share2, Zap, ChevronDown, MoreHorizontal,
  Search, Upload, List, Sparkles, Pencil, Copy, Trash2,
} from 'lucide-react';
import EditorTab from './tabs/EditorTab';
import ContactsTab from './tabs/ContactsTab';
import EmailsTab from './tabs/EmailsTab';
import ActivityTab from './tabs/ActivityTab';
import ReportTab from './tabs/ReportTab';
import SettingsTab from './tabs/SettingsTab';

interface SequenceDetail {
  id: string;
  name: string;
  description: string | null;
  status: 'draft' | 'active' | 'paused' | 'archived';
  created_at: string;
  total_enrolled: number;
  total_completed: number;
  total_replied: number;
  schedule_id: string | null;
}

const TABS = [
  { key: 'editor', label: 'Editor' },
  { key: 'contacts', label: 'Contacts' },
  { key: 'emails', label: 'Emails' },
  { key: 'activity', label: 'Activity' },
  { key: 'report', label: 'Report' },
  { key: 'settings', label: 'Settings' },
];

export default function SequenceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [sequence, setSequence] = useState<SequenceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddContacts, setShowAddContacts] = useState(false);
  const [showMore, setShowMore] = useState(false);

  const fetchSequence = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await sequencesApi.get(id);
      setSequence(res.data.sequence);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchSequence(); }, [fetchSequence]);

  const handleToggleActive = async () => {
    if (!sequence) return;
    try {
      const newStatus = sequence.status === 'active' ? 'paused' : 'active';
      await sequencesApi.update(sequence.id, { status: newStatus });
      fetchSequence();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to update status');
    }
  };

  const handleDuplicate = async () => {
    if (!sequence) return;
    try {
      const res = await sequencesApi.duplicate(sequence.id);
      navigate(`/sequences/${res.data.sequence.id}`);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to duplicate');
    }
  };

  const handleDelete = async () => {
    if (!sequence) return;
    if (!confirm(`Delete sequence "${sequence.name}"? This cannot be undone.`)) return;
    try {
      await sequencesApi.delete(sequence.id);
      navigate('/sequences');
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to delete');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!sequence) {
    return (
      <div className="p-12 text-center">
        <p className="text-surface-500 mb-4">Sequence not found</p>
        <button className="btn-secondary" onClick={() => navigate('/sequences')}>Back to Sequences</button>
      </div>
    );
  }

  const isActive = sequence.status === 'active';

  return (
    <div className="min-h-screen flex flex-col bg-surface-50">
      {/* ─── Header ─────────────────────────────────── */}
      <header className="bg-white border-b border-surface-200 sticky top-0 z-30">
        <div className="px-6 lg:px-8 pt-4 pb-0">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-sm text-surface-500 mb-3">
            <button onClick={() => navigate('/sequences')} className="hover:text-brand-600 flex items-center gap-1 transition-colors">
              <ChevronLeft className="w-3.5 h-3.5" />
              Sequences
            </button>
            <span>/</span>
            <span className="text-surface-700 font-medium truncate">{sequence.name}</span>
          </div>

          {/* Title row */}
          <div className="flex items-center justify-between gap-4 mb-4">
            <div className="flex items-center gap-3 min-w-0">
              <h1 className="text-2xl font-bold tracking-tight truncate">{sequence.name}</h1>
              <button className="text-surface-300 hover:text-amber-500 transition-colors" title="Star sequence">
                <Star className="w-5 h-5" />
              </button>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              <button className="btn-secondary text-sm py-2 px-3">
                <Share2 className="w-4 h-4" />Share
              </button>
              <button className="btn-secondary text-sm py-2 px-3 relative">
                <Zap className="w-4 h-4" />Workflows <span className="text-surface-400 ml-1">0</span>
                <ChevronDown className="w-3 h-3 ml-0.5" />
              </button>

              {/* Add Contacts Dropdown */}
              <div className="relative">
                <button
                  onClick={() => setShowAddContacts(!showAddContacts)}
                  className="bg-amber-300 hover:bg-amber-400 text-amber-950 font-medium text-sm py-2 px-3 rounded-lg flex items-center gap-2 transition-colors"
                >
                  Add Contacts <ChevronDown className="w-3 h-3" />
                </button>
                {showAddContacts && (
                  <AddContactsDropdown
                    sequenceId={sequence.id}
                    sequenceActive={isActive}
                    onClose={() => setShowAddContacts(false)}
                    onSuccess={fetchSequence}
                  />
                )}
              </div>

              {/* Active toggle */}
              <button
                onClick={handleToggleActive}
                className={`flex items-center gap-2 text-sm font-medium py-2 px-3 rounded-lg transition-colors ${
                  isActive ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-surface-100 text-surface-700 hover:bg-surface-200'
                }`}
              >
                <span className={`w-8 h-4 rounded-full relative transition-colors ${isActive ? 'bg-emerald-500' : 'bg-surface-300'}`}>
                  <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${isActive ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </span>
                {isActive ? 'Active' : 'Activate'}
              </button>

              {/* More menu */}
              <div className="relative">
                <button onClick={() => setShowMore(!showMore)} className="btn-ghost p-2">
                  <MoreHorizontal className="w-4 h-4" />
                </button>
                {showMore && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setShowMore(false)} />
                    <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-lg shadow-lg border border-surface-200 z-40 py-1">
                      <button
                        onClick={() => { setShowMore(false); handleDuplicate(); }}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-surface-50 flex items-center gap-2"
                      >
                        <Copy className="w-4 h-4 text-surface-400" />Duplicate
                      </button>
                      <button
                        onClick={() => { setShowMore(false); handleDelete(); }}
                        className="w-full px-3 py-2 text-left text-sm hover:bg-red-50 text-red-600 flex items-center gap-2"
                      >
                        <Trash2 className="w-4 h-4" />Delete
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* ─── Tabs ─────────────────────────────────── */}
          <div className="flex gap-1 -mb-px">
  {TABS.map((tab) => (
    <NavLink
      key={tab.key}
      to={`/sequences/${sequence.id}/${tab.key}`}
      className={({ isActive }) =>
        `px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
          isActive
            ? 'border-surface-900 text-surface-900'
            : 'border-transparent text-surface-500 hover:text-surface-900'
        }`
      }
    >
      {tab.label}
    </NavLink>
  ))}
</div>
        </div>
      </header>

      {/* ─── Tab Content ─────────────────────────────── */}
      <main className="flex-1">
        <Routes>
          <Route index element={<Navigate to="editor" replace />} />
          <Route path="editor" element={<EditorTab sequence={sequence} onUpdate={fetchSequence} />} />
          <Route path="contacts" element={<ContactsTab sequenceId={sequence.id} />} />
          <Route path="emails" element={<EmailsTab sequenceId={sequence.id} />} />
          <Route path="activity" element={<ActivityTab sequenceId={sequence.id} />} />
          <Route path="report" element={<ReportTab sequenceId={sequence.id} />} />
          <Route path="settings" element={<SettingsTab sequence={sequence} onUpdate={fetchSequence} />} />
        </Routes>
      </main>
    </div>
  );
}

// ─── Add Contacts Dropdown ─────────────────────────
function AddContactsDropdown({
  sequenceId, sequenceActive, onClose, onSuccess,
}: {
  sequenceId: string;
  sequenceActive: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [showSelectList, setShowSelectList] = useState(false);

  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="absolute right-0 top-full mt-1 w-72 bg-white rounded-lg shadow-lg border border-surface-200 z-40 py-1">
        {!sequenceActive && (
          <div className="px-3 py-2 mx-1 mb-1 bg-amber-50 border border-amber-200 text-amber-700 text-xs rounded">
            Activate the sequence first to start sending to enrolled contacts.
          </div>
        )}

        <button
          onClick={() => { setShowSelectList(true); }}
          className="w-full px-3 py-3 text-left hover:bg-surface-50 flex items-start gap-3"
        >
          <List className="w-5 h-5 text-surface-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium">Select existing contacts</p>
            <p className="text-xs text-surface-500 mt-0.5">Pick contacts from your workspace</p>
          </div>
        </button>

        <button
          onClick={() => alert('CSV upload coming next round — use the Contacts page Import feature for now')}
          className="w-full px-3 py-3 text-left hover:bg-surface-50 flex items-start gap-3"
        >
          <Upload className="w-5 h-5 text-surface-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium">Upload CSV</p>
            <p className="text-xs text-surface-500 mt-0.5">Import a CSV file of prospects</p>
          </div>
        </button>

        <button
          onClick={() => alert('Lead database not available in this build')}
          className="w-full px-3 py-3 text-left hover:bg-surface-50 flex items-start gap-3 opacity-60"
        >
          <Search className="w-5 h-5 text-surface-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium">Prospect searcher</p>
            <p className="text-xs text-surface-500 mt-0.5">Coming soon</p>
          </div>
        </button>
      </div>

      {showSelectList && (
        <SelectContactsModal
          sequenceId={sequenceId}
          onClose={() => { setShowSelectList(false); onClose(); }}
          onSuccess={() => { setShowSelectList(false); onClose(); onSuccess(); }}
        />
      )}
    </>
  );
}

// ─── Select Contacts Modal ─────────────────────────
function SelectContactsModal({
  sequenceId, onClose, onSuccess,
}: {
  sequenceId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [contacts, setContacts] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    contactsApi.list({ status: 'active', limit: 100, search: search || undefined })
      .then((res) => setContacts(res.data.data))
      .catch(() => setContacts([]))
      .finally(() => setLoading(false));
  }, [search]);

  const handleEnroll = async () => {
    if (selected.size === 0) return;
    setEnrolling(true);
    try {
      const res = await sequencesApi.bulkEnroll(sequenceId, Array.from(selected));
      setResult(res.data);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to enroll');
    } finally {
      setEnrolling(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div className="card w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Add contacts to sequence</h3>
          <button onClick={onClose} className="btn-ghost p-1.5">×</button>
        </div>

        {result ? (
          <div className="space-y-3">
            <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200">
              <p className="text-sm font-medium text-emerald-800">{result.enrolled} contacts enrolled successfully</p>
              {result.skipped > 0 && (
                <p className="text-xs text-emerald-700 mt-1">
                  {result.skipped} skipped (already enrolled, suppressed, or inactive)
                </p>
              )}
              {result.errors?.length > 0 && (
                <details className="mt-2">
                  <summary className="text-xs cursor-pointer text-amber-700">{result.errors.length} errors</summary>
                  <ul className="mt-1 text-xs text-amber-700">
                    {result.errors.slice(0, 5).map((e: string, i: number) => <li key={i}>{e}</li>)}
                  </ul>
                </details>
              )}
            </div>
            <button onClick={onSuccess} className="btn-primary w-full">Done</button>
          </div>
        ) : (
          <>
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" />
              <input
                type="text"
                placeholder="Search contacts by name, email, company..."
                className="input pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
            </div>

            <div className="border border-surface-200 rounded-lg max-h-80 overflow-y-auto">
              {loading ? (
                <div className="p-8 text-center text-surface-400 text-sm">Loading contacts...</div>
              ) : contacts.length === 0 ? (
                <div className="p-8 text-center text-surface-400 text-sm">No active contacts found</div>
              ) : (
                <>
                  <label className="flex items-center gap-3 px-3 py-2 border-b border-surface-100 bg-surface-50 sticky top-0">
                    <input
                      type="checkbox"
                      checked={selected.size === contacts.length && contacts.length > 0}
                      onChange={() => {
                        if (selected.size === contacts.length) setSelected(new Set());
                        else setSelected(new Set(contacts.map((c) => c.id)));
                      }}
                      className="rounded"
                    />
                    <span className="text-xs font-medium text-surface-600">
                      Select all ({contacts.length})
                    </span>
                    {selected.size > 0 && (
                      <span className="text-xs text-brand-600 ml-auto">{selected.size} selected</span>
                    )}
                  </label>
                  {contacts.map((c) => (
                    <label
                      key={c.id}
                      className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-50 cursor-pointer border-b border-surface-100 last:border-b-0"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => {
                          const next = new Set(selected);
                          next.has(c.id) ? next.delete(c.id) : next.add(c.id);
                          setSelected(next);
                        }}
                        className="rounded"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{c.email}</p>
                        <p className="text-xs text-surface-400 truncate">
                          {[c.first_name, c.last_name].filter(Boolean).join(' ')}
                          {c.company ? ` · ${c.company}` : ''}
                        </p>
                      </div>
                    </label>
                  ))}
                </>
              )}
            </div>

            <div className="flex gap-2 mt-4">
              <button onClick={onClose} className="btn-secondary flex-1">Cancel</button>
              <button
                onClick={handleEnroll}
                disabled={selected.size === 0 || enrolling}
                className="btn-primary flex-1"
              >
                {enrolling ? 'Enrolling...' : `Enroll ${selected.size} contact${selected.size !== 1 ? 's' : ''}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
