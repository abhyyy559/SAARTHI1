// P2P store-and-forward hop diagram: icon-first, minimal text.
// The surrounding panel (Emergency) carries the mandatory SIMULATED stamp,
// so this component is purely the trace + outbox + property chips.
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
      <p className="p2p-story mono" aria-live="polite">
        {steps.length > 0 ? hopStory : t(lang, 'sbP2pRelayIdle')}
      </p>

      {steps.length > 0 && (
        <div className="stepper" aria-hidden="true">
          {steps.map((step, i) => (
            <div className={`step${i === steps.length - 1 ? ' is-now' : ' is-done'}`} key={`${step.node}-${i}`}>
              <div>
                <div className="step-t"><Icon name={NODE_ICON[step.node] || 'radio'} size={16} /> {t(lang, NODE_LABEL[step.node] || step.node)}</div>
                <div className="step-s mono">{step.state}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {pending.length > 0 ? (
        <div className="p2p-log" aria-label={t(lang, 'p2pOutbox')}>
          {pending.map((m, i) => (
            <div className="log-line" key={m.message_id || i}>
              <Icon name="layers" size={12} />{' '}
              {m.message_id || m.id || `#${i + 1}`} · {m.message_type || m.type || 'message'}{' · '}
              {m.synced ? t(lang, 'emgChipSynced') : t(lang, 'emgChipLocal')}
            </div>
          ))}
        </div>
      ) : null}

      {chips.length > 0 && (
        <div className="chip-row" style={{ marginTop: 10 }}>
          {chips.map((c, i) => (
            <span className="chip" key={i}>
              <Icon name={c.icon} size={12} />
              <span>{t(lang, c.label)}{c.val ? ` ${c.val}` : ''}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
