import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '../generated/prisma/client.ts';
import {
  AccountStatus,
  AccountType,
  ApprovalStatus,
  Role,
  TransactionType,
} from '../generated/prisma/enums.ts';

/**
 * Seeds staff accounts and a set of demo customers with a plausible history.
 *
 * Safe to re-run: users are upserted by email and the ledger is rebuilt from
 * scratch each time so balances always reconcile with the transaction rows.
 *
 * All people and numbers here are fictional demo data.
 */

const BCRYPT_ROUNDS = 10;

function connectionString(): string {
  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Set DIRECT_DATABASE_URL or DATABASE_URL');
  if (url.startsWith('prisma+postgres://')) {
    throw new Error(
      'The seed needs a plain postgres:// URL. Set DIRECT_DATABASE_URL to the ' +
        'value `npx prisma dev` prints as DATABASE_URL.',
    );
  }
  return url;
}

// The seed is strictly sequential, so one connection is enough. Keeping it
// small matters because the seed is often run while the API is up, and a local
// `prisma dev` server has very little connection headroom to share.
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: connectionString(), max: 2 }),
});

/** Money helper: major units -> minor units. */
const rwf = (major: number): bigint => BigInt(Math.round(major * 100));

interface SeedCustomer {
  fullName: string;
  email: string;
  phone: string;
  pin: string;
  accountNumber: string;
  accountType: AccountType;
  /** Also gets a savings account when set. */
  savingsAccountNumber?: string;
}

const STAFF = [
  {
    fullName: 'Zigama Administrator',
    email: 'admin@zigama.test',
    password: 'Admin@12345',
    role: Role.ADMIN,
  },
  {
    fullName: 'Branch Manager',
    email: 'manager@zigama.test',
    password: 'Manager@12345',
    role: Role.MANAGER,
  },
];

const CUSTOMERS: SeedCustomer[] = [
  {
    fullName: 'Grace Uwase',
    email: 'grace@example.test',
    phone: '+250780000101',
    pin: '1234',
    accountNumber: '1000000001',
    accountType: AccountType.CHECKING,
    savingsAccountNumber: '2000000001',
  },
  {
    fullName: 'Eric Mugisha',
    email: 'eric@example.test',
    phone: '+250780000102',
    pin: '2345',
    accountNumber: '1000000002',
    accountType: AccountType.CHECKING,
  },
  {
    fullName: 'Diane Ingabire',
    email: 'diane@example.test',
    phone: '+250780000103',
    pin: '3456',
    accountNumber: '1000000003',
    accountType: AccountType.CHECKING,
  },
  {
    fullName: 'Patrick Niyonzima',
    email: 'patrick@example.test',
    phone: '+250780000104',
    pin: '4567',
    accountNumber: '1000000004',
    accountType: AccountType.SAVINGS,
  },
];

/**
 * In-memory ledger built up during seeding, then written in one go. Keeping the
 * running balance here is what guarantees each row's `balanceAfter` matches the
 * final account balance.
 */
class Ledger {
  private balances = new Map<string, bigint>();
  private entries: Array<{
    reference: string;
    type: TransactionType;
    amount: bigint;
    balanceAfter: bigint;
    accountId: string;
    counterpartyAccountId?: string;
    transferGroupId?: string;
    description: string;
    initiatedById: string;
    createdAt: Date;
  }> = [];

  register(accountId: string): void {
    this.balances.set(accountId, 0n);
  }

  balanceOf(accountId: string): bigint {
    return this.balances.get(accountId) ?? 0n;
  }

  credit(
    accountId: string,
    amount: bigint,
    description: string,
    initiatedById: string,
    daysAgo: number,
    type: TransactionType = TransactionType.DEPOSIT,
  ): void {
    const next = this.balanceOf(accountId) + amount;
    this.balances.set(accountId, next);
    this.entries.push({
      reference: reference(type === TransactionType.DEPOSIT ? 'DEP' : 'TRF'),
      type,
      amount,
      balanceAfter: next,
      accountId,
      description,
      initiatedById,
      createdAt: daysAgoDate(daysAgo),
    });
  }

  debit(
    accountId: string,
    amount: bigint,
    description: string,
    initiatedById: string,
    daysAgo: number,
  ): void {
    const current = this.balanceOf(accountId);
    if (current < amount) {
      throw new Error(
        `Seed error: withdrawal of ${amount} exceeds balance ${current}`,
      );
    }
    const next = current - amount;
    this.balances.set(accountId, next);
    this.entries.push({
      reference: reference('WDR'),
      type: TransactionType.WITHDRAWAL,
      amount,
      balanceAfter: next,
      accountId,
      description,
      initiatedById,
      createdAt: daysAgoDate(daysAgo),
    });
  }

