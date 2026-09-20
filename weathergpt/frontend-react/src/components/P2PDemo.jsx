// P2P store-and-forward hop diagram: icon-first, minimal text.
// S3.2.1: visible A→B→C hop story + store-and-forward outbox + mandatory SIMULATED badge.
import { t } from '../i18n';
import Icon from './icons';

const NODE_ICON = {
  you: 'user',
  'relay-a': 'radio',
  'relay-b': 'radio',
  'relay-c': 'radio',
  out: 'check',
};

const NODE_LABEL = {
  you: 'p2pYou',
  'relay-a': 'p2pRelayA',
  'relay-b': 'p2pRelayB',
  'relay-c': 'p2pRelayC',
  out: 'p2pOut',
};

export default function P2PDemo({ trace, properties, lang, outbox }) {
  const steps = Array.isArray(trace) ? trace : [];
  const props = properties || {};
  const pending = Array.isArray(outbox) ? outbox : (Array.isArray(props.outbox) ? props.outbox : []);
  const chips = [
    props.sealed && { icon: 'lock', label: 'p2pSealed' },
    props.tamper_proof && { icon: 'shield', label: 'p2pTamper' },
    props.queued && { icon: 'layers', label: 'p2pQueued' },
    typeof props.hop_limit === 'number' && {
      icon: 'route',
      label: 'p2pHops',
      val: `${props.hops_used || 0}/${props.hop_limit}`,
    },
  ].filter(Boolean);

  // Visible A→B→C hop story: one line the jury can read without decoding icons.
  const hopStory = steps.length > 0
    ? steps.map((s) => t(lang, NODE_LABEL[s.node] || s.node)).join(' → ')
    : `${t(lang, 'p2pYou')} → ${t(lang, 'p2pRelayA')} → ${t(lang, 'p2pRelayB')} → ${t(lang, 'p2pRelayC')} → ${t(lang, 'p2pOut')}`;

  return (
    <div className="p2p-demo" role="region" aria-label={t(lang, 'p2pTitle')}>
      <div className="p2p-badge" data-testid="p2p-simulated" title={t(lang, 'p2pSimTitle')}>
        <Icon name="info" size={12} />
        <span>{t(lang, 'p2pSimulated')}</span>
      </div>

      <p className="p2p-story mono" aria-live="polite">{hopStory}</p>

      {steps.length > 0 ? (
      <div className="p2p-chain">
        {steps.map((step, i) => {
          const isLast = i === steps.length - 1;
          return (
            <div className="p2p-step" key={`${step.node}-${i}`}>
              <div className="p2p-node">
                <span className="p2p-icon">
                  <Icon name={NODE_ICON[step.node] || 'radio'} size={22} />
                </span>
                <span className="p2p-name">{t(lang, NODE_LABEL[step.node] || step.node)}</span>
                <span className="p2p-state">{step.state}</span>
              </div>
              {!isLast && (
                <span className="p2p-arrow" aria-hidden="true">
                  <Icon name="chevron" size={14} />
                </span>
              )}
            </div>
          );
        })}
      </div>
      ) : (
        <p className="sub">{t(lang, 'p2pTitle')} — {t(lang, 'p2pSimulated')}</p>
      )}

      {pending.length > 0 ? (
        <div className="p2p-outbox" aria-label={t(lang, 'p2pOutbox')}>
          {pending.map((m, i) => (
            <div className="p2p-outbox-row" key={m.message_id || i}>
              <Icon name="layers" size={12} />
              <span className="mono">{m.message_id || m.id || `#${i + 1}`} · {m.message_type || m.type || 'message'}</span>
              <span className="chip">{m.synced ? t(lang, 'emgChipSynced') : t(lang, 'emgChipLocal')}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="p2p-chips">
        {chips.map((c, i) => (
          <span className="chip" key={i}>
            <Icon name={c.icon} size={12} />
            <span>{t(lang, c.label)}{c.val ? ` ${c.val}` : ''}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
