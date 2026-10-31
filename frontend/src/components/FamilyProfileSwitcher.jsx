import { useEffect, useState } from 'react';
import { CheckCircle2, UserRound, UserRoundPen } from 'lucide-react';
import {
  readActiveFamilyProfileId,
  resolveActiveFamilyProfile,
  saveActiveFamilyProfileId,
} from '../lib/familyProfile.js';
import './FamilyProfileSwitcher.css';
import { DIETARY_OPTIONS, preferenceOf } from '../lib/familyDiet.js';

function deviceStorage() {
  try { return window.localStorage; } catch { return null; }
}

/** Convenience-only local profile selector. Never changes household permissions,
 *  attendance, meal plans, servings, or stock requirements.
 */
export default function FamilyProfileSwitcher({ members = [], saving = false, onPreferenceChange }) {
  const [activeId, setActiveId] = useState(() => readActiveFamilyProfileId(deviceStorage()));
  const [storageWarning, setStorageWarning] = useState(false);
  const [preferenceSaving, setPreferenceSaving] = useState(false);
  const enabledMembers = members.filter(member => member.enabled === true);
  const activeMember = resolveActiveFamilyProfile(members, activeId);

  // Never let a disabled or deleted profile remain selected after a roster refresh.
  useEffect(() => {
    if (activeId !== null && !activeMember) {
      setActiveId(null);
      saveActiveFamilyProfileId(deviceStorage(), null);
    }
  }, [activeId, activeMember]);

  function chooseProfile(event) {
    const nextId = event.target.value === '' ? null : Number(event.target.value);
    if (nextId !== null && !resolveActiveFamilyProfile(members, nextId)) return;
    setActiveId(nextId);
    setStorageWarning(!saveActiveFamilyProfileId(deviceStorage(), nextId));
  }

  async function changeDietaryPreference(event) {
    if (!activeMember || saving || preferenceSaving || !onPreferenceChange) return;
    const preference = event.target.value;
    if (!DIETARY_OPTIONS.some(option => option.value === preference)) return;
    if (preference === preferenceOf(activeMember)) return;
    setPreferenceSaving(true);
    try {
      await onPreferenceChange(activeMember, preference);
    } finally {
      setPreferenceSaving(false);
    }
  }

  return (
    <section className="ks-profile" aria-labelledby="ks-profile-heading">
      <div className="ks-profile-heading">
        <div className="ks-profile-symbol" aria-hidden="true"><UserRoundPen size={21} /></div>
        <div>
          <h4 id="ks-profile-heading">Who am I?</h4>
          <p>Switch the family profile used on this device.</p>
        </div>
      </div>
      <div className="ks-profile-current" role="status" aria-live="polite">
        <span className="ks-profile-avatar" aria-hidden="true">
          {activeMember ? activeMember.name.slice(0, 1).toUpperCase() : <UserRound size={20} />}
        </span>
        <div className="ks-profile-current-text">
          <strong>{activeMember ? activeMember.name : 'No profile selected'}</strong>
          <small>{activeMember ? 'Current profile on this device' : 'Choose who is using KitchenSync'}</small>
        </div>
        {activeMember && <CheckCircle2 size={20} className="ks-profile-selected-icon" aria-label="Selected" />}
      </div>
      <label className="ks-profile-label" htmlFor="ks-profile-select">Switch profile</label>
      <select
        id="ks-profile-select"
        className="ks-profile-select"
        value={activeMember ? String(activeMember.id) : ''}
        onChange={chooseProfile}
        disabled={enabledMembers.length === 0}
      >
        <option value="">{enabledMembers.length ? 'Choose a family member' : 'No enabled members'}</option>
        {enabledMembers.map(member => <option value={member.id} key={member.id}>{member.name}</option>)}
      </select>
      {activeMember && <div className="ks-profile-diet">
        <label className="ks-profile-label" htmlFor="ks-profile-diet">My food preference</label>
        <select
          id="ks-profile-diet"
          className="ks-profile-select"
          value={preferenceOf(activeMember)}
          disabled={saving || preferenceSaving || !onPreferenceChange}
          onChange={changeDietaryPreference}
        >
          {DIETARY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <p className="ks-profile-hint">{preferenceSaving ? 'Saving preference…' : 'Updates the selected family member only.'}</p>
      </div>}
      {enabledMembers.length === 0 && (
        <p className="ks-profile-hint">Enable a household member below before selecting a profile.</p>
      )}
      {storageWarning && (
        <p className="ks-profile-warning" role="alert">Browser storage is unavailable; your selection may reset when this screen closes.</p>
      )}
      <p className="ks-profile-privacy">
        This is a device preference, not a login. Switching profiles does not change meal attendance, serving counts, or Pantry stock.
      </p>
    </section>
  );
}
