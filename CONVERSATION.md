# Conversation Log — recart-data-analyst

A transcript of the working session that set up the Faker-based data generators,
produced the Recart datasets, and cleaned the CSV files out of git history.

---

## 1. Install Faker + random user test script

**User:** Install https://fakerjs.dev/guide/usage.html and write a test script which
generates some random user; if I run the script, store the generated data in CSV in the data folder.

**Assistant:** Inspected the project (empty Node repo, no `package.json`). Then:
- Ran `npm init -y` and `npm install @faker-js/faker` (the maintained package; the old
  `faker` package is deprecated).
- Created `generate-users.js` — generates N random users and writes them to
  `data/users.csv`. Fields: `id`, `firstName`, `lastName`, `email`, `phone`, `city`,
  `country`, `company`, `jobTitle`, `signupDate`. Values are CSV-escaped.
- Added a `generate` npm script.
- Ran it and verified `data/users.csv` output.

Usage:
```bash
node generate-users.js        # 10 users (default)
node generate-users.js 50     # custom count
npm run generate              # via npm
```

---

## 2. Generate the Recart datasets from dataset_requirements.md

**User:** Read the `dataset_requirements.md` and create the dataset in the data folder
just as you did for the users test scenario.

**Requirements summary:** 3 related datasets —
- **merchants** (≥100): `id` (UUID, unique), `domain` (valid URI, unique).
- **subscribers** (≥1,000,000): `id` (UUID, unique), `merchant_id` (FK), `phone_number`
  (valid, unique per merchant), `subscribed_at` (not null), `unsubscribed_at` (nullable).
- **orders** (≥1,500,000): `id` (UUID, unique), `merchant_id` (FK), `subscriber_id`
  (nullable FK), `email` (valid, not null), `phone_number` (valid, nullable),
  `created_at` (not null).
- Subscribers & orders spread over a 6-month window.
- ≥30% of orders have a valid phone number, overlapping subscriber phone numbers.
- ≥5% of subscribers unsubscribed in the last 6 months.

**Assistant:** Built `generate-dataset.js`, a memory-efficient **streaming** generator:
- Streams rows to CSV with backpressure handling, so memory stays flat across millions
  of rows.
- Uses `crypto.randomUUID()` for fast unique IDs.
- Phone numbers are unique E.164 US numbers built from a global counter (globally unique
  ⇒ unique per merchant).
- Orders linked to a subscriber reuse that subscriber's phone number, creating the
  required overlap. ~40% of orders link to a subscriber; a further share of anonymous
  orders also carry a phone.
- Keeps a compact in-memory index of subscribers (bucketed per merchant) so orders can
  reference real subscribers.

Tested with small counts first (5 / 200 / 300), validated all constraints, then ran the
full generation with `node --max-old-space-size=4096 generate-dataset.js`.

**Full-dataset validation results:**

| File | Rows | Size |
|------|------|------|
| `data/merchants.csv` | 100 | 6.7 KB |
| `data/subscribers.csv` | 1,000,000 | 109 MB |
| `data/orders.csv` | 1,500,000 | 208 MB |

- merchants: 100 unique ids, 100 unique `https://` domains.
- subscribers: 1M unique ids; all FKs valid; 0 per-merchant phone duplicates; no null
  `subscribed_at`; **7.04%** unsubscribed (≥5%), always after subscribing.
- orders: 1.5M unique ids; all merchant FKs valid; all non-null subscriber FKs valid
  (901,220 null `subscriber_id`, allowed); every email valid; every `created_at` present;
  **52%** carry a valid phone (≥30%), with 598,780 overlapping subscriber phone numbers.

Added an npm script: `generate:dataset` → `node --max-old-space-size=4096 generate-dataset.js`.

---

## 3. Update the README

**User:** Based on this discussion, update the README.md.

**Assistant:** Rewrote `README.md` to document setup, both scripts (`generate-users.js`
and `generate-dataset.js`), the output-file table, run commands, full schemas and
constraints, and a note that the large CSVs are meant to be generated locally.

---

## 4. Gitignore the CSV files

**User:** Add to .gitignore the csv files.

**Assistant:** Created `.gitignore` (`node_modules/`, `data/*.csv`). Discovered the
dataset CSVs were **already tracked** (committed), so `.gitignore` alone wouldn't exclude
them — gitignore only affects untracked files. Ran `git rm --cached` on the three CSVs to
untrack them (files kept on disk). All four CSVs then reported as ignored.

---

## 5. Can't commit — CSVs in the first commit

**User:** Can't commit because the first commit still contains the csv files, solve this.

**Assistant:** Diagnosed that the large CSVs (subscribers 109 MB, orders 208 MB — both
over GitHub's 100 MB limit) were baked into an earlier commit (`feat: added datasets`).
Git pushes all history, so the blobs still blocked the push. With no `git-filter-repo` or
`bfg` available, used the built-in **`git filter-branch`** with an index-filter to strip
the CSV blobs from every commit (preserving all other files). Then deleted backup refs,
expired the reflog, and ran `git gc --prune=now`.

Result: no CSV in any commit; largest remaining blob 0.3 MB; CSVs still present on disk but
untracked; 4 commits preserved (new hashes due to history rewrite).

---

## 6. Push the rewritten history

**User (after a rejected `git push --force-with-lease ... (stale info)`):** shared the error.

**Assistant:** Explained that `filter-branch` had also rewritten the local
`origin/main` tracking ref, so `--force-with-lease`'s safety check compared against a
phantom value ("stale info"). Ran `git fetch origin` to restore the true remote state
(remote tip was `bd0d0fa`; the big files had never been pushed), then:

```bash
git push --force-with-lease origin main
# + bd0d0fa...eb5c5a7 main -> main (forced update)
```

Push succeeded — the rewritten, CSV-free history is now on GitHub.

---

## Files produced

- `generate-users.js` — random user CSV generator.
- `generate-dataset.js` — streaming merchants/subscribers/orders generator.
- `data/users.csv`, `data/merchants.csv`, `data/subscribers.csv`, `data/orders.csv`
  (generated locally; gitignored).
- `.gitignore` — ignores `node_modules/` and `data/*.csv`.
- `README.md` — project documentation.
- `package.json` scripts: `generate`, `generate:dataset`.
