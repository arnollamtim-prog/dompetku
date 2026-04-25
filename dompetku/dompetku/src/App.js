import React, { useState, useEffect, useCallback } from "react";
import "./index.css";
import { db, auth } from "./firebase";
import {
  collection, addDoc, deleteDoc, doc, updateDoc,
  query, orderBy, onSnapshot
} from "firebase/firestore";
import {
  onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut
} from "firebase/auth";
import { parseTransactionInput, getMoodMessage, getFunnyOverspendMessage, getWeeklySavingsTarget } from "./ai";
import {
  AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer
} from "recharts";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (n) => {
  if (!n) return "Rp 0";
  if (Math.abs(n) >= 1000000) return `Rp ${(n / 1000000).toFixed(1)}jt`;
  if (Math.abs(n) >= 1000) return `Rp ${(n / 1000).toFixed(0)}rb`;
  return `Rp ${n.toLocaleString("id")}`;
};

const fmtDate = (ts) => {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short" });
};

const CATEGORY_ICONS = {
  "Makanan & Minuman": "🍜", "Transportasi": "🚗", "Tagihan & Utilitas": "⚡",
  "Belanja": "🛍️", "Kesehatan": "💊", "Pendidikan": "📚",
  "Hiburan": "🎬", "Tabungan": "🏦", "Pemasukan": "💰",
  "Hutang": "😰", "Piutang": "🤝", "Lainnya": "📌"
};

const CATEGORY_COLORS = {
  "Makanan & Minuman": "#10b981", "Transportasi": "#3b82f6", "Tagihan & Utilitas": "#f59e0b",
  "Belanja": "#ec4899", "Kesehatan": "#34d399", "Pendidikan": "#8b5cf6",
  "Hiburan": "#f97316", "Tabungan": "#60a5fa", "Pemasukan": "#10b981",
  "Hutang": "#ef4444", "Piutang": "#fbbf24", "Lainnya": "#94a3b8"
};

const BUDGETS_DEFAULT = [
  { category: "Makanan & Minuman", limit: 1500000 },
  { category: "Transportasi", limit: 500000 },
  { category: "Hiburan", limit: 300000 },
  { category: "Tagihan & Utilitas", limit: 800000 },
];

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ msg, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 2800); return () => clearTimeout(t); }, [onDone]);
  return <div className="toast">{msg}</div>;
}

// ─── Method Popup ─────────────────────────────────────────────────────────────
function MethodPopup({ parsed, onSelect, onCancel }) {
  return (
    <div className="overlay" onClick={onCancel}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-title">Bayar pakai apa?</div>
        <div className="method-subtitle">
          {CATEGORY_ICONS[parsed.category] || "📌"} {parsed.description} · {fmt(parsed.amount)}
        </div>
        <div className="method-buttons">
          <button className="method-btn" onClick={() => onSelect("cash")}><span>💵</span>Cash</button>
          <button className="method-btn" onClick={() => onSelect("qris")}><span>📱</span>QRIS</button>
          <button className="method-btn" onClick={() => onSelect("transfer")}><span>🏦</span>Transfer</button>
        </div>
      </div>
    </div>
  );
}

// ─── Edit Popup ───────────────────────────────────────────────────────────────
function EditPopup({ txn, onSave, onCancel }) {
  const [form, setForm] = useState({
    description: txn.description,
    amount: txn.amount,
    category: txn.category,
    type: txn.type,
    method: txn.method || "cash",
  });

  return (
    <div className="overlay" onClick={onCancel}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-title">Edit Transaksi</div>
        <div className="form-group">
          <label className="form-label">Deskripsi</label>
          <input className="form-input" value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })} />
        </div>
        <div className="form-group">
          <label className="form-label">Jumlah (Rp)</label>
          <input className="form-input" type="number" value={form.amount}
            onChange={e => setForm({ ...form, amount: parseInt(e.target.value) || 0 })} />
        </div>
        <div className="form-group">
          <label className="form-label">Kategori</label>
          <select className="form-select" value={form.category}
            onChange={e => setForm({ ...form, category: e.target.value })}>
            {Object.keys(CATEGORY_ICONS).map(c =>
              <option key={c} value={c}>{CATEGORY_ICONS[c]} {c}</option>
            )}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Tipe</label>
          <select className="form-select" value={form.type}
            onChange={e => setForm({ ...form, type: e.target.value })}>
            <option value="expense">Pengeluaran</option>
            <option value="income">Pemasukan</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Metode</label>
          <select className="form-select" value={form.method}
            onChange={e => setForm({ ...form, method: e.target.value })}>
            <option value="cash">💵 Cash</option>
            <option value="qris">📱 QRIS</option>
            <option value="transfer">🏦 Transfer</option>
          </select>
        </div>
        <button className="btn-primary" onClick={() => onSave(form)}>Simpan</button>
        <button className="btn-ghost" onClick={onCancel}>Batal</button>
      </div>
    </div>
  );
}

