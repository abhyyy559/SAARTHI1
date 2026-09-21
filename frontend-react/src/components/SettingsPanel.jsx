// Settings — profile, place, language, alerts — plus the permissions control
// center: location, microphone, sound, notifications.
//
// Each permission shows its CURRENT status in plain words (allowed / blocked /
// not asked yet), offers an in-app allow action where the browser permits one,
// and otherwise shows step-by-step guidance for the user's platform — a denied
// permission can only be fixed in browser/OS settings, never by tapping the
// same dead button again.
//
// Crew B coordination: when the chat mic is denied, the chat UI calls
// setView('settings') — this panel renders on the existing 'settings' view
// (views.jsx SettingsView). It can also be deep-focused: dispatching
// window.dispatchEvent(new CustomEvent('wgpt:perm', { detail: { perm:
// 'microphone'|'location'|'notifications'|'sound' } })) opens that permission's
// guidance and scrolls it into view.
import { useEffect, useRef, useState } from 'react';
import { t, DISTRICTS } from '../i18n';
import { useApp } from '../store';
import { pushReasonKey } from '../notify';
import {
  detectPlatform,
  guideKeys,
  locPermInfo,
  micPermInfo,
  ntfPermInfo,
  queryMicPermission,
  requestMicPermission,
  readProfileName,
  writeProfileName,
  readSoundPref,
  writeSoundPref,
} from '../permGuide';
import Icon from './icons';
import { Card } from './ui';

function Row({ icon, title, children }) {
  return (
    <Card>
      <div className="set-row-head">
        <span className="tile-icon" aria-hidden="true"><Icon name={icon} size={22} /></span>
        <b>{title}</b>
      </div>
      <div className="set-row-body">{children}</div>
    </Card>
  );
}

// Status pill: icon + word, never colour alone (Harbour Signal rule).
const STATE_META = {
  granted: { icon: 'check', key: 'permGranted' },
  denied: { icon: 'close', key: 'permDenied' },
  prompt: { icon: 'help', key: 'permPrompt' },
  unknown: { icon: 'help', key: 'permUnknown' },
  unavailable: { icon: 'info', key: 'permUnavailable' },
  on: { icon: 'check', key: 'permOn' },
  off: { icon: 'close', key: 'permOff' },
  working: { icon: 'refresh', key: 'permWorking' },
};

function StatusPill({ lang, state }) {
  const meta = STATE_META[state] || STATE_META.unknown;
  return (
    <span
      role="status"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        border: '2px solid var(--ink)', borderRadius: 999,
        padding: '2px 10px', fontSize: 13, fontWeight: 700,
        background: 'var(--card)', whiteSpace: 'nowrap',
      }}
    >
      <Icon name={meta.icon} size={14} aria-hidden="true" />
      <span>{t(lang, meta.key)}</span>
    </span>
  );
}

