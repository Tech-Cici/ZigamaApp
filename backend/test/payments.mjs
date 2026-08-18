import { createHmac, randomUUID } from 'node:crypto';

const BASE = process.env.API_URL ?? 'http://localhost:3000/api';
const SECRET = process.env.PAYMENT_WEBHOOK_SECRET;

let pass = 0;
let fail = 0;

function check(name, condition, detail = '') {
  if (condition) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name} ${detail}`);
  }
}

async function call(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, body: json };
}

/**
 * Posts a webhook the way the provider would: a JSON body plus an HMAC over
 * exactly those bytes. Signing the same string we send is the point — the server
 * verifies the raw buffer, not a re-serialised object.
 */
async function webhook(payload, { signature, tamper } = {}) {
  const raw = JSON.stringify(payload);
  const sig = signature ?? createHmac('sha256', SECRET).update(raw).digest('hex');
  const sentBody = tamper ? JSON.stringify({ ...payload, ...tamper }) : raw;

  const res = await fetch(`${BASE}/payments/webhooks/mock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-signature': sig },
    body: sentBody,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, body: json };
}

const money = (s) => Math.round(parseFloat(s) * 100);

async function main() {
  if (!SECRET) {
    console.error(
      'PAYMENT_WEBHOOK_SECRET must be set to the same value the API uses.',
    );
    process.exit(1);
  }

  const admin = (await call('/auth/staff/login', {
    method: 'POST',
    body: { email: 'admin@zigama.test', password: 'Admin@12345' },
  })).body.token;

  const grace = (await call('/auth/login', {
    method: 'POST',
    body: { accountNumber: '1000000001', pin: '1234' },
  })).body.token;

  const dash = await call('/accounts/dashboard', { token: grace });
  const account = dash.body.accounts[0];

  const balance = async () => {
    const d = await call('/accounts/dashboard', { token: grace });
    return money(d.body.accounts.find((a) => a.id === account.id).balance);
  };

  console.log('\n--- Mobile money deposit: nothing until confirmed ---');

  const before = await balance();
  const deposit = await call('/movements/deposits/momo', {
    token: grace,
    method: 'POST',
    body: { accountId: account.id, amount: '40000', idempotencyKey: randomUUID() },
  });
  check('collection can be requested', deposit.status === 201,
    `got ${deposit.status} ${JSON.stringify(deposit.body)}`);
  check('it goes to PROCESSING', deposit.body?.status === 'PROCESSING',
    deposit.body?.status);
  check('requesting credits nothing', (await balance()) === before);

  const ref = deposit.body.reference;
  const full = await call('/movements/mine', { token: grace });
  const providerRef = full.body.data.find((m) => m.reference === ref)?.providerRef;

  console.log('\n--- Signature is required ---');

  const unsigned = await webhook(
    { eventId: randomUUID(), providerRef, status: 'SUCCEEDED' },
    { signature: 'not-a-real-signature' },
  );
  check('a bad signature is refused', unsigned.body?.received === false,
    JSON.stringify(unsigned.body));
  check('and nothing was credited', (await balance()) === before);

  console.log('\n--- Tampered payload does not verify ---');

  const tampered = await webhook(
    { eventId: randomUUID(), providerRef, status: 'SUCCEEDED', amountMinor: '4000000' },
    { tamper: { amountMinor: '99999999' } },
  );
  check('changing the body after signing is refused',
    tampered.body?.received === false, JSON.stringify(tampered.body));
  check('still nothing credited', (await balance()) === before);

  console.log('\n--- Amount must match the recorded request ---');

  const wrongAmount = await webhook({
    eventId: randomUUID(),
    providerRef,
    status: 'SUCCEEDED',
    amountMinor: '99999999',
  });
  check('a correctly signed but wrong amount is not applied',
    wrongAmount.status === 200, `got ${wrongAmount.status}`);
  check('balance unchanged by the mismatched amount',
    (await balance()) === before);

  console.log('\n--- Confirmed webhook credits exactly once ---');

  const eventId = randomUUID();
  const payload = {
    eventId,
    providerRef,
    status: 'SUCCEEDED',
    amountMinor: '4000000',
  };

  const first = await webhook(payload);
  check('the callback is accepted', first.body?.received === true,
    JSON.stringify(first.body));
  const afterFirst = await balance();
  check('money is credited', afterFirst === before + 4_000_000,
    `expected ${before + 4_000_000} got ${afterFirst}`);

  const replay = await webhook(payload);
  check('a replay is recognised as a duplicate', replay.body?.duplicate === true,
    JSON.stringify(replay.body));
  check('the replay credits nothing', (await balance()) === afterFirst);

  console.log('\n--- Concurrent duplicate deliveries ---');

  const secondDeposit = await call('/movements/deposits/momo', {
    token: grace,
    method: 'POST',
    body: { accountId: account.id, amount: '10000', idempotencyKey: randomUUID() },
  });
  const mine2 = await call('/movements/mine', { token: grace });
  const ref2 = mine2.body.data.find(
    (m) => m.reference === secondDeposit.body.reference,
  )?.providerRef;

  const beforeRace = await balance();
  const sameEvent = randomUUID();
  const racePayload = {
    eventId: sameEvent,
    providerRef: ref2,
    status: 'SUCCEEDED',
    amountMinor: '1000000',
  };
  await Promise.all([
    webhook(racePayload),
    webhook(racePayload),
    webhook(racePayload),
  ]);
  check('three simultaneous identical deliveries credit once',
    (await balance()) === beforeRace + 1_000_000,
    `expected ${beforeRace + 1_000_000} got ${await balance()}`);

  console.log('\n--- Out-of-order delivery ---');

  const late = await webhook({
    eventId: randomUUID(),
    providerRef: ref2,
    status: 'PENDING',
  });
  check('a late progress notification is harmless', late.status === 200);
  check('and changes no money', (await balance()) === beforeRace + 1_000_000);

  console.log('\n--- Idempotency key returns the original request ---');

  const key = randomUUID();
  const once = await call('/movements/deposits/momo', {
    token: grace,
    method: 'POST',
    body: { accountId: account.id, amount: '7000', idempotencyKey: key },
  });
  const twice = await call('/movements/deposits/momo', {
    token: grace,
    method: 'POST',
    body: { accountId: account.id, amount: '7000', idempotencyKey: key },
  });
  check('the same key returns the same movement',
    once.body?.reference === twice.body?.reference,
    `${once.body?.reference} vs ${twice.body?.reference}`);

  console.log('\n--- Payout reserves, then settles ---');

  const beforePayout = await balance();
  const payout = await call('/movements/withdrawals/momo', {
    token: grace,
    method: 'POST',
    body: { accountId: account.id, amount: '25000', idempotencyKey: randomUUID() },
  });
  check('payout can be requested', payout.status === 201,
    `got ${payout.status} ${JSON.stringify(payout.body)}`);
  check('funds are held immediately',
    (await balance()) === beforePayout - 2_500_000,
    `expected ${beforePayout - 2_500_000} got ${await balance()}`);

  const mine3 = await call('/movements/mine', { token: grace });
  const payoutRef = mine3.body.data.find(
    (m) => m.reference === payout.body.reference,
  )?.providerRef;

  await webhook({
    eventId: randomUUID(),
    providerRef: payoutRef,
    status: 'SUCCEEDED',
    amountMinor: '2500000',
  });
  check('settling a payout does not debit twice',
    (await balance()) === beforePayout - 2_500_000);

  console.log('\n--- Failed payout is given back exactly once ---');

  const beforeFail = await balance();
  // The mock reports FAILED for amounts ending in .01
  const failing = await call('/movements/withdrawals/momo', {
    token: grace,
    method: 'POST',
    body: { accountId: account.id, amount: '15000.01', idempotencyKey: randomUUID() },
  });
  check('the payout is reserved first',
    (await balance()) === beforeFail - 1_500_001,
    `got ${await balance()}`);

  const mine4 = await call('/movements/mine', { token: grace });
  const failRef = mine4.body.data.find(
    (m) => m.reference === failing.body.reference,
  )?.providerRef;

  const failEvent = {
    eventId: randomUUID(),
    providerRef: failRef,
    status: 'FAILED',
    amountMinor: '1500001',
  };
  await webhook(failEvent);
  check('a failed payout returns the money', (await balance()) === beforeFail,
    `expected ${beforeFail} got ${await balance()}`);

  await webhook(failEvent);
  check('replaying the failure refunds nothing extra',
    (await balance()) === beforeFail);

  console.log('\n--- Unknown reference is retried, not discarded ---');

  const orphan = await webhook({
    eventId: randomUUID(),
    providerRef: 'MOCKC-DOESNOTEXIST',
    status: 'SUCCEEDED',
  });
  check('an unmatched callback is still accepted', orphan.status === 200);

  const events = await call('/admin/reconciliation/webhooks?limit=100', {
    token: admin,
  });
  const orphanEvent = events.body.data.find(
    (e) => e.providerRef === 'MOCKC-DOESNOTEXIST',
  );
  check('and queued for retry rather than dropped',
    orphanEvent?.status === 'FAILED' || orphanEvent?.status === 'DEAD_LETTER',
    orphanEvent?.status);

  console.log('\n--- Reconciliation ---');

  const report = await call('/admin/reconciliation/run', {
    token: admin,
    method: 'POST',
  });
  check('admin can run reconciliation', report.status === 201,
    `got ${report.status}`);
  check('it reports no ledger mismatches',
    report.body?.ledgerMismatches?.length === 0,
    JSON.stringify(report.body?.ledgerMismatches));

  const managerRun = await call('/admin/reconciliation/run', {
    token: (await call('/auth/staff/login', {
      method: 'POST',
      body: { email: 'manager@zigama.test', password: 'Manager@12345' },
    })).body.token,
    method: 'POST',
  });
  check('a manager cannot trigger reconciliation', managerRun.status === 403,
    `got ${managerRun.status}`);

  const unresolved = await call('/admin/reconciliation/unresolved', {
    token: admin,
  });
  check('unresolved movements are visible to staff', unresolved.status === 200,
    `got ${unresolved.status}`);

  console.log('\n--- Ledger reconciles across every channel ---');

  const byAccount = new Map();
  let page = 1;
  let pages = 1;
  do {
    const feed = await call(`/admin/transactions?limit=100&page=${page}`, {
      token: admin,
    });
    pages = feed.body.pagination.totalPages;
    for (const t of feed.body.data) {
      const delta = t.direction === '+' ? money(t.amount) : -money(t.amount);
      byAccount.set(t.accountNumber, (byAccount.get(t.accountNumber) ?? 0) + delta);
    }
    page += 1;
  } while (page <= pages);

  const users = await call('/admin/users?limit=100', { token: admin });
  let reconciled = true;
  for (const u of users.body.data) {
    for (const a of u.accounts) {
      const expected = byAccount.get(a.accountNumber) ?? 0;
      if (expected !== money(a.balance)) {
        reconciled = false;
        console.log(
          `        MISMATCH ${a.accountNumber}: stored ${money(a.balance)} vs ledger ${expected}`,
        );
      }
    }
  }
  check('every balance equals the sum of its ledger entries', reconciled);

  console.log(`\n===== ${pass} passed, ${fail} failed =====\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('Test run crashed:', e);
  process.exit(1);
});
