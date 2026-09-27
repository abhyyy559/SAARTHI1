// Admin console — backstage controls for the authority team.
//
// The demo alert control panel is gone: the /api/demo/* endpoints no longer
// exist on the backend, so scenario launching, demo alert create/notify/reset
// and audience seeding have been removed rather than left to 404. What stays
// is the one genuinely useful backstage lever: the data-source mode switch
// (IMD only ↔ hybrid), which names which sources are carrying the answers.
// District-level alert-coverage telemetry (real delivery data, never staged)
// lives in CoverageDashboard below.
import { useApp, SOURCE_MODES, modeLabel, modeNote } from '../store';
import { t } from '../i18n';
import { Card } from './ui';

export default function AdminPanel() {
  const { lang, sourceMode, setBackendMode } = useApp();

  return (
    <>
      {/* The data-source mode switch — backstage, never in the citizen
          chrome. Rendered from SOURCE_MODES, so no hardcoded pair can drift
          from the documented two. */}
      <Card title={t(lang, 'modeTitle')} sub={t(lang, 'modeSub')} className="ops-panel">
        <div className="mode-switch" role="group" aria-label={t(lang, 'modeTitle')}>
          {SOURCE_MODES.map((m) => (
            <button
              key={m}
              type="button"
              className={`mode-opt${sourceMode === m ? ' is-active' : ''}`}
              aria-pressed={sourceMode === m}
              onClick={() => setBackendMode(m)}
            >{modeLabel(lang, m)}</button>
          ))}
        </div>
        <p className="sub" style={{ marginTop: 8 }}>{modeNote(lang, sourceMode)}</p>
      </Card>
    </>
  );
}
