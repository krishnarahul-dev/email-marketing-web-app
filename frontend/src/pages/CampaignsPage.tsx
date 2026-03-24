import React, { useEffect, useState, useCallback } from 'react';
import { campaignsApi, templatesApi, contactsApi } from '../api/client';
import { Campaign, Template, Contact } from '../types';
import {
  Plus, Send, Eye, MousePointer, MessageSquare, X, Rocket, BarChart3,
  Users, UserPlus, Trash2, Pencil, CheckCircle2, AlertCircle,
  Pause, RotateCcw, AlertTriangle
} from 'lucide-react';

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editCampaign, setEditCampaign] = useState<Campaign | null>(null);

  // Recipients
  const [recipientCampaign, setRecipientCampaign] = useState<Campaign | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContacts, setSelectedContacts] = useState<Set<string>>(new Set());
  const [contactsLoading, setContactsLoading] = useState(false);
  const [recipientResult, setRecipientResult] = useState<string | null>(null);

  // Stats
  const [selectedStats, setSelectedStats] = useState<any>(null);
  const [statsErrors, setStatsErrors] = useState<any[]>([]);
  const [statsCampaign, setStatsCampaign] = useState<Campaign | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [cRes, tRes] = await Promise.all([
        campaignsApi.list({ limit: 50 }),
        templatesApi.list({ limit: 100 }),
      ]);
      setCampaigns(cRes.data.data);
      setTemplates(tRes.data.data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ─── CREATE ──────────────────────────────────────────
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
    } catch (err: any) { alert(err.response?.data?.error || 'Failed to create campaign'); }
  };

  // ─── EDIT ────────────────────────────────────────────
  const handleEdit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editCampaign) return;
    const fd = new FormData(e.currentTarget);
    try {
      await campaignsApi.update(editCampaign.id, {
        name: fd.get('name'),
        subject: fd.get('subject'),
        template_id: fd.get('template_id') || null,
      });
      setEditCampaign(null);
      fetchData();
    } catch (err: any) { alert(err.response?.data?.error || 'Failed to update'); }
  };

  // ─── DELETE ──────────────────────────────────────────
  const handleDelete = async (id: string) => {
    if (!confirm('Delete this campaign?')) return;
    try {
      await campaignsApi.delete(id);
      fetchData();
    } catch (err: any) { alert(err.response?.data?.error || 'Cannot delete — reset to draft first'); }
  };

  // ─── PAUSE ───────────────────────────────────────────
  const handlePause = async (id: string) => {
    try {
      await campaignsApi.pause(id);
      fetchData();
    } catch (err: any) { alert(err.response?.data?.error || 'Failed to pause'); }
  };

  // ─── RESET TO DRAFT ─────────────────────────────────
  const handleReset = async (id: string, currentStatus: string) => {
    const msg = currentStatus === 'sending'
      ? 'This will stop sending and reset the campaign to draft. All email logs will be cleared. Continue?'
      : 'This will reset the campaign to draft so you can re-add recipients and re-send. Continue?';
    if (!confirm(msg)) return;
    try {
      const res = await campaignsApi.reset(id);
      alert(res.data.message || 'Campaign reset to draft');
      fetchData();
    } catch (err: any) { alert(err.response?.data?.error || 'Failed to reset'); }
  };

  // ─── RECIPIENTS ──────────────────────────────────────
  const openRecipientModal = async (campaign: Campaign) => {
    setRecipientCampaign(campaign);
    setRecipientResult(null);
    setSelectedContacts(new Set());
    setContactsLoading(true);
    try {
      const res = await contactsApi.list({ limit: 100, status: 'active' });
      setContacts(res.data.data);
    } catch (err) { console.error(err); }
    finally { setContactsLoading(false); }
  };

  const toggleContact = (id: string) => {
    setSelectedContacts((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAllContacts = () => {
    if (selectedContacts.size === contacts.length) setSelectedContacts(new Set());
    else setSelectedContacts(new Set(contacts.map((c) => c.id)));
  };

  const handleAddRecipients = async (mode: 'selected' | 'all') => {
    if (!recipientCampaign) return;
    try {
      const payload = mode === 'all' ? { filter: {} } : { contactIds: Array.from(selectedContacts) };
      if (mode === 'selected' && selectedContacts.size === 0) {
        alert('Select at least one contact');
        return;
      }
      const res = await campaignsApi.addRecipients(recipientCampaign.id, payload);
      setRecipientResult(`${res.data.recipients} recipients queued successfully`);
      fetchData();
    } catch (err: any) {
      setRecipientResult(`Error: ${err.response?.data?.error || 'Failed to add recipients'}`);
    }
  };

  // ─── SEND ────────────────────────────────────────────
  const handleSend = async (campaign: Campaign) => {
    if (!campaign.template_id) {
      alert('No template assigned. Edit the campaign and select a template first.');
      return;
    }
    if (campaign.total_recipients === 0) {
      alert('No recipients queued. Click "Add Recipients" to select contacts first.');
      return;
    }
    if (!confirm(`Send this campaign to ${campaign.total_recipients} recipients?`)) return;
    try {
      await campaignsApi.send(campaign.id);
      fetchData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to send');
    }
  };

  // ─── STATS ───────────────────────────────────────────
  const handleViewStats = async (c: Campaign) => {
    try {
      const res = await campaignsApi.stats(c.id);
      setSelectedStats(res.data.stats);
      setStatsErrors(res.data.errors || []);
      setStatsCampaign(c);
    } catch (err) { console.error(err); }
  };

  const statusBadge = (s: string) => {
    const m: Record<string, string> = {
      draft: 'badge-gray', scheduled: 'badge-blue', sending: 'badge-yellow',
      paused: 'badge-yellow', completed: 'badge-green', cancelled: 'badge-red',
    };
    return <span className={m[s] || 'badge-gray'}>{s}</span>;
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Campaigns</h1>
          <p className="text-surface-500 text-sm mt-0.5">Bulk email sends to your contacts</p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4" />New Campaign
        </button>
      </div>

      {/* Empty state */}
      {!loading && campaigns.length === 0 && (
        <div className="card p-12 text-center">
          <Send className="w-10 h-10 text-surface-300 mx-auto mb-3" />
          <p className="text-surface-500 mb-2">No campaigns yet.</p>
          <p className="text-xs text-surface-400">Workflow: Create Campaign → Add Recipients → Send</p>
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Campaign cards */}
      {!loading && campaigns.length > 0 && (
        <div className="grid gap-4">
          {campaigns.map((c) => (
            <div key={c.id} className="card p-5">
              <div className="flex items-center gap-5">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1 flex-wrap">
                    <h3 className="font-semibold truncate">{c.name}</h3>
                    {statusBadge(c.status)}
                    {c.total_recipients > 0 && (
                      <span className="badge-blue text-xs">
                        <Users className="w-3 h-3 mr-1" />{c.total_recipients} recipients
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-surface-500 truncate">{c.subject || 'No subject set'}</p>
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    <p className="text-xs text-surface-400">Created {new Date(c.created_at).toLocaleDateString()}</p>
                    {c.status === 'draft' && !c.template_id && (
                      <span className="text-xs text-amber-600 flex items-center gap-1"><AlertCircle className="w-3 h-3" />No template</span>
                    )}
                    {c.status === 'draft' && c.total_recipients === 0 && (
                      <span className="text-xs text-amber-600 flex items-center gap-1"><AlertCircle className="w-3 h-3" />No recipients</span>
                    )}
                  </div>
                </div>

                {/* Stats counters for non-draft */}
                {c.status !== 'draft' && (
                  <div className="hidden md:flex gap-5 text-center">
                    <MiniStat label="Sent" value={c.sent_count} icon={<Send className="w-3.5 h-3.5" />} />
                    <MiniStat label="Opened" value={c.open_count} icon={<Eye className="w-3.5 h-3.5" />} />
                    <MiniStat label="Clicked" value={c.click_count} icon={<MousePointer className="w-3.5 h-3.5" />} />
                    <MiniStat label="Replied" value={c.reply_count} icon={<MessageSquare className="w-3.5 h-3.5" />} />
                  </div>
                )}

                {/* ═══ ACTION BUTTONS PER STATUS ═══ */}
                <div className="flex gap-2 flex-shrink-0 flex-wrap">
                  {/* DRAFT: Edit, Add Recipients, Send, Delete */}
                  {c.status === 'draft' && (
                    <>
                      <button className="btn-ghost p-2" title="Edit" onClick={() => setEditCampaign(c)}>
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button className="btn-secondary py-2 px-3 text-xs" onClick={() => openRecipientModal(c)}>
                        <UserPlus className="w-3.5 h-3.5" />Recipients
                      </button>
                      <button
                        className="btn-primary py-2 px-3 text-xs"
                        onClick={() => handleSend(c)}
                        disabled={!c.template_id || c.total_recipients === 0}
                        title={!c.template_id ? 'Assign a template first' : c.total_recipients === 0 ? 'Add recipients first' : 'Send campaign'}
                      >
                        <Rocket className="w-3.5 h-3.5" />Send
                      </button>
                      <button className="btn-ghost p-2 text-red-500" title="Delete" onClick={() => handleDelete(c.id)}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  )}

                  {/* SENDING: Pause, Stats */}
                  {c.status === 'sending' && (
                    <>
                      <button className="btn-secondary py-2 px-3 text-xs" onClick={() => handlePause(c.id)}>
                        <Pause className="w-3.5 h-3.5" />Pause
                      </button>
                      <button className="btn-secondary py-2 px-3 text-xs" onClick={() => handleReset(c.id, c.status)}>
                        <RotateCcw className="w-3.5 h-3.5" />Reset
                      </button>
                      <button className="btn-ghost p-2" title="Stats" onClick={() => handleViewStats(c)}>
                        <BarChart3 className="w-4 h-4" />
                      </button>
                    </>
                  )}

                  {/* PAUSED: Reset, Stats */}
                  {c.status === 'paused' && (
                    <>
                      <button className="btn-secondary py-2 px-3 text-xs" onClick={() => handleReset(c.id, c.status)}>
                        <RotateCcw className="w-3.5 h-3.5" />Reset to Draft
                      </button>
                      <button className="btn-ghost p-2" title="Stats" onClick={() => handleViewStats(c)}>
                        <BarChart3 className="w-4 h-4" />
                      </button>
                    </>
                  )}

                  {/* COMPLETED / CANCELLED: Reset, Stats */}
                  {(c.status === 'completed' || c.status === 'cancelled') && (
                    <>
                      <button className="btn-secondary py-2 px-3 text-xs" onClick={() => handleReset(c.id, c.status)}>
                        <RotateCcw className="w-3.5 h-3.5" />Duplicate as Draft
                      </button>
                      <button className="btn-ghost p-2" title="Stats" onClick={() => handleViewStats(c)}>
                        <BarChart3 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Draft checklist */}
              {c.status === 'draft' && (
                <div className="mt-3 pt-3 border-t border-surface-100 flex gap-4 text-xs">
                  <CheckItem done={!!c.template_id} label="Template assigned" />
                  <CheckItem done={c.total_recipients > 0} label="Recipients added" />
                  <CheckItem done={!!c.subject} label="Subject line set" />
                </div>
              )}

              {/* Stuck warning */}
              {c.status === 'sending' && c.sent_count === 0 && (
                <div className="mt-3 pt-3 border-t border-surface-100">
                  <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 px-3 py-2 rounded-lg">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>Campaign is in "sending" status but no emails have been sent. This usually means SES credentials are not configured. Click <strong>Reset</strong> to return to draft, or check your AWS SES settings.</span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ═══ CREATE MODAL ═══ */}
      {showCreate && (
        <Modal title="New Campaign" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} className="space-y-4">
            <div><label className="label">Campaign name *</label><input name="name" className="input" required autoFocus placeholder="e.g. Q1 Outreach" /></div>
            <div>
              <label className="label">Subject line</label>
              <input name="subject" className="input" placeholder="e.g. Quick question about {{company}}" />
              <p className="text-xs text-surface-400 mt-1">{'{{first_name}}'}, {'{{company}}'} will be personalized per contact</p>
            </div>
            <div>
              <label className="label">Template</label>
              <select name="template_id" className="input">
                <option value="">Select a template</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              {templates.length === 0 && <p className="text-xs text-amber-600 mt-1">Create a template first in the Templates page</p>}
            </div>
            <button type="submit" className="btn-primary w-full">Create Campaign</button>
          </form>
        </Modal>
      )}

      {/* ═══ EDIT MODAL ═══ */}
      {editCampaign && (
        <Modal title="Edit Campaign" onClose={() => setEditCampaign(null)}>
          <form onSubmit={handleEdit} className="space-y-4">
            <div><label className="label">Campaign name *</label><input name="name" className="input" required defaultValue={editCampaign.name} /></div>
            <div><label className="label">Subject line</label><input name="subject" className="input" defaultValue={editCampaign.subject || ''} /></div>
            <div>
              <label className="label">Template</label>
              <select name="template_id" className="input" defaultValue={editCampaign.template_id || ''}>
                <option value="">Select a template</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <button type="submit" className="btn-primary w-full">Save Changes</button>
          </form>
        </Modal>
      )}

      {/* ═══ ADD RECIPIENTS MODAL ═══ */}
      {recipientCampaign && (
        <Modal title={`Add Recipients — ${recipientCampaign.name}`} onClose={() => setRecipientCampaign(null)} wide>
          {recipientResult ? (
            <div className="space-y-4">
              <div className={`p-4 rounded-lg text-sm ${recipientResult.startsWith('Error') ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}>
                <div className="flex items-center gap-2">
                  {recipientResult.startsWith('Error') ? <AlertCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                  {recipientResult}
                </div>
              </div>
              <button className="btn-secondary w-full" onClick={() => setRecipientCampaign(null)}>Done</button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-brand-50 border border-brand-200">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-brand-900">Add all active contacts</p>
                    <p className="text-xs text-brand-700 mt-0.5">Includes all contacts with "active" status</p>
                  </div>
                  <button className="btn-primary py-2 px-4 text-sm flex-shrink-0" onClick={() => handleAddRecipients('all')}>
                    <Users className="w-4 h-4" />Add All
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-3 text-xs text-surface-400">
                <div className="flex-1 h-px bg-surface-200" /><span>or select specific contacts</span><div className="flex-1 h-px bg-surface-200" />
              </div>

              {contactsLoading ? (
                <div className="flex justify-center py-8"><div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
              ) : contacts.length === 0 ? (
                <div className="text-center py-8 text-sm text-surface-400">No active contacts. Add contacts first.</div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="checkbox" checked={selectedContacts.size === contacts.length && contacts.length > 0} onChange={selectAllContacts} className="rounded" />
                      Select all ({contacts.length})
                    </label>
                    {selectedContacts.size > 0 && <span className="text-xs text-brand-600 font-medium">{selectedContacts.size} selected</span>}
                  </div>
                  <div className="max-h-64 overflow-y-auto border border-surface-200 rounded-lg divide-y divide-surface-100">
                    {contacts.map((c) => (
                      <label key={c.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-50 cursor-pointer transition-colors">
                        <input type="checkbox" checked={selectedContacts.has(c.id)} onChange={() => toggleContact(c.id)} className="rounded" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{c.email}</p>
                          <p className="text-xs text-surface-400 truncate">{[c.first_name, c.last_name].filter(Boolean).join(' ')}{c.company ? ` · ${c.company}` : ''}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                  <button className="btn-primary w-full" onClick={() => handleAddRecipients('selected')} disabled={selectedContacts.size === 0}>
                    <UserPlus className="w-4 h-4" />Add {selectedContacts.size} Recipient{selectedContacts.size !== 1 ? 's' : ''}
                  </button>
                </>
              )}
            </div>
          )}
        </Modal>
      )}

      {/* ═══ STATS MODAL ═══ */}
      {selectedStats && statsCampaign && (
        <Modal title={`Stats — ${statsCampaign.name}`} onClose={() => { setSelectedStats(null); setStatsCampaign(null); setStatsErrors([]); }}>
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Sent" value={selectedStats.sent} />
            <StatCard label="Opened" value={selectedStats.opened} />
            <StatCard label="Clicked" value={selectedStats.clicked} />
            <StatCard label="Replied" value={selectedStats.replied} />
            <StatCard label="Bounced" value={selectedStats.bounced} />
            <StatCard label="Failed" value={selectedStats.failed} />
            <StatCard label="Queued" value={selectedStats.queued} />
            <StatCard label="Total" value={selectedStats.total} />
          </div>

          {/* Error details */}
          {statsErrors.length > 0 && (
            <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200">
              <p className="text-xs font-semibold text-red-800 mb-2">Send Errors:</p>
              {statsErrors.map((e: any, i: number) => (
                <div key={i} className="flex items-start gap-2 text-xs text-red-700 mb-1">
                  <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  <span>{e.error_message} ({e.count}x)</span>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────

function CheckItem({ done, label }: { done: boolean; label: string }) {
  return (
    <span className={`flex items-center gap-1.5 ${done ? 'text-emerald-600' : 'text-surface-400'}`}>
      {done ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
      {label}
    </span>
  );
}

function MiniStat({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="min-w-[55px]">
      <div className="flex items-center justify-center gap-1 text-surface-400 mb-0.5">{icon}<span className="text-xs">{label}</span></div>
      <p className="text-sm font-semibold">{value.toLocaleString()}</p>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded-lg bg-surface-50 text-center">
      <p className="text-xl font-bold">{Number(value).toLocaleString()}</p>
      <p className="text-xs text-surface-500 mt-0.5">{label}</p>
    </div>
  );
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className={`card w-full ${wide ? 'max-w-lg' : 'max-w-md'} p-6 relative max-h-[90vh] overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface-100"><X className="w-4 h-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
