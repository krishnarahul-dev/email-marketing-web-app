import React, { useEffect, useState, useCallback } from 'react';
import { sequencesApi } from '../../../api/client';
import { Search, MoreHorizontal, Pause, Play, X, Mail, Phone, Briefcase } from 'lucide-react';

interface ContactRow {
  enrollment_id: string;
  contact_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  title: string | null;
  enrollment_status: string;
  current_step_order: number | null;
  engagement_status: string;
  next_send_at: string | null;
  emails_sent: number;
  emails_opened: number;
  emails_replied: number;
  reply_tone: string | null;
}

const STATUS_TABS = [
  { key: 'total', label: 'Total' },
  { key: 'cold', label: 'Cold' },
  { key: 'approaching', label: 'Approaching' },
  { key: 'replied', label: 'Replied' },
  { key: 'interested', label: 'Interested' },
  { key: 'not_interested', label: 'Not Interested' },
  { key: 'unresponsive', label: 'Unresponsive' },
  { key: 'bounced', label: 'Bounced' },
  { key: 'unsubscribed', label: 'Unsubscribed' },
];

export default function ContactsTab({ sequenceId }: { sequenceId: string }) {
  const [activeTab, setActiveTab] = useState('total');
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, limit: 25 };
      if (activeTab === 'interested' || activeTab === 'not_interested') {
        // These are reply tones, not engagement statuses
      } else if (activeTab !== 'total') {
        params.engagement_status = activeTab;
      }
      if (search) params.search = search;

      const [contactsRes, countsRes] = await Promise.all([
        sequencesApi.contacts(sequenceId, params),
        sequencesApi.contactStatusCounts(sequenceId),
      ]);
      setContacts(contactsRes.data.data);
      setTotal(contactsRes.data.total);
      setCounts(countsRes.data.counts);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [sequenceId, activeTab, search, page]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleAction = async (enrollmentId: string, action: 'pause' | 'resume' | 'cancel') => {
    try {
      if (action === 'pause') await sequencesApi.pauseEnrollment(sequenceId, enrollmentId);
      if (action === 'resume') await sequencesApi.resumeEnrollment(sequenceId, enrollmentId);
      if (action === 'cancel') {
        if (!confirm('Remove this contact from the sequence?')) return;
        await sequencesApi.cancelEnrollment(sequenceId, enrollmentId);
      }
      fetchData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Action failed');
    }
  };

  return (
    <div className="bg-white border-b border-surface-200">
      {/* Status filter tabs */}
      <div className="flex gap-1 px-6 lg:px-8 overflow-x-auto border-b border-surface-200">
        {STATUS_TABS.map((tab) => {
          const count = counts[tab.key] ?? 0;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key); setPage(1); }}
              className={`flex flex-col items-center px-4 py-3 text-xs whitespace-nowrap border-b-2 transition-colors ${
                isActive ? 'border-brand-500 text-brand-700' : 'border-transparent text-surface-500 hover:text-surface-900'
              }`}
            >
              <span className="text-base font-semibold">{count.toLocaleString()}</span>
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Toolbar */}
      <div className="px-6 lg:px-8 py-3 flex items-center gap-3 border-b border-surface-200">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" />
          <input
            type="text"
            placeholder="Search contacts..."
            className="input pl-9 py-2 text-sm"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <span className="text-xs text-surface-500 ml-auto">{total} contact{total !== 1 ? 's' : ''}</span>
      </div>

      {/* Contacts table */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : contacts.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-sm text-surface-400">No contacts in this category</p>
        </div>
      ) : (
        <div className="divide-y divide-surface-100">
          {contacts.map((c) => (
            <ContactRow key={c.enrollment_id} contact={c} onAction={handleAction} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {total > 25 && (
        <div className="px-6 py-3 flex items-center justify-between border-t border-surface-200">
          <span className="text-xs text-surface-500">Page {page} of {Math.ceil(total / 25)}</span>
          <div className="flex gap-1">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="btn-ghost text-xs py-1 px-2">Previous</button>
            <button onClick={() => setPage((p) => p + 1)} disabled={page * 25 >= total} className="btn-ghost text-xs py-1 px-2">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ContactRow({ contact: c, onAction }: { contact: ContactRow; onAction: (id: string, action: any) => void }) {
  const [showMenu, setShowMenu] = useState(false);

  const initials = ((c.first_name?.[0] || '') + (c.last_name?.[0] || '')).toUpperCase() || c.email[0]?.toUpperCase();
  const fullName = [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email;

  const statusBadge = () => {
    const map: Record<string, { label: string; classes: string }> = {
      active: { label: 'Active', classes: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' },
      paused: { label: 'Paused', classes: 'bg-amber-50 text-amber-700 ring-amber-600/20' },
      replied: { label: 'Replied', classes: 'bg-violet-50 text-violet-700 ring-violet-600/20' },
      bounced: { label: 'Bounced', classes: 'bg-red-50 text-red-700 ring-red-600/20' },
      unsubscribed: { label: 'Unsubscribed', classes: 'bg-surface-100 text-surface-600 ring-surface-300' },
      completed: { label: 'Finished', classes: 'bg-blue-50 text-blue-700 ring-blue-600/20' },
      cancelled: { label: 'Cancelled', classes: 'bg-surface-100 text-surface-600 ring-surface-300' },
    };
    const config = map[c.enrollment_status] || { label: c.enrollment_status, classes: 'bg-surface-100 text-surface-600' };
    return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${config.classes}`}>{config.label}</span>;
  };

  const engagementBadge = () => {
    if (c.engagement_status === 'cold') return <span className="text-xs text-surface-400">Cold</span>;
    if (c.engagement_status === 'approaching') return <span className="text-xs text-amber-600">Approaching</span>;
    if (c.engagement_status === 'engaged') return <span className="text-xs text-emerald-600">Engaged</span>;
    if (c.engagement_status === 'unresponsive') return <span className="text-xs text-red-500">Unresponsive</span>;
    return null;
  };

  return (
    <div className="px-6 lg:px-8 py-3 flex items-center gap-3 hover:bg-surface-50 transition-colors">
      {/* Avatar */}
      <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-medium flex-shrink-0">
        {initials}
      </div>

      {/* Name + status */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <p className="text-sm font-medium text-brand-700 truncate">{fullName}</p>
          {statusBadge()}
          {c.current_step_order && (
            <span className="text-xs bg-surface-100 text-surface-600 px-2 py-0.5 rounded-full">
              Step {c.current_step_order}
            </span>
          )}
          {engagementBadge()}
        </div>
        <p className="text-xs text-surface-500 truncate">
          {c.title && `${c.title} @ `}
          {c.company || c.email}
        </p>
      </div>

      {/* Stats */}
      <div className="hidden md:flex gap-4 text-xs text-surface-500">
        <span><Mail className="w-3 h-3 inline mr-1" />{c.emails_sent}</span>
        <span>opens {c.emails_opened}</span>
        <span>replies {c.emails_replied}</span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <button className="p-1.5 hover:bg-surface-100 rounded text-surface-400" title="Email contact">
          <Mail className="w-4 h-4" />
        </button>
        <div className="relative">
          <button onClick={() => setShowMenu(!showMenu)} className="p-1.5 hover:bg-surface-100 rounded text-surface-400">
            <MoreHorizontal className="w-4 h-4" />
          </button>
          {showMenu && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setShowMenu(false)} />
              <div className="absolute right-0 top-full mt-1 w-44 bg-white rounded-lg shadow-lg border border-surface-200 z-40 py-1">
                {c.enrollment_status === 'active' && (
                  <button
                    onClick={() => { setShowMenu(false); onAction(c.enrollment_id, 'pause'); }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-surface-50 flex items-center gap-2"
                  >
                    <Pause className="w-3.5 h-3.5" />Pause sequence
                  </button>
                )}
                {c.enrollment_status === 'paused' && (
                  <button
                    onClick={() => { setShowMenu(false); onAction(c.enrollment_id, 'resume'); }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-surface-50 flex items-center gap-2"
                  >
                    <Play className="w-3.5 h-3.5" />Resume
                  </button>
                )}
                <button
                  onClick={() => { setShowMenu(false); onAction(c.enrollment_id, 'cancel'); }}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-red-50 text-red-600 flex items-center gap-2"
                >
                  <X className="w-3.5 h-3.5" />Remove from sequence
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
