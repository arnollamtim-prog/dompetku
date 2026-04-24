const GEMINI_API_KEY = "AIzaSyD6mVtkUEoWiQCKsym5T82t9Xkop-4vfIs";

const CATEGORIES = [
  "Makanan & Minuman",
  "Transportasi",
  "Tagihan & Utilitas",
  "Belanja",
  "Kesehatan",
  "Pendidikan",
  "Hiburan",
  "Tabungan",
  "Pemasukan",
  "Hutang",
  "Piutang",
  "Lainnya"
];

const FUNNY_OVERSPEND = [
  "Woi boros banget sih! Duit bukan daun! 🌿",
  "Ngab, rekening lu nangis sekarang... 😭",
  "Budget jebol! Untung duit bukan nyawa 💸",
  "Astagfirullah... kantong makin tipis nih 🕳️",
  "Bro, lu baik-baik aja? Budget udah KO nih 🥊",
  "Selamat! Lu berhasil bikin budget menangis 🏆",
  "Budget: tolong... aku sekarat... 😵",
  "Dompet lu lagi drama besar nih bestie 🎭"
];

export const getFunnyOverspendMessage = () => {
  return FUNNY_OVERSPEND[Math.floor(Math.random() * FUNNY_OVERSPEND.length)];
};

export const getMoodMessage = (saldo, totalPemasukan) => {
  if (totalPemasukan === 0) return { msg: "Yuk mulai catat keuanganmu! 💪", color: "#6366f1" };
  const ratio = saldo / totalPemasukan;
  if (ratio > 0.5) return { msg: "Keuangan sehat! Terus pertahankan 🎉", color: "#10b981" };
  if (ratio > 0.3) return { msg: "Lumayan nih, tapi bisa lebih hemat lagi 😊", color: "#f59e0b" };
  if (ratio > 0.1) return { msg: "Hati-hati, saldo mulai mepet nih... 😬", color: "#f97316" };
  return { msg: "BAHAYA! Dompet hampir kosong! 🚨", color: "#ef4444" };
};

export const parseTransactionInput = async (input) => {
  const prompt = `Kamu adalah parser transaksi keuangan. Parse input berikut menjadi JSON.

Input: "${input}"

Kategori yang tersedia: ${CATEGORIES.join(", ")}

Aturan parsing:
- Angka bisa dalam format: 15000, 15rb, 15k, 15.000, 1.5jt, 1500000
- Metode bayar: deteksi "cash/tunai" atau "qris/gopay/ovo/dana/transfer" dari teks
- Jika ada kata "pinjam/pinjem/utang" → kategori "Hutang"  
- Jika ada kata "dipinjemin/piutang/tagih" → kategori "Piutang"
- Jika ada kata "gaji/salary/pemasukan/dapat uang/terima" → kategori "Pemasukan", tipe "income"
- Selain pemasukan → tipe "expense"
- Jika tidak ada info metode bayar → method: null

Balas HANYA dengan JSON, tanpa penjelasan:
{
  "description": "nama transaksi yang bersih",
  "amount": angka_saja,
  "category": "kategori",
  "type": "expense|income",
  "method": "cash|qris|null"
}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 200 }
        })
      }
    );
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const clean = text.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch (e) {
    // fallback parsing
    const amountMatch = input.match(/(\d+(?:[.,]\d+)?)\s*(rb|ribu|k|jt|juta|m)?/i);
    let amount = 0;
    if (amountMatch) {
      amount = parseFloat(amountMatch[1].replace(",", "."));
      const unit = (amountMatch[2] || "").toLowerCase();
      if (unit === "rb" || unit === "ribu" || unit === "k") amount *= 1000;
      if (unit === "jt" || unit === "juta" || unit === "m") amount *= 1000000;
    }
    return {
      description: input.replace(/\d+[^\s]*/g, "").trim() || input,
      amount,
      category: "Lainnya",
      type: "expense",
      method: null
    };
  }
};

export const getWeeklySavingsTarget = (targetAmount, currentAmount, deadlineDate) => {
  const now = new Date();
  const deadline = new Date(deadlineDate);
  const weeksLeft = Math.max(1, Math.ceil((deadline - now) / (7 * 24 * 60 * 60 * 1000)));
  const remaining = targetAmount - currentAmount;
  return {
    weeklyTarget: Math.ceil(remaining / weeksLeft),
    weeksLeft,
    remaining
  };
};
