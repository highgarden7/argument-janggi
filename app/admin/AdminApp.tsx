"use client";

import { useEffect, useState, type FormEvent } from "react";

type FeedbackItem = { id: number; title: string; content: string; createdAt: number };

const STORAGE_KEY = "augment-janggi-admin-password";

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString("ko-KR");
}

async function fetchFeedback(password: string): Promise<FeedbackItem[]> {
  const response = await fetch("/api/admin/feedback", { headers: { "X-Admin-Password": password } });
  const payload = await response.json() as { items?: FeedbackItem[]; error?: string };
  if (!response.ok) throw new Error(payload.error || "불러오지 못했습니다.");
  return payload.items ?? [];
}

function AdminLogin({ onUnlock }: { onUnlock: (password: string) => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setMessage("");
    try {
      await fetchFeedback(password);
      sessionStorage.setItem(STORAGE_KEY, password);
      onUnlock(password);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "확인하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };
  return <main className="admin-shell"><section className="admin-lock"><p className="eyebrow">ADMIN</p><h1>관리자 로그인</h1><form onSubmit={submit}>
    <input type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="비밀번호"/>
    <button className="primary-button" disabled={!password || busy}>{busy ? "확인 중…" : "입장"}</button>
  </form>{message && <p className="room-connection-note error" role="alert">{message}</p>}</section></main>;
}

function FeedbackDetailModal({ item, close }: { item: FeedbackItem; close: () => void }) {
  return <div className="modal-backdrop"><section className="modal admin-detail-modal"><button className="modal-close" onClick={close}>×</button>
    <p className="eyebrow">ISSUE</p><h2>{item.title}</h2><time>{formatDate(item.createdAt)}</time><p>{item.content}</p>
  </section></div>;
}

function AdminDashboard({ password, onLock }: { password: string; onLock: () => void }) {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<FeedbackItem | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  useEffect(() => {
    fetchFeedback(password).then(result => { setItems(result); setMessage("") }).catch(cause => {
      const text = cause instanceof Error ? cause.message : "불러오지 못했습니다.";
      setMessage(text);
      if (text.includes("비밀번호")) onLock();
    });
  }, [password, refreshToken, onLock]);
  return <main className="admin-shell"><section className="admin-card">
    <header className="admin-header"><div><p className="eyebrow">ADMIN · {items.length}건</p><h1>이슈 및 건의사항</h1></div><div><button className="secondary-button" onClick={() => setRefreshToken(token => token + 1)}>새로고침</button> <button className="text-button" onClick={onLock}>잠그기</button></div></header>
    {message && <p className="room-connection-note error" role="alert">{message}</p>}
    {items.length ? <div className="admin-list">{items.map(item => <button key={item.id} onClick={() => setSelected(item)}><strong>{item.title}</strong><time>{formatDate(item.createdAt)}</time></button>)}</div> : <div className="admin-empty">등록된 이슈 및 건의사항이 없습니다.</div>}
    {selected && <FeedbackDetailModal item={selected} close={() => setSelected(null)}/>}
  </section></main>;
}

export default function AdminApp() {
  const [password, setPassword] = useState<string | null>(null);
  useEffect(() => {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (!stored) return;
    fetchFeedback(stored).then(() => setPassword(stored)).catch(() => sessionStorage.removeItem(STORAGE_KEY));
  }, []);
  const lock = () => { sessionStorage.removeItem(STORAGE_KEY); setPassword(null) };
  return password ? <AdminDashboard password={password} onLock={lock}/> : <AdminLogin onUnlock={setPassword}/>;
}
