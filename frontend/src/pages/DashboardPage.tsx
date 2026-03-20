import React, { useEffect, useState } from 'react';
import { analyticsApi } from '../api/client';
import { DashboardOverview, TimelineDataPoint, ToneBreakdownItem } from '../types';
import { Users, Send, GitBranch, Mail, Eye, MousePointer, MessageSquare, AlertTriangle } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const TONE_COLORS: Record<string, string> = {
  interested: '#10b981',
  objection: '#f59e0b',
  not_interested: '#ef4444',
  neutral: '#6b7280',
  unsubscribe: '#dc2626',
  out_of_office: '#8b5cf6',
};

export default function DashboardPage() {
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [timeline, setTimeline] = useState<TimelineDataPoint[]>([]);
  const [toneData, setToneData] = useState<ToneBreakdownItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      analyticsApi.overview(),
      analyticsApi.timeline(30),
      analyticsApi.toneBreakdown(),
    ])
      .then(([overviewRes, timelineRes, toneRes]) => {
        setOverview(overviewRes.data);
        setTimeline(timelineRes.data.timeline);
        setToneData(toneRes.data.toneBreakdown);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const stats = [
    { label: 'Total Contacts', value: overview?.contacts.total || '0', sub: `${overview?.contacts.active || 0} active`, icon: Users, color: 'text-blue-600 bg-blue-50' },
    { label: 'Emails Sent', value: overview?.emails.total_sent || '0', sub: `${overview?.emails.open_rate || 0}% opened`, icon: Send, color: 'text-emerald-600 bg-emerald-50' },
    { label: 'Active Sequences', value: overview?.sequences.active || '0', sub: `${overview?.sequences.active_enrollments || 0} enrollments`, icon: GitBranch, color: 'text-violet-600 bg-violet-50' },
    { label: 'Replies', value: overview?.emails.total_replied || '0', sub: `${overview?.emails.reply_rate || 0}% rate`, icon: MessageSquare, color: 'text-amber-600 bg-amber-50' },
  ];

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-surface-500 text-sm mt-1">Overview of your email outreach performance</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="card p-5">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${s.color}`}>
                <s.icon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-2xl font-bold tracking-tight">{Number(s.value).toLocaleString()}</p>
                <p className="text-xs text-surface-500">{s.label}</p>
              </div>
            </div>
            <p className="text-xs text-surface-400 mt-2">{s.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Timeline Chart */}
        <div className="card p-5 lg:col-span-2">
          <h3 className="text-sm font-semibold mb-4">Send Volume — Last 30 Days</h3>
          <div className="h-64">
            {timeline.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={timeline}>
                  <defs>
                    <linearGradient id="colorSent" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorOpened" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" tickFormatter={(d) => new Date(d).toLocaleDateString('en', { month: 'short', day: 'numeric' })} tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip labelFormatter={(d) => new Date(d).toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric' })} />
                  <Area type="monotone" dataKey="sent" stroke="#3b82f6" fillOpacity={1} fill="url(#colorSent)" strokeWidth={2} />
                  <Area type="monotone" dataKey="opened" stroke="#10b981" fillOpacity={1} fill="url(#colorOpened)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-surface-400 text-sm">No data yet</div>
            )}
          </div>
        </div>

        {/* Tone Breakdown */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold mb-4">Reply Tone Breakdown</h3>
          {toneData.length > 0 ? (
            <>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={toneData} dataKey="count" nameKey="tone" cx="50%" cy="50%" outerRadius={70} innerRadius={40}>
                      {toneData.map((entry) => (
                        <Cell key={entry.tone} fill={TONE_COLORS[entry.tone] || '#6b7280'} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-1.5 mt-2">
                {toneData.map((t) => (
                  <div key={t.tone} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ background: TONE_COLORS[t.tone] || '#6b7280' }} />
                      <span className="capitalize">{t.tone.replace('_', ' ')}</span>
                    </div>
                    <span className="font-medium">{t.count}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-48 text-surface-400 text-sm">No replies yet</div>
          )}
        </div>
      </div>

      {/* Recent Activity */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold mb-4">Recent Activity</h3>
        {overview?.recentActivity && overview.recentActivity.length > 0 ? (
          <div className="space-y-2">
            {overview.recentActivity.slice(0, 10).map((a, i) => (
              <div key={i} className="flex items-center gap-3 py-2 border-b border-surface-100 last:border-0">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                  a.event_type === 'opened' ? 'bg-emerald-50 text-emerald-600' :
                  a.event_type === 'clicked' ? 'bg-blue-50 text-blue-600' :
                  a.event_type === 'replied' ? 'bg-amber-50 text-amber-600' :
                  a.event_type === 'bounced' ? 'bg-red-50 text-red-600' :
                  'bg-surface-100 text-surface-500'
                }`}>
                  {a.event_type === 'opened' ? <Eye className="w-3.5 h-3.5" /> :
                   a.event_type === 'clicked' ? <MousePointer className="w-3.5 h-3.5" /> :
                   a.event_type === 'replied' ? <MessageSquare className="w-3.5 h-3.5" /> :
                   a.event_type === 'bounced' ? <AlertTriangle className="w-3.5 h-3.5" /> :
                   <Mail className="w-3.5 h-3.5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">
                    <span className="font-medium">{a.to_email}</span>
                    <span className="text-surface-400 mx-1.5">—</span>
                    <span className="capitalize text-surface-500">{a.event_type}</span>
                  </p>
                </div>
                <span className="text-xs text-surface-400 flex-shrink-0">
                  {new Date(a.occurred_at).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-surface-400">No activity yet. Start sending emails to see your activity feed.</p>
        )}
      </div>
    </div>
  );
}
