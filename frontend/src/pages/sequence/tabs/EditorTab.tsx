import React, { useEffect, useState, useCallback } from 'react';
import { sequencesApi } from '../../../api/client';
import {
  Plus, Mail, Clock, Phone, Linkedin, CheckSquare, GitBranch,
  Trash2, ChevronDown, ChevronUp, Save, AlertCircle, Pencil, X, Bold, Italic,
  Link as LinkIcon, List as ListIcon,
} from 'lucide-react';

interface Step {
  id: string;
  step_order: number;
  step_type: 'email' | 'delay' | 'condition' | 'call' | 'linkedin' | 'task';
  step_name: string | null;
  delay_days: number;
  delay_hours: number;
  delay_minutes: number;
  delay_business_days: number;
  subject: string | null;
  body_html: string | null;
  task_type: string | null;
  task_instructions: string | null;
  thread_mode: 'new' | 'reply';
  include_signature: boolean;
  reference_step_id: string | null;
  is_active: boolean;
}

interface Sequence {
  id: string;
  name: string;
  status: string;
}

const STEP_TYPE_OPTIONS = [
  { value: 'email', label: 'Automatic Email', icon: Mail, color: 'text-blue-500 bg-blue-50' },
  { value: 'delay', label: 'Wait', icon: Clock, color: 'text-amber-500 bg-amber-50' },
  { value: 'call', label: 'Phone Call', icon: Phone, color: 'text-emerald-500 bg-emerald-50' },
  { value: 'linkedin', label: 'LinkedIn Action', icon: Linkedin, color: 'text-sky-600 bg-sky-50' },
  { value: 'task', label: 'Custom Task', icon: CheckSquare, color: 'text-violet-500 bg-violet-50' },
];

export default function EditorTab({ sequence, onUpdate }: { sequence: Sequence; onUpdate: () => void }) {
  const [steps, setSteps] = useState<Step[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [addAfterIdx, setAddAfterIdx] = useState<number | null>(null);
  const [savingStep, setSavingStep] = useState<string | null>(null);

  const fetchSteps = useCallback(async () => {
    setLoading(true);
    try {
      const res = await sequencesApi.get(sequence.id);
      const sortedSteps = (res.data.steps || [])
        .filter((s: Step) => !(s as any).parent_step_id)
        .sort((a: Step, b: Step) => a.step_order - b.step_order);
      setSteps(sortedSteps);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [sequence.id]);

  useEffect(() => { fetchSteps(); }, [fetchSteps]);

  const handleAddStep = async (type: string, afterIdx: number) => {
    try {
      const newOrder = afterIdx + 2;
      // Bump existing steps after this point
      const stepsToBump = steps.filter((s) => s.step_order >= newOrder);
      for (const s of stepsToBump) {
        await sequencesApi.updateStep(sequence.id, s.id, { step_order: s.step_order + 1 });
      }

      await sequencesApi.addStep(sequence.id, {
        step_order: newOrder,
        step_type: type,
        delay_days: type === 'email' && afterIdx >= 0 ? 3 : 0,
        delay_business_days: 0,
        delay_hours: 0,
        delay_minutes: 0,
        step_name: STEP_TYPE_OPTIONS.find((o) => o.value === type)?.label || 'New Step',
      });

      setShowAddMenu(false);
      setAddAfterIdx(null);
      fetchSteps();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to add step');
    }
  };

  const handleDeleteStep = async (stepId: string) => {
    if (!confirm('Delete this step? Any contacts on this step will skip ahead.')) return;
    try {
      await sequencesApi.deleteStep(sequence.id, stepId);
      fetchSteps();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to delete');
    }
  };

  const handleSaveStep = async (stepId: string, updates: Partial<Step>) => {
    setSavingStep(stepId);
    try {
      await sequencesApi.updateStep(sequence.id, stepId, updates);
      fetchSteps();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to save step');
    } finally {
      setSavingStep(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6 lg:px-8 py-6">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2 px-3 py-2 bg-white border border-surface-200 rounded-lg text-sm">
          <span className="font-medium">{steps.length}</span>
          <span className="text-surface-500">step{steps.length !== 1 ? 's' : ''}</span>
        </div>
        <button
          onClick={() => setExpandedStep(null)}
          className="btn-secondary text-sm py-2 px-3"
          title="Collapse all"
        >
          Collapse steps
        </button>
      </div>

      {/* Steps */}
      {steps.length === 0 ? (
        <div className="bg-white border border-dashed border-surface-300 rounded-xl p-12 text-center">
          <Mail className="w-10 h-10 text-surface-300 mx-auto mb-3" />
          <h3 className="font-medium text-surface-700 mb-1">No steps yet</h3>
          <p className="text-sm text-surface-500 mb-4">Add your first step to start building this sequence</p>
          <button
            onClick={() => { setAddAfterIdx(-1); setShowAddMenu(true); }}
            className="btn-primary"
          >
            <Plus className="w-4 h-4" />Add Step
          </button>

          {showAddMenu && addAfterIdx === -1 && (
            <AddStepMenu
              onSelect={(type) => handleAddStep(type, -1)}
              onClose={() => { setShowAddMenu(false); setAddAfterIdx(null); }}
            />
          )}
        </div>
      ) : (
        <div className="space-y-0">
          {steps.map((step, idx) => (
            <React.Fragment key={step.id}>
              <StepCard
                step={step}
                index={idx}
                expanded={expandedStep === step.id}
                onExpand={() => setExpandedStep(expandedStep === step.id ? null : step.id)}
                onDelete={() => handleDeleteStep(step.id)}
                onSave={(updates) => handleSaveStep(step.id, updates)}
                saving={savingStep === step.id}
              />

              {/* Insert step button between steps */}
              <div className="flex justify-center py-1 relative">
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-px h-full bg-surface-300" />
                </div>
                <button
                  onClick={() => { setAddAfterIdx(idx); setShowAddMenu(true); }}
                  className="relative z-10 w-7 h-7 rounded-full bg-white border-2 border-surface-300 hover:border-brand-500 hover:bg-brand-50 hover:text-brand-600 text-surface-400 flex items-center justify-center transition-colors"
                  title="Insert step here"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
                {showAddMenu && addAfterIdx === idx && (
                  <AddStepMenu
                    onSelect={(type) => handleAddStep(type, idx)}
                    onClose={() => { setShowAddMenu(false); setAddAfterIdx(null); }}
                  />
                )}
              </div>
            </React.Fragment>
          ))}

          {/* Add at end */}
          <div className="flex justify-center pt-4 relative">
            <button
              onClick={() => { setAddAfterIdx(steps.length - 1); setShowAddMenu(true); }}
              className="btn-secondary text-sm"
            >
              <Plus className="w-4 h-4" />Add Step
            </button>
            {showAddMenu && addAfterIdx === steps.length - 1 && (
              <AddStepMenu
                onSelect={(type) => handleAddStep(type, steps.length - 1)}
                onClose={() => { setShowAddMenu(false); setAddAfterIdx(null); }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Step Card ───────────────────────────────────────
function StepCard({
  step, index, expanded, onExpand, onDelete, onSave, saving,
}: {
  step: Step;
  index: number;
  expanded: boolean;
  onExpand: () => void;
  onDelete: () => void;
  onSave: (updates: Partial<Step>) => void;
  saving: boolean;
}) {
  const config = STEP_TYPE_OPTIONS.find((o) => o.value === step.step_type) || STEP_TYPE_OPTIONS[0];
  const Icon = config.icon;

  const delayLabel = formatDelay(step);

  return (
    <div className="bg-white border border-surface-200 rounded-xl overflow-hidden">
      {/* Step header */}
      <div className="px-4 py-3 flex items-center gap-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-surface-100 text-surface-700 font-semibold text-sm flex-shrink-0">
          {index + 1}
        </div>
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${config.color}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">
            {step.step_name || config.label}
          </p>
          <p className="text-xs text-surface-500">
            {index === 0 ? 'Send immediately' : delayLabel}
            {step.subject && step.step_type === 'email' && ` · ${step.subject}`}
          </p>
        </div>
        <button onClick={onDelete} className="btn-ghost p-1.5 text-surface-400 hover:text-red-500" title="Delete step">
          <Trash2 className="w-4 h-4" />
        </button>
        <button onClick={onExpand} className="btn-ghost p-1.5">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Expanded editor */}
      {expanded && (
        <div className="border-t border-surface-100 p-4">
          <StepEditor step={step} index={index} onSave={onSave} saving={saving} />
        </div>
      )}
    </div>
  );
}

// ─── Step Editor (expanded form) ─────────────────────
function StepEditor({
  step, index, onSave, saving,
}: {
  step: Step;
  index: number;
  onSave: (updates: Partial<Step>) => void;
  saving: boolean;
}) {
  const [name, setName] = useState(step.step_name || '');
  const [subject, setSubject] = useState(step.subject || '');
  const [bodyHtml, setBodyHtml] = useState(step.body_html || '');
  const [taskInstructions, setTaskInstructions] = useState(step.task_instructions || '');
  const [includeSignature, setIncludeSignature] = useState(step.include_signature !== false);
  const [threadMode, setThreadMode] = useState<'new' | 'reply'>(step.thread_mode || 'new');

  const handleSave = () => {
    const updates: Partial<Step> = { step_name: name };
    if (step.step_type === 'email') {
      updates.subject = subject;
      updates.body_html = bodyHtml;
      updates.include_signature = includeSignature;
      updates.thread_mode = threadMode;
    } else if (step.step_type === 'call' || step.step_type === 'linkedin' || step.step_type === 'task') {
      updates.task_instructions = taskInstructions;
    }
    onSave(updates);
  };

  return (
    <div className="space-y-4">
      {/* Step name */}
      <div>
        <label className="label">Step name</label>
        <input
          type="text"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={`Step ${index + 1}`}
        />
      </div>

      {/* Delay editor (only for non-first steps) */}
      {index > 0 && <DelayEditor step={step} onSave={(updates) => onSave(updates)} />}

      {/* Type-specific editors */}
      {step.step_type === 'email' && (
        <>
          {/* Thread mode */}
          {index > 0 && (
            <div>
              <label className="label">Email thread</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setThreadMode('new')}
                  className={`flex-1 px-3 py-2 text-sm rounded-lg border transition-colors ${
                    threadMode === 'new' ? 'bg-brand-50 border-brand-300 text-brand-700' : 'bg-white border-surface-200 text-surface-600'
                  }`}
                >
                  New thread
                </button>
                <button
                  type="button"
                  onClick={() => setThreadMode('reply')}
                  className={`flex-1 px-3 py-2 text-sm rounded-lg border transition-colors ${
                    threadMode === 'reply' ? 'bg-brand-50 border-brand-300 text-brand-700' : 'bg-white border-surface-200 text-surface-600'
                  }`}
                >
                  Reply to previous
                </button>
              </div>
              <p className="text-xs text-surface-400 mt-1">
                "Reply" continues the same Gmail thread; "New thread" starts a fresh conversation.
              </p>
            </div>
          )}

          {/* Subject */}
          <div>
            <label className="label">Subject {threadMode === 'reply' && <span className="text-xs text-surface-400">(prefixed with Re:)</span>}</label>
            <input
              type="text"
              className="input"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Quick question, {{first_name}}"
            />
            <p className="text-xs text-surface-400 mt-1">
              Use <code className="bg-surface-100 px-1 rounded">{'{{first_name}}'}</code>, <code className="bg-surface-100 px-1 rounded">{'{{company}}'}</code> for personalization
            </p>
          </div>

          {/* Body editor */}
          <div>
            <label className="label">Email body</label>
            <RichTextEditor value={bodyHtml} onChange={setBodyHtml} />
          </div>

          {/* Signature toggle */}
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={includeSignature}
              onChange={(e) => setIncludeSignature(e.target.checked)}
              className="rounded"
            />
            Include signature from workspace settings
          </label>
        </>
      )}

      {(step.step_type === 'call' || step.step_type === 'linkedin' || step.step_type === 'task') && (
        <div>
          <label className="label">Instructions for the assignee</label>
          <textarea
            className="input"
            rows={4}
            value={taskInstructions}
            onChange={(e) => setTaskInstructions(e.target.value)}
            placeholder={
              step.step_type === 'call' ? 'What to talk about, key questions, voicemail script...' :
              step.step_type === 'linkedin' ? 'LinkedIn message text or what action to take...' :
              'What to do for this contact...'
            }
          />
        </div>
      )}

      {step.step_type === 'delay' && (
        <p className="text-sm text-surface-500 bg-surface-50 px-3 py-2 rounded-lg">
          This is a wait step. The sequence will pause for the duration above before continuing to the next step.
        </p>
      )}

      {/* Save button */}
      <div className="flex justify-end gap-2 pt-2 border-t border-surface-100">
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-primary text-sm"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Saving...' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}

// ─── Delay Editor (matches your screenshot 9) ────────
function DelayEditor({ step, onSave }: { step: Step; onSave: (updates: Partial<Step>) => void }) {
  const [showEditor, setShowEditor] = useState(false);
  const [unit, setUnit] = useState<'minutes' | 'hours' | 'days'>(
    step.delay_days > 0 ? 'days' : step.delay_hours > 0 ? 'hours' : step.delay_minutes > 0 ? 'minutes' : 'days'
  );
  const [value, setValue] = useState(
    step.delay_days || step.delay_hours || step.delay_minutes || 0
  );
  const [immediate, setImmediate] = useState(value === 0);

  const handleSave = () => {
    const updates: Partial<Step> = {
      delay_days: 0, delay_hours: 0, delay_minutes: 0, delay_business_days: 0,
    };
    if (!immediate && value > 0) {
      if (unit === 'minutes') updates.delay_minutes = value;
      else if (unit === 'hours') updates.delay_hours = value;
      else updates.delay_days = value;
    }
    onSave(updates);
    setShowEditor(false);
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Clock className="w-4 h-4 text-surface-400" />
        <span className="text-sm text-surface-700">
          {formatDelay(step)}
        </span>
        <button
          onClick={() => setShowEditor(!showEditor)}
          className="btn-ghost p-1 text-surface-400 hover:text-brand-600"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      </div>

      {showEditor && (
        <div className="bg-surface-50 border border-surface-200 rounded-lg p-4 space-y-3">
          <p className="text-sm font-medium text-surface-700">When to start this step</p>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="radio"
              checked={immediate}
              onChange={() => setImmediate(true)}
            />
            Immediately after previous step is completed
          </label>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="radio"
              checked={!immediate}
              onChange={() => setImmediate(false)}
            />
            <span>Execute step after</span>
            <input
              type="number"
              min={1}
              max={365}
              value={value}
              onChange={(e) => { setValue(parseInt(e.target.value) || 0); setImmediate(false); }}
              className="input w-20 py-1 px-2 text-sm"
              disabled={immediate}
            />
            <select
              value={unit}
              onChange={(e) => { setUnit(e.target.value as any); setImmediate(false); }}
              disabled={immediate}
              className="input w-28 py-1 px-2 text-sm"
            >
              <option value="minutes">minutes</option>
              <option value="hours">hours</option>
              <option value="days">days</option>
            </select>
          </label>

          <div className="flex justify-end gap-2 pt-2 border-t border-surface-200">
            <button onClick={() => setShowEditor(false)} className="btn-ghost text-xs">Cancel</button>
            <button onClick={handleSave} className="btn-primary text-xs">Save delay</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Rich Text Editor ────────────────────────────────
function RichTextEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const editorRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value;
    }
  }, [value]);

  const exec = (command: string, val?: string) => {
    document.execCommand(command, false, val);
    if (editorRef.current) onChange(editorRef.current.innerHTML);
  };

  const insertVariable = (token: string) => {
    document.execCommand('insertText', false, `{{${token}}}`);
    if (editorRef.current) onChange(editorRef.current.innerHTML);
  };

  return (
    <div className="border border-surface-200 rounded-lg overflow-hidden focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/20 transition-colors">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-surface-100 bg-surface-50">
        <button onClick={() => exec('bold')} className="p-1.5 hover:bg-surface-200 rounded" title="Bold"><Bold className="w-3.5 h-3.5" /></button>
        <button onClick={() => exec('italic')} className="p-1.5 hover:bg-surface-200 rounded" title="Italic"><Italic className="w-3.5 h-3.5" /></button>
        <button onClick={() => exec('insertUnorderedList')} className="p-1.5 hover:bg-surface-200 rounded" title="Bullet list"><ListIcon className="w-3.5 h-3.5" /></button>
        <button onClick={() => {
          const url = prompt('Link URL:');
          if (url) exec('createLink', url);
        }} className="p-1.5 hover:bg-surface-200 rounded" title="Link"><LinkIcon className="w-3.5 h-3.5" /></button>
        <div className="w-px h-4 bg-surface-300 mx-1" />
        <select
          onChange={(e) => { if (e.target.value) { insertVariable(e.target.value); e.target.value = ''; } }}
          className="text-xs bg-white border border-surface-200 rounded px-2 py-1"
          defaultValue=""
        >
          <option value="">Insert variable...</option>
          <option value="first_name">{'{{first_name}}'}</option>
          <option value="last_name">{'{{last_name}}'}</option>
          <option value="full_name">{'{{full_name}}'}</option>
          <option value="company">{'{{company}}'}</option>
          <option value="title">{'{{title}}'}</option>
          <option value="email">{'{{email}}'}</option>
        </select>
      </div>

      {/* Editor */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={(e) => onChange((e.target as HTMLDivElement).innerHTML)}
        className="px-3 py-3 min-h-[200px] text-sm focus:outline-none prose prose-sm max-w-none"
        style={{ wordBreak: 'break-word' }}
      />
    </div>
  );
}

// ─── Add Step Menu ───────────────────────────────────
function AddStepMenu({ onSelect, onClose }: { onSelect: (type: string) => void; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="absolute z-40 mt-2 left-1/2 -translate-x-1/2 w-64 bg-white rounded-lg shadow-lg border border-surface-200 py-1">
        {STEP_TYPE_OPTIONS.map((opt) => {
          const Icon = opt.icon;
          return (
            <button
              key={opt.value}
              onClick={() => onSelect(opt.value)}
              className="w-full px-3 py-2.5 text-left hover:bg-surface-50 flex items-center gap-3"
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${opt.color}`}>
                <Icon className="w-4 h-4" />
              </div>
              <span className="text-sm font-medium">{opt.label}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

// ─── Helpers ────────────────────────────────────────
function formatDelay(step: Step): string {
  const total = (step.delay_days || 0) + (step.delay_business_days || 0);
  if (step.delay_business_days > 0) return `Send in ${step.delay_business_days} business day${step.delay_business_days !== 1 ? 's' : ''}`;
  if (step.delay_days > 0) return `Send in ${step.delay_days} day${step.delay_days !== 1 ? 's' : ''}`;
  if (step.delay_hours > 0) return `Send in ${step.delay_hours} hour${step.delay_hours !== 1 ? 's' : ''}`;
  if (step.delay_minutes > 0) return `Send in ${step.delay_minutes} minute${step.delay_minutes !== 1 ? 's' : ''}`;
  return 'Send immediately';
}