function PermRow({
  lang, icon, titleKey, descKey, state, busy, onAction, actionKey,
  guidePerm, platform, open, onToggle, note, control,
}) {
  const steps = guideKeys(guidePerm, platform);
  return (
    <div id={guidePerm ? `perm-${guidePerm}` : undefined} style={{ padding: '10px 0', borderTop: '1px solid var(--ink-faint, #e4dcc9)' }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <span className="row" style={{ gap: 10, flex: '1 1 auto', minWidth: 0 }}>
          <span className="tile-icon" aria-hidden="true"><Icon name={icon} size={20} /></span>
          <span style={{ minWidth: 0 }}>
            <b>{t(lang, titleKey)}</b>
            <span className="sub" style={{ display: 'block' }}>{t(lang, descKey)}</span>
          </span>
        </span>
        <StatusPill lang={lang} state={state} />
      </div>
      {control || (
        <div className="row" style={{ marginTop: 8 }}>
          {onAction && (
            <button type="button" className="btn sm" disabled={busy} onClick={onAction}>
              {busy ? t(lang, 'permWorking') : t(lang, actionKey)}
            </button>
          )}
          {steps.length > 0 && (
            <button type="button" className="btn btn-ghost sm" onClick={onToggle} aria-expanded={open}>
              {t(lang, open ? 'permHide' : 'permHow')}
            </button>
          )}
        </div>
      )}
      {open && steps.length > 0 && (
        <ol className="sub" style={{ margin: '8px 0 0', paddingLeft: 22 }}>
          {steps.map((k) => <li key={k} style={{ marginBottom: 4 }}>{t(lang, k)}</li>)}
        </ol>
      )}
      {note && <p className="sub" style={{ marginTop: 6, marginBottom: 0 }}>{note}</p>}
    </div>
  );
}

export default function SettingsPanel() {
  const {
    lang, setLang, setView, persona, setPersona, loc, setDistrict, requestLocation,
    locStatus, notifyOn, toggleNotify, pushMode, pushReason, notifyPerm, enableNotify,
  } = useApp();

  const [platform] = useState(() => detectPlatform());

  // --- editable profile: name -------------------------------------------
  const [name, setName] = useState(() => readProfileName());
  const saveName = () => {
    const clean = writeProfileName(name);
    setName(clean);
    // Other crews read localStorage 'wgpt.profile' ({ name }) or listen here.
    try { window.dispatchEvent(new CustomEvent('wgpt:profile', { detail: { name: clean } })); } catch { /* ignore */ }
  };

  // --- in-app sound toggle -------------------------------------------------
  const [soundOn, setSoundOn] = useState(() => readSoundPref());
  const flipSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    writeSoundPref(next);
    if (!next) {
      // Immediate effect for the browser-voice path; the server TTS stream
      // honours the same 'wgpt.sound' key (see coordinator flag in report).
      try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    }
  };

  // --- microphone: read-only query + real request ---------------------------
  const [micState, setMicState] = useState('unknown');
  const [micBusy, setMicBusy] = useState(false);
  useEffect(() => {
    let dead = false;
    const refresh = () => queryMicPermission().then((s) => { if (!dead) setMicState(s); });
    refresh();
    // The user may flip the permission in browser settings and come back —
    // re-read it when the tab regains focus instead of showing stale state.
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      dead = true;
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  const requestMic = async () => {
    if (micBusy) return;
    setMicBusy(true);
    try {
      setMicState(await requestMicPermission());
    } finally {
      setMicBusy(false);
    }
  };

  // --- notifications: reuse the store's enable flow --------------------------
  const [ntfBusy, setNtfBusy] = useState(false);
  const requestNtf = async () => {
    if (ntfBusy) return;
    setNtfBusy(true);
    try { await enableNotify(); } finally { setNtfBusy(false); }
  };

  const locInfo = locPermInfo(locStatus);
  const micInfo = micPermInfo(micState);
  const ntfInfo = ntfPermInfo(notifyPerm);

  // --- guide open state + deep focus ------------------------------------------
  // Denied permissions start with their guidance open — that is the only thing
  // that can actually fix them.
  const [openGuide, setOpenGuide] = useState(() => {
    if (locInfo.state === 'denied') return 'location';
    if (micInfo.state === 'denied') return 'microphone';
    if (ntfInfo.state === 'denied') return 'notifications';
    return null;
  });
  const toggleGuide = (perm) => setOpenGuide((o) => (o === perm ? null : perm));
  const scrollToPerm = (perm) => {
    setOpenGuide(perm);
    requestAnimationFrame(() => {
      try { document.getElementById(`perm-${perm}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* ignore */ }
    });
  };
  const firstDenied = useRef(false);
  useEffect(() => {
    // Crew B: setView('settings') then dispatch this to land on the mic row.
    const onFocusPerm = (e) => {
      const perm = e && e.detail && e.detail.perm;
      if (perm === 'location' || perm === 'microphone' || perm === 'notifications' || perm === 'sound') scrollToPerm(perm);
    };
    // Fresh load with ?perm=mic (or #perm=mic) — same landing, no event needed.
    try {
      const q = new URLSearchParams(window.location.search).get('perm');
      const h = (window.location.hash.match(/perm=([a-z]+)/) || [])[1];
      const p = q || h;
      if ((p === 'location' || p === 'microphone' || p === 'notifications' || p === 'sound') && !firstDenied.current) {
        firstDenied.current = true;
        setTimeout(() => scrollToPerm(p), 350);
      }
    } catch { /* ignore */ }
    window.addEventListener('wgpt:perm', onFocusPerm);
    return () => window.removeEventListener('wgpt:perm', onFocusPerm);
  }, []);

  const locAction = locInfo.action === 'request' || locInfo.action === 'retry'
    ? { onAction: requestLocation, actionKey: locInfo.action === 'retry' ? 'permRetry' : 'permAllow', busy: locInfo.state === 'working' }
    : {};
  const micAction = micInfo.action === 'request'
    ? { onAction: requestMic, actionKey: 'permAllow', busy: micBusy }
    : {};
  const ntfAction = ntfInfo.action === 'request'
    ? { onAction: requestNtf, actionKey: 'permAllow', busy: ntfBusy }
    : {};

  // Honest push state under the switch: background-ready vs in-app-only (with
  // the reason) vs off. icon+word, never colour alone.
  const pushNote = pushMode === 'background'
    ? { icon: 'bell', text: t(lang, 'setPushBg') }
    : pushMode === 'inapp'
      ? {
          icon: 'info',
          text: t(lang, 'setPushInAppWhy').replace('{reason}', t(lang, pushReasonKey(pushReason))),
        }
      : null;

  return (
    <div className="set-stack">
      <Row icon="user" title={t(lang, 'setProfile')}>
        <label className="sub" htmlFor="set-name" style={{ display: 'block', marginBottom: 6 }}>{t(lang, 'setName')}</label>
        <div className="row">
          <input
            id="set-name"
            className="input"
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
            placeholder={t(lang, 'setNamePh')}
            autoComplete="name"
            style={{ flex: '1 1 auto', minWidth: 0 }}
          />
        </div>
        <p className="sub" style={{ marginTop: 6, marginBottom: 0 }}>{t(lang, 'setNameSub')}</p>
      </Row>

=======
      <Row icon="user" title={t(lang, 'setRole')}>
        <p className="sub" style={{ margin: '0 0 8px' }}>{t(lang, 'setRoleNote')}</p>
        <button type="button" className="btn btn-ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setView('advisory')}>
          {t(lang, 'setRoleGo')} <Icon name="chevron" size={14} aria-hidden="true" />
        </button>
      </Row>

      <Row icon="pin" title={t(lang, 'setPlace')}>
        <div className="chip-grid" role="group" aria-label={t(lang, 'setPlace')}>
          <button type="button" className="role-chip" onClick={requestLocation} disabled={locStatus === 'requesting' || locStatus === 'resolving'}>
            <Icon name="search" size={24} aria-hidden="true" />
            <span>{t(lang, 'useMyLocation')}</span>
          </button>
        </div>
        <p className="sub" style={{ margin: '6px 0 0' }}>{t(lang, 'setPlaceNote')}</p>
      </Row>

      <Row icon="translate" title={t(lang, 'setLanguage')}>
        <div className="segmented langseg" role="group" aria-label={t(lang, 'setLanguage')}>
          {['en', 'hi', 'te'].map((l) => (
            <button key={l} type="button" className={`seg-opt${lang === l ? ' is-active' : ''}`} aria-pressed={lang === l} onClick={() => setLang(l)}>
              {l === 'en' ? 'EN' : l === 'hi' ? 'हिं' : 'తె'}
            </button>
          ))}
        </div>
      </Row>

      <Row icon="shield" title={t(lang, 'setPermTitle')}>
        <p className="sub" style={{ marginTop: 0 }}>{t(lang, 'setPermSub')}</p>
        <PermRow
          lang={lang} icon="pin" titleKey="permLocT" descKey="permLocD"
          state={locInfo.state} guidePerm="location" platform={platform}
          open={openGuide === 'location'} onToggle={() => toggleGuide('location')}
          {...locAction}
        />
        <PermRow
          lang={lang} icon="mic" titleKey="permMicT" descKey="permMicD"
          state={micInfo.state} guidePerm="microphone" platform={platform}
          open={openGuide === 'microphone'} onToggle={() => toggleGuide('microphone')}
          {...micAction}
        />
        <PermRow
          lang={lang} icon="speaker" titleKey="permSndT" descKey="permSndD"
          state={soundOn ? 'on' : 'off'} guidePerm="sound" platform={platform}
          open={openGuide === 'sound'} onToggle={() => toggleGuide('sound')}
          note={t(lang, 'setSoundNote')}
          control={(
            <div className="row" style={{ marginTop: 8 }}>
              <button type="button" role="switch" aria-checked={soundOn} className="switch-row" onClick={flipSound}>
                <span className="sub">{t(lang, soundOn ? 'permOn' : 'permOff')}</span>
                <span className={`switch${soundOn ? ' is-on' : ''}`} aria-hidden="true">
                  <span className="switch-track"><span className="switch-thumb" /></span>
                </span>
              </button>
              <button type="button" className="btn btn-ghost sm" onClick={() => toggleGuide('sound')} aria-expanded={openGuide === 'sound'}>
                {t(lang, openGuide === 'sound' ? 'permHide' : 'permHow')}
              </button>
            </div>
          )}
        />
        <PermRow
          lang={lang} icon="bell" titleKey="permNtfT" descKey="permNtfD"
          state={ntfInfo.state} guidePerm="notifications" platform={platform}
          open={openGuide === 'notifications'} onToggle={() => toggleGuide('notifications')}
          {...ntfAction}
        />
      </Row>

      <Row icon="bell" title={t(lang, 'setAlerts')}>
        <button type="button" role="switch" aria-checked={!!notifyOn} className="switch-row" onClick={toggleNotify}>
          <span className="sub">{t(lang, 'setAlertsSub')}</span>
          <span className={`switch${notifyOn ? ' is-on' : ''}`} aria-hidden="true">
            <span className="switch-track"><span className="switch-thumb" /></span>
          </span>
        </button>
        {pushNote && (
          <div className="sub" role="status" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
            <Icon name={pushNote.icon} size={14} aria-hidden="true" />
            <span>{pushNote.text}</span>
          </div>
        )}
      </Row>
    </div>
  );
}
