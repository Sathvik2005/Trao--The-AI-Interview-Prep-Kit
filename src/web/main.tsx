import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { InterviewKit } from "../domain/kit-schema.js";
import "./styles.css";

type User = { id: string; email: string; created_at: string };
type SavedKit = { id: string; kit: InterviewKit; practice: Record<string, number>; created_at: string; updated_at: string };
type View = "overview" | "questions" | "practice" | "schedule";

const apiBase = import.meta.env.VITE_API_URL || "";

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
    const payload = data as { error?: { message?: string } } | null;
    const message = payload?.error?.message;
    throw new ApiError(message || `Request failed (${response.status}).`, response.status);
  }
  return data as T;
}

function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem("prep-token"));
  const [user, setUser] = useState<User | null>(null);
  const [kits, setKits] = useState<SavedKit[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<View>("overview");
  const [authMode, setAuthMode] = useState<"login" | "register">("register");
  const [loading, setLoading] = useState(Boolean(token));
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  const selectedKit = kits.find((item) => item.id === selected) ?? null;

  useEffect(() => {
    if (!token) {
      setLoading(false);
      setUser(null);
      return;
    }
    setLoading(true);
    Promise.all([
      api<{ user: User }>("/api/auth/me", token),
      api<{ kits: SavedKit[] }>("/api/kits", token),
    ]).then(([auth, result]) => {
      setUser(auth.user);
      setKits(result.kits);
      setError("");
    }).catch((reason: unknown) => {
      if (reason instanceof ApiError && reason.status === 401) {
        sessionStorage.removeItem("prep-token");
        setToken(null);
      } else setError(reason instanceof Error ? reason.message : "Could not load your workspace.");
    }).finally(() => setLoading(false));
  }, [token]);

  async function authenticate(email: string, password: string) {
    setError("");
    setLoading(true);
    try {
      const endpoint = authMode === "register" ? "/api/auth/register" : "/api/auth/login";
      const result = await api<{ user: User; token: string }>(endpoint, null, {
        method: "POST", body: JSON.stringify({ email, password }),
      });
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
  }

  async function createKit(jd: string, companyUrl: string, days: number) {
    setCreating(true);
    setError("");
    try {
      const result = await api<{ kit: SavedKit }>("/api/kits", token, {
        method: "POST", body: JSON.stringify({ jd, company_url: companyUrl, days }),
      });
      setKits((current) => [result.kit, ...current]);
      setSelected(result.kit.id);
      setView("overview");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Kit generation failed.");
    } finally {
      setCreating(false);
    }
  }

  async function saveKit(updatedKit: InterviewKit) {
    if (!selectedKit) return;
    setSaving(true);
    setError("");
    try {
      const result = await api<{ kit: SavedKit }>(`/api/kits/${selectedKit.id}`, token, {
        method: "PUT", body: JSON.stringify(updatedKit),
      });
      setKits((current) => current.map((item) => item.id === result.kit.id ? result.kit : item));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Your changes could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function recordConfidence(flashcardId: string, confidence: number) {
    if (!selectedKit) return;
    try {
      const result = await api<{ kit: SavedKit }>(`/api/kits/${selectedKit.id}/practice`, token, {
        method: "POST", body: JSON.stringify({ flashcard_id: flashcardId, confidence }),
      });
      setKits((current) => current.map((item) => item.id === result.kit.id ? result.kit : item));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Confidence could not be saved.");
    }
  }

  if (loading && !user) return <main className="loading-screen"><span className="loader" />Loading your prep desk</main>;
  if (!user) return <AuthScreen mode={authMode} setMode={setAuthMode} onSubmit={authenticate} loading={loading} error={error} />;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => { setSelected(null); setView("overview"); }} aria-label="Prep Kit home">
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
        </>}
        <div className="sidebar-bottom">
          <div className="account-chip"><span className="avatar">{user.email.slice(0, 1).toUpperCase()}</span><span className="account-email">{user.email}</span></div>
          <button className="signout" onClick={() => void signOut()}>Sign out <span aria-hidden="true">↗</span></button>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar"><span className="breadcrumb">Prep desk <span>/</span> {selectedKit ? selectedKit.kit.source.company : "My workspace"}</span><span className="topbar-date">{new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(new Date())}</span></header>
        <div className="content-wrap">
          {error && <div className="notice error-notice" role="alert"><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
          {selectedKit ? <KitWorkspace
            key={selectedKit.id}
            saved={selectedKit}
            view={view}
            setView={setView}
            onSave={saveKit}
            saving={saving}
            onConfidence={recordConfidence}
          /> : <Dashboard kits={kits} onCreate={createKit} onOpen={(id) => { setSelected(id); setView("overview"); }} creating={creating} />}
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

function Dashboard({ kits, onCreate, onOpen, creating }: {
  kits: SavedKit[];
  onCreate: (jd: string, companyUrl: string, days: number) => Promise<void>;
  onOpen: (id: string) => void;
  creating: boolean;
}) {
  const [jd, setJd] = useState("");
  const [companyUrl, setCompanyUrl] = useState("");
  const [days, setDays] = useState(7);
  return <>
    <div className="page-heading"><div><p className="eyebrow">YOUR PREPARATION, IN ONE PLACE</p><h1>My prep desk<span className="heading-dot">.</span></h1><p className="page-lede">A little structure makes room for your best thinking.</p></div><div className="heading-count"><strong>{String(kits.length).padStart(2, "0")}</strong><span>saved {kits.length === 1 ? "kit" : "kits"}</span></div></div>
    <section className="builder-section">
      <div className="section-heading"><div><span className="section-number">01</span><h2>Start a new preparation</h2></div><span className="section-side-note">ABOUT 2 MINUTES</span></div>
      <form className="builder-form" onSubmit={(event) => { event.preventDefault(); void onCreate(jd, companyUrl, days); }}>
        <label className="wide-field">Job description<textarea value={jd} onChange={(event) => setJd(event.target.value)} required minLength={20} maxLength={50000} rows={5} placeholder="Paste the role description. The clearest source text gives you the most useful prep." /></label>
        <div className="form-row"><label>Company website<input type="url" value={companyUrl} onChange={(event) => setCompanyUrl(event.target.value)} required placeholder="https://company.com" /></label><label className="days-field">Days to prepare<div className="number-control"><button type="button" onClick={() => setDays(Math.max(1, days - 1))} aria-label="One fewer day">−</button><input type="number" value={days} min={1} max={60} onChange={(event) => setDays(Math.min(60, Math.max(1, Number(event.target.value))))} /><button type="button" onClick={() => setDays(Math.min(60, days + 1))} aria-label="One more day">+</button></div></label></div>
        <div className="submit-row"><p>We’ll research public company pages and keep the plan tied to the role you shared.</p><button className="primary-button" disabled={creating || jd.trim().length < 20 || !companyUrl}>{creating ? <><span className="button-loader" /> Building your kit…</> : <>Build my kit <span aria-hidden="true">↗</span></>}</button></div>
      </form>
    </section>
    <section className="kits-section"><div className="section-heading"><div><span className="section-number">02</span><h2>Recent kits</h2></div><span className="section-side-note">{kits.length ? `${kits.length} PREPARATION${kits.length === 1 ? "" : "S"}` : "YOUR LIBRARY"}</span></div>
      {kits.length ? <div className="kit-grid">{kits.map((saved) => <button className="kit-card" key={saved.id} onClick={() => onOpen(saved.id)}><div className="kit-card-top"><span className="company-initial">{saved.kit.source.company.slice(0, 1).toUpperCase()}</span><span className="card-arrow">↗</span></div><p className="company-name">{saved.kit.source.company}</p><h3>{saved.kit.role.title}</h3><div className="kit-card-bottom"><span>{saved.kit.schedule.days_available} days</span><span>{saved.kit.role.requirements.length} role signals</span><span className="card-date">{new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(saved.updated_at))}</span></div></button>)}</div> : <div className="empty-library"><span className="empty-symbol">↗</span><div><strong>Your library starts here.</strong><p>Build your first kit above; it’ll be ready to return to whenever you are.</p></div></div>}
    </section>
  </>;
}

function KitWorkspace({ saved, view, setView, onSave, saving, onConfidence }: {
  saved: SavedKit;
  view: View;
  setView: (view: View) => void;
  onSave: (kit: InterviewKit) => Promise<void>;
  saving: boolean;
  onConfidence: (flashcardId: string, confidence: number) => Promise<void>;
}) {
  const [draft, setDraft] = useState<InterviewKit>(() => structuredClone(saved.kit));
  const [activeCard, setActiveCard] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [dirty, setDirty] = useState(false);

  function updateQuestion(index: number, field: "prompt" | "answer_outline", value: string) {
    const updated = structuredClone(draft);
    updated.questions[index][field] = value;
    setDraft(updated);
    setDirty(true);
  }

  function moveQuestion(index: number, direction: -1 | 1) {
    const destination = index + direction;
    if (destination < 0 || destination >= draft.questions.length) return;
    const updated = structuredClone(draft);
    [updated.questions[index], updated.questions[destination]] = [updated.questions[destination], updated.questions[index]];
    setDraft(updated);
    setDirty(true);
  }

  const weakFirstCards = [...draft.flashcards].sort((left, right) => (saved.practice[left.id] ?? 0) - (saved.practice[right.id] ?? 0));
  const currentCard = weakFirstCards.length ? weakFirstCards[activeCard % weakFirstCards.length] : null;
  const coveragePercent = draft.role.requirements.length ? Math.round(((draft.role.requirements.length - draft.coverage.uncovered_requirement_ids.length) / draft.role.requirements.length) * 100) : 100;

  return <>
    <div className="kit-heading"><div><p className="eyebrow">PREPARATION KIT <span className="heading-slash">/</span> {draft.role.seniority || "ROLE PLAN"}</p><h1>{draft.role.title}<span className="heading-dot">.</span></h1><div className="kit-meta"><span className="meta-company">{draft.source.company}</span><span>{draft.schedule.days_available} days</span><span>{draft.role.requirements.length} requirements</span></div></div><div className="kit-heading-actions"><span className={`coverage-pill ${coveragePercent === 100 ? "coverage-complete" : ""}`}><span />{coveragePercent}% mapped</span>{dirty && <button className="primary-button save-button" disabled={saving} onClick={() => { void onSave(draft).then(() => setDirty(false)); }}>{saving ? "Saving…" : "Save edits"}</button>}</div></div>
    <nav className="kit-tabs" aria-label="Kit sections">{(["overview", "questions", "practice", "schedule"] as View[]).map((item) => <button key={item} className={view === item ? "selected" : ""} onClick={() => setView(item)}>{item === "overview" ? "Brief & coverage" : item === "questions" ? "Question bank" : item === "practice" ? "Practice" : "Schedule"}{item === "questions" && <sup>{draft.questions.length}</sup>}</button>)}</nav>
    {view === "overview" && <div className="overview-layout">
      <section className="main-column"><div className="brief-section"><div className="section-heading compact"><div><span className="section-number">01</span><h2>Company brief</h2></div><span className="section-side-note">PUBLIC RESEARCH</span></div><p className="brief-summary">{draft.company_brief.summary || "No company summary was available from the research sources."}</p><p className="brief-detail">{draft.company_brief.what_they_do || "No additional company details were available."}</p><div className="source-list"><span>Sources</span>{draft.company_brief.sources.length ? draft.company_brief.sources.map((source) => <a href={source} target="_blank" rel="noreferrer" key={source}>{new URL(source).hostname} <span aria-hidden="true">↗</span></a>) : <span className="no-sources">No pages were available.</span>}</div></div>
        <div className="requirements-section"><div className="section-heading compact"><div><span className="section-number">02</span><h2>Role signals</h2></div><span className="section-side-note">FROM YOUR DESCRIPTION</span></div>{draft.role.requirements.length ? <div className="requirement-list">{draft.role.requirements.map((requirement) => <div className="requirement-row" key={requirement.id}><span className={`priority-mark ${requirement.priority}`} /> <span className="requirement-text">{requirement.text}</span><span className="kind-tag">{requirement.kind}</span><span className={`priority-tag ${requirement.priority}`}>{requirement.priority}</span></div>)}</div> : <div className="no-requirements">No explicit requirements were identified in the description.</div>}</div>
      </section>
      <aside className="coverage-aside"><div className="coverage-number">{coveragePercent}<span>%</span></div><h3>Coverage map</h3><p>{draft.role.requirements.length - draft.coverage.uncovered_requirement_ids.length} of {draft.role.requirements.length} role signals connect to practice questions.</p><div className="coverage-track"><span style={{ width: `${coveragePercent}%` }} /></div><div className="coverage-stat"><span>Requirements</span><strong>{draft.role.requirements.length}</strong></div><div className="coverage-stat"><span>Questions</span><strong>{draft.questions.length}</strong></div><div className="coverage-stat"><span>Coverage passes</span><strong>{draft.coverage.passes}</strong></div><div className="coverage-note">{draft.coverage.uncovered_requirement_ids.length ? `${draft.coverage.uncovered_requirement_ids.length} requirement(s) are not connected to a question.` : "Every extracted requirement has a question."}</div></aside>
    </div>}
    {view === "questions" && <section className="questions-view"><div className="section-heading"><div><span className="section-number">03</span><h2>Question bank</h2></div><span className="section-side-note">EDIT PROMPTS INLINE</span></div>{draft.questions.length ? <div className="question-list">{draft.questions.map((question, index) => <article className="question-item" key={question.id}><div className="question-top"><span className="question-index">{String(index + 1).padStart(2, "0")}</span><span className={`category-tag category-${question.category}`}>{question.category.replace("-", " ")}</span><span className="difficulty">{[1, 2, 3].map((level) => <i key={level} className={level <= question.difficulty ? "filled" : ""} />)}</span><div className="reorder-actions"><button onClick={() => moveQuestion(index, -1)} disabled={index === 0} aria-label="Move question up">↑</button><button onClick={() => moveQuestion(index, 1)} disabled={index === draft.questions.length - 1} aria-label="Move question down">↓</button></div></div><textarea aria-label={`Question ${index + 1} prompt`} value={question.prompt} onChange={(event) => updateQuestion(index, "prompt", event.target.value)} rows={2} /><label className="outline-label">Answer outline<textarea aria-label={`Question ${index + 1} answer outline`} value={question.answer_outline} onChange={(event) => updateQuestion(index, "answer_outline", event.target.value)} rows={2} /></label><div className="question-footer"><span>{question.requirement_ids.length} linked role signal{question.requirement_ids.length === 1 ? "" : "s"}</span><span>{question.id}</span></div></article>)}</div> : <div className="empty-panel">No practice questions were generated for this role description.</div>}</section>}
    {view === "practice" && <section className="practice-view"><div className="section-heading"><div><span className="section-number">04</span><h2>Recall, then reflect</h2></div><span className="section-side-note">LOW CONFIDENCE FIRST</span></div>{currentCard ? <div className="practice-layout"><div className="practice-progress"><span>Card {activeCard + 1} <i>/</i> {weakFirstCards.length}</span><span>{saved.practice[currentCard.id] ? `Last confidence ${saved.practice[currentCard.id]} / 5` : "Not rated yet"}</span></div><button className={`flashcard ${revealed ? "revealed" : ""}`} onClick={() => setRevealed((value) => !value)} aria-label={revealed ? "Hide answer" : "Reveal answer"}><span className="flashcard-label">{revealed ? "ANSWER OUTLINE" : "ROLE SIGNAL"}</span><span className="flashcard-content">{revealed ? currentCard.back : currentCard.front}</span><span className="flashcard-hint">{revealed ? "Tap to return to prompt" : "Tap to reveal"} <span>↗</span></span></button><div className="confidence-row"><span>How confident do you feel?</span><div className="confidence-buttons">{[1, 2, 3, 4, 5].map((confidence) => <button key={confidence} onClick={() => { void onConfidence(currentCard.id, confidence); setActiveCard((value) => (value + 1) % weakFirstCards.length); setRevealed(false); }} aria-label={`Confidence ${confidence} of 5`}>{confidence}</button>)}</div></div><div className="practice-controls"><button onClick={() => { setActiveCard((value) => (value - 1 + weakFirstCards.length) % weakFirstCards.length); setRevealed(false); }}>← Previous</button><button onClick={() => { setActiveCard((value) => (value + 1) % weakFirstCards.length); setRevealed(false); }}>Next card →</button></div></div> : <div className="empty-panel">No flashcards are available for this kit yet.</div>}</section>}
    {view === "schedule" && <section className="schedule-view"><div className="section-heading"><div><span className="section-number">05</span><h2>Your study rhythm</h2></div><span className="section-side-note">{draft.schedule.days_available} DAYS</span></div><div className="schedule-list">{draft.schedule.days.map((day) => <article className="schedule-day" key={day.day}><span className="day-number">{String(day.day).padStart(2, "0")}</span><div className="day-copy"><h3>{day.focus}</h3><p>{day.question_ids.length ? `${day.question_ids.length} question${day.question_ids.length === 1 ? "" : "s"} to work through` : "Review your company and role context"}</p><div className="day-questions">{day.question_ids.map((questionId) => <span key={questionId}>{draft.questions.find((question) => question.id === questionId)?.prompt || questionId}</span>)}</div></div><span className="day-time">{day.minutes}<small>MIN</small></span></article>)}</div></section>}
  </>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
