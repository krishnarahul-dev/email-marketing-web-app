import React, { useEffect, useState, useCallback } from 'react';
import { sequencesApi } from '../../../api/client';
import { Play, Pencil, Plus, UserPlus, Pause, Mail, MessageSquare, AlertCircle, Calendar, CheckCircle } from 'lucide-react';

interface ActivityRow {
  id: string;
  action: string;
  description: string | null;
  metadata: any;
  created_at: string;
  user_name: string | null;
  contact_email: string | null;
  first_name: string | null;
  last_name: string | null;
}

export default function ActivityTab({ sequenceId }: { sequenceId: string }) {
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await sequencesApi.activity(sequenceId, { page, limit: 50 });
      setActivity(res.data.data);
      setTotal(res.data.total);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [sequenceId, page]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className="max-w-3xl mx-auto px-6 lg:px-8 py-6">
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : activity.length === 0 ? (
        <div className="bg-white border border-surface-200 rounded-xl p-12 text-center">
          <Calendar className="w-10 h-10 text-surface-300 mx-auto mb-3" />
          <p className="text-sm text-surface-500">No activity yet</p>
          <p className="text-xs text-surface-400 mt-1">Sequence edits, enrollments, and email events will appear here</p>
        </div>
      ) : (
        <div className="space-y-2">
          {activity.map((item) => (
            <ActivityRow key={item.id} item={item} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {total > 50 && (
        <div className="flex items-center justify-between mt-4 px-2">
          <span className="text-xs text-surface-500">Page {page} of {Math.ceil(total / 50)}</span>
          <div className="flex gap-1">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="btn-ghost text-xs py-1 px-2">Previous</button>
            <button onClick={() => setPage((p) => p + 1)} disabled={page * 50 >= total} className="btn-ghost text-xs py-1 px-2">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ActivityRow({ item }: { item: ActivityRow }) {
  const { icon: Icon, color } = getIconForAction(item.action);
  const contactName = item.first_name || item.last_name
    ? [item.first_name, item.last_name].filter(Boolean).join(' ')
    : item.contact_email;

  return (
    <div className="bg-white border border-surface-200 rounded-lg px-4 py-3 flex items-start gap-3">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${color}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm">
          {item.user_name && <span className="font-medium text-brand-700">{item.user_name}</span>}
          {item.user_name && ' '}
          <span className="text-surface-700">{item.description || formatActionDefault(item.action)}</span>
          {contactName && (
            <>
              {' for '}
              <span className="font-medium text-surface-900">{contactName}</span>
            </>
          )}
        </p>
        <p className="text-xs text-surface-400 mt-0.5">
          {new Date(item.created_at).toLocaleString('en', {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
          })}
        </p>
      </div>
    </div>
  );
}

function getIconForAction(action: string): { icon: any; color: string } {
  switch (action) {
    case 'enrolled': return { icon: UserPlus, color: 'bg-blue-50 text-blue-600' };
    case 'step_executed': return { icon: Mail, color: 'bg-emerald-50 text-emerald-600' };
    case 'reply_received': return { icon: MessageSquare, color: 'bg-violet-50 text-violet-600' };
    case 'paused': return { icon: Pause, color: 'bg-amber-50 text-amber-600' };
    case 'completed': return { icon: CheckCircle, color: 'bg-emerald-50 text-emerald-600' };
    case 'meeting_booked': return { icon: Calendar, color: 'bg-violet-50 text-violet-600' };
    case 'task_created':
    case 'task_completed': return { icon: CheckCircle, color: 'bg-violet-50 text-violet-600' };
    case 'sequence_activated':
    case 'started': return { icon: Play, color: 'bg-emerald-50 text-emerald-600' };
    case 'edited':
    case 'sequence_edited': return { icon: Pencil, color: 'bg-surface-100 text-surface-600' };
    case 'created': return { icon: Plus, color: 'bg-blue-50 text-blue-600' };
    default: return { icon: AlertCircle, color: 'bg-surface-100 text-surface-500' };
  }
}

function formatActionDefault(action: string): string {
  return action.replace(/_/g, ' ');
}
