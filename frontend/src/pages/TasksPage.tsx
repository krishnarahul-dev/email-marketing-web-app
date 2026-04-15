import React, { useEffect, useState, useCallback } from 'react';
import { tasksApi } from '../api/client';
import {
  Phone, Linkedin, CheckSquare, Search, Filter, Clock, AlertCircle,
  CheckCircle2, SkipForward, MoreHorizontal, Mail, User, Building,
} from 'lucide-react';

interface Task {
  id: string;
  task_type: string;
  title: string;
  instructions: string | null;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'pending' | 'in_progress' | 'completed' | 'skipped' | 'failed';
  due_at: string | null;
  completed_at: string | null;
  completion_outcome: string | null;
  completion_notes: string | null;
  contact_email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  contact_title: string | null;
  phone: string | null;
  linkedin_url: string | null;
  sequence_name: string | null;
  assignee_name: string | null;
  created_at: string;
}

interface TaskSummary {
  pending: string;
  overdue: string;
  due_today: string;
  completed_today: string;
  my_pending: string;
}

const STATUS_TABS = [
  { key: 'pending', label: 'Pending' },
  { key: 'completed', label: 'Completed' },
  { key: 'skipped', label: 'Skipped' },
];

const TYPE_ICONS: Record<string, any> = {
  call: Phone,
  linkedin_view: Linkedin,
  linkedin_connect: Linkedin,
  linkedin_message: Linkedin,
  custom: CheckSquare,
  email_manual: Mail,
};

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'bg-red-100 text-red-700',
  high: 'bg-amber-100 text-amber-700',
  normal: 'bg-surface-100 text-surface-600',
  low: 'bg-surface-50 text-surface-400',
};

const CALL_OUTCOMES = ['connected', 'voicemail', 'no_answer', 'wrong_number', 'busy'];
const LINKEDIN_OUTCOMES = ['sent', 'accepted', 'ignored', 'not_found'];

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [summary, setSummary] = useState<TaskSummary | null>(null);
  const [activeTab, setActiveTab] = useState('pending');
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [completeModal, setCompleteModal] = useState<Task | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { status: activeTab, page, limit: 25 };
      if (typeFilter) params.task_type = typeFilter;

      const [tasksRes, summaryRes] = await Promise.all([
        tasksApi.list(params),
        tasksApi.summary().catch(() => ({ data: { summary: null } })),
      ]);
      setTasks(tasksRes.data.data);
      setTotal(tasksRes.data.total);
      setSummary(summaryRes.data.summary);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [activeTab, typeFilter, page]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleComplete = async (taskId: string, outcome: string, notes: string) => {
    try {
      await tasksApi.complete(taskId, { outcome, notes });
      setCompleteModal(null);
      fetchData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to complete task');
    }
  };

  const handleSkip = async (taskId: string) => {
    if (!confirm('Skip this task?')) return;
    try {
      await tasksApi.skip(taskId, 'Skipped by user');
      fetchData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to skip task');
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Tasks</h1>
        <p className="text-surface-500 text-sm mt-0.5">Call, LinkedIn, and custom tasks from your sequences</p>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryCard label="My Pending" value={summary.my_pending} icon={User} />
          <SummaryCard label="Due Today" value={summary.due_today} icon={Clock} />
          <SummaryCard label="Overdue" value={summary.overdue} icon={AlertCircle} urgent />
          <SummaryCard label="Completed Today" value={summary.completed_today} icon={CheckCircle2} />
        </div>
      )}

      {/* Tabs + filters */}
      <div className="flex items-center justify-between gap-3 border-b border-surface-200 pb-0">
        <div className="flex gap-1">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key); setPage(1); }}
              className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                activeTab === tab.key ? 'border-brand-500 text-brand-700' : 'border-transparent text-surface-500 hover:text-surface-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <select
          className="input py-1.5 px-3 text-sm w-44"
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
        >
          <option value="">All types</option>
          <option value="call">Calls</option>
          <option value="linkedin_view">LinkedIn View</option>
          <option value="linkedin_connect">LinkedIn Connect</option>
          <option value="linkedin_message">LinkedIn Message</option>
          <option value="custom">Custom</option>
        </select>
      </div>

      {/* Task list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="card p-12 text-center">
          <CheckSquare className="w-10 h-10 text-surface-300 mx-auto mb-3" />
          <p className="text-sm text-surface-500">No tasks in this category</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onComplete={() => setCompleteModal(task)}
              onSkip={() => handleSkip(task.id)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {total > 25 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-surface-500">Page {page} of {Math.ceil(total / 25)}</span>
          <div className="flex gap-1">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="btn-ghost text-xs py-1 px-2">Previous</button>
            <button onClick={() => setPage((p) => p + 1)} disabled={page * 25 >= total} className="btn-ghost text-xs py-1 px-2">Next</button>
          </div>
        </div>
      )}

      {/* Complete modal */}
      {completeModal && (
        <CompleteTaskModal
          task={completeModal}
          onClose={() => setCompleteModal(null)}
          onComplete={handleComplete}
        />
      )}
    </div>
  );
}

