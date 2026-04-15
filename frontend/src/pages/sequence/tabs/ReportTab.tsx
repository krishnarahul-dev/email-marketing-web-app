import React, { useEffect, useState, useCallback } from 'react';
import { sequencesApi } from '../../../api/client';
import { TrendingUp, Users, Mail, Eye, MousePointer, MessageSquare, Heart, Building, Briefcase } from 'lucide-react';

interface ReportData {
  funnelByContact: { delivered: string; opened: string; clicked: string; replied: string };
  funnelByEmail: { delivered: string; opened: string; clicked: string; replied: string };
  interested: number;
  audienceByCompany: Array<{ company: string; sent_count: string; opened: string; replied: string }>;
  audienceByTitle: Array<{ title: string; sent_count: string; opened: string; replied: string }>;
  stepPerformance: Array<{
    id: string; step_order: number; step_name: string | null; step_type: string; subject: string | null;
    sent: string; opened: string; clicked: string; replied: string; bounced: string;
  }>;
}

export default function ReportTab({ sequenceId }: { sequenceId: string }) {
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await sequencesApi.report(sequenceId);
      setData(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [sequenceId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!data) {
    return <div className="p-6 text-center text-surface-500">No report data available</div>;
  }

  return (
    <div className="max-w-6xl mx-auto px-6 lg:px-8 py-6 space-y-6">
      {/* Funnel by Contact */}
      <FunnelCard
        title="Sequence Funnel by Contact"
        description="Each contact counted once at the deepest stage they reached"
        delivered={parseInt(data.funnelByContact.delivered)}
        opened={parseInt(data.funnelByContact.opened)}
        replied={parseInt(data.funnelByContact.replied)}
        interested={data.interested}
      />

      {/* Funnel by Email */}
      <FunnelCard
        title="Sequence Funnel by Email"
        description="Every email send counted (a contact at step 3 = 3 deliveries)"
        delivered={parseInt(data.funnelByEmail.delivered)}
        opened={parseInt(data.funnelByEmail.opened)}
        replied={parseInt(data.funnelByEmail.replied)}
        interested={data.interested}
      />

      {/* Step Performance */}
      <div className="bg-white border border-surface-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-surface-100">
          <h3 className="font-semibold flex items-center gap-2"><TrendingUp className="w-4 h-4 text-brand-500" />Per-Step Performance</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-surface-50 border-b border-surface-200">
              <tr>
                <th className="text-left px-4 py-2 text-xs font-medium text-surface-500 uppercase tracking-wider">Step</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-surface-500 uppercase tracking-wider">Subject</th>
                <th className="text-right px-4 py-2 text-xs font-medium text-surface-500 uppercase tracking-wider">Sent</th>
                <th className="text-right px-4 py-2 text-xs font-medium text-surface-500 uppercase tracking-wider">Opened</th>
                <th className="text-right px-4 py-2 text-xs font-medium text-surface-500 uppercase tracking-wider">Clicked</th>
                <th className="text-right px-4 py-2 text-xs font-medium text-surface-500 uppercase tracking-wider">Replied</th>
                <th className="text-right px-4 py-2 text-xs font-medium text-surface-500 uppercase tracking-wider">Bounced</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {data.stepPerformance.map((s) => {
                const sent = parseInt(s.sent);
                const openRate = sent > 0 ? (parseInt(s.opened) / sent * 100).toFixed(1) : '0.0';
                const replyRate = sent > 0 ? (parseInt(s.replied) / sent * 100).toFixed(1) : '0.0';
                return (
                  <tr key={s.id}>
                    <td className="px-4 py-3 text-sm">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-surface-100 text-xs font-semibold mr-2">{s.step_order}</span>
                      <span className="text-surface-600 capitalize">{s.step_type}</span>
                    </td>
                    <td className="px-4 py-3 text-sm text-surface-700 max-w-xs truncate">{s.subject || s.step_name || '—'}</td>
                    <td className="px-4 py-3 text-sm text-right font-medium">{sent.toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm text-right">
                      {parseInt(s.opened).toLocaleString()} <span className="text-xs text-surface-400">({openRate}%)</span>
                    </td>
                    <td className="px-4 py-3 text-sm text-right">{parseInt(s.clicked).toLocaleString()}</td>
                    <td className="px-4 py-3 text-sm text-right">
                      {parseInt(s.replied).toLocaleString()} <span className="text-xs text-surface-400">({replyRate}%)</span>
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-red-600">{parseInt(s.bounced).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Audience by Title + Company */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <AudienceTable title="Most Engaged Job Titles" icon={Briefcase} rows={data.audienceByTitle.map(r => ({ label: r.title, sent: r.sent_count, opened: r.opened, replied: r.replied }))} />
        <AudienceTable title="Most Engaged Companies" icon={Building} rows={data.audienceByCompany.map(r => ({ label: r.company, sent: r.sent_count, opened: r.opened, replied: r.replied }))} />
      </div>
    </div>
  );
}

function FunnelCard({
  title, description, delivered, opened, replied, interested,
}: {
  title: string;
  description: string;
  delivered: number;
  opened: number;
  replied: number;
  interested: number;
}) {
  const stages = [
    { label: 'Delivered', count: delivered, icon: Mail, color: 'bg-blue-500' },
    { label: 'Opened', count: opened, icon: Eye, color: 'bg-emerald-500' },
    { label: 'Replied', count: replied, icon: MessageSquare, color: 'bg-violet-500' },
    { label: 'Interested', count: interested, icon: Heart, color: 'bg-amber-500' },
  ];

  const conversion = delivered > 0 ? ((interested / delivered) * 100).toFixed(2) : '0.00';

  return (
    <div className="bg-white border border-surface-200 rounded-xl p-5">
      <div className="mb-4">
        <h3 className="font-semibold">{title}</h3>
        <p className="text-xs text-surface-500 mt-0.5">{description}</p>
      </div>
      <div className="flex items-end gap-1">
        {stages.map((stage, i) => {
          const pct = delivered > 0 ? (stage.count / delivered) * 100 : 0;
          const ratePct = delivered > 0 && i > 0 ? Math.round((stage.count / delivered) * 100) : null;
          return (
            <React.Fragment key={stage.label}>
              <div className="flex-1 flex flex-col items-center">
                <div
                  className={`w-full rounded-t-lg ${stage.color} transition-all duration-500 flex items-end justify-center text-white font-semibold pb-1`}
                  style={{ height: `${Math.max(40, pct * 1.5)}px`, opacity: 0.2 + (pct / 100) * 0.8 }}
                >
                  {stage.count > 0 && stage.count.toLocaleString()}
                </div>
                <div className="mt-2 text-center">
                  <p className="text-xs font-medium text-surface-700">{stage.label}</p>
                  {stage.count === 0 && <p className="text-xs text-surface-400">0</p>}
                </div>
              </div>
              {i < stages.length - 1 && (
                <div className="flex flex-col items-center justify-center pb-12 px-1">
                  <span className="text-xs text-surface-400">{ratePct !== null ? `${ratePct}%` : ''}</span>
                </div>
              )}
            </React.Fragment>
          );
        })}
        <div className="flex flex-col items-center justify-center pb-8 px-2">
          <span className="text-2xl text-surface-300 font-light">=</span>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-surface-900">{conversion}%</p>
          <p className="text-xs text-surface-500 mt-1">Conversion</p>
        </div>
      </div>
    </div>
  );
}

function AudienceTable({ title, icon: Icon, rows }: {
  title: string;
  icon: any;
  rows: Array<{ label: string; sent: string; opened: string; replied: string }>;
}) {
  return (
    <div className="bg-white border border-surface-200 rounded-xl p-5">
      <h3 className="font-semibold flex items-center gap-2 mb-4"><Icon className="w-4 h-4 text-brand-500" />{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-surface-400 py-4 text-center">No data</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row, i) => {
            const sent = parseInt(row.sent);
            const opened = parseInt(row.opened);
            const replied = parseInt(row.replied);
            const openRate = sent > 0 ? (opened / sent * 100).toFixed(0) : '0';
            return (
              <div key={i} className="flex items-center justify-between py-1.5 border-b border-surface-100 last:border-0 text-sm">
                <span className="font-medium truncate flex-1 min-w-0 mr-3">{row.label || '—'}</span>
                <div className="flex items-center gap-3 flex-shrink-0 text-xs">
                  <span className="text-surface-500">{sent} sent</span>
                  <span className="text-emerald-600">{openRate}% open</span>
                  <span className="text-violet-600">{replied} reply</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
