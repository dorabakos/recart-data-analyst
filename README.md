# recart-data-analyst

Home assignment. Generates synthetic test data with [Faker](https://fakerjs.dev) and writes it to CSV in the `data/` folder.

## Setup

```bash
npm install
```

## Scripts

### `generate-users.js` — random user sample

A small warm-up script that generates random users and writes them to `data/users.csv`.

```bash
node generate-users.js        # 10 users (default)
node generate-users.js 50     # custom count
npm run generate              # via npm (10 users)
```

Each user has: `id`, `firstName`, `lastName`, `email`, `phone`, `city`, `country`, `company`, `jobTitle`, `signupDate`. Re-running overwrites `data/users.csv`.

### `generate-dataset.js` — Recart datasets

Generates the three related datasets described in [dataset_requirements.md](dataset_requirements.md):

| File | Default rows | Description |
|------|-------------|-------------|
| `data/merchants.csv` | 100 | Webshops that use Recart |
| `data/subscribers.csv` | 1,000,000 | People subscribed to a merchant's marketing messages |
| `data/orders.csv` | 1,500,000 | Purchases made by people |

```bash
npm run generate:dataset                   # defaults: 100 / 1M / 1.5M
node --max-old-space-size=4096 generate-dataset.js
node generate-dataset.js 10 1000 2000      # custom: merchants / subscribers / orders (quick test)
```

> The full dataset is ~317 MB. The larger heap (`--max-old-space-size=4096`) is used because an
> in-memory index of subscribers is kept so orders can reference real subscribers. Rows are streamed
> to CSV with backpressure handling, so memory stays flat regardless of row count.

#### Schemas & constraints

**merchants**
- `id` — UUID, not null, unique
- `domain` — valid `https://` URI, not null, unique

**subscribers**
- `id` — UUID, not null, unique
- `merchant_id` — references `merchants.id`, not null
- `phone_number` — valid E.164 phone, not null, unique per merchant
- `subscribed_at` — timestamp, not null
- `unsubscribed_at` — timestamp, nullable (always after `subscribed_at`)

**orders**
- `id` — UUID, not null, unique
- `merchant_id` — references `merchants.id`, not null
- `subscriber_id` — references `subscribers.id`, nullable
- `email` — valid email, not null
- `phone_number` — valid phone, nullable
- `created_at` — timestamp, not null

Additional guarantees enforced by the generator:
- Subscribers and orders are distributed over a rolling 6-month window.
- At least 5% of subscribers have unsubscribed within the window (~7%).
- At least 30% of orders carry a valid phone number (~52%); orders linked to a subscriber reuse that
  subscriber's phone number, creating the required overlap between the two datasets.

## Notes

The generated CSVs are large (hundreds of MB) and are meant to be produced locally rather than
committed to the repository.