  transfer(
    fromAccountId: string,
    toAccountId: string,
    amount: bigint,
    description: string,
    initiatedById: string,
    daysAgo: number,
  ): void {
    const fromBalance = this.balanceOf(fromAccountId);
    if (fromBalance < amount) {
      throw new Error(
        `Seed error: transfer of ${amount} exceeds balance ${fromBalance}`,
      );
    }
    const groupId = randomBytes(12).toString('hex');
    const when = daysAgoDate(daysAgo);

    const fromAfter = fromBalance - amount;
    const toAfter = this.balanceOf(toAccountId) + amount;
    this.balances.set(fromAccountId, fromAfter);
    this.balances.set(toAccountId, toAfter);

    this.entries.push({
      reference: reference('TRF'),
      type: TransactionType.TRANSFER_OUT,
      amount,
      balanceAfter: fromAfter,
      accountId: fromAccountId,
      counterpartyAccountId: toAccountId,
      transferGroupId: groupId,
      description,
      initiatedById,
      createdAt: when,
    });
    this.entries.push({
      reference: reference('TRF'),
      type: TransactionType.TRANSFER_IN,
      amount,
      balanceAfter: toAfter,
      accountId: toAccountId,
      counterpartyAccountId: fromAccountId,
      transferGroupId: groupId,
      description,
      initiatedById,
      createdAt: when,
    });
  }

  async flush(): Promise<void> {
    // Ordered by time so the running balances read sensibly in the app.
    const ordered = [...this.entries].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
    for (const entry of ordered) {
      await prisma.transaction.create({ data: entry });
    }
    for (const [accountId, balance] of this.balances) {
      await prisma.account.update({
        where: { id: accountId },
        data: { balance },
      });
    }
  }
}

function reference(prefix: string): string {
  return `${prefix}-${randomBytes(5).toString('hex').toUpperCase()}`;
}

