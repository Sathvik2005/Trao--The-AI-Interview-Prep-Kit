import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { InterviewKit } from "../domain/kit-schema.js";
import "./styles.css";
import "./extra.css";

type User = { id: string; email: string; created_at: string };
type SavedKit = { id: string; kit: InterviewKit; practice: Record<string, number>; created_at: string; updated_at: string };
type View = "overview" | "questions" | "practice" | "mock" | "schedule";
type Question = InterviewKit["questions"][number];
type Flashcard = InterviewKit["flashcards"][number];
type Category = Question["category"];
type Step = { step: string; label: string; status: "running" | "done" | "skipped" | "failed"; detail?: string };
type Job = { id: string; status: "running" | "done" | "failed"; steps: Step[]; kit_id?: string; error?: { code: string; message: string } };
type JobView = { key: string; label: string; body: { jd: string; company_url: string; days: number }; job: Job | null; kit_id?: string; error?: string; duplicate?: boolean };
type RegenerateBody = { section: "company_brief" | "questions" | "flashcards" | "schedule"; category?: Category; days?: number };

const apiBase = import.meta.env.VITE_API_URL || "";
const CATEGORIES: Category[] = ["technical", "behavioural", "system-design", "company-fit"];
const PIPELINE_STEPS = ["requirements", "role", "research", "brief", "questions", "coverage", "flashcards", "schedule"];
const STEP_LABELS: Record<string, string> = {
  requirements: "Extracting requirements", role: "Reading the role", research: "Crawling the company site and public discussion",
  brief: "Writing the company brief", questions: "Generating questions by category", coverage: "Coverage check (second pass)",
  flashcards: "Writing flashcards", schedule: "Allocating the study schedule",
};

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function api<T>(path: string, token: string | null, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null) as T | null;
  if (!response.ok) {
    const payload = data as { error?: { message?: string; details?: Array<{ message: string }> } } | null;
    const detail = payload?.error?.details?.[0]?.message;
    throw new ApiError([payload?.error?.message, detail].filter(Boolean).join(" ") || `Request failed (${response.status}).`, response.status);
  }
  return data as T;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function hostLabel(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

function sourceLabel(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "news.ycombinator.com") return `Hacker News #${parsed.searchParams.get("id") ?? ""}`;
    const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "").slice(0, 26);
    return `${parsed.hostname.replace(/^www\./, "")}${path}`;
  } catch { return url; }
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function uncoveredIds(kit: InterviewKit): string[] {
  const covered = new Set(kit.questions.flatMap((question) => question.requirement_ids));
  return kit.role.requirements.filter((requirement) => !covered.has(requirement.id)).map((requirement) => requirement.id);
}

