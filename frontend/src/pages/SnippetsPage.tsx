import React, { useEffect, useState, useCallback } from 'react';
import { snippetsApi } from '../api/client';
import { Plus, Pencil, Trash2, Copy, Search, FileText, X, Save, Hash } from 'lucide-react';

interface Snippet {
  id: string;
  name: string;
  shortcut: string | null;
  content: string;
  content_html: string | null;
  category: string;
  use_count: number;
  created_at: string;
  updated_at: string;
}

const CATEGORIES = ['general', 'intro', 'follow_up', 'closing', 'objection', 'value_prop', 'social_proof'];

export default function SnippetsPage() {
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [editSnippet, setEditSnippet] = useState<Snippet | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await snippetsApi.list(categoryFilter || undefined);
      setSnippets(res.data.snippets || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [categoryFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = search
    ? snippets.filter((s) =>
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.shortcut?.toLowerCase().includes(search.toLowerCase()) ||
        s.content.toLowerCase().includes(search.toLowerCase())
      )
    : snippets;

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this snippet?')) return;
    try {
      await snippetsApi.delete(id);
      fetchData();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to delete');
    }
  };

  const handleCopyShortcut = (shortcut: string) => {
    navigator.clipboard.writeText(`{{snippet:${shortcut}}}`);
  };

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Snippets</h1>
          <p className="text-surface-500 text-sm mt-0.5">
            Reusable content blocks — use <code className="bg-surface-100 px-1 rounded text-xs">{'{{snippet:shortcut}}'}</code> in your emails
          </p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary">
          <Plus className="w-4 h-4" />New Snippet
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" />
          <input
            type="text"
            placeholder="Search snippets..."
            className="input pl-9 py-2 text-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="input py-2 px-3 text-sm w-44"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
          ))}
        </select>
      </div>

      {/* Snippets list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <FileText className="w-10 h-10 text-surface-300 mx-auto mb-3" />
          <p className="text-sm text-surface-500 mb-1">
            {snippets.length === 0 ? 'No snippets yet' : 'No snippets match your search'}
          </p>
          <p className="text-xs text-surface-400">
            Create snippets to reuse common email content like introductions, CTAs, and signatures
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((s) => (
            <div key={s.id} className="card p-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center flex-shrink-0">
                  <FileText className="w-4 h-4" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="font-semibold text-sm">{s.name}</h3>
                    {s.shortcut && (
                      <button
                        onClick={() => handleCopyShortcut(s.shortcut!)}
                        className="text-xs font-mono bg-surface-100 text-surface-600 px-2 py-0.5 rounded hover:bg-surface-200 transition-colors flex items-center gap-1"
                        title="Click to copy insertion code"
                      >
                        <Hash className="w-3 h-3" />{s.shortcut}
                      </button>
                    )}
                    <span className="text-xs text-surface-400 capitalize">{s.category.replace(/_/g, ' ')}</span>
                    <span className="text-xs text-surface-400">Used {s.use_count}×</span>
                  </div>
                  <p className="text-sm text-surface-600 line-clamp-2">{s.content}</p>
                </div>

                <div className="flex gap-1 flex-shrink-0">
                  <button onClick={() => setEditSnippet(s)} className="btn-ghost p-2" title="Edit">
                    <Pencil className="w-4 h-4" />
                  </button>
                  {s.shortcut && (
                    <button onClick={() => handleCopyShortcut(s.shortcut!)} className="btn-ghost p-2" title="Copy shortcut">
                      <Copy className="w-4 h-4" />
                    </button>
                  )}
                  <button onClick={() => handleDelete(s.id)} className="btn-ghost p-2 text-red-500" title="Delete">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit modal */}
      {(showCreate || editSnippet) && (
        <SnippetModal
          snippet={editSnippet}
          onClose={() => { setShowCreate(false); setEditSnippet(null); }}
          onSave={() => { setShowCreate(false); setEditSnippet(null); fetchData(); }}
        />
      )}
    </div>
  );
}

function SnippetModal({ snippet, onClose, onSave }: {
  snippet: Snippet | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const [name, setName] = useState(snippet?.name || '');
  const [shortcut, setShortcut] = useState(snippet?.shortcut || '');
  const [content, setContent] = useState(snippet?.content || '');
  const [category, setCategory] = useState(snippet?.category || 'general');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name || !content) { alert('Name and content are required'); return; }
    setSaving(true);
    try {
      if (snippet) {
        await snippetsApi.update(snippet.id, { name, shortcut: shortcut || null, content, category });
      } else {
        await snippetsApi.create({ name, shortcut: shortcut || null, content, category });
      }
      onSave();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to save snippet');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="card w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">{snippet ? 'Edit Snippet' : 'New Snippet'}</h3>
          <button onClick={onClose} className="btn-ghost p-1.5"><X className="w-4 h-4" /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="label">Name *</label>
            <input type="text" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Cold intro paragraph" autoFocus />
          </div>
          <div>
            <label className="label">Shortcut</label>
            <input
              type="text"
              className="input font-mono"
              value={shortcut}
              onChange={(e) => setShortcut(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
              placeholder="e.g. cold_intro"
            />
            <p className="text-xs text-surface-400 mt-1">
              {shortcut ? (
                <>Use as <code className="bg-surface-100 px-1 rounded">{'{{snippet:' + shortcut + '}}'}</code> in your emails</>
              ) : (
                'Letters, numbers, underscores, dashes only. Leave blank if not needed.'
              )}
            </p>
          </div>
          <div>
            <label className="label">Category</label>
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Content *</label>
            <textarea
              className="input"
              rows={6}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="The content that will be inserted when this snippet is used..."
            />
            <p className="text-xs text-surface-400 mt-1">
              You can use personalization tokens like {'{{first_name}}'}, {'{{company}}'} inside snippets
            </p>
          </div>
        </div>

        <div className="flex gap-2 justify-end mt-5 pt-4 border-t border-surface-100">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={handleSave} disabled={saving || !name || !content} className="btn-primary">
            <Save className="w-4 h-4" />{saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
