import React, { useEffect, useState, useCallback, useRef } from 'react';
import { contactsApi } from '../api/client';
import { Contact, PaginatedResponse } from '../types';
import { Plus, Upload, Search, Trash2, Tag, ChevronLeft, ChevronRight, X } from 'lucide-react';

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [importResult, setImportResult] = useState<any>(null);

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await contactsApi.list({ page, limit: 25, search: search || undefined, status: statusFilter || undefined });
      setContacts(res.data.data);
      setTotal(res.data.total);
      setTotalPages(res.data.totalPages);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter]);

  useEffect(() => { fetchContacts(); }, [fetchContacts]);

  const handleImport = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    if (!formData.get('file')) return;
    try {
      const res = await contactsApi.import(formData);
      setImportResult(res.data);
      fetchContacts();
    } catch (err: any) {
      setImportResult({ error: err.response?.data?.error || 'Import failed' });
    }
  };

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    try {
      await contactsApi.create({
        email: form.get('email'),
        first_name: form.get('first_name'),
        last_name: form.get('last_name'),
        company: form.get('company'),
      });
      setShowCreate(false);
      fetchContacts();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to create contact');
    }
  };

  const handleBulkDelete = async () => {
    if (selected.size === 0 || !confirm(`Delete ${selected.size} contacts?`)) return;
    try {
      await contactsApi.bulkDelete(Array.from(selected));
      setSelected(new Set());
      fetchContacts();
    } catch (err) { console.error(err); }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === contacts.length) setSelected(new Set());
    else setSelected(new Set(contacts.map((c) => c.id)));
  };

  const statusBadge = (status: string) => {
    const map: Record<string, string> = { active: 'badge-green', unsubscribed: 'badge-yellow', bounced: 'badge-red', complained: 'badge-red', suppressed: 'badge-gray' };
    return <span className={map[status] || 'badge-gray'}>{status}</span>;
  };

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Contacts</h1>
          <p className="text-surface-500 text-sm mt-0.5">{total.toLocaleString()} total contacts</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => setShowImport(true)}><Upload className="w-4 h-4" />Import CSV</button>
          <button className="btn-primary" onClick={() => setShowCreate(true)}><Plus className="w-4 h-4" />Add Contact</button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[240px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" />
          <input className="input pl-9" placeholder="Search contacts..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>
        <select className="input w-auto" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="unsubscribed">Unsubscribed</option>
          <option value="bounced">Bounced</option>
        </select>
        {selected.size > 0 && (
          <button className="btn-danger text-xs" onClick={handleBulkDelete}><Trash2 className="w-3.5 h-3.5" />Delete {selected.size}</button>
        )}
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-surface-50 border-b border-surface-200">
              <tr>
                <th className="table-header w-10"><input type="checkbox" checked={selected.size === contacts.length && contacts.length > 0} onChange={toggleSelectAll} className="rounded" /></th>
                <th className="table-header">Email</th>
                <th className="table-header">Name</th>
                <th className="table-header">Company</th>
                <th className="table-header">Source</th>
                <th className="table-header">Status</th>
                <th className="table-header">Added</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {loading ? (
                <tr><td colSpan={7} className="text-center py-12 text-surface-400">Loading...</td></tr>
              ) : contacts.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-12 text-surface-400">No contacts found</td></tr>
              ) : contacts.map((c) => (
                <tr key={c.id} className="hover:bg-surface-50/50 transition-colors">
                  <td className="table-cell"><input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)} className="rounded" /></td>
                  <td className="table-cell font-medium text-surface-900">{c.email}</td>
                  <td className="table-cell">{[c.first_name, c.last_name].filter(Boolean).join(' ') || '—'}</td>
                  <td className="table-cell">{c.company || '—'}</td>
                  <td className="table-cell"><span className="badge-gray">{c.source}</span></td>
                  <td className="table-cell">{statusBadge(c.status)}</td>
                  <td className="table-cell text-surface-400">{new Date(c.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-surface-200">
            <span className="text-sm text-surface-500">Page {page} of {totalPages}</span>
            <div className="flex gap-1">
              <button className="btn-ghost p-2" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft className="w-4 h-4" /></button>
              <button className="btn-ghost p-2" disabled={page >= totalPages} onClick={() => setPage(page + 1)}><ChevronRight className="w-4 h-4" /></button>
            </div>
          </div>
        )}
      </div>

      {/* Import Modal */}
      {showImport && (
        <Modal title="Import Contacts" onClose={() => { setShowImport(false); setImportResult(null); }}>
          {importResult ? (
            <div className="space-y-3">
              {importResult.error ? (
                <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{importResult.error}</div>
              ) : (
                <div className="p-3 rounded-lg bg-emerald-50 text-emerald-700 text-sm">
                  Imported {importResult.imported} contacts, {importResult.duplicates} updated.
                </div>
              )}
              <button className="btn-secondary w-full" onClick={() => { setShowImport(false); setImportResult(null); }}>Done</button>
            </div>
          ) : (
            <form onSubmit={handleImport} className="space-y-4">
              <div>
                <label className="label">CSV File</label>
                <input ref={fileRef} type="file" name="file" accept=".csv" required className="input" />
                <p className="text-xs text-surface-400 mt-1">Columns: email (required), first_name, last_name, company, title, phone</p>
              </div>
              <div>
                <label className="label">Source tag</label>
                <input name="source" className="input" defaultValue="csv_import" />
              </div>
              <button type="submit" className="btn-primary w-full">Upload & Import</button>
            </form>
          )}
        </Modal>
      )}

      {/* Create Modal */}
      {showCreate && (
        <Modal title="Add Contact" onClose={() => setShowCreate(false)}>
          <form onSubmit={handleCreate} className="space-y-4">
            <div><label className="label">Email *</label><input name="email" type="email" className="input" required /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">First name</label><input name="first_name" className="input" /></div>
              <div><label className="label">Last name</label><input name="last_name" className="input" /></div>
            </div>
            <div><label className="label">Company</label><input name="company" className="input" /></div>
            <button type="submit" className="btn-primary w-full">Add Contact</button>
          </form>
        </Modal>
      )}
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
