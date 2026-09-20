// Presentation primitives shared by every view. Severity and provenance are
// ALWAYS rendered as a colour + its machine-readable label together (§ never colour-only).
// SIGNAL BOARD: severity is a signal bar + stamped label driven by data-sev,
// which only ever carries backend-provided severity.

export function Card({ title, sub, eyebrow, actions, children, className = '', as: Tag = 'section', ...rest }) {
  return (
    <Tag className={`card ${className}`.trim()} {...rest}>
      {(eyebrow || title || sub || actions) && (
        <header className="card-head">
          <div className="card-head-text">
            {eyebrow && <div className="eyebrow">{eyebrow}</div>}
            {title && <h2 className="card-title">{title}</h2>}
            {sub && <p className="sub">{sub}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </Tag>
  );
}

/** Backend-provided severity: a signal-bar host + uppercase stamp. */
export function Sev({ level, stamp = true }) {
  if (!level) return null;
  return (
    <span data-sev={level} title={`Official severity: ${level}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span className="sev-bar" style={{ height: '1.4em' }} aria-hidden="true" />
      {stamp && <span className="sev-stamp">{level}</span>}
    </span>
  );
}

/** Provenance of a single fact. Never colour-only, never claimant without a label. */
export function Prov({ value }) {
  if (!value) return null;
  return <span className={`prov ${value}`} title={`Data provenance: ${value}`}>{value}</span>;
}

export function Chip({ status, children, title }) {
  return (
    <span className="chip" title={title}>
      {status && <span className={`dot ${status}`} />}
      {children}
    </span>
  );
}

export function Stat({ k, v, hint }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

/** Key/value evidence row. */
export function KV({ k, children }) {
  return (
    <div className="evrow">
      <span className="k">{k}</span>
      <span className="v">{children}</span>
    </div>
  );
}

export function Empty({ children }) {
  return <p className="empty">{children}</p>;
}

export function Skeleton({ h = 72 }) {
  return <div className="skel" style={{ minHeight: h }} aria-hidden="true" />;
}

export function Loading({ label = 'Loading…' }) {
  return (
    <p className="mono loading" role="status">
      <span className="spin" aria-hidden="true" />
      {label}
    </p>
  );
}
