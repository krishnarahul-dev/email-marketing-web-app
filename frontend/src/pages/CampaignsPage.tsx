import React, { useEffect, useState, useCallback } from 'react';
import { campaignsApi, templatesApi } from '../api/client';
import { Campaign, Template } from '../types';
import { Plus, Send, Pause, Eye, MousePointer, MessageSquare, X, Rocket, BarChart3 } from 'lucide-react';

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedStats, setSelectedStats] = useState<any>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [cRes, tRes] = await Promise.all([campaignsApi.list({ limit: 50 }), templatesApi.list({ limit: 100 })]);
      setCampaigns(cRes.data.data);
      setTemplates(tRes.data.data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      await campaignsApi.create({
        name: fd.get('name'),
        subject: fd.get('subject'),
        template_id: fd.get('template_id') || null,
      });
      setShowCreate(false);
      fetchData();
    } catch (err: any) { alert(err.response?.data?.error || 'Failed'); }
  };

  const handleSend = async (id: string) => {
    if (!confirm('Start sending this campaign?')) return;
    try {
      await campaignsApi.send(id);
      fetchData();
    } catch (err: any) { alert(err.response?.data?.error || 'Failed to send'); }
  };

  const handleViewStats = async (c: Campaign) => {
    try {
      const res = await campaignsApi.stats(c.id);
      setSelectedStats(res.data.stats);
      setSelectedCampaign(c);
    } catch (err) { console.error(err); }
  };

  const statusColor = (s: string) => {
    const m: Record<string, string> = { draft: 'badge-gray', scheduled: 'badge-blue', sending: 'badge-yellow', paused: 'badge-yellow', completed: 'badge-green', cancelled: 'badge-red' };
    return m[s] || 'badge-gray';
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Campaigns</h1>
          <p className="text-surface-500 text-sm mt-0.5">Bulk email sends to your contacts</p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}><Plus className="w-4 h-4" />New Campaign</button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : campaigns.length === 0 ? (
        <div className="card p-12 text-center">
          <Send className="w-10 h-10 text-surface-300 mx-auto mb-3" />
          <p className="text-surface-500">No campaigns yet. Create your first campaign to start sending.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {campaigns.map((c) => (
            <div key={c.id} className="card p-5 flex items-center gap-5">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1">
                  <h3 className="font-semibold truncate">{c.name}</h3>
                  <span className={statusColor(c.status)}>{c.status}</span>
                </div>
                <p className="text-sm text-surface-500 truncate">{c.subject || 'No subject set'}</p>
                <p className="text-xs text-surface-400 mt-1">Created {new Date(c.created_at).toLocaleDateString()}</p>
              </div>

              <div className="hidden md:flex gap-6 text-center">
                <Stat label="Sent" value={c.sent_count} icon={<Send className="w-3.5 h-3.5" />} />
                <Stat label="Opened" value={c.open_count} icon={<Eye className="w-3.5 h-3.5" />} />
                <Stat label="Clicked" value={c.click_count} icon={<MousePointer className="w-3.5 h-3.5" />} />
                <Stat label="Replied" value={c.reply_count} icon={<MessageSquare className="w-3.5 h-3.5" />} />
              </div>

              <div className="flex gap-2 flex-shrink-0">
                <button className="btn-ghost p-2" title="View stats" onClick={() => handleViewStats(c)}>
                  <BarChart3 className="w-4 h-4" />
                </button>
                {c.status === 'draft' && (
                  <button className="btn-primary py-2 px-3 text-xs" onClick={() => handleSend(c.id)}>
                    <Rocket className="w-3.5 h-3.5" />Send
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <Modal title="New Campaign" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} className="space-y-4">
            <div><label className="label">Campaign name *</label><input name="name" className="input" required /></div>
            <div><label className="label">Subject line</label><input name="subject" className="input" /></div>
            <div>
              <label className="label">Template</label>
              <select name="template_id" className="input">
                <option value="">Select a template</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <button type="submit" className="btn-primary w-full">Create Campaign</button>
          </form>
        </Modal>
      )}

      {/* Stats Modal */}
      {selectedStats && selectedCampaign && (
        <Modal title={`Stats — ${selectedCampaign.name}`} onClose={() => { setSelectedStats(null); setSelectedCampaign(null); }}>
          <div className="grid grid-cols-2 gap-4">
            <StatCard label="Sent" value={selectedStats.sent} />
            <StatCard label="Opened" value={selectedStats.opened} />
            <StatCard label="Clicked" value={selectedStats.clicked} />
            <StatCard label="Replied" value={selectedStats.replied} />
            <StatCard label="Bounced" value={selectedStats.bounced} />
            <StatCard label="Complained" value={selectedStats.complained} />
          </div>
        </Modal>
      )}
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="min-w-[60px]">
      <div className="flex items-center justify-center gap-1 text-surface-400 mb-0.5">{icon}<span className="text-xs">{label}</span></div>
      <p className="text-sm font-semibold">{value.toLocaleString()}</p>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded-lg bg-surface-50 text-center">
      <p className="text-2xl font-bold">{Number(value).toLocaleString()}</p>
      <p className="text-xs text-surface-500 mt-0.5">{label}</p>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="card w-full max-w-md p-6 relative" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface-100"><X className="w-4 h-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
