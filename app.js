/* ==========================================================================
   Stillwell — personal finance tracker
   --------------------------------------------------------------------------
   No build step, no framework, no server. Everything below runs in the
   browser. The only network calls are (a) the optional Supabase sync you
   configure yourself and (b) fetching PDF.js from a CDN the first time you
   open a PDF. Statement files are never uploaded anywhere.
   ========================================================================== */

'use strict';

/* ==========================================================================
   1. Storage keys, state, migration
   ========================================================================== */

const KEY = 'stillwell-v1';
const CLOUD = 'stillwell-cloud-v1';
const AUTH = 'stillwell-auth-v1';
const THEME_KEY = 'stillwell-theme';

const CATEGORIES = [
  'Food & drink', 'Groceries', 'Transport', 'Shopping', 'Bills & utilities',
  'Rent & home', 'Health', 'Travel', 'Entertainment', 'Education',
  'Investments', 'Fees & charges', 'Cash', 'Income', 'Transfers', 'Other'
];

const CATEGORY_COLORS = {
  'Food & drink': 'var(--c3)', 'Groceries': 'var(--c7)', 'Transport': 'var(--c6)',
  'Shopping': 'var(--c5)', 'Bills & utilities': 'var(--c4)', 'Rent & home': 'var(--c9)',
  'Health': 'var(--c1)', 'Travel': 'var(--c8)', 'Entertainment': 'var(--c2)',
  'Education': 'var(--c4)', 'Investments': 'var(--c1)', 'Fees & charges': 'var(--c5)',
  'Cash': 'var(--c10)', 'Income': 'var(--c1)', 'Transfers': 'var(--c10)', 'Other': 'var(--c10)'
};

const TYPE_NAME = { bank: 'Bank account', fd: 'Fixed deposit', card: 'Credit card', fund: 'Mutual fund' };
const TYPE_SYMBOL = { bank: '↗', fd: '◷', card: '▤', fund: '⌁' };

const DEMO = {
  accounts: [
    { id: 'a1', name: 'Everyday savings', institution: 'HDFC Bank', type: 'bank', balance: 184250, date: '2026-10-08', color: 'sage' },
    { id: 'a2', name: 'Salary account', institution: 'ICICI Bank', type: 'bank', balance: 64280, date: '2026-10-09', color: 'blue' },
    { id: 'a3', name: 'Tax saver FD', institution: 'SBI', type: 'fd', balance: 250000, date: '2026-09-28', color: 'peach' },
    { id: 'a4', name: 'Axis Flipkart', institution: 'Axis Bank', type: 'card', balance: 12460, date: '2026-10-09', color: 'lavender', limit: 80000 },
    { id: 'a5', name: 'Nifty 50 Index', institution: 'Zerodha Coin', type: 'fund', balance: 386400, date: '2026-10-01', color: 'ink' }
  ],
  transactions: [],
  statements: [],
  demo: true
};

/* Build six months of plausible demo transactions so every chart has something
   to show before the first real import. */
(function seedDemo() {
  const script = [
    ['Blue Tokai Coffee', -420, 'Food & drink'], ['Uber India', -286, 'Transport'],
    ['Swiggy order', -740, 'Food & drink'], ['Myntra Designs', -2199, 'Shopping'],
    ['Electricity bill', -1850, 'Bills & utilities'], ['Apollo Pharmacy', -560, 'Health'],
    ['Salary credit', 125000, 'Income'], ['Zomato', -680, 'Food & drink'],
    ['BigBasket', -3120, 'Groceries'], ['House rent', -32000, 'Rent & home'],
    ['Netflix', -649, 'Entertainment'], ['Indigo flight', -6400, 'Travel'],
    ['SIP — index fund', -15000, 'Investments'], ['Mobile recharge', -799, 'Bills & utilities']
  ];
  const today = new Date();
  let n = 0;
  for (let m = 5; m >= 0; m--) {
    const base = new Date(today.getFullYear(), today.getMonth() - m, 1);
    const wobble = 1 + (m % 3) * 0.12 - 0.1;
    script.forEach((row, i) => {
      const day = Math.min(27, 2 + i * 2);
      const d = new Date(base.getFullYear(), base.getMonth(), day);
      if (d > today) return;
      DEMO.transactions.push({
        id: 'demo-' + (n++),
        date: d.toISOString().slice(0, 10),
        description: row[0],
        amount: Math.round(row[1] * (row[2] === 'Income' ? 1 : wobble)),
        category: row[2],
        account: i % 4 === 3 ? 'a4' : (row[2] === 'Income' ? 'a2' : 'a1')
      });
    });
  }
})();

/** Bring any older saved shape up to the current one. Never throws. */
function migrate(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  s.accounts = Array.isArray(s.accounts) ? s.accounts : [];
  s.transactions = Array.isArray(s.transactions) ? s.transactions : [];
  s.statements = Array.isArray(s.statements) ? s.statements : [];
  s.demo = !!s.demo;
  s.transactions = s.transactions.filter(t => t && t.date && Number.isFinite(Number(t.amount))).map(t => ({
    ...t,
    amount: Number(t.amount),
    description: String(t.description || 'Transaction'),
    category: CATEGORIES.includes(t.category) ? t.category : remapCategory(t.category)
  }));
  return s;
}

/** Older builds used a shorter category list; fold those into the new one. */
function remapCategory(c) {
  const map = { 'Bills': 'Bills & utilities', 'Food & drink': 'Food & drink', 'Transfers': 'Transfers' };
  if (map[c]) return map[c];
  return CATEGORIES.includes(c) ? c : 'Other';
}

/* Remove only the seeded sample records, never anything the user added. A user
   can import a real statement against a demo account before clearing the
   sample, so this matches on the seeded ids rather than wiping the arrays. */
function dropDemoData() {
  const demoAccounts = new Set(DEMO.accounts.map(a => a.id));
  const isDemoTx = t => String(t.id || '').startsWith('demo-');
  const before = state.accounts.length + state.transactions.length + state.statements.length;

  // A demo account the user has since imported into is kept, along with its rows.
  const claimed = new Set(
    state.transactions.filter(t => !isDemoTx(t) && demoAccounts.has(t.account)).map(t => t.account)
  );
  state.statements.forEach(s => claimed.add(s.accountId));

  state.accounts = state.accounts.filter(a => !demoAccounts.has(a.id) || claimed.has(a.id));
  state.transactions = state.transactions.filter(t => !isDemoTx(t));
  state.demo = false;
  return before - (state.accounts.length + state.transactions.length + state.statements.length);
}

let state;
try { state = migrate(JSON.parse(localStorage.getItem(KEY)) || structuredClone(DEMO)); }
catch (e) { state = migrate(structuredClone(DEMO)); }

let cloudCfg = {}, cloudAuth = null, syncTimer = null, syncBusy = false, lastRemoteAt = '';
try { cloudCfg = JSON.parse(localStorage.getItem(CLOUD) || '{}') || {}; } catch (e) { cloudCfg = {}; }
try { cloudAuth = JSON.parse(localStorage.getItem(AUTH) || 'null'); } catch (e) { cloudAuth = null; }

let view = 'overview';
let range = 'month';
let trendAccount = 'all';
let flowMonth = null;
let txSearch = '';
let pending = null;      // parsed-but-not-yet-imported result
let lastDiagnostics = '';

const app = document.querySelector('#app');

/* ==========================================================================
   2. Small utilities
   ========================================================================== */

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function fmt(v, currency) {
  const n = Number(v) || 0;
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency', currency: currency || 'INR', maximumFractionDigits: 0
    }).format(n);
  } catch (e) { return '₹' + Math.round(n).toLocaleString('en-IN'); }
}

/** Compact form for chart axes: ₹1.2L, ₹45k. */
function fmtShort(v) {
  const n = Math.abs(Number(v) || 0);
  const sign = (Number(v) || 0) < 0 ? '−' : '';
  if (n >= 1e7) return sign + '₹' + (n / 1e7).toFixed(n >= 1e8 ? 0 : 1) + 'Cr';
  if (n >= 1e5) return sign + '₹' + (n / 1e5).toFixed(n >= 1e6 ? 0 : 1) + 'L';
  if (n >= 1000) return sign + '₹' + Math.round(n / 1000) + 'k';
  return sign + '₹' + Math.round(n);
}

const dateFmt = d => d
  ? new Date(d + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  : '—';

const monthKey = d => String(d || '').slice(0, 7);

const monthLabel = key => key
  ? new Date(key + '-02T12:00:00').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
  : '—';

const monthLabelLong = key => key
  ? new Date(key + '-02T12:00:00').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
  : '—';

function uid() {
  try { return crypto.randomUUID(); }
  catch (e) { return 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9); }
}

function toast(message) {
  const t = document.querySelector('#toast');
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => t.classList.remove('show'), 2800);
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { toast('This browser is out of storage space — some data may not persist.'); }
  if (cloudAuth && !syncBusy) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncPush().catch(err => setSyncStatus('Sync paused · ' + err.message));
    }, 1200);
  }
}

/* ==========================================================================
   3. Theme
   ========================================================================== */

function applyTheme(pref) {
  const dark = pref === 'dark' ||
    (pref === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.themePref = pref;
  try { localStorage.setItem(THEME_KEY, pref); } catch (e) { /* storage disabled */ }
  const btn = document.querySelector('#themeBtn');
  if (btn) {
    btn.textContent = pref === 'auto' ? '◐' : (pref === 'dark' ? '☾' : '☀');
    btn.title = 'Theme: ' + pref + ' (click to change)';
  }
}

function cycleTheme() {
  const order = ['auto', 'light', 'dark'];
  const current = document.documentElement.dataset.themePref || 'auto';
  const next = order[(order.indexOf(current) + 1) % order.length];
  applyTheme(next);
  toast('Theme: ' + next);
  draw();
}

/* ==========================================================================
   4. Number and date normalisation
   ========================================================================== */

/**
 * Parse a money token. Handles ₹/Rs/$ prefixes, thousands separators,
 * trailing or leading minus, parentheses negatives, and Indian "1,23,456.78".
 * Returns NaN when there is no usable number.
 */
function parseMoney(input) {
  const raw = String(input == null ? '' : input).trim();
  if (!raw) return NaN;
  let negative = /^\(.*\)$/.test(raw) || /^-/.test(raw) || /-$/.test(raw);
  let clean = raw
    .replace(/\(|\)/g, '')
    .replace(/(?:INR|Rs\.?|₹|\$|€|£)/gi, '')
    .replace(/[A-Za-z]/g, '')
    .replace(/[\s,'`]/g, '')
    .replace(/^-+|-+$/g, '');
  if (!/\d/.test(clean)) return NaN;
  // A trailing ".00" style decimal is the only decimal we honour.
  const n = Number(clean);
  if (!Number.isFinite(n)) return NaN;
  return negative ? -Math.abs(n) : n;
}

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12
};

/**
 * Normalise a date to YYYY-MM-DD.
 * Day-first is assumed for ambiguous numeric dates because every statement
 * format this app targets (Indian banks and cards) is day-first.
 */
function normalizeDate(input) {
  const s = String(input == null ? '' : input).trim();
  if (!s) return '';
  let m;

  // 2026-04-12 / 2026.04.12
  m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return iso(m[1], m[2], m[3]);

  // 12-Apr-2026 / 12 Apr 2026 / 12.Apr.26
  m = s.match(/^(\d{1,2})[-/.\s]([A-Za-z]{3,9})[-/.\s](\d{2,4})/);
  if (m) {
    const mo = MONTHS[m[2].slice(0, 4).toLowerCase()] || MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mo) return iso(year(m[3]), mo, m[1]);
  }

  // Apr 12, 2026 / April 12 2026
  m = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    const mo = MONTHS[m[1].slice(0, 4).toLowerCase()] || MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mo) return iso(m[3], mo, m[2]);
  }

  // 12/04/2026, 12-04-26, 12.04.2026 — day first.
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    let d = +m[1], mo = +m[2];
    if (d > 12 && mo <= 12) { /* unambiguous day-first */ }
    else if (mo > 12 && d <= 12) { const t = d; d = mo; mo = t; } // was month-first
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return iso(year(m[3]), mo, d);
  }

  // 20260412
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return iso(m[1], m[2], m[3]);

  return '';

  function year(y) { return String(y).length === 2 ? (+y > 70 ? '19' + y : '20' + y) : String(y); }
  function iso(y, mo, d) {
    const Y = +y, M = +mo, D = +d;
    if (!(Y >= 1900 && Y <= 2200 && M >= 1 && M <= 12 && D >= 1 && D <= 31)) return '';
    return Y + '-' + String(M).padStart(2, '0') + '-' + String(D).padStart(2, '0');
  }
}

const DATE_TOKEN = /^\(?(?:\d{1,2}[-/.][A-Za-z]{3,9}[-/.]\d{2,4}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{4}[-/.]\d{1,2}[-/.]\d{1,2})\)?[,;]?$/;
const MONEY_TOKEN = /^[(\-]?(?:INR|Rs\.?|₹|\$|€|£)?\s?\d{1,3}(?:[,\s]\d{2,3})*(?:\.\d{1,2})?[)\-]?(?:\s?(?:Dr|Cr|DR|CR))?$/;

/* ==========================================================================
   5. Categorisation
   ========================================================================== */

const CATEGORY_RULES = [
  ['Income', /\b(salary|sal cr|payroll|interest credit|int\.?cr|dividend|intdiv|refund|cashback|reversal|bonus)\b/i],
  ['Investments', /\b(groww|zerodha|coin|sip|mutual fund|mf purchase|nps|ppf|elss|sgb|indmoney|kuvera|smallcase|upstox|icicidirect)\b/i],
  ['Transfers', /\b(self|own account|inft|neft|imps|rtgs|fund transfer|transfer to|transfer from|ccbillpay|cc billpay|credit card payment|card payment|bill ?pay)\b/i],
  ['Groceries', /\b(bigbasket|blinkit|zepto|dmart|d-?mart|grofers|instamart|reliance fresh|more retail|spencer|kirana|grocer|supermarket|vegetable|fruit)\b/i],
  ['Food & drink', /\b(swiggy|zomato|restaurant|cafe|café|coffee|koffe|tokai|starbucks|chaayos|dominos|pizza|mcdonald|kfc|burger|bakery|dining|dhaba|eatery|biryani|food)\b/i],
  ['Transport', /\b(uber|ola|rapido|metro|irctc|fuel|petrol|diesel|hpcl|bpcl|iocl|indian oil|shell|cab|taxi|parking|fastag|toll|bus|blusmart)\b/i],
  ['Travel', /\b(flight|indigo|vistara|spicejet|air india|akasa|hotel|airbnb|oyo|makemytrip|goibibo|cleartrip|yatra|booking\.com|travel|tourism)\b/i],
  ['Shopping', /\b(amazon|flipkart|myntra|ajio|nykaa|meesho|tatacliq|decathlon|ikea|lifestyle|shoppers stop|westside|zara|h&m|uniqlo|croma|reliance digital|store|retail|mart|shopping)\b/i],
  ['Bills & utilities', /\b(electric|bses|tata power|adani electricity|water bill|gas bill|indane|lpg|mobile|airtel|jio|vodafone|vi postpaid|bsnl|broadband|wifi|act fibernet|hathway|recharge|dth|tata sky|postpaid|utility|bill desk|billdesk)\b/i],
  ['Rent & home', /\b(rent|nobroker|landlord|maintenance|society|housing|urban company|urbanclap|cleaning|plumber|electrician)\b/i],
  ['Health', /\b(pharmacy|apollo|medplus|1mg|pharmeasy|netmeds|medical|hospital|clinic|doctor|diagnostic|lab|health|dental|medi)\b/i],
  ['Entertainment', /\b(netflix|prime video|hotstar|jiocinema|spotify|youtube premium|gaana|bookmyshow|pvr|inox|cinema|movie|gaming|steam|playstation|xbox)\b/i],
  ['Education', /\b(school|college|university|tuition|course|udemy|coursera|byju|unacademy|vedantu|exam fee|books)\b/i],
  ['Fees & charges', /\b(charge|charges|fee|fees|gst|penalty|late payment|annual fee|processing|amc|sms chg|min bal|mab chg|chrg)\b/i],
  ['Cash', /\b(atm|cash wdl|cash withdrawal|cash dep|nwd|atw)\b/i]
];

function categorize(text, amount) {
  const s = String(text || '');
  for (const [name, re] of CATEGORY_RULES) {
    if (re.test(s)) {
      // "Transfer" wording on an incoming amount is still a transfer, but an
      // obvious salary credit should win over a generic NEFT match.
      if (name === 'Transfers' && /\b(salary|payroll)\b/i.test(s)) return 'Income';
      return name;
    }
  }
  if (Number(amount) > 0) return 'Income';
  return 'Other';
}

/* ==========================================================================
   6. Delimited / OFX / QIF parsers
   ========================================================================== */

function splitDelimited(line, delimiter) {
  const out = [];
  let value = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && line[i + 1] === '"' && quoted) { value += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (c === delimiter && !quoted) { out.push(value.trim()); value = ''; }
    else value += c;
  }
  out.push(value.trim());
  return out;
}

function parseDelimited(text) {
  text = text.replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter(l => l.trim() && !/^sep\s*=/i.test(l.trim()));
  if (lines.length < 2) throw new Error('This file needs a header row and at least one transaction.');

  const norm = h => h.toLowerCase().replace(/[^a-z0-9]/g, '');
  let delimiter = ',', headerAt = -1, headers = [];

  outer:
  for (const d of [',', ';', '\t', '|']) {
    for (let n = 0; n < Math.min(30, lines.length - 1); n++) {
      const h = splitDelimited(lines[n], d).map(norm);
      const hasDate = h.some(x => /(date|txn)/.test(x));
      const hasDesc = h.some(x => /(description|narration|merchant|details|memo|particulars|payee|remarks|transaction)/.test(x));
      const hasAmount = h.some(x => /(amount|debit|withdrawal|credit|deposit|paidout|paidin)/.test(x));
      if (hasDate && hasDesc && hasAmount) { delimiter = d; headerAt = n; headers = h; break outer; }
    }
  }
  if (headerAt < 0) {
    throw new Error('Could not find a transaction header row. Expected columns for date, description/narration, and amount or debit/credit.');
  }

  const ix = keys => headers.findIndex(h => keys.some(k => h === k || h.includes(k)));
  const iDate = ix(['transactiondate', 'txndate', 'valuedate', 'postingdate', 'posteddate', 'date']);
  const iDesc = ix(['description', 'narration', 'merchant', 'details', 'memo', 'particulars', 'payee', 'remarks', 'transactionremarks']);
  const iAmount = ix(['transactionamount', 'amount']);
  const iDebit = ix(['withdrawal', 'debit', 'paidout', 'withdrawalamount']);
  const iCredit = ix(['deposit', 'credit', 'paidin', 'depositamount']);
  const iBalance = ix(['closingbalance', 'runningbalance', 'balanceaftertransaction', 'availablebalance', 'balance']);
  const iCat = ix(['category']);

  if (iDate < 0 || iDesc < 0 || (iAmount < 0 && iDebit < 0 && iCredit < 0)) {
    throw new Error('Found a header row but could not identify the columns. Check the date, description, debit, credit and amount headings.');
  }

  const rows = [];
  let skipped = 0;

  for (const line of lines.slice(headerAt + 1)) {
    const r = splitDelimited(line, delimiter);
    if (!r.some(Boolean)) continue;
    const date = normalizeDate(r[iDate] || '');
    const description = String(r[iDesc] || '').trim();
    if (!date || !description) { skipped++; continue; }

    let amount = NaN, column = 'amount';
    const debit = iDebit >= 0 ? parseMoney(r[iDebit]) : NaN;
    const credit = iCredit >= 0 ? parseMoney(r[iCredit]) : NaN;

    if (iAmount >= 0 && String(r[iAmount] || '').trim()) {
      amount = parseMoney(r[iAmount]);
      const marker = String(r[iAmount]).toUpperCase();
      if (/\bDR\b|\bDEBIT\b/.test(marker)) amount = -Math.abs(amount);
      else if (/\bCR\b|\bCREDIT\b/.test(marker)) amount = Math.abs(amount);
    } else if (Number.isFinite(debit) && Math.abs(debit) > 0) { amount = -Math.abs(debit); column = 'debit'; }
    else if (Number.isFinite(credit) && Math.abs(credit) > 0) { amount = Math.abs(credit); column = 'credit'; }

    if (!Number.isFinite(amount) || amount === 0) { skipped++; continue; }

    const balance = iBalance >= 0 ? parseMoney(r[iBalance]) : NaN;
    rows.push({
      id: uid(), date, description,
      amount, column,
      category: iCat >= 0 && r[iCat] ? categorize(r[iCat] + ' ' + description, amount) : categorize(description, amount),
      statementBalance: Number.isFinite(balance) ? balance : undefined
    });
  }

  if (!rows.length) {
    throw new Error('Headers were found but no usable transactions — check the date and amount formats (' + skipped + ' rows skipped).');
  }

  return finishParse(rows, { skipped, source: 'csv' });
}

function parseOFX(text) {
  const rows = [];
  const blocks = text.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) || [];
  for (const b of blocks) {
    const get = tag => (b.match(new RegExp('<' + tag + '>([^\\r\\n<]+)', 'i')) || [])[1] || '';
    const date = normalizeDate(get('DTPOSTED').slice(0, 8));
    const amount = Number(get('TRNAMT'));
    const description = (get('NAME') || get('MEMO') || 'Statement transaction').trim();
    if (date && Number.isFinite(amount) && amount !== 0) {
      rows.push({ id: uid(), date, description, amount, column: 'amount', category: categorize(description, amount) });
    }
  }
  if (!rows.length) throw new Error('No transactions found in this OFX/QFX file. Try a CSV export instead.');
  return finishParse(rows, { skipped: 0, source: 'ofx' });
}

function parseQIF(text) {
  const rows = [];
  for (const b of text.split('^')) {
    const d = (b.match(/\bD([^\r\n]+)/) || [])[1];
    const p = (b.match(/\bP([^\r\n]+)/) || [])[1];
    const a = (b.match(/\bT(-?[\d,.]+)/) || [])[1];
    if (!d || !p || !a) continue;
    const date = normalizeDate(d), amount = parseMoney(a);
    if (date && Number.isFinite(amount) && amount !== 0) {
      rows.push({ id: uid(), date, description: p.trim(), amount, column: 'amount', category: categorize(p, amount) });
    }
  }
  if (!rows.length) throw new Error('No transactions found in this QIF file.');
  return finishParse(rows, { skipped: 0, source: 'qif' });
}

/* ==========================================================================
   7. PDF engine
   --------------------------------------------------------------------------
   Three stages:
     a) load PDF.js from a CDN, trying several sources
     b) turn each page into positioned text lines
     c) turn those lines into transactions, using the header row to locate the
        money columns and the running-balance column to verify every sign
   ========================================================================== */

/* Several candidate sources. The first that imports wins. Each entry must
   expose both the library and a matching worker so versions never mix. */
const PDFJS_SOURCES = [
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/',
  'https://unpkg.com/pdfjs-dist@4.8.69/build/',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.149/build/',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/',
  'https://unpkg.com/pdfjs-dist@6.4.299/build/'
];

const PDFJS_TIMEOUT_MS = 20000;
let pdfjsLib = null;

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label + ' timed out after ' + Math.round(ms / 1000) + 's')), ms);
    })
  ]);
}

/** Load PDF.js once, trying each CDN in turn. Errors are collected so the
 *  failure message can say what actually went wrong rather than "failed". */
async function loadPdfJs(onProgress) {
  if (pdfjsLib) return pdfjsLib;
  const failures = [];
  for (const base of PDFJS_SOURCES) {
    try {
      if (onProgress) onProgress('Loading the PDF reader from ' + new URL(base).hostname + '…');
      const lib = await withTimeout(import(/* webpackIgnore: true */ base + 'pdf.min.mjs'), PDFJS_TIMEOUT_MS, 'PDF reader download');
      if (!lib || typeof lib.getDocument !== 'function') throw new Error('unexpected module shape');
      lib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs';
      pdfjsLib = lib;
      return lib;
    } catch (err) {
      failures.push(new URL(base).hostname + ': ' + (err && err.message ? err.message : 'failed'));
    }
  }
  throw new Error(
    'Could not load the PDF reader from any CDN. Your PDF never left this device. ' +
    'Check your internet connection or any content blocker, then try again. ' +
    'Details — ' + failures.join(' | ')
  );
}

/**
 * Split a text item into word tokens with estimated positions, but only when
 * it contains two or more numbers. PDF.js sometimes merges a whole row's
 * numeric cells into one item, which would otherwise destroy column detection.
 */
function tokenizeItem(item) {
  const text = item.text;
  const numberCount = (text.match(/\d[\d,]*\.?\d*/g) || []).length;
  if (numberCount < 2 || !/\s/.test(text)) return [item];

  const perChar = item.w / Math.max(1, text.length);
  const out = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(text))) {
    out.push({
      x: item.x + m.index * perChar,
      w: m[0].length * perChar,
      y: item.y,
      text: m[0]
    });
  }
  return out.length ? out : [item];
}

/** Turn one PDF page into y-sorted lines of x-sorted tokens. */
async function pageToLines(page) {
  const content = await page.getTextContent();
  const tokens = [];

  for (const item of content.items) {
    const text = String(item.str || '').trim();
    if (!text || !item.transform) continue;
    const base = {
      x: item.transform[4],
      y: item.transform[5],
      w: Number.isFinite(item.width) && item.width > 0 ? item.width : text.length * 4.2,
      text
    };
    tokens.push(...tokenizeItem(base));
  }

  const lines = [];
  for (const t of tokens) {
    let line = lines.find(l => Math.abs(l.y - t.y) < 2.6);
    if (!line) { line = { y: t.y, tokens: [] }; lines.push(line); }
    line.tokens.push(t);
  }

  lines.sort((a, b) => b.y - a.y);                       // top of page first
  for (const l of lines) {
    l.tokens.sort((a, b) => a.x - b.x);
    l.text = l.tokens.map(t => t.text).join(' ');
  }
  return lines;
}

/** Which kind of column is this header text? */
function classifyHeader(text) {
  const h = String(text).toLowerCase().replace(/[^a-z]/g, '');
  if (!h) return null;
  if (/^(sno|srno|serial|slno|sr|si|no)$/.test(h) || /serialno|slno|srno/.test(h)) return 'serial';
  if (/cheque|chq|check|refno|referenceno|utr/.test(h)) return 'reference';
  if (/withdrawal|debitamount|amountdebit|paidout|withdrawals|dr$/.test(h) || /^debit/.test(h)) return 'debit';
  if (/deposit|creditamount|amountcredit|paidin|deposits/.test(h) || /^credit/.test(h)) return 'credit';
  if (/runningbalance|closingbalance|availablebalance|balanceinr|balance/.test(h)) return 'balance';
  if (/amount/.test(h)) return 'amount';
  if (/valuedate|transactiondate|postingdate|txndate|date|txn/.test(h)) return 'date';
  if (/description|narration|particular|remarks|merchant|payee|details|transactiondetails/.test(h)) return 'description';
  if (/^category$/.test(h)) return 'category';
  return null;
}

/**
 * Find the money columns on a page by locating its header row.
 * Returns { columns: [{type, left, right}], moneyStart } or null.
 *
 * Header text is often stacked across two or three lines
 * ("Withdrawal" / "Amount (INR)"), so tokens are clustered by x across the
 * candidate header lines before being classified.
 */
function detectColumns(lines) {
  const scan = lines.slice(0, Math.min(26, lines.length));
  const all = [];

  scan.forEach((line, li) => {
    for (const t of line.tokens) {
      const type = classifyHeader(t.text);
      if (type) all.push({ x: t.x, right: t.x + t.w, type, text: t.text, li });
    }
  });
  if (!all.length) return null;

  /* A real header is a tight band of 1–3 consecutive lines. Scanning a flat
     list of "any line that contains a header-ish word" picks up prose — an
     ICICI statement ends with a glossary containing the words "credit",
     "Debit", "Withdrawal" and "cheque", which would otherwise be mistaken for
     the table header. So score every 3-line window and keep the best one. */
  const WINDOW = 3;
  let best = null;
  for (let start = 0; start < scan.length; start++) {
    const inWindow = all.filter(c => c.li >= start && c.li < start + WINDOW);
    if (!inWindow.length) continue;
    const types = new Set(inWindow.map(c => c.type));
    const moneyTypes = ['debit', 'credit', 'amount', 'balance'].filter(t => types.has(t)).length;
    if (!moneyTypes) continue;
    const anchorTypes = ['date', 'description', 'serial'].filter(t => types.has(t)).length;
    // Money columns are what we actually need; date/description presence is
    // strong corroboration that this really is the table header.
    const score = moneyTypes * 3 + anchorTypes * 2;
    if (!best || score > best.score) best = { score, start, candidates: inWindow, moneyTypes };
  }
  if (!best) return null;

  const candidates = best.candidates;

  // Cluster by horizontal proximity.
  const clusters = [];
  for (const c of candidates.sort((a, b) => a.x - b.x)) {
    const hit = clusters.find(cl => Math.abs(cl.left - c.x) < 26 || (c.x < cl.right + 6 && c.x >= cl.left - 6));
    if (hit) {
      hit.left = Math.min(hit.left, c.x);
      hit.right = Math.max(hit.right, c.right);
      hit.parts.push(c.text);
      hit.lastLine = Math.max(hit.lastLine, c.li);
    } else {
      clusters.push({ left: c.x, right: c.right, parts: [c.text], lastLine: c.li });
    }
  }

  const columns = [];
  for (const cl of clusters) {
    // Classify on the joined text so "Amount" + "Withdrawal" resolves to debit.
    const joined = cl.parts.join(' ');
    let type = classifyHeader(joined.replace(/\s+/g, ''));
    if (!type) {
      for (const part of cl.parts) { type = classifyHeader(part); if (type) break; }
    }
    if (type) columns.push({ type, left: cl.left, right: cl.right, lastLine: cl.lastLine });
  }

  const money = columns.filter(c => ['debit', 'credit', 'amount', 'balance'].includes(c.type))
    .sort((a, b) => a.left - b.left);
  if (!money.length) return null;

  // Keep one column per type, the rightmost wins for balance.
  const deduped = [];
  for (const c of money) {
    const existing = deduped.find(d => d.type === c.type);
    if (!existing) deduped.push(c);
    else if (c.left > existing.left && c.type === 'balance') Object.assign(existing, c);
  }

  const headerLine = Math.max(0, ...columns.map(c => c.lastLine));
  return {
    columns: deduped,
    moneyStart: Math.min(...deduped.map(c => c.left)) - 10,
    headerLine,
    hasDateHeader: columns.some(c => c.type === 'date'),
    hasDescHeader: columns.some(c => c.type === 'description')
  };
}

/**
 * Fallback column detection: cluster the right edges of money-looking tokens
 * that sit in the right half of the page. Used when the header row cannot be
 * classified (unusual layouts, image headers, cropped exports).
 */
function detectColumnsByValues(lines, pageWidth) {
  const edges = [];
  for (const line of lines) {
    if (!line.tokens.some(t => DATE_TOKEN.test(t.text))) continue;
    for (const t of line.tokens) {
      if (!MONEY_TOKEN.test(t.text)) continue;
      if (t.x < pageWidth * 0.4) continue;
      edges.push(t.x + t.w);
    }
  }
  if (edges.length < 4) return null;

  edges.sort((a, b) => a - b);
  const clusters = [];
  for (const e of edges) {
    const hit = clusters.find(c => Math.abs(c.right - e) < 14);
    if (hit) { hit.right = (hit.right * hit.n + e) / (hit.n + 1); hit.n++; }
    else clusters.push({ right: e, n: 1 });
  }
  // Only keep clusters that appear on a meaningful share of rows.
  const strong = clusters.filter(c => c.n >= 2).sort((a, b) => a.right - b.right);
  if (!strong.length) return null;

  let types;
  if (strong.length >= 3) types = ['debit', 'credit', 'balance'];
  else if (strong.length === 2) types = ['amount', 'balance'];
  else types = ['amount'];

  const picked = strong.slice(-types.length);
  const columns = picked.map((c, i) => ({ type: types[i], left: c.right - 60, right: c.right }));
  return {
    columns,
    moneyStart: columns[0].left - 10,
    headerLine: 0,
    hasDateHeader: false,
    hasDescHeader: false,
    inferred: true
  };
}

/**
 * Decide whether a newly detected layout should replace the one carried over
 * from earlier pages. A trailing page of prose (ICICI prints a glossary of
 * transaction codes on the last page) can yield a thin, wrong layout; letting
 * it overwrite a confident three-column header silently corrupts the tail of
 * the statement, so a weaker detection is ignored.
 */
function preferLayout(prev, next) {
  if (!next) return prev;
  if (!prev) return next;
  const strength = l => (l.columns.length * 2) + (l.inferred ? 0 : 1) +
    (l.hasDateHeader ? 1 : 0) + (l.hasDescHeader ? 1 : 0);
  return strength(next) >= strength(prev) ? next : prev;
}

/** Assign a money token to the nearest column, matching on right edge first
 *  because statement amounts are right-aligned. */
function assignMoneyColumn(token, columns) {
  const tokenRight = token.x + token.w;
  let best = null, bestScore = Infinity;
  for (const c of columns) {
    const score = Math.min(Math.abs(tokenRight - c.right), Math.abs(token.x - c.left) * 1.4);
    if (score < bestScore) { bestScore = score; best = c; }
  }
  return bestScore <= 70 ? best : null;
}

/** Median gap between consecutive text lines — used to decide whether a line
 *  above a transaction row belongs to it or to the row before. */
function medianLineGap(lines) {
  const gaps = [];
  for (let i = 1; i < lines.length; i++) {
    const g = lines[i - 1].y - lines[i].y;
    if (g > 0.5 && g < 60) gaps.push(g);
  }
  if (!gaps.length) return 10;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

const FOOTER_NOISE = /(page\s+\d+\s+of|this is a system generated|do not reply|registered office|customer care|dial your bank|never share your|legends for transactions|terms and conditions|please call from)/i;

/**
 * Turn the lines of one page into partially-resolved rows.
 * Amount signs are NOT final here — resolveSigns() settles them using the
 * running balance once all pages are combined.
 */
function linesToRows(lines, layout, pageNo, diag) {
  const gap = medianLineGap(lines);
  /* Banks mix tight (≈5pt) and normal (≈10pt) leading on the same page: the
     payee name often sits one tight line ABOVE its amount row while wrapped
     remarks sit one or two normal lines BELOW it. A single "is it closer than
     0.75 of the median gap" test gets one of those two cases wrong whichever
     way the median falls, so instead each stray text line is attached to
     whichever amount row is nearest vertically, within a bounded distance. */
  const attachMax = Math.max(14, gap * 2.2);

  const startLine = layout.headerLine != null && !layout.inferred ? layout.headerLine + 1 : 0;

  const rows = [];      // amount rows, in page order
  const strays = [];    // text-only lines awaiting attachment
  let current = null;   // last amount row, for number-only continuation lines

  for (let li = startLine; li < lines.length; li++) {
    const line = lines[li];
    if (!line.tokens.length) continue;
    if (FOOTER_NOISE.test(line.text)) continue;

    const left = [], money = [];
    for (const t of line.tokens) {
      if (t.x >= layout.moneyStart) money.push(t); else left.push(t);
    }

    const dateIndex = left.findIndex(t => DATE_TOKEN.test(t.text) && normalizeDate(t.text));
    const isRowLine = dateIndex >= 0 && money.length > 0;

    if (isRowLine) {
      const descTokens = left.filter((t, i) => i !== dateIndex && !/^\d{1,5}$/.test(t.text));
      const inline = descTokens.map(t => t.text).join(' ').trim();

      current = {
        page: pageNo,
        y: line.y,
        date: normalizeDate(left[dateIndex].text),
        above: [],
        inline: inline ? [inline] : [],
        below: [],
        cells: {}
      };
      rows.push(current);

      for (const t of money) {
        const col = assignMoneyColumn(t, layout.columns);
        if (col) (current.cells[col.type] = current.cells[col.type] || []).push(t.text);
      }
    } else if (money.length && current && !left.length) {
      // A continuation line carrying only numbers — append to the current row.
      for (const t of money) {
        const col = assignMoneyColumn(t, layout.columns);
        if (col) (current.cells[col.type] = current.cells[col.type] || []).push(t.text);
      }
    } else if (left.length) {
      const text = left.map(t => t.text).join(' ').trim();
      if (text) strays.push({ y: line.y, text });
    }
  }

  /* Second pass: nearest-row attachment. Ties favour the row below, because a
     name printed between two rows belongs to the transaction it introduces. */
  for (const s of strays) {
    let best = null, bestDist = Infinity, bestBelowStray = false;
    for (const r of rows) {
      const dist = Math.abs(r.y - s.y);
      const rowIsBelow = r.y < s.y;
      if (dist > attachMax) continue;
      if (dist < bestDist - 0.01 || (Math.abs(dist - bestDist) <= 0.01 && rowIsBelow && !bestBelowStray)) {
        best = r; bestDist = dist; bestBelowStray = rowIsBelow;
      }
    }
    if (!best) continue;
    (best.y < s.y ? best.above : best.below).push(s);
  }

  for (const r of rows) {
    r.above.sort((a, b) => b.y - a.y);
    r.below.sort((a, b) => b.y - a.y);
    r.descParts = r.above.map(s => s.text)
      .concat(r.inline)
      .concat(r.below.map(s => s.text));
    delete r.above; delete r.below; delete r.inline;
  }

  if (diag && rows.length === 0) {
    diag.push('Page ' + pageNo + ': no rows. moneyStart=' + Math.round(layout.moneyStart) +
      ' columns=' + layout.columns.map(c => c.type + '@' + Math.round(c.right)).join(','));
  }
  return rows;
}

/** Convert raw page rows into transaction candidates. */
function rowsToTransactions(rawRows, diag) {
  const out = [];
  for (const r of rawRows) {
    const description = (Array.isArray(r.descParts) ? r.descParts : [])
      .flat().join(' ').replace(/\s+/g, ' ').trim();

    const debit = pickMoney(r.cells.debit);
    const credit = pickMoney(r.cells.credit);
    const plain = pickMoney(r.cells.amount);
    const balance = pickMoney(r.cells.balance);

    let magnitude = NaN, column = 'amount', marker = 0;

    if (Number.isFinite(debit) && Math.abs(debit) > 0) { magnitude = Math.abs(debit); column = 'debit'; }
    else if (Number.isFinite(credit) && Math.abs(credit) > 0) { magnitude = Math.abs(credit); column = 'credit'; }
    else if (Number.isFinite(plain) && Math.abs(plain) > 0) {
      magnitude = Math.abs(plain);
      const raw = (r.cells.amount || []).join(' ').toUpperCase();
      if (/\bDR\b|\bDEBIT\b/.test(raw) || /^-/.test(raw.trim())) marker = -1;
      else if (/\bCR\b|\bCREDIT\b/.test(raw)) marker = 1;
    }

    if (!Number.isFinite(magnitude) || magnitude === 0) continue;
    if (!r.date) continue;

    out.push({
      id: uid(),
      page: r.page,
      date: r.date,
      description: description || 'Statement transaction',
      magnitude,
      column,
      marker,
      statementBalance: Number.isFinite(balance) ? balance : undefined
    });
  }
  if (diag) diag.push('Row candidates with a usable amount: ' + out.length + ' of ' + rawRows.length);
  return out;

  function pickMoney(cell) {
    if (!cell || !cell.length) return NaN;
    for (const part of cell) {
      const n = parseMoney(part);
      if (Number.isFinite(n) && n !== 0) return n;
    }
    return NaN;
  }
}

/**
 * Settle every amount's sign.
 * The running-balance column is authoritative when present: the change between
 * consecutive balances tells us unambiguously whether money came in or out,
 * and it self-corrects any mistake in column detection.
 */
function resolveSigns(rows, diag) {
  let fromBalance = 0, fromColumn = 0, disagreements = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const columnSign = row.column === 'debit' ? -1 : row.column === 'credit' ? 1 : (row.marker || 0);
    let resolved = null;

    const prev = rows[i - 1];
    if (Number.isFinite(row.statementBalance) && prev && Number.isFinite(prev.statementBalance)) {
      const delta = row.statementBalance - prev.statementBalance;
      const tolerance = Math.max(0.05, row.magnitude * 0.0005);
      if (Math.abs(Math.abs(delta) - row.magnitude) <= tolerance) {
        resolved = delta < 0 ? -1 : 1;
        fromBalance++;
        if (columnSign && columnSign !== resolved) disagreements++;
      }
    }

    if (resolved === null && columnSign) { resolved = columnSign; fromColumn++; }

    if (resolved === null) {
      // Last resort: a credit-looking description is money in.
      const guess = categorize(row.description, 0);
      resolved = guess === 'Income' ? 1 : -1;
    }

    row.amount = resolved * row.magnitude;
  }

  if (diag) {
    diag.push('Signs resolved — ' + fromBalance + ' from the balance column, ' + fromColumn + ' from debit/credit columns.');
    if (disagreements) diag.push('Note: ' + disagreements + ' row(s) had a column that disagreed with the running balance; the balance was trusted.');
  }
  return rows;
}

/* --- Statement-level summary (opening / closing / additions / spends) ----- */

const SUMMARY_PATTERNS = [
  ['opening', /(opening\s+balance|balance\s+b\s*\/?\s*f|brought\s+forward|previous\s+balance|opening\s+bal|past\s+dues?)\s*[:\-]?\s*(?:INR|Rs\.?|₹)?\s*([\d,]+\.?\d{0,2})/i],
  ['closing', /(closing\s+balance|balance\s+c\s*\/?\s*f|carried\s+forward|closing\s+bal|total\s+amount\s+due|total\s+dues?)\s*[:\-]?\s*(?:INR|Rs\.?|₹)?\s*([\d,]+\.?\d{0,2})/i],
  ['additions', /(total\s+deposits?|total\s+credits?|payments?\s*(?:,|\/|and)?\s*credits?|deposits?\s*(?:amount)?\s*total|credit\s+amount\s+total)\s*[:\-]?\s*(?:INR|Rs\.?|₹)?\s*([\d,]+\.?\d{0,2})/i],
  ['spends', /(total\s+withdrawals?|total\s+debits?|purchases?\s*(?:,|\/|and)?\s*(?:debits?|charges?)|withdrawals?\s*(?:amount)?\s*total|debit\s+amount\s+total)\s*[:\-]?\s*(?:INR|Rs\.?|₹)?\s*([\d,]+\.?\d{0,2})/i],
  ['creditLimit', /(credit\s+limit)\s*[:\-]?\s*(?:INR|Rs\.?|₹)?\s*([\d,]+\.?\d{0,2})/i],
  ['minimumDue', /(minimum\s+amount\s+due|min\.?\s+amount\s+due|minimum\s+due)\s*[:\-]?\s*(?:INR|Rs\.?|₹)?\s*([\d,]+\.?\d{0,2})/i]
];

function extractSummary(fullText) {
  const summary = {};
  const text = fullText.replace(/\s+/g, ' ');

  for (const [key, re] of SUMMARY_PATTERNS) {
    const m = text.match(re);
    if (m) {
      const value = parseMoney(m[2]);
      if (Number.isFinite(value)) summary[key] = value;
    }
  }

  const account = text.match(/(?:account|a\/c|card)\s*(?:no\.?|number)?\s*[:\-]?\s*([Xx*\d]{6,24})/i);
  if (account) summary.accountNumber = account[1];

  const period = text.match(/(?:for\s+the\s+period|statement\s+period|period\s+from|from)\s*[:\-]?\s*([A-Za-z0-9,.\/\- ]{6,22}?)\s*(?:to|-|–|through)\s*([A-Za-z0-9,.\/\- ]{6,22}?)(?:\s|$|\.)/i);
  if (period) {
    const from = normalizeDate(period[1].trim()), to = normalizeDate(period[2].trim());
    if (from) summary.periodFrom = from;
    if (to) summary.periodTo = to;
  }

  const due = text.match(/(?:payment\s+due\s+date|due\s+date)\s*[:\-]?\s*([A-Za-z0-9,.\/\- ]{6,22}?)(?:\s{2}|$|\s[A-Z])/i);
  if (due) { const d = normalizeDate(due[1].trim()); if (d) summary.dueDate = d; }

  return summary;
}

/* --- The PDF entry point ------------------------------------------------- */

async function parsePDF(file, options) {
  const opts = options || {};
  const onProgress = opts.onProgress || function () {};
  const diag = [];

  const lib = await loadPdfJs(onProgress);
  const buffer = await file.arrayBuffer();

  let doc, task;
  try {
    onProgress('Opening the document…');
    task = lib.getDocument({
      data: new Uint8Array(buffer.slice(0)),
      password: opts.password || undefined,
      isEvalSupported: false,
      useSystemFonts: false
    });
    doc = await withTimeout(task.promise, 45000, 'Opening the PDF');
  } catch (err) {
    const name = err && (err.name || '');
    if (name === 'PasswordException' || /password/i.test(err && err.message || '')) {
      const needsPassword = new Error(
        opts.password
          ? 'That password did not open the statement. Indian banks often use a format like the first four letters of your name plus your date of birth — check the covering email.'
          : 'This statement is password protected. Enter the password your bank sent and try again.'
      );
      needsPassword.code = 'PASSWORD';
      throw needsPassword;
    }
    if (/invalid|corrupt|structure/i.test(err && err.message || '')) {
      throw new Error('This file could not be read as a PDF. If you saved it from an email preview, try downloading the original attachment.');
    }
    throw new Error('Could not open the PDF: ' + (err && err.message ? err.message : 'unknown error'));
  }

  try {
    if (doc.numPages > 400) {
      throw new Error('This PDF has ' + doc.numPages + ' pages. Split it into smaller statements and import them one at a time.');
    }

    const allText = [];
    let rawRows = [];
    let layout = null;
    let pageWidth = 595;

    for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
      onProgress('Reading page ' + pageNo + ' of ' + doc.numPages + '…', pageNo / doc.numPages);
      const page = await doc.getPage(pageNo);
      try {
        pageWidth = page.view ? (page.view[2] - page.view[0]) : pageWidth;
        const lines = await pageToLines(page);
        allText.push(lines.map(l => l.text).join('\n'));

        // Each page usually repeats the header; if it does, re-detect so a
        // layout change mid-document is handled. Otherwise reuse the last one.
        const detected = detectColumns(lines) || (layout ? null : detectColumnsByValues(lines, pageWidth));
        layout = preferLayout(layout, detected);
        if (!layout) continue;

        rawRows = rawRows.concat(linesToRows(lines, layout, pageNo, diag));
      } finally {
        page.cleanup();
      }
    }

    const fullText = allText.join('\n');

    if (!fullText.replace(/\s/g, '').length) {
      throw new Error(
        'No selectable text was found in this PDF, so it is almost certainly a scan or an image-only export. ' +
        'Stillwell does not include OCR. Ask your bank for the text PDF or a CSV/Excel export of the same period.'
      );
    }

    if (!layout) {
      lastDiagnostics = buildDiagnostics(diag, fullText);
      throw new Error(
        'The text was extracted but the transaction table could not be located — no column headings for amount, ' +
        'withdrawal/deposit or balance were recognised. Open the details below and share them, or use a CSV export.'
      );
    }

    diag.unshift('Columns detected: ' + layout.columns.map(c => c.type + ' (right edge ' + Math.round(c.right) + ')').join(', ') +
      (layout.inferred ? ' [inferred from values, no usable header]' : ''));

    let transactions = rowsToTransactions(rawRows, diag);
    transactions.sort((a, b) => a.date.localeCompare(b.date) || a.page - b.page);
    resolveSigns(transactions, diag);

    transactions = transactions
      .filter(t => Number.isFinite(t.amount) && t.amount !== 0)
      .map(t => ({
        id: t.id,
        date: t.date,
        description: t.description,
        amount: t.amount,
        column: t.column,
        category: categorize(t.description, t.amount),
        statementBalance: t.statementBalance
      }));

    if (!transactions.length) {
      lastDiagnostics = buildDiagnostics(diag, fullText);
      throw new Error(
        'The table was found but no transaction rows could be read from it. Open the details below — the first ' +
        'extracted lines are shown there — or use a CSV export of the same period.'
      );
    }

    lastDiagnostics = buildDiagnostics(diag, fullText);
    return finishParse(transactions, {
      skipped: Math.max(0, rawRows.length - transactions.length),
      source: 'pdf',
      summary: extractSummary(fullText),
      pages: doc.numPages
    });
  } finally {
    try { await doc.destroy(); } catch (e) { /* already gone */ }
    try { if (task && task.destroy) await task.destroy(); } catch (e) { /* already gone */ }
  }
}

function buildDiagnostics(diag, fullText) {
  const head = (fullText || '').split('\n').filter(l => l.trim()).slice(0, 45).join('\n');
  return diag.join('\n') + '\n\n--- first extracted lines ---\n' + head;
}

/* --- Shared post-processing --------------------------------------------- */

/**
 * Attach derived figures to a parse result: opening/closing balances,
 * additions, spends, and the months the statement covers.
 */
function finishParse(rows, meta) {
  rows.sort((a, b) => a.date.localeCompare(b.date));

  const additions = rows.filter(r => r.amount > 0).reduce((n, r) => n + r.amount, 0);
  const spends = rows.filter(r => r.amount < 0).reduce((n, r) => n + Math.abs(r.amount), 0);

  const withBalance = rows.filter(r => Number.isFinite(r.statementBalance));
  let opening = null, closing = null, balanceSource = 'none';

  if (withBalance.length) {
    const first = withBalance[0], last = withBalance[withBalance.length - 1];
    opening = round2(first.statementBalance - first.amount);
    closing = round2(last.statementBalance);
    balanceSource = 'balance-column';
  }

  const summary = (meta && meta.summary) || {};
  if (Number.isFinite(summary.opening)) { opening = summary.opening; balanceSource = 'statement-summary'; }
  if (Number.isFinite(summary.closing)) { closing = summary.closing; balanceSource = 'statement-summary'; }

  const months = [...new Set(rows.map(r => monthKey(r.date)))].sort();

  const result = {
    rows,
    skipped: (meta && meta.skipped) || 0,
    source: (meta && meta.source) || 'file',
    summary,
    opening, closing, additions, spends, balanceSource, months,
    hasBalance: withBalance.length > 0,
    from: rows.length ? rows[0].date : null,
    to: rows.length ? rows[rows.length - 1].date : null
  };
  return result;
}

const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

/* ==========================================================================
   9. Analytics — month-on-month aggregation
   --------------------------------------------------------------------------
   Everything the charts and tables need is derived here, once per render, from
   state.transactions plus the per-import statement records. Nothing is cached
   across renders: the data set is small (a few thousand rows at most) and a
   stale cache is a far worse bug than a few milliseconds of recomputation.
   ========================================================================== */

/** Transactions for one account, or all of them, oldest first. */
function txFor(accountId) {
  const rows = accountId && accountId !== 'all'
    ? state.transactions.filter(t => t.account === accountId)
    : state.transactions.slice();
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

/** Every month that has activity, oldest first: ['2026-04', '2026-05', …]. */
function monthsIn(rows) {
  return [...new Set(rows.map(t => monthKey(t.date)))].filter(Boolean).sort();
}

/** Fill the gaps so a quiet month still appears on the axis. */
function monthRange(from, to) {
  if (!from || !to) return [];
  const out = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  let guard = 0;
  while ((y < ty || (y === ty && m <= tm)) && guard++ < 240) {
    out.push(y + '-' + String(m).padStart(2, '0'));
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

/**
 * Per-month additions / spends / net / opening / closing for one account.
 *
 * Opening and closing are exact when the statement carried a running-balance
 * column; otherwise they are chained from the balance you entered on the
 * account and flagged as estimates, because a derived balance that silently
 * looks exact is the kind of number people act on by mistake.
 */
function monthlySeries(accountId) {
  const rows = txFor(accountId);
  if (!rows.length) return [];

  const keys = monthRange(monthKey(rows[0].date), monthKey(rows[rows.length - 1].date));
  const byKey = new Map(keys.map(k => [k, {
    key: k,
    additions: 0, spends: 0, net: 0, count: 0,
    opening: null, closing: null, estimated: true,
    exactOpening: null, exactClosing: null,
    categories: new Map()
  }]));

  for (const t of rows) {
    const bucket = byKey.get(monthKey(t.date));
    if (!bucket) continue;
    bucket.count++;
    if (t.amount >= 0) bucket.additions += t.amount; else bucket.spends += Math.abs(t.amount);
    bucket.net += t.amount;
    if (t.amount < 0) {
      const c = t.category || 'Other';
      bucket.categories.set(c, (bucket.categories.get(c) || 0) + Math.abs(t.amount));
    }
    if (Number.isFinite(t.statementBalance)) {
      if (bucket.exactOpening === null) bucket.exactOpening = round2(t.statementBalance - t.amount);
      bucket.exactClosing = round2(t.statementBalance);
    }
  }

  const series = keys.map(k => byKey.get(k));
  for (const m of series) { m.additions = round2(m.additions); m.spends = round2(m.spends); m.net = round2(m.net); }

  attachBalances(series, accountId);
  return series;
}

/**
 * Give every month an opening and closing balance.
 * Anchors on the newest month that has an exact balance from a statement; if
 * there is none, anchors on the balance entered against the account.
 */
function attachBalances(series, accountId) {
  if (!series.length) return;

  let anchor = -1;
  for (let i = series.length - 1; i >= 0; i--) {
    if (Number.isFinite(series[i].exactClosing)) { anchor = i; break; }
  }

  if (anchor >= 0) {
    series[anchor].closing = series[anchor].exactClosing;
    series[anchor].opening = Number.isFinite(series[anchor].exactOpening)
      ? series[anchor].exactOpening
      : round2(series[anchor].closing - series[anchor].net);
    series[anchor].estimated = false;
  } else {
    const account = state.accounts.find(a => a.id === accountId);
    const anchorBalance = account && Number.isFinite(Number(account.balance))
      ? (account.type === 'card' ? -Math.abs(Number(account.balance)) : Number(account.balance))
      : null;
    if (anchorBalance === null) return;   // nothing to anchor on: leave balances null
    anchor = series.length - 1;
    series[anchor].closing = round2(anchorBalance);
    series[anchor].opening = round2(anchorBalance - series[anchor].net);
    series[anchor].estimated = true;
  }

  for (let i = anchor + 1; i < series.length; i++) {
    series[i].opening = series[i - 1].closing;
    series[i].closing = round2(series[i].opening + series[i].net);
    series[i].estimated = series[i - 1].estimated;
    if (Number.isFinite(series[i].exactClosing)) {
      series[i].closing = series[i].exactClosing;
      if (Number.isFinite(series[i].exactOpening)) series[i].opening = series[i].exactOpening;
      series[i].estimated = false;
    }
  }
  for (let i = anchor - 1; i >= 0; i--) {
    series[i].closing = series[i + 1].opening;
    series[i].opening = round2(series[i].closing - series[i].net);
    series[i].estimated = series[i + 1].estimated;
    if (Number.isFinite(series[i].exactClosing)) {
      series[i].closing = series[i].exactClosing;
      if (Number.isFinite(series[i].exactOpening)) series[i].opening = series[i].exactOpening;
      series[i].estimated = false;
    }
  }
}

/** The months the current range selector covers, newest last. */
function rangeMonths(series) {
  const n = range === 'month' ? 1 : range === 'quarter' ? 3 : range === 'half' ? 6 : range === 'year' ? 12 : series.length;
  return series.slice(Math.max(0, series.length - n));
}

const RANGE_LABEL = { month: 'This month', quarter: '3 months', half: '6 months', year: '12 months', all: 'All time' };

/** Category totals across a set of month buckets, largest first. */
function categoryTotals(months) {
  const totals = new Map();
  for (const m of months) {
    for (const [cat, value] of m.categories) totals.set(cat, (totals.get(cat) || 0) + value);
  }
  return [...totals.entries()]
    .map(([category, amount]) => ({ category, amount: round2(amount), color: CATEGORY_COLORS[category] || 'var(--c10)' }))
    .sort((a, b) => b.amount - a.amount);
}

/** Percentage change between two numbers, guarding division by zero. */
function pctChange(now, before) {
  if (!Number.isFinite(now) || !Number.isFinite(before) || before === 0) return null;
  return ((now - before) / Math.abs(before)) * 100;
}

/** A coloured up/down pill. `goodWhenDown` suits spending, where less is better. */
function deltaPill(now, before, goodWhenDown) {
  const pct = pctChange(now, before);
  if (pct === null) return '<span class="delta flat">no prior month</span>';
  if (Math.abs(pct) < 0.5) return '<span class="delta flat">flat</span>';
  const up = pct > 0;
  const bad = goodWhenDown ? up : !up;
  return '<span class="delta ' + (bad ? 'up' : 'down') + '">' +
    (up ? '▲' : '▼') + ' ' + Math.abs(pct).toFixed(1) + '%</span>';
}

/** Net worth across accounts; credit cards count against you. */
function netWorth() {
  return state.accounts.reduce((sum, a) => {
    const v = Number(a.balance) || 0;
    return sum + (a.type === 'card' ? -Math.abs(v) : v);
  }, 0);
}

/* ==========================================================================
   10. Charts — hand-rolled SVG, no chart library
   --------------------------------------------------------------------------
   Every chart is a plain string of SVG markup using the theme's CSS variables,
   so they re-colour instantly when the theme changes and there is no CDN
   dependency to fail at load time.
   ========================================================================== */

/** "Nice" axis maximum so gridlines land on readable numbers. */
function niceMax(value) {
  if (!Number.isFinite(value) || value <= 0) return 100;
  const mag = Math.pow(10, Math.floor(Math.log10(value)));
  const n = value / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * mag;
}

/**
 * Grouped column chart: money in and money out, side by side per month.
 * series: [{ key, additions, spends }]
 */
function barChart(series, opts) {
  const o = opts || {};
  const W = 760, H = 250, padL = 52, padR = 12, padT = 14, padB = 30;
  if (!series.length) return emptyChart('Nothing to chart yet');

  const max = niceMax(Math.max(1, ...series.flatMap(m => [m.additions, m.spends])));
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const slot = plotW / series.length;
  const barW = Math.min(20, slot * 0.3);

  let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.label || 'Money in and out by month') + '">';
  for (let i = 0; i <= 4; i++) {
    const y = padT + plotH - (plotH * i / 4);
    svg += '<line class="grid-line" x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '"/>';
    svg += '<text class="axis-label" x="' + (padL - 7) + '" y="' + (y + 3) + '" text-anchor="end">' + esc(fmtShort(max * i / 4)) + '</text>';
  }

  series.forEach((m, i) => {
    const centre = padL + slot * i + slot / 2;
    const inH = Math.max(1, (m.additions / max) * plotH);
    const outH = Math.max(1, (m.spends / max) * plotH);
    const delay = (i * 0.045).toFixed(2) + 's';
    svg += '<rect class="chart-bar" x="' + (centre - barW - 2) + '" y="' + (padT + plotH - inH) + '" width="' + barW +
      '" height="' + inH + '" rx="3" fill="var(--pos)" opacity=".85" style="animation-delay:' + delay + '"><title>' +
      esc(monthLabelLong(m.key) + ' · in ' + fmt(m.additions)) + '</title></rect>';
    svg += '<rect class="chart-bar" x="' + (centre + 2) + '" y="' + (padT + plotH - outH) + '" width="' + barW +
      '" height="' + outH + '" rx="3" fill="var(--neg)" opacity=".85" style="animation-delay:' + delay + '"><title>' +
      esc(monthLabelLong(m.key) + ' · out ' + fmt(m.spends)) + '</title></rect>';
    svg += '<text class="axis-label" x="' + centre + '" y="' + (H - 10) + '" text-anchor="middle">' + esc(monthLabel(m.key)) + '</text>';
  });

  return svg + '</svg>';
}

/**
 * Line chart with a soft area fill. `pick` chooses the value from each bucket.
 */
function lineChart(series, pick, opts) {
  const o = opts || {};
  const W = 760, H = 250, padL = 52, padR = 14, padT = 16, padB = 30;
  const points = series.map(m => pick(m)).map(v => (Number.isFinite(v) ? v : null));
  if (points.filter(v => v !== null).length < 2) return emptyChart('At least two months of data are needed for a trend line');

  const values = points.filter(v => v !== null);
  const rawMin = Math.min(...values), rawMax = Math.max(...values);
  const lo = Math.min(0, rawMin), hi = niceMax(Math.max(1, rawMax, rawMax - lo));
  const span = (hi - lo) || 1;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const xAt = i => padL + (series.length === 1 ? plotW / 2 : (plotW * i) / (series.length - 1));
  const yAt = v => padT + plotH - ((v - lo) / span) * plotH;

  let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="hoverable" role="img" aria-label="' + esc(o.label || 'Trend') + '">';
  for (let i = 0; i <= 4; i++) {
    const y = padT + plotH - (plotH * i / 4);
    svg += '<line class="grid-line" x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '"/>';
    svg += '<text class="axis-label" x="' + (padL - 7) + '" y="' + (y + 3) + '" text-anchor="end">' + esc(fmtShort(lo + span * i / 4)) + '</text>';
  }

  const stroke = o.color || 'var(--accent)';
  const path = [], area = [];
  points.forEach((v, i) => {
    if (v === null) return;
    const cmd = path.length ? 'L' : 'M';
    path.push(cmd + xAt(i).toFixed(1) + ' ' + yAt(v).toFixed(1));
    area.push((area.length ? 'L' : 'M') + xAt(i).toFixed(1) + ' ' + yAt(v).toFixed(1));
  });
  if (area.length) {
    const firstX = xAt(points.findIndex(v => v !== null));
    let lastIdx = -1;
    points.forEach((v, i) => { if (v !== null) lastIdx = i; });
    area.push('L' + xAt(lastIdx).toFixed(1) + ' ' + (padT + plotH), 'L' + firstX.toFixed(1) + ' ' + (padT + plotH), 'Z');
    svg += '<path class="chart-area" d="' + area.join(' ') + '" fill="' + stroke + '" opacity=".11"/>';
  }
  svg += '<path class="chart-line" d="' + path.join(' ') + '" fill="none" stroke="' + stroke +
    '" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" pathLength="1200" stroke-dasharray="1200" style="--len:1200"/>';

  points.forEach((v, i) => {
    if (v === null) return;
    svg += '<circle cx="' + xAt(i).toFixed(1) + '" cy="' + yAt(v).toFixed(1) + '" r="3.2" fill="var(--surface)" stroke="' + stroke + '" stroke-width="2">' +
      '<title>' + esc(monthLabelLong(series[i].key) + ' · ' + fmt(v)) + '</title></circle>';
  });

  const every = Math.ceil(series.length / 12);
  series.forEach((m, i) => {
    if (i % every) return;
    svg += '<text class="axis-label" x="' + xAt(i).toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle">' + esc(monthLabel(m.key)) + '</text>';
  });

  return svg + '</svg>';
}

/** Tiny inline sparkline for the net-worth card. */
function sparkline(values) {
  if (!values || values.length < 2) return '';
  const lo = Math.min(...values), hi = Math.max(...values), span = (hi - lo) || 1;
  const pts = values.map((v, i) => (
    (i / (values.length - 1) * 100).toFixed(1) + ',' + (32 - ((v - lo) / span) * 28).toFixed(1)
  ));
  return '<svg class="sparkline" viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true">' +
    '<polyline points="' + pts.join(' ') + '" fill="none" stroke="rgba(255,255,255,.85)" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>';
}

function emptyChart(message) {
  return '<div class="empty-transactions">' + esc(message) + '</div>';
}

/**
 * Sankey-style cashflow diagram.
 * Left column: where money came from. Centre: the month's total inflow.
 * Right column: where it went, plus whatever was left over.
 */
function sankey(months, accountId) {
  const inflow = new Map(), outflow = new Map();
  let totalIn = 0, totalOut = 0;

  for (const m of months) {
    for (const [cat, value] of m.categories) { outflow.set(cat, (outflow.get(cat) || 0) + value); totalOut += value; }
  }
  const keys = new Set(months.map(m => m.key));
  const rows = txFor(accountId).filter(t => t.amount > 0 && keys.has(monthKey(t.date)));
  for (const t of rows) {
    const cat = t.category === 'Income' ? 'Income' : (t.category || 'Other');
    inflow.set(cat, (inflow.get(cat) || 0) + t.amount);
    totalIn += t.amount;
  }

  if (!totalIn && !totalOut) return emptyChart('No cashflow to show for this period');

  const left = condense([...inflow.entries()], 5);
  const right = condense([...outflow.entries()], 7);
  const leftover = round2(totalIn - totalOut);
  if (leftover > 0) right.push(['Left over', leftover]);

  const W = 760, H = Math.max(260, Math.max(left.length, right.length) * 42 + 50);
  const padT = 24, padB = 22;
  const colW = 15, midX = W / 2 - colW / 2, leftX = 112, rightX = W - 112 - colW;
  const plotH = H - padT - padB;
  const scale = plotH / Math.max(totalIn, totalOut, 1);
  const minH = 3;

  let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Cashflow for the selected period">';

  const midH = Math.max(minH, Math.max(totalIn, totalOut) * scale);
  const midY = padT + (plotH - midH) / 2;
  svg += '<rect class="sankey-node" x="' + midX + '" y="' + midY + '" width="' + colW + '" height="' + midH +
    '" rx="4" fill="var(--accent)"><title>' + esc('Total in ' + fmt(totalIn) + ' · total out ' + fmt(totalOut)) + '</title></rect>';

  svg += band(left, leftX, true);
  svg += band(right, rightX, false);

  svg += '<text class="sankey-label" x="' + (W / 2) + '" y="' + (midY - 8) + '" text-anchor="middle" style="font-weight:600">' +
    esc(fmt(totalIn) + ' in') + '</text>';
  svg += '<text class="sankey-value" x="' + (W / 2) + '" y="' + (midY + midH + 14) + '" text-anchor="middle">' +
    esc(fmt(totalOut) + ' out') + '</text>';

  return svg + '</svg>';

  function condense(entries, keep) {
    const sorted = entries.sort((a, b) => b[1] - a[1]);
    if (sorted.length <= keep) return sorted;
    const rest = sorted.slice(keep).reduce((s, e) => s + e[1], 0);
    return sorted.slice(0, keep).concat([['Everything else', rest]]);
  }

  function band(entries, x, isLeft) {
    const total = entries.reduce((s, e) => s + e[1], 0) || 1;
    const bandH = Math.max(minH, total * scale);
    let y = padT + (plotH - bandH) / 2;
    let cursor = midY;
    let out = '';

    for (const [name, value] of entries) {
      const h = Math.max(minH, value * scale);
      const colour = CATEGORY_COLORS[name] || (isLeft ? 'var(--c1)' : 'var(--c10)');
      out += '<rect class="sankey-node" x="' + x + '" y="' + y.toFixed(1) + '" width="' + colW + '" height="' + h.toFixed(1) +
        '" rx="3" fill="' + colour + '"/>';

      const x1 = isLeft ? x + colW : midX + colW;
      const x2 = isLeft ? midX : x;
      const y1 = y, y2 = cursor;
      const c = (x2 - x1) * 0.5;
      out += '<path class="sankey-link" d="' +
        'M' + x1 + ' ' + y1.toFixed(1) +
        ' C' + (x1 + c) + ' ' + y1.toFixed(1) + ' ' + (x2 - c) + ' ' + y2.toFixed(1) + ' ' + x2 + ' ' + y2.toFixed(1) +
        ' L' + x2 + ' ' + (y2 + h).toFixed(1) +
        ' C' + (x2 - c) + ' ' + (y2 + h).toFixed(1) + ' ' + (x1 + c) + ' ' + (y1 + h).toFixed(1) + ' ' + x1 + ' ' + (y1 + h).toFixed(1) +
        ' Z" fill="' + colour + '" opacity=".22"><title>' + esc(name + ' · ' + fmt(value)) + '</title></path>';

      const labelX = isLeft ? x - 8 : x + colW + 8;
      const anchor = isLeft ? 'end' : 'start';
      out += '<text class="sankey-label" x="' + labelX + '" y="' + (y + h / 2 - 1).toFixed(1) + '" text-anchor="' + anchor + '">' + esc(name) + '</text>';
      out += '<text class="sankey-value" x="' + labelX + '" y="' + (y + h / 2 + 10).toFixed(1) + '" text-anchor="' + anchor + '">' + esc(fmtShort(value)) + '</text>';

      y += h + 6;
      cursor += h;
    }
    return out;
  }
}

/* ==========================================================================
   11. Shared view fragments
   ========================================================================== */

function rangePicker() {
  return '<div class="segmented" role="group" aria-label="Date range">' +
    Object.entries(RANGE_LABEL).map(([key, label]) =>
      '<button type="button" data-range="' + key + '"' + (range === key ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + '>' +
      esc(label) + '</button>').join('') +
    '</div>';
}

function accountPicker(id, selected) {
  return '<select class="select" id="' + id + '">' +
    '<option value="all"' + (selected === 'all' ? ' selected' : '') + '>All accounts</option>' +
    state.accounts.map(a => '<option value="' + esc(a.id) + '"' + (selected === a.id ? ' selected' : '') + '>' +
      esc(a.name) + '</option>').join('') + '</select>';
}

function demoBanner() {
  if (!state.demo) return '';
  return '<div class="demo-banner"><span>✳</span><div><b>You are looking at sample data</b>' +
    '<small>Clear it whenever you are ready to add your own accounts and statements.</small></div>' +
    '<button type="button" id="clearDemo">Start with my data</button></div>';
}

function pageHead(title, blurb, actions) {
  return '<div class="welcome"><div><div class="eyebrow">STILLWELL</div><h1>' + esc(title) + '</h1>' +
    '<p>' + esc(blurb) + '</p></div><div class="welcome-actions">' + (actions || '') + '</div></div>';
}

const importButton = '<button class="btn primary" data-act="import">↑ Import statement</button>';
const addAccountButton = '<button class="btn subtle" data-act="add-account">+ Add account</button>';

function transactionRow(t) {
  const account = state.accounts.find(a => a.id === t.account);
  const incoming = t.amount >= 0;
  return '<div class="transaction">' +
    '<div class="tx-icon' + (incoming ? ' in' : '') + '">' + (incoming ? '↓' : '↑') + '</div>' +
    '<div class="tx-main"><b>' + esc(t.description) + '</b>' +
    '<small>' + esc(dateFmt(t.date)) + ' · ' + esc(t.category || 'Other') +
    (account ? ' · ' + esc(account.name) : '') + '</small></div>' +
    '<div class="tx-amount ' + (incoming ? 'positive' : 'negative') + '">' +
    (incoming ? '+' : '−') + esc(fmt(Math.abs(t.amount))) + '</div></div>';
}

/* ==========================================================================
   12. Views
   ========================================================================== */

function viewOverview() {
  const series = monthlySeries('all');
  const window_ = rangeMonths(series);
  const current = window_[window_.length - 1] || { additions: 0, spends: 0, net: 0, opening: null, closing: null, estimated: true, categories: new Map() };
  const previous = series[series.indexOf(current) - 1] || null;

  const windowIn = round2(window_.reduce((s, m) => s + m.additions, 0));
  const windowOut = round2(window_.reduce((s, m) => s + m.spends, 0));
  const worth = netWorth();
  const spark = series.slice(-12).map(m => m.closing).filter(Number.isFinite);

  const recent = state.transactions.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7);
  const cats = categoryTotals(window_).slice(0, 6);
  const catMax = cats.length ? cats[0].amount : 1;

  return demoBanner() +
    pageHead('Your money, in view',
      'A calm read on where things stand. Balances come from your accounts; movement comes from the statements you import.',
      importButton + addAccountButton) +

    '<div class="hero-grid">' +
      '<div class="card networth"><div class="networth-top"><div class="eyebrow">TOTAL NET WORTH</div>' +
        sparkline(spark) + '</div>' +
        '<h2>' + esc(fmt(worth)) + '</h2>' +
        '<div class="networth-foot">Across <strong>' + state.accounts.length + '</strong> account' +
        (state.accounts.length === 1 ? '' : 's') + ' · ' + esc(RANGE_LABEL[range].toLowerCase()) +
        ' movement <strong>' + esc((current.net >= 0 ? '+' : '−') + fmt(Math.abs(round2(window_.reduce((s, m) => s + m.net, 0))))) + '</strong></div></div>' +

      '<div class="card summary-card"><div class="summary-head"><span>MONEY OUT · ' + esc(monthLabel(current.key)) + '</span>' +
        deltaPill(current.spends, previous && previous.spends, true) + '</div>' +
        '<h3>' + esc(fmt(current.spends)) + '</h3>' +
        '<div class="summary-sub">' + esc(RANGE_LABEL[range]) + ' total ' + esc(fmt(windowOut)) + '</div>' +
        '<div class="mini-bars">' + miniBars(series.slice(-10).map(m => m.spends)) + '</div></div>' +
    '</div>' +

    '<div class="movement-strip">' +
      '<div><small>OPENING BALANCE</small><b>' + balanceCell(current.opening, current.estimated) + '</b></div>' +
      '<div><small>ADDITIONS</small><b class="positive">+' + esc(fmt(current.additions)) + '</b></div>' +
      '<div><small>CLOSING BALANCE</small><b>' + balanceCell(current.closing, current.estimated) + '</b></div>' +
      '<button type="button" data-view-link="monthly">Month by month →</button>' +
    '</div>' +

    '<div class="section-head"><div><h2>Money in and out</h2><p>' + esc(RANGE_LABEL[range]) +
      ' · ' + esc(fmt(windowIn)) + ' in, ' + esc(fmt(windowOut)) + ' out</p></div>' + rangePicker() + '</div>' +

    '<div class="card panel"><div class="chart-wrap">' + barChart(window_) + '</div>' +
      '<div class="legend"><span><i style="background:var(--pos)"></i>Money in</span>' +
      '<span><i style="background:var(--neg)"></i>Money out</span></div></div>' +

    '<div class="lower-grid">' +
      '<div class="card panel"><div class="panel-head"><h2>Recent activity</h2>' +
        '<button class="text-button" data-view-link="spending">See all</button></div>' +
        '<div class="transaction-list">' +
        (recent.length ? recent.map(transactionRow).join('')
          : '<div class="empty-transactions">No transactions yet. Import a statement to get started.</div>') +
        '</div></div>' +

      '<div class="card panel"><div class="panel-head"><h2>Where it goes</h2>' +
        '<span class="badge">' + esc(RANGE_LABEL[range]) + '</span></div>' +
        (cats.length ? cats.map(c =>
          '<div class="category-row"><span>' + esc(c.category) + '</span>' +
          '<div class="category-bar"><i style="width:' + ((c.amount / catMax) * 100).toFixed(1) + '%;background:' + c.color + '"></i></div>' +
          '<strong>' + esc(fmtShort(c.amount)) + '</strong></div>').join('')
          : '<div class="empty-transactions">No spending recorded in this period.</div>') +
      '</div>' +
    '</div>';
}

function miniBars(values) {
  if (!values.length) return '';
  const max = Math.max(1, ...values);
  return values.map((v, i) =>
    '<i style="height:' + Math.max(4, (v / max) * 38).toFixed(1) + 'px;animation-delay:' + (i * 0.04).toFixed(2) + 's"></i>'
  ).join('');
}

function balanceCell(value, estimated) {
  if (!Number.isFinite(value)) return '<span class="estimate-mark">not known</span>';
  return esc(fmt(value)) + (estimated ? ' <span class="estimate-mark">est.</span>' : '');
}

function viewAccounts() {
  if (!state.accounts.length) {
    return pageHead('Accounts', 'Add the accounts you want to track.', addAccountButton) +
      '<div class="card empty-state"><b>No accounts yet</b>Add a bank account, card, deposit or fund and ' +
      'Stillwell will track its balance and the statements you import against it.</div>';
  }

  const cards = state.accounts.map(a => {
    const value = Number(a.balance) || 0;
    const limit = Number(a.limit) || 0;
    const util = a.type === 'card' && limit > 0 ? Math.min(100, (Math.abs(value) / limit) * 100) : null;
    const count = state.transactions.filter(t => t.account === a.id).length;
    return '<div class="card account-card" data-account="' + esc(a.id) + '" tabindex="0" role="button" aria-label="Edit ' + esc(a.name) + '">' +
      '<div class="account-top"><div class="account-symbol tone-' + esc(a.color || 'sage') + '">' + (TYPE_SYMBOL[a.type] || '↗') + '</div>' +
      '<span class="account-type">' + esc(TYPE_NAME[a.type] || 'Account') + '</span></div>' +
      '<h3>' + esc(a.name) + '</h3><div class="institution">' + esc(a.institution || '—') + '</div>' +
      '<div class="account-balance' + (a.type === 'card' ? ' negative' : '') + '">' + esc(fmt(value)) + '</div>' +
      '<div class="account-meta"><span>As of ' + esc(dateFmt(a.date)) + '</span><span>' + count + ' txns</span></div>' +
      (util !== null ? '<div class="util-track" title="' + util.toFixed(0) + '% of limit used"><i style="width:' + util.toFixed(1) + '%"></i></div>' : '') +
      '</div>';
  }).join('');

  return demoBanner() +
    pageHead('Accounts', 'Balances are the ones you enter. Stillwell never connects to a bank.',
      addAccountButton + importButton) +
    '<div class="account-grid">' + cards + '</div>' +
    '<div class="section-head"><div><h2>Imported statements</h2><p>Each import keeps its own opening, closing and totals.</p></div></div>' +
    statementTable();
}

function statementTable() {
  if (!state.statements.length) {
    return '<div class="card empty-state"><b>No statements imported</b>Import a PDF, CSV, OFX or QIF statement and ' +
      'its opening balance, closing balance, additions and spends are recorded here.</div>';
  }
  const rows = state.statements.slice().sort((a, b) => String(b.importedAt).localeCompare(String(a.importedAt))).map(s => {
    const account = state.accounts.find(a => a.id === s.accountId);
    return '<tr><td>' + esc(account ? account.name : 'Unassigned') + '</td>' +
      '<td>' + esc(dateFmt(s.from)) + ' – ' + esc(dateFmt(s.to)) + '</td>' +
      '<td>' + (Number.isFinite(s.opening) ? esc(fmt(s.opening)) : '—') + '</td>' +
      '<td>' + (Number.isFinite(s.closing) ? esc(fmt(s.closing)) : '—') + '</td>' +
      '<td class="positive">+' + esc(fmt(s.additions)) + '</td>' +
      '<td class="negative">−' + esc(fmt(s.spends)) + '</td>' +
      '<td>' + s.count + '</td>' +
      '<td><span class="badge ' + (s.balanceSource === 'none' ? 'est' : 'ok') + '">' +
      esc(s.balanceSource === 'balance-column' ? 'exact' : s.balanceSource === 'statement-summary' ? 'from summary' : 'derived') +
      '</span></td>' +
      '<td><button class="text-button" data-remove-statement="' + esc(s.id) + '">Remove</button></td></tr>';
  }).join('');

  return '<div class="card monthly-account"><div class="monthly-table-wrap"><table class="monthly-table">' +
    '<thead><tr><th>Account</th><th>Period</th><th>Opening</th><th>Closing</th><th>Additions</th>' +
    '<th>Spends</th><th>Rows</th><th>Balances</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
}

function viewSpending() {
  const series = monthlySeries(trendAccount);
  const window_ = rangeMonths(series);
  const keys = new Set(window_.map(m => m.key));

  let rows = state.transactions
    .filter(t => keys.has(monthKey(t.date)))
    .filter(t => trendAccount === 'all' || t.account === trendAccount);

  const needle = txSearch.trim().toLowerCase();
  if (needle) rows = rows.filter(t => (t.description + ' ' + (t.category || '')).toLowerCase().includes(needle));
  rows.sort((a, b) => b.date.localeCompare(a.date));

  const spends = round2(rows.filter(t => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0));
  const additions = round2(rows.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0));
  const outRows = rows.filter(t => t.amount < 0);
  const average = outRows.length ? round2(spends / outRows.length) : 0;
  const biggest = outRows.reduce((best, t) => (!best || Math.abs(t.amount) > Math.abs(best.amount) ? t : best), null);

  const cats = categoryTotals(window_);
  const catMax = cats.length ? cats[0].amount : 1;

  const body = rows.slice(0, 250).map(t => {
    const account = state.accounts.find(a => a.id === t.account);
    return '<tr><td>' + esc(dateFmt(t.date)) + '</td>' +
      '<td class="desc"><span title="' + esc(t.description) + '">' + esc(t.description) + '</span></td>' +
      '<td><select data-recategorize="' + esc(t.id) + '" aria-label="Category">' +
      CATEGORIES.map(c => '<option' + (c === t.category ? ' selected' : '') + '>' + esc(c) + '</option>').join('') +
      '</select></td>' +
      '<td>' + esc(account ? account.name : '—') + '</td>' +
      '<td class="' + (t.amount >= 0 ? 'positive' : 'negative') + '">' +
      (t.amount >= 0 ? '+' : '−') + esc(fmt(Math.abs(t.amount))) + '</td></tr>';
  }).join('');

  return pageHead('Spending', 'Search, re-categorise and compare. Changing a category here updates every chart.',
    importButton) +

    '<div class="section-head"><div><h2>' + esc(RANGE_LABEL[range]) + '</h2><p>' + rows.length +
      ' transaction' + (rows.length === 1 ? '' : 's') + ' in view</p></div>' + rangePicker() + '</div>' +

    '<div class="spending-stats">' +
      '<div class="stat"><small>Total spent</small><b class="negative">' + esc(fmt(spends)) + '</b></div>' +
      '<div class="stat"><small>Total received</small><b class="positive">' + esc(fmt(additions)) + '</b></div>' +
      '<div class="stat"><small>Average spend</small><b>' + esc(fmt(average)) + '</b></div>' +
      '<div class="stat"><small>Largest spend</small><b>' + esc(biggest ? fmt(Math.abs(biggest.amount)) : '—') + '</b></div>' +
    '</div>' +

    '<div class="card panel"><div class="panel-head"><h2>By category</h2>' +
      '<span class="badge">' + cats.length + ' categories</span></div>' +
      (cats.length ? cats.map(c =>
        '<div class="category-row"><span>' + esc(c.category) + '</span>' +
        '<div class="category-bar"><i style="width:' + ((c.amount / catMax) * 100).toFixed(1) + '%;background:' + c.color + '"></i></div>' +
        '<strong>' + esc(fmt(c.amount)) + '</strong></div>').join('')
        : '<div class="empty-transactions">Nothing spent in this period.</div>') +
    '</div>' +

    '<div class="section-head"><div><h2>All transactions</h2><p>Showing the first 250 of ' + rows.length + '</p></div>' +
      '<div class="table-tools">' + accountPicker('spendAccount', trendAccount) +
      '<input type="search" id="txSearch" placeholder="Search description…" value="' + esc(txSearch) + '">' +
      '<button class="btn subtle" data-act="export-csv">Export CSV</button></div></div>' +

    '<div class="card panel">' + (rows.length
      ? '<table class="tx-table"><thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Account</th><th>Amount</th></tr></thead><tbody>' + body + '</tbody></table>'
      : '<div class="empty-transactions">Nothing matches that search.</div>') + '</div>';
}

function viewMonthly() {
  const accounts = trendAccount === 'all' ? state.accounts : state.accounts.filter(a => a.id === trendAccount);
  const blocks = accounts.map(a => monthlyBlock(a)).filter(Boolean);
  const unassigned = state.transactions.some(t => !t.account || !state.accounts.find(a => a.id === t.account));

  return pageHead('Month by month', 'Opening and closing balances with everything that moved in between.',
    importButton) +

    '<div class="section-head"><div><h2>Per account</h2><p>Exact balances come from a statement’s balance column; the rest are chained from the balance you entered.</p></div>' +
      accountPicker('monthlyAccount', trendAccount) + '</div>' +

    '<div class="monthly-note"><span>i</span><p>A month marked <span class="estimate-mark">est.</span> was derived by working ' +
      'backwards from a known balance rather than read from a statement. Reconcile against the original document before relying on it.</p></div>' +

    '<div class="monthly-accounts">' + (blocks.length ? blocks.join('')
      : '<div class="card empty-state"><b>No monthly data yet</b>Import a statement and assign it to an account.</div>') + '</div>' +

    (unassigned ? '<div class="monthly-note"><span>!</span><p>Some transactions are not assigned to an account, so they appear in totals ' +
      'but not in any per-account table. Re-import them against an account to include them here.</p></div>' : '');
}

function monthlyBlock(account) {
  const series = monthlySeries(account.id);
  if (!series.length) return '';
  const shown = series.slice(-7).reverse();

  const rows = shown.map(m => {
    const prior = series[series.indexOf(m) - 1] || null;
    return '<tr><td>' + esc(monthLabelLong(m.key)) + '</td>' +
      '<td>' + balanceCell(m.opening, m.estimated) + '</td>' +
      '<td class="positive">+' + esc(fmt(m.additions)) + '</td>' +
      '<td class="negative">−' + esc(fmt(m.spends)) + '</td>' +
      '<td class="' + (m.net >= 0 ? 'positive' : 'negative') + '">' + (m.net >= 0 ? '+' : '−') + esc(fmt(Math.abs(m.net))) + '</td>' +
      '<td>' + balanceCell(m.closing, m.estimated) + '</td>' +
      '<td>' + deltaPill(m.spends, prior && prior.spends, true) + '</td>' +
      '<td>' + m.count + '</td></tr>';
  }).join('');

  return '<div class="card monthly-account">' +
    '<div class="monthly-account-head"><div class="account-symbol tone-' + esc(account.color || 'sage') + '">' +
    (TYPE_SYMBOL[account.type] || '↗') + '</div>' +
    '<div><b>' + esc(account.name) + '</b><small>' + esc(account.institution || TYPE_NAME[account.type] || '') + '</small></div>' +
    '<span>' + series.length + ' month' + (series.length === 1 ? '' : 's') + ' of history</span></div>' +
    '<div class="monthly-table-wrap"><table class="monthly-table"><thead><tr>' +
    '<th>Month</th><th>Opening</th><th>Additions</th><th>Spends</th><th>Net</th><th>Closing</th><th>vs prior</th><th>Rows</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table></div></div>';
}

function viewTrends() {
  const series = monthlySeries(trendAccount);
  const window_ = rangeMonths(series);

  if (!series.length) {
    return pageHead('Trends & flow', 'Compare months and see where the money moves.', importButton) +
      '<div class="card empty-state"><b>Nothing to chart yet</b>Import a statement and the trends, ' +
      'month-on-month comparison and cashflow diagram will fill in.</div>';
  }

  const flowKeys = flowMonth && series.some(m => m.key === flowMonth) ? [flowMonth] : window_.map(m => m.key);
  const flowMonths = series.filter(m => flowKeys.includes(m.key));

  return pageHead('Trends & flow', 'Compare months and see where the money moves.', importButton) +

    '<div class="section-head"><div><h2>Over time</h2><p>' + esc(RANGE_LABEL[range]) + ' · ' +
      esc(trendAccount === 'all' ? 'all accounts' : (state.accounts.find(a => a.id === trendAccount) || {}).name || '') +
      '</p></div><div class="table-tools">' + accountPicker('trendAccount', trendAccount) + rangePicker() + '</div></div>' +

    '<div class="report-grid">' +
      '<div class="card panel"><div class="panel-head"><h2>Spending trend</h2></div>' +
        '<div class="chart-wrap">' + lineChart(window_, m => m.spends, { color: 'var(--neg)', label: 'Spending by month' }) + '</div></div>' +
      '<div class="card panel"><div class="panel-head"><h2>Closing balance</h2></div>' +
        '<div class="chart-wrap">' + lineChart(window_, m => m.closing, { color: 'var(--accent)', label: 'Closing balance by month' }) + '</div></div>' +
    '</div>' +

    '<div class="card panel" style="margin-top:14px"><div class="panel-head"><h2>Money in and out</h2>' +
      '<span class="badge">' + window_.length + ' months</span></div>' +
      '<div class="chart-wrap">' + barChart(window_) + '</div>' +
      '<div class="legend"><span><i style="background:var(--pos)"></i>Money in</span>' +
      '<span><i style="background:var(--neg)"></i>Money out</span></div></div>' +

    '<div class="section-head"><div><h2>Cashflow</h2><p>Where money came from and where it went.</p></div>' +
      '<select class="select" id="flowMonth"><option value="">' + esc(RANGE_LABEL[range]) + ' combined</option>' +
      series.slice().reverse().map(m => '<option value="' + esc(m.key) + '"' + (flowMonth === m.key ? ' selected' : '') + '>' +
        esc(monthLabelLong(m.key)) + '</option>').join('') + '</select></div>' +

    '<div class="card panel"><div class="sankey-wrap">' + sankey(flowMonths, trendAccount) + '</div></div>' +

    '<div class="section-head"><div><h2>Category, month on month</h2><p>Each column is a month; the last column is the change against the month before.</p></div></div>' +
    '<div class="card panel">' + momTable(window_) + '</div>';
}

function momTable(months) {
  const shown = months.slice(-6);
  if (!shown.length) return '<div class="empty-transactions">No months in this range.</div>';

  const all = categoryTotals(shown).map(c => c.category);
  if (!all.length) return '<div class="empty-transactions">No spending recorded in this range.</div>';

  const head = '<thead><tr><th>Category</th>' + shown.map(m => '<th>' + esc(monthLabel(m.key)) + '</th>').join('') +
    '<th>Change</th></tr></thead>';

  const body = all.map(cat => {
    const values = shown.map(m => round2(m.categories.get(cat) || 0));
    const last = values[values.length - 1], prior = values.length > 1 ? values[values.length - 2] : null;
    return '<tr><td><span class="swatch" style="background:' + (CATEGORY_COLORS[cat] || 'var(--c10)') + '"></span>' + esc(cat) + '</td>' +
      values.map(v => '<td>' + (v ? esc(fmtShort(v)) : '<span class="estimate-mark">—</span>') + '</td>').join('') +
      '<td>' + deltaPill(last, prior, true) + '</td></tr>';
  }).join('');

  const totals = shown.map(m => m.spends);
  const foot = '<tr><td><b>Total</b></td>' + totals.map(v => '<td><b>' + esc(fmtShort(v)) + '</b></td>').join('') +
    '<td>' + deltaPill(totals[totals.length - 1], totals.length > 1 ? totals[totals.length - 2] : null, true) + '</td></tr>';

  return '<table class="mom-table">' + head + '<tbody>' + body + foot + '</tbody></table>';
}

/* ==========================================================================
   13. Render
   ========================================================================== */

const VIEWS = {
  overview: { render: viewOverview, crumb: 'Overview' },
  accounts: { render: viewAccounts, crumb: 'Accounts' },
  spending: { render: viewSpending, crumb: 'Spending' },
  monthly: { render: viewMonthly, crumb: 'Monthly' },
  trends: { render: viewTrends, crumb: 'Trends & flow' }
};

function draw() {
  const target = VIEWS[view] || VIEWS.overview;
  try {
    app.innerHTML = '<div class="view-enter">' + target.render() + '</div>';
  } catch (err) {
    // A render failure must be visible, not a blank page.
    console.error('Stillwell render failed', err);
    app.innerHTML = '<div class="card empty-state"><b>This view could not be drawn</b>' +
      esc(err && err.message ? err.message : 'Unknown error') +
      '<br><br>Your data is safe. Try another view, or reload the page.</div>';
  }

  document.querySelector('#crumbCurrent').textContent = target.crumb;
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  bindViewControls();
}

/* ==========================================================================
   14. Controls inside the rendered view
   --------------------------------------------------------------------------
   The view is re-rendered wholesale, so listeners are re-attached each time
   rather than delegated. That keeps every handler next to the markup it
   belongs to and avoids stale closures over replaced DOM nodes.
   ========================================================================== */

function bindViewControls() {
  app.querySelectorAll('[data-range]').forEach(b => {
    b.onclick = () => { range = b.dataset.range; draw(); };
  });

  app.querySelectorAll('[data-view-link]').forEach(b => {
    b.onclick = () => { view = b.dataset.viewLink; draw(); };
  });

  app.querySelectorAll('[data-act="import"]').forEach(b => { b.onclick = openImport; });
  app.querySelectorAll('[data-act="add-account"]').forEach(b => { b.onclick = () => openAccount(null); });
  app.querySelectorAll('[data-act="export-csv"]').forEach(b => { b.onclick = exportCsv; });

  const clearDemo = app.querySelector('#clearDemo');
  if (clearDemo) clearDemo.onclick = () => {
    const removed = dropDemoData();
    save();
    toast(removed ? 'Sample data cleared.' : 'There was no sample data left to clear.');
    draw();
  };

  app.querySelectorAll('[data-account]').forEach(card => {
    card.onclick = () => openAccount(card.dataset.account);
    card.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAccount(card.dataset.account); } };
  });

  app.querySelectorAll('[data-remove-statement]').forEach(b => {
    b.onclick = () => removeStatement(b.dataset.removeStatement);
  });

  app.querySelectorAll('[data-recategorize]').forEach(sel => {
    sel.onchange = () => {
      const t = state.transactions.find(x => x.id === sel.dataset.recategorize);
      if (!t) return;
      t.category = sel.value;
      save();
      toast('Moved to ' + sel.value + '.');
      draw();
    };
  });

  ['spendAccount', 'monthlyAccount', 'trendAccount'].forEach(id => {
    const el = app.querySelector('#' + id);
    if (el) el.onchange = () => { trendAccount = el.value; draw(); };
  });

  const flow = app.querySelector('#flowMonth');
  if (flow) flow.onchange = () => { flowMonth = flow.value || null; draw(); };

  const search = app.querySelector('#txSearch');
  if (search) {
    search.oninput = () => {
      clearTimeout(search._timer);
      search._timer = setTimeout(() => {
        txSearch = search.value;
        draw();
        const again = app.querySelector('#txSearch');
        if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
      }, 220);
    };
  }
}

function removeStatement(id) {
  const statement = state.statements.find(s => s.id === id);
  if (!statement) return;
  const removed = state.transactions.length;
  state.transactions = state.transactions.filter(t => t.statementId !== id);
  state.statements = state.statements.filter(s => s.id !== id);
  save();
  toast('Removed ' + (removed - state.transactions.length) + ' transactions from that import.');
  draw();
}

function exportCsv() {
  const rows = state.transactions.slice().sort((a, b) => a.date.localeCompare(b.date));
  if (!rows.length) { toast('There is nothing to export yet.'); return; }

  const cell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const body = [['Date', 'Description', 'Category', 'Account', 'Amount', 'Balance'].map(cell).join(',')]
    .concat(rows.map(t => {
      const account = state.accounts.find(a => a.id === t.account);
      return [t.date, t.description, t.category || 'Other', account ? account.name : '',
        t.amount, Number.isFinite(t.statementBalance) ? t.statementBalance : ''].map(cell).join(',');
    })).join('\n');

  const url = URL.createObjectURL(new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'stillwell-transactions-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast('Exported ' + rows.length + ' transactions.');
}

/* ==========================================================================
   15. Account dialog
   ========================================================================== */

const accountDialog = document.querySelector('#accountDialog');
const accountForm = document.querySelector('#accountForm');

function openAccount(id) {
  const account = id ? state.accounts.find(a => a.id === id) : null;
  document.querySelector('#dialogTitle').textContent = account ? 'Edit account' : 'Add an account';
  document.querySelector('#accountId').value = account ? account.id : '';
  document.querySelector('#accountName').value = account ? account.name : '';
  document.querySelector('#accountType').value = account ? account.type : 'bank';
  document.querySelector('#accountInstitution').value = account ? (account.institution || '') : '';
  document.querySelector('#accountBalance').value = account ? account.balance : '';
  document.querySelector('#accountLimit').value = account && account.limit ? account.limit : '';
  document.querySelector('#accountDate').value = (account && account.date) || new Date().toISOString().slice(0, 10);
  document.querySelector('#accountColor').value = (account && account.color) || 'sage';
  document.querySelector('#deleteAccount').hidden = !account;
  syncAccountTypeFields();
  accountDialog.showModal();
}

function syncAccountTypeFields() {
  const isCard = document.querySelector('#accountType').value === 'card';
  document.querySelector('#limitField').style.display = isCard ? '' : 'none';
  document.querySelector('#balanceHint').textContent = isCard ? '(₹ owed)' : '(₹)';
}

document.querySelector('#accountType').onchange = syncAccountTypeFields;

accountForm.addEventListener('submit', e => {
  if (accountForm.returnValue === 'cancel' || (e.submitter && e.submitter.value === 'cancel')) return;

  const id = document.querySelector('#accountId').value;
  const balance = Number(document.querySelector('#accountBalance').value);
  if (!Number.isFinite(balance)) { e.preventDefault(); toast('Enter a numeric balance.'); return; }

  const record = {
    id: id || uid(),
    name: document.querySelector('#accountName').value.trim(),
    type: document.querySelector('#accountType').value,
    institution: document.querySelector('#accountInstitution').value.trim(),
    balance,
    limit: Number(document.querySelector('#accountLimit').value) || 0,
    date: document.querySelector('#accountDate').value,
    color: document.querySelector('#accountColor').value
  };

  const existing = state.accounts.findIndex(a => a.id === record.id);
  if (existing >= 0) state.accounts[existing] = { ...state.accounts[existing], ...record };
  else state.accounts.push(record);

  // The first real account retires the sample data; editing a demo account does not.
  if (state.demo && existing < 0) dropDemoData(); else state.demo = false;
  save();
  toast(existing >= 0 ? 'Account updated.' : 'Account added.');
  draw();
});

document.querySelector('#deleteAccount').onclick = () => {
  const id = document.querySelector('#accountId').value;
  const account = state.accounts.find(a => a.id === id);
  if (!account) return;
  const count = state.transactions.filter(t => t.account === id).length;
  const message = count
    ? 'Delete “' + account.name + '” and its ' + count + ' imported transactions? This cannot be undone.'
    : 'Delete “' + account.name + '”?';
  if (!window.confirm(message)) return;

  state.accounts = state.accounts.filter(a => a.id !== id);
  state.transactions = state.transactions.filter(t => t.account !== id);
  state.statements = state.statements.filter(s => s.accountId !== id);
  save();
  accountDialog.close();
  toast('Account deleted.');
  draw();
};

/* ==========================================================================
   16. Import flow
   ========================================================================== */

const uploadDialog = document.querySelector('#uploadDialog');
const fileInput = document.querySelector('#statementFile');
const dropzone = document.querySelector('#dropzone');
const previewBox = document.querySelector('#importPreview');
const importBtn = document.querySelector('#importBtn');
const passwordField = document.querySelector('#passwordField');
const passwordInput = document.querySelector('#statementPassword');

const MAX_FILE_BYTES = 25 * 1024 * 1024;
let selectedFile = null;

function openImport() {
  pending = null;
  selectedFile = null;
  lastDiagnostics = '';
  previewBox.hidden = true;
  previewBox.className = 'import-preview';
  previewBox.innerHTML = '';
  importBtn.disabled = true;
  passwordField.hidden = true;
  passwordInput.value = '';
  fileInput.value = '';

  const picker = document.querySelector('#importAccount');
  picker.innerHTML = '<option value="">Choose account…</option>' +
    state.accounts.map(a => '<option value="' + esc(a.id) + '">' + esc(a.name) +
      (a.institution ? ' · ' + esc(a.institution) : '') + '</option>').join('');
  if (state.accounts.length === 1) picker.value = state.accounts[0].id;

  uploadDialog.showModal();
}

dropzone.onclick = () => fileInput.click();
dropzone.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } };
dropzone.ondragover = e => { e.preventDefault(); dropzone.classList.add('drag'); };
dropzone.ondragleave = () => dropzone.classList.remove('drag');
dropzone.ondrop = e => {
  e.preventDefault();
  dropzone.classList.remove('drag');
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) handleFile(file);
};
fileInput.onchange = () => { if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]); };

passwordInput.onkeydown = e => {
  if (e.key === 'Enter') { e.preventDefault(); if (selectedFile) handleFile(selectedFile, passwordInput.value); }
};

function showPreviewStatus(html, kind) {
  previewBox.hidden = false;
  previewBox.className = 'import-preview' + (kind ? ' ' + kind : '');
  previewBox.innerHTML = html;
}

async function handleFile(file, password) {
  selectedFile = file;
  pending = null;
  importBtn.disabled = true;
  lastDiagnostics = '';

  if (file.size > MAX_FILE_BYTES) {
    showPreviewStatus('<b>That file is ' + (file.size / 1048576).toFixed(1) + ' MB.</b><br>' +
      'The limit is 25 MB so the browser does not run out of memory. Split the statement by period and import each part.', 'error');
    return;
  }
  if (file.size === 0) {
    showPreviewStatus('<b>That file is empty.</b><br>Re-download it from your bank and try again.', 'error');
    return;
  }

  const name = (file.name || '').toLowerCase();
  const isPdf = name.endsWith('.pdf') || file.type === 'application/pdf';

  showPreviewStatus('<span class="spinner"></span>Reading ' + esc(file.name) + '…' +
    (isPdf ? '<div class="progress"><i style="width:4%"></i></div>' : ''));

  const onProgress = (message, fraction) => {
    previewBox.innerHTML = '<span class="spinner"></span>' + esc(message) +
      '<div class="progress"><i style="width:' +
      Math.round(Math.min(1, Math.max(0.04, fraction || 0.04)) * 100) + '%"></i></div>';
  };

  try {
    let result;
    if (isPdf) {
      result = await parsePDF(file, { password: password || undefined, onProgress });
    } else {
      const text = await file.text();
      if (name.endsWith('.ofx') || name.endsWith('.qfx') || /<OFX>/i.test(text.slice(0, 2000))) result = parseOFX(text);
      else if (name.endsWith('.qif') || /^!Type:/im.test(text.slice(0, 400))) result = parseQIF(text);
      else result = parseDelimited(text);
    }

    pending = result;
    passwordField.hidden = true;
    renderPreview(result, file);
    importBtn.disabled = false;
  } catch (err) {
    pending = null;
    const needsPassword = err && err.code === 'PASSWORD';
    passwordField.hidden = !needsPassword;
    showPreviewStatus('<b>' + esc(needsPassword ? 'Password needed' : 'That file could not be read') + '</b><br>' +
      esc(err && err.message ? err.message : 'Unknown error') +
      (lastDiagnostics ? '<details class="diag"><summary>Technical details</summary><pre>' + esc(lastDiagnostics) + '</pre></details>' : ''),
      'error');
    if (needsPassword) passwordInput.focus();
    else console.error('Stillwell import failed', err);
  }
}

function renderPreview(result, file) {
  const chips = [];
  if (Number.isFinite(result.opening)) chips.push('Opening ' + fmt(result.opening));
  if (Number.isFinite(result.closing)) chips.push('Closing ' + fmt(result.closing));
  chips.push('In ' + fmt(result.additions));
  chips.push('Out ' + fmt(result.spends));
  if (result.months.length) chips.push(result.months.length + ' month' + (result.months.length === 1 ? '' : 's'));
  if (result.skipped) chips.push(result.skipped + ' rows skipped');

  const sample = result.rows.slice(0, 5).map(r =>
    '<div><em>' + esc(dateFmt(r.date) + ' · ' + r.description.slice(0, 54)) + '</em><span class="' +
    (r.amount >= 0 ? 'positive' : 'negative') + '">' + (r.amount >= 0 ? '+' : '−') + esc(fmt(Math.abs(r.amount))) + '</span></div>'
  ).join('');

  const balanceNote = result.balanceSource === 'balance-column'
    ? '<span class="badge ok">balances read from the statement</span>'
    : result.balanceSource === 'statement-summary'
      ? '<span class="badge ok">balances read from the summary box</span>'
      : '<span class="badge est">no balance column — opening and closing will be estimated</span>';

  showPreviewStatus(
    '<b>' + result.rows.length + ' transactions found</b> in ' + esc(file.name) + '<br>' +
    esc(dateFmt(result.from) + ' to ' + dateFmt(result.to)) + ' · ' + balanceNote +
    '<div class="summary-chips">' + chips.map(c => '<span>' + esc(c) + '</span>').join('') + '</div>' +
    '<div class="preview-rows">' + sample + '</div>' +
    (lastDiagnostics ? '<details class="diag"><summary>How this was parsed</summary><pre>' + esc(lastDiagnostics) + '</pre></details>' : ''),
    'ok');
}

importBtn.onclick = () => {
  if (!pending) return;
  const accountId = document.querySelector('#importAccount').value;
  if (!accountId) { toast('Choose which account this statement belongs to.'); return; }

  const currency = document.querySelector('#importCurrency').value;
  const statementId = uid();

  // Same account + date + description + amount is treated as the same row, so
  // re-importing an overlapping statement does not double-count anything.
  const seen = new Set(state.transactions.map(t => [t.account, t.date, t.description, t.amount].join('|')));
  const fresh = [];
  let duplicates = 0;

  for (const r of pending.rows) {
    const key = [accountId, r.date, r.description, r.amount].join('|');
    if (seen.has(key)) { duplicates++; continue; }
    seen.add(key);
    fresh.push({ ...r, id: uid(), account: accountId, currency, statementId });
  }

  if (!fresh.length) {
    toast('Every row in that statement was already imported.');
    uploadDialog.close();
    return;
  }

  state.transactions = state.transactions.concat(fresh);
  state.statements.push({
    id: statementId,
    accountId,
    name: (selectedFile && selectedFile.name) || 'Statement',
    from: pending.from, to: pending.to,
    opening: pending.opening, closing: pending.closing,
    additions: pending.additions, spends: pending.spends,
    balanceSource: pending.balanceSource,
    months: pending.months,
    count: fresh.length,
    currency,
    importedAt: new Date().toISOString()
  });

  // A statement's own closing balance is better evidence than a figure typed in
  // weeks ago, so bring the account forward — but only forward.
  const account = state.accounts.find(a => a.id === accountId);
  if (account && Number.isFinite(pending.closing) && pending.balanceSource !== 'none' &&
      (!account.date || pending.to >= account.date)) {
    account.balance = account.type === 'card' ? Math.abs(pending.closing) : pending.closing;
    account.date = pending.to;
  }

  // The first real import retires the sample data; the imported-into account
  // and its rows survive, because dropDemoData only removes seeded records.
  if (state.demo) dropDemoData();
  save();
  uploadDialog.close();
  toast('Imported ' + fresh.length + ' transactions' + (duplicates ? ' · ' + duplicates + ' duplicates skipped' : '') + '.');
  view = 'monthly';
  draw();
};

/* ==========================================================================
   17. Supabase sync (optional, entirely user-configured)
   ========================================================================== */

const syncDialog = document.querySelector('#syncDialog');
const TABLE = 'finance_tracker_state';
const SYNC_TIMEOUT_MS = 15000;
const SYNC_POLL_MS = 20000;

function setSyncStatus(message) {
  const el = document.querySelector('#syncStatus');
  if (el) el.textContent = message;
  const trigger = document.querySelector('#syncBtn');
  if (trigger) trigger.classList.toggle('on', !!cloudAuth);
  const label = document.querySelector('#syncLabel');
  if (label) label.textContent = cloudAuth ? 'Synced' : 'Sync';
}

async function cloudFetch(path, options) {
  if (!cloudCfg.url || !cloudCfg.key) throw new Error('Add your Supabase project URL and key first.');
  const opts = options || {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);
  try {
    const res = await fetch(cloudCfg.url.replace(/\/+$/, '') + path, {
      ...opts,
      signal: controller.signal,
      headers: {
        apikey: cloudCfg.key,
        'Content-Type': 'application/json',
        ...(cloudAuth ? { Authorization: 'Bearer ' + cloudAuth.access_token } : {}),
        ...(opts.headers || {})
      }
    });
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const detail = (body && (body.error_description || body.msg || body.message || body.error)) || ('HTTP ' + res.status);
      const err = new Error(detail);
      err.status = res.status;
      throw err;
    }
    return body;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Supabase did not respond within 15 seconds.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function saveCloudConfig() {
  try {
    localStorage.setItem(CLOUD, JSON.stringify(cloudCfg));
    if (cloudAuth) localStorage.setItem(AUTH, JSON.stringify(cloudAuth));
    else localStorage.removeItem(AUTH);
  } catch (e) { /* storage disabled; sync still works for this session */ }
}

function readSyncForm() {
  cloudCfg = {
    url: document.querySelector('#syncUrl').value.trim(),
    key: document.querySelector('#syncKey').value.trim()
  };
  saveCloudConfig();
  return {
    email: document.querySelector('#syncEmail').value.trim(),
    password: document.querySelector('#syncPassword').value
  };
}

async function authenticate(mode) {
  const { email, password } = readSyncForm();
  if (!cloudCfg.url || !cloudCfg.key) { setSyncStatus('Add the project URL and publishable key first.'); return; }
  if (!email || password.length < 8) { setSyncStatus('Enter an email and a password of at least 8 characters.'); return; }

  setSyncStatus(mode === 'signup' ? 'Creating your sync account…' : 'Signing in…');
  try {
    const path = mode === 'signup' ? '/auth/v1/signup' : '/auth/v1/token?grant_type=password';
    const body = await cloudFetch(path, { method: 'POST', body: JSON.stringify({ email, password }) });

    if (!body || !body.access_token) {
      setSyncStatus('Account created. Confirm the email Supabase sent, then choose “Sign in & sync”.');
      return;
    }
    cloudAuth = { access_token: body.access_token, refresh_token: body.refresh_token, user: body.user && body.user.id };
    saveCloudConfig();
    setSyncStatus('Signed in. Merging…');
    await syncPull({ merge: true });
    startSyncPolling();
    toast('Sync is on.');
    draw();
  } catch (err) {
    setSyncStatus('Could not sign in · ' + err.message);
  }
}

async function syncPush() {
  if (!cloudAuth || !cloudAuth.user) return;
  syncBusy = true;
  try {
    const payload = { accounts: state.accounts, transactions: state.transactions, statements: state.statements, demo: state.demo };
    await cloudFetch('/rest/v1/' + TABLE + '?on_conflict=user_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ user_id: cloudAuth.user, payload, updated_at: new Date().toISOString() })
    });
    lastRemoteAt = new Date().toISOString();
    setSyncStatus('Synced · ' + new Date().toLocaleTimeString());
  } finally {
    syncBusy = false;
  }
}

async function syncPull(options) {
  if (!cloudAuth || !cloudAuth.user) return;
  const rows = await cloudFetch('/rest/v1/' + TABLE + '?select=payload,updated_at&user_id=eq.' + cloudAuth.user, { method: 'GET' });
  const row = Array.isArray(rows) ? rows[0] : null;

  if (!row) { await syncPush(); return; }
  if (!options || !options.merge) {
    if (!row.updated_at || row.updated_at === lastRemoteAt) return;
  }
  lastRemoteAt = row.updated_at || '';

  const remote = migrate(row.payload || {});
  state = (options && options.merge) ? mergeStates(state, remote) : remote;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  setSyncStatus('Synced · ' + new Date().toLocaleTimeString());
  draw();
  if (options && options.merge) await syncPush();
}

/**
 * First sign-in on a device that already has data: keep both sides.
 * Accounts match on name + institution + type; transactions on
 * account + date + description + amount.
 */
function mergeStates(local, remote) {
  const merged = { accounts: [], transactions: [], statements: [], demo: false };
  const idMap = new Map();

  const accountKey = a => [a.name, a.institution || '', a.type].join('|').toLowerCase();
  const byKey = new Map();

  for (const a of remote.accounts.concat(local.accounts)) {
    const key = accountKey(a);
    if (byKey.has(key)) { idMap.set(a.id, byKey.get(key).id); continue; }
    const copy = { ...a };
    byKey.set(key, copy);
    idMap.set(a.id, copy.id);
    merged.accounts.push(copy);
  }

  const seen = new Set();
  for (const t of remote.transactions.concat(local.transactions)) {
    const account = idMap.get(t.account) || t.account;
    const key = [account, t.date, t.description, t.amount].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    merged.transactions.push({ ...t, account });
  }

  const statementSeen = new Set();
  for (const s of remote.statements.concat(local.statements)) {
    const key = [idMap.get(s.accountId) || s.accountId, s.from, s.to, s.count].join('|');
    if (statementSeen.has(key)) continue;
    statementSeen.add(key);
    merged.statements.push({ ...s, accountId: idMap.get(s.accountId) || s.accountId });
  }

  return migrate(merged);
}

function startSyncPolling() {
  clearInterval(startSyncPolling._timer);
  if (!cloudAuth) return;
  startSyncPolling._timer = setInterval(() => {
    if (document.hidden || syncBusy) return;
    syncPull().catch(err => setSyncStatus('Sync paused · ' + err.message));
  }, SYNC_POLL_MS);
}

document.querySelector('#syncSignUp').onclick = () => authenticate('signup');
document.querySelector('#syncSignIn').onclick = () => authenticate('signin');
document.querySelector('#syncNow').onclick = () => {
  if (!cloudAuth) { setSyncStatus('Sign in first.'); return; }
  setSyncStatus('Syncing…');
  syncPush().then(() => syncPull()).catch(err => setSyncStatus('Sync failed · ' + err.message));
};
document.querySelector('#syncSignOut').onclick = () => {
  cloudAuth = null;
  clearInterval(startSyncPolling._timer);
  saveCloudConfig();
  setSyncStatus('Disconnected · Your data stays in this browser. The cloud copy is untouched.');
  toast('This device is no longer syncing.');
};
document.querySelector('#syncClose').onclick = () => syncDialog.close();

/* ==========================================================================
   18. Chrome: navigation, theme, dialogs, boot
   ========================================================================== */

const sidebar = document.querySelector('#sidebar');
const scrim = document.querySelector('#scrim');

function closeSidebar() {
  sidebar.classList.remove('open');
  scrim.classList.remove('show');
}

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.onclick = () => {
    view = btn.dataset.view;
    flowMonth = null;
    closeSidebar();
    draw();
    document.querySelector('.content').scrollTo({ top: 0, behavior: 'smooth' });
  };
});

document.querySelector('#menuBtn').onclick = () => {
  sidebar.classList.toggle('open');
  scrim.classList.toggle('show', sidebar.classList.contains('open'));
};
scrim.onclick = closeSidebar;

document.querySelector('#themeBtn').onclick = cycleTheme;
document.querySelector('#syncBtn').onclick = () => {
  document.querySelector('#syncUrl').value = cloudCfg.url || '';
  document.querySelector('#syncKey').value = cloudCfg.key || '';
  syncDialog.showModal();
};
document.querySelector('#privacyBtn').onclick = () => document.querySelector('#privacyDialog').showModal();
document.querySelector('#privacyClose').onclick = () => document.querySelector('#privacyDialog').close();
document.querySelector('#privacyClose2').onclick = () => document.querySelector('#privacyDialog').close();

// Keep the auto theme following the system while "auto" is selected.
try {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((document.documentElement.dataset.themePref || 'auto') === 'auto') {
      applyTheme('auto');
      draw();
    }
  });
} catch (e) { /* older browsers: the theme simply stays as chosen */ }

document.querySelector('#today').textContent = new Date().toLocaleDateString('en-IN', {
  weekday: 'short', day: 'numeric', month: 'short'
});

applyTheme(document.documentElement.dataset.themePref || 'auto');

if (cloudAuth) {
  setSyncStatus('Reconnecting…');
  syncPull()
    .then(startSyncPolling)
    .catch(err => setSyncStatus('Sync paused · ' + err.message));
} else {
  setSyncStatus('Not connected · Your data is currently saved only in this browser.');
}

draw();
