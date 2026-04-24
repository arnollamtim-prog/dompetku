import React, { useState, useEffect, useCallback } from "react";
import "./index.css";
import { db } from "./firebase";
import {
  collection, addDoc, getDocs, deleteDoc, doc, updateDoc, query, orderBy, onSnapshot
} from "firebase/firestore";
import { parseTransactionInput, getMoodMessage, getFunnyOverspendMessage, getWeeklySavingsTarget } from "./ai";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer
} from "recharts";

const fmt = (n) => {
  if (!n) return "Rp 0";
  if (Math.abs(n) >= 1000000) return `Rp ${(n/1000000).toFixed(1)}jt`;
  if (Math.abs(n) >= 1000) return `Rp ${(n/1000).toFixed(0)}rb`;
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
  "Makanan & Minuman": "#00d68f", "Transportasi": "#4d9fff", "Tagihan & Utilitas": "#ffb347",
  "Belanja": "#f472b6", "Kesehatan": "#34d399", "Pendidikan": "#a78bfa",
  "Hiburan": "#fb923c", "Tabungan": "#60a5fa", "Pemasukan": "#10b981",
  "Hutang": "#f87171", "Piutang": "#fbbf24", "Lainnya": "#94a3b8"
};

const BUDGETS_DEFAULT = [
  { category: "Makanan & Minuman", limit: 1500000 },
  { category: "Transportasi", limit: 500000 },
  { category: "Hiburan", limit: 300000 },
  { category: "Tagihan & Utilitas", limit: 800000 },
];

function Toast({ msg, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 2800); return () => clearTimeout(t); }, [onDone]);
  return <div className="toast">{msg}</div>;
}