function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem("prep-token"));
  const [user, setUser] = useState<User | null>(null);
  const [kits, setKits] = useState<SavedKit[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<View>("overview");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [loading, setLoading] = useState(Boolean(token));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [jobs, setJobs] = useState<JobView[]>([]);
  const [saving, setSaving] = useState(false);
  const [kitsLoading, setKitsLoading] = useState(false);
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const selectedKit = kits.find((item) => item.id === selected) ?? null;

  function expireSession() {
    sessionStorage.removeItem("prep-token");
    setToken(null);
    setUser(null);
    setKits([]);
    setSelected(null);
    setError("Your session has expired. Please sign in again.");
  }

  useEffect(() => {
    if (!token) {
      setLoading(false);
      setUser(null);
      return;
    }
    setLoading(true);
    setKitsLoading(true);
    Promise.all([
      api<{ user: User }>("/api/auth/me", token),
      api<{ kits: SavedKit[] }>("/api/kits", token),
    ]).then(([auth, result]) => {
      setUser(auth.user);
      setKits(result.kits);
      setError("");
    }).catch((reason: unknown) => {
      if (reason instanceof ApiError && reason.status === 401) expireSession();
      else setError(reason instanceof Error ? reason.message : "Could not load your workspace.");
    }).finally(() => { setLoading(false); setKitsLoading(false); });
  }, [token]);

  function guard(reason: unknown, fallback: string): string {
    if (reason instanceof ApiError && reason.status === 401) {
      expireSession();
      return "";
    }
    return reason instanceof Error ? reason.message : fallback;
  }

  async function authenticate(email: string, password: string) {
    setError("");
    setLoading(true);
    try {
      const endpoint = authMode === "register" ? "/api/auth/register" : "/api/auth/login";
      const result = await api<{ user: User; token: string }>(endpoint, null, { method: "POST", body: JSON.stringify({ email, password }) });
      sessionStorage.setItem("prep-token", result.token);
      setToken(result.token);
      setUser(result.user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Authentication failed.");
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    try { await api("/api/auth/logout", token, { method: "POST" }); } catch { /* Local sign-out still clears the session. */ }
    sessionStorage.removeItem("prep-token");
    setToken(null);
    setUser(null);
    setKits([]);
    setSelected(null);
    setJobs([]);
  }

  function patchJob(key: string, patch: Partial<JobView>) {
    setJobs((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item));
  }

  async function runJob(label: string, body: JobView["body"], existingKey?: string) {
    const key = existingKey ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    if (existingKey) patchJob(key, { job: null, error: undefined, kit_id: undefined });
    else setJobs((current) => [{ key, label, body, job: null }, ...current]);
    try {
      const started = await api<{ job?: Job; kit?: SavedKit; duplicate?: boolean }>("/api/kits", tokenRef.current, { method: "POST", body: JSON.stringify(body) });
      if (started.kit) {
        setKits((current) => current.some((item) => item.id === started.kit!.id) ? current : [started.kit!, ...current]);
        patchJob(key, { kit_id: started.kit.id, duplicate: true, job: { id: "", status: "done", steps: [] } });
        return;
      }
      let job = started.job!;
      patchJob(key, { job, duplicate: started.duplicate });
      while (job.status === "running") {
        await sleep(1500);
        job = (await api<{ job: Job }>(`/api/jobs/${job.id}`, tokenRef.current)).job;
        patchJob(key, { job });
      }
      if (job.status === "done" && job.kit_id) {
        const result = await api<{ kit: SavedKit }>(`/api/kits/${job.kit_id}`, tokenRef.current);
        setKits((current) => current.some((item) => item.id === result.kit.id) ? current : [result.kit, ...current]);
        patchJob(key, { kit_id: job.kit_id });
      } else patchJob(key, { error: job.error?.message ?? "Generation failed." });
    } catch (reason) {
      const message = guard(reason, "Kit generation failed.");
      if (message) patchJob(key, { error: message });
    }
  }

  function openKit(id: string) {
    setSelected(id);
    setView("overview");
  }

  async function saveKit(updatedKit: InterviewKit): Promise<InterviewKit | null> {
    if (!selectedKit) return null;
    setSaving(true);
    try {
      const result = await api<{ kit: SavedKit }>(`/api/kits/${selectedKit.id}`, token, { method: "PUT", body: JSON.stringify(updatedKit) });
      setKits((current) => current.map((item) => item.id === result.kit.id ? { ...item, kit: result.kit.kit, updated_at: result.kit.updated_at } : item));
      setError("");
      return result.kit.kit;
    } catch (reason) {
      const message = guard(reason, "Your changes could not be saved.");
      if (message) setError(message);
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function regenerate(body: RegenerateBody): Promise<InterviewKit> {
    if (!selectedKit) throw new Error("No kit selected.");
    try {
      const result = await api<{ kit: SavedKit }>(`/api/kits/${selectedKit.id}/regenerate`, token, { method: "POST", body: JSON.stringify(body) });
      setKits((current) => current.map((item) => item.id === result.kit.id ? result.kit : item));
      return result.kit.kit;
    } catch (reason) {
      throw new Error(guard(reason, "Regeneration failed.") || "Session expired.");
    }
  }

  async function removeKit() {
    if (!selectedKit) return;
    try {
      await api(`/api/kits/${selectedKit.id}`, token, { method: "DELETE" });
      setKits((current) => current.filter((item) => item.id !== selectedKit.id));
      setSelected(null);
      setNotice("Kit deleted.");
    } catch (reason) {
      const message = guard(reason, "The kit could not be deleted.");
      if (message) setError(message);
    }
  }

  async function recordConfidence(flashcardId: string, confidence: number) {
    if (!selectedKit) return;
    try {
      const result = await api<{ kit: SavedKit }>(`/api/kits/${selectedKit.id}/practice`, token, { method: "POST", body: JSON.stringify({ flashcard_id: flashcardId, confidence }) });
      setKits((current) => current.map((item) => item.id === result.kit.id ? { ...item, practice: result.kit.practice } : item));
    } catch (reason) {
      const message = guard(reason, "Confidence could not be saved.");
      if (message) setError(message);
    }
  }

  if (loading && !user) return <main className="loading-screen"><span className="loader" />Loading your prep desk</main>;
  if (!user) return <AuthScreen mode={authMode} setMode={setAuthMode} onSubmit={authenticate} loading={loading} error={error} />;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#content">Skip to content</a>
      <aside className="sidebar">
        <button className="brand" onClick={() => setSelected(null)} aria-label="Prep Kit home">
          <span className="brand-mark">P</span><span>prep<span className="brand-light">kit</span></span>
        </button>
        <div className="sidebar-label">Workspace</div>
        <button className={`side-link ${!selected ? "active" : ""}`} onClick={() => setSelected(null)}><span className="nav-glyph">◫</span> My prep desk</button>
        {selectedKit && <>
          <div className="sidebar-label kit-label">Current kit</div>
          <button className={`side-link ${view === "overview" ? "active" : ""}`} onClick={() => setView("overview")}><span className="nav-glyph">◈</span> Brief & coverage</button>
          <button className={`side-link ${view === "questions" ? "active" : ""}`} onClick={() => setView("questions")}><span className="nav-glyph">☷</span> Question bank</button>
          <button className={`side-link ${view === "practice" ? "active" : ""}`} onClick={() => setView("practice")}><span className="nav-glyph">▣</span> Flashcard practice</button>
          <button className={`side-link ${view === "schedule" ? "active" : ""}`} onClick={() => setView("schedule")}><span className="nav-glyph">▦</span> Study schedule</button>
          <button className={`side-link ${view === "mock" ? "active" : ""}`} onClick={() => setView("mock")}><span className="nav-glyph">◔</span> Mock interview</button>
        </>}
        <div className="sidebar-bottom">
          <div className="account-chip"><span className="avatar">{user.email.slice(0, 1).toUpperCase()}</span><span className="account-email">{user.email}</span></div>
          <button className="signout" onClick={() => void signOut()}>Sign out <span aria-hidden="true">↗</span></button>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar"><span className="breadcrumb">Prep desk <span>/</span> {selectedKit ? selectedKit.kit.source.company : "My workspace"}</span><span className="topbar-date">{new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(new Date())}</span></header>
        <div className="content-wrap" id="content" tabIndex={-1}>
          {error && <div className="notice error-notice" role="alert"><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
          {notice && <div className="notice info-notice" role="status"><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss message">×</button></div>}
          {selectedKit ? <KitWorkspace
            key={selectedKit.id}
            saved={selectedKit}
            view={view}
            setView={setView}
            onSave={saveKit}
            saving={saving}
            onConfidence={recordConfidence}
            onRegenerate={regenerate}
            onDelete={removeKit}
          /> : <Dashboard
            kits={kits}
            loadingKits={kitsLoading}
            jobs={jobs}
            onCreate={(jd, url, days) => runJob(hostLabel(url), { jd, company_url: url, days })}
            onBatch={async (items) => { for (const item of items) await runJob(hostLabel(item.company_url), item); }}
            onRetry={(entry) => void runJob(entry.label, entry.body, entry.key)}
            onDismiss={(key) => setJobs((current) => current.filter((item) => item.key !== key))}
            onOpen={openKit}
            onError={setError}
          />}
        </div>
      </main>
    </div>
  );
}

function AuthScreen({ mode, setMode, onSubmit, loading, error }: {
  mode: "login" | "register";
  setMode: (mode: "login" | "register") => void;
  onSubmit: (email: string, password: string) => Promise<void>;
  loading: boolean;
  error: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return <main className="auth-screen">
    <section className="auth-story">
      <div className="auth-brand"><span className="brand-mark">P</span><span>prepkit</span></div>
      <div className="story-copy"><p className="eyebrow">PREPARATION, WITH A POINT</p><h1>Show up ready<br />for the <em>real</em> questions.</h1><p>Turn a role description into a focused practice plan, grounded in the company you want to join.</p></div>
      <div className="story-index"><span>01</span><span className="index-rule" /><span>Build with intent</span></div>
      <div className="orbit-stamp"><span>ROLE</span><span>→</span><span>READY</span></div>
    </section>
    <section className="auth-panel">
      <div className="auth-card">
        <div className="auth-tabs" role="tablist" aria-label="Account">
          <button role="tab" type="button" aria-selected={mode === "login"} className={mode === "login" ? "selected" : ""} onClick={() => setMode("login")}>Sign in</button>
          <button role="tab" type="button" aria-selected={mode === "register"} className={mode === "register" ? "selected" : ""} onClick={() => setMode("register")}>Create account</button>
        </div>
        <p className="eyebrow">YOUR NEXT CHAPTER</p>
        <h2>{mode === "register" ? "Create your prep desk" : "Welcome back"}</h2>
        <p className="auth-subtitle">{mode === "register" ? "A quieter way to get interview-ready." : "Pick up where your preparation left off."}</p>
        <form onSubmit={(event) => { event.preventDefault(); void onSubmit(email, password); }}>
          <label>Email address<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
          <label>Password<input type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} required minLength={mode === "register" ? 12 : 1} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === "register" ? "At least 12 characters" : "Your password"} /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button auth-submit" disabled={loading}>{loading ? "One moment…" : mode === "register" ? "Create account" : "Sign in"}<span aria-hidden="true">↗</span></button>
        </form>
        <p className="auth-switch">{mode === "register" ? "Already have a desk?" : "New to Prep Kit?"} <button onClick={() => setMode(mode === "register" ? "login" : "register")}>{mode === "register" ? "Sign in" : "Create an account"}</button></p>
        <p className="auth-foot">Your kits are private to your account.</p>
      </div>
    </section>
  </main>;
}

function JobCard({ entry, onRetry, onDismiss, onOpen }: { entry: JobView; onRetry: () => void; onDismiss: () => void; onOpen: (id: string) => void }) {
  const steps = new Map((entry.job?.steps ?? []).map((step) => [step.step, step]));
  const failed = Boolean(entry.error);
  const done = Boolean(entry.kit_id);
  return <article className={`job-card ${failed ? "job-failed" : done ? "job-done" : ""}`} aria-live="polite">
    <div className="job-head">
      <strong>{entry.label}</strong>
      <span>{failed ? "Failed" : done ? (entry.duplicate ? "Already built" : "Ready") : "Building…"}</span>
    </div>
    {entry.duplicate && done && <p className="job-note">You already had a kit for this exact posting, so it was reused instead of generated again.</p>}
    {!entry.duplicate && <ol className="job-steps">{PIPELINE_STEPS.map((id) => {
      const step = steps.get(id);
      const state = step?.status ?? (done ? "done" : "pending");
      return <li key={id} className={`step-${state}`}><span className="step-dot" aria-hidden="true" />{STEP_LABELS[id]}{step?.detail && <em>{step.detail}</em>}</li>;
    })}</ol>}
    {failed && <p className="form-error" role="alert">{entry.error}</p>}
    <div className="job-actions">
      {done && <button className="primary-button small" onClick={() => onOpen(entry.kit_id!)}>Open kit</button>}
      {failed && <button className="primary-button small" onClick={onRetry}>Try again</button>}
      {(failed || done) && <button className="link-button" onClick={onDismiss}>Dismiss</button>}
    </div>
  </article>;
}

function Dashboard({ kits, loadingKits, jobs, onCreate, onBatch, onRetry, onDismiss, onOpen, onError }: {
  kits: SavedKit[];
  loadingKits: boolean;
  jobs: JobView[];
  onCreate: (jd: string, companyUrl: string, days: number) => Promise<void>;
  onBatch: (items: Array<{ jd: string; company_url: string; days: number }>) => Promise<void>;
  onRetry: (entry: JobView) => void;
  onDismiss: (key: string) => void;
  onOpen: (id: string) => void;
  onError: (message: string) => void;
}) {
  const [jd, setJd] = useState("");
  const [companyUrl, setCompanyUrl] = useState("");
  const [days, setDays] = useState(7);
  const [fileName, setFileName] = useState("");
  const building = jobs.some((entry) => !entry.error && !entry.kit_id);

  async function readFile(file: File | undefined) {
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 10) throw new Error("The file must be a JSON array of 1 to 10 postings.");
      const items = parsed.map((entry, index) => {
        const record = entry as { jd?: unknown; company_url?: unknown; days?: unknown };
        if (typeof record.jd !== "string" || record.jd.trim().length < 20 || typeof record.company_url !== "string") throw new Error(`Entry ${index + 1} needs a "jd" (20+ characters) and a "company_url".`);
        return { jd: record.jd, company_url: record.company_url, days: Math.min(60, Math.max(1, Number(record.days) || days)) };
      });
      setFileName(file.name);
      await onBatch(items);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : "That file could not be read.");
    }
  }

  return <>
    <div className="page-heading"><div><p className="eyebrow">YOUR PREPARATION, IN ONE PLACE</p><h1>My prep desk<span className="heading-dot">.</span></h1><p className="page-lede">A little structure makes room for your best thinking.</p></div><div className="heading-count"><strong>{String(kits.length).padStart(2, "0")}</strong><span>saved {kits.length === 1 ? "kit" : "kits"}</span></div></div>
    <section className="builder-section">
      <div className="section-heading"><div><span className="section-number">01</span><h2>Start a new preparation</h2></div><span className="section-side-note">ABOUT 1–2 MINUTES</span></div>
      <form className="builder-form" onSubmit={(event) => { event.preventDefault(); void onCreate(jd, companyUrl, days); }}>
        <label className="wide-field">Job description<textarea value={jd} onChange={(event) => setJd(event.target.value)} required minLength={20} maxLength={50000} rows={5} placeholder="Paste the role description. The clearest source text gives you the most useful prep." /></label>
        <div className="form-row"><label>Company website<input type="url" value={companyUrl} onChange={(event) => setCompanyUrl(event.target.value)} required placeholder="https://company.com" /></label><label className="days-field">Days to prepare<div className="number-control"><button type="button" onClick={() => setDays(Math.max(1, days - 1))} aria-label="One fewer day">−</button><input type="number" value={days} min={1} max={60} aria-label="Days to prepare" onChange={(event) => setDays(Math.min(60, Math.max(1, Number(event.target.value) || 1)))} /><button type="button" onClick={() => setDays(Math.min(60, days + 1))} aria-label="One more day">+</button></div></label></div>
        <div className="submit-row"><p>We crawl the company site, look for public interview discussion, and tie every question to a requirement in your description.</p><button className="primary-button" disabled={jd.trim().length < 20 || !companyUrl}>{building ? <><span className="button-loader" /> Build another</> : <>Build my kit <span aria-hidden="true">↗</span></>}</button></div>
        <div className="batch-row"><button type="button" className="ghost-button" onClick={() => { setJd(EXAMPLE_POSTING.jd); setCompanyUrl(EXAMPLE_POSTING.company_url); setDays(EXAMPLE_POSTING.days); }}>Try an example posting</button><label className="file-label">Preparing for several roles? Upload a JSON file of postings
          <input type="file" accept="application/json,.json" onChange={(event) => { void readFile(event.target.files?.[0]); event.target.value = ""; }} /></label>
          <span className="file-hint">{fileName ? `Last upload: ${fileName}` : 'Format: [{"jd": "...", "company_url": "https://...", "days": 7}]'}</span></div>
      </form>
    </section>
    {jobs.length > 0 && <section className="jobs-section" aria-label="Kits being built">{jobs.map((entry) => <JobCard key={entry.key} entry={entry} onRetry={() => onRetry(entry)} onDismiss={() => onDismiss(entry.key)} onOpen={onOpen} />)}</section>}
    {(() => {
      const active = kits.map((saved) => ({ saved, progress: dayProgress(saved, saved.kit.schedule.days_available) })).find((item) => !item.progress.finished);
      if (!active) return null;
      const day = active.saved.kit.schedule.days.find((entry) => entry.day === active.progress.today);
      return <section className="today-strip" aria-label="Today's plan"><div><span className="today-label">TODAY · DAY {active.progress.today} OF {active.saved.kit.schedule.days_available}</span><strong>{active.saved.kit.source.company}: {day?.focus ?? "Review"}</strong><small>{day ? `${day.question_ids.length} question${day.question_ids.length === 1 ? "" : "s"} · about ${day.minutes} min` : ""} · {active.progress.daysLeft} day{active.progress.daysLeft === 1 ? "" : "s"} left after today</small></div><button className="primary-button small" onClick={() => onOpen(active.saved.id)}>Open plan <span aria-hidden="true">↗</span></button></section>;
    })()}
    <section className="kits-section"><div className="section-heading"><div><span className="section-number">02</span><h2>Recent kits</h2></div><span className="section-side-note">{kits.length ? `${kits.length} PREPARATION${kits.length === 1 ? "" : "S"}` : "YOUR LIBRARY"}</span></div>
      {loadingKits && !kits.length ? <div className="kit-grid" aria-busy="true">{[0, 1, 2].map((item) => <div className="kit-card skeleton" key={item}><span /><span /><span /></div>)}</div> : kits.length ? <div className="kit-grid">{kits.map((saved) => <button className="kit-card" key={saved.id} onClick={() => onOpen(saved.id)}><div className="kit-card-top"><span className="company-initial">{saved.kit.source.company.slice(0, 1).toUpperCase()}</span><span className="card-arrow">↗</span></div><p className="company-name">{saved.kit.source.company}</p><h3>{saved.kit.role.title}</h3><div className="kit-card-bottom"><span>{plural(saved.kit.schedule.days_available, "day")}</span><span>{plural(saved.kit.role.requirements.length, "role signal")}</span><span className="card-date">{new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(saved.updated_at))}</span></div></button>)}</div> : <div className="empty-library"><span className="empty-symbol">↗</span><div><strong>Your library starts here.</strong><p>Build your first kit above; it’ll be ready to return to whenever you are.</p></div></div>}
    </section>
  </>;
}