function daysAgoDate(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

async function main(): Promise<void> {
  console.log('Seeding Zigama banking platform...\n');

  // Full reset, in foreign-key-safe order.
  //
  // This deliberately clears *everything*, including accounts opened through
  // registration. An earlier version deleted all transactions but only reset
  // the balances of the accounts listed below, which left any other account
  // holding a balance with no ledger rows behind it — precisely the invariant
  // this script asserts at the end. A partial reset cannot be made to
  // reconcile, so the reset is total.
  await prisma.auditLog.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
  console.log('  (cleared all existing users, accounts and transactions)\n');

  const staffIds: string[] = [];
  for (const person of STAFF) {
    const passwordHash = await bcrypt.hash(person.password, BCRYPT_ROUNDS);
    const user = await prisma.user.upsert({
      where: { email: person.email },
      update: {
        passwordHash,
        role: person.role,
        isActive: true,
        approvalStatus: ApprovalStatus.APPROVED,
      },
      create: {
        fullName: person.fullName,
        email: person.email,
        role: person.role,
        passwordHash,
        // Staff are provisioned directly, not through the customer approval
        // queue, so they are approved on creation.
        approvalStatus: ApprovalStatus.APPROVED,
        approvedAt: new Date(),
      },
    });
    staffIds.push(user.id);
    console.log(`  staff    ${person.role.padEnd(8)} ${person.email}`);
  }

  const adminId = staffIds[0];
  const managerId = staffIds[1];
  const ledger = new Ledger();
  const accountIdByNumber = new Map<string, string>();

  for (const customer of CUSTOMERS) {
    const pinHash = await bcrypt.hash(customer.pin, BCRYPT_ROUNDS);

    // These are the established customers: created by the admin and already
    // signed off by the manager, so they can sign in immediately.
    const user = await prisma.user.upsert({
      where: { email: customer.email },
      update: {
        pinHash,
        isActive: true,
        approvalStatus: ApprovalStatus.APPROVED,
      },
      create: {
        fullName: customer.fullName,
        email: customer.email,
        phone: customer.phone,
        role: Role.CUSTOMER,
        pinHash,
        approvalStatus: ApprovalStatus.APPROVED,
        createdById: adminId,
        approvedById: managerId,
        approvedAt: new Date(),
      },
    });

    const primary = await prisma.account.upsert({
      where: { accountNumber: customer.accountNumber },
      update: { balance: 0n, status: AccountStatus.ACTIVE },
      create: {
        accountNumber: customer.accountNumber,
        type: customer.accountType,
        ownerId: user.id,
        status: AccountStatus.ACTIVE,
      },
    });
    ledger.register(primary.id);
    accountIdByNumber.set(customer.accountNumber, primary.id);

    if (customer.savingsAccountNumber) {
      const savings = await prisma.account.upsert({
        where: { accountNumber: customer.savingsAccountNumber },
        update: { balance: 0n, status: AccountStatus.ACTIVE },
        create: {
          accountNumber: customer.savingsAccountNumber,
          type: AccountType.SAVINGS,
          ownerId: user.id,
          status: AccountStatus.ACTIVE,
        },
      });
      ledger.register(savings.id);
      accountIdByNumber.set(customer.savingsAccountNumber, savings.id);
    }

    console.log(
      `  customer ${customer.accountNumber} ${customer.fullName} (PIN ${customer.pin})`,
    );
  }

  // Two applications left waiting, so the manager's approval queue has
  // something in it the first time you open the app. Created by the admin and
  // deliberately not approved — the manager is the only one who can clear them.
  const PENDING_APPLICANTS = [
    {
      fullName: 'Josiane Mukamana',
      email: 'josiane@example.test',
      phone: '+250780000105',
      pin: '5827',
      accountNumber: '1000000005',
    },
    {
      fullName: 'Samuel Habimana',
      email: 'samuel@example.test',
      phone: '+250780000106',
      pin: '6193',
      accountNumber: '1000000006',
    },
  ];

  for (const applicant of PENDING_APPLICANTS) {
    const pinHash = await bcrypt.hash(applicant.pin, BCRYPT_ROUNDS);
    const user = await prisma.user.upsert({
      where: { email: applicant.email },
      update: { pinHash, approvalStatus: ApprovalStatus.PENDING },
      create: {
        fullName: applicant.fullName,
        email: applicant.email,
        phone: applicant.phone,
        role: Role.CUSTOMER,
        pinHash,
        approvalStatus: ApprovalStatus.PENDING,
        createdById: adminId,
      },
    });

    await prisma.account.upsert({
      where: { accountNumber: applicant.accountNumber },
      update: { balance: 0n, status: AccountStatus.PENDING },
      create: {
        accountNumber: applicant.accountNumber,
        type: AccountType.CHECKING,
        ownerId: user.id,
        status: AccountStatus.PENDING,
      },
    });

    console.log(
      `  pending  ${applicant.accountNumber} ${applicant.fullName} (awaiting approval)`,
    );
  }

  const id = (accountNumber: string): string => {
    const value = accountIdByNumber.get(accountNumber);
    if (!value) throw new Error(`Unknown seed account ${accountNumber}`);
    return value;
  };

  // --- A plausible month of activity -----------------------------------
  ledger.credit(id('1000000001'), rwf(850_000), 'Opening deposit', adminId, 30);
  ledger.credit(id('2000000001'), rwf(400_000), 'Opening deposit', adminId, 30);
  ledger.credit(id('1000000002'), rwf(620_000), 'Opening deposit', adminId, 29);
  ledger.credit(id('1000000003'), rwf(310_000), 'Opening deposit', adminId, 28);
  ledger.credit(id('1000000004'), rwf(1_250_000), 'Opening deposit', adminId, 27);

  ledger.credit(id('1000000001'), rwf(420_000), 'Salary — March', adminId, 21);
  ledger.credit(id('1000000002'), rwf(380_000), 'Salary — March', adminId, 21);

  ledger.debit(id('1000000001'), rwf(75_000), 'ATM withdrawal', adminId, 18);
  ledger.debit(id('1000000004'), rwf(200_000), 'Branch withdrawal', adminId, 16);
  ledger.debit(id('1000000002'), rwf(45_500), 'ATM withdrawal', adminId, 12);

  ledger.transfer(
    id('1000000001'),
    id('1000000002'),
    rwf(120_000),
    'Rent share',
    adminId,
    10,
  );
  ledger.transfer(
    id('1000000004'),
    id('1000000003'),
    rwf(65_000),
    'Invoice payment',
    adminId,
    7,
  );
  ledger.transfer(
    id('1000000001'),
    id('2000000001'),
    rwf(150_000),
    'Move to savings',
    adminId,
    5,
  );
  ledger.transfer(
    id('1000000003'),
    id('1000000001'),
    rwf(30_000),
    'Refund',
    adminId,
    2,
  );

  ledger.credit(id('1000000003'), rwf(95_000), 'Mobile money top-up', adminId, 1);
  ledger.debit(id('1000000001'), rwf(22_500), 'ATM withdrawal', adminId, 1);

  await ledger.flush();

  // --- Verify the ledger reconciles ------------------------------------
  const accounts = await prisma.account.findMany({
    include: { transactions: true },
  });

  let mismatches = 0;
  for (const account of accounts) {
    const computed = account.transactions.reduce((sum, entry) => {
      const isCredit =
        entry.type === TransactionType.DEPOSIT ||
        entry.type === TransactionType.TRANSFER_IN;
      return isCredit ? sum + entry.amount : sum - entry.amount;
    }, 0n);

    if (computed !== account.balance) {
      mismatches += 1;
      console.error(
        `  MISMATCH ${account.accountNumber}: stored ${account.balance} vs ledger ${computed}`,
      );
    }
  }

  if (mismatches > 0) {
    throw new Error(`${mismatches} account(s) do not reconcile`);
  }

  console.log('\n  Ledger reconciles for all accounts.');
  console.log('\nSeed complete.\n');
  console.log('  Staff login (email + password):');
  for (const person of STAFF) {
    console.log(`    ${person.email}  ${person.password}`);
  }
  console.log('\n  Customer login (account number + PIN):');
  for (const customer of CUSTOMERS) {
    console.log(`    ${customer.accountNumber}  ${customer.pin}`);
  }
  console.log('');
}

main()
  .catch((error) => {
    console.error('\nSeed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
