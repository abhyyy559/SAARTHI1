import { t } from '../i18n';
import { useApp } from '../store';

// SOURCES -> VALIDATE -> RISK -> ANSWER. Lit from the last real chat response,
// so the pipeline on screen is always the path the data actually travelled.
const STAGES = ['SOURCES', 'VALIDATE', 'RISK', 'ANSWER'];

export default function Pipeline() {
  const { lang, pipe } = useApp();
  const on = (pipe && pipe.lit) || [];
  const detail = (pipe && pipe.detail) || {};
  return (
    <section className="card">
      <h2>{t(lang, 'pipeline')}</h2>
      <p className="sub">Each query lights the real path its data travelled.</p>
      <div className="pipe">
        {STAGES.map((s, i) => (
          <div className={`stage ${on.includes(s) ? 'on' : ''}`} key={s}>
            <div className="n">0{i + 1} | {s}</div>
            <div className="d">{detail[s] || '-'}</div>
          </div>
        ))}
      </div>
    </section>
  );
}