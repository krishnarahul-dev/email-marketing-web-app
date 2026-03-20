import React, { useEffect, useState, useCallback, useRef } from 'react';
import { templatesApi } from '../api/client';
import { Template, SpamCheckResult } from '../types';
import { Plus, FileText, Pencil, Trash2, X, ShieldCheck, AlertTriangle } from 'lucide-react';

// Lazy-load Unlayer editor
let EmailEditor: any = null;

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [spamResult, setSpamResult] = useState<SpamCheckResult | null>(null);
  const editorRef = useRef<any>(null);
  const [editorLoaded, setEditorLoaded] = useState(false);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await templatesApi.list({ limit: 100 });
      setTemplates(res.data.data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  // Load Unlayer dynamically
  useEffect(() => {
    if ((showCreate || editing) && !EmailEditor) {
      import('react-email-editor').then((mod) => {
        EmailEditor = mod.default;
        setEditorLoaded(true);
      }).catch(() => setEditorLoaded(true));
    }
  }, [showCreate, editing]);

  const handleSave = async () => {
    if (!editorRef.current?.editor) return;

    editorRef.current.editor.exportHtml(async (data: { html: string; design: any }) => {
      const { html, design } = data;
      try {
        if (editing) {
          await templatesApi.update(editing.id, { html_content: html, design_json: design });
        } else {
          const name = prompt('Template name:');
          if (!name) return;
          await templatesApi.create({ name, html_content: html, design_json: design });
        }
        setEditing(null);
        setShowCreate(false);
        fetchTemplates();
      } catch (err: any) { alert(err.response?.data?.error || 'Save failed'); }
    });
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this template?')) return;
    try {
      await templatesApi.delete(id);
      fetchTemplates();
    } catch (err) { console.error(err); }
  };

  const handleSpamCheck = async (id: string) => {
    try {
      const res = await templatesApi.spamCheck(id);
      setSpamResult(res.data.spamCheck);
    } catch (err) { console.error(err); }
  };

  const openEditor = (template?: Template) => {
    if (template) {
      setEditing(template);
    } else {
      setShowCreate(true);
    }
  };

  const closeEditor = () => {
    setEditing(null);
    setShowCreate(false);
  };

  const isEditorOpen = showCreate || editing;

  // Editor view
  if (isEditorOpen) {
    return (
      <div className="h-screen flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 bg-white border-b border-surface-200">
          <div className="flex items-center gap-3">
            <button onClick={closeEditor} className="btn-ghost p-2"><X className="w-4 h-4" /></button>
            <h2 className="font-semibold">{editing ? `Edit: ${editing.name}` : 'New Template'}</h2>
          </div>
          <button onClick={handleSave} className="btn-primary">Save Template</button>
        </div>
        <div className="flex-1">
          {EmailEditor ? (
            <EmailEditor
              ref={editorRef}
              minHeight="100%"
              onReady={() => {
                if (editing?.design_json && editorRef.current?.editor) {
                  const design = typeof editing.design_json === 'string' ? JSON.parse(editing.design_json) : editing.design_json;
                  editorRef.current.editor.loadDesign(design);
                }
              }}
              options={{
                features: { textEditor: { spellChecker: true } },
                appearance: { theme: 'modern_light' },
                tools: { form: { enabled: false } },
              }}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-surface-400">Loading editor...</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Templates</h1>
          <p className="text-surface-500 text-sm mt-0.5">Email templates with drag-and-drop editor</p>
        </div>
        <button className="btn-primary" onClick={() => openEditor()}><Plus className="w-4 h-4" />New Template</button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : templates.length === 0 ? (
        <div className="card p-12 text-center">
          <FileText className="w-10 h-10 text-surface-300 mx-auto mb-3" />
          <p className="text-surface-500">No templates yet. Create your first template.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((t) => (
            <div key={t.id} className="card p-5 flex flex-col">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold">{t.name}</h3>
                  <p className="text-xs text-surface-400 mt-0.5">{t.category} · Updated {new Date(t.updated_at).toLocaleDateString()}</p>
                </div>
                <span className="badge-gray">{t.subject ? 'Has subject' : 'No subject'}</span>
              </div>

              {t.html_content && (
                <div className="flex-1 mb-3 p-2 bg-surface-50 rounded-lg border border-surface-200 overflow-hidden max-h-32">
                  <div className="text-xs text-surface-400 truncate" dangerouslySetInnerHTML={{
                    __html: t.html_content.replace(/<[^>]+>/g, ' ').substring(0, 200)
                  }} />
                </div>
              )}

              <div className="flex gap-2 mt-auto pt-2">
                <button className="btn-secondary flex-1 text-xs py-2" onClick={() => openEditor(t)}>
                  <Pencil className="w-3 h-3" />Edit
                </button>
                <button className="btn-ghost p-2" onClick={() => handleSpamCheck(t.id)} title="Spam check">
                  <ShieldCheck className="w-4 h-4" />
                </button>
                <button className="btn-ghost p-2 text-red-500" onClick={() => handleDelete(t.id)} title="Delete">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Spam Check Modal */}
      {spamResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setSpamResult(null)}>
          <div className="card w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Spam Score</h3>
              <button onClick={() => setSpamResult(null)} className="p-1 rounded hover:bg-surface-100"><X className="w-4 h-4" /></button>
            </div>
            <div className="text-center mb-4">
              <div className={`text-4xl font-bold ${spamResult.pass ? 'text-emerald-600' : 'text-red-600'}`}>
                {spamResult.score} / {spamResult.maxScore}
              </div>
              <p className={`text-sm mt-1 ${spamResult.pass ? 'text-emerald-600' : 'text-red-600'}`}>
                {spamResult.pass ? 'Looks good!' : 'High spam risk'}
              </p>
            </div>
            {spamResult.issues.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-surface-500">Issues found:</p>
                {spamResult.issues.map((issue) => (
                  <div key={issue} className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 px-3 py-1.5 rounded">
                    <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                    {issue.replace(/_/g, ' ')}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