/** A textarea that grows to fit its content, so long questions are never clipped. */
function AutoTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight + 2}px`;
  }, [props.value]);
  return <textarea ref={ref} {...props} />;
}

type ReadinessRow = { req: InterviewKit["role"]["requirements"][number]; score: number; rated: number; total: number };

/** Readiness per requirement: average self-rating of every card and question linked to it (unrated counts as 0). */
function computeReadiness(kit: InterviewKit, practice: Record<string, number>): { rows: ReadinessRow[]; overall: number } {
  const rows = kit.role.requirements.map((req) => {
    const ids = [...kit.flashcards.filter((card) => card.requirement_ids.includes(req.id)).map((card) => card.id), ...kit.questions.filter((question) => question.requirement_ids.includes(req.id)).map((question) => question.id)];
    const ratings = ids.map((id) => practice[id]).filter(Boolean);
    return { req, score: ids.length ? ratings.reduce((sum, value) => sum + value, 0) / (ids.length * 5) : 0, rated: ratings.length, total: ids.length };
  });
  const weight = (row: ReadinessRow) => (row.req.priority === "must" ? 2 : 1);
  const totalWeight = rows.reduce((sum, row) => sum + weight(row), 0);
  return { rows, overall: totalWeight ? Math.round((100 * rows.reduce((sum, row) => sum + row.score * weight(row), 0)) / totalWeight) : 0 };
}

function dayProgress(saved: { created_at: string }, totalDays: number): { today: number; daysLeft: number; finished: boolean } {
  const elapsed = Math.max(0, Math.floor((Date.now() - Date.parse(saved.created_at)) / 86_400_000));
  return { today: Math.min(totalDays, elapsed + 1), daysLeft: Math.max(0, totalDays - elapsed - 1), finished: elapsed >= totalDays };
}

function formatClock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Timed mock interview: weakest questions first, think aloud against the clock, then rate yourself. */
function MockInterview({ kit, practice, onRate }: { kit: InterviewKit; practice: Record<string, number>; onRate: (id: string, rating: number) => Promise<void> }) {
  const [queue, setQueue] = useState<Question[]>(() => [...kit.questions].sort((left, right) => (practice[left.id] ?? 0) - (practice[right.id] ?? 0)).slice(0, 8));
  const [index, setIndex] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const [notes, setNotes] = useState("");
  const [showOutline, setShowOutline] = useState(false);
  const [session, setSession] = useState<number[]>([]);
  const question = queue[index];

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);

  function restart() {
    setQueue([...kit.questions].sort((left, right) => (practice[left.id] ?? 0) - (practice[right.id] ?? 0)).slice(0, 8));
    setIndex(0); setSeconds(0); setRunning(false); setNotes(""); setShowOutline(false); setSession([]);
  }

  function rate(rating: number) {
    void onRate(question.id, rating);
    setSession((current) => [...current, rating]);
    setIndex((value) => value + 1);
    setSeconds(0); setRunning(false); setNotes(""); setShowOutline(false);
  }

  if (queue.length === 0) return <div className="empty-panel">Add or generate questions first, then come back to rehearse them.</div>;
  if (!question) {
    const average = session.length ? (session.reduce((sum, value) => sum + value, 0) / session.length).toFixed(1) : "0";
    return <div className="mock-done"><p className="eyebrow">SESSION COMPLETE</p><h3>{session.length} questions rehearsed</h3><p>Average confidence <strong>{average} / 5</strong>. Your readiness score and weak spots have been updated.</p><button className="primary-button" onClick={restart}>Run another round <span aria-hidden="true">↗</span></button></div>;
  }
  return <div className="mock-layout">
    <div className="mock-progress" role="progressbar" aria-valuemin={0} aria-valuemax={queue.length} aria-valuenow={index}><span style={{ width: `${(index / queue.length) * 100}%` }} /></div>
    <div className="mock-meta"><span>Question {index + 1} of {queue.length}</span><span className={`category-tag category-${question.category}`}>{question.category.replace("-", " ")}</span><span className={`mock-timer ${seconds > 180 ? "over" : ""}`} aria-live="off">{formatClock(seconds)}<small>aim for 2–3 min</small></span></div>
    <p className="mock-prompt">{question.prompt}</p>
    <div className="mock-controls">
      <button className="ghost-button" onClick={() => setRunning((value) => !value)}>{running ? "Pause timer" : seconds ? "Resume timer" : "Start timer"}</button>
      <button className="ghost-button" onClick={() => setShowOutline((value) => !value)}>{showOutline ? "Hide outline" : "Peek at the outline"}</button>
    </div>
    <label className="mock-notes">Jot your answer (kept only on this screen)<textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Structure first: situation, approach, trade-offs, result." /></label>
    {showOutline && <div className="mock-outline"><span>WHAT A STRONG ANSWER COVERS</span><p>{question.answer_outline || "No outline was written for this question."}</p></div>}
    <div className="confidence-row"><span id="mock-rate">How did that go?</span><div className="confidence-buttons" role="group" aria-labelledby="mock-rate">{[1, 2, 3, 4, 5].map((rating) => <button key={rating} onClick={() => rate(rating)} aria-label={`Rate ${rating} of 5`}>{rating}</button>)}</div></div>
  </div>;
}

const EXAMPLE_POSTING = {
  jd: "Senior Full-Stack Engineer (Remote, EU timezones).\nYou will own features end to end across our TypeScript/React frontend and Node.js backend, and mentor junior engineers.\nRequirements: 5+ years of professional experience with TypeScript. Strong experience with React is required. Must have experience designing and operating PostgreSQL databases. Experience with ClickHouse is a bonus. Excellent written communication in a remote-first team.",
  company_url: "https://posthog.com",
  days: 5,
};

/** Printable one-pager: hidden on screen, shown by the browser's print dialog (Save as PDF). */
function PrintSheet({ kit, practice }: { kit: InterviewKit; practice: Record<string, number> }) {
  const byId = new Map(kit.questions.map((question) => [question.id, question]));
  return <div className="print-only">
    <h1>{kit.role.title} at {kit.source.company}</h1>
    <p className="print-meta">{[kit.role.seniority, kit.source.location, `${kit.schedule.days_available} days`].filter(Boolean).join(" · ")}</p>
    <h2>Company brief</h2>
    <p>{kit.company_brief.summary}</p>
    {kit.company_brief.what_they_do && <p>{kit.company_brief.what_they_do}</p>}
    {kit.company_brief.hiring_process && <p><strong>How they hire:</strong> {kit.company_brief.hiring_process}</p>}
    <h2>What they are asking for</h2>
    <ul>{kit.role.requirements.map((requirement) => <li key={requirement.id}><strong>[{requirement.priority}]</strong> {requirement.text}</li>)}</ul>
    <h2>Study plan</h2>
    <ol>{kit.schedule.days.map((day) => <li key={day.day}><strong>Day {day.day}: {day.focus}</strong> ({day.minutes} min)<ul>{day.question_ids.map((id) => byId.get(id)).filter((question): question is Question => Boolean(question)).map((question) => <li key={question.id}>{question.prompt}</li>)}</ul></li>)}</ol>
    <h2>Question bank</h2>
    {CATEGORIES.map((category) => { const items = kit.questions.filter((question) => question.category === category); return items.length ? <section key={category}><h3>{category.replace("-", " ")}</h3>{items.map((question) => <div className="print-q" key={question.id}><p><strong>{question.prompt}</strong></p>{question.answer_outline && <p>{question.answer_outline}</p>}</div>)}</section> : null; })}
    <h2>Flashcards</h2>
    <ul>{kit.flashcards.map((card) => <li key={card.id}><strong>{card.front}</strong> {card.back}{practice[card.id] ? ` (confidence ${practice[card.id]}/5)` : ""}</li>)}</ul>
  </div>;
}

function KitWorkspace({ saved, view, setView, onSave, saving, onConfidence, onRegenerate, onDelete }: {
  saved: SavedKit;
  view: View;
  setView: (view: View) => void;
  onSave: (kit: InterviewKit) => Promise<InterviewKit | null>;
  saving: boolean;
  onConfidence: (flashcardId: string, confidence: number) => Promise<void>;
  onRegenerate: (body: RegenerateBody) => Promise<InterviewKit>;
  onDelete: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<InterviewKit>(() => structuredClone(saved.kit));
  const [activeCard, setActiveCard] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [localError, setLocalError] = useState("");
  const [scheduleDays, setScheduleDays] = useState(saved.kit.schedule.days_available);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  function change(mutator: (kit: InterviewKit) => void) {
    setDraft((current) => {
      const updated = structuredClone(current);
      mutator(updated);
      updated.coverage.uncovered_requirement_ids = uncoveredIds(updated);
      return updated;
    });
    setDirty(true);
  }

  /** Adopt only server-derived fields (provenance, schedule, coverage) so typing is never clobbered. */
  function adoptServerState(server: InterviewKit) {
    setDraft((current) => {
      const questionOrigins = new Map(server.questions.map((question) => [question.id, question.origin]));
      const cardOrigins = new Map(server.flashcards.map((card) => [card.id, card.origin]));
      return {
        ...current,
        schedule: server.schedule,
        coverage: server.coverage,
        questions: current.questions.map((question) => ({ ...question, origin: questionOrigins.get(question.id) ?? question.origin })),
        flashcards: current.flashcards.map((card) => ({ ...card, origin: cardOrigins.get(card.id) ?? card.origin })),
      };
    });
  }

  async function flush(): Promise<boolean> {
    if (!dirty) return true;
    const result = await onSave(draftRef.current);
    if (!result) return false;
    adoptServerState(result);
    setDirty(false);
    return true;
  }

  useEffect(() => {
    if (!dirty || busy) return;
    const timer = setTimeout(() => { void flush(); }, 1200);
    return () => clearTimeout(timer);
  }, [draft, dirty, busy]);

  async function regenerate(label: string, body: RegenerateBody) {
    setLocalError("");
    setBusy(label);
    try {
      if (!await flush()) throw new Error("Your pending edits could not be saved, so nothing was regenerated.");
      const fresh = await onRegenerate(body);
      setDraft(structuredClone(fresh));
      setDirty(false);
      setScheduleDays(fresh.schedule.days_available);
    } catch (reason) {
      setLocalError(reason instanceof Error ? reason.message : "Regeneration failed.");
    } finally {
      setBusy("");
    }
  }

  function addQuestion(category: Category) {
    change((kit) => {
      kit.questions.push({ id: `q-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, requirement_ids: [], category, prompt: "New question", answer_outline: "", difficulty: 2, origin: "manual" });
    });
  }

  function addFlashcard() {
    change((kit) => { kit.flashcards.push({ id: `f-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, front: "New card", back: "Answer", requirement_ids: [], origin: "manual" }); });
  }

  function moveQuestion(index: number, direction: -1 | 1) {
    const destination = index + direction;
    if (destination < 0 || destination >= draft.questions.length) return;
    change((kit) => { [kit.questions[index], kit.questions[destination]] = [kit.questions[destination], kit.questions[index]]; });
  }

  function toggleRequirement(question: Question, index: number, requirementId: string) {
    change((kit) => {
      const ids = kit.questions[index].requirement_ids;
      kit.questions[index].requirement_ids = ids.includes(requirementId) ? ids.filter((id) => id !== requirementId) : [...ids, requirementId];
    });
    void question;
  }

  const practice = saved.practice;
  const weakFirstCards = [...draft.flashcards].sort((left, right) => (practice[left.id] ?? 0) - (practice[right.id] ?? 0));
  const currentCard = weakFirstCards.length ? weakFirstCards[activeCard % weakFirstCards.length] : null;
  const uncovered = uncoveredIds(draft);
  const coveragePercent = draft.role.requirements.length ? Math.round(((draft.role.requirements.length - uncovered.length) / draft.role.requirements.length) * 100) : 100;
  const rated = draft.flashcards.filter((card) => practice[card.id]).length;
  const unrated = draft.flashcards.filter((card) => !practice[card.id]);
  const questionById = new Map(draft.questions.map((question) => [question.id, question]));
  const regenerating = Boolean(busy);
  const progress = dayProgress(saved, draft.schedule.days_available);
  const readiness = computeReadiness(draft, practice);
  const weakSpots = [...readiness.rows].sort((left, right) => left.score - right.score || Number(right.req.priority === "must") - Number(left.req.priority === "must")).slice(0, 3);

  return <>
    <div className="kit-heading screen-only"><div><p className="eyebrow">PREPARATION KIT <span className="heading-slash">/</span> {draft.role.seniority || "ROLE PLAN"}</p><h1>{draft.role.title}<span className="heading-dot">.</span></h1><div className="kit-meta"><span className="meta-company">{draft.source.company}</span><span>{plural(draft.schedule.days_available, "day")}{progress.finished ? " · plan complete" : ` · day ${progress.today} today`}</span><span>{plural(draft.role.requirements.length, "requirement")}</span><span>{readiness.overall}% ready</span></div></div><div className="kit-heading-actions"><span className={`coverage-pill ${coveragePercent === 100 ? "coverage-complete" : ""}`}><span />{coveragePercent}% mapped</span><button className="ghost-button" onClick={() => window.print()} title="Print or save as PDF">Print one-pager</button><span className="save-state" role="status">{saving ? "Saving…" : dirty ? "Unsaved changes" : "All changes saved"}</span>{dirty && <button className="primary-button save-button" disabled={saving} onClick={() => void flush()}>Save now</button>}</div></div>
    {localError && <div className="notice error-notice" role="alert"><span>{localError}</span><button onClick={() => setLocalError("")} aria-label="Dismiss error">×</button></div>}
    {regenerating && <div className="notice info-notice" role="status"><span><span className="button-loader dark" /> Regenerating {busy}… your edits elsewhere are kept.</span></div>}
    <div className="screen-only">
    <nav className="kit-tabs" aria-label="Kit sections">{(["overview", "questions", "practice", "mock", "schedule"] as View[]).map((item) => <button key={item} className={view === item ? "selected" : ""} aria-current={view === item} onClick={() => setView(item)}>{item === "overview" ? "Brief & coverage" : item === "questions" ? "Question bank" : item === "practice" ? "Practice" : item === "mock" ? "Mock interview" : "Schedule"}{item === "questions" && <sup>{draft.questions.length}</sup>}</button>)}</nav>

    {view === "overview" && <div className="overview-layout">
      <section className="main-column"><div className="brief-section"><div className="section-heading compact"><div><span className="section-number">01</span><h2>Company brief</h2></div><button className="ghost-button" disabled={regenerating} onClick={() => void regenerate("the company brief", { section: "company_brief" })}>↻ Regenerate brief</button></div>
        <p className="brief-summary">{draft.company_brief.summary || "No company summary was available from the research sources."}</p>
        {draft.company_brief.what_they_do && <p className="brief-detail">{draft.company_brief.what_they_do}</p>}
        {draft.company_brief.hiring_process && <div className="hiring-box"><span>HOW THEY HIRE</span><p>{draft.company_brief.hiring_process}</p></div>}
        <div className="source-list"><span>Sources</span>{draft.company_brief.sources.length ? draft.company_brief.sources.map((source) => <a href={source} target="_blank" rel="noreferrer" key={source}>{sourceLabel(source)} <span aria-hidden="true">↗</span></a>) : <span className="no-sources">No pages were available.</span>}</div>
        {draft.research_notes && draft.research_notes.length > 0 && <details className="research-notes"><summary>{draft.research_notes.length} research note{draft.research_notes.length === 1 ? "" : "s"} (gaps and skipped sources)</summary><ul>{draft.research_notes.map((note) => <li key={note}>{note}</li>)}</ul></details>}</div>
        <div className="readiness-section"><div className="section-heading compact"><div><span className="section-number">02</span><h2>Readiness and weak spots</h2></div><button className="ghost-button" onClick={() => setView("mock")}>Start a mock round</button></div>
          <div className="readiness-grid"><div className="ring" style={{ background: `conic-gradient(#48745c ${readiness.overall * 3.6}deg, #e2e8e1 0)` }} role="img" aria-label={`Overall readiness ${readiness.overall} percent`}><span>{readiness.overall}<small>%</small></span></div>
            <div className="weak-list"><p className="weak-help">Built from your own confidence ratings on cards and mock questions. Must-haves count double.</p>{weakSpots.length ? weakSpots.map((row) => <div className="weak-row" key={row.req.id}><div><span className={`priority-tag ${row.req.priority}`}>{row.req.priority}</span> {row.req.text}</div><div className="weak-bar" aria-hidden="true"><span style={{ width: `${Math.max(4, Math.round(row.score * 100))}%` }} /></div><small>{row.rated === 0 ? "Not practised yet" : `${Math.round(row.score * 100)}% · ${row.rated}/${row.total} rated`}</small></div>) : <p className="weak-help">Add requirements to track readiness.</p>}<button className="link-button" onClick={() => setView("practice")}>Practise the weakest first</button></div></div></div>
        <div className="requirements-section"><div className="section-heading compact"><div><span className="section-number">03</span><h2>Role signals</h2></div><span className="section-side-note">FROM YOUR DESCRIPTION</span></div>{draft.role.requirements.length ? <div className="requirement-list">{draft.role.requirements.map((requirement) => <div className="requirement-row" key={requirement.id}><span className={`priority-mark ${requirement.priority}`} /> <span className="requirement-text">{requirement.text}</span><span className="kind-tag">{requirement.kind}</span><span className={`priority-tag ${requirement.priority}`}>{requirement.priority}</span></div>)}</div> : <div className="no-requirements">The description did not contain enough detail to extract requirements, so this kit is intentionally thin rather than invented.</div>}</div>
        <div className="danger-zone"><button className="link-button danger" onClick={() => { if (window.confirm("Delete this kit permanently?")) void onDelete(); }}>Delete this kit</button></div>
      </section>
      <aside className="coverage-aside"><div className="coverage-number">{coveragePercent}<span>%</span></div><h3>Coverage map</h3><p>{draft.role.requirements.length - uncovered.length} of {draft.role.requirements.length} role signals connect to practice questions.</p><div className="coverage-track"><span style={{ width: `${coveragePercent}%` }} /></div><div className="coverage-stat"><span>Requirements</span><strong>{draft.role.requirements.length}</strong></div><div className="coverage-stat"><span>Questions</span><strong>{draft.questions.length}</strong></div><div className="coverage-stat"><span>Coverage passes</span><strong>{draft.coverage.passes}</strong></div><div className="coverage-note">{uncovered.length ? `${uncovered.length} requirement(s) are not connected to a question.` : "Every extracted requirement has a question."}</div></aside>
    </div>}

    {view === "questions" && <section className="questions-view"><div className="section-heading"><div><span className="section-number">03</span><h2>Question bank</h2></div><span className="section-side-note">EDIT, PIN, REORDER, ADD</span></div>
      <div className="toolbar" role="group" aria-label="Question bank actions">
        <span className="toolbar-label">Regenerate</span>
        {CATEGORIES.map((category) => <button key={category} className="ghost-button" disabled={regenerating} onClick={() => void regenerate(`${category.replace("-", " ")} questions`, { section: "questions", category })}>↻ {category.replace("-", " ")}</button>)}
        <span className="toolbar-sep" />
        <span className="toolbar-label">Add</span>
        {CATEGORIES.map((category) => <button key={category} className="ghost-button" onClick={() => addQuestion(category)}>+ {category.replace("-", " ")}</button>)}
      </div>
      <p className="toolbar-help">Questions you edit, write or pin are kept when a category is regenerated.</p>
      {draft.questions.length ? <div className="question-list">{draft.questions.map((question, index) => <article className="question-item" key={question.id}><div className="question-top"><span className="question-index">{String(index + 1).padStart(2, "0")}</span><select aria-label={`Question ${index + 1} category`} className={`category-select category-${question.category}`} value={question.category} onChange={(event) => change((kit) => { kit.questions[index].category = event.target.value as Category; })}>{CATEGORIES.map((category) => <option key={category} value={category}>{category.replace("-", " ")}</option>)}</select>{question.origin && question.origin !== "generated" && <span className={`origin-tag origin-${question.origin}`}>{question.origin}</span>}<span className="difficulty" title={`Difficulty ${question.difficulty} of 3`}>{[1, 2, 3].map((level) => <i key={level} className={level <= question.difficulty ? "filled" : ""} />)}</span><div className="reorder-actions"><button onClick={() => moveQuestion(index, -1)} disabled={index === 0} aria-label={`Move question ${index + 1} up`}>↑</button><button onClick={() => moveQuestion(index, 1)} disabled={index === draft.questions.length - 1} aria-label={`Move question ${index + 1} down`}>↓</button></div></div>
        <AutoTextarea aria-label={`Question ${index + 1} prompt`} value={question.prompt} onChange={(event) => change((kit) => { kit.questions[index].prompt = event.target.value; })} rows={2} />
        <label className="outline-label">Answer outline<AutoTextarea aria-label={`Question ${index + 1} answer outline`} value={question.answer_outline} onChange={(event) => change((kit) => { kit.questions[index].answer_outline = event.target.value; })} rows={2} /></label>
        <details className="req-links"><summary>{question.requirement_ids.length} linked role signal{question.requirement_ids.length === 1 ? "" : "s"}</summary>{draft.role.requirements.map((requirement) => <label key={requirement.id} className="check-row"><input type="checkbox" checked={question.requirement_ids.includes(requirement.id)} onChange={() => toggleRequirement(question, index, requirement.id)} />{requirement.text}</label>)}</details>
        <div className="question-footer"><label className="check-row"><input type="checkbox" checked={Boolean(question.pinned)} onChange={(event) => change((kit) => { kit.questions[index].pinned = event.target.checked; })} />Pin (keep on regenerate)</label><span className="item-actions"><label className="diff-label">Difficulty<select value={question.difficulty} onChange={(event) => change((kit) => { kit.questions[index].difficulty = Number(event.target.value); })}>{[1, 2, 3].map((level) => <option key={level} value={level}>{level}</option>)}</select></label><button className="link-button danger" onClick={() => change((kit) => { kit.questions.splice(index, 1); })} aria-label={`Delete question ${index + 1}`}>Delete</button></span></div></article>)}</div> : <div className="empty-panel">{draft.role.requirements.length ? "No questions yet. Add one above or regenerate a category." : "No requirements were found in the description, so no questions were generated."}</div>}</section>}

    {view === "practice" && <section className="practice-view"><div className="section-heading"><div><span className="section-number">04</span><h2>Recall, then reflect</h2></div><span className="section-side-note">LEAST CONFIDENT FIRST</span></div>
      <div className="practice-summary"><div><strong>{rated}</strong> of {draft.flashcards.length} cards covered<div className="coverage-track"><span style={{ width: `${draft.flashcards.length ? (rated / draft.flashcards.length) * 100 : 0}%` }} /></div></div>{unrated.length > 0 && <details><summary>{unrated.length} not covered yet</summary><ul>{unrated.map((card) => <li key={card.id}>{card.front}</li>)}</ul></details>}</div>
      <div className="toolbar"><button className="ghost-button" onClick={addFlashcard}>+ Add flashcard</button><button className="ghost-button" disabled={regenerating} onClick={() => void regenerate("flashcards", { section: "flashcards" })}>↻ Regenerate flashcards</button></div>
      {currentCard ? <div className="practice-layout"><div className="practice-progress"><span>Card {(activeCard % weakFirstCards.length) + 1} <i>/</i> {weakFirstCards.length}</span><span>{practice[currentCard.id] ? `Last confidence ${practice[currentCard.id]} / 5` : "Not rated yet"}</span></div><button className={`flashcard ${revealed ? "revealed" : ""}`} onClick={() => setRevealed((value) => !value)} aria-label={revealed ? "Hide answer" : "Reveal answer"}><span className="flashcard-label">{revealed ? "ANSWER" : "PROMPT"}</span><span className="flashcard-content">{revealed ? currentCard.back : currentCard.front}</span><span className="flashcard-hint">{revealed ? "Tap to return to prompt" : "Tap to reveal"} <span>↗</span></span></button><div className="confidence-row"><span id="confidence-label">How confident do you feel?</span><div className="confidence-buttons" role="group" aria-labelledby="confidence-label">{[1, 2, 3, 4, 5].map((confidence) => <button key={confidence} onClick={() => { void onConfidence(currentCard.id, confidence); setActiveCard((value) => value + 1); setRevealed(false); }} aria-label={`Confidence ${confidence} of 5`}>{confidence}</button>)}</div></div><div className="practice-controls"><button onClick={() => { setActiveCard((value) => (value - 1 + weakFirstCards.length) % weakFirstCards.length); setRevealed(false); }}>← Previous</button><button onClick={() => { setActiveCard((value) => value + 1); setRevealed(false); }}>Next card →</button></div>
        <details className="card-editor"><summary>Edit this card</summary><label>Front<textarea rows={2} value={currentCard.front} onChange={(event) => change((kit) => { const card = kit.flashcards.find((item) => item.id === currentCard.id); if (card) card.front = event.target.value; })} /></label><label>Back<textarea rows={3} value={currentCard.back} onChange={(event) => change((kit) => { const card = kit.flashcards.find((item) => item.id === currentCard.id); if (card) card.back = event.target.value; })} /></label><div className="card-editor-actions"><label className="check-row"><input type="checkbox" checked={Boolean(currentCard.pinned)} onChange={(event) => change((kit) => { const card = kit.flashcards.find((item) => item.id === currentCard.id); if (card) card.pinned = event.target.checked; })} />Pin</label><button className="link-button danger" onClick={() => { change((kit) => { kit.flashcards = kit.flashcards.filter((item) => item.id !== currentCard.id); }); setRevealed(false); }}>Delete card</button></div></details></div> : <div className="empty-panel">No flashcards yet. Add one, or regenerate to create them from the requirements.</div>}</section>}

    {view === "mock" && <section className="mock-view"><div className="section-heading"><div><span className="section-number">06</span><h2>Mock interview</h2></div><span className="section-side-note">WEAKEST QUESTIONS FIRST</span></div><MockInterview key={draft.questions.length} kit={draft} practice={practice} onRate={onConfidence} /></section>}

    {view === "schedule" && <section className="schedule-view"><div className="section-heading"><div><span className="section-number">05</span><h2>Your study rhythm</h2></div><span className="section-side-note">{draft.schedule.days_available} DAYS</span></div>
      <div className="toolbar"><label className="diff-label">Days<input type="number" min={1} max={60} value={scheduleDays} onChange={(event) => setScheduleDays(Math.min(60, Math.max(1, Number(event.target.value) || 1)))} /></label><button className="ghost-button" disabled={regenerating} onClick={() => void regenerate("the schedule", { section: "schedule", days: scheduleDays })}>↻ Rebuild schedule</button><span className="toolbar-help inline">Hardest, must-have material goes first. Your questions are not changed.</span></div>
      <div className="schedule-list">{draft.schedule.days.map((day) => { const dayQuestions = day.question_ids.map((id) => questionById.get(id)).filter((item): item is Question => Boolean(item)); return <article className={`schedule-day ${day.day === progress.today && !progress.finished ? "today" : ""}`} key={day.day} aria-current={day.day === progress.today && !progress.finished ? "date" : undefined}><span className="day-number">{String(day.day).padStart(2, "0")}</span><div className="day-copy"><h3>{day.focus}{day.day === progress.today && !progress.finished && <span className="today-badge">Today</span>}</h3><p>{dayQuestions.length ? `${dayQuestions.length} question${dayQuestions.length === 1 ? "" : "s"} to work through` : "Review your company and role context"}</p><div className="day-questions">{dayQuestions.map((question) => <span key={question.id}>{question.prompt}</span>)}</div></div><span className="day-time">{day.minutes}<small>MIN</small></span></article>; })}</div></section>}
    </div>
    <PrintSheet kit={draft} practice={practice} />
  </>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
