import { useEffect, useState, type ReactNode } from "react";
import { isTauriRuntime } from "./lib/desktopApi";
import { webAuthApi } from "./lib/webApi";

export default function WebAuth({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(!isTauriRuntime());
  const [loggedIn, setLoggedIn] = useState(isTauriRuntime());
  const [configured, setConfigured] = useState(true);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    if (isTauriRuntime()) { setLoggedIn(true); setLoading(false); return; }
    try {
      const result = await webAuthApi.status();
      setConfigured(result.configured); setLoggedIn(result.loggedIn);
    } catch (reason) { setError(String(reason)); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    void refresh();
    const handler = () => { setLoggedIn(false); setError("Your session expired. Sign in again."); };
    window.addEventListener("shopify-tools-auth-required", handler);
    return () => window.removeEventListener("shopify-tools-auth-required", handler);
  }, []);

  async function login(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try { await webAuthApi.login(password); setLoggedIn(true); setPassword(""); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="auth-screen"><div className="auth-card"><div className="auth-logo">ST</div><h1>Shopify Tools</h1><p>Loading secure workspace...</p></div></div>;
  if (loggedIn) return <>{children}</>;

  return <div className="auth-screen"><div className="auth-card">
    <div className="auth-logo">ST</div><span className="auth-kicker">SHOPIFY OPERATIONS</span><h1>Shopify Tools</h1><p>Product, collection, price, inventory and transfer management.</p>
    {!configured && <div className="auth-error">PANEL_PASSWORD is not configured in Vercel Environment Variables.</div>}
    {error && <div className="auth-error">{error.replace(/^Error:\s*/, "")}</div>}
    <form onSubmit={login}><label>Panel password</label><input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoFocus autoComplete="current-password" placeholder="••••••••••••"/><button disabled={busy || !configured || !password}>{busy?"Signing in...":"Sign in"}</button></form>
    <small>shopifytools.vercel.app</small>
  </div></div>;
}
