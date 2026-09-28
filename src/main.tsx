import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type User = { name?: string; en_name?: string; avatar_url?: string; open_id?: string; email?: string };

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(new URLSearchParams(location.search).get("error"));

  useEffect(() => {
    // [1] 页面加载后先向后端查询 session，决定显示登录按钮还是用户信息。
    fetch("/api/auth/session")
      .then((response) => response.json())
      .then((data) => setUser(data.user))
      .catch(() => setError("无法连接到后端服务"))
      .finally(() => setLoading(false));
  }, []);

  async function logout() {
    // [7] session 存在后端，前端退出时调用后端清除 Cookie 和内存 session。
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
  }

  return (
    <main className="shell">
      <section className="intro">
        <div className="brand"><span className="brand-mark">M</span><span>OAuth Lab</span></div>
        <div className="intro-copy">
          <p className="eyebrow">MCP identity playground</p>
          <h1>让一次登录，<br /><em>穿过完整链路。</em></h1>
          <p className="description">用飞书身份验证，检查授权码、回调和服务端会话是否按预期工作。</p>
        </div>
        <div className="flow">
          <div className="flow-line" />
          <div><strong>01</strong><span>授权</span><small>Feishu OAuth 2.0</small></div>
          <div><strong>02</strong><span>回调</span><small>Server exchange</small></div>
          <div><strong>03</strong><span>会话</span><small>HttpOnly cookie</small></div>
        </div>
      </section>
      <section className="login-panel">
        <div className="panel-top"><span className="status-dot" />本地测试环境 <span className="version">v0.1</span></div>
        {loading ? <div className="loading">正在检查登录状态…</div> : user ? (
          <div className="account">
            <p className="eyebrow">已验证身份</p>
            <div className="avatar">{user.avatar_url ? <img src={user.avatar_url} alt="" /> : (user.name ?? "U").slice(0, 1)}</div>
            <h2>{user.name ?? user.en_name ?? "Feishu user"}</h2>
            <p className="user-id">{user.email ?? user.open_id ?? "身份信息已返回"}</p>
            <div className="verified"><span>✓</span> Feishu OAuth session active</div>
            <button className="secondary-button" onClick={logout}>退出登录</button>
          </div>
        ) : (
          <div className="login">
            <div className="feishu-icon">飞</div>
            <h2>登录测试</h2>
            <p>使用飞书账号授权，完成一次真实的 OAuth 2.0 登录。</p>
            {error && <div className="error">{error}</div>}
            {/* [2] 浏览器跳转到后端，由后端生成 state 并重定向到飞书授权页。 */}
            <a className="login-button" href="/api/auth/feishu"><span>使用飞书登录</span><b>↗</b></a>
            <p className="privacy">授权后仅在本地创建测试会话<br />不会保存你的飞书密码</p>
          </div>
        )}
        <div className="endpoint"><span>Callback endpoint</span><code>/api/auth/feishu/callback</code></div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
