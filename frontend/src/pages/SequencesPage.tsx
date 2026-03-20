import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { sequencesApi, templatesApi } from '../api/client';
import { Sequence, SequenceStep, Template } from '../types';
import { Plus, GitBranch, Play, Pause, ChevronRight, X, Clock, Mail, Filter, Trash2, Users } from 'lucide-react';

export default function SequencesPage() {
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [activeSeq, setActiveSeq] = useState<string | null>(null);
  const [steps, setSteps] = useState<SequenceStep[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [showAddStep, setShowAddStep] = useState(false);
  const [seqDetail, setSeqDetail] = useState<Sequence | null>(null);

  const fetchSequences = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, tRes] = await Promise.all([sequencesApi.list({ limit: 50 }), templatesApi.list({ limit: 100 })]);
      setSequences(sRes.data.data);
      setTemplates(tRes.data.data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchSequences(); }, [fetchSequences]);

  const loadSequenceDetail = async (id: string) => {
    try {
      const res = await sequencesApi.get(id);
      setSteps(res.data.steps);
      setSeqDetail(res.data.sequence);
      setActiveSeq(id);
    } catch (err) { console.error(err); }
  };

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      await sequencesApi.create({ name: fd.get('name'), description: fd.get('description') });
      setShowCreate(false);
      fetchSequences();
    } catch (err: any) { alert(err.response?.data?.error || 'Failed'); }
  };

  const handleAddStep = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!activeSeq) return;
    const fd = new FormData(e.currentTarget);
    try {
      await sequencesApi.addStep(activeSeq, {
        step_order: steps.length + 1,
        step_type: fd.get('step_type'),
        delay_days: parseInt(fd.get('delay_days') as string) || 0,
        delay_hours: parseInt(fd.get('delay_hours') as string) || 0,
        template_id: fd.get('template_id') || null,
        subject_override: fd.get('subject_override') || null,
      });
      setShowAddStep(false);
      loadSequenceDetail(activeSeq);
    } catch (err: any) { alert(err.response?.data?.error || 'Failed'); }
  };

  const handleDeleteStep = async (stepId: string) => {
    if (!activeSeq || !confirm('Delete this step?')) return;
    try {
      await sequencesApi.deleteStep(activeSeq, stepId);
      loadSequenceDetail(activeSeq);
    } catch (err) { console.error(err); }
  };

  const handleToggleStatus = async (seq: Sequence) => {
    const newStatus = seq.status === 'active' ? 'paused' : 'active';
    try {
      await sequencesApi.update(seq.id, { status: newStatus });
      fetchSequences();
      if (activeSeq === seq.id) loadSequenceDetail(seq.id);
    } catch (err: any) { alert(err.response?.data?.error || 'Failed'); }
  };

  const statusColor = (s: string) => {
    const m: Record<string, string> = { draft: 'badge-gray', active: 'badge-green', paused: 'badge-yellow', archived: 'badge-red' };
    return m[s] || 'badge-gray';
  };

  const stepIcon = (type: string) => {
    if (type === 'email') return <Mail className="w-4 h-4 text-brand-500" />;
    if (type === 'delay') return <Clock className="w-4 h-4 text-amber-500" />;
    return <Filter className="w-4 h-4 text-violet-500" />;
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Sequences</h1>
          <p className="text-surface-500 text-sm mt-0.5">Automated multi-step follow-up flows</p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}><Plus className="w-4 h-4" />New Sequence</button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sequence List */}
        <div className="space-y-3">
          {loading ? (
            <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
          ) : sequences.length === 0 ? (
            <div className="card p-8 text-center">
              <GitBranch className="w-8 h-8 text-surface-300 mx-auto mb-2" />
              <p className="text-sm text-surface-400">No sequences yet</p>
            </div>
          ) : sequences.map((s) => (
            <button
              key={s.id}
              onClick={() => loadSequenceDetail(s.id)}
              className={`card w-full text-left p-4 transition-all ${activeSeq === s.id ? 'ring-2 ring-brand-500 border-brand-200' : 'hover:border-surface-300'}`}
            >
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-semibold text-sm truncate flex-1">{s.name}</h3>
                <span className={statusColor(s.status)}>{s.status}</span>
              </div>
              <div className="flex gap-3 text-xs text-surface-400">
                <span>{s.step_count || 0} steps</span>
                <span>{s.enrollment_count || 0} enrolled</span>
                <span>{s.active_enrollments || 0} active</span>
              </div>
            </button>
          ))}
        </div>

        {/* Step Builder */}
        <div className="lg:col-span-2">
          {activeSeq && seqDetail ? (
            <div className="space-y-4">
              <div className="card p-5">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-lg font-semibold">{seqDetail.name}</h2>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleToggleStatus(seqDetail)}
                      className={`btn text-xs py-1.5 px-3 ${seqDetail.status === 'active' ? 'btn-secondary' : 'btn-primary'}`}
                    >
                      {seqDetail.status === 'active' ? <><Pause className="w-3 h-3" />Pause</> : <><Play className="w-3 h-3" />Activate</>}
                    </button>
                  </div>
                </div>
                <p className="text-sm text-surface-500">{seqDetail.description || 'No description'}</p>
              </div>

              {/* Steps */}
              <div className="space-y-0">
                {steps.filter(s => !s.parent_step_id).map((step, i) => (
                  <div key={step.id}>
                    {i > 0 && <div className="flex justify-center py-1"><div className="w-px h-6 bg-surface-300" /></div>}
                    <div className="card p-4 flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-surface-100 flex items-center justify-center flex-shrink-0">
                        {stepIcon(step.step_type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">
                          {step.step_type === 'email' ? (step.template_name || 'Email Step') :
                           step.step_type === 'delay' ? `Wait ${step.delay_days}d ${step.delay_hours}h` :
                           `Condition: ${step.condition_type}`}
                        </p>
                        <p className="text-xs text-surface-400">
                          Step {step.step_order} · {step.step_type}
                          {step.delay_days > 0 && ` · ${step.delay_days} day delay`}
                        </p>
                      </div>
                      <button className="btn-ghost p-1.5" onClick={() => handleDeleteStep(step.id)}>
                        <Trash2 className="w-3.5 h-3.5 text-surface-400" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <button className="btn-secondary w-full" onClick={() => setShowAddStep(true)}>
                <Plus className="w-4 h-4" />Add Step
              </button>
            </div>
          ) : (
            <div className="card p-12 text-center">
              <ChevronRight className="w-8 h-8 text-surface-300 mx-auto mb-2" />
              <p className="text-surface-400 text-sm">Select a sequence to view and edit its steps</p>
            </div>
          )}
        </div>
      </div>

      {/* Create Sequence Modal */}
      {showCreate && (
        <Modal title="New Sequence" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} className="space-y-4">
            <div><label className="label">Name *</label><input name="name" className="input" required /></div>
            <div><label className="label">Description</label><textarea name="description" className="input" rows={2} /></div>
            <button type="submit" className="btn-primary w-full">Create Sequence</button>
          </form>
        </Modal>
      )}

      {/* Add Step Modal */}
      {showAddStep && (
        <Modal title="Add Step" onClose={() => setShowAddStep(false)}>
          <form onSubmit={handleAddStep} className="space-y-4">
            <div>
              <label className="label">Step type</label>
              <select name="step_type" className="input" required>
                <option value="email">Email</option>
                <option value="delay">Delay</option>
                <option value="condition">Condition</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Delay (days)</label><input name="delay_days" type="number" className="input" defaultValue={0} min={0} /></div>
              <div><label className="label">Delay (hours)</label><input name="delay_hours" type="number" className="input" defaultValue={0} min={0} /></div>
            </div>
            <div>
              <label className="label">Template</label>
              <select name="template_id" className="input">
                <option value="">Select template</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div><label className="label">Subject override</label><input name="subject_override" className="input" /></div>
            <button type="submit" className="btn-primary w-full">Add Step</button>
          </form>
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="card w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface-100"><X className="w-4 h-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
