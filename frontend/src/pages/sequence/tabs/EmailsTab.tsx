import React, { useEffect, useState, useCallback } from 'react';
import { sequencesApi } from '../../../api/client';
import { Search, Mail, Eye, MousePointer, MessageSquare, AlertTriangle, Clock, Ban, X } from 'lucide-react';

interface EmailRow {
  id: string;
  subject: string | null;
  to_email: string;
  status: string;
  sent_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  replied_at: string | null;
  bounced_at: string | null;
  created_at: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  step_order: number | null;
  step_name: string | null;
}

const EMAIL_TABS = [
  { key: 'total', label: 'Total' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'not_opened', label: 'Not Opened' },
  { key: 'opened', label: 'Opened' },
  { key: 'clicked', label: 'Clicked' },
  { key: 'replied', label: 'Replied' },
  { key: 'bounced', label: 'Bounced' },
  { key: 'spam_blocked', label: 'Spam Blocked' },
  { key: 'failed', label: 'Failed' },
];

export default function EmailsTab({ sequenceId }: { sequenceId: string }) {
  const [activeTab, setActiveTab] = useState('total');
  const [emails, setEmails] = useState<EmailRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, limit: 25 };
      if (activeTab !== 'total') params.status = activeTab;
      if (search) params.search = search;

      const [emailsRes, countsRes] = await Promise.all([
        sequencesApi.emails(sequenceId, params),
        sequencesApi.emailStatusCounts(sequenceId),
      ]);
      setEmails(emailsRes.data.data);
      setTotal(emailsRes.data.total);
      setCounts(countsRes.data.counts);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [sequenceId, activeTab, search, page]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className="bg-white border-b border-surface-200">
      {/* Status tabs */}
      <div className="flex gap-1 px-6 lg:px-8 overflow-x-auto border-b border-surface-200">
        {EMAIL_TABS.map((tab) => {
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
            placeholder="Search emails by subject, recipient..."
            className="input pl-9 py-2 text-sm"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <span className="text-xs text-surface-500 ml-auto">{total} email{total !== 1 ? 's' : ''}</span>
      </div>

      {/* Email list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : emails.length === 0 ? (
        <div className="py-16 text-center">
          <Mail className="w-10 h-10 text-surface-300 mx-auto mb-3" />
          <p className="text-sm text-surface-400">No emails in this category</p>
        </div>
      ) : (
        <div className="divide-y divide-surface-100">
          {emails.map((email) => (
            <EmailListRow key={email.id} email={email} />
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

function EmailListRow({ email }: { email: EmailRow }) {
  const fullName = [email.first_name, email.last_name].filter(Boolean).join(' ');
  const recipientLabel = fullName || email.to_email;

  const statusInfo = () => {
    if (email.status === 'queued') return { label: 'Scheduled', icon: Clock, classes: 'bg-amber-50 text-amber-700' };
    if (email.status === 'failed') return { label: 'Failed', icon: AlertTriangle, classes: 'bg-red-50 text-red-700' };
    if (email.status === 'bounced') return { label: 'Bounced', icon: AlertTriangle, classes: 'bg-red-50 text-red-700' };
    if (email.status === 'complained') return { label: 'Spam', icon: Ban, classes: 'bg-red-50 text-red-700' };
    if (email.replied_at) return { label: 'Replied', icon: MessageSquare, classes: 'bg-violet-50 text-violet-700' };
    if (email.clicked_at) return { label: 'Clicked', icon: MousePointer, classes: 'bg-blue-50 text-blue-700' };
    if (email.opened_at) return { label: 'Opened', icon: Eye, classes: 'bg-emerald-50 text-emerald-700' };
    if (email.sent_at) return { label: 'Delivered', icon: Mail, classes: 'bg-surface-100 text-surface-700' };
    return { label: 'Pending', icon: Clock, classes: 'bg-surface-100 text-surface-500' };
  };

  const status = statusInfo();
  const StatusIcon = status.icon;
  const dateLabel = email.sent_at || email.created_at;

  return (
    <div className="px-6 lg:px-8 py-3 flex items-start gap-4 hover:bg-surface-50 transition-colors">
      {/* Recipient column */}
      <div className="w-32 flex-shrink-0">
        <p className="text-xs text-surface-400">To:</p>
        <p className="text-sm text-brand-700 font-medium truncate">{recipientLabel}</p>
      </div>

      {/* Subject + preview */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-surface-900 truncate mb-0.5">{email.subject || '(no subject)'}</p>
        {email.step_order && (
          <p className="text-xs text-surface-400">Step {email.step_order}{email.step_name ? ` · ${email.step_name}` : ''}</p>
        )}
      </div>

      {/* Status pill */}
      <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${status.classes} flex-shrink-0`}>
        <StatusIcon className="w-3 h-3" />
        {status.label}
      </div>

      {/* Date */}
      <div className="text-xs text-surface-400 flex-shrink-0 w-24 text-right">
        {dateLabel ? new Date(dateLabel).toLocaleDateString('en', { month: 'short', day: 'numeric' }) : '—'}
      </div>
    </div>
  );
}
