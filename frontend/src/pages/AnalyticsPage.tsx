import React, { useEffect, useState } from 'react';
import { analyticsApi } from '../api/client';
import { TimelineDataPoint, ToneBreakdownItem, ReplyMessage } from '../types';
import {
  BarChart, Bar, AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, CartesianGrid,
} from 'recharts';
import { MessageSquare, TrendingUp, Zap } from 'lucide-react';

const TONE_COLORS: Record<string, string> = {
  interested: '#10b981', objection: '#f59e0b', not_interested: '#ef4444',
  neutral: '#6b7280', unsubscribe: '#dc2626', out_of_office: '#8b5cf6',
};

const TONE_BADGES: Record<string, string> = {
  interested: 'badge-green', objection: 'badge-yellow', not_interested: 'badge-red',
  neutral: 'badge-gray', unsubscribe: 'badge-red', out_of_office: 'badge-blue',
};

export default function AnalyticsPage() {
  const [timeline, setTimeline] = useState<TimelineDataPoint[]>([]);
  const [toneData, setToneData] = useState<ToneBreakdownItem[]>([]);
  const [replies, setReplies] = useState<ReplyMessage[]>([]);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      analyticsApi.timeline(days),
      analyticsApi.toneBreakdown(),
      analyticsApi.replies(30),
    ])
      .then(([tl, td, rp]) => {
        setTimeline(tl.data.timeline);
        setToneData(td.data.toneBreakdown);
        setReplies(rp.data.replies);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [days]);

  if (loading) {
    return <div className="flex items-center justify-center h-full"><div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
          <p className="text-surface-500 text-sm mt-0.5">Detailed performance metrics</p>
        </div>
        <select className="input w-auto" value={days} onChange={(e) => setDays(parseInt(e.target.value))}>
          <option value={7}>Last 7 days</option>
          <option value={14}>Last 14 days</option>
          <option value={30}>Last 30 days</option>
          <option value={60}>Last 60 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>

      {/* Email Performance Chart */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-4 h-4 text-brand-500" />
          <h3 className="text-sm font-semibold">Email Performance</h3>
        </div>
        <div className="h-72">
          {timeline.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={timeline} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tickFormatter={(d) => new Date(d).toLocaleDateString('en', { month: 'short', day: 'numeric' })} tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip labelFormatter={(d) => new Date(d).toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' })} />
                <Legend />
                <Bar dataKey="sent" fill="#3b82f6" name="Sent" radius={[2, 2, 0, 0]} />
                <Bar dataKey="opened" fill="#10b981" name="Opened" radius={[2, 2, 0, 0]} />
                <Bar dataKey="clicked" fill="#8b5cf6" name="Clicked" radius={[2, 2, 0, 0]} />
                <Bar dataKey="replied" fill="#f59e0b" name="Replied" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-full text-surface-400 text-sm">No data for this period</div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Tone Breakdown */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="w-4 h-4 text-amber-500" />
            <h3 className="text-sm font-semibold">Reply Tone Analysis</h3>
          </div>
          {toneData.length > 0 ? (
            <div className="space-y-3">
              {toneData.map((t) => {
                const total = toneData.reduce((sum, x) => sum + parseInt(x.count), 0);
                const pct = total > 0 ? (parseInt(t.count) / total * 100) : 0;
                return (
                  <div key={t.tone} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="capitalize font-medium">{t.tone.replace('_', ' ')}</span>
                      <span className="text-surface-500">{t.count} ({pct.toFixed(1)}%)</span>
                    </div>
                    <div className="h-2 bg-surface-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct}%`, backgroundColor: TONE_COLORS[t.tone] || '#6b7280' }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-8 text-center text-sm text-surface-400">No reply data yet</div>
          )}
        </div>

        {/* Recent Replies */}
        <div className="card p-5">
          <div className="flex items-center gap-2 mb-4">
            <MessageSquare className="w-4 h-4 text-violet-500" />
            <h3 className="text-sm font-semibold">Recent Replies</h3>
          </div>
          {replies.length > 0 ? (
            <div className="space-y-3 max-h-[400px] overflow-y-auto">
              {replies.map((r) => (
                <div key={r.id} className="p-3 rounded-lg bg-surface-50 border border-surface-200">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium">
                      {[r.first_name, r.last_name].filter(Boolean).join(' ') || r.from_email}
                    </span>
                    {r.detected_tone && (
                      <span className={TONE_BADGES[r.detected_tone] || 'badge-gray'}>
                        {r.detected_tone.replace('_', ' ')}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-surface-500 mb-1">{r.from_email}</p>
                  <p className="text-sm text-surface-600 line-clamp-2">{r.body_text?.substring(0, 200) || r.subject || 'No content'}</p>
                  <p className="text-xs text-surface-400 mt-1.5">
                    {new Date(r.created_at).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    {r.tone_confidence != null && ` · ${(r.tone_confidence * 100).toFixed(0)}% confidence`}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 text-center text-sm text-surface-400">No replies yet</div>
          )}
        </div>
      </div>
    </div>
  );
}
