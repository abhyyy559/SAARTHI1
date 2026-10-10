// ProfileDetails — Settings "About you". The chat sends these with every
// question (store profile → HomeChat/VoiceMode body.profile), so answers and
// advice can name the user's crop, boat or vehicle and fit their work hours
// and health. Tap-first (chips) for low-literacy users; one optional text box.
//
// Chip values are stored in plain English (what the backend and the language
// model read); only the labels are translated.
import { useState } from 'react';
import { t } from '../i18n';
import { useApp } from '../store';

// field → options (stored value, label key). `multi` fields store "a, b".
const FIELDS = {
  crop: { label: 'pfCrop', text: true, options: [
    ['Paddy', 'pfPaddy'], ['Cotton', 'pfCotton'], ['Chilli', 'pfChilli'], ['Maize', 'pfMaize'],
    ['Groundnut', 'pfGroundnut'], ['Vegetables', 'pfVegetables'],
  ] },
  crop_stage: { label: 'pfStage', options: [
    ['Sowing', 'pfSowing'], ['Growing', 'pfGrowing'], ['Flowering', 'pfFlowering'], ['Harvest', 'pfHarvest'],
  ] },
  land: { label: 'pfLand', options: [['Irrigated', 'pfIrrigated'], ['Rain-fed', 'pfRainfed']] },
  boat: { label: 'pfBoat', options: [
    ['Country boat (no motor)', 'pfCountryBoat'], ['Small motor boat', 'pfMotorBoat'],
    ['Mechanised trawler', 'pfTrawler'],
  ] },
  trip: { label: 'pfTrip', options: [['Day trip', 'pfDayTrip'], ['Overnight', 'pfOvernight'], ['Many days at sea', 'pfManyDays']] },
  vehicle: { label: 'pfVehicle', options: [
    ['Two-wheeler', 'pfTwoWheeler'], ['Car or auto', 'pfCar'], ['Truck', 'pfTruck'], ['Bus', 'pfBus'],
  ] },
  route: { label: 'pfRoute', text: true, options: [] },
  aircraft: { label: 'pfAircraft', options: [['Drone', 'pfDrone'], ['Light aircraft', 'pfLight'], ['Commercial flight', 'pfCommercial']] },
  work_hours: { label: 'pfHours', multi: true, options: [
    ['Morning', 'pfMorning'], ['Afternoon', 'pfAfternoon'], ['Evening', 'pfEvening'], ['Night', 'pfNight'],
  ] },
  health: { label: 'pfHealth', multi: true, options: [
    ['Elderly person at home', 'pfElderly'], ['Small children', 'pfChildren'],
    ['Asthma or breathing trouble', 'pfAsthma'], ['Heart or BP condition', 'pfHeart'], ['Pregnant', 'pfPregnant'],
  ] },
};

// Which details matter for which role. Everyone gets hours + health.
const ROLE_FIELDS = {
  farmer: ['crop', 'crop_stage', 'land'],
  fisherman: ['boat', 'trip'],
  driver: ['vehicle', 'route'],
  commuter: ['vehicle', 'route'],
  employee: ['vehicle'],
  student: [],
  'outdoor-worker': [],
  aviation: ['aircraft'],
};

function splitMulti(v) {
  return (v || '').split(',').map((x) => x.trim()).filter(Boolean);
}

function ChipField({ lang, name, value, onChange }) {
  const f = FIELDS[name];
  const picked = f.multi ? splitMulti(value) : [value];
  const toggle = (opt) => {
    if (f.multi) {
      const next = picked.includes(opt) ? picked.filter((x) => x !== opt) : [...picked, opt];
      onChange(next.join(', '));
    } else {
      onChange(value === opt ? '' : opt);
    }
  };
  return (
    <div className="field">
      <label id={`pf-${name}`}>{t(lang, f.label)}</label>
      {f.options.length > 0 && (
        <div className="chip-grid" role="group" aria-labelledby={`pf-${name}`}>
          {f.options.map(([opt, key]) => {
            const on = picked.includes(opt);
            return (
              <button key={opt} type="button" className={`role-chip${on ? ' is-active' : ''}`}
                aria-pressed={on} onClick={() => toggle(opt)}>
                <span>{t(lang, key)}</span>
              </button>
            );
          })}
        </div>
      )}
      {f.text && (
        <TextField key={value} lang={lang} label={f.label} value={value} onChange={onChange}
          placeholder={t(lang, name === 'route' ? 'pfRoutePh' : 'pfCropPh')} />
      )}
    </div>
  );
}

// Saves on blur/Enter, not per keystroke, so localStorage is not hammered.
function TextField({ lang, label, value, onChange, placeholder, maxLength = 80 }) {
  // Callers key this by the saved value, so a change from elsewhere remounts it.
  const [draft, setDraft] = useState(value || '');
  const commit = () => { if ((draft || '').trim() !== (value || '')) onChange(draft.trim()); };
  return (
    <input
      className="input"
      type="text"
      value={draft}
      maxLength={maxLength}
      placeholder={placeholder}
      aria-label={t(lang, label)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
    />
  );
}

export default function ProfileDetails() {
  const { lang, persona, profile, setProfile } = useApp();
  const fields = [...(ROLE_FIELDS[persona] || []), 'work_hours', 'health'];
  const set = (name) => (v) => setProfile({ [name]: v });
  return (
    <div className="form-grid" data-tour="profile-details">
      <p className="sub" style={{ margin: 0 }}>{t(lang, 'pfNote')}</p>
      {fields.map((name) => (
        <ChipField key={name} lang={lang} name={name} value={profile[name] || ''} onChange={set(name)} />
      ))}
      <div className="field">
        <label>{t(lang, 'pfNotes')}</label>
        <TextField key={profile.notes || ''} lang={lang} label="pfNotes" value={profile.notes || ''} onChange={set('notes')}
          placeholder={t(lang, 'pfNotesPh')} maxLength={200} />
      </div>
    </div>
  );
}