function MethodPopup({ parsed, onSelect, onCancel }) {
  return (
    <div className="overlay" onClick={onCancel}>
      <div className="method-popup" onClick={e => e.stopPropagation()}>
        <div className="method-title">Bayar pakai apa?</div>
        <div className="method-subtitle">
          {CATEGORY_ICONS[parsed.category] || "📌"} {parsed.description} · {fmt(parsed.amount)}
        </div>
        <div className="method-buttons">
          <button className="method-btn" onClick={() => onSelect("cash")}>
            <span>💵</span>Cash
          </button>
          <button className="method-btn" onClick={() => onSelect("qris")}>
            <span>📱</span>QRIS
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- PAGES ----

function Dashboard({ transactions, budgets, savings, theme, setTheme }) {
  const now = new Date();
  const thisMonth = transactions.filter(t => {
    const d = t.createdAt?.toDate ? t.createdAt.toDate() : new Date(t.createdAt || Date.now());
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });

  const pemasukan = thisMonth.filter(t => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const pengeluaran = thisMonth.filter(t => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const saldo = pemasukan - pengeluaran;
  const totalTabungan = savings.reduce((s, sv) => s + (sv.current || 0), 0);
  const mood = getMoodMessage(saldo, pemasukan);

  // Chart data — last 6 months spending
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

  // Category breakdown
  const catData = Object.entries(
    thisMonth.filter(t => t.type === "expense").reduce((acc, t) => {
      acc[t.category] = (acc[t.category] || 0) + t.amount;
      return acc;
    }, {})
  ).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 5);

  const recentTxns = [...transactions].sort((a, b) => {
    const da = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
    const db2 = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
    return db2 - da;
  }).slice(0, 5);

  return (
    <div>
      {/* Mood banner */}
      <div className="mood-banner" style={{ background: mood.color + "22", border: `1px solid ${mood.color}44`, color: mood.color }}>
        {mood.msg}
      </div>

      {/* Metrics */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">Pemasukan</div>
          <div className="metric-value green">{fmt(pemasukan)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Pengeluaran</div>
          <div className="metric-value red">{fmt(pengeluaran)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Sisa bulan ini</div>
          <div className={`metric-value ${saldo >= 0 ? "blue" : "red"}`}>{fmt(saldo)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Total Tabungan</div>
          <div className="metric-value amber">{fmt(totalTabungan)}</div>
        </div>
      </div>

      {/* Area chart */}
      <div className="card">
        <div className="card-title">Tren Pengeluaran</div>
        <ResponsiveContainer width="100%" height={140}>
          <AreaChart data={chartData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="label" tick={{ fill: "var(--text3)", fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: "var(--text3)", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => v >= 1000000 ? `${v/1000000}jt` : v >= 1000 ? `${v/1000}rb` : v} />
            <Tooltip formatter={v => fmt(v)} labelStyle={{ color: "var(--text)" }} contentStyle={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
            <Area type="monotone" dataKey="total" stroke="#6366f1" strokeWidth={2} fill="url(#grad)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Category pie */}
      {catData.length > 0 && (
        <div className="card">
          <div className="card-title">Kategori Bulan Ini</div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <ResponsiveContainer width={120} height={120}>
              <PieChart>
                <Pie data={catData} cx="50%" cy="50%" innerRadius={30} outerRadius={55} dataKey="value" paddingAngle={2}>
                  {catData.map((entry, i) => (
                    <Cell key={i} fill={CATEGORY_COLORS[entry.name] || "#94a3b8"} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
              {catData.map((c, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: CATEGORY_COLORS[c.name] || "#94a3b8", flexShrink: 0 }} />
                  <span style={{ flex: 1, color: "var(--text2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                  <span className="mono" style={{ color: "var(--text)", fontSize: 11 }}>{fmt(c.value)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Recent transactions */}
      <div className="card">
        <div className="section-header">
          <div className="section-title">Transaksi Terbaru</div>
        </div>
        {recentTxns.length === 0 ? (
          <div className="empty-state"><div className="emoji">📭</div><p>Belum ada transaksi</p></div>
        ) : (
          recentTxns.map(t => (
            <div key={t.id} className="txn-item">
              <div className="txn-icon" style={{ background: (CATEGORY_COLORS[t.category] || "#94a3b8") + "22" }}>
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

function Transactions({ transactions, onDelete }) {
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
          <div className="empty-state"><div className="emoji">🔍</div><p>Tidak ada transaksi</p></div>
        ) : (
          sorted.map(t => (
            <div key={t.id} className="txn-item" style={{ position: "relative" }}>
              <div className="txn-icon" style={{ background: (CATEGORY_COLORS[t.category] || "#94a3b8") + "22" }}>
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
                <button onClick={() => onDelete(t.id)} style={{ background: "none", border: "none", color: "var(--text3)", cursor: "pointer", fontSize: 11, padding: 0 }}>hapus</button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

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
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
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
              {over && (
                <div style={{ fontSize: 11, color: "var(--red)", marginTop: 4, fontWeight: 600 }}>
                  Over {fmt(spent - b.limit)}! 💸
                </div>
              )}
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
                {Object.keys(CATEGORY_ICONS).filter(c => c !== "Pemasukan" && c !== "Hutang" && c !== "Piutang").map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Limit (Rp)</label>
              <input className="form-input" type="number" placeholder="500000" value={form.limit} onChange={e => setForm({ ...form, limit: e.target.value })} />
            </div>
            <button className="btn-primary" onClick={handleSave}>Simpan</button>
            <button className="btn-ghost" onClick={() => setShowAdd(false)}>Batal</button>
          </div>
        </div>
      )}
    </div>
  );
}

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
    setShowDeposit(null);
    setDepositAmt("");
  };

  return (
    <div>
      <div className="section-header" style={{ marginBottom: 12 }}>
        <div className="section-title">Target Tabungan</div>
        <button className="section-action" onClick={() => setShowAdd(true)}>+ Tambah</button>
      </div>
      <div className="card">
        {savings.length === 0 ? (
          <div className="empty-state"><div className="emoji">🏦</div><p>Belum ada target tabungan</p></div>
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
                  {weekly && <span style={{ marginLeft: 6, color: "var(--accent)" }}>· Target/minggu: {fmt(weekly.weeklyTarget)}</span>}
                </div>
                <div className="progress-wrap">
                  <div className="progress-fill" style={{ width: `${pct}%`, background: pct >= 100 ? "var(--green)" : "var(--accent)" }} />
                </div>
                {pct >= 100 && <div style={{ fontSize: 11, color: "var(--green)", marginTop: 3, fontWeight: 600 }}>🎉 Target tercapai!</div>}
                {weekly && pct < 100 && (
                  <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 3 }}>
                    {weekly.weeksLeft} minggu lagi · sisa {fmt(weekly.remaining)}
                  </div>
                )}
              </div>
              <button onClick={() => setShowDeposit(sv)} style={{ background: "var(--green-dim)", border: "1px solid var(--green)", borderRadius: 8, color: "var(--green)", padding: "6px 10px", cursor: "pointer", fontSize: 11, fontWeight: 700, flexShrink: 0 }}>+ Nabung</button>
            </div>
          );
        })}
      </div>

      {showAdd && (
        <div className="overlay" onClick={() => setShowAdd(false)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-title">Target Tabungan Baru</div>
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
              <input className="form-input" type="number" value={depositAmt} onChange={e => setDepositAmt(e.target.value)} placeholder="100000" autoFocus />
            </div>
            <button className="btn-primary" onClick={() => handleDeposit(showDeposit)}>Simpan</button>
            <button className="btn-ghost" onClick={() => setShowDeposit(null)}>Batal</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Piutang({ piutangs, setPiutangs }) {
  const [showAdd, setShowAdd] = useState(false);
  const [showBayar, setShowBayar] = useState(null);
  const [form, setForm] = useState({ name: "", amount: "", note: "", date: "" });
  const [bayarAmt, setBayarAmt] = useState("");

  const handleAdd = () => {
    if (!form.name || !form.amount) return;
    setPiutangs([...piutangs, {
      id: Date.now().toString(),
      name: form.name,
      total: parseInt(form.amount),
      sisa: parseInt(form.amount),
      note: form.note,
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
    setShowBayar(null);
    setBayarAmt("");
  };

  const active = piutangs.filter(p => !p.lunas);
  const lunas = piutangs.filter(p => p.lunas);

  return (
    <div>
      <div className="section-header" style={{ marginBottom: 12 }}>
        <div className="section-title">Piutang (Yang Minjem ke Kamu)</div>
        <button className="section-action" onClick={() => setShowAdd(true)}>+ Tambah</button>
      </div>

      {active.length === 0 && lunas.length === 0 && (
        <div className="card"><div className="empty-state"><div className="emoji">🤝</div><p>Belum ada piutang</p></div></div>
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
            <div style={{ marginTop: 6, fontSize: 11, color: "var(--text3)" }}>
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
            <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 12 }}>Sisa hutang: {fmt(showBayar.sisa)}</div>
            <div className="form-group">
              <label className="form-label">Jumlah Bayar (Rp)</label>
              <input className="form-input" type="number" value={bayarAmt} onChange={e => setBayarAmt(e.target.value)} placeholder="100000" autoFocus />
            </div>
            <button className="btn-primary" onClick={() => handleBayar(showBayar)}>Simpan</button>
            <button className="btn-ghost" onClick={() => setShowBayar(null)}>Batal</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- MAIN APP ----
export default function App() {
  const [page, setPage] = useState("dashboard");
  const [transactions, setTransactions] = useState([]);
  const [budgets, setBudgets] = useState(BUDGETS_DEFAULT);
  const [savings, setSavings] = useState([]);
  const [piutangs, setPiutangs] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingParsed, setPendingParsed] = useState(null);
  const [toast, setToast] = useState(null);
  const [theme, setTheme] = useState("dark");
  const [overspentCats, setOverspentCats] = useState(new Set());
  const [streak, setStreak] = useState(0);

  // Theme
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const apply = (e) => document.documentElement.setAttribute("data-theme", e.matches ? "light" : "dark");
    apply(mq);
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Load from Firebase
  useEffect(() => {
    const q = query(collection(db, "transactions"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, snap => {
      setTransactions(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, []);

  // Load savings & piutang from localStorage as fallback
  useEffect(() => {
    const s = localStorage.getItem("dompetku_savings");
    if (s) setSavings(JSON.parse(s));
    const p = localStorage.getItem("dompetku_piutangs");
    if (p) setPiutangs(JSON.parse(p));
    const b = localStorage.getItem("dompetku_budgets");
    if (b) setBudgets(JSON.parse(b));
    const st = localStorage.getItem("dompetku_streak");
    if (st) setStreak(parseInt(st));
  }, []);

  useEffect(() => { localStorage.setItem("dompetku_savings", JSON.stringify(savings)); }, [savings]);
  useEffect(() => { localStorage.setItem("dompetku_piutangs", JSON.stringify(piutangs)); }, [piutangs]);
  useEffect(() => { localStorage.setItem("dompetku_budgets", JSON.stringify(budgets)); }, [budgets]);

  const showToast = (msg) => { setToast(msg); };

  const handleOverspend = useCallback((cat) => {
    setOverspentCats(prev => {
      if (prev.has(cat)) return prev;
      const next = new Set(prev);
      next.add(cat);
      setTimeout(() => showToast(getFunnyOverspendMessage()), 100);
      return next;
    });
  }, []);

  const handleSubmit = async () => {
    if (!input.trim()) return;
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
    await addDoc(collection(db, "transactions"), {
      description: parsed.description,
      amount: parsed.amount,
      category: parsed.category,
      type: parsed.type,
      method: parsed.method,
      createdAt: new Date()
    });
    setStreak(s => {
      const newS = s + 1;
      localStorage.setItem("dompetku_streak", newS);
      return newS;
    });
    showToast(`✅ ${parsed.description} · ${fmt(parsed.amount)}`);
  };

  const handleMethodSelect = async (method) => {
    if (!pendingParsed) return;
    await saveTransaction({ ...pendingParsed, method });
    setPendingParsed(null);
  };

  const handleDelete = async (id) => {
    await deleteDoc(doc(db, "transactions", id));
    showToast("🗑️ Transaksi dihapus");
  };

  const handleKeyDown = (e) => { if (e.key === "Enter") handleSubmit(); };

  const NAV = [
    { id: "dashboard", label: "Home", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg> },
    { id: "transactions", label: "Transaksi", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg> },
    { id: "budget", label: "Budget", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg> },
    { id: "savings", label: "Tabungan", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a10 10 0 100 20A10 10 0 0012 2z"/><path d="M12 6v6l4 2"/></svg> },
    { id: "piutang", label: "Piutang", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg> },
  ];

  return (
    <div className="app">
      {toast && <Toast msg={toast} onDone={() => setToast(null)} />}
      {pendingParsed && <MethodPopup parsed={pendingParsed} onSelect={handleMethodSelect} onCancel={() => setPendingParsed(null)} />}

      <div className="app-header">
        <div>
          <div className="app-title">💰 Dompetku</div>
          {streak > 0 && <div className="streak-badge">🔥 {streak} transaksi</div>}
        </div>
      </div>

      <div className="main-content">
        {/* Quick input */}
        <div className="quick-input-bar">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder='cth: "kopi 15rb cash" atau "gaji 5jt"'
            disabled={loading}
          />
          <button className="send-btn" onClick={handleSubmit} disabled={loading || !input.trim()}>
            {loading ? <div className="spinner" /> : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>}
          </button>
        </div>

        {page === "dashboard" && <Dashboard transactions={transactions} budgets={budgets} savings={savings} theme={theme} setTheme={setTheme} />}
        {page === "transactions" && <Transactions transactions={transactions} onDelete={handleDelete} />}
        {page === "budget" && <Budget transactions={transactions} budgets={budgets} setBudgets={setBudgets} onOverspend={handleOverspend} />}
        {page === "savings" && <Savings savings={savings} setSavings={setSavings} />}
        {page === "piutang" && <Piutang piutangs={piutangs} setPiutangs={setPiutangs} />}
      </div>

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
