import { useState } from 'react';
import { t } from '../i18n';
import { useApp } from '../store';
import { Card, Empty, Prov } from './ui';
import Icon from './icons';

/**
 * The dedicated provenance inspector: everything that reached the most recent
 * grounded answer. This view did not exist before - provenance used to be buried
 * inside a collapsed toggle in a chat bubble.
 */
export default function EvidencePanel() {
  const { lang, result } = useApp();
  const [open, setOpen] = useState(true);

  if (!result) {
    return (
      <Card
        title={t(lang, 'evidence')}
        sub="Ask a question first, then every verified fact that reached the answer appears here."
      >
        <Empty>No answer yet in this session.</Empty>
      </Card>
    );
  }

  const evidence = result.evidence || [];
  const warning = result.warning || {};
  const risk = result.risk || {};

  return (
    <>
      <Card
        title={t(lang, 'evidence')}
        sub="Every number that reached the answer, with its source, timestamps and provenance label."
        actions={(
          <button
            className="btn ghost sm"
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            <Icon name={open ? 'eye' : 'list'} size={14} />
            {open ? 'Collapse' : 'Expand'}
          </button>
        )}
      >
        <div className="stat-grid">
          <div className="stat">
            <div className="k">FACTS CITED</div>
            <div className="v">{evidence.length}</div>
          </div>
          <div className="stat">
            <div className="k">WEATHERGPT RISK</div>
            <div className="v">{risk.level || '-'}</div>
            <div className="hint">{risk.source || 'WEATHERGPT'} - never an IMD rating</div>
          </div>
          <div className="stat">
            <div className="k">OFFICIAL WARNING</div>
            <div className="v">{warning.active ? warning.severity : 'none'}</div>
            <div className="hint">{warning.source || 'IMD'}</div>
          </div>
        </div>

        {open && (
          <div className="evbox" style={{ marginTop: 14 }}>
            {evidence.map((e, i) => (
              <div className="evrow" key={i}>
                <span className="k">{e.source} - {e.type}</span>
                <span>
                  {e.issued_at || '-'}
                  {e.valid_until ? ` to ${e.valid_until}` : ''}{' '}
                  <Prov value={e.provenance} />
                </span>
              </div>
            ))}
            {evidence.length === 0 ? (
              <p className="mono">The answer cited no external facts.</p>
            ) : null}
            {risk.reason ? (
              <div className="evrow">
                <span className="k">Risk basis</span>
                <span>{risk.reason}</span>
              </div>
            ) : null}
            <div className="evrow">
              <span className="k">AI role</span>
              <span>Interpretation only - official severity is never modified</span>
            </div>
          </div>
        )}
      </Card>

      <Card
        title="Grounded answer"
        sub="Reproduced verbatim. The conversational layer never rewrites a number."
      >
        <div className="msg bot" style={{ maxWidth: '100%' }}>{result.answer}</div>
      </Card>
    </>
  );
}