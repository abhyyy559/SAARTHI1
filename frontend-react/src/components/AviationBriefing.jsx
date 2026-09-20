// AviationBriefing — aviation planning section inside the Details route.
//
// What it is: a clearly-labelled, location-based aviation briefing rendered
// BELOW the alert details (or the honest empty state), never as alert content.
// What it is NOT: an official METAR/TAF, a certified briefing, or advice.
//
// Data path: GET /api/aviation/briefing — a deterministic backend assembler
// (no LLM anywhere in the path). The frontend renders what the server says:
// every section is OK (real data + named provenance) or UNAVAILABLE (honest
// reason). Cloud and visibility are PROXIES — tagged so in every language,
// never presented as measured ceiling or RVR. Alert severity goes through
// SevStamp, which only translates the backend's code and never re-grades. No
// synthetic METAR/TAF string is constructed here or on the server.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { t } from '../i18n';
import { useApp } from '../store';
import { Card, SevStamp, Prov, KV } from './ui';
import Icon from './icons';

const SECTION_ICON = {
  winds_aloft: 'wind',
  cloud: 'cloud',
  visibility: 'fog',
  turbulence_icing: 'activity',
  sun: 'sun',
  alerts: 'alert',
};
const SECTION_TITLE_KEY = {
  winds_aloft: 'avWinds',
  cloud: 'avCloud',
  visibility: 'avVis',
  turbulence_icing: 'avTurb',
  sun: 'avSun',
  alerts: 'avAlerts',
};
const SECTION_SUB_KEY = {
  winds_aloft: 'avWindsSub',
  cloud: 'avCloudSub',
  visibility: 'avVisProxy',
  turbulence_icing: 'avTurbSub',
  sun: null,
  alerts: 'avAlertsSub',
};
const BAND_KEY = { low: 'avBandLow', moderate: 'avBandModerate', elevated: 'avBandElevated' };
const CLOUD_KEY = {
  cloud_cover_low_pct: 'avLow',
  cloud_cover_mid_pct: 'avMid',
  cloud_cover_high_pct: 'avHigh',
};

function Unavailable({ lang, reason }) {
  return (
    <div className="av-unavail" role="note">
      <span className="av-unavail-label">
        <Icon name="info" size={16} aria-hidden="true" />
        {t(lang, 'avUnavailable')}
      </span>
      <details className="src-why">
        <summary>{t(lang, 'avWhyWhy')}</summary>
        <p className="sub">{reason}</p>
      </details>
    </div>
  );
}

function ProxyTag({ lang }) {
  return (
    <span className="chip" title={t(lang, 'avCloudProxy')}>
      <Icon name="info" size={14} aria-hidden="true" />
      {t(lang, 'avProxyTag')}
    </span>
  );
}

function WindTable({ lang, data }) {
  const fmt = (r) =>
    r
      ? `${r.wind_direction_deg != null ? `${r.wind_direction_deg}° ${r.wind_from || ''}` : '—'} · ${r.wind_speed_kt != null ? `${r.wind_speed_kt} ${t(lang, 'avKt')}` : '—'}`
      : t(lang, 'avUnavailable');
  return (
    <div className="av-winds" role="table" aria-label={t(lang, 'avWinds')}>
      <div className="av-wind-head" role="row">
        <span role="columnheader">{t(lang, 'avLevel')}</span>
        <span role="columnheader">{t(lang, 'avNow')}</span>
        <span role="columnheader">{t(lang, 'avPlus6h')}</span>
      </div>
      {(data?.now || []).map((row, i) => (
        <div className="av-wind-row" role="row" key={row?.level_hpa ?? i}>
          <span role="cell" className="av-level">{row?.level_hpa != null ? `${row.level_hpa} hPa` : '—'}</span>
          <span role="cell" className="av-wind-val">{fmt(row)}</span>
          <span role="cell" className="av-wind-val">{fmt(data?.plus_6h?.[i])}</span>
        </div>
      ))}
    </div>
  );
}

function CloudBlock({ lang, data }) {
  return (
    <div className="av-kvs">
      {Object.entries(CLOUD_KEY).map(([k, key]) => (
        <KV key={k} k={t(lang, key)}>
          {data?.[k] != null ? `${data[k]}%` : t(lang, 'avUnavailable')}
        </KV>
      ))}
    </div>
  );
}

function VisibilityBlock({ lang, data }) {
  const m = data?.visibility_m;
  return (
    <div className="av-kvs">
      <KV k={t(lang, 'avVis')}>
        {m != null ? `${Number(m).toLocaleString()} m (${(m / 1000).toFixed(1)} km)` : t(lang, 'avUnavailable')}
      </KV>
    </div>
  );
}

function TurbulenceBlock({ lang, data }) {
  const band = data?.turbulence_proxy_band;
  const fz = data?.freezing_level_proxy;
  return (
    <div className="av-kvs">
      <KV k={t(lang, 'avShear')}>
        {data?.wind_shear_850_500_kt != null ? `${data.wind_shear_850_500_kt} ${t(lang, 'avKt')}` : t(lang, 'avUnavailable')}
      </KV>
      <KV k={t(lang, 'avTurbBand')}>
        {band ? t(lang, BAND_KEY[band] || 'avBandLow') : t(lang, 'avUnavailable')}
      </KV>
      <KV k={t(lang, 'avFreeze')}>
        {fz ? `${t(lang, 'avFreezeBetween')} ${fz.between_hpa[0]}–${fz.between_hpa[1]} hPa` : '—'}
      </KV>
    </div>
  );
}

