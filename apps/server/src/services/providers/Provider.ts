export type DepositIntentInput = {
  tid: string;             // your TID (keep semantics)
  uid: string;             // your UID
  merchantId: string;
  methodCode: string;      // 'VIRTUAL_BANK_ACCOUNT_STATIC' | 'VIRTUAL_BANK_ACCOUNT_DYNAMIC'
  amountCents: number;
  currency: string;        // 'IDR'
  bankCode: string;        // user-selected VA bank
  kyc: { fullName: string; diditSubject: string };
};

export type DepositIntentResult = {
  providerPaymentId: string;                 // Fazz payment id
  expiresAt?: string;                        // dynamic VA
  instructions: any;                         // instructions JSON to display
  va: { bankCode: string; accountNo: string; accountName: string };
};

export interface ProviderAdapter {
  // Accept (Deposits)
  createDepositIntent(input: DepositIntentInput): Promise<DepositIntentResult>;
  getDepositStatus(providerPaymentId: string): Promise<{ status: string; raw: any }>;

  // Send (Withdrawals)
  validateBankAccount(input: { bankCode: string; accountNo: string; name?: string }):
    Promise<{ ok: boolean; holder?: string; raw: any }>;
  createDisbursement(input: {
    tid: string; merchantId: string; uid: string;
    amountCents: number; currency: string; bankCode: string; accountNo: string; holderName: string;
  }): Promise<{ providerPayoutId: string; raw: any }>;
  getDisbursementStatus(providerPayoutId: string): Promise<{ status: string; raw: any }>;
}
