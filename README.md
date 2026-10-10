# Stillwell

A personal finance tracker that runs as a static website. It works on a Mac or iPhone browser and needs no account, backend, or build tools.

## Run locally

1. Open `index.html` in a current browser on your Mac.
2. For iPhone use, put this folder on a static web host you control (or serve it on your home network and visit its local address in Safari). The same URL can be saved to the iPhone home screen from Safari's Share menu.

The initial dashboard contains clearly labeled illustrative sample data. Choose **Start with my data** to clear it, or edit the sample accounts and replace them with your own balances.

## What it does

- Tracks bank accounts, fixed deposits, credit cards, and mutual funds with manually entered balances and dates.
- Calculates net worth as assets less the card balances you owe. Credit card limits and utilization can be recorded too.
- Imports CSV, TSV, OFX/QFX, and QIF statement files. CSV headers for dates, descriptions, amounts, debits, credits, and categories are recognized. Imported transactions can be recategorized and summarized by spending category.
- Shows spending totals, income, activity, categories, and a small trend chart with month, 3-month, and year filters.

## Privacy and limitations

Statement files are read in the browser and are not uploaded. Parsed transactions and account balances are stored in this browser's local storage. Anyone with access to this browser profile may see the data; clearing site data removes it. There is no bank connection, sync, authentication, encryption layer, or automatic balance refresh. Do not use a shared device for sensitive records. The Google Fonts stylesheet is an optional visual font request; the finance data is not sent with it. PDF statements and image scans are not supported. Bank CSV formats vary, so confirm imported dates, signs, and categories against the statement.

For deployment, serve the folder over HTTPS from a static host. No server-side application or build process is required.
