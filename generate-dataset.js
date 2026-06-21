const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { faker } = require('@faker-js/faker');

// ---------------------------------------------------------------------------
// Generates the 3 related datasets described in dataset_requirements.md:
//   merchants  - webshops using Recart
//   subscribers- people subscribed to a merchant's marketing messages
//   orders     - purchases made by people
//
// The data is streamed to CSV so we never hold all 2.5M+ rows in memory.
// Usage:  node generate-dataset.js [merchants] [subscribers] [orders]
//   defaults to the required minimums: 100 / 1,000,000 / 1,500,000
// ---------------------------------------------------------------------------

const MERCHANT_COUNT = Number(process.argv[2]) || 100;
const SUBSCRIBER_COUNT = Number(process.argv[3]) || 1_000_000;
const ORDER_COUNT = Number(process.argv[4]) || 1_500_000;

// Share of orders that are tied to a known subscriber. These orders reuse the
// subscriber's phone number, which simultaneously satisfies:
//   - "at least 30% of orders have a valid phone number"
//   - "there should be an overlap with the phone numbers in the subscribers set"
const ORDER_SUBSCRIBER_RATE = 0.4;
// Of the remaining (anonymous) orders, the share that still carry a phone.
const ORDER_ANON_PHONE_RATE = 0.2;
// Share of subscribers that have unsubscribed (requirement: at least 5%).
const UNSUBSCRIBE_RATE = 0.07;

const DATA_DIR = path.join(__dirname, 'data');

// 6-month window ending "now".
const NOW = new Date();
const WINDOW_START = new Date(NOW);
WINDOW_START.setMonth(WINDOW_START.getMonth() - 6);
const WINDOW_MS = NOW.getTime() - WINDOW_START.getTime();

