import { t } from '../i18n';
import { useApp } from '../store';
import Icon from './icons';

// The five mandatory §50 guarantees. Each one is enforced by tests/safety/test_safety.py
// and is attackable live from the button below.
const GUARANTEES = [
  ['No false red alerts',
    'Asking for a red alert when none is on record returns a denial, never an invention.'],
  ['Severity never escalated',
    'YELLOW in, YELLOW out. The model cannot recolour the official scale.'],
  ['Expired is not active',
    'A validity window in the past is reported as expired, never as current.'],
  ['Outage is not invention',
    'IMD or LLM down means "unavailable" and labelled cache - zero hallucinated numbers.'],
  ['No invented probabilities',
    'A 72% figure appears only if a source actually published it.'],
];

export default function SafetyPanel() {
  const { lang, ask } = useApp();
  return (
    <section className="card">
      <h2>{t(lang, 'safety')}</h2>
      <p className="sub">Enforced by tests/safety/test_safety.py - try the attack live.</p>
      <div className="guarantees">
        {GUARANTEES.map(([b, s]) => (
          <div className="g" key={b}>
            <b><Icon name="lock" size={15} />{b}</b>
            <span>{s}</span>
            <div className="ok"><Icon name="check" size={14} />enforced</div>
          </div>
        ))}
      </div>
      <div className="row">
        <button
          className="btn warn"
          type="button"
          onClick={() => ask('Is there a red alert in Hyderabad right now?')}
        >
          {t(lang, 'tryRed')}
        </button>
      </div>
    </section>
  );
}