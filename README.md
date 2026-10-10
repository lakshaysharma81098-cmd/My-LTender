# Stillwell

A personal finance tracker for Mac and iPhone. It runs as a static website with no build step.

## Deploy

Publish the contents of this folder from the root of a GitHub Pages branch. Open the published HTTPS address on both devices. Use Safari’s **Share → Add to Home Screen** on iPhone.

## Data and privacy

Without Sync, balances and imported transactions are saved only in that browser’s local storage, so each device has its own copy. Enable Sync in the app to use a Supabase project you control. The account balances and parsed transactions are then sent to that project and synchronized between signed-in devices. The project URL and public publishable/anon key are stored in the browser; the password is not. Supabase issues a session token saved in that browser. Do not use Sync unless you are comfortable storing this financial data in your Supabase project. GitHub Pages hosts the app files, not your financial records. There are no bank connections.

## Turn on cross-device Sync

1. Create a project at [supabase.com](https://supabase.com/dashboard). Use the same project on your Mac and iPhone.
2. In that project’s **SQL Editor**, run:

```sql
create table if not exists public.finance_tracker_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.finance_tracker_state enable row level security;

create policy "Users can read their own finance data"
on public.finance_tracker_state for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert their own finance data"
on public.finance_tracker_state for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update their own finance data"
on public.finance_tracker_state for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
```

3. In **Project Settings → API**, copy the Project URL and the publishable key (or legacy anon key).
4. In Stillwell, press **Sync**. Enter the URL, key, email, and a password, then choose **Create sync account**. If Supabase requires email confirmation, confirm it and then choose **Sign in & sync**.
5. On the other device, open the same Stillwell URL, enter the same project URL/key and sign in with the same email/password. Changes are pushed automatically and checked on the other device about every 20 seconds while the app is open.

Set the Supabase Auth **Site URL** to the published site address if email confirmation links need a redirect. Enable email/password sign-in in Supabase Auth. Your project’s row-level security policies restrict each login to its own row. Keep the SQL policies enabled; never expose a service-role key in the website.

If each device already has different data, the first sign-in merges accounts with matching name, institution, and type, and combines non-duplicate transactions. Review the merged balances after connecting. Sync keeps a copy in each browser too. To disconnect a device, choose **Disconnect this device**; this removes that browser’s login, not the cloud copy.

## Statement imports and reports

- Supports CSV, TSV, OFX/QFX, QIF, and text-based PDF statements. PDF text is extracted in your browser with PDF.js v6.4.299, loaded from jsDelivr when you choose a PDF. The statement file itself is not sent to the CDN or a server. CSV import searches the first 25 lines for a transaction header to accommodate bank export preambles. It recognizes common date, description/narration, debit/withdrawal, credit/deposit, amount, category, and running-balance column labels.
- Check the preview and choose the matching account before importing. Duplicate rows for the same account/date/description/amount are skipped.
- The dashboard summarizes the current month’s additions, spending, and net movement. **Monthly** shows seven calendar months so a six-month statement that begins partway through a month is still fully visible. Exact closing balances use a statement’s per-transaction balance column; when unavailable, opening/closing balances are shown only when they can be derived from a known balance. Estimates are marked. Reconcile imported totals against the original statement.
- Statement files are read in the browser and are not uploaded. The tested statement layout has selectable text with date, remarks, withdrawal, deposit, and balance columns, including wrapped transaction remarks; the importer groups those rows locally. Scanned/image-only PDFs are not supported because OCR is not included. Statement layouts vary; if a PDF’s rows are not recognized or the signs look wrong, use a bank CSV export or share a redacted sample to tune the parser. PDF.js is maintained by Mozilla; see its [official setup guidance](https://github.com/mozilla/pdf.js/wiki/Setup-pdf.js-in-a-website) and [release page](https://github.com/mozilla/pdf.js/releases). CSV layouts vary; if a file still fails, compare its column names with the preview error or share a redacted sample containing only the header and a few fake rows.

The dashboard initially contains illustrative sample data. Choose **Start with my data** to clear it.