function SummaryCard({ label, value, icon: Icon, urgent }: { label: string; value: string; icon: any; urgent?: boolean }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2">
        <Icon className={`w-4 h-4 ${urgent && parseInt(value) > 0 ? 'text-red-500' : 'text-surface-400'}`} />
        <p className="text-xs text-surface-500">{label}</p>
      </div>
      <p className={`text-2xl font-bold mt-1 ${urgent && parseInt(value) > 0 ? 'text-red-600' : ''}`}>{value}</p>
    </div>
  );
}

function TaskCard({ task, onComplete, onSkip }: { task: Task; onComplete: () => void; onSkip: () => void }) {
  const Icon = TYPE_ICONS[task.task_type] || CheckSquare;
  const fullName = [task.first_name, task.last_name].filter(Boolean).join(' ') || task.contact_email;
  const isOverdue = task.due_at && new Date(task.due_at) < new Date() && task.status === 'pending';

  return (
    <div className={`card p-4 ${isOverdue ? 'border-red-200 bg-red-50/30' : ''}`}>
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-surface-100 flex items-center justify-center flex-shrink-0">
          <Icon className="w-4 h-4 text-surface-600" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="font-medium text-sm">{task.title}</h3>
            <span className={`text-xs px-2 py-0.5 rounded-full ${PRIORITY_COLORS[task.priority]}`}>{task.priority}</span>
            {isOverdue && <span className="text-xs text-red-600 font-medium">Overdue</span>}
          </div>

          <div className="flex items-center gap-3 text-xs text-surface-500 mb-1">
            <span className="flex items-center gap-1"><User className="w-3 h-3" />{fullName}</span>
            {task.company && <span className="flex items-center gap-1"><Building className="w-3 h-3" />{task.company}</span>}
            {task.sequence_name && <span>Seq: {task.sequence_name}</span>}
          </div>

          {task.instructions && (
            <p className="text-xs text-surface-500 bg-surface-50 px-2 py-1.5 rounded mt-1 line-clamp-2">{task.instructions}</p>
          )}

          {task.completion_outcome && (
            <p className="text-xs text-emerald-600 mt-1">Outcome: {task.completion_outcome}{task.completion_notes ? ` — ${task.completion_notes}` : ''}</p>
          )}
        </div>

        {task.status === 'pending' && (
          <div className="flex gap-1 flex-shrink-0">
            {task.phone && (
              <a href={`tel:${task.phone}`} className="btn-ghost p-2 text-emerald-600" title="Call">
                <Phone className="w-4 h-4" />
              </a>
            )}
            {task.linkedin_url && (
              <a href={task.linkedin_url} target="_blank" rel="noopener noreferrer" className="btn-ghost p-2 text-sky-600" title="LinkedIn">
                <Linkedin className="w-4 h-4" />
              </a>
            )}
            <button onClick={onComplete} className="btn-primary text-xs py-1.5 px-3">
              <CheckCircle2 className="w-3.5 h-3.5" />Done
            </button>
            <button onClick={onSkip} className="btn-ghost p-2 text-surface-400" title="Skip">
              <SkipForward className="w-4 h-4" />
            </button>
          </div>
        )}

        {task.status === 'completed' && (
          <span className="text-xs text-emerald-600 flex items-center gap-1 flex-shrink-0">
            <CheckCircle2 className="w-3.5 h-3.5" />Completed
          </span>
        )}
      </div>
    </div>
  );
}

function CompleteTaskModal({ task, onClose, onComplete }: {
  task: Task;
  onClose: () => void;
  onComplete: (taskId: string, outcome: string, notes: string) => void;
}) {
  const [outcome, setOutcome] = useState('');
  const [notes, setNotes] = useState('');

  const outcomes = task.task_type === 'call' ? CALL_OUTCOMES
    : task.task_type.startsWith('linkedin') ? LINKEDIN_OUTCOMES
    : ['done', 'partial', 'deferred'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="card w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-4">Complete Task</h3>
        <p className="text-sm text-surface-600 mb-4">{task.title}</p>

        <div className="space-y-3">
          <div>
            <label className="label">Outcome</label>
            <select className="input" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              <option value="">Select outcome...</option>
              {outcomes.map((o) => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Notes <span className="text-xs text-surface-400">(optional)</span></label>
            <textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any notes about this interaction..." />
          </div>
        </div>

        <div className="flex gap-2 justify-end mt-5 pt-4 border-t border-surface-100">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={() => onComplete(task.id, outcome, notes)} disabled={!outcome} className="btn-primary">
            Mark Complete
          </button>
        </div>
      </div>
    </div>
  );
}
