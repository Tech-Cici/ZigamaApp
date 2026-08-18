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

const unique = () => Math.random().toString(36).slice(2, 10);

async function main() {
  console.log('\n--- Setup ---');

  const adminLogin = await call('/auth/staff/login', {
    method: 'POST',
    body: { email: 'admin@zigama.test', password: 'Admin@12345' },
  });
  const managerLogin = await call('/auth/staff/login', {
    method: 'POST',
    body: { email: 'manager@zigama.test', password: 'Manager@12345' },
  });
  const customerLogin = await call('/auth/login', {
    method: 'POST',
    body: { accountNumber: '1000000001', pin: '1234' },
  });

  check('admin signs in', adminLogin.status === 201, `got ${adminLogin.status}`);
  check('manager signs in', managerLogin.status === 201, `got ${managerLogin.status}`);
  check('approved customer signs in', customerLogin.status === 201, `got ${customerLogin.status}`);

  const admin = adminLogin.body.token;
  const manager = managerLogin.body.token;
  const customer = customerLogin.body.token;

  console.log('\n--- Self-registration is gone ---');
  const register = await call('/auth/register', {
    method: 'POST',
    body: { fullName: 'Sneaky Signup', email: `x.${unique()}@example.test`, pin: '5827' },
  });
  check('POST /auth/register no longer exists', register.status === 404, `got ${register.status}`);

  console.log('\n--- Only an admin may create ---');

  const email = `new.${unique()}@example.test`;
  const created = await call('/admin/customers', {
    token: admin,
    method: 'POST',
    body: { fullName: 'Newly Onboarded', email, phone: '+250780000900', pin: '5827' },
  });
  check('admin can create a customer', created.status === 201,
    `got ${created.status} ${JSON.stringify(created.body)}`);
  check('new customer starts PENDING', created.body?.approvalStatus === 'PENDING',
    created.body?.approvalStatus);
  check('their account starts PENDING', created.body?.accounts?.[0]?.status === 'PENDING',
    created.body?.accounts?.[0]?.status);
  check('account number issued', /^\d{10}$/.test(created.body?.accounts?.[0]?.accountNumber ?? ''),
    created.body?.accounts?.[0]?.accountNumber);

  const customerId = created.body.id;
  const accountNumber = created.body.accounts[0].accountNumber;

  const managerCreate = await call('/admin/customers', {
    token: manager,
    method: 'POST',
    body: { fullName: 'Manager Made', email: `m.${unique()}@example.test`, pin: '5827' },
  });
  check('manager CANNOT create a customer', managerCreate.status === 403, `got ${managerCreate.status}`);

  const customerCreate = await call('/admin/customers', {
    token: customer,
    method: 'POST',
    body: { fullName: 'Customer Made', email: `c.${unique()}@example.test`, pin: '5827' },
  });
  check('customer CANNOT create a customer', customerCreate.status === 403, `got ${customerCreate.status}`);

  console.log('\n--- A pending customer cannot sign in or transact ---');

  const pendingLogin = await call('/auth/login', {
    method: 'POST',
    body: { accountNumber, pin: '5827' },
  });
  check('pending customer is blocked at login', pendingLogin.status === 401, `got ${pendingLogin.status}`);
  check('and is told why', /awaiting approval/i.test(pendingLogin.body?.message ?? ''),
    pendingLogin.body?.message);

  const wrongPin = await call('/auth/login', {
    method: 'POST',
    body: { accountNumber, pin: '9999' },
  });
  check('wrong PIN on a pending account gives the generic error (no enumeration)',
    wrongPin.status === 401 && /invalid credentials/i.test(wrongPin.body?.message ?? ''),
    wrongPin.body?.message);

  // An admin can act as teller on any account, so this proves the PENDING
  // account status blocks money movement independently of who is asking.
  const pendingAccounts = await call(`/admin/users/${customerId}`, { token: admin });
  const pendingAccountId = pendingAccounts.body.accounts[0].id;
  const depositIntoPending = await call('/transactions/deposit', {
    token: admin,
    method: 'POST',
    body: { accountId: pendingAccountId, amount: '1000' },
  });
  check('an unapproved account cannot receive money', depositIntoPending.status === 403,
    `got ${depositIntoPending.status}`);

  console.log('\n--- Only a manager may approve ---');

  const adminApprove = await call(`/admin/customers/${customerId}/approve`, {
    token: admin,
    method: 'POST',
  });
  check('admin CANNOT approve (separation of duties)', adminApprove.status === 403,
    `got ${adminApprove.status}`);

  const customerApprove = await call(`/admin/customers/${customerId}/approve`, {
    token: customer,
    method: 'POST',
  });
  check('customer CANNOT approve', customerApprove.status === 403, `got ${customerApprove.status}`);

  const queue = await call('/admin/customers/pending', { token: manager });
  check('approval queue lists the new application', queue.status === 200 &&
    queue.body.data.some((row) => row.id === customerId), `got ${queue.status}`);
  const queued = queue.body.data.find((row) => row.id === customerId);
  check('queue shows who created it', queued?.createdBy?.fullName === 'Zigama Administrator',
    JSON.stringify(queued?.createdBy));

  const approved = await call(`/admin/customers/${customerId}/approve`, {
    token: manager,
    method: 'POST',
  });
  check('manager can approve', approved.status === 201, `got ${approved.status}`);
  check('customer becomes APPROVED', approved.body?.approvalStatus === 'APPROVED',
    approved.body?.approvalStatus);
  check('their account becomes ACTIVE', approved.body?.accounts?.[0]?.status === 'ACTIVE',
    approved.body?.accounts?.[0]?.status);
  check('approver is recorded', approved.body?.approvedBy?.fullName === 'Branch Manager',
    JSON.stringify(approved.body?.approvedBy));

  console.log('\n--- The approved customer now works ---');

  const nowLogin = await call('/auth/login', {
    method: 'POST',
    body: { accountNumber, pin: '5827' },
  });
  check('approved customer can sign in', nowLogin.status === 201, `got ${nowLogin.status}`);

  const nowDeposit = await call('/transactions/deposit', {
    token: admin,
    method: 'POST',
    body: { accountId: pendingAccountId, amount: '5000' },
  });
  check('approved account can receive money', nowDeposit.status === 201, `got ${nowDeposit.status}`);
  check('balance is correct', nowDeposit.body?.balanceAfter === '5000.00',
    nowDeposit.body?.balanceAfter);

  const reApprove = await call(`/admin/customers/${customerId}/approve`, {
    token: manager,
    method: 'POST',
  });
  check('cannot approve twice', reApprove.status === 409, `got ${reApprove.status}`);

  console.log('\n--- Rejection ---');

  const rejectEmail = `rej.${unique()}@example.test`;
  const toReject = await call('/admin/customers', {
    token: admin,
    method: 'POST',
    body: { fullName: 'Will Be Declined', email: rejectEmail, pin: '4913' },
  });
  const rejectId = toReject.body.id;
  const rejectAccount = toReject.body.accounts[0].accountNumber;

  const noReason = await call(`/admin/customers/${rejectId}/reject`, {
    token: manager,
    method: 'POST',
    body: { reason: 'no' },
  });
  check('rejection requires a real reason', noReason.status === 400, `got ${noReason.status}`);

  const rejected = await call(`/admin/customers/${rejectId}/reject`, {
    token: manager,
    method: 'POST',
    body: { reason: 'Identity documents did not match' },
  });
  check('manager can reject', rejected.status === 201, `got ${rejected.status}`);
  check('status becomes REJECTED', rejected.body?.approvalStatus === 'REJECTED',
    rejected.body?.approvalStatus);
  check('account is closed', rejected.body?.accounts?.[0]?.status === 'CLOSED',
    rejected.body?.accounts?.[0]?.status);

  const rejectedLogin = await call('/auth/login', {
    method: 'POST',
    body: { accountNumber: rejectAccount, pin: '4913' },
  });
  check('rejected customer cannot sign in', rejectedLogin.status === 401, `got ${rejectedLogin.status}`);
  check('and is given the reason', /identity documents/i.test(rejectedLogin.body?.message ?? ''),
    rejectedLogin.body?.message);

  console.log('\n--- Validation ---');

  const dupe = await call('/admin/customers', {
    token: admin,
    method: 'POST',
    body: { fullName: 'Duplicate', email, pin: '5827' },
  });
  check('duplicate email rejected', dupe.status === 409, `got ${dupe.status}`);

  for (const [label, pin] of [['repeated digits', '1111'], ['ascending run', '1234'], ['descending run', '9876']]) {
    const weak = await call('/admin/customers', {
      token: admin,
      method: 'POST',
      body: { fullName: 'Weak Pin', email: `w.${unique()}@example.test`, pin },
    });
    check(`weak PIN rejected (${label})`, weak.status === 400, `got ${weak.status}`);
  }

  const roleInjection = await call('/admin/customers', {
    token: admin,
    method: 'POST',
    body: {
      fullName: 'Sneaky Admin',
      email: `sneaky.${unique()}@example.test`,
      pin: '5827',
      role: 'ADMIN',
    },
  });
  check('cannot set a role through creation', roleInjection.status === 400,
    `got ${roleInjection.status}`);

  console.log('\n--- Seeded pending applications ---');

  const seededQueue = await call('/admin/customers/pending', { token: manager });
  check('seed leaves applications waiting for the manager',
    seededQueue.body.data.length >= 2, `${seededQueue.body.data.length} in queue`);

  console.log('\n--- No orphan records ---');

  const allUsers = await call('/admin/users?limit=100', { token: admin });
  const orphans = allUsers.body.data.filter(
    (u) => u.role === 'CUSTOMER' && u.accounts.length === 0,
  );
  check('every customer has an account', orphans.length === 0,
    orphans.map((u) => u.email).join(','));

  const numbers = allUsers.body.data.flatMap((u) => u.accounts.map((a) => a.accountNumber));
  check('all account numbers unique', new Set(numbers).size === numbers.length,
    `${numbers.length} accounts`);

  console.log(`\n===== ${pass} passed, ${fail} failed =====\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('Test run crashed:', e);
  process.exit(1);
});
