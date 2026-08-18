const BASE = process.env.API_URL ?? 'http://localhost:3000/api';

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

const money = (s) => Math.round(parseFloat(s) * 100);
const slip = () => `SLIP-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

async function balanceOf(token) {
  const dash = await call('/accounts/dashboard', { token });
  return {
    id: dash.body.accounts[0].id,
    number: dash.body.accounts[0].accountNumber,
    balance: money(dash.body.accounts[0].balance),
  };
}

async function main() {
  const admin = (await call('/auth/staff/login', {
    method: 'POST',
    body: { email: 'admin@zigama.test', password: 'Admin@12345' },
  })).body.token;

  const manager = (await call('/auth/staff/login', {
    method: 'POST',
    body: { email: 'manager@zigama.test', password: 'Manager@12345' },
  })).body.token;

  const grace = (await call('/auth/login', {
    method: 'POST',
    body: { accountNumber: '1000000001', pin: '1234' },
  })).body.token;

  console.log('\n--- Customers can no longer move cash directly ---');

  const acct = await balanceOf(grace);

  const selfDeposit = await call('/transactions/deposit', {
    token: grace,
    method: 'POST',
    body: { accountId: acct.id, amount: '999999' },
  });
  check('customer CANNOT deposit directly', selfDeposit.status === 403,
    `got ${selfDeposit.status}`);

  const selfWithdraw = await call('/transactions/withdraw', {
    token: grace,
    method: 'POST',
    body: { accountId: acct.id, amount: '100' },
  });
  check('customer CANNOT withdraw directly', selfWithdraw.status === 403,
    `got ${selfWithdraw.status}`);

  const tellerDeposit = await call('/transactions/deposit', {
    token: admin,
    method: 'POST',
    body: { accountId: acct.id, amount: '100' },
  });
  check('admin CAN still act as teller', tellerDeposit.status === 201,
    `got ${tellerDeposit.status}`);

  console.log('\n--- Branch deposit: no money until confirmed ---');

  const before = (await balanceOf(grace)).balance;
  const reference = slip();

  const declared = await call('/movements/deposits/branch', {
    token: grace,
    method: 'POST',
    body: {
      accountId: acct.id,
      amount: '50000',
      slipReference: reference,
      branchName: 'Kigali Main',
    },
  });
  check('customer can declare a branch deposit', declared.status === 201,
    `got ${declared.status} ${JSON.stringify(declared.body)}`);
  check('it starts PENDING', declared.body?.status === 'PENDING', declared.body?.status);

  const afterDeclare = (await balanceOf(grace)).balance;
  check('declaring does NOT move the balance', afterDeclare === before,
    `${before} -> ${afterDeclare}`);

  const depositId = declared.body.id;

  const customerApprove = await call(`/movements/${depositId}/approve`, {
    token: grace, method: 'POST', body: {},
  });
  check('customer cannot approve their own claim', customerApprove.status === 403,
    `got ${customerApprove.status}`);

  const adminApprove = await call(`/movements/${depositId}/approve`, {
    token: admin, method: 'POST', body: {},
  });
  check('admin cannot approve a cash movement', adminApprove.status === 403,
    `got ${adminApprove.status}`);

  const approved = await call(`/movements/${depositId}/approve`, {
    token: manager, method: 'POST', body: { note: 'Matched branch record' },
  });
  check('manager can approve', approved.status === 201, `got ${approved.status}`);
  check('status becomes COMPLETED', approved.body?.status === 'COMPLETED',
    approved.body?.status);

  const afterApprove = (await balanceOf(grace)).balance;
  check('balance credited on approval only', afterApprove === before + 5_000_000,
    `expected ${before + 5_000_000} got ${afterApprove}`);

  const doubleApprove = await call(`/movements/${depositId}/approve`, {
    token: manager, method: 'POST', body: {},
  });
  check('cannot approve the same deposit twice', doubleApprove.status === 409,
    `got ${doubleApprove.status}`);

  const afterDouble = (await balanceOf(grace)).balance;
  check('a second approval credits nothing', afterDouble === afterApprove,
    `${afterApprove} -> ${afterDouble}`);

  console.log('\n--- Deposit slips cannot be reused ---');

  const reuse = await call('/movements/deposits/branch', {
    token: grace,
    method: 'POST',
    body: {
      accountId: acct.id, amount: '1000',
      slipReference: reference, branchName: 'Kigali Main',
    },
  });
  check('the same slip reference is rejected', reuse.status === 409, `got ${reuse.status}`);

  console.log('\n--- Rejected deposit changes nothing ---');

  const beforeReject = (await balanceOf(grace)).balance;
  const toReject = await call('/movements/deposits/branch', {
    token: grace,
    method: 'POST',
    body: {
      accountId: acct.id, amount: '75000',
      slipReference: slip(), branchName: 'Kigali Main',
    },
  });
  const rejected = await call(`/movements/${toReject.body.id}/reject`, {
    token: manager, method: 'POST', body: { reason: 'No matching slip at the branch' },
  });
  check('manager can reject a claim', rejected.status === 201, `got ${rejected.status}`);
  check('status becomes REJECTED', rejected.body?.status === 'REJECTED', rejected.body?.status);
  check('a rejected deposit credits nothing',
    (await balanceOf(grace)).balance === beforeReject);

  console.log('\n--- Open-claim cap ---');

  const capped = [];
  for (let i = 0; i < 4; i++) {
    capped.push(await call('/movements/deposits/branch', {
      token: grace,
      method: 'POST',
      body: {
        accountId: acct.id, amount: '100',
        slipReference: slip(), branchName: 'Kigali Main',
      },
    }));
  }
  const accepted = capped.filter((r) => r.status === 201).length;
  const blocked = capped.filter((r) => r.status === 409).length;
  check('only 3 unconfirmed claims allowed', accepted === 3 && blocked === 1,
    `accepted ${accepted}, blocked ${blocked}`);

  // Clear them so later assertions are not affected.
  const queue = await call('/movements/pending', { token: manager });
  for (const row of queue.body.data.filter((r) => r.direction === 'DEPOSIT')) {
    await call(`/movements/${row.id}/reject`, {
      token: manager, method: 'POST', body: { reason: 'Test cleanup' },
    });
  }

  console.log('\n--- Withdrawal reserves immediately ---');

  const beforeW = (await balanceOf(grace)).balance;

  const wRequest = await call('/movements/withdrawals/branch', {
    token: grace,
    method: 'POST',
    body: { accountId: acct.id, amount: '30000', branchName: 'Kigali Main' },
  });
  check('customer can request a cash withdrawal', wRequest.status === 201,
    `got ${wRequest.status} ${JSON.stringify(wRequest.body)}`);

  const afterReserve = (await balanceOf(grace)).balance;
  check('funds are held straight away', afterReserve === beforeW - 3_000_000,
    `expected ${beforeW - 3_000_000} got ${afterReserve}`);

  const overdraw = await call('/movements/withdrawals/branch', {
    token: grace,
    method: 'POST',
    body: { accountId: acct.id, amount: '99999999', branchName: 'Kigali Main' },
  });
  check('cannot reserve more than the balance', overdraw.status === 400,
    `got ${overdraw.status}`);

  const collected = await call(`/movements/${wRequest.body.id}/approve`, {
    token: manager, method: 'POST', body: { note: 'Cash handed over' },
  });
  check('manager confirms collection', collected.status === 201, `got ${collected.status}`);
  check('collecting does not debit twice',
    (await balanceOf(grace)).balance === afterReserve,
    `balance moved after collection`);

  console.log('\n--- Rejected withdrawal is given back ---');

  const beforeR = (await balanceOf(grace)).balance;
  const wReject = await call('/movements/withdrawals/branch', {
    token: grace,
    method: 'POST',
    body: { accountId: acct.id, amount: '20000', branchName: 'Kigali Main' },
  });
  const heldBalance = (await balanceOf(grace)).balance;
  check('held while pending', heldBalance === beforeR - 2_000_000);

  const wRejected = await call(`/movements/${wReject.body.id}/reject`, {
    token: manager, method: 'POST', body: { reason: 'Customer never collected' },
  });
  check('manager can reject a withdrawal', wRejected.status === 201,
    `got ${wRejected.status}`);
  check('money is returned exactly once',
    (await balanceOf(grace)).balance === beforeR,
    `expected ${beforeR} got ${(await balanceOf(grace)).balance}`);

  console.log('\n--- Customer cancellation ---');

  const beforeC = (await balanceOf(grace)).balance;
  const wCancel = await call('/movements/withdrawals/branch', {
    token: grace,
    method: 'POST',
    body: { accountId: acct.id, amount: '15000', branchName: 'Kigali Main' },
  });
  const cancelled = await call(`/movements/${wCancel.body.id}/cancel`, {
    token: grace, method: 'POST',
  });
  check('customer can cancel their own request', cancelled.status === 201,
    `got ${cancelled.status}`);
  check('cancelling returns the money', (await balanceOf(grace)).balance === beforeC);

  const cancelAgain = await call(`/movements/${wCancel.body.id}/cancel`, {
    token: grace, method: 'POST',
  });
  check('cannot cancel twice', cancelAgain.status === 409, `got ${cancelAgain.status}`);
  check('a second cancel returns nothing extra',
    (await balanceOf(grace)).balance === beforeC);

  console.log("\n--- Cannot touch someone else's request ---");

  const eric = (await call('/auth/login', {
    method: 'POST', body: { accountNumber: '1000000002', pin: '2345' },
  })).body.token;

  const ericAcct = await balanceOf(eric);
  const ericRequest = await call('/movements/withdrawals/branch', {
    token: eric,
    method: 'POST',
    body: { accountId: ericAcct.id, amount: '5000', branchName: 'Kigali Main' },
  });
  const steal = await call(`/movements/${ericRequest.body.id}/cancel`, {
    token: grace, method: 'POST',
  });
  check("another customer cannot cancel it", steal.status === 403, `got ${steal.status}`);
  await call(`/movements/${ericRequest.body.id}/cancel`, { token: eric, method: 'POST' });

  const foreignAccount = await call('/movements/withdrawals/branch', {
    token: grace,
    method: 'POST',
    body: { accountId: ericAcct.id, amount: '100', branchName: 'Kigali Main' },
  });
  check("cannot withdraw from someone else's account", foreignAccount.status === 403,
    `got ${foreignAccount.status}`);

  console.log('\n--- Ledger still reconciles, including reversals ---');

  const byAccount = new Map();
  let page = 1;
  let pages = 1;
  do {
    const feed = await call(`/admin/transactions?limit=100&page=${page}`, { token: admin });
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
        console.log(`        MISMATCH ${a.accountNumber}: stored ${money(a.balance)} vs ledger ${expected}`);
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
