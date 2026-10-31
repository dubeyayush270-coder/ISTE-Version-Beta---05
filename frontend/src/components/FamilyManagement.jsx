import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarDays, Check, Edit3, Leaf, Plus, RotateCcw, Trash2, UsersRound } from 'lucide-react';
import { api, prettyDate, todayISO } from '../lib/api';
import FamilyProfileSwitcher from './FamilyProfileSwitcher.jsx';
import { DIETARY_OPTIONS, dietaryLabel, preferenceOf } from '../lib/familyDiet.js';
import { canEnableFamilyAttendance, sameAttendees } from '../lib/familyAttendanceMode.js';
import './FamilyManagement.css';

const MEALS = [
  { id: 'breakfast', label: 'Breakfast', emoji: '🥣' },
  { id: 'lunch', label: 'Lunch', emoji: '🍛' },
  { id: 'dinner', label: 'Dinner', emoji: '🍲' },
];

/** Family attendance is opt-in; existing saved servings are preserved until activated. */
export default function FamilyManagement({ onNotify, onDataChanged, initialDate }) {
  const [family, setFamily] = useState(null);
  const [date, setDate] = useState(initialDate || todayISO());
  const [attendance, setAttendance] = useState({});
  const [selected, setSelected] = useState({});
  const [name, setName] = useState('');
  const [dietaryPreference, setDietaryPreference] = useState('non-vegetarian');
  const [editing, setEditing] = useState(null);
  const [editName, setEditName] = useState('');
  const [editDietaryPreference, setEditDietaryPreference] = useState('non-vegetarian');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const latestRequest = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++latestRequest.current;
    setLoading(true);
    setError('');
    try {
      const [members, ...slots] = await Promise.all([
        api('/family/members'),
        ...MEALS.map(({ id }) => api(`/family/attendance/${date}/${id}`)),
      ]);
      if (requestId !== latestRequest.current) return;
      setFamily(members);
      setAttendance(Object.fromEntries(MEALS.map((meal, index) => [meal.id, slots[index]])));
      setSelected(Object.fromEntries(MEALS.map((meal, index) => [meal.id, slots[index].selected_member_ids])));
    } catch (err) {
      if (requestId === latestRequest.current) setError(err.message || 'Could not load your family.');
    } finally {
      if (requestId === latestRequest.current) setLoading(false);
    }
  }, [date]);

  useEffect(() => { load(); return () => { latestRequest.current += 1; }; }, [load]);

  const act = async (operation, success) => {
    setSaving(true);
    setError('');
    try {
      await operation();
      await load();
      // Family membership and attendance can change plan quantities and shortages.
      // Refresh the parent planner, dashboard and shopping data after a save.
      await onDataChanged?.();
      onNotify?.(success);
      return true;
    } catch (err) {
      const message = err.message || 'Unable to save changes.';
      setError(message);
      onNotify?.(message, true);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const toggleAttendanceMode = () => {
    if (!family || saving) return;
    const next = !family.attendance_enabled;
    if (next && !canEnableFamilyAttendance(family.members)) {
      setError('Enable at least one family member before using attendance-based servings.');
      return;
    }
    const hasUnsaved = MEALS.some(({ id }) =>
      attendance[id] && !sameAttendees(selected[id], attendance[id].selected_member_ids)
    );
    if (hasUnsaved) {
      setError('Save or reset your unsaved meal attendance changes before switching serving mode.');
      return;
    }
    const message = next
      ? 'Use family attendance to calculate upcoming planned meals, ingredient amounts and shopping shortages? Completed meals and your saved household size will not change.'
      : 'Return to the previously saved meal servings? Attendance selections will stay saved but will no longer affect upcoming meals or shopping shortages.';
    if (!window.confirm(message)) return;
    void act(
      () => api('/family/config', {
        method: 'PUT',
        body: JSON.stringify({ attendance_enabled: next }),
      }),
      next ? 'Attendance-based servings enabled' : 'Saved meal servings restored',
    );
  };

  const addMember = async event => {
    event.preventDefault();
    const clean = name.trim();
    if (!clean) { setError('Enter a member name.'); return; }
    const ok = await act(
      () => api('/family/members', { method: 'POST', body: JSON.stringify({ name: clean, dietary_preference: dietaryPreference }) }),
      `${clean} added to your family`,
    );
    if (ok) { setName(''); setDietaryPreference('non-vegetarian'); }
  };

  const updateMember = async event => {
    event.preventDefault();
    const clean = editName.trim();
    if (!clean) { setError('Member name cannot be blank.'); return; }
    const ok = await act(
      () => api(`/family/members/${editing}`, { method: 'PATCH', body: JSON.stringify({ name: clean, dietary_preference: editDietaryPreference }) }),
      'Member updated',
    );
    if (ok) setEditing(null);
  };

  const removeMember = member => {
    if (!window.confirm(`Remove ${member.name} from the family? Saved attendance selections for this member will also be removed.`)) return;
    void act(
      () => api(`/family/members/${member.id}?confirmed=true`, { method: 'DELETE' }),
      `${member.name} removed`,
    );
  };

  const toggleMember = member => void act(
    () => api(`/family/members/${member.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !member.enabled }) }),
    `${member.name} ${member.enabled ? 'disabled' : 'enabled'}`,
  );

  const changeSelection = (meal, memberId, checked) => {
    setSelected(prev => ({
      ...prev,
      [meal]: checked
        ? [...(prev[meal] || []), memberId]
        : (prev[meal] || []).filter(id => id !== memberId),
    }));
  };

  const saveAttendance = meal => void act(
    () => api(`/family/attendance/${date}/${meal}`, {
      method: 'PUT',
      body: JSON.stringify({ member_ids: selected[meal] || [] }),
    }),
    `${meal[0].toUpperCase()}${meal.slice(1)} attendance saved`,
  );

  const resetAttendance = meal => void act(
    () => api(`/family/attendance/${date}/${meal}`, { method: 'DELETE' }),
    'Default attendance restored',
  );

  return (
    <section className="ks-family" aria-label="Family management">
      <div className="ks-family-intro">
        <div className="ks-family-symbol"><UsersRound size={24} aria-hidden="true" /></div>
        <div>
          <h3>Everyone at the table</h3>
          <p>Add family members and choose who will eat each meal.</p>
        </div>
      </div>

      {error && <div className="ks-family-error" role="alert">{error} <button type="button" disabled={saving} onClick={load}>Retry</button></div>}
      {loading ? <div className="ks-family-loading" role="status">Loading your household…</div> : family && <>
        <div className="ks-family-summary">
          <span><strong>{family.members.length}</strong> named members</span>
          <span><strong>{family.members.filter(m => m.enabled).length}</strong> enabled</span>
          <span><strong>{family.legacy_household_size ?? '—'}</strong> default servings</span>
        </div>
        <FamilyProfileSwitcher
          members={family.members}
          saving={saving}
          onPreferenceChange={(member, preference) => act(
            () => api(`/family/members/${member.id}`, {
              method: 'PATCH',
              body: JSON.stringify({ dietary_preference: preference }),
            }),
            `${member.name}'s food preference updated`,
          )}
        />
        <section className="ks-family-serving-panel" aria-labelledby="ks-family-serving-title">
          <div className="ks-family-serving-top">
            <div>
              <h4 id="ks-family-serving-title">Attendance-based servings</h4>
              <p>Choose whether named family attendance controls planned meal quantities.</p>
            </div>
            <span className={`ks-family-serving-status ${family.attendance_enabled ? 'is-on' : ''}`}>
              {family.attendance_enabled ? 'ON' : 'OFF'}
            </span>
          </div>
          <p className="ks-family-serving-detail" role="status">
            {family.attendance_enabled
              ? 'ON: Planned meal servings, ingredient amounts and shopping shortages use actual attendance.'
              : 'OFF: The meal planner and shopping list use each meal’s previously saved serving count.'}
          </p>
          <button
            className="ks-family-button-primary ks-family-serving-toggle"
            type="button"
            onClick={toggleAttendanceMode}
            disabled={saving || (!family.attendance_enabled && !canEnableFamilyAttendance(family.members))}
            aria-pressed={Boolean(family.attendance_enabled)}
          >
            {saving ? 'Saving…' : family.attendance_enabled ? 'Use saved meal servings' : 'Use family attendance'}
          </button>
          {!family.attendance_enabled && !canEnableFamilyAttendance(family.members) &&
            <p className="ks-family-warning">Enable at least one family member to turn this on.</p>}
          <p className="ks-family-serving-footnote">
            Your household size stays {family.legacy_household_size ?? 'unchanged'}.
            Completed meals keep their original cooked servings. Zero attendees means no new ingredients are required for that meal.
          </p>
        </section>

        <div className="ks-family-subhead"><h4>Household members</h4><span>{family.members.length}/30</span></div>
        {family.members.length === 0 && <p className="ks-family-empty">No named members yet. Add the people in your household below. Your current meal plans still use the original household size.</p>}
        <div className="ks-family-members">
          {family.members.map(member => (
            <article className={`ks-family-member ${member.enabled ? '' : 'is-disabled'}`} key={member.id}>
              <div className="ks-family-avatar" aria-hidden="true">{member.name.slice(0, 1).toUpperCase()}</div>
              <div className="ks-family-member-content">
                {editing === member.id ? <form className="ks-family-edit" onSubmit={updateMember}>
                  <input aria-label="Edit member name" autoFocus maxLength={80} required value={editName} onChange={e => setEditName(e.target.value)} />
                  <label className="ks-family-diet-label" htmlFor={`ks-member-diet-${member.id}`}>Food preference</label>
                  <select id={`ks-member-diet-${member.id}`} className="ks-family-diet-select" value={editDietaryPreference} onChange={e => setEditDietaryPreference(e.target.value)} disabled={saving}>
                    {DIETARY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <div className="ks-family-actions"><button className="ks-family-button-primary" type="submit" disabled={saving}>Save</button><button type="button" onClick={() => setEditing(null)} disabled={saving}>Cancel</button></div>
                </form> : <>
                  <strong>{member.name}</strong>
                  <small>{dietaryLabel(preferenceOf(member))} · {member.enabled ? 'Enabled' : 'Disabled'}</small>
                </>}
              </div>
              {editing !== member.id && <div className="ks-family-member-buttons">
                <button type="button" disabled={saving} aria-label={`Edit ${member.name}`} title="Edit" onClick={() => { setEditing(member.id); setEditName(member.name); setEditDietaryPreference(preferenceOf(member)); }}><Edit3 size={17} /></button>
                <button type="button" disabled={saving} aria-label={`${member.enabled ? 'Disable' : 'Enable'} ${member.name}`} title={member.enabled ? 'Disable member' : 'Enable member'} onClick={() => toggleMember(member)}>{member.enabled ? <Check size={18} /> : <Plus size={18} />}</button>
                <button className="ks-family-delete" type="button" disabled={saving} aria-label={`Remove ${member.name}`} title="Remove" onClick={() => removeMember(member)}><Trash2 size={17} /></button>
              </div>}
            </article>
          ))}
        </div>
        <form className="ks-family-add" onSubmit={addMember}>
          <label htmlFor="ks-family-new-name">Add a family member</label>
          <div className="ks-family-new-row"><input id="ks-family-new-name" value={name} onChange={e => setName(e.target.value)} maxLength={80} placeholder="e.g. Aditi" required /><button type="submit" disabled={saving || family.members.length >= 30}><Plus size={17} /> Add</button></div>
          <label className="ks-family-diet-label" htmlFor="ks-new-member-diet"><Leaf size={15} /> Food preference</label>
          <select id="ks-new-member-diet" className="ks-family-diet-select" value={dietaryPreference} onChange={e => setDietaryPreference(e.target.value)} disabled={saving}>
            {DIETARY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <p className="ks-family-diet-note">Preferences are informational and do not guarantee allergy or medical safety.</p>
        </form>

        <div className="ks-family-attendance-heading"><div><h4>Who's eating?</h4><p>Choose a date and meal. Unchanged meals include every enabled member.</p></div><CalendarDays size={22} aria-hidden="true" /></div>
        <label className="ks-family-date-label" htmlFor="ks-family-day">Meal date</label>
        <input className="ks-family-date" type="date" id="ks-family-day" value={date} onChange={e => setDate(e.target.value)} />
        <p className="ks-family-date-caption">{prettyDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}</p>

        {MEALS.map(meal => {
          const slot = attendance[meal.id];
          if (!slot) return null;
          const enabled = family.members.filter(m => m.enabled);
          const count = (selected[meal.id] || []).length;
          const changed = !sameAttendees(selected[meal.id], slot.selected_member_ids);
          return <section className="ks-family-meal" key={meal.id} aria-label={`${meal.label} attendance`}>
            <div className="ks-family-meal-head"><div><span aria-hidden="true">{meal.emoji}</span> <strong>{meal.label}</strong></div><span className="ks-family-count">{count} selected</span></div>
            <p className="ks-family-mode">
              {slot.has_override ? 'Custom attendance' : 'Default: everyone enabled'} · {family.attendance_enabled
                ? `${count} ${count === 1 ? 'person' : 'people'} for upcoming planned meals`
                : 'Tracking only — planner uses saved meal servings'}
            </p>
            {enabled.length === 0 ? <p className="ks-family-empty">Enable a member to select attendees.</p> : <div className="ks-family-attendees">
              {enabled.map(member => <label key={member.id} className="ks-family-attendee"><input type="checkbox" disabled={saving} checked={(selected[meal.id] || []).includes(member.id)} onChange={e => changeSelection(meal.id, member.id, e.target.checked)} /><span>{member.name}</span></label>)}
            </div>}
            <div className="ks-family-actions">
              <button className="ks-family-button-primary" type="button" disabled={saving || !changed} onClick={() => saveAttendance(meal.id)}>Save attendance</button>
              <button type="button" disabled={saving || !slot.has_override} onClick={() => resetAttendance(meal.id)}><RotateCcw size={15} /> Reset default</button>
            </div>
            {count === 0 && <p className="ks-family-warning">
              {family.attendance_enabled
                ? 'No one is attending: this meal will require no new ingredients and cannot be marked cooked.'
                : 'No one selected. This is recorded for tracking but does not affect planned meal quantities while the mode is off.'}
            </p>}
          </section>;
        })}
      </>}
    </section>
  );
}
