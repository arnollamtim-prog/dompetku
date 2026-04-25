const GEMINI_API_KEY = "AIzaSyD6mVtkUEoWiQCKsym5T82t9Xkop-4vfIs";

const CATEGORIES = [
  "Makanan & Minuman", "Transportasi", "Tagihan & Utilitas", "Belanja",
  "Kesehatan", "Pendidikan", "Hiburan", "Tabungan",
  "Pemasukan", "Hutang", "Piutang", "Lainnya"
];

// ─── Keyword-based fallback categorizer ───────────────────────────────────────
const CATEGORY_KEYWORDS = {
  "Makanan & Minuman": [
    "kopi", "coffee", "makan", "minum", "nasi", "ayam", "bakso", "mie",
    "sate", "pizza", "burger", "warung", "restoran", "cafe", "cafeteria",
    "snack", "jajan", "sarapan", "siang", "malam", "boba", "teh", "juice",
    "es", "roti", "gorengan", "indomie", "mi", "soto", "gado", "pecel",
    "warteg", "kantin", "mcd", "kfc", "mcdonalds", "starbucks", "lunch",
    "dinner", "breakfast", "cemilan", "minuman", "makanan", "seafood",
    "sushi", "ramen", "pho", "kebab", "sandwich", "salad", "dessert",
    "kue", "donut", "martabak", "siomay", "batagor", "pempek", "sop",
  ],
  "Transportasi": [
    "bensin", "bbm", "parkir", "grab", "gojek", "taxi", "ojek", "bus",
    "kereta", "krl", "mrt", "lrt", "tol", "angkot", "becak", "travel",
    "damri", "transjakarta", "busway", "pertamina", "shell", "spbu",
    "motor", "mobil", "uber", "maxim", "indriver", "tiket pesawat",
    "pesawat", "kapal", "ferry", "transport",
  ],
  "Tagihan & Utilitas": [
    "listrik", "pln", "air", "pdam", "internet", "wifi", "telkom",
    "indihome", "firstmedia", "biznet", "telpon", "telepon", "pulsa",
    "token", "tagihan", "iuran", "pbb", "bpjs", "gas", "lpg",
    "tv kabel", "netflix", "spotify", "youtube premium", "icloud",
  ],
  "Belanja": [
    "belanja", "beli", "shopee", "tokopedia", "lazada", "bukalapak",
    "toko", "supermarket", "indomaret", "alfamart", "hypermart", "mall",
    "pakaian", "baju", "celana", "sepatu", "tas", "aksesoris", "elektronik",
    "hp", "handphone", "laptop", "headset", "charger", "kabel", "groceries",
    "sayur", "buah", "daging", "sembako", "detergen", "sabun", "shampoo",
  ],
  "Kesehatan": [
    "obat", "apotek", "dokter", "klinik", "rumah sakit", "rs", "puskesmas",
    "bpjs", "vitamin", "suplemen", "konsultasi", "periksa", "cek",
    "lab", "laboratorium", "dental", "gigi", "mata", "fisioterapi",
    "gym", "fitness", "olahraga", "sport",
  ],
  "Pendidikan": [
    "sekolah", "kuliah", "kursus", "les", "buku", "alat tulis", "spp",
    "ukt", "biaya kuliah", "pendidikan", "belajar", "kelas", "workshop",
    "seminar", "pelatihan", "training", "bootcamp", "udemy", "coursera",
  ],
  "Hiburan": [
    "hiburan", "nonton", "bioskop", "cinema", "xxi", "cgv", "netflix",
    "game", "steam", "playstation", "xbox", "spotify", "musik", "konser",
    "karaoke", "bowling", "renang", "wisata", "liburan", "hotel", "resort",
    "tiket", "zara", "disney", "amazon prime", "youtube",
  ],
  "Tabungan": [
    "tabungan", "nabung", "simpan", "deposito", "investasi", "saham",
    "reksa dana", "reksadana", "obligasi", "emas", "logam mulia",
  ],
  "Pemasukan": [
    "gaji", "salary", "upah", "bonus", "thr", "pemasukan", "pendapatan",
    "dapat uang", "terima uang", "transfer masuk", "freelance", "fee",
    "komisi", "dividen", "bunga", "cashback", "refund", "dikembalikan",
  ],
  "Hutang": [
    "pinjam", "pinjem", "utang", "hutang", "kredit", "cicilan", "nyicil",
    "bayar hutang", "angsuran",
  ],
  "Piutang": [
    "dipinjemin", "piutang", "tagih", "minjemin", "kasih pinjam",
  ],
};

const detectCategory = (input) => {
  const lower = input.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) return category;
  }
  return "Lainnya";
};

const detectMethod = (input) => {
  const lower = input.toLowerCase();
  if (/qris|gopay|ovo|dana|shopeepay|linkaja|doku/.test(lower)) return "qris";
  if (/transfer|tf|bca|bni|bri|mandiri|jenius|jago/.test(lower)) return "transfer";
  if (/cash|tunai|bayar cash/.test(lower)) return "cash";
  return null;
};

const parseAmount = (input) => {
  const match = input.match(/(\d+(?:[.,]\d+)?)\s*(rb|ribu|k|jt|juta|m)?/i);
  if (!match) return 0;
  let amount = parseFloat(match[1].replace(",", "."));
  const unit = (match[2] || "").toLowerCase();
  if (unit === "rb" || unit === "ribu" || unit === "k") amount *= 1000;
  if (unit === "jt" || unit === "juta" || unit === "m") amount *= 1000000;
  return Math.round(amount);
};

const localParse = (input) => {
  const category = detectCategory(input);
  const method = detectMethod(input);
  const amount = parseAmount(input);
  const type = category === "Pemasukan" ? "income" : "expense";
  // Clean description: hapus angka + satuan + metode dari teks
  const description = input
    .replace(/\d+(?:[.,]\d+)?\s*(?:rb|ribu|k|jt|juta|m)?/gi, "")
    .replace(/\b(cash|tunai|qris|gopay|ovo|dana|transfer|tf)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim() || input;

  return { description, amount, category, type, method };
};

// ─── Main export ──────────────────────────────────────────────────────────────
export const parseTransactionInput = async (input) => {
  // Coba lokal dulu — kalau kategori ketemu (bukan Lainnya), langsung pakai
  const localResult = localParse(input);
  if (localResult.category !== "Lainnya" && localResult.amount > 0) {
    return localResult;
  }

  // Kalau tidak ketemu, baru panggil Gemini
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
  "method": "cash|qris|transfer|null"
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
    const parsed = JSON.parse(clean);
    // Pastikan method tidak string "null"
    if (parsed.method === "null") parsed.method = null;
    return parsed;
  } catch (e) {
    // Gemini gagal → pakai hasil lokal
    return localResult;
  }
};

// ─── Helper exports (tidak berubah) ───────────────────────────────────────────
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

export const getFunnyOverspendMessage = () =>
  FUNNY_OVERSPEND[Math.floor(Math.random() * FUNNY_OVERSPEND.length)];

export const getMoodMessage = (saldo, totalPemasukan) => {
  if (totalPemasukan === 0) return { msg: "Yuk mulai catat keuanganmu! 💪", color: "#6366f1" };
  const ratio = saldo / totalPemasukan;
  if (ratio > 0.5) return { msg: "Keuangan sehat! Terus pertahankan 🎉", color: "#10b981" };
  if (ratio > 0.3) return { msg: "Lumayan nih, tapi bisa lebih hemat lagi 😊", color: "#f59e0b" };
  if (ratio > 0.1) return { msg: "Hati-hati, saldo mulai mepet nih... 😬", color: "#f97316" };
  return { msg: "BAHAYA! Dompet hampir kosong! 🚨", color: "#ef4444" };
};

export const getWeeklySavingsTarget = (targetAmount, currentAmount, deadlineDate) => {
  const now = new Date();
  const deadline = new Date(deadlineDate);
  const weeksLeft = Math.max(1, Math.ceil((deadline - now) / (7 * 24 * 60 * 60 * 1000)));
  const remaining = targetAmount - currentAmount;
  return { weeklyTarget: Math.ceil(remaining / weeksLeft), weeksLeft, remaining };
};
