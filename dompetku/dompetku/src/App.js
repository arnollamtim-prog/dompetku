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

const fmtLong = (n) => {
  if (!n) return "Rp 0";
  return `Rp ${n.toLocaleString("id")}`;
};

const fmtDate = (ts) => {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
};

const CATEGORY_ICONS = {
  "Makanan & Minuman": "🍜", "Transportasi": "🚗", "Tagihan & Utilitas": "⚡",
  "Belanja": "🛍️", "Kesehatan": "💊", "Pendidikan": "📚",
  "Hiburan": "🎬", "Tabungan": "🏦", "Pemasukan": "💰",
  "Hutang": "😰", "Piutang": "🤝", "Lainnya": "📌"
};

const CATEGORY_COLORS = {
  "Makanan & Minuman": "#22c55e", "Transportasi": "#3b82f6", "Tagihan & Utilitas": "#f59e0b",
  "Belanja": "#ec4899", "Kesehatan": "#34d399", "Pendidikan": "#8b5cf6",
  "Hiburan": "#f97316", "Tabungan": "#60a5fa", "Pemasukan": "#22c55e",
  "Hutang": "#ef4444", "Piutang": "#fbbf24", "Lainnya": "#94a3b8"
};

const BUDGETS_DEFAULT = [
  { category: "Makanan & Minuman", limit: 1500000 },
  { category: "Transportasi", limit: 500000 },
  { category: "Hiburan", limit: 300000 },
  { category: "Tagihan & Utilitas", limit: 800000 },
];

