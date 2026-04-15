import React, { useEffect, useState, useCallback } from 'react';
import { sequencesApi, schedulesApi, mailboxesApi } from '../../../api/client';
import { Calendar, Save, Plus, Pencil, AlertCircle, Mail, Inbox } from 'lucide-react';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
type Day = typeof DAYS[number];

interface Schedule {
  id: string;
  name: string;
  timezone: string;
  is_default: boolean;
  monday_start: string | null; monday_end: string | null;
  tuesday_start: string | null; tuesday_end: string | null;
  wednesday_start: string | null; wednesday_end: string | null;
  thursday_start: string | null; thursday_end: string | null;
  friday_start: string | null; friday_end: string | null;
  saturday_start: string | null; saturday_end: string | null;
  sunday_start: string | null; sunday_end: string | null;
}

interface MailboxOption {
  id: string;
  from_email: string;
  from_name: string | null;
  status: string;
  is_default: boolean;
  daily_send_limit: number;
  daily_sent_count: number;
}

interface Sequence {
  id: string;
  name: string;
  schedule_id: string | null;
  preferred_mailbox_id?: string | null;
}

const TZ_OPTIONS = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin',
  'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo',
  'Australia/Sydney', 'UTC',
];

export default function SettingsTab({ sequence, onUpdate }: { sequence: Sequence; onUpdate: () => void }) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [selectedSchedule, setSelectedSchedule] = useState<Schedule | null>(null);
  const [mailboxes, setMailboxes] = useState<MailboxOption[]>([]);
  const [selectedMailboxId, setSelectedMailboxId] = useState<string>(sequence.preferred_mailbox_id || '__roundrobin__');
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [schRes, mbRes] = await Promise.all([
        schedulesApi.list(),
        mailboxesApi.list().catch(() => ({ data: { mailboxes: [] } })),
      ]);
      const schedList: Schedule[] = schRes.data.schedules;
      setSchedules(schedList);
      const current = schedList.find((s: Schedule) => s.id === sequence.schedule_id) ||
                     schedList.find((s: Schedule) => s.is_default) ||
                     schedList[0];
      setSelectedSchedule(current || null);

      const mbList: MailboxOption[] = (mbRes.data.mailboxes || [])
        .filter((m: MailboxOption) => m.status === 'verified');
      setMailboxes(mbList);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [sequence.schedule_id]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleScheduleChange = async (scheduleId: string) => {
    try {
      await sequencesApi.update(sequence.id, { schedule_id: scheduleId });
      const next = schedules.find((s) => s.id === scheduleId);
      if (next) setSelectedSchedule(next);
      onUpdate();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to change schedule');
    }
  };

  const handleMailboxChange = async (value: string) => {
    setSelectedMailboxId(value);
    const mailboxId = value === '__roundrobin__' ? null : value;
    try {
      await sequencesApi.update(sequence.id, { preferred_mailbox_id: mailboxId });
      onUpdate();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to update mailbox setting');
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
    <div className="max-w-3xl mx-auto px-6 lg:px-8 py-6 space-y-6">
      {/* ─── Sending Mailbox ─────────────────────────── */}
      <div className="bg-white border border-surface-200 rounded-xl p-5">
        <h3 className="font-semibold flex items-center gap-2 mb-1">
          <Inbox className="w-4 h-4 text-brand-500" />Sending Mailbox
        </h3>
        <p className="text-xs text-surface-500 mb-4">
          Choose which sender mailbox this sequence sends from. "Automatic round-robin" rotates across all verified mailboxes for best deliverability.
        </p>

        {mailboxes.length === 0 ? (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-3 py-2 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">No verified mailboxes</p>
              <p className="text-xs mt-0.5">
                Go to <strong>Email Sending</strong> in the sidebar to add AWS credentials and verify a sender email first.
              </p>
            </div>
          </div>
        ) : (
          <select
            className="input"
            value={selectedMailboxId}
            onChange={(e) => handleMailboxChange(e.target.value)}
          >
            <option value="__roundrobin__">
              Automatic round-robin ({mailboxes.length} mailbox{mailboxes.length !== 1 ? 'es' : ''})
            </option>
            {mailboxes.map((m) => (
              <option key={m.id} value={m.id}>
                {m.from_name ? `${m.from_name} <${m.from_email}>` : m.from_email}
                {m.is_default ? ' (default)' : ''}
                {` — ${m.daily_send_limit - m.daily_sent_count} remaining today`}
              </option>
            ))}
          </select>
        )}

        {selectedMailboxId !== '__roundrobin__' && (
          <p className="text-xs text-surface-400 mt-2">
            All emails in this sequence will send from this specific mailbox only. If the mailbox reaches its daily limit, sends will be queued until tomorrow.
          </p>
        )}
        {selectedMailboxId === '__roundrobin__' && mailboxes.length > 0 && (
          <p className="text-xs text-surface-400 mt-2">
            Sends will rotate across all {mailboxes.length} verified mailbox{mailboxes.length !== 1 ? 'es' : ''}, picking the one with the most remaining capacity. Best for deliverability.
          </p>
        )}
      </div>

      {/* ─── Schedule selector ───────────────────────── */}
      <div className="bg-white border border-surface-200 rounded-xl p-5">
        <h3 className="font-semibold flex items-center gap-2 mb-1">
          <Calendar className="w-4 h-4 text-brand-500" />Sending Schedule
        </h3>
        <p className="text-xs text-surface-500 mb-4">
          Emails will only send during the times defined below. Outside the window, sends are queued for the next available slot.
        </p>

        <label className="label">Schedule</label>
        <div className="flex gap-2">
          <select
            value={selectedSchedule?.id || ''}
            onChange={(e) => handleScheduleChange(e.target.value)}
            className="input flex-1"
          >
            {schedules.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}{s.is_default ? ' (default)' : ''}
              </option>
            ))}
          </select>
          <button onClick={() => setEditing(true)} className="btn-secondary text-sm" disabled={!selectedSchedule}>
            <Pencil className="w-4 h-4" />Edit schedule
          </button>
          <button onClick={() => setCreating(true)} className="btn-secondary text-sm">
            <Plus className="w-4 h-4" />Create new schedule
          </button>
        </div>

        {selectedSchedule && (
          <div className="mt-4 p-4 bg-surface-50 rounded-lg">
            <p className="text-xs text-surface-500 mb-2">Timezone: <span className="font-medium text-surface-700">{selectedSchedule.timezone}</span></p>
            <div className="space-y-1">
              {DAYS.map((day) => {
                const start = selectedSchedule[`${day}_start` as keyof Schedule] as string | null;
                const end = selectedSchedule[`${day}_end` as keyof Schedule] as string | null;
                return (
                  <div key={day} className="flex items-center justify-between text-sm">
                    <span className="font-medium capitalize text-surface-700 w-28">{day}:</span>
                    <span className="text-surface-500">
                      {start && end ? `${formatTime(start)} – ${formatTime(end)}` : 'Off'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Schedule editor modals */}
      {editing && selectedSchedule && (
        <ScheduleEditor
          schedule={selectedSchedule}
          onClose={() => setEditing(false)}
          onSave={() => { setEditing(false); fetchAll(); }}
        />
      )}
      {creating && (
        <ScheduleEditor
          schedule={null}
          onClose={() => setCreating(false)}
          onSave={() => { setCreating(false); fetchAll(); }}
        />
      )}
    </div>
  );
}

// ─── Schedule Editor Modal ───────────────────────────
function ScheduleEditor({
  schedule, onClose, onSave,
}: {
  schedule: Schedule | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const [name, setName] = useState(schedule?.name || 'New Schedule');
  const [timezone, setTimezone] = useState(schedule?.timezone || 'America/New_York');
  const [windows, setWindows] = useState<Record<Day, { enabled: boolean; start: string; end: string }>>(() => {
    const w = {} as Record<Day, { enabled: boolean; start: string; end: string }>;
    DAYS.forEach((day) => {
      const start = (schedule?.[`${day}_start` as keyof Schedule] as string | null) || '';
      const end = (schedule?.[`${day}_end` as keyof Schedule] as string | null) || '';
      w[day] = {
        enabled: !!(start && end),
        start: start ? start.substring(0, 5) : '09:00',
        end: end ? end.substring(0, 5) : '17:00',
      };
    });
    return w;
  });
  const [saving, setSaving] = useState(false);

  const updateDay = (day: Day, field: string, value: any) => {
    setWindows((prev) => ({ ...prev, [day]: { ...prev[day], [field]: value } }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: Record<string, any> = { name, timezone };
      DAYS.forEach((day) => {
        if (windows[day].enabled) {
          payload[`${day}_start`] = windows[day].start;
          payload[`${day}_end`] = windows[day].end;
        } else {
          payload[`${day}_start`] = null;
          payload[`${day}_end`] = null;
        }
      });

      if (schedule) {
        await schedulesApi.update(schedule.id, payload);
      } else {
        await schedulesApi.create(payload);
      }
      onSave();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to save schedule');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="card w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">{schedule ? 'Edit Schedule' : 'New Schedule'}</h3>
          <button onClick={onClose} className="btn-ghost p-1.5">×</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="label">Name</label>
            <input type="text" className="input" value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} />
          </div>

          <div>
            <label className="label">Timezone</label>
            <select className="input" value={timezone} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setTimezone(e.target.value)}>
              {TZ_OPTIONS.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </select>
          </div>

          <div className="border border-surface-200 rounded-lg overflow-hidden">
            {DAYS.map((day, i) => (
              <div
                key={day}
                className={`flex items-center gap-3 px-3 py-2.5 ${i > 0 ? 'border-t border-surface-100' : ''}`}
              >
                <label className="flex items-center gap-2 w-32 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={windows[day].enabled}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateDay(day, 'enabled', e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-sm font-medium capitalize">{day}</span>
                </label>
                {windows[day].enabled ? (
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      type="time"
                      className="input py-1 px-2 text-sm w-28"
                      value={windows[day].start}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateDay(day, 'start', e.target.value)}
                    />
                    <span className="text-sm text-surface-400">–</span>
                    <input
                      type="time"
                      className="input py-1 px-2 text-sm w-28"
                      value={windows[day].end}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateDay(day, 'end', e.target.value)}
                    />
                  </div>
                ) : (
                  <span className="text-sm text-surface-400">No sending</span>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-2 justify-end mt-5 pt-4 border-t border-surface-100">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary">
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : 'Save schedule'}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatTime(timeStr: string): string {
  const [h, m] = timeStr.split(':').map(Number);
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const period = h >= 12 ? 'PM' : 'AM';
  if (m === 0) return `${hour12} ${period}`;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}
