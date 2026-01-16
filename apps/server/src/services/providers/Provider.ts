// services/providers/Provider.ts

export type DepositIntentInput = {
  tid: string;                 // your transaction id
  uid: string;                 // your user public id
  merchantId: string;
  methodCode: string;          // e.g. VIRTUAL_BANK_ACCOUNT_STATIC | VIRTUAL_BANK_ACCOUNT_DYNAMIC
  amountCents: number;         // internal integer (IDR = whole rupiah)
  currency: string;            // "IDR"
  bankCode: string;            // e.g. "BCA"
  kyc: { fullName: string; diditSubject: string };
};

export type DepositIntentResult = {
  providerPaymentId: string;   // Fazz payment id (e.g. contract_xxx)
  expiresAt?: string;          // ISO string or undefined
  status?: string;
  instructions: any;           // JSON to render VA instructions
  va: {
    bankCode: string;
    accountNo: string;
    accountName: string;
    meta?: any;
  };
  raw?: any;
};

export interface ProviderAdapter {
  /** Accept/VA */
  createDepositIntent(input: DepositIntentInput): Promise<DepositIntentResult>;
  getDepositStatus(providerPaymentId: string): Promise<{ status: string; raw: any }>;
  cancelDeposit?(providerPaymentId: string): Promise<void>;

  /** Send/disbursements */
  validateBankAccount(input: {
    bankCode: string;
    accountNo: string;
    name?: string;
  }): Promise<{ ok: boolean; holder?: string; raw: any }>;

  createDisbursement(input: {
    tid: string;
    merchantId: string;
    uid: string;
    amountCents: number;
    currency: string;
    bankCode: string;
    accountNo: string;
    holderName: string;
  }): Promise<{ providerPayoutId: string; raw: any; status?: string }>;

  getDisbursementStatus(providerPayoutId: string): Promise<{ status: string; raw: any }>;
}