const DEFAULT_ACCOUNTS = [
  { id: "bca", name: "BCA", icon: "🏦", balance: 0, color: "#3b82f6" },
  { id: "bank-lampung", name: "Bank Lampung", icon: "🏛️", balance: 0, color: "#8b5cf6" },
  { id: "cash", name: "Cash", icon: "💵", balance: 0, color: "#22c55e" },
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

// ─── Account Picker Popup ─────────────────────────────────────────────────────
function AccountPickerPopup({ method, parsed, accounts, onSelect, onCancel }) {
  return (
    <div className="overlay" onClick={onCancel}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-title">Dari rekening mana?</div>
        <div className="method-subtitle">
          {CATEGORY_ICONS[parsed.category] || "📌"} {parsed.description} · {fmt(parsed.amount)} · {method === "qris" ? "📱 QRIS" : "🏦 Transfer"}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {accounts.map(acc => (
            <button
              key={acc.id}
              onClick={() => onSelect(acc.id)}
              style={{
                display: "flex", alignItems: "center", gap: 14,
                padding: "14px 16px", background: "var(--bg3)",
                border: "1.5px solid var(--border)", borderRadius: "var(--radius)",
                cursor: "pointer", transition: "all 0.18s", textAlign: "left",
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.background = "var(--sidebar-active-bg)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--bg3)"; }}
            >
              <div style={{ width: 40, height: 40, borderRadius: 10, background: acc.color + "20", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>{acc.icon}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.2px" }}>{acc.name}</div>
                <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2, fontWeight: 500 }}>Saldo: {fmtLong(acc.balance)}</div>
              </div>
              <div style={{ fontSize: 18, color: "var(--text3)" }}>›</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Edit Txn Popup ───────────────────────────────────────────────────────────
function EditPopup({ txn, onSave, onCancel }) {
  const [form, setForm] = useState({
    description: txn.description, amount: txn.amount,
    category: txn.category, type: txn.type, method: txn.method || "cash",
  });
  return (
    <div className="overlay" onClick={onCancel}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-title">Edit Transaksi</div>
        <div className="form-group"><label className="form-label">Deskripsi</label><input className="form-input" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
        <div className="form-group"><label className="form-label">Jumlah (Rp)</label><input className="form-input" type="number" value={form.amount} onChange={e => setForm({ ...form, amount: parseInt(e.target.value) || 0 })} /></div>
        <div className="form-group"><label className="form-label">Kategori</label>
          <select className="form-select" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
            {Object.keys(CATEGORY_ICONS).map(c => <option key={c} value={c}>{CATEGORY_ICONS[c]} {c}</option>)}
          </select>
        </div>
        <div className="form-group"><label className="form-label">Tipe</label>
          <select className="form-select" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
            <option value="expense">Pengeluaran</option>
            <option value="income">Pemasukan</option>
          </select>
        </div>
        <div className="form-group"><label className="form-label">Metode</label>
          <select className="form-select" value={form.method} onChange={e => setForm({ ...form, method: e.target.value })}>
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
        <p style={{ fontSize: 13, color: "var(--text2)", marginBottom: 18, fontWeight: 500, lineHeight: 1.5 }}>Masukkan saldo dompet/rekening kamu sebagai titik awal perhitungan.</p>
        <div className="form-group"><label className="form-label">Saldo (Rp)</label>
          <input className="form-input" type="number" placeholder="1000000" value={val}
            onChange={e => setVal(e.target.value)} onKeyDown={e => e.key === "Enter" && onSave(parseInt(val) || 0)} autoFocus />
        </div>
        <button className="btn-primary" onClick={() => onSave(parseInt(val) || 0)}>Simpan</button>
        <button className="btn-ghost" onClick={onCancel}>Batal</button>
      </div>
    </div>
  );
}

// ─── Manage Accounts Popup ────────────────────────────────────────────────────
function ManageAccountsPopup({ accounts, onSave, onCancel }) {
  const [accs, setAccs] = useState(accounts.map(a => ({ ...a })));
  const [showAdd, setShowAdd] = useState(false);
  const [newAcc, setNewAcc] = useState({ name: "", icon: "🏦", balance: "", color: "#6366f1" });

  const handleBalanceChange = (id, val) => setAccs(accs.map(a => a.id === id ? { ...a, balance: parseInt(val) || 0 } : a));
  const handleAdd = () => {
    if (!newAcc.name) return;
    setAccs([...accs, { id: Date.now().toString(), name: newAcc.name, icon: newAcc.icon || "🏦", balance: parseInt(newAcc.balance) || 0, color: newAcc.color || "#6366f1" }]);
    setNewAcc({ name: "", icon: "🏦", balance: "", color: "#6366f1" }); setShowAdd(false);
  };
  const handleDelete = (id) => setAccs(accs.filter(a => a.id !== id));

  return (
    <div className="overlay" onClick={onCancel}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-title">Kelola Rekening</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
          {accs.map(acc => (
            <div key={acc.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "var(--bg3)", border: "1.5px solid var(--border)", borderRadius: "var(--radius)" }}>
              <div style={{ width: 36, height: 36, borderRadius: 9, background: acc.color + "20", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>{acc.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>{acc.name}</div>
                <input type="number" className="form-input" style={{ padding: "7px 10px", fontSize: 13 }} placeholder="Saldo awal" value={acc.balance || ""} onChange={e => handleBalanceChange(acc.id, e.target.value)} />
              </div>
              {!["bca", "bank-lampung", "cash"].includes(acc.id) && (
                <button onClick={() => handleDelete(acc.id)} style={{ background: "none", border: "none", color: "var(--text3)", fontSize: 18, cursor: "pointer", padding: 4 }}>×</button>
              )}
            </div>
          ))}
        </div>
        {showAdd ? (
          <div style={{ padding: "14px", background: "var(--bg3)", border: "1.5px solid var(--border)", borderRadius: "var(--radius)", marginBottom: 12 }}>
            <div className="form-group"><label className="form-label">Icon</label><input className="form-input" value={newAcc.icon} maxLength={2} onChange={e => setNewAcc({ ...newAcc, icon: e.target.value })} placeholder="🏦" /></div>
            <div className="form-group"><label className="form-label">Nama Rekening</label><input className="form-input" value={newAcc.name} onChange={e => setNewAcc({ ...newAcc, name: e.target.value })} placeholder="cth: Mandiri, GoPay" /></div>
            <div className="form-group"><label className="form-label">Saldo Awal (Rp)</label><input className="form-input" type="number" value={newAcc.balance} onChange={e => setNewAcc({ ...newAcc, balance: e.target.value })} placeholder="0" /></div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn-primary" style={{ marginTop: 0, flex: 1 }} onClick={handleAdd}>Tambah</button>
              <button className="btn-ghost" style={{ marginTop: 0, flex: 1 }} onClick={() => setShowAdd(false)}>Batal</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowAdd(true)} style={{ width: "100%", padding: "11px", background: "none", border: "1.5px dashed var(--border)", borderRadius: "var(--radius)", color: "var(--accent)", fontSize: 13.5, fontWeight: 700, cursor: "pointer", marginBottom: 12 }}>+ Tambah Rekening</button>
        )}
        <button className="btn-primary" onClick={() => onSave(accs)}>Simpan</button>
        <button className="btn-ghost" onClick={onCancel}>Batal</button>
      </div>
    </div>
  );
}

// ─── Assets Popup ─────────────────────────────────────────────────────────────
function AssetsPopup({ assets, onSave, onCancel }) {
  const [items, setItems] = useState(assets.map(a => ({ ...a })));
  const [showAdd, setShowAdd] = useState(false);
  const [newItem, setNewItem] = useState({ name: "", icon: "💍", value: "" });

  const handleAdd = () => {
    if (!newItem.name || !newItem.value) return;
    setItems([...items, { id: Date.now().toString(), name: newItem.name, icon: newItem.icon || "💍", value: parseInt(newItem.value) || 0 }]);
    setNewItem({ name: "", icon: "💍", value: "" }); setShowAdd(false);
  };

  return (
    <div className="overlay" onClick={onCancel}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-title">Aset Saya</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
          {items.length === 0 && <div style={{ textAlign: "center", color: "var(--text3)", fontSize: 13, padding: "20px 0" }}>Belum ada aset tercatat</div>}
          {items.map(item => (
            <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: "var(--bg3)", border: "1.5px solid var(--border)", borderRadius: "var(--radius)" }}>
              <span style={{ fontSize: 22 }}>{item.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)" }}>{item.name}</div>
                <div style={{ fontSize: 12, color: "var(--amber)", fontWeight: 700, marginTop: 2 }}>{fmtLong(item.value)}</div>
              </div>
              <button onClick={() => setItems(items.filter(i => i.id !== item.id))} style={{ background: "none", border: "none", color: "var(--text3)", fontSize: 18, cursor: "pointer" }}>×</button>
            </div>
          ))}
        </div>
        {showAdd ? (
          <div style={{ padding: 14, background: "var(--bg3)", border: "1.5px solid var(--border)", borderRadius: "var(--radius)", marginBottom: 12 }}>
            <div className="form-group"><label className="form-label">Icon</label><input className="form-input" value={newItem.icon} maxLength={2} onChange={e => setNewItem({ ...newItem, icon: e.target.value })} placeholder="💍" /></div>
            <div className="form-group"><label className="form-label">Nama Aset</label><input className="form-input" value={newItem.name} onChange={e => setNewItem({ ...newItem, name: e.target.value })} placeholder="cth: Cincin Emas, Gelang" /></div>
            <div className="form-group"><label className="form-label">Estimasi Nilai (Rp)</label><input className="form-input" type="number" value={newItem.value} onChange={e => setNewItem({ ...newItem, value: e.target.value })} placeholder="5000000" /></div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn-primary" style={{ marginTop: 0, flex: 1 }} onClick={handleAdd}>Tambah</button>
              <button className="btn-ghost" style={{ marginTop: 0, flex: 1 }} onClick={() => setShowAdd(false)}>Batal</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowAdd(true)} style={{ width: "100%", padding: "11px", background: "none", border: "1.5px dashed var(--border)", borderRadius: "var(--radius)", color: "var(--accent)", fontSize: 13.5, fontWeight: 700, cursor: "pointer", marginBottom: 12 }}>+ Tambah Aset</button>
        )}
        <button className="btn-primary" onClick={() => onSave(items)}>Simpan</button>
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
        "auth/invalid-email": "Email tidak valid", "auth/wrong-password": "Password salah",
        "auth/user-not-found": "Akun tidak ditemukan", "auth/email-already-in-use": "Email sudah terdaftar",
        "auth/weak-password": "Password minimal 6 karakter", "auth/invalid-credential": "Email atau password salah",
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
        <p className="login-sub">Kelola keuanganmu dengan lebih bijak</p>
        <div className="login-tabs">
          <button className={`login-tab ${mode === "login" ? "active" : ""}`} onClick={() => { setMode("login"); setError(""); }}>Masuk</button>
          <button className={`login-tab ${mode === "register" ? "active" : ""}`} onClick={() => { setMode("register"); setError(""); }}>Daftar</button>
        </div>
        <div className="form-group"><label className="form-label">Email</label><input className="form-input" type="email" placeholder="nama@email.com" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && handle()} /></div>
        <div className="form-group"><label className="form-label">Password</label><input className="form-input" type="password" placeholder="••••••" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handle()} /></div>
        {error && <div className="login-error">⚠️ {error}</div>}
        <button className="btn-primary" onClick={handle} disabled={loading}>{loading ? "Memproses..." : mode === "login" ? "Masuk" : "Buat Akun"}</button>
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard({ transactions, budgets, savings, saldoAwal, onSetSaldoAwal, onAddTxn,
  piutangs, includePiutang, onTogglePiutang, accounts, assets, onManageAccounts, onManageAssets }) {
  const now = new Date();

  const thisMonth = transactions.filter(t => {
    const d = t.createdAt?.toDate ? t.createdAt.toDate() : new Date(t.createdAt || Date.now());
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });

  const pemasukan = thisMonth.filter(t => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const pengeluaran = thisMonth.filter(t => t.type === "expense").reduce((s, t) => s + t.amount, 0);

  const totalPiutangAktif = piutangs.filter(p => !p.lunas).reduce((s, p) => s + p.sisa, 0);

  // ── Saldo Saat Ini = total rekening + aset + (opsional piutang) ──
  const totalRekening = accounts.reduce((s, a) => s + (a.balance || 0), 0);
  const totalAsetBenda = assets.reduce((s, a) => s + (a.value || 0), 0);
  const saldo = totalRekening + totalAsetBenda + (includePiutang ? totalPiutangAktif : 0);

  const totalTabungan = savings.reduce((s, sv) => s + (sv.current || 0), 0);

  const lastMonthTxns = transactions.filter(t => {
    const d = t.createdAt?.toDate ? t.createdAt.toDate() : new Date(t.createdAt || 0);
    const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return d.getMonth() === lm.getMonth() && d.getFullYear() === lm.getFullYear();
  });
  const lastMonthExp = lastMonthTxns.filter(t => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const lastMonthInc = lastMonthTxns.filter(t => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const diffPctExp = lastMonthExp > 0 ? Math.round(((pengeluaran - lastMonthExp) / lastMonthExp) * 100) : null;
  const diffPctInc = lastMonthInc > 0 ? Math.round(((pemasukan - lastMonthInc) / lastMonthInc) * 100) : null;

  const chartData = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1);
    const label = d.toLocaleDateString("id-ID", { month: "short" });
    const total = transactions.filter(t => {
      const td = t.createdAt?.toDate ? t.createdAt.toDate() : new Date(t.createdAt || 0);
      return td.getMonth() === d.getMonth() && td.getFullYear() === d.getFullYear() && t.type === "expense";
    }).reduce((s, t) => s + t.amount, 0);
    return { label, total };
  });

  const highestMonth = [...chartData].sort((a, b) => b.total - a.total)[0];

  const catData = Object.entries(
    thisMonth.filter(t => t.type === "expense").reduce((acc, t) => {
      acc[t.category] = (acc[t.category] || 0) + t.amount; return acc;
    }, {})
  ).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 5);
  const topCat = catData[0];

  const recentTxns = [...transactions].sort((a, b) => {
    const da = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
    const db2 = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
    return db2 - da;
  }).slice(0, 5);

  const insights = [];
  if (diffPctExp !== null) {
    if (diffPctExp > 0) insights.push({ icon: "📈", iconClass: "up", label: `Pengeluaran naik ${diffPctExp}%`, sub: "Dibanding bulan lalu" });
    else insights.push({ icon: "📉", iconClass: "star", label: `Pengeluaran turun ${Math.abs(diffPctExp)}%`, sub: "Dibanding bulan lalu" });
  }
  if (pemasukan > pengeluaran) insights.push({ icon: "✨", iconClass: "star", label: "Kamu lebih hemat", sub: `Surplus ${fmt(pemasukan - pengeluaran)} bulan ini 😊` });
  else if (pengeluaran > pemasukan && pemasukan > 0) insights.push({ icon: "⚠️", iconClass: "up", label: "Pengeluaran melebihi pemasukan", sub: `Defisit ${fmt(pengeluaran - pemasukan)}` });
  if (topCat) insights.push({ icon: CATEGORY_ICONS[topCat.name] || "📌", iconClass: "star", label: `Terbesar: ${topCat.name}`, sub: fmt(topCat.value) });
  if (includePiutang && totalPiutangAktif > 0) insights.push({ icon: "🤝", iconClass: "star", label: `Piutang aktif: ${fmt(totalPiutangAktif)}`, sub: "Include dalam saldo" });
  const shownInsights = insights.slice(0, 2);

  return (
    <div>
      {/* ── Hero + Insight ── */}
      <div className="dashboard-top-row">
        <div className="hero-card">
          <div className="hero-wallet-illustration">💳</div>
          <div className="hero-top">
            <div className="hero-label"><div className="hero-label-icon">ℹ️</div>Saldo saat ini</div>
            <div className={`hero-amount ${saldo < 0 ? "negative" : ""}`}>{fmtLong(saldo)}</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", marginBottom: 4, fontWeight: 500 }}>
              rekening {fmt(totalRekening)} · aset {fmt(totalAsetBenda)}{includePiutang && totalPiutangAktif > 0 ? ` · piutang ${fmt(totalPiutangAktif)}` : ""}
            </div>
          </div>
          <div style={{ position: "relative", zIndex: 1, marginTop: 12 }}>
            <div onClick={e => { e.stopPropagation(); onTogglePiutang(); }} style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 99, padding: "6px 12px", cursor: "pointer" }}>
              <div style={{ width: 30, height: 17, background: includePiutang ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.18)", borderRadius: 99, position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
                <div style={{ position: "absolute", top: 2, left: includePiutang ? 15 : 2, width: 13, height: 13, background: "#fff", borderRadius: "50%", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.25)" }} />
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.85)" }}>{includePiutang ? "Saldo + Piutang" : "Saldo Murni"}</span>
            </div>
          </div>
          <div className="hero-bottom">
            <button className="hero-ringkasan-btn" onClick={e => { e.stopPropagation(); onSetSaldoAwal(); }}>Set Saldo Awal →</button>
            <div className="hero-date">{now.toLocaleDateString("id-ID", { month: "long", year: "numeric" })}</div>
          </div>
        </div>

        <div className="insight-card">
          <div className="insight-header"><span className="insight-title">Insight untuk kamu ✦</span><span className="insight-plus">+</span></div>
          <div className="insight-items">
            {shownInsights.length === 0 ? (
              <div style={{ color: "var(--text3)", fontSize: 13, fontWeight: 500, padding: "8px 0" }}>Catat transaksi untuk melihat insight 👀</div>
            ) : shownInsights.map((ins, i) => (
              <div key={i} className="insight-item">
                <div className={`insight-icon ${ins.iconClass}`}>{ins.icon}</div>
                <div className="insight-text"><div className="insight-label">{ins.label}</div><div className="insight-sub">{ins.sub}</div></div>
              </div>
            ))}
          </div>
          <button className="insight-see-all"><span>Lihat semua insight</span><span>›</span></button>
        </div>
      </div>

      {/* ── Rekening & Aset (tanpa Total Kekayaan) ── */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.3px" }}>Rekening & Aset</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onManageAccounts} style={{ background: "none", border: "1.5px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--accent)", fontSize: 12, fontWeight: 700, padding: "5px 12px", cursor: "pointer" }}>⚙️ Rekening</button>
            <button onClick={onManageAssets} style={{ background: "none", border: "1.5px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--amber)", fontSize: 12, fontWeight: 700, padding: "5px 12px", cursor: "pointer" }}>💍 Aset</button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4 }}>
          {accounts.map(acc => (
            <div key={acc.id} style={{ background: "var(--bg2)", border: "1.5px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "14px 16px", minWidth: 130, flexShrink: 0, boxShadow: "var(--card-shadow)" }}>
              <div style={{ fontSize: 20, marginBottom: 8 }}>{acc.icon}</div>
              <div style={{ fontSize: 11.5, color: "var(--text3)", fontWeight: 600, marginBottom: 4 }}>{acc.name}</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.4px" }}>{fmt(acc.balance)}</div>
            </div>
          ))}
          {assets.map(asset => (
            <div key={asset.id} style={{ background: "var(--bg2)", border: "1.5px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "14px 16px", minWidth: 130, flexShrink: 0, boxShadow: "var(--card-shadow)" }}>
              <div style={{ fontSize: 20, marginBottom: 8 }}>{asset.icon}</div>
              <div style={{ fontSize: 11.5, color: "var(--text3)", fontWeight: 600, marginBottom: 4 }}>{asset.name}</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: "var(--amber)", letterSpacing: "-0.4px" }}>{fmt(asset.value)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 4 Metric Cards ── */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-icon-wrap green">↓</div>
          <div className="metric-label">Pemasukan</div>
          <div className="metric-value green">{fmt(pemasukan)}</div>
          <div className={`metric-trend ${diffPctInc !== null ? (diffPctInc >= 0 ? "positive" : "negative") : ""}`}>{diffPctInc !== null ? `${diffPctInc >= 0 ? "↑" : "↓"} ${Math.abs(diffPctInc)}% dari bulan lalu` : "bulan ini"}</div>
        </div>
        <div className="metric-card">
          <div className="metric-icon-wrap red">↑</div>
          <div className="metric-label">Pengeluaran</div>
          <div className="metric-value red">{fmt(pengeluaran)}</div>
          <div className={`metric-trend ${diffPctExp !== null ? (diffPctExp > 0 ? "negative" : "positive") : ""}`}>{diffPctExp !== null ? `${diffPctExp > 0 ? "↑" : "↓"} ${Math.abs(diffPctExp)}% dari bulan lalu` : "bulan ini"}</div>
        </div>
        <div className="metric-card">
          <div className="metric-icon-wrap blue">💳</div>
          <div className="metric-label">Saldo Saat Ini</div>
          <div className="metric-value blue">{fmt(saldo)}</div>
          <div className="metric-trend">rekening + aset{includePiutang ? " + piutang" : ""}</div>
        </div>
        <div className="metric-card">
          <div className="metric-icon-wrap purple">🏦</div>
          <div className="metric-label">Total Tabungan</div>
          <div className="metric-value purple">{fmt(totalTabungan)}</div>
          <div className="metric-trend">{savings.length > 0 ? `${savings.length} target aktif` : "belum ada target"}</div>
        </div>
      </div>

      {/* ── Chart + Recent ── */}
      <div className="chart-txn-row">
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="card-header-row"><div className="card-title">Tren Pengeluaran</div><div className="card-dropdown">6 Bulan Terakhir ▾</div></div>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={chartData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="gradFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="label" tick={{ fill: "var(--text3)", fontSize: 11, fontWeight: 600 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "var(--text3)", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => v >= 1000000 ? `${v / 1000000}jt` : v >= 1000 ? `${v / 1000}rb` : v} />
              <Tooltip formatter={v => [fmt(v), "Pengeluaran"]} labelStyle={{ color: "var(--text)", fontWeight: 700, fontSize: 12 }} contentStyle={{ background: "var(--bg2)", border: "1.5px solid var(--border)", borderRadius: 12, fontSize: 12, fontWeight: 600 }} />
              <Area type="monotone" dataKey="total" stroke="#6366f1" strokeWidth={2.5} fill="url(#gradFill)" dot={false} activeDot={{ r: 5, fill: "#6366f1", strokeWidth: 0 }} />
            </AreaChart>
          </ResponsiveContainer>
          {highestMonth && highestMonth.total > 0 && (
            <div className="chart-footer-stat">
              <div className="chart-footer-label"><div className="chart-footer-icon">↑</div><div><div className="chart-footer-text">Pengeluaran tertinggi</div><div className="chart-footer-sub">{highestMonth.label}</div></div></div>
              <div className="chart-footer-value">{fmt(highestMonth.total)}</div>
            </div>
          )}
        </div>
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="card-header-row"><div className="card-title">Transaksi Terbaru</div><button className="card-action-link">Lihat semua</button></div>
          {recentTxns.length === 0 ? (
            <div className="empty-state"><div className="emoji">👀</div><p>Belum ada transaksi</p><p className="empty-sub">Yuk mulai catat keuanganmu!</p></div>
          ) : recentTxns.map(t => (
            <div key={t.id} className="txn-item">
              <div className="txn-icon" style={{ background: (CATEGORY_COLORS[t.category] || "#94a3b8") + "20" }}>{CATEGORY_ICONS[t.category] || "📌"}</div>
              <div className="txn-info"><div className="txn-name">{t.description}</div><div className="txn-meta">{fmtDate(t.createdAt)} · {t.method || "—"}</div></div>
              <div className={`txn-amt ${t.type === "income" ? "inc" : "out"}`}>{t.type === "income" ? "+" : "−"}{fmt(t.amount)}</div>
            </div>
          ))}
          <button className="tambah-txn-btn" onClick={onAddTxn}>+ Tambah Transaksi</button>
        </div>
      </div>
    </div>
  );
}

// ─── Transactions Page ────────────────────────────────────────────────────────
function Transactions({ transactions, onDelete, onEdit }) {
  const now = new Date();
  const [viewDate, setViewDate] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const [filter, setFilter] = useState("semua");
  const cats = ["semua", "Makanan & Minuman", "Transportasi", "Tagihan & Utilitas", "Belanja", "Hiburan", "Pemasukan", "Lainnya"];

  const prevMonth = () => setViewDate(prev =>
    prev.month === 0 ? { year: prev.year - 1, month: 11 } : { year: prev.year, month: prev.month - 1 }
  );
  const nextMonth = () => setViewDate(prev =>
    prev.month === 11 ? { year: prev.year + 1, month: 0 } : { year: prev.year, month: prev.month + 1 }
  );

  const isCurrentMonth = viewDate.year === now.getFullYear() && viewDate.month === now.getMonth();
  const bulanLabel = new Date(viewDate.year, viewDate.month, 1).toLocaleDateString("id-ID", { month: "long", year: "numeric" });

  const monthTxns = transactions.filter(t => {
    const d = t.createdAt?.toDate ? t.createdAt.toDate() : new Date(t.createdAt || 0);
    return d.getMonth() === viewDate.month && d.getFullYear() === viewDate.year;
  });

  const pemasukanBulan = monthTxns.filter(t => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const pengeluaranBulan = monthTxns.filter(t => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const selisihBulan = pemasukanBulan - pengeluaranBulan;

  const sorted = [...monthTxns].sort((a, b) => {
    const da = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(a.createdAt || 0);
    const db2 = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(b.createdAt || 0);
    return db2 - da;
  }).filter(t => filter === "semua" || t.category === filter);

  return (
    <div>
      {/* ── Rekap Bulanan ── */}
      <div style={{ background: "var(--bg2)", border: "1.5px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "16px 18px", marginBottom: 16, boxShadow: "var(--card-shadow)" }}>
        {/* Navigasi bulan */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <button onClick={prevMonth} style={{ background: "var(--bg3)", border: "1.5px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "6px 14px", cursor: "pointer", color: "var(--text)", fontSize: 16, fontWeight: 700, lineHeight: 1 }}>‹</button>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)", letterSpacing: "-0.3px" }}>{bulanLabel}</div>
            {isCurrentMonth && <div style={{ fontSize: 10, color: "var(--accent)", fontWeight: 700, marginTop: 2, textTransform: "uppercase", letterSpacing: "0.5px" }}>Bulan Berjalan</div>}
          </div>
          <button onClick={nextMonth} disabled={isCurrentMonth} style={{ background: isCurrentMonth ? "transparent" : "var(--bg3)", border: "1.5px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "6px 14px", cursor: isCurrentMonth ? "default" : "pointer", color: isCurrentMonth ? "var(--text3)" : "var(--text)", fontSize: 16, fontWeight: 700, lineHeight: 1, opacity: isCurrentMonth ? 0.4 : 1 }}>›</button>
        </div>

        {/* 3 kolom ringkasan */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <div style={{ background: "rgba(34,197,94,0.08)", border: "1.5px solid rgba(34,197,94,0.2)", borderRadius: "var(--radius)", padding: "10px 12px", textAlign: "center" }}>
            <div style={{ fontSize: 10, color: "var(--green)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: 4 }}>Pemasukan</div>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: "var(--green)", letterSpacing: "-0.4px" }}>{fmt(pemasukanBulan)}</div>
          </div>
          <div style={{ background: "rgba(239,68,68,0.08)", border: "1.5px solid rgba(239,68,68,0.2)", borderRadius: "var(--radius)", padding: "10px 12px", textAlign: "center" }}>
            <div style={{ fontSize: 10, color: "var(--red)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: 4 }}>Pengeluaran</div>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: "var(--red)", letterSpacing: "-0.4px" }}>{fmt(pengeluaranBulan)}</div>
          </div>
          <div style={{ background: selisihBulan >= 0 ? "rgba(99,102,241,0.08)" : "rgba(239,68,68,0.08)", border: `1.5px solid ${selisihBulan >= 0 ? "rgba(99,102,241,0.2)" : "rgba(239,68,68,0.2)"}`, borderRadius: "var(--radius)", padding: "10px 12px", textAlign: "center" }}>
            <div style={{ fontSize: 10, color: selisihBulan >= 0 ? "var(--accent)" : "var(--red)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: 4 }}>{selisihBulan >= 0 ? "Surplus" : "Defisit"}</div>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: selisihBulan >= 0 ? "var(--accent)" : "var(--red)", letterSpacing: "-0.4px" }}>{fmt(Math.abs(selisihBulan))}</div>
          </div>
        </div>
        {monthTxns.length > 0 && (
          <div style={{ fontSize: 11.5, color: "var(--text3)", fontWeight: 500, marginTop: 10, textAlign: "center" }}>{monthTxns.length} transaksi di bulan ini</div>
        )}
      </div>

      {/* ── Filter ── */}
      <div className="tabs">
        {cats.map(c => <button key={c} className={`tab-btn ${filter === c ? "active" : ""}`} onClick={() => setFilter(c)}>{c === "semua" ? "Semua" : c}</button>)}
      </div>

      {/* ── List ── */}
      <div className="card">
        {sorted.length === 0 ? (
          <div className="empty-state">
            <div className="emoji">🔍</div>
            <p>Tidak ada transaksi</p>
            <p className="empty-sub">{filter !== "semua" ? "Coba pilih kategori lain" : `Belum ada transaksi di ${bulanLabel}`}</p>
          </div>
        ) : sorted.map(t => (
          <div key={t.id} className="txn-item">
            <div className="txn-icon" style={{ background: (CATEGORY_COLORS[t.category] || "#94a3b8") + "20" }}>{CATEGORY_ICONS[t.category] || "📌"}</div>
            <div className="txn-info">
              <div className="txn-name">{t.description}</div>
              <div className="txn-meta">{t.category} · {fmtDate(t.createdAt)} · {t.method || "—"}{t.accountName ? ` · ${t.accountName}` : ""}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
              <div className={`txn-amt ${t.type === "income" ? "inc" : "out"}`}>{t.type === "income" ? "+" : "−"}{fmt(t.amount)}</div>
              <div style={{ display: "flex", gap: 10 }}>
                <button className="action-link edit" onClick={() => onEdit(t)}>edit</button>
                <button className="action-link delete" onClick={() => onDelete(t.id)}>hapus</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Budget Page ──────────────────────────────────────────────────────────────
function Budget({ transactions, budgets, setBudgets, onOverspend }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingBudget, setEditingBudget] = useState(null);
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
      const updated = [...budgets]; updated[existing] = { ...updated[existing], limit: parseInt(form.limit) }; setBudgets(updated);
    } else setBudgets([...budgets, { category: form.category, limit: parseInt(form.limit) }]);
    setShowAdd(false); setForm({ category: "Makanan & Minuman", limit: "" });
  };

  const handleEditSave = () => {
    if (!editingBudget || !editingBudget.limit) return;
    setBudgets(budgets.map(b => b.category === editingBudget.category ? { ...b, limit: parseInt(editingBudget.limit) } : b));
    setEditingBudget(null);
  };

  const handleDelete = (category) => {
    if (!window.confirm(`Hapus budget ${category}?`)) return;
    setBudgets(budgets.filter(b => b.category !== category));
  };

  return (
    <div>
      <div className="section-header" style={{ marginBottom: 12 }}>
        <div className="section-title">Budget Bulanan</div>
        <button className="section-action" onClick={() => setShowAdd(true)}>+ Tambah</button>
      </div>
      <div className="card">
        {budgets.length === 0 && (
          <div className="empty-state"><div className="emoji">📊</div><p>Belum ada budget</p><p className="empty-sub">Tambah budget untuk memantau pengeluaran</p></div>
        )}
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
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className="budget-pct" style={{ color: over ? "var(--red)" : pct > 80 ? "var(--amber)" : "var(--text3)" }}>
                    {fmt(spent)} / {fmt(b.limit)}
                  </span>
                  <button onClick={() => setEditingBudget({ ...b })} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--accent)", fontSize: 13, padding: "2px 4px", borderRadius: 4 }} title="Edit">✏️</button>
                  <button onClick={() => handleDelete(b.category)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--red)", fontSize: 13, padding: "2px 4px", borderRadius: 4 }} title="Hapus">🗑️</button>
                </div>
              </div>
              <div className="progress-wrap">
                <div className="progress-fill" style={{ width: `${pct}%`, background: over ? "var(--red)" : pct > 80 ? "var(--amber)" : "var(--green)" }} />
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
            <div className="form-group"><label className="form-label">Kategori</label>
              <select className="form-select" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                {Object.keys(CATEGORY_ICONS).filter(c => !["Pemasukan", "Hutang", "Piutang"].includes(c)).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-group"><label className="form-label">Limit (Rp)</label>
              <input className="form-input" type="number" placeholder="500000" value={form.limit} onChange={e => setForm({ ...form, limit: e.target.value })} onKeyDown={e => e.key === "Enter" && handleSave()} />
            </div>
            <button className="btn-primary" onClick={handleSave}>Simpan</button>
            <button className="btn-ghost" onClick={() => setShowAdd(false)}>Batal</button>
          </div>
        </div>
      )}

      {editingBudget && (
        <div className="overlay" onClick={() => setEditingBudget(null)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-title">Edit Budget</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, padding: "10px 14px", background: "var(--bg3)", borderRadius: "var(--radius)", border: "1.5px solid var(--border)" }}>
              <span style={{ fontSize: 20 }}>{CATEGORY_ICONS[editingBudget.category]}</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{editingBudget.category}</span>
            </div>
            <div className="form-group"><label className="form-label">Limit Baru (Rp)</label>
              <input className="form-input" type="number" value={editingBudget.limit} onChange={e => setEditingBudget({ ...editingBudget, limit: e.target.value })} onKeyDown={e => e.key === "Enter" && handleEditSave()} autoFocus />
            </div>
            <button className="btn-primary" onClick={handleEditSave}>Simpan</button>
            <button className="btn-ghost" onClick={() => setEditingBudget(null)}>Batal</button>
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
  const [editingSaving, setEditingSaving] = useState(null);
  const [form, setForm] = useState({ name: "", icon: "🎯", target: "", current: "", deadline: "" });
  const [editForm, setEditForm] = useState({ name: "", icon: "", target: "", deadline: "" });
  const [depositAmt, setDepositAmt] = useState("");

  const handleAdd = () => {
    if (!form.name || !form.target) return;
    setSavings([...savings, { id: Date.now().toString(), name: form.name, icon: form.icon, target: parseInt(form.target), current: parseInt(form.current || 0), deadline: form.deadline }]);
    setShowAdd(false); setForm({ name: "", icon: "🎯", target: "", current: "", deadline: "" });
  };

  const handleDeposit = (sv) => {
    const amt = parseInt(depositAmt); if (!amt) return;
    setSavings(savings.map(s => s.id === sv.id ? { ...s, current: (s.current || 0) + amt } : s));
    setShowDeposit(null); setDepositAmt("");
  };

  const handleEditOpen = (sv) => {
    setEditForm({ name: sv.name, icon: sv.icon, target: sv.target, deadline: sv.deadline || "" });
    setEditingSaving(sv);
  };

  const handleEditSave = () => {
    if (!editForm.name || !editForm.target) return;
    setSavings(savings.map(s => s.id === editingSaving.id ? { ...s, name: editForm.name, icon: editForm.icon, target: parseInt(editForm.target), deadline: editForm.deadline } : s));
    setEditingSaving(null);
  };

  const handleDelete = (id) => {
    if (!window.confirm("Hapus target tabungan ini?")) return;
    setSavings(savings.filter(s => s.id !== id));
  };

  return (
    <div>
      <div className="section-header" style={{ marginBottom: 12 }}>
        <div className="section-title">Target Tabungan</div>
        <button className="section-action" onClick={() => setShowAdd(true)}>+ Tambah</button>
      </div>
      <div className="card">
        {savings.length === 0 ? (
          <div className="empty-state"><div className="emoji">🚀</div><p>Belum ada target tabungan</p><p className="empty-sub">Mulai set tujuan finansialmu!</p></div>
        ) : savings.map(sv => {
          const pct = Math.min(100, Math.round(((sv.current || 0) / sv.target) * 100));
          const weekly = sv.deadline ? getWeeklySavingsTarget(sv.target, sv.current || 0, sv.deadline) : null;
          return (
            <div key={sv.id} className="saving-item">
              <div className="saving-icon">{sv.icon}</div>
              <div className="saving-info">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                  <div className="saving-name">{sv.name}</div>
                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    <button onClick={() => handleEditOpen(sv)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--accent)", fontSize: 13, padding: "2px 4px", borderRadius: 4 }} title="Edit">✏️</button>
                    <button onClick={() => handleDelete(sv.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--red)", fontSize: 13, padding: "2px 4px", borderRadius: 4 }} title="Hapus">🗑️</button>
                  </div>
                </div>
                <div className="saving-meta">
                  {fmt(sv.current || 0)} / {fmt(sv.target)}
                  {weekly && <span style={{ marginLeft: 6, color: "var(--accent)" }}>· {fmt(weekly.weeklyTarget)}/minggu</span>}
                </div>
                <div className="progress-wrap">
                  <div className="progress-fill" style={{ width: `${pct}%`, background: pct >= 100 ? "var(--green)" : "var(--accent)" }} />
                </div>
                {pct >= 100 && <div style={{ fontSize: 11.5, color: "var(--green)", marginTop: 4, fontWeight: 700 }}>🎉 Target tercapai!</div>}
                {weekly && pct < 100 && <div style={{ fontSize: 11.5, color: "var(--text3)", marginTop: 4, fontWeight: 500 }}>{weekly.weeksLeft} minggu lagi · sisa {fmt(weekly.remaining)}</div>}
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
            <div className="form-group"><label className="form-label">Icon</label><input className="form-input" value={form.icon} onChange={e => setForm({ ...form, icon: e.target.value })} placeholder="🎯" maxLength={2} /></div>
            <div className="form-group"><label className="form-label">Nama</label><input className="form-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="cth: Beli HP baru" /></div>
            <div className="form-group"><label className="form-label">Target (Rp)</label><input className="form-input" type="number" value={form.target} onChange={e => setForm({ ...form, target: e.target.value })} placeholder="5000000" /></div>
            <div className="form-group"><label className="form-label">Sudah punya (Rp)</label><input className="form-input" type="number" value={form.current} onChange={e => setForm({ ...form, current: e.target.value })} placeholder="0" /></div>
            <div className="form-group"><label className="form-label">Deadline</label><input className="form-input" type="date" value={form.deadline} onChange={e => setForm({ ...form, deadline: e.target.value })} /></div>
            <button className="btn-primary" onClick={handleAdd}>Simpan</button>
            <button className="btn-ghost" onClick={() => setShowAdd(false)}>Batal</button>
          </div>
        </div>
      )}

      {editingSaving && (
        <div className="overlay" onClick={() => setEditingSaving(null)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-title">Edit Target Tabungan</div>
            <div className="form-group"><label className="form-label">Icon</label><input className="form-input" value={editForm.icon} maxLength={2} onChange={e => setEditForm({ ...editForm, icon: e.target.value })} /></div>
            <div className="form-group"><label className="form-label">Nama</label><input className="form-input" value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} autoFocus /></div>
            <div className="form-group"><label className="form-label">Target (Rp)</label><input className="form-input" type="number" value={editForm.target} onChange={e => setEditForm({ ...editForm, target: e.target.value })} /></div>
            <div className="form-group"><label className="form-label">Deadline</label><input className="form-input" type="date" value={editForm.deadline} onChange={e => setEditForm({ ...editForm, deadline: e.target.value })} /></div>
            <button className="btn-primary" onClick={handleEditSave}>Simpan</button>
            <button className="btn-ghost" onClick={() => setEditingSaving(null)}>Batal</button>
          </div>
        </div>
      )}

      {showDeposit && (
        <div className="overlay" onClick={() => setShowDeposit(null)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-title">{showDeposit.icon} Setor ke {showDeposit.name}</div>
            <div className="form-group"><label className="form-label">Jumlah (Rp)</label>
              <input className="form-input" type="number" value={depositAmt} onChange={e => setDepositAmt(e.target.value)} onKeyDown={e => e.key === "Enter" && handleDeposit(showDeposit)} placeholder="100000" autoFocus />
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
function Piutang({ piutangs, setPiutangs, onPiutangChange }) {
  const [showAdd, setShowAdd] = useState(false);
  const [showBayar, setShowBayar] = useState(null);
  const [editingPiutang, setEditingPiutang] = useState(null);
  const [form, setForm] = useState({ name: "", amount: "", note: "", date: "" });
  const [editForm, setEditForm] = useState({ name: "", amount: "", note: "", date: "" });
  const [bayarAmt, setBayarAmt] = useState("");

  const handleAdd = () => {
    if (!form.name || !form.amount) return;
    const updated = [...piutangs, { id: Date.now().toString(), name: form.name, total: parseInt(form.amount), sisa: parseInt(form.amount), note: form.note, date: form.date || new Date().toISOString().split("T")[0], history: [] }];
    setPiutangs(updated); onPiutangChange(updated);
    setShowAdd(false); setForm({ name: "", amount: "", note: "", date: "" });
  };

  const handleBayar = (p) => {
    const amt = parseInt(bayarAmt); if (!amt) return;
    const newSisa = Math.max(0, p.sisa - amt);
    const updated = piutangs.map(x => x.id === p.id ? { ...x, sisa: newSisa, history: [...(x.history || []), { amount: amt, date: new Date().toLocaleDateString("id-ID") }], lunas: newSisa === 0 } : x);
    setPiutangs(updated); onPiutangChange(updated);
    setShowBayar(null); setBayarAmt("");
  };

  const handleEditOpen = (p) => {
    setEditForm({ name: p.name, amount: p.total, note: p.note || "", date: p.date || "" });
    setEditingPiutang(p);
  };

  const handleEditSave = () => {
    if (!editForm.name || !editForm.amount) return;
    const newTotal = parseInt(editForm.amount);
    const sudahDibayar = editingPiutang.total - editingPiutang.sisa;
    const newSisa = Math.max(0, newTotal - sudahDibayar);
    const updated = piutangs.map(p => p.id === editingPiutang.id ? { ...p, name: editForm.name, total: newTotal, sisa: newSisa, note: editForm.note, date: editForm.date, lunas: newSisa === 0 } : p);
    setPiutangs(updated); onPiutangChange(updated); setEditingPiutang(null);
  };

  const handleDelete = (id) => {
    if (!window.confirm("Hapus piutang ini?")) return;
    const updated = piutangs.filter(p => p.id !== id);
    setPiutangs(updated); onPiutangChange(updated);
  };

  const active = piutangs.filter(p => !p.lunas);
  const lunas = piutangs.filter(p => p.lunas);
  const totalAktif = active.reduce((s, p) => s + p.sisa, 0);

  return (
    <div>
      <div className="section-header" style={{ marginBottom: 12 }}>
        <div className="section-title">Piutang</div>
        <button className="section-action" onClick={() => setShowAdd(true)}>+ Tambah</button>
      </div>

      {totalAktif > 0 && (
        <div style={{ background: "rgba(251,191,36,0.1)", border: "1.5px solid rgba(251,191,36,0.3)", borderRadius: "var(--radius)", padding: "12px 16px", marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 11.5, color: "var(--amber)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>Total Piutang Aktif</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "var(--amber)", letterSpacing: "-0.5px", marginTop: 2 }}>{fmtLong(totalAktif)}</div>
          </div>
          <div style={{ fontSize: 24 }}>🤝</div>
        </div>
      )}

      {active.length === 0 && lunas.length === 0 && (
        <div className="card"><div className="empty-state"><div className="emoji">🤝</div><p>Belum ada piutang</p><p className="empty-sub">Catat siapa yang punya hutang ke kamu</p></div></div>
      )}

      {active.map(p => (
        <div key={p.id} className="debt-item">
          <div className="debt-header">
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div className="debt-name">{p.name}</div>
                <button onClick={() => handleEditOpen(p)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--accent)", fontSize: 13, padding: "2px 4px", borderRadius: 4 }} title="Edit">✏️</button>
                <button onClick={() => handleDelete(p.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--red)", fontSize: 13, padding: "2px 4px", borderRadius: 4 }} title="Hapus">🗑️</button>
              </div>
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
          <div className="debt-actions"><button className="debt-pay-btn" onClick={() => setShowBayar(p)}>+ Catat Bayar</button></div>
        </div>
      ))}

      {lunas.length > 0 && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="card-title">Sudah Lunas 🎉</div>
          {lunas.map(p => (
            <div key={p.id} className="txn-item">
              <div className="txn-icon" style={{ background: "var(--green-dim)" }}>✅</div>
              <div className="txn-info"><div className="txn-name">{p.name}</div><div className="txn-meta">{fmt(p.total)} · {p.date}</div></div>
              <button onClick={() => handleDelete(p.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text3)", fontSize: 16, padding: "2px 6px" }}>×</button>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <div className="overlay" onClick={() => setShowAdd(false)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-title">Catat Piutang Baru</div>
            <p style={{ fontSize: 12.5, color: "var(--text3)", marginBottom: 16, lineHeight: 1.5 }}>💡 Piutang akan otomatis include dalam total saldo kamu</p>
            <div className="form-group"><label className="form-label">Nama Peminjam</label><input className="form-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="cth: Budi" /></div>
            <div className="form-group"><label className="form-label">Jumlah (Rp)</label><input className="form-input" type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="200000" /></div>
            <div className="form-group"><label className="form-label">Catatan</label><input className="form-input" value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="opsional" /></div>
            <div className="form-group"><label className="form-label">Tanggal</label><input className="form-input" type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
            <button className="btn-primary" onClick={handleAdd}>Simpan</button>
            <button className="btn-ghost" onClick={() => setShowAdd(false)}>Batal</button>
          </div>
        </div>
      )}

      {editingPiutang && (
        <div className="overlay" onClick={() => setEditingPiutang(null)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-title">Edit Piutang</div>
            <div className="form-group"><label className="form-label">Nama Peminjam</label><input className="form-input" value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} autoFocus /></div>
            <div className="form-group"><label className="form-label">Jumlah Total (Rp)</label><input className="form-input" type="number" value={editForm.amount} onChange={e => setEditForm({ ...editForm, amount: e.target.value })} /></div>
            <div className="form-group"><label className="form-label">Catatan</label><input className="form-input" value={editForm.note} onChange={e => setEditForm({ ...editForm, note: e.target.value })} placeholder="opsional" /></div>
            <div className="form-group"><label className="form-label">Tanggal</label><input className="form-input" type="date" value={editForm.date} onChange={e => setEditForm({ ...editForm, date: e.target.value })} /></div>
            <button className="btn-primary" onClick={handleEditSave}>Simpan</button>
            <button className="btn-ghost" onClick={() => setEditingPiutang(null)}>Batal</button>
          </div>
        </div>
      )}

      {showBayar && (
        <div className="overlay" onClick={() => setShowBayar(null)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-title">Catat Bayar dari {showBayar.name}</div>
            <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 14, fontWeight: 500 }}>Sisa hutang: {fmt(showBayar.sisa)}</div>
            <div className="form-group"><label className="form-label">Jumlah Bayar (Rp)</label>
              <input className="form-input" type="number" value={bayarAmt} onChange={e => setBayarAmt(e.target.value)} onKeyDown={e => e.key === "Enter" && handleBayar(showBayar)} placeholder="100000" autoFocus />
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
  const [accounts, setAccounts] = useState(DEFAULT_ACCOUNTS);
  const [assets, setAssets] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingParsed, setPendingParsed] = useState(null);
  const [pendingMethod, setPendingMethod] = useState(null);
  const [editingTxn, setEditingTxn] = useState(null);
  const [toast, setToast] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem("dompetku_theme") || "light");
  const [overspentCats, setOverspentCats] = useState(new Set());
  const [streak, setStreak] = useState(0);
  const [saldoAwal, setSaldoAwal] = useState(0);
  const [showSaldoPopup, setShowSaldoPopup] = useState(false);
  const [showManageAccounts, setShowManageAccounts] = useState(false);
  const [showManageAssets, setShowManageAssets] = useState(false);
  const [includePiutang, setIncludePiutang] = useState(true);

  useEffect(() => { document.documentElement.setAttribute("data-theme", theme); localStorage.setItem("dompetku_theme", theme); }, [theme]);
  const toggleTheme = () => setTheme(t => t === "dark" ? "light" : "dark");

  useEffect(() => { const unsub = onAuthStateChanged(auth, u => setUser(u)); return unsub; }, []);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, `users/${user.uid}/transactions`), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, snap => setTransactions(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
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
    const ac = localStorage.getItem(`${key}_accounts`); if (ac) setAccounts(JSON.parse(ac));
    const as = localStorage.getItem(`${key}_assets`); if (as) setAssets(JSON.parse(as));
    const ip = localStorage.getItem(`${key}_includePiutang`); if (ip !== null) setIncludePiutang(ip === "true");
  }, [user]);

  useEffect(() => { if (!user) return; localStorage.setItem(`dompetku_${user.uid}_savings`, JSON.stringify(savings)); }, [savings, user]);
  useEffect(() => { if (!user) return; localStorage.setItem(`dompetku_${user.uid}_piutangs`, JSON.stringify(piutangs)); }, [piutangs, user]);
  useEffect(() => { if (!user) return; localStorage.setItem(`dompetku_${user.uid}_budgets`, JSON.stringify(budgets)); }, [budgets, user]);
  useEffect(() => { if (!user) return; localStorage.setItem(`dompetku_${user.uid}_accounts`, JSON.stringify(accounts)); }, [accounts, user]);
  useEffect(() => { if (!user) return; localStorage.setItem(`dompetku_${user.uid}_assets`, JSON.stringify(assets)); }, [assets, user]);
  useEffect(() => { if (!user) return; localStorage.setItem(`dompetku_${user.uid}_includePiutang`, includePiutang); }, [includePiutang, user]);

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
      setPendingParsed({ ...parsed, rawInput: input });
    } catch (e) { showToast("Gagal parse transaksi 😢"); }
    setLoading(false); setInput("");
  };

  const handleMethodSelect = (method) => {
    if (!pendingParsed) return;
    if (method === "cash") { saveTransaction({ ...pendingParsed, method, accountId: "cash", accountName: "Cash" }); setPendingParsed(null); }
    else setPendingMethod(method);
  };

  const handleAccountSelect = (accountId) => {
    if (!pendingParsed || !pendingMethod) return;
    const acc = accounts.find(a => a.id === accountId);
    saveTransaction({ ...pendingParsed, method: pendingMethod, accountId, accountName: acc?.name || "" });
    setPendingParsed(null); setPendingMethod(null);
  };

  const saveTransaction = async (parsed) => {
    // Transaksi selalu disimpan dengan tanggal hari ini
    await addDoc(collection(db, `users/${user.uid}/transactions`), {
      description: parsed.description, amount: parsed.amount,
      category: parsed.category, type: parsed.type,
      method: parsed.method, accountId: parsed.accountId || null,
      accountName: parsed.accountName || null,
      createdAt: new Date()  // ← tanggal hari ini otomatis
    });
    const newStreak = streak + 1; setStreak(newStreak);
    localStorage.setItem(`dompetku_${user.uid}_streak`, newStreak);
    showToast(`✅ ${parsed.description} · ${fmt(parsed.amount)}`);
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Hapus transaksi ini?")) return;
    await deleteDoc(doc(db, `users/${user.uid}/transactions`, id));
    showToast("🗑️ Transaksi dihapus");
  };

  const handleEdit = async (form) => {
    if (!editingTxn) return;
    await updateDoc(doc(db, `users/${user.uid}/transactions`, editingTxn.id), {
      description: form.description, amount: form.amount,
      category: form.category, type: form.type, method: form.method,
    });
    setEditingTxn(null); showToast("✏️ Transaksi diperbarui");
  };

  const handleSaldoSave = (val) => {
    setSaldoAwal(val); localStorage.setItem(`dompetku_${user?.uid}_saldoAwal`, val);
    setShowSaldoPopup(false); showToast(`💳 Saldo awal: ${fmt(val)}`);
  };

  const handleSaveAccounts = (updated) => { setAccounts(updated); setShowManageAccounts(false); showToast("💳 Rekening diperbarui"); };
  const handleSaveAssets = (updated) => { setAssets(updated); setShowManageAssets(false); showToast("💍 Aset diperbarui"); };
  const handlePiutangChange = (updated) => setPiutangs(updated);
  const handleKeyDown = (e) => { if (e.key === "Enter") handleSubmit(); };

  const userInitial = user?.email ? user.email[0].toUpperCase() : "?";
  const userName = user?.email ? user.email.split("@")[0] : "Pengguna";

  const NAV = [
    { id: "dashboard", label: "Home", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg> },
    { id: "transactions", label: "Transaksi", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg> },
    { id: "budget", label: "Budget", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></svg> },
    { id: "savings", label: "Tabungan", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a10 10 0 100 20A10 10 0 0012 2z" /><path d="M12 6v6l4 2" /></svg> },
    { id: "piutang", label: "Piutang", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" /></svg> },
  ];

  if (user === undefined) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "var(--bg)" }}>
      <div className="spinner" style={{ width: 28, height: 28, borderWidth: 3, borderColor: "rgba(99,102,241,0.25)", borderTopColor: "#6366f1" }} />
    </div>
  );

  if (!user) return <LoginPage />;

  return (
    <div className="app">
      {toast && <Toast msg={toast} onDone={() => setToast(null)} />}
      {pendingParsed && !pendingMethod && <MethodPopup parsed={pendingParsed} onSelect={handleMethodSelect} onCancel={() => setPendingParsed(null)} />}
      {pendingParsed && pendingMethod && <AccountPickerPopup method={pendingMethod} parsed={pendingParsed} accounts={accounts} onSelect={handleAccountSelect} onCancel={() => { setPendingParsed(null); setPendingMethod(null); }} />}
      {editingTxn && <EditPopup txn={editingTxn} onSave={handleEdit} onCancel={() => setEditingTxn(null)} />}
      {showSaldoPopup && <SaldoAwalPopup current={saldoAwal} onSave={handleSaldoSave} onCancel={() => setShowSaldoPopup(false)} />}
      {showManageAccounts && <ManageAccountsPopup accounts={accounts} onSave={handleSaveAccounts} onCancel={() => setShowManageAccounts(false)} />}
      {showManageAssets && <AssetsPopup assets={assets} onSave={handleSaveAssets} onCancel={() => setShowManageAssets(false)} />}

      <aside className="sidebar">
        <div className="sidebar-brand"><span className="brand-icon">💰</span><span className="brand-name">Dompetku</span></div>
        {streak > 0 && <div className="streak-badge sidebar-streak">🔥 {streak} transaksi</div>}
        <nav className="sidebar-nav">
          {NAV.map(n => (
            <button key={n.id} className={`sidebar-item ${page === n.id ? "active" : ""}`} onClick={() => setPage(n.id)}>
              <span className="sidebar-icon">{n.icon}</span><span>{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button className="theme-btn" onClick={toggleTheme}>{theme === "dark" ? "☀️" : "🌙"} {theme === "dark" ? "Mode Terang" : "Mode Gelap"}</button>
          <button className="sidebar-item logout-btn" onClick={() => signOut(auth)}>
            <span className="sidebar-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg></span>
            <span>Keluar</span>
          </button>
        </div>
      </aside>

      <header className="mobile-header">
        <div className="mobile-brand"><span>💰</span><span>Dompetku</span>{streak > 0 && <span className="streak-badge">🔥 {streak}</span>}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="icon-btn" onClick={toggleTheme}>{theme === "dark" ? "☀️" : "🌙"}</button>
          <button className="icon-btn" onClick={() => signOut(auth)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg></button>
        </div>
      </header>

      <main className="main-wrapper">
        <div className="main-content">
          {page === "dashboard" && (
            <div style={{ marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div><div className="page-greeting">👋 Halo, {userName.charAt(0).toUpperCase() + userName.slice(1)}!</div><div className="page-sub">Kelola keuanganmu dengan lebih bijak</div></div>
              <div style={{ width: 40, height: 40, borderRadius: "50%", background: "var(--hero-gradient)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 800, fontSize: 16, flexShrink: 0, boxShadow: "0 4px 12px var(--hero-glow)" }}>{userInitial}</div>
            </div>
          )}

          <div className="quick-input-bar">
            <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown} placeholder='cth: "kopi 15rb cash" atau "gaji 5jt"' disabled={loading} />
            <button className="send-btn" onClick={handleSubmit} disabled={loading || !input.trim()}>
              {loading ? <div className="spinner" /> : <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>Catat</>}
            </button>
          </div>

          {page === "dashboard" && <Dashboard transactions={transactions} budgets={budgets} savings={savings} saldoAwal={saldoAwal} onSetSaldoAwal={() => setShowSaldoPopup(true)} onAddTxn={() => { const el = document.querySelector(".quick-input-bar input"); if (el) el.focus(); }} piutangs={piutangs} includePiutang={includePiutang} onTogglePiutang={() => setIncludePiutang(p => !p)} accounts={accounts} assets={assets} onManageAccounts={() => setShowManageAccounts(true)} onManageAssets={() => setShowManageAssets(true)} />}
          {page === "transactions" && <Transactions transactions={transactions} onDelete={handleDelete} onEdit={setEditingTxn} />}
          {page === "budget" && <Budget transactions={transactions} budgets={budgets} setBudgets={setBudgets} onOverspend={handleOverspend} />}
          {page === "savings" && <Savings savings={savings} setSavings={setSavings} />}
          {page === "piutang" && <Piutang piutangs={piutangs} setPiutangs={setPiutangs} onPiutangChange={handlePiutangChange} />}
        </div>
      </main>

      <nav className="bottom-nav">
        {NAV.map(n => (
          <button key={n.id} className={`nav-item ${page === n.id ? "active" : ""}`} onClick={() => setPage(n.id)}>{n.icon}{n.label}</button>
        ))}
      </nav>
    </div>
  );
}
