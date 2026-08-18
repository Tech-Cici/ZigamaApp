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

async function main() {
  console.log('\n--- Auth ---');

  const badLogin = await call('/auth/login', {
    method: 'POST',
    body: { accountNumber: '1000000001', pin: '9999' },
  });
  check('wrong PIN is rejected', badLogin.status === 401, `got ${badLogin.status}`);

  const login = await call('/auth/login', {
    method: 'POST',
    body: { accountNumber: '1000000001', pin: '1234' },
  });
  check('customer login succeeds', login.status === 201 && !!login.body?.token, `got ${login.status}`);
  const grace = login.body.token;

  const staff = await call('/auth/staff/login', {
    method: 'POST',
    body: { email: 'admin@zigama.test', password: 'Admin@12345' },
  });
  check('admin login succeeds', staff.status === 201 && !!staff.body?.token, `got ${staff.status}`);
  const admin = staff.body.token;

  const mgr = await call('/auth/staff/login', {
    method: 'POST',
    body: { email: 'manager@zigama.test', password: 'Manager@12345' },
  });
  check('manager login succeeds', mgr.status === 201, `got ${mgr.status}`);
  const manager = mgr.body.token;

  const noToken = await call('/accounts/dashboard');
  check('unauthenticated request is rejected', noToken.status === 401, `got ${noToken.status}`);

  const customerAsStaff = await call('/auth/staff/login', {
    method: 'POST',
    body: { email: 'grace@example.test', password: 'Admin@12345' },
  });
  check('customer cannot use the staff login', customerAsStaff.status === 401, `got ${customerAsStaff.status}`);

  console.log('\n--- Dashboard ---');
  const dash = await call('/accounts/dashboard', { token: grace });
  check('dashboard returns accounts', dash.status === 200 && dash.body.accounts.length === 2, `got ${dash.status}`);
  check('dashboard has recent transactions', dash.body.recentTransactions.length > 0);

  const checking = dash.body.accounts.find((a) => a.type === 'CHECKING');
  const savings = dash.body.accounts.find((a) => a.type === 'SAVINGS');
  const startBalance = money(checking.balance);
  console.log(`        checking ${checking.accountNumber} balance ${checking.balance}`);

  const totalFromAccounts = dash.body.accounts.reduce((s, a) => s + money(a.balance), 0);
  check('totalBalance equals the sum of accounts', totalFromAccounts === money(dash.body.totalBalance));

  console.log('\n--- Deposit / withdraw / transfer ---');

  const dep = await call('/transactions/deposit', {
    token: grace,
    method: 'POST',
    body: { accountId: checking.id, amount: '5000.50', description: 'test deposit' },
  });
  check('deposit succeeds', dep.status === 201, `got ${dep.status} ${JSON.stringify(dep.body)}`);
  check('deposit balanceAfter is correct', money(dep.body.balanceAfter) === startBalance + 500050,
    `expected ${startBalance + 500050} got ${money(dep.body.balanceAfter)}`);

  const wdr = await call('/transactions/withdraw', {
    token: grace,
    method: 'POST',
    body: { accountId: checking.id, amount: 2000.25 },
  });
  check('withdrawal succeeds', wdr.status === 201, `got ${wdr.status} ${JSON.stringify(wdr.body)}`);
  check('withdrawal balanceAfter is correct', money(wdr.body.balanceAfter) === startBalance + 500050 - 200025,
    `got ${money(wdr.body.balanceAfter)}`);

  const before2 = await call('/accounts/dashboard', { token: grace });
  const ericLookup = await call('/accounts/lookup/1000000002', { token: grace });
  check('recipient lookup works', ericLookup.status === 200, `got ${ericLookup.status}`);
  check('recipient name is masked', /^\w\*+/.test(ericLookup.body.accountHolder), ericLookup.body.accountHolder);

  const trf = await call('/transactions/transfer', {
    token: grace,
    method: 'POST',
    body: { fromAccountId: checking.id, toAccountNumber: '1000000002', amount: '1500' },
  });
  check('transfer succeeds', trf.status === 201, `got ${trf.status} ${JSON.stringify(trf.body)}`);

  const afterTransfer = await call('/accounts/dashboard', { token: grace });
  const checkingAfter = afterTransfer.body.accounts.find((a) => a.id === checking.id);
  const prevChecking = before2.body.accounts.find((a) => a.id === checking.id);
  check('sender debited by exactly the transfer amount',
    money(prevChecking.balance) - money(checkingAfter.balance) === 150000,
    `delta ${money(prevChecking.balance) - money(checkingAfter.balance)}`);

  // Recipient side
  const ericLogin = await call('/auth/login', { method: 'POST', body: { accountNumber: '1000000002', pin: '2345' } });
  const eric = ericLogin.body.token;
  const ericDash = await call('/accounts/dashboard', { token: eric });
  const ericTx = ericDash.body.recentTransactions[0];
  check('recipient sees a TRANSFER_IN entry', ericTx.type === 'TRANSFER_IN', ericTx.type);
  check('recipient credit amount matches', money(ericTx.amount) === 150000, ericTx.amount);

  console.log('\n--- Validation and limits ---');

  const negative = await call('/transactions/deposit', {
    token: grace, method: 'POST', body: { accountId: checking.id, amount: -100 },
  });
  check('negative deposit rejected', negative.status === 400, `got ${negative.status}`);

  const zero = await call('/transactions/deposit', {
    token: grace, method: 'POST', body: { accountId: checking.id, amount: 0 },
  });
  check('zero deposit rejected', zero.status === 400, `got ${zero.status}`);

  const threeDp = await call('/transactions/deposit', {
    token: grace, method: 'POST', body: { accountId: checking.id, amount: '10.999' },
  });
  check('more than 2 decimal places rejected', threeDp.status === 400, `got ${threeDp.status}`);

  const huge = await call('/transactions/withdraw', {
    token: grace, method: 'POST', body: { accountId: checking.id, amount: '999999999' },
  });
  check('withdrawal beyond balance rejected', huge.status === 400, `got ${huge.status}`);

  const selfTransfer = await call('/transactions/transfer', {
    token: grace, method: 'POST',
    body: { fromAccountId: checking.id, toAccountNumber: checking.accountNumber, amount: '10' },
  });
  check('self-transfer rejected', selfTransfer.status === 400, `got ${selfTransfer.status}`);

  const unknownRecipient = await call('/transactions/transfer', {
    token: grace, method: 'POST',
    body: { fromAccountId: checking.id, toAccountNumber: '9999999999', amount: '10' },
  });
  check('unknown recipient rejected', unknownRecipient.status === 404, `got ${unknownRecipient.status}`);

  console.log('\n--- Authorization ---');

  const ericAttack = await call('/transactions/withdraw', {
    token: eric, method: 'POST', body: { accountId: checking.id, amount: '100' },
  });
  check("customer cannot withdraw from another customer's account", ericAttack.status === 403, `got ${ericAttack.status}`);

  const ericRead = await call(`/accounts/${checking.id}`, { token: eric });
  check("customer cannot read another customer's account", ericRead.status === 403, `got ${ericRead.status}`);

  const customerAdmin = await call('/admin/stats', { token: grace });
  check('customer cannot reach admin routes', customerAdmin.status === 403, `got ${customerAdmin.status}`);

  const managerStats = await call('/admin/stats', { token: manager });
  check('manager can read stats', managerStats.status === 200, `got ${managerStats.status}`);

  const managerWrite = await call(`/admin/accounts/${checking.id}/status`, {
    token: manager, method: 'PATCH', body: { status: 'FROZEN' },
  });
  check('manager cannot change account status', managerWrite.status === 403, `got ${managerWrite.status}`);

  const managerAudit = await call('/admin/audit-logs', { token: manager });
  check('manager cannot read audit logs', managerAudit.status === 403, `got ${managerAudit.status}`);

  console.log('\n--- Admin ---');

  // The seed creates 4 approved customers plus 2 left awaiting approval.
  const stats = await call('/admin/stats', { token: admin });
  check('admin stats returns counts',
    stats.status === 200 &&
      stats.body.totalCustomers === 6 &&
      stats.body.activeCustomers === 4 &&
      stats.body.pendingApprovals === 2,
    JSON.stringify(stats.body));
  console.log(`        holdings ${stats.body.totalHoldings}, txns today ${stats.body.transactionsToday}`);

  const users = await call('/admin/users', { token: admin });
  check('admin lists users', users.status === 200 && users.body.data.length >= 4, `got ${users.status}`);

  const search = await call('/admin/users?search=1000000003', { token: admin });
  check('admin can search by account number', search.status === 200 && search.body.data.length === 1,
    `got ${search.body?.data?.length}`);

  const allTx = await call('/admin/transactions?limit=5', { token: admin });
  check('admin sees the platform transaction feed', allTx.status === 200 && allTx.body.data.length === 5,
    `got ${allTx.status}`);
  check('feed rows include the account holder', !!allTx.body.data[0].accountHolder);

  const audit = await call('/admin/audit-logs', { token: admin });
  check('audit log is populated', audit.status === 200 && audit.body.data.length > 0, `got ${audit.status}`);

  console.log('\n--- Freeze blocks operations ---');

  const freeze = await call(`/admin/accounts/${checking.id}/status`, {
    token: admin, method: 'PATCH', body: { status: 'FROZEN' },
  });
  check('admin can freeze an account', freeze.status === 200 && freeze.body.status === 'FROZEN', `got ${freeze.status}`);

  const frozenWithdraw = await call('/transactions/withdraw', {
    token: grace, method: 'POST', body: { accountId: checking.id, amount: '10' },
  });
  check('frozen account cannot withdraw', frozenWithdraw.status === 403, `got ${frozenWithdraw.status}`);

  const unfreeze = await call(`/admin/accounts/${checking.id}/status`, {
    token: admin, method: 'PATCH', body: { status: 'ACTIVE' },
  });
  check('admin can unfreeze', unfreeze.status === 200 && unfreeze.body.status === 'ACTIVE');

  console.log('\n--- Concurrency: no double spend ---');

  const dianeLogin = await call('/auth/login', { method: 'POST', body: { accountNumber: '1000000003', pin: '3456' } });
  const diane = dianeLogin.body.token;
  const dianeDash = await call('/accounts/dashboard', { token: diane });
  const dianeAcct = dianeDash.body.accounts[0];
  const dianeStart = money(dianeAcct.balance);

  // Fire 12 concurrent withdrawals each worth 1/6 of the balance. At most 6 can
  // succeed; the rest must be rejected. A race would let too many through or
  // drive the balance negative.
  const slice = Math.floor(dianeStart / 6);
  const sliceMajor = (slice / 100).toFixed(2);
  const results = await Promise.all(
    Array.from({ length: 12 }, () =>
      call('/transactions/withdraw', {
        token: diane, method: 'POST',
        body: { accountId: dianeAcct.id, amount: sliceMajor },
      }),
    ),
  );
  const succeeded = results.filter((r) => r.status === 201).length;
  const rejected = results.filter((r) => r.status === 400).length;
  console.log(`        ${succeeded} succeeded, ${rejected} rejected out of 12`);
  check('at most 6 concurrent withdrawals succeed', succeeded <= 6, `got ${succeeded}`);
  check('every other attempt was cleanly rejected', succeeded + rejected === 12,
    `succeeded ${succeeded} rejected ${rejected}`);

  const dianeAfter = await call('/accounts/dashboard', { token: diane });
  const finalBalance = money(dianeAfter.body.accounts[0].balance);
  check('balance never went negative', finalBalance >= 0, `got ${finalBalance}`);
  check('final balance equals start minus successful withdrawals',
    finalBalance === dianeStart - succeeded * slice,
    `expected ${dianeStart - succeeded * slice} got ${finalBalance}`);

  console.log('\n--- Ledger reconciliation ---');

  // Walk every page. Reading only the first page would silently compare
  // balances against a partial ledger and could "pass" on a truncated sum.
  const byAccount = new Map();
  let page = 1;
  let pages = 1;
  let counted = 0;
  do {
    const feed = await call(`/admin/transactions?limit=100&page=${page}`, {
      token: admin,
    });
    pages = feed.body.pagination.totalPages;
    for (const t of feed.body.data) {
      const credit = t.type === 'DEPOSIT' || t.type === 'TRANSFER_IN';
      const delta = credit ? money(t.amount) : -money(t.amount);
      byAccount.set(
        t.accountNumber,
        (byAccount.get(t.accountNumber) ?? 0) + delta,
      );
      counted += 1;
    }
    page += 1;
  } while (page <= pages);
  console.log(`        summed ${counted} ledger entries across ${pages} page(s)`);
  const usersAll = await call('/admin/users?limit=50', { token: admin });
  let reconciled = true;
  for (const u of usersAll.body.data) {
    for (const a of u.accounts) {
      const expected = byAccount.get(a.accountNumber) ?? 0;
      if (expected !== money(a.balance)) {
        reconciled = false;
        console.log(`        MISMATCH ${a.accountNumber}: stored ${money(a.balance)} vs sum ${expected}`);
      }
    }
  }
  check('every account balance equals the sum of its ledger entries', reconciled);

  console.log(`\n===== ${pass} passed, ${fail} failed =====\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('Test run crashed:', e);
  process.exit(1);
});