function SunBlock({ lang, data }) {
  return (
    <div className="av-kvs">
      <KV k={t(lang, 'avSunrise')}>{data?.sunrise || '—'}</KV>
      <KV k={t(lang, 'avSunset')}>{data?.sunset || '—'}</KV>
    </div>
  );
}

function AlertsBlock({ lang, data }) {
  const verdict = data?.verdict || {};
  const relevant = data?.relevant || [];
  const nearby = data?.nearby || [];
  return (
    <div className="av-alerts">
      {verdict?.level && (
        <div className="av-verdict-row">
          <SevStamp lang={lang} level={verdict.level} />
          {verdict?.detail && <span className="sub">{verdict.detail}</span>}
        </div>
      )}
      {!data?.feeds_answered && relevant.length === 0 && nearby.length === 0 && (
        <p className="sub">{t(lang, 'avFeedsUnanswered')}</p>
      )}
      {data?.feeds_answered && relevant.length === 0 && nearby.length === 0 && (
        <p className="sub">{t(lang, 'avNoActive')}</p>
      )}
      {[...relevant, ...nearby].map((a, i) => (
        <div className="av-alert-row" key={a.identifier || `av-${i}`}>
          <SevStamp lang={lang} level={String(a.severity || 'UNKNOWN').toUpperCase()} />
          <div className="av-alert-text">
            <div className="av-alert-headline">{a.headline || a.event || '—'}</div>
            {a.area && <div className="sub">{a.area}</div>}
            <Prov value={a.provenance} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Section({ lang, section }) {
  const name = section?.section;
  const body =
    section?.status !== 'OK' ? (
      <Unavailable lang={lang} reason={section?.reason || t(lang, 'avUnavailable')} />
    ) : name === 'winds_aloft' ? (
      <WindTable lang={lang} data={section.data} />
    ) : name === 'cloud' ? (
      <CloudBlock lang={lang} data={section.data} />
    ) : name === 'visibility' ? (
      <VisibilityBlock lang={lang} data={section.data} />
    ) : name === 'turbulence_icing' ? (
      <TurbulenceBlock lang={lang} data={section.data} />
    ) : name === 'sun' ? (
      <SunBlock lang={lang} data={section.data} />
    ) : name === 'alerts' ? (
      <AlertsBlock lang={lang} data={section.data} />
    ) : null;
  return (
    <section className="av-section" aria-label={t(lang, SECTION_TITLE_KEY[name] || 'avTitle')}>
      <div className="av-section-head">
        <Icon name={SECTION_ICON[name] || 'info'} size={18} aria-hidden="true" />
        <h3>{t(lang, SECTION_TITLE_KEY[name] || 'avTitle')}</h3>
        {section?.proxy && <ProxyTag lang={lang} />}
        <Prov value={section?.provenance} />
      </div>
      {SECTION_SUB_KEY[name] && <p className="sub">{t(lang, SECTION_SUB_KEY[name])}</p>}
      {body}
    </section>
  );
}

export default function AviationBriefing() {
  const { loc, lang, syncTick } = useApp();
  const [response, setResponse] = useState(null);
  const [tick, setTick] = useState(0);
  const key = `${loc.lat}:${loc.lon}:${lang}`;
  useEffect(() => {
    let active = true;
    api.aviationBriefing(loc.lat, loc.lon, lang)
      .then((data) => { if (active) setResponse({ key, data }); })
      .catch(() => { if (active) setResponse({ key, error: true }); });
    return () => { active = false; };
  }, [loc, lang, key, syncTick, tick]);
  const current = response?.key === key ? response : null;
  const data = current?.data;
  const sections = data?.sections || [];
  const anySample = sections.some((s) => s?.provenance === 'DEMO');

  return (
    <Card
      title={t(lang, 'avTitle')}
      sub={t(lang, 'avSub')}
      className="av-briefing"
      aria-label={t(lang, 'avTitle')}
    >
      {/* Mandatory disclaimer, all languages. Never collapsible, never below
          the fold of this card. */}
      <p className="av-disclaimer" role="note">
        <Icon name="alert" size={16} aria-hidden="true" />
        <strong>{t(lang, 'avDisclaimer')}</strong>
      </p>
      {anySample && (
        <p className="sub av-sample" role="note">{t(lang, 'avSample')}: {t(lang, 'avSampleNote')}</p>
      )}
      <div role="status" aria-live="polite">
        {!current ? (
          <p className="sub">{t(lang, 'avLoading')}</p>
        ) : current.error ? (
          <div className="offline-panel">
            <div className="display">{t(lang, 'avOfflineTitle')}</div>
            <p className="sub">{t(lang, 'avOfflineBody')}</p>
            <div className="row">
              <button type="button" className="btn sm" style={{ minHeight: 44 }} onClick={() => { setResponse(null); setTick((n) => n + 1); }}>
                <Icon name="refresh" size={14} /> {t(lang, 'avRetry')}
              </button>
            </div>
          </div>
        ) : (
          <div className="av-sections">
            {sections.map((s) => (
              <Section key={s.section} lang={lang} section={s} />
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