function randomTimestampInWindow() {
  return new Date(WINDOW_START.getTime() + Math.random() * WINDOW_MS);
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

// Build a unique, valid-looking E.164 US phone number from a global counter.
// 10 digits after +1, area code starts at 200 (valid NANP range), so the
// numbers stay valid up to ~8 billion entries and never collide.
function phoneFromCounter(n) {
  const number = 2_000_000_000 + n; // 10-digit number, area code >= 200
  return '+1' + number;
}

// A small wrapper around a write stream that batches rows and respects
// backpressure so memory stays flat while writing millions of lines.
function createCsvWriter(filePath, header) {
  const stream = fs.createWriteStream(filePath);
  stream.write(header + '\n');
  let buffer = '';
  let pending = 0;

  return {
    async write(row) {
      buffer += row + '\n';
      if (++pending >= 5000) {
        const ok = stream.write(buffer);
        buffer = '';
        pending = 0;
        if (!ok) await new Promise((res) => stream.once('drain', res));
      }
    },
    async end() {
      if (buffer) stream.write(buffer);
      await new Promise((res) => stream.end(res));
    },
  };
}

function logProgress(label, done, total) {
  process.stdout.write(`\r  ${label}: ${done.toLocaleString()} / ${total.toLocaleString()}   `);
}

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log(
    `Generating ${MERCHANT_COUNT} merchants, ${SUBSCRIBER_COUNT.toLocaleString()} subscribers, ${ORDER_COUNT.toLocaleString()} orders`
  );
  console.log(
    `Time window: ${WINDOW_START.toISOString().slice(0, 10)} -> ${NOW.toISOString().slice(0, 10)}\n`
  );

  // --- merchants ---------------------------------------------------------
  const merchantIds = new Array(MERCHANT_COUNT);
  const merchantsWriter = createCsvWriter(path.join(DATA_DIR, 'merchants.csv'), 'id,domain');
  const usedDomains = new Set();
  for (let i = 0; i < MERCHANT_COUNT; i++) {
    const id = crypto.randomUUID();
    merchantIds[i] = id;
    // Append the index to guarantee domain uniqueness even if faker repeats.
    let host = `${faker.internet.domainWord()}-${i}.${faker.internet.domainSuffix()}`;
    while (usedDomains.has(host)) host = `${faker.internet.domainWord()}-${i}.${faker.internet.domainSuffix()}`;
    usedDomains.add(host);
    await merchantsWriter.write(`${csvEscape(id)},${csvEscape('https://' + host)}`);
  }
  await merchantsWriter.end();
  console.log('  merchants: done');

  // --- subscribers -------------------------------------------------------
  // Keep a compact in-memory index so orders can reference real subscribers.
  const subIds = new Array(SUBSCRIBER_COUNT);
  const subPhones = new Array(SUBSCRIBER_COUNT);
  const subMerchant = new Int32Array(SUBSCRIBER_COUNT);
  // Bucket subscriber row-indices per merchant for fast random lookup.
  const merchantSubs = Array.from({ length: MERCHANT_COUNT }, () => []);

  const subsWriter = createCsvWriter(
    path.join(DATA_DIR, 'subscribers.csv'),
    'id,merchant_id,phone_number,subscribed_at,unsubscribed_at'
  );

  let phoneCounter = 0;
  for (let i = 0; i < SUBSCRIBER_COUNT; i++) {
    const id = crypto.randomUUID();
    const merchantIdx = Math.floor(Math.random() * MERCHANT_COUNT);
    // Phone numbers are globally unique -> trivially unique per merchant too.
    const phone = phoneFromCounter(phoneCounter++);
    const subscribedAt = randomTimestampInWindow();
    let unsubscribedAt = '';
    if (Math.random() < UNSUBSCRIBE_RATE) {
      // Unsubscribe happens after subscribing, still within the window.
      const span = NOW.getTime() - subscribedAt.getTime();
      unsubscribedAt = new Date(subscribedAt.getTime() + Math.random() * span).toISOString();
    }

    subIds[i] = id;
    subPhones[i] = phone;
    subMerchant[i] = merchantIdx;
    merchantSubs[merchantIdx].push(i);

    await subsWriter.write(
      `${csvEscape(id)},${csvEscape(merchantIds[merchantIdx])},${csvEscape(phone)},${csvEscape(
        subscribedAt.toISOString()
      )},${csvEscape(unsubscribedAt)}`
    );
    if (i % 50000 === 0) logProgress('subscribers', i, SUBSCRIBER_COUNT);
  }
  await subsWriter.end();
  logProgress('subscribers', SUBSCRIBER_COUNT, SUBSCRIBER_COUNT);
  console.log('done');

  // --- orders ------------------------------------------------------------
  const ordersWriter = createCsvWriter(
    path.join(DATA_DIR, 'orders.csv'),
    'id,merchant_id,subscriber_id,email,phone_number,created_at'
  );

  for (let i = 0; i < ORDER_COUNT; i++) {
    const id = crypto.randomUUID();
    let merchantIdx;
    let subscriberId = '';
    let phone = '';

    const linkToSubscriber = Math.random() < ORDER_SUBSCRIBER_RATE;
    if (linkToSubscriber) {
      // Pick a merchant that actually has subscribers, then one of its subs.
      merchantIdx = Math.floor(Math.random() * MERCHANT_COUNT);
      const bucket = merchantSubs[merchantIdx];
      if (bucket.length > 0) {
        const subRow = bucket[Math.floor(Math.random() * bucket.length)];
        subscriberId = subIds[subRow];
        phone = subPhones[subRow]; // overlap with subscribers' phone numbers
      }
    } else {
      merchantIdx = Math.floor(Math.random() * MERCHANT_COUNT);
      if (Math.random() < ORDER_ANON_PHONE_RATE) {
        phone = phoneFromCounter(phoneCounter++);
      }
    }

    const email = faker.internet.email().toLowerCase();
    const createdAt = randomTimestampInWindow().toISOString();

    await ordersWriter.write(
      `${csvEscape(id)},${csvEscape(merchantIds[merchantIdx])},${csvEscape(subscriberId)},${csvEscape(
        email
      )},${csvEscape(phone)},${csvEscape(createdAt)}`
    );
    if (i % 50000 === 0) logProgress('orders', i, ORDER_COUNT);
  }
  await ordersWriter.end();
  logProgress('orders', ORDER_COUNT, ORDER_COUNT);
  console.log('done\n');

  console.log('Datasets written to data/: merchants.csv, subscribers.csv, orders.csv');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