// ─── Saldo Awal Popup ─────────────────────────────────────────────────────────
function SaldoAwalPopup({ current, onSave, onCancel }) {
  const [val, setVal] = useState(current || "");
  return (
    <div className="overlay" onClick={onCancel}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-title">Set Saldo Awal</div>
        <p style={{ fontSize: 13, color: "var(--text2)", marginBottom: 18, fontWeight: 500, lineHeight: 1.5 }}>
          Masukkan saldo dompet/rekening kamu sebagai titik awal perhitungan.
        </p>
        <div className="form-group">
          <label className="form-label">Saldo (Rp)</label>
          <input className="form-input" type="number" placeholder="1000000"
            value={val} onChange={e => setVal(e.target.value)}
            onKeyDown={e => e.key === "Enter" && onSave(parseInt(val) || 0)}
            autoFocus />
        </div>
        <button className="btn-primary" onClick={() => onSave(parseInt(val) || 0)}>Simpan</button>
        <button className="btn-ghost" onClick={onCancel}>Batal</button>
      </div>
    </div>
  );
}

// ─── Login Page ───────────────────────────────────────────────────────────────
function LoginPage() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handle = async () => {
    if (!email || !password) return;
    setLoading(true); setError("");
    try {
      if (mode === "login") await signInWithEmailAndPassword(auth, email, password);
      else await createUserWithEmailAndPassword(auth, email, password);
    } catch (e) {
      const msgs = {
        "auth/invalid-email": "Email tidak valid",
        "auth/wrong-password": "Password salah",
        "auth/user-not-found": "Akun tidak ditemukan",
        "auth/email-already-in-use": "Email sudah terdaftar",
        "auth/weak-password": "Password minimal 6 karakter",
        "auth/invalid-credential": "Email atau password salah",
      };
      setError(msgs[e.code] || "Gagal, coba lagi");
    }
    setLoading(false);
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">💰</div>
        <h1 className="login-title">Dompetku</h1>
        <p className="login-sub">Catat keuanganmu dengan mudah</p>

        <div className="login-tabs">
          <button className={`login-tab ${mode === "login" ? "active" : ""}`} onClick={() => { setMode("login"); setError(""); }}>Masuk</button>
          <button className={`login-tab ${mode === "register" ? "active" : ""}`} onClick={() => { setMode("register"); setError(""); }}>Daftar</button>
        </div>

        <div className="form-group">
          <label className="form-label">Email</label>
          <input className="form-input" type="email" placeholder="nama@email.com"
            value={email} onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handle()} />
        </div>
        <div className="form-group">
          <label className="form-label">Password</label>
          <input className="form-input" type="password" placeholder="••••••"
            value={password} onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handle()} />
        </div>

        {error && <div className="login-error">⚠️ {error}</div>}

        <button className="btn-primary" onClick={handle} disabled={loading}>
          {loading ? "Memproses..." : mode === "login" ? "Masuk" : "Buat Akun"}
        </button>
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard({ transactions, budgets, savings, saldoAwal, onSetSaldoAwal }) {
  const now = new Date();
  const thisMonth = transactions.filter(t => {
    const d = t.createdAt?.toDate ? t.createdAt.toDate() : new Date(t.createdAt || Date.now());
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });

  const pemasukan = thisMonth.filter(t => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const pengeluaran = thisMonth.filter(t => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const saldo = saldoAwal + pemasukan - pengeluaran;
  const totalTabungan = savings.reduce((s, sv) => s + (sv.current || 0), 0);
  const mood = getMoodMessage(saldo, pemasukan);

  // Last month comparison
  const lastMonth = transactions.filter(t => {
    const d = t.createdAt?.toDate ? t.createdAt.toDate() : new Date(t.createdAt || 0);
    const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return d.getMonth() === lm.getMonth() && d.getFullYear() === lm.getFullYear() && t.type === "expense";
  }).reduce((s, t) => s + t.amount, 0);

  const diffPct = lastMonth > 0 ? Math.round(((pengeluaran - lastMonth) / lastMonth) * 100) : null;

  const chartData = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
    const label = d.toLocaleDateString("id-ID", { month: "short" });
    const total = transactions
      .filter(t => {
        const td = t.createdAt?.toDate ? t.createdAt.toDate() : new Date(t.createdAt || 0);
        return td.getMonth() === d.getMonth() && td.getFullYear() === d.getFullYear() && t.type === "expense";
      })
      .reduce((s, t) => s + t.amount, 0);
    return { label, total };
  });

  const catData = Object.entries(
    thisMonth.filter(t => t.type === "expense").reduce((acc, t) => {
      acc[t.category] = (acc[t.category] || 0) + t.amount;
      return acc;
    }, {})
  ).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 5);

  const topCat = catData[0];

  const recentTxns = [...transactions].sort((a, b) => {
    const da = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
    const db2 = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
    return db2 - da;
  }).slice(0, 5);

  return (
    <div>
      {/* Hero Card - Saldo Utama */}
      <div className="hero-card" onClick={onSetSaldoAwal}>
        <div className="hero-label">
          <div className="hero-label-icon">💳</div>
          Saldo Saat Ini
        </div>
        <div className={`hero-amount ${saldo < 0 ? "negative" : ""}`}>
          {fmt(saldo)}
        </div>
        <div className="hero-footer">
          <span>{now.toLocaleDateString("id-ID", { month: "long", year: "numeric" })}</span>
          <span className="hero-edit-hint">Ubah saldo awal</span>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="metrics-grid">
        <div className="metric-card income">
          <div className="metric-label">Pemasukan</div>
          <div className="metric-value green">{fmt(pemasukan)}</div>
          <div className="metric-trend">bulan ini</div>
        </div>
        <div className="metric-card expense">
          <div className="metric-label">Pengeluaran</div>
          <div className="metric-value red">{fmt(pengeluaran)}</div>
          <div className="metric-trend" style={{ color: diffPct !== null ? (diffPct > 0 ? "var(--red)" : "var(--green)") : "var(--text3)" }}>
            {diffPct !== null ? (diffPct > 0 ? `▲ ${diffPct}% vs bulan lalu` : `▼ ${Math.abs(diffPct)}% vs bulan lalu`) : "bulan ini"}
          </div>
        </div>
        <div className="metric-card saving">
          <div className="metric-label">Total Tabungan</div>
          <div className="metric-value blue">{fmt(totalTabungan)}</div>
          <div className="metric-trend">{savings.length} target aktif</div>
        </div>
      </div>

      {/* Insight banner */}
      {(topCat || diffPct !== null) && (
        <div className="mood-banner" style={{ background: mood.color + "14", border: `1.5px solid ${mood.color}28`, color: mood.color }}>
          {mood.msg}
          {topCat && <span style={{ marginLeft: 8, opacity: 0.8 }}>· Terbesar: {CATEGORY_ICONS[topCat.name]} {topCat.name} ({fmt(topCat.value)})</span>}
        </div>
      )}

      {/* Charts */}
      <div className="chart-row">
        <div className="card chart-main">
          <div className="card-title">Tren Pengeluaran</div>
          <ResponsiveContainer width="100%" height={150}>
            <AreaChart data={chartData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="label" tick={{ fill: "var(--text3)", fontSize: 11, fontWeight: 600 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "var(--text3)", fontSize: 10 }} axisLine={false} tickLine={false}
                tickFormatter={v => v >= 1000000 ? `${v / 1000000}jt` : v >= 1000 ? `${v / 1000}rb` : v} />
              <Tooltip formatter={v => fmt(v)} labelStyle={{ color: "var(--text)", fontWeight: 600 }}
                contentStyle={{ background: "var(--bg2)", border: "1.5px solid var(--border)", borderRadius: 12, fontSize: 12, fontWeight: 500 }} />
              <Area type="monotone" dataKey="total" stroke="#6366f1" strokeWidth={2.5} fill="url(#grad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {catData.length > 0 && (
          <div className="card chart-side">
            <div className="card-title">Kategori Bulan Ini</div>
            <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
              <ResponsiveContainer width={90} height={90}>
                <PieChart>
                  <Pie data={catData} cx="50%" cy="50%" innerRadius={24} outerRadius={44} dataKey="value" paddingAngle={3}>
                    {catData.map((entry, i) => <Cell key={i} fill={CATEGORY_COLORS[entry.name] || "#94a3b8"} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                {catData.map((c, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5 }}>
                    <div style={{ width: 7, height: 7, borderRadius: "50%", background: CATEGORY_COLORS[c.name] || "#94a3b8", flexShrink: 0 }} />
                    <span style={{ flex: 1, color: "var(--text2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>{c.name}</span>
                    <span style={{ color: "var(--text)", fontSize: 10.5, fontWeight: 700, fontFamily: "var(--mono)" }}>{fmt(c.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Recent Transactions */}
      <div className="card">
        <div className="section-header" style={{ marginBottom: 12 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>Transaksi Terbaru</div>
        </div>
        {recentTxns.length === 0 ? (
          <div className="empty-state">
            <div className="emoji">👀</div>
            <p>Belum ada transaksi</p>
            <p className="empty-sub">Yuk mulai catat keuanganmu!</p>
          </div>
        ) : (
          recentTxns.map(t => (
            <div key={t.id} className="txn-item">
              <div className="txn-icon" style={{ background: (CATEGORY_COLORS[t.category] || "#94a3b8") + "20" }}>
                {CATEGORY_ICONS[t.category] || "📌"}
              </div>
              <div className="txn-info">
                <div className="txn-name">{t.description}</div>
                <div className="txn-meta">{t.category} · {fmtDate(t.createdAt)} · {t.method || "—"}</div>
              </div>
              <div className={`txn-amt ${t.type === "income" ? "inc" : "out"}`}>
                {t.type === "income" ? "+" : "-"}{fmt(t.amount)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Transactions Page ────────────────────────────────────────────────────────
function Transactions({ transactions, onDelete, onEdit }) {
  const [filter, setFilter] = useState("semua");
  const cats = ["semua", "Makanan & Minuman", "Transportasi", "Tagihan & Utilitas", "Belanja", "Hiburan", "Pemasukan", "Lainnya"];

  const sorted = [...transactions].sort((a, b) => {
    const da = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
    const db2 = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
    return db2 - da;
  }).filter(t => filter === "semua" || t.category === filter);

  return (
    <div>
      <div className="tabs">
        {cats.map(c => (
          <button key={c} className={`tab-btn ${filter === c ? "active" : ""}`} onClick={() => setFilter(c)}>
            {c === "semua" ? "Semua" : c}
          </button>
        ))}
      </div>
      <div className="card">
        {sorted.length === 0 ? (
          <div className="empty-state">
            <div className="emoji">🔍</div>
            <p>Tidak ada transaksi</p>
            <p className="empty-sub">Coba pilih kategori lain</p>
          </div>
        ) : (
          sorted.map(t => (
            <div key={t.id} className="txn-item">
              <div className="txn-icon" style={{ background: (CATEGORY_COLORS[t.category] || "#94a3b8") + "20" }}>
                {CATEGORY_ICONS[t.category] || "📌"}
              </div>
              <div className="txn-info">
                <div className="txn-name">{t.description}</div>
                <div className="txn-meta">{t.category} · {fmtDate(t.createdAt)} · {t.method || "—"}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                <div className={`txn-amt ${t.type === "income" ? "inc" : "out"}`}>
                  {t.type === "income" ? "+" : "-"}{fmt(t.amount)}
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button className="action-link edit" onClick={() => onEdit(t)}>edit</button>
                  <button className="action-link delete" onClick={() => onDelete(t.id)}>hapus</button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Budget Page ──────────────────────────────────────────────────────────────
function Budget({ transactions, budgets, setBudgets, onOverspend }) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ category: "Makanan & Minuman", limit: "" });

  const now = new Date();
  const thisMonth = transactions.filter(t => {
    const d = t.createdAt?.toDate ? t.createdAt.toDate() : new Date(t.createdAt || 0);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear() && t.type === "expense";
  });

  const getSpent = (cat) => thisMonth.filter(t => t.category === cat).reduce((s, t) => s + t.amount, 0);

  const handleSave = () => {
    if (!form.limit) return;
    const existing = budgets.findIndex(b => b.category === form.category);
    if (existing >= 0) {
      const updated = [...budgets];
      updated[existing] = { ...updated[existing], limit: parseInt(form.limit) };
      setBudgets(updated);
    } else {
      setBudgets([...budgets, { category: form.category, limit: parseInt(form.limit) }]);
    }
    setShowAdd(false);
  };

  return (
    <div>
      <div className="section-header" style={{ marginBottom: 12 }}>
        <div className="section-title">Budget Bulanan</div>
        <button className="section-action" onClick={() => setShowAdd(true)}>+ Tambah</button>
      </div>
      <div className="card">
        {budgets.map(b => {
          const spent = getSpent(b.category);
          const pct = Math.min(100, Math.round((spent / b.limit) * 100));
          const over = spent > b.limit;
          if (over) onOverspend(b.category);
          return (
            <div key={b.category} className="budget-item">
              <div className="budget-header">
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span>{CATEGORY_ICONS[b.category]}</span>
                  <span className="budget-name">{b.category}</span>
                </div>
                <span className="budget-pct" style={{ color: over ? "var(--red)" : pct > 80 ? "var(--amber)" : "var(--text3)" }}>
                  {fmt(spent)} / {fmt(b.limit)}
                </span>
              </div>
              <div className="progress-wrap">
                <div className="progress-fill" style={{
                  width: `${pct}%`,
                  background: over ? "var(--red)" : pct > 80 ? "var(--amber)" : "var(--green)"
                }} />
              </div>
              {over && <div className="over-msg">Over {fmt(spent - b.limit)}! 💸</div>}
            </div>
          );
        })}
      </div>

      {showAdd && (
        <div className="overlay" onClick={() => setShowAdd(false)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-title">Set Budget</div>
            <div className="form-group">
              <label className="form-label">Kategori</label>
              <select className="form-select" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                {Object.keys(CATEGORY_ICONS).filter(c => !["Pemasukan", "Hutang", "Piutang"].includes(c)).map(c =>
                  <option key={c} value={c}>{c}</option>
                )}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Limit (Rp)</label>
              <input className="form-input" type="number" placeholder="500000" value={form.limit}
                onChange={e => setForm({ ...form, limit: e.target.value })}
                onKeyDown={e => e.key === "Enter" && handleSave()} />
            </div>
            <button className="btn-primary" onClick={handleSave}>Simpan</button>
            <button className="btn-ghost" onClick={() => setShowAdd(false)}>Batal</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Savings Page ─────────────────────────────────────────────────────────────
function Savings({ savings, setSavings }) {
  const [showAdd, setShowAdd] = useState(false);
  const [showDeposit, setShowDeposit] = useState(null);
  const [form, setForm] = useState({ name: "", icon: "🎯", target: "", current: "", deadline: "" });
  const [depositAmt, setDepositAmt] = useState("");

  const handleAdd = () => {
    if (!form.name || !form.target) return;
    setSavings([...savings, {
      id: Date.now().toString(),
      name: form.name, icon: form.icon,
      target: parseInt(form.target),
      current: parseInt(form.current || 0),
      deadline: form.deadline
    }]);
    setShowAdd(false);
    setForm({ name: "", icon: "🎯", target: "", current: "", deadline: "" });
  };

  const handleDeposit = (sv) => {
    const amt = parseInt(depositAmt);
    if (!amt) return;
    setSavings(savings.map(s => s.id === sv.id ? { ...s, current: (s.current || 0) + amt } : s));
    setShowDeposit(null); setDepositAmt("");
  };

  return (
    <div>
      <div className="section-header" style={{ marginBottom: 12 }}>
        <div className="section-title">Target Tabungan</div>
        <button className="section-action" onClick={() => setShowAdd(true)}>+ Tambah</button>
      </div>
      <div className="card">
        {savings.length === 0 ? (
          <div className="empty-state">
            <div className="emoji">🚀</div>
            <p>Belum ada target tabungan</p>
            <p className="empty-sub">Mulai set tujuan finansialmu!</p>
          </div>
        ) : savings.map(sv => {
          const pct = Math.min(100, Math.round(((sv.current || 0) / sv.target) * 100));
          const weekly = sv.deadline ? getWeeklySavingsTarget(sv.target, sv.current || 0, sv.deadline) : null;
          return (
            <div key={sv.id} className="saving-item">
              <div className="saving-icon">{sv.icon}</div>
              <div className="saving-info">
                <div className="saving-name">{sv.name}</div>
                <div className="saving-meta">
                  {fmt(sv.current || 0)} / {fmt(sv.target)}
                  {weekly && <span style={{ marginLeft: 6, color: "var(--accent)" }}>· {fmt(weekly.weeklyTarget)}/minggu</span>}
                </div>
                <div className="progress-wrap">
                  <div className="progress-fill" style={{ width: `${pct}%`, background: pct >= 100 ? "var(--green)" : "var(--accent)" }} />
                </div>
                {pct >= 100 && <div style={{ fontSize: 11.5, color: "var(--green)", marginTop: 4, fontWeight: 700 }}>🎉 Target tercapai!</div>}
                {weekly && pct < 100 && (
                  <div style={{ fontSize: 11.5, color: "var(--text3)", marginTop: 4, fontWeight: 500 }}>
                    {weekly.weeksLeft} minggu lagi · sisa {fmt(weekly.remaining)}
                  </div>
                )}
              </div>
              <button className="nabung-btn" onClick={() => setShowDeposit(sv)}>+ Nabung</button>
            </div>
          );
        })}
      </div>

      {showAdd && (
        <div className="overlay" onClick={() => setShowAdd(false)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-title">Target Baru</div>
            <div className="form-group">
              <label className="form-label">Icon</label>
              <input className="form-input" value={form.icon} onChange={e => setForm({ ...form, icon: e.target.value })} placeholder="🎯" maxLength={2} />
            </div>
            <div className="form-group">
              <label className="form-label">Nama</label>
              <input className="form-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="cth: Beli HP baru" />
            </div>
            <div className="form-group">
              <label className="form-label">Target (Rp)</label>
              <input className="form-input" type="number" value={form.target} onChange={e => setForm({ ...form, target: e.target.value })} placeholder="5000000" />
            </div>
            <div className="form-group">
              <label className="form-label">Sudah punya (Rp)</label>
              <input className="form-input" type="number" value={form.current} onChange={e => setForm({ ...form, current: e.target.value })} placeholder="0" />
            </div>
            <div className="form-group">
              <label className="form-label">Deadline</label>
              <input className="form-input" type="date" value={form.deadline} onChange={e => setForm({ ...form, deadline: e.target.value })} />
            </div>
            <button className="btn-primary" onClick={handleAdd}>Simpan</button>
            <button className="btn-ghost" onClick={() => setShowAdd(false)}>Batal</button>
          </div>
        </div>
      )}

      {showDeposit && (
        <div className="overlay" onClick={() => setShowDeposit(null)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-title">{showDeposit.icon} Setor ke {showDeposit.name}</div>
            <div className="form-group">
              <label className="form-label">Jumlah (Rp)</label>
              <input className="form-input" type="number" value={depositAmt} onChange={e => setDepositAmt(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleDeposit(showDeposit)}
                placeholder="100000" autoFocus />
            </div>
            <button className="btn-primary" onClick={() => handleDeposit(showDeposit)}>Simpan</button>
            <button className="btn-ghost" onClick={() => setShowDeposit(null)}>Batal</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Piutang Page ─────────────────────────────────────────────────────────────
function Piutang({ piutangs, setPiutangs }) {
  const [showAdd, setShowAdd] = useState(false);
  const [showBayar, setShowBayar] = useState(null);
  const [form, setForm] = useState({ name: "", amount: "", note: "", date: "" });
  const [bayarAmt, setBayarAmt] = useState("");

  const handleAdd = () => {
    if (!form.name || !form.amount) return;
    setPiutangs([...piutangs, {
      id: Date.now().toString(),
      name: form.name, total: parseInt(form.amount),
      sisa: parseInt(form.amount), note: form.note,
      date: form.date || new Date().toISOString().split("T")[0],
      history: []
    }]);
    setShowAdd(false);
    setForm({ name: "", amount: "", note: "", date: "" });
  };

  const handleBayar = (p) => {
    const amt = parseInt(bayarAmt);
    if (!amt) return;
    const newSisa = Math.max(0, p.sisa - amt);
    setPiutangs(piutangs.map(x => x.id === p.id ? {
      ...x, sisa: newSisa,
      history: [...(x.history || []), { amount: amt, date: new Date().toLocaleDateString("id-ID") }],
      lunas: newSisa === 0
    } : x));
    setShowBayar(null); setBayarAmt("");
  };

  const active = piutangs.filter(p => !p.lunas);
  const lunas = piutangs.filter(p => p.lunas);

  return (
    <div>
      <div className="section-header" style={{ marginBottom: 12 }}>
        <div className="section-title">Piutang</div>
        <button className="section-action" onClick={() => setShowAdd(true)}>+ Tambah</button>
      </div>

      {active.length === 0 && lunas.length === 0 && (
        <div className="card">
          <div className="empty-state">
            <div className="emoji">🤝</div>
            <p>Belum ada piutang</p>
            <p className="empty-sub">Catat siapa yang punya hutang ke kamu</p>
          </div>
        </div>
      )}

      {active.map(p => (
        <div key={p.id} className="debt-item">
          <div className="debt-header">
            <div>
              <div className="debt-name">{p.name}</div>
              <div className="debt-sisa">Pinjam {fmt(p.total)} · {p.date}</div>
              {p.note && <div className="debt-sisa">{p.note}</div>}
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="debt-amt">{fmt(p.sisa)}</div>
              <div className="debt-sisa">sisa</div>
            </div>
          </div>
          <div className="progress-wrap">
            <div className="progress-fill" style={{ width: `${Math.round(((p.total - p.sisa) / p.total) * 100)}%`, background: "var(--green)" }} />
          </div>
          {(p.history || []).length > 0 && (
            <div style={{ marginTop: 7, fontSize: 11.5, color: "var(--text3)", fontWeight: 500 }}>
              Cicilan: {p.history.map((h, i) => <span key={i}>{fmt(h.amount)} ({h.date}){i < p.history.length - 1 ? ", " : ""}</span>)}
            </div>
          )}
          <div className="debt-actions">
            <button className="debt-pay-btn" onClick={() => setShowBayar(p)}>+ Catat Bayar</button>
          </div>
        </div>
      ))}

      {lunas.length > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="card-title">Sudah Lunas 🎉</div>
          {lunas.map(p => (
            <div key={p.id} className="txn-item">
              <div className="txn-icon" style={{ background: "var(--green-dim)" }}>✅</div>
              <div className="txn-info">
                <div className="txn-name">{p.name}</div>
                <div className="txn-meta">{fmt(p.total)} · {p.date}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <div className="overlay" onClick={() => setShowAdd(false)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-title">Catat Piutang Baru</div>
            <div className="form-group">
              <label className="form-label">Nama Peminjam</label>
              <input className="form-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="cth: Budi" />
            </div>
            <div className="form-group">
              <label className="form-label">Jumlah (Rp)</label>
              <input className="form-input" type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="200000" />
            </div>
            <div className="form-group">
              <label className="form-label">Catatan</label>
              <input className="form-input" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="opsional" />
            </div>
            <div className="form-group">
              <label className="form-label">Tanggal</label>
              <input className="form-input" type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
            </div>
            <button className="btn-primary" onClick={handleAdd}>Simpan</button>
            <button className="btn-ghost" onClick={() => setShowAdd(false)}>Batal</button>
          </div>
        </div>
      )}

      {showBayar && (
        <div className="overlay" onClick={() => setShowBayar(null)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-title">Catat Bayar dari {showBayar.name}</div>
            <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 14, fontWeight: 500 }}>Sisa hutang: {fmt(showBayar.sisa)}</div>
            <div className="form-group">
              <label className="form-label">Jumlah Bayar (Rp)</label>
              <input className="form-input" type="number" value={bayarAmt} onChange={e => setBayarAmt(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleBayar(showBayar)}
                placeholder="100000" autoFocus />
            </div>
            <button className="btn-primary" onClick={() => handleBayar(showBayar)}>Simpan</button>
            <button className="btn-ghost" onClick={() => setShowBayar(null)}>Batal</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(undefined);
  const [page, setPage] = useState("dashboard");
  const [transactions, setTransactions] = useState([]);
  const [budgets, setBudgets] = useState(BUDGETS_DEFAULT);
  const [savings, setSavings] = useState([]);
  const [piutangs, setPiutangs] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingParsed, setPendingParsed] = useState(null);
  const [editingTxn, setEditingTxn] = useState(null);
  const [toast, setToast] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem("dompetku_theme") || "dark");
  const [overspentCats, setOverspentCats] = useState(new Set());
  const [streak, setStreak] = useState(0);
  const [saldoAwal, setSaldoAwal] = useState(0);
  const [showSaldoPopup, setShowSaldoPopup] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("dompetku_theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme(t => t === "dark" ? "light" : "dark");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => setUser(u));
    return unsub;
  }, []);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, `users/${user.uid}/transactions`), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, snap => {
      setTransactions(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const key = `dompetku_${user.uid}`;
    const s = localStorage.getItem(`${key}_savings`); if (s) setSavings(JSON.parse(s));
    const p = localStorage.getItem(`${key}_piutangs`); if (p) setPiutangs(JSON.parse(p));
    const b = localStorage.getItem(`${key}_budgets`); if (b) setBudgets(JSON.parse(b));
    const st = localStorage.getItem(`${key}_streak`); if (st) setStreak(parseInt(st));
    const sa = localStorage.getItem(`${key}_saldoAwal`); if (sa) setSaldoAwal(parseInt(sa));
  }, [user]);

  useEffect(() => { if (!user) return; localStorage.setItem(`dompetku_${user.uid}_savings`, JSON.stringify(savings)); }, [savings, user]);
  useEffect(() => { if (!user) return; localStorage.setItem(`dompetku_${user.uid}_piutangs`, JSON.stringify(piutangs)); }, [piutangs, user]);
  useEffect(() => { if (!user) return; localStorage.setItem(`dompetku_${user.uid}_budgets`, JSON.stringify(budgets)); }, [budgets, user]);

  const showToast = (msg) => setToast(msg);

  const handleOverspend = useCallback((cat) => {
    setOverspentCats(prev => {
      if (prev.has(cat)) return prev;
      const next = new Set(prev); next.add(cat);
      setTimeout(() => showToast(getFunnyOverspendMessage()), 100);
      return next;
    });
  }, []);

  const handleSubmit = async () => {
    if (!input.trim() || !user) return;
    setLoading(true);
    try {
      const parsed = await parseTransactionInput(input);
      if (!parsed.method) {
        setPendingParsed({ ...parsed, rawInput: input });
      } else {
        await saveTransaction(parsed);
      }
    } catch (e) {
      showToast("Gagal parse transaksi 😢");
    }
    setLoading(false);
    setInput("");
  };

  const saveTransaction = async (parsed) => {
    await addDoc(collection(db, `users/${user.uid}/transactions`), {
      description: parsed.description,
      amount: parsed.amount,
      category: parsed.category,
      type: parsed.type,
      method: parsed.method,
      createdAt: new Date()
    });
    const newStreak = streak + 1;
    setStreak(newStreak);
    localStorage.setItem(`dompetku_${user.uid}_streak`, newStreak);
    showToast(`✅ ${parsed.description} · ${fmt(parsed.amount)}`);
  };

  const handleMethodSelect = async (method) => {
    if (!pendingParsed) return;
    await saveTransaction({ ...pendingParsed, method });
    setPendingParsed(null);
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Hapus transaksi ini?")) return;
    await deleteDoc(doc(db, `users/${user.uid}/transactions`, id));
    showToast("🗑️ Transaksi dihapus");
  };

  const handleEdit = async (form) => {
    if (!editingTxn) return;
    await updateDoc(doc(db, `users/${user.uid}/transactions`, editingTxn.id), {
      description: form.description,
      amount: form.amount,
      category: form.category,
      type: form.type,
      method: form.method,
    });
    setEditingTxn(null);
    showToast("✏️ Transaksi diperbarui");
  };

  const handleSaldoSave = (val) => {
    setSaldoAwal(val);
    localStorage.setItem(`dompetku_${user?.uid}_saldoAwal`, val);
    setShowSaldoPopup(false);
    showToast(`💳 Saldo awal: ${fmt(val)}`);
  };

  const handleKeyDown = (e) => { if (e.key === "Enter") handleSubmit(); };

  const NAV = [
    {
      id: "dashboard", label: "Home",
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
    },
    {
      id: "transactions", label: "Transaksi",
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>
    },
    {
      id: "budget", label: "Budget",
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg>
    },
    {
      id: "savings", label: "Tabungan",
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a10 10 0 100 20A10 10 0 0012 2z" /><path d="M12 6v6l4 2" /></svg>
    },
    {
      id: "piutang", label: "Piutang",
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" /></svg>
    },
  ];

  if (user === undefined) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "var(--bg)" }}>
        <div className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} />
      </div>
    );
  }

  if (!user) return <LoginPage />;

  return (
    <div className="app">
      {toast && <Toast msg={toast} onDone={() => setToast(null)} />}
      {pendingParsed && <MethodPopup parsed={pendingParsed} onSelect={handleMethodSelect} onCancel={() => setPendingParsed(null)} />}
      {editingTxn && <EditPopup txn={editingTxn} onSave={handleEdit} onCancel={() => setEditingTxn(null)} />}
      {showSaldoPopup && <SaldoAwalPopup current={saldoAwal} onSave={handleSaldoSave} onCancel={() => setShowSaldoPopup(false)} />}

      {/* Sidebar (desktop) */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-icon">💰</span>
          <span className="brand-name">Dompetku</span>
        </div>
        {streak > 0 && <div className="streak-badge sidebar-streak">🔥 {streak} transaksi</div>}
        <nav className="sidebar-nav">
          {NAV.map(n => (
            <button key={n.id} className={`sidebar-item ${page === n.id ? "active" : ""}`} onClick={() => setPage(n.id)}>
              <span className="sidebar-icon">{n.icon}</span>
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button className="theme-btn" onClick={toggleTheme}>
            {theme === "dark" ? "☀️" : "🌙"} {theme === "dark" ? "Mode Terang" : "Mode Gelap"}
          </button>
          <button className="sidebar-item logout-btn" onClick={() => signOut(auth)}>
            <span className="sidebar-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
            </span>
            <span>Keluar</span>
          </button>
        </div>
      </aside>

      {/* Mobile header */}
      <header className="mobile-header">
        <div className="mobile-brand">
          <span>💰</span>
          <span>Dompetku</span>
          {streak > 0 && <span className="streak-badge">🔥 {streak}</span>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="icon-btn" onClick={toggleTheme}>{theme === "dark" ? "☀️" : "🌙"}</button>
          <button className="icon-btn" onClick={() => signOut(auth)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
          </button>
        </div>
      </header>

      {/* Main */}
      <main className="main-wrapper">
        <div className="main-content">
          <div className="quick-input-bar">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder='cth: "kopi 15rb cash" atau "gaji 5jt"'
              disabled={loading}
            />
            <button className="send-btn" onClick={handleSubmit} disabled={loading || !input.trim()}>
              {loading
                ? <div className="spinner" />
                : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
              }
            </button>
          </div>

          {page === "dashboard" && <Dashboard transactions={transactions} budgets={budgets} savings={savings} saldoAwal={saldoAwal} onSetSaldoAwal={() => setShowSaldoPopup(true)} />}
          {page === "transactions" && <Transactions transactions={transactions} onDelete={handleDelete} onEdit={setEditingTxn} />}
          {page === "budget" && <Budget transactions={transactions} budgets={budgets} setBudgets={setBudgets} onOverspend={handleOverspend} />}
          {page === "savings" && <Savings savings={savings} setSavings={setSavings} />}
          {page === "piutang" && <Piutang piutangs={piutangs} setPiutangs={setPiutangs} />}
        </div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="bottom-nav">
        {NAV.map(n => (
          <button key={n.id} className={`nav-item ${page === n.id ? "active" : ""}`} onClick={() => setPage(n.id)}>
            {n.icon}{n.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
