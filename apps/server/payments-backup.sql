--
-- PostgreSQL database dump
--

\restrict nnqmsApr8DI7lc5jiqoidyjguZ8BlnQBJxzHefJj4xbai6D8pCrUle0vjsITcSx

-- Dumped from database version 16.10 (Debian 16.10-1.pgdg13+1)
-- Dumped by pg_dump version 16.10 (Debian 16.10-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: postgres
--

-- *not* creating schema, since initdb creates it


ALTER SCHEMA public OWNER TO postgres;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: postgres
--

COMMENT ON SCHEMA public IS '';


--
-- Name: AdminRole; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."AdminRole" AS ENUM (
    'SUPER',
    'ADMIN',
    'SUPPORT'
);


ALTER TYPE public."AdminRole" OWNER TO postgres;

--
-- Name: ClientStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."ClientStatus" AS ENUM (
    'ACTIVE',
    'DEACTIVATED',
    'BLOCKED'
);


ALTER TYPE public."ClientStatus" OWNER TO postgres;

--
-- Name: MerchantAccountEntryType; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."MerchantAccountEntryType" AS ENUM (
    'TOPUP',
    'SETTLEMENT'
);


ALTER TYPE public."MerchantAccountEntryType" OWNER TO postgres;

--
-- Name: MerchantRole; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."MerchantRole" AS ENUM (
    'OWNER',
    'MANAGER',
    'ANALYST'
);


ALTER TYPE public."MerchantRole" OWNER TO postgres;

--
-- Name: NotificationDirection; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."NotificationDirection" AS ENUM (
    'INCOMING',
    'OUTGOING',
    'BOTH'
);


ALTER TYPE public."NotificationDirection" OWNER TO postgres;

--
-- Name: NotificationType; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."NotificationType" AS ENUM (
    'TELEGRAM'
);


ALTER TYPE public."NotificationType" OWNER TO postgres;

--
-- Name: PaymentStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."PaymentStatus" AS ENUM (
    'PENDING',
    'SUBMITTED',
    'APPROVED',
    'REJECTED'
);


ALTER TYPE public."PaymentStatus" OWNER TO postgres;

--
-- Name: PaymentType; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."PaymentType" AS ENUM (
    'DEPOSIT',
    'WITHDRAWAL'
);


ALTER TYPE public."PaymentType" OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: AdminAuditLog; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."AdminAuditLog" (
    id text NOT NULL,
    "adminId" text,
    action text NOT NULL,
    "targetType" text,
    "targetId" text,
    ip text,
    meta jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."AdminAuditLog" OWNER TO postgres;

--
-- Name: AdminLoginLog; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."AdminLoginLog" (
    id text NOT NULL,
    "adminId" text,
    email text,
    success boolean NOT NULL,
    ip text,
    "userAgent" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."AdminLoginLog" OWNER TO postgres;

--
-- Name: AdminPasswordReset; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."AdminPasswordReset" (
    id text NOT NULL,
    "adminId" text,
    token text NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "usedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."AdminPasswordReset" OWNER TO postgres;

--
-- Name: AdminUser; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."AdminUser" (
    id text NOT NULL,
    email text NOT NULL,
    "passwordHash" text NOT NULL,
    role text DEFAULT 'admin'::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "totpSecret" text,
    "twoFactorEnabled" boolean DEFAULT false NOT NULL,
    active boolean DEFAULT true NOT NULL,
    "displayName" text,
    "lastLoginAt" timestamp(3) without time zone,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "superTwoFactorEnabled" boolean DEFAULT false NOT NULL,
    "superTotpSecret" text,
    timezone text,
    "canViewUserDirectory" boolean DEFAULT true NOT NULL,
    "canRevealMerchantApiKeys" boolean DEFAULT false NOT NULL
);


ALTER TABLE public."AdminUser" OWNER TO postgres;

--
-- Name: BankAccount; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."BankAccount" (
    id text NOT NULL,
    "merchantId" text,
    currency text NOT NULL,
    "holderName" text NOT NULL,
    "bankName" text NOT NULL,
    "accountNo" text NOT NULL,
    iban text,
    instructions text,
    active boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    method text DEFAULT 'OSKO'::text NOT NULL,
    label text,
    fields jsonb,
    "publicId" character varying(32) NOT NULL
);


ALTER TABLE public."BankAccount" OWNER TO postgres;

--
-- Name: IdempotencyKey; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."IdempotencyKey" (
    id text NOT NULL,
    scope text NOT NULL,
    key text NOT NULL,
    response jsonb NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."IdempotencyKey" OWNER TO postgres;

--
-- Name: KycVerification; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."KycVerification" (
    id text NOT NULL,
    "userId" text,
    provider text NOT NULL,
    status text NOT NULL,
    "externalSessionId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."KycVerification" OWNER TO postgres;

--
-- Name: LedgerEntry; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."LedgerEntry" (
    id text NOT NULL,
    "merchantId" text NOT NULL,
    "amountCents" integer NOT NULL,
    reason text NOT NULL,
    "paymentId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."LedgerEntry" OWNER TO postgres;

--
-- Name: Merchant; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Merchant" (
    id text NOT NULL,
    name text NOT NULL,
    "webhookUrl" text,
    "balanceCents" integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    active boolean DEFAULT true NOT NULL,
    "defaultCurrency" text DEFAULT 'USD'::text NOT NULL,
    email text,
    "userDirectoryEnabled" boolean DEFAULT false NOT NULL,
    "apiKeysSelfServiceEnabled" boolean DEFAULT true NOT NULL
);


ALTER TABLE public."Merchant" OWNER TO postgres;

--
-- Name: MerchantAccountEntry; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."MerchantAccountEntry" (
    id text NOT NULL,
    "merchantId" text NOT NULL,
    type public."MerchantAccountEntryType" NOT NULL,
    method text,
    "amountCents" integer NOT NULL,
    note text,
    "receiptFileId" text,
    "createdById" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."MerchantAccountEntry" OWNER TO postgres;

--
-- Name: MerchantApiKey; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."MerchantApiKey" (
    id text NOT NULL,
    "merchantId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    active boolean DEFAULT true NOT NULL,
    "expiresAt" timestamp(3) without time zone,
    last4 text NOT NULL,
    "lastUsedAt" timestamp(3) without time zone,
    prefix text NOT NULL,
    scopes text[] DEFAULT ARRAY[]::text[],
    "secretEnc" text NOT NULL
);


ALTER TABLE public."MerchantApiKey" OWNER TO postgres;

--
-- Name: MerchantApiKeyRevealLog; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."MerchantApiKeyRevealLog" (
    id text NOT NULL,
    "merchantApiKeyId" text NOT NULL,
    "merchantId" text NOT NULL,
    "actorType" text NOT NULL,
    "merchantUserId" text,
    "adminUserId" text,
    reason text,
    outcome text NOT NULL,
    ip text,
    "userAgent" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."MerchantApiKeyRevealLog" OWNER TO postgres;

--
-- Name: MerchantClient; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."MerchantClient" (
    id text NOT NULL,
    "merchantId" text NOT NULL,
    "userId" text,
    "externalId" text,
    email text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    status public."ClientStatus" DEFAULT 'ACTIVE'::public."ClientStatus" NOT NULL
);


ALTER TABLE public."MerchantClient" OWNER TO postgres;

--
-- Name: MerchantFormConfig; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."MerchantFormConfig" (
    "merchantId" text NOT NULL,
    deposit jsonb,
    withdrawal jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "bankAccountId" text,
    id text NOT NULL
);


ALTER TABLE public."MerchantFormConfig" OWNER TO postgres;

--
-- Name: MerchantLimits; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."MerchantLimits" (
    "merchantId" text NOT NULL,
    "maxReqPerMin" integer,
    "ipAllowList" text[] DEFAULT ARRAY[]::text[],
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."MerchantLimits" OWNER TO postgres;

--
-- Name: MerchantLoginLog; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."MerchantLoginLog" (
    id text NOT NULL,
    "merchantUserId" text,
    email text,
    success boolean NOT NULL,
    ip text,
    "userAgent" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."MerchantLoginLog" OWNER TO postgres;

--
-- Name: MerchantPasswordReset; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."MerchantPasswordReset" (
    id text NOT NULL,
    "merchantUserId" text,
    token text NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "usedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."MerchantPasswordReset" OWNER TO postgres;

--
-- Name: MerchantUser; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."MerchantUser" (
    id text NOT NULL,
    "merchantId" text NOT NULL,
    email text NOT NULL,
    "passwordHash" text NOT NULL,
    role public."MerchantRole" DEFAULT 'MANAGER'::public."MerchantRole" NOT NULL,
    active boolean DEFAULT true NOT NULL,
    "twoFactorEnabled" boolean DEFAULT false NOT NULL,
    "totpSecret" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "lastLoginAt" timestamp(3) without time zone,
    timezone text,
    "canViewUserDirectory" boolean DEFAULT true NOT NULL,
    "canRevealApiKeys" boolean DEFAULT false NOT NULL
);


ALTER TABLE public."MerchantUser" OWNER TO postgres;

--
-- Name: NotificationChannel; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."NotificationChannel" (
    id text NOT NULL,
    "merchantId" text NOT NULL,
    type public."NotificationType" NOT NULL,
    "chatId" text NOT NULL,
    direction public."NotificationDirection" DEFAULT 'BOTH'::public."NotificationDirection" NOT NULL,
    active boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."NotificationChannel" OWNER TO postgres;

--
-- Name: PayerBlocklist; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."PayerBlocklist" (
    id text NOT NULL,
    "merchantId" text,
    "userId" text,
    reason text,
    active boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."PayerBlocklist" OWNER TO postgres;

--
-- Name: PaymentRequest; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."PaymentRequest" (
    id text NOT NULL,
    type public."PaymentType" NOT NULL,
    status public."PaymentStatus" DEFAULT 'PENDING'::public."PaymentStatus" NOT NULL,
    "amountCents" integer NOT NULL,
    currency text NOT NULL,
    "referenceCode" text NOT NULL,
    "merchantId" text NOT NULL,
    "userId" text,
    "bankAccountId" text,
    "receiptFileId" text,
    "detailsJson" jsonb,
    "rejectedReason" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    notes text,
    "processedByAdminId" text,
    "processedAt" timestamp(3) without time zone,
    "uniqueReference" text NOT NULL
);


ALTER TABLE public."PaymentRequest" OWNER TO postgres;

--
-- Name: ReceiptFile; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."ReceiptFile" (
    id text NOT NULL,
    path text NOT NULL,
    "mimeType" text NOT NULL,
    size integer NOT NULL,
    original text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "paymentId" text
);


ALTER TABLE public."ReceiptFile" OWNER TO postgres;

--
-- Name: User; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."User" (
    id text NOT NULL,
    email text,
    phone text,
    "diditSubject" text NOT NULL,
    "verifiedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "publicId" text NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "fullName" text
);


ALTER TABLE public."User" OWNER TO postgres;

--
-- Name: WithdrawalDestination; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."WithdrawalDestination" (
    id text NOT NULL,
    "userId" text,
    currency text NOT NULL,
    "bankName" text NOT NULL,
    "holderName" text NOT NULL,
    "accountNo" text NOT NULL,
    iban text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."WithdrawalDestination" OWNER TO postgres;

--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


ALTER TABLE public._prisma_migrations OWNER TO postgres;

--
-- Name: bank_public_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.bank_public_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.bank_public_id_seq OWNER TO postgres;

--
-- Name: bank_public_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.bank_public_id_seq OWNED BY public."BankAccount"."publicId";


--
-- Name: BankAccount publicId; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."BankAccount" ALTER COLUMN "publicId" SET DEFAULT ('B'::text || lpad((nextval('public.bank_public_id_seq'::regclass))::text, 4, '0'::text));


--
-- Data for Name: AdminAuditLog; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."AdminAuditLog" (id, "adminId", action, "targetType", "targetId", ip, meta, "createdAt") FROM stdin;
cmibobjvp000836svvvv6nl15	cmibo586j000036mr4szvstjn	admin.create	ADMIN	cmibobjvj000636sv178w7wpl	::1	{"role": "ADMIN", "email": "test@mail.com", "active": true, "canViewUsers": true}	2025-11-23 12:07:49.861
cmiboed9d000h36sv5fj4pph8	cmibo586j000036mr4szvstjn	merchant.create	MERCHANT	cmiboed99000f36sv6ukl1hmo	::1	{"name": "Demo Merchant", "status": "active"}	2025-11-23 12:10:01.249
cmiboemou000l36svm72h3v7c	cmibo586j000036mr4szvstjn	merchantUser.create	MERCHANT_USER	cmiboemon000j36svli5f8xcb	::1	{"role": "OWNER", "email": "merchant@example.com", "active": true, "merchantId": "cmiboed99000f36sv6ukl1hmo", "canViewUsers": true, "autoGenerated": false, "canRevealApiKeys": true}	2025-11-23 12:10:13.47
cmigclp1c000b36cn55r06s8c	cmibo586j000036mr4szvstjn	admin.2fa.reset	ADMIN	cmibobjvj000636sv178w7wpl	::1	null	2025-11-26 18:38:38.593
cmigcsedw000i36cnp8l7pgl4	cmibo586j000036mr4szvstjn	super:banks.create	BANK	cmigcsedk000g36cns5se440j	::1	{"id": "cmigcsedk000g36cns5se440j", "iban": "", "label": null, "active": true, "fields": {"core": {"iban": {"label": "IBAN (optional)", "order": 40, "visible": false}, "label": {"label": "Label (shown to payers)", "order": 50, "visible": false}, "bankName": {"label": "Bank Name", "order": 20, "visible": false}, "publicId": {"label": "Public Id", "order": 60, "visible": true}, "accountNo": {"label": "Account / PayID Value", "order": 30, "visible": true}, "holderName": {"label": "Account Holder Name", "order": 10, "visible": true}}, "extra": []}, "method": "OSKO", "bankName": "Demo Bank", "currency": "AUD", "publicId": null, "accountNo": "payid@demo.com", "holderName": "Demo Pty Ltd", "merchantId": "cmiboed99000f36sv6ukl1hmo", "instructions": "Enter the unique alphanumeric code in the reference field for faster processing. Extra details may cause delays rejection"}	2025-11-26 18:43:51.381
cmigct4oz000k36cnddv9p6my	cmibo586j000036mr4szvstjn	super:banks.update	BANK	cmigcsedk000g36cns5se440j	::1	{"iban": "", "label": null, "active": true, "fields": {"core": {"iban": {"label": "IBAN (optional)", "order": 40, "visible": false}, "label": {"label": "Label (shown to payers)", "order": 50, "visible": false}, "bankName": {"label": "Bank Name", "order": 20, "visible": false}, "publicId": {"label": "Public Id", "order": 60, "visible": false}, "accountNo": {"label": "Account / PayID Value", "order": 30, "visible": true}, "holderName": {"label": "Account Holder Name", "order": 10, "visible": true}}, "extra": [{"key": "bsb", "type": "number", "label": "BSB", "order": 10, "value": "123456", "visible": true}]}, "method": "OSKO", "bankName": "Demo Bank", "currency": "AUD", "publicId": "B0002", "accountNo": "0123456789", "holderName": "Demo Pty Ltd", "merchantId": "cmiboed99000f36sv6ukl1hmo", "instructions": "Enter the unique alphanumeric code in the reference field for faster processing. Extra details may cause delays rejection"}	2025-11-26 18:44:25.475
cmigcu1ia000n36cn1dd749o8	cmibo586j000036mr4szvstjn	super:banks.create	BANK	cmigcu1i2000l36cnemdk1cv2	::1	{"id": "cmigcu1i2000l36cnemdk1cv2", "iban": "", "label": null, "active": true, "fields": {"core": {"iban": {"label": "IBAN (optional)", "order": 40, "visible": false}, "label": {"label": "Label (shown to payers)", "order": 50, "visible": true}, "bankName": {"label": "Bank Name", "order": 20, "visible": true}, "publicId": {"label": "Public Id", "order": 60, "visible": true}, "accountNo": {"label": "Account / PayID Value", "order": 30, "visible": true}, "holderName": {"label": "Account Holder Name", "order": 10, "visible": true}}, "extra": []}, "method": "PAYID", "bankName": "Demo Bank", "currency": "AUD", "publicId": null, "accountNo": "payid@demo.com", "holderName": "Demo Pty Ltd", "merchantId": "cmiboed99000f36sv6ukl1hmo", "instructions": ""}	2025-11-26 18:45:08.002
cmigcu99l000p36cnwhbesdhd	cmibo586j000036mr4szvstjn	super:banks.update	BANK	cmigcu1i2000l36cnemdk1cv2	::1	{"iban": "", "label": null, "active": true, "fields": {"core": {"iban": {"label": "IBAN (optional)", "order": 40, "visible": false}, "label": {"label": "Label (shown to payers)", "order": 50, "visible": true}, "bankName": {"label": "Bank Name", "order": 20, "visible": true}, "publicId": {"label": "Public Id", "order": 60, "visible": false}, "accountNo": {"label": "Account / PayID Value", "order": 30, "visible": true}, "holderName": {"label": "Account Holder Name", "order": 10, "visible": true}}, "extra": []}, "method": "PAYID", "bankName": "Demo Bank", "currency": "AUD", "publicId": "B0003", "accountNo": "payid@demo.com", "holderName": "Demo Pty Ltd", "merchantId": "cmiboed99000f36sv6ukl1hmo", "instructions": "Enter the unique alphanumeric code in the reference field for faster processing. Extra details may cause delays rejection"}	2025-11-26 18:45:18.057
cmigcuhcu000r36cn55h9clma	cmibo586j000036mr4szvstjn	super:banks.update	BANK	cmigcu1i2000l36cnemdk1cv2	::1	{"iban": "", "label": null, "active": true, "fields": {"core": {"iban": {"label": "IBAN (optional)", "order": 40, "visible": false}, "label": {"label": "Label (shown to payers)", "order": 50, "visible": false}, "bankName": {"label": "Bank Name", "order": 20, "visible": false}, "publicId": {"label": "Public Id", "order": 60, "visible": false}, "accountNo": {"label": "Account / PayID Value", "order": 30, "visible": true}, "holderName": {"label": "Account Holder Name", "order": 10, "visible": true}}, "extra": []}, "method": "PAYID", "bankName": "Demo Bank", "currency": "AUD", "publicId": "B0003", "accountNo": "payid@demo.com", "holderName": "Demo Pty Ltd", "merchantId": "cmiboed99000f36sv6ukl1hmo", "instructions": "Enter the unique alphanumeric code in the reference field for faster processing. Extra details may cause delays rejection"}	2025-11-26 18:45:28.543
cmigcuihd000t36cna0465qfj	cmibo586j000036mr4szvstjn	super:banks.toggle	BANK	cmigcsedk000g36cns5se440j	::1	{"active": false}	2025-11-26 18:45:30.001
cmigcuj84000v36cnqqev6s38	cmibo586j000036mr4szvstjn	super:banks.toggle	BANK	cmigcsedk000g36cns5se440j	::1	{"active": true}	2025-11-26 18:45:30.965
cmihe492q000x36t4zi1yf66g	cmibo586j000036mr4szvstjn	http.post	ROUTE	/deposits/:id/approve	::1	{"ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", "url": "/admin/deposits/cmihe400y000p36t433uxsxno/approve", "body": {"amount": 500, "comment": ""}, "query": {}, "method": "POST", "status": 200, "durationMs": 47}	2025-11-27 12:08:50.162
cmihe492n000v36t4ihd1zr6v	cmibo586j000036mr4szvstjn	http.post	ROUTE	/deposits/:id/approve	::1	{"ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", "url": "/admin/deposits/cmihe400y000p36t433uxsxno/approve", "body": {"amount": 500, "comment": ""}, "query": {}, "method": "POST", "status": 200, "durationMs": 52}	2025-11-27 12:08:50.159
cmigcuodi000x36cnse3shdau	cmibo586j000036mr4szvstjn	super:banks.update	BANK	cmigcsedk000g36cns5se440j	::1	{"iban": "", "label": null, "active": true, "fields": {"core": {"iban": {"label": "IBAN (optional)", "order": 40, "visible": false}, "label": {"label": "Label (shown to payers)", "order": 50, "visible": false}, "bankName": {"label": "Bank Name", "order": 20, "visible": false}, "publicId": {"label": "Public Id", "order": 60, "visible": false}, "accountNo": {"label": "Account / PayID Value", "order": 30, "visible": true}, "holderName": {"label": "Account Holder Name", "order": 10, "visible": true}}, "extra": [{"key": "bsb", "type": "number", "label": "BSB", "order": 10, "value": "123456", "visible": true}]}, "method": "OSKO", "bankName": "Demo Bank", "currency": "AUD", "publicId": "B0002", "accountNo": "0123456789", "holderName": "Demo Pty Ltd", "merchantId": "cmiboed99000f36sv6ukl1hmo", "instructions": "Enter the unique alphanumeric code in the reference field for faster processing. Extra details may cause delays rejection"}	2025-11-26 18:45:37.638
cmigd98r8001136cn1s1j8r1g	cmibo586j000036mr4szvstjn	merchant.forms.upsert	MERCHANT	cmiboed99000f36sv6ukl1hmo	::1	{"depositCount": 4, "bankAccountId": "cmigcsedk000g36cns5se440j", "withdrawalCount": 4}	2025-11-26 18:56:57.237
cmigd9ft1001536cnagunzlxq	cmibo586j000036mr4szvstjn	merchant.forms.copy	MERCHANT	cmiboed99000f36sv6ukl1hmo	::1	{"fromMerchantId": "cmiboed99000f36sv6ukl1hmo", "toBankAccountId": "cmigcu1i2000l36cnemdk1cv2", "fromBankAccountId": "cmigcsedk000g36cns5se440j"}	2025-11-26 18:57:06.373
cmigdbdpw001936cnonp1s5c7	cmibo586j000036mr4szvstjn	merchant.forms.upsert	MERCHANT	cmiboed99000f36sv6ukl1hmo	::1	{"depositCount": 3, "bankAccountId": "cmigcu1i2000l36cnemdk1cv2", "withdrawalCount": 3}	2025-11-26 18:58:36.98
cmigdc9hf001d36cnoq8elax1	cmibo586j000036mr4szvstjn	http.post	ROUTE	/prefs/timezone	::1	{"ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", "url": "/admin/prefs/timezone", "body": {"timezone": "Asia/Kuala_Lumpur"}, "query": {}, "method": "POST", "status": 200, "durationMs": 8}	2025-11-26 18:59:18.147
cmigdc9hf001b36cnp32dpxuw	cmibo586j000036mr4szvstjn	http.post	ROUTE	/prefs/timezone	::1	{"ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", "url": "/admin/prefs/timezone", "body": {"timezone": "Asia/Kuala_Lumpur"}, "query": {}, "method": "POST", "status": 200, "durationMs": 11}	2025-11-26 18:59:18.147
cmigdpcsm000236j2rh43yx6b	cmibo586j000036mr4szvstjn	http.post	ROUTE	/prefs/timezone	::1	{"ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", "url": "/admin/prefs/timezone", "body": {"timezone": "Asia/Kuala_Lumpur"}, "query": {}, "method": "POST", "status": 200, "durationMs": 9}	2025-11-26 19:09:28.966
cmigdpcsm000336j20kyio2m2	cmibo586j000036mr4szvstjn	http.post	ROUTE	/prefs/timezone	::1	{"ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", "url": "/admin/prefs/timezone", "body": {"timezone": "Asia/Kuala_Lumpur"}, "query": {}, "method": "POST", "status": 200, "durationMs": 13}	2025-11-26 19:09:28.967
cmigdr9wt001936j2aybawmnm	cmibo586j000036mr4szvstjn	http.post	ROUTE	/deposits/:id/approve	::1	{"ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", "url": "/admin/deposits/cmigdqykd001336j24y6tn8vt/approve", "body": {"amount": 500, "comment": ""}, "query": {}, "method": "POST", "status": 200, "durationMs": 51}	2025-11-26 19:10:58.541
cmigdr9wu001b36j2uxzj9x3b	cmibo586j000036mr4szvstjn	http.post	ROUTE	/deposits/:id/approve	::1	{"ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", "url": "/admin/deposits/cmigdqykd001336j24y6tn8vt/approve", "body": {"amount": 500, "comment": ""}, "query": {}, "method": "POST", "status": 200, "durationMs": 48}	2025-11-26 19:10:58.542
cmigdrwhy001o36j2c2mgbeaq	cmibo586j000036mr4szvstjn	http.post	ROUTE	/deposits/:id/approve	::1	{"ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", "url": "/admin/deposits/cmigdrqzx001i36j2xvg1zc14/approve", "body": {"amount": 100, "comment": ""}, "query": {}, "method": "POST", "status": 200, "durationMs": 38}	2025-11-26 19:11:27.814
cmigdrwhz001q36j2ads91iim	cmibo586j000036mr4szvstjn	http.post	ROUTE	/deposits/:id/approve	::1	{"ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", "url": "/admin/deposits/cmigdrqzx001i36j2xvg1zc14/approve", "body": {"amount": 100, "comment": ""}, "query": {}, "method": "POST", "status": 200, "durationMs": 43}	2025-11-26 19:11:27.814
cmihbfjkq001y36j2x1923tfi	cmibo586j000036mr4szvstjn	http.post	ROUTE	/prefs/timezone	::1	{"ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", "url": "/admin/prefs/timezone", "body": {"timezone": "Asia/Kuala_Lumpur"}, "query": {}, "method": "POST", "status": 200, "durationMs": 6}	2025-11-27 10:53:38.139
cmihbfjkq001x36j2f2x45yw7	cmibo586j000036mr4szvstjn	http.post	ROUTE	/prefs/timezone	::1	{"ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", "url": "/admin/prefs/timezone", "body": {"timezone": "Asia/Kuala_Lumpur"}, "query": {}, "method": "POST", "status": 200, "durationMs": 8}	2025-11-27 10:53:38.139
cmihcd30v000136cdk6nhr4d8	cmibo586j000036mr4szvstjn	merchant.update	MERCHANT	cmiboed99000f36sv6ukl1hmo	::1	{"changed": {"name": "Demo Merchant", "email": "merchant@example.com", "active": true, "status": "active", "webhookUrl": null, "defaultCurrency": "AUD", "userDirectoryEnabled": true, "apiKeysSelfServiceEnabled": true}, "previous": {"name": "Demo Merchant", "active": true, "status": "active", "userDirectoryEnabled": true, "apiKeysSelfServiceEnabled": true}}	2025-11-27 11:19:42.99
cmihcdkwr000436cdhharrnzt	cmibo586j000036mr4szvstjn	merchant.create	MERCHANT	cmihcdkwk000236cd1naflp1x	::1	{"name": "Demo Merchant 2 ", "status": "active"}	2025-11-27 11:20:06.171
cmihe0ult001736cd0dt34ef5	cmibo586j000036mr4szvstjn	http.post	ROUTE	/deposits/:id/approve	::1	{"ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", "url": "/admin/deposits/cmihe0l9e001036cdwb74adyn/approve", "body": {"amount": 500, "comment": ""}, "query": {}, "method": "POST", "status": 200, "durationMs": 43}	2025-11-27 12:06:11.441
cmihe0ult001836cdnxyx1cjl	cmibo586j000036mr4szvstjn	http.post	ROUTE	/deposits/:id/approve	::1	{"ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", "url": "/admin/deposits/cmihe0l9e001036cdwb74adyn/approve", "body": {"amount": 500, "comment": ""}, "query": {}, "method": "POST", "status": 200, "durationMs": 48}	2025-11-27 12:06:11.441
cmihehkvg001536thbav5uhsq	cmibo586j000036mr4szvstjn	http.post	ROUTE	/deposits/:id/approve	::1	{"ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", "url": "/admin/deposits/cmihehd3v000x36thdcp8qxww/approve", "body": {"amount": 500, "comment": ""}, "query": {}, "method": "POST", "status": 200, "durationMs": 50}	2025-11-27 12:19:11.98
cmihehkvg001436thw17w7txa	cmibo586j000036mr4szvstjn	http.post	ROUTE	/deposits/:id/approve	::1	{"ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", "url": "/admin/deposits/cmihehd3v000x36thdcp8qxww/approve", "body": {"amount": 500, "comment": ""}, "query": {}, "method": "POST", "status": 200, "durationMs": 44}	2025-11-27 12:19:11.98
cmiheu4hr000536nfqz8zmlsq	cmibobjvj000636sv178w7wpl	http.post	ROUTE	/prefs/timezone	::1	{"ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", "url": "/admin/prefs/timezone", "body": {"timezone": ""}, "query": {}, "method": "POST", "status": 200, "durationMs": 13}	2025-11-27 12:28:57.28
cmiheu4hr000436nfif23sx45	cmibobjvj000636sv178w7wpl	http.post	ROUTE	/prefs/timezone	::1	{"ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", "url": "/admin/prefs/timezone", "body": {"timezone": ""}, "query": {}, "method": "POST", "status": 200, "durationMs": 10}	2025-11-27 12:28:57.28
cmihexes0001d36nf9klhf4g1	cmibo586j000036mr4szvstjn	http.post	ROUTE	/deposits/:id/approve	::1	{"ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", "url": "/admin/deposits/cmihex16n001536nf1zgxm5ao/approve", "body": {"amount": 500, "comment": ""}, "query": {}, "method": "POST", "status": 200, "durationMs": 44}	2025-11-27 12:31:30.576
cmihexes0001c36nfwy8pvjyw	cmibo586j000036mr4szvstjn	http.post	ROUTE	/deposits/:id/approve	::1	{"ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", "url": "/admin/deposits/cmihex16n001536nf1zgxm5ao/approve", "body": {"amount": 500, "comment": ""}, "query": {}, "method": "POST", "status": 200, "durationMs": 49}	2025-11-27 12:31:30.576
cmihfq56h001336ks6zr6bt5h	cmibo586j000036mr4szvstjn	http.post	ROUTE	/deposits/:id/approve	::1	{"ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", "url": "/admin/deposits/cmihfpr11000x36ksaadnzkxt/approve", "body": {"amount": 500, "comment": ""}, "query": {}, "method": "POST", "status": 200, "durationMs": 33}	2025-11-27 12:53:51.161
cmihfq56h001536ks9fcnxh44	cmibo586j000036mr4szvstjn	http.post	ROUTE	/deposits/:id/approve	::1	{"ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", "url": "/admin/deposits/cmihfpr11000x36ksaadnzkxt/approve", "body": {"amount": 500, "comment": ""}, "query": {}, "method": "POST", "status": 200, "durationMs": 39}	2025-11-27 12:53:51.161
cmihh76oq000136a5pm4fcw5r	cmibo586j000036mr4szvstjn	client.status.update	MERCHANT_CLIENT	cmiboed99000f36sv6ukl1hmo:cmihfoujz000036ks9sdtt3f1	::1	{"to": "DEACTIVATED", "from": "ACTIVE", "totpVerified": false}	2025-11-27 13:35:05.882
cmihht8mh000336a5po2lx0y6	cmibo586j000036mr4szvstjn	client.status.update	MERCHANT_CLIENT	cmiboed99000f36sv6ukl1hmo:cmihfoujz000036ks9sdtt3f1	::1	{"to": "ACTIVE", "from": "DEACTIVATED", "totpVerified": false}	2025-11-27 13:52:14.825
cmihqqdtq001436j9c4oxlj62	cmibo586j000036mr4szvstjn	http.post	ROUTE	/deposits/:id/approve	::1	{"ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", "url": "/admin/deposits/cmihqof6u000w36j9ix66c125/approve", "body": {"amount": 5000, "comment": ""}, "query": {}, "method": "POST", "status": 200, "durationMs": 59}	2025-11-27 18:01:58.142
cmihqqdtq001336j93bnkia93	cmibo586j000036mr4szvstjn	http.post	ROUTE	/deposits/:id/approve	::1	{"ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", "url": "/admin/deposits/cmihqof6u000w36j9ix66c125/approve", "body": {"amount": 5000, "comment": ""}, "query": {}, "method": "POST", "status": 200, "durationMs": 53}	2025-11-27 18:01:58.142
cmijee4hl0002361q11og7k9d	cmibo586j000036mr4szvstjn	http.post	ROUTE	/deposits/:id/reject	::1	{"ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", "url": "/admin/deposits/cmijdn492000p36illyor4sbp/reject", "body": {"comment": "Invalid"}, "query": {}, "method": "POST", "status": 200, "durationMs": 37}	2025-11-28 21:52:03.129
cmijee4hl0003361qua4yyd54	cmibo586j000036mr4szvstjn	http.post	ROUTE	/deposits/:id/reject	::1	{"ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", "url": "/admin/deposits/cmijdn492000p36illyor4sbp/reject", "body": {"comment": "Invalid"}, "query": {}, "method": "POST", "status": 200, "durationMs": 42}	2025-11-28 21:52:03.129
cmijeehur0007361qfhjxlkyl	cmibo586j000036mr4szvstjn	http.post	ROUTE	/deposits/:id/reject	::1	{"ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", "url": "/admin/deposits/cmijddgbv000p36xms9aqe918/reject", "body": {"comment": "Invalid"}, "query": {}, "method": "POST", "status": 200, "durationMs": 25}	2025-11-28 21:52:20.452
cmijeehur0005361qr7eihm2u	cmibo586j000036mr4szvstjn	http.post	ROUTE	/deposits/:id/reject	::1	{"ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", "url": "/admin/deposits/cmijddgbv000p36xms9aqe918/reject", "body": {"comment": "Invalid"}, "query": {}, "method": "POST", "status": 200, "durationMs": 30}	2025-11-28 21:52:20.452
cmijeejk8000a361qyovo2cv5	cmibo586j000036mr4szvstjn	http.post	ROUTE	/deposits/:id/reject	::1	{"ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", "url": "/admin/deposits/cmijcvktw000r368e84bq4pkf/reject", "body": {"comment": "Invalid"}, "query": {}, "method": "POST", "status": 200, "durationMs": 28}	2025-11-28 21:52:22.664
cmijeejk8000b361qvdzywhpg	cmibo586j000036mr4szvstjn	http.post	ROUTE	/deposits/:id/reject	::1	{"ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", "url": "/admin/deposits/cmijcvktw000r368e84bq4pkf/reject", "body": {"comment": "Invalid"}, "query": {}, "method": "POST", "status": 200, "durationMs": 23}	2025-11-28 21:52:22.664
cmijeelkf000e361qm5v9yie0	cmibo586j000036mr4szvstjn	http.post	ROUTE	/deposits/:id/reject	::1	{"ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", "url": "/admin/deposits/cmij2rj5f000y36jczj3o2i6q/reject", "body": {"comment": "Invalid"}, "query": {}, "method": "POST", "status": 200, "durationMs": 27}	2025-11-28 21:52:25.263
cmijeelkf000f361q6g827tuw	cmibo586j000036mr4szvstjn	http.post	ROUTE	/deposits/:id/reject	::1	{"ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", "url": "/admin/deposits/cmij2rj5f000y36jczj3o2i6q/reject", "body": {"comment": "Invalid"}, "query": {}, "method": "POST", "status": 200, "durationMs": 22}	2025-11-28 21:52:25.263
cmijfx29w001v36tuxsb9xwxi	cmibo586j000036mr4szvstjn	http.post	ROUTE	/deposits/:id/reject	::1	{"ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", "url": "/admin/deposits/cmijfwtlx001p36tued9wz3z2/reject", "body": {"comment": "Invalid"}, "query": {}, "method": "POST", "status": 200, "durationMs": 41}	2025-11-28 22:34:46.34
cmijfx4d9001y36tus0y9rt9x	cmibo586j000036mr4szvstjn	http.post	ROUTE	/deposits/:id/reject	::1	{"ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", "url": "/admin/deposits/cmijegtw80015361quvgu9xen/reject", "body": {"comment": "Invalid"}, "query": {}, "method": "POST", "status": 200, "durationMs": 15}	2025-11-28 22:34:49.053
cmijfx68h002136tu4twp1ujs	cmibo586j000036mr4szvstjn	http.post	ROUTE	/deposits/:id/reject	::1	{"ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", "url": "/admin/deposits/cmijfc4j3000t36tu4rvmlm3j/reject", "body": {"comment": "Invalid"}, "query": {}, "method": "POST", "status": 200, "durationMs": 31}	2025-11-28 22:34:51.474
cmijfx29w001u36tu7lvj90ve	cmibo586j000036mr4szvstjn	http.post	ROUTE	/deposits/:id/reject	::1	{"ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", "url": "/admin/deposits/cmijfwtlx001p36tued9wz3z2/reject", "body": {"comment": "Invalid"}, "query": {}, "method": "POST", "status": 200, "durationMs": 37}	2025-11-28 22:34:46.34
cmijfx4d9001z36tuy5ickbbw	cmibo586j000036mr4szvstjn	http.post	ROUTE	/deposits/:id/reject	::1	{"ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", "url": "/admin/deposits/cmijegtw80015361quvgu9xen/reject", "body": {"comment": "Invalid"}, "query": {}, "method": "POST", "status": 200, "durationMs": 13}	2025-11-28 22:34:49.053
cmijfx68h002336tupkib4jgp	cmibo586j000036mr4szvstjn	http.post	ROUTE	/deposits/:id/reject	::1	{"ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", "url": "/admin/deposits/cmijfc4j3000t36tu4rvmlm3j/reject", "body": {"comment": "Invalid"}, "query": {}, "method": "POST", "status": 200, "durationMs": 26}	2025-11-28 22:34:51.474
cmijgp6rb001a36do2f8p0rwb	cmibo586j000036mr4szvstjn	http.post	ROUTE	/deposits/:id/reject	::1	{"ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", "url": "/admin/deposits/cmijgot8i001636dol9q0xvfg/reject", "body": {"comment": "Invalid Receipt"}, "query": {}, "method": "POST", "status": 200, "durationMs": 40}	2025-11-28 22:56:38.519
cmijgp6rb001c36dop5gi00us	cmibo586j000036mr4szvstjn	http.post	ROUTE	/deposits/:id/reject	::1	{"ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36", "url": "/admin/deposits/cmijgot8i001636dol9q0xvfg/reject", "body": {"comment": "Invalid Receipt"}, "query": {}, "method": "POST", "status": 200, "durationMs": 45}	2025-11-28 22:56:38.519
\.


--
-- Data for Name: AdminLoginLog; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."AdminLoginLog" (id, "adminId", email, success, ip, "userAgent", "createdAt") FROM stdin;
cmibl6chu0001360xm191pptd	\N	test@mail.com	f	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36	2025-11-23 10:39:48.162
cmibmsp16000136z6br96y93y	\N	superadmin@example.com	f	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36	2025-11-23 11:25:10.458
cmibmsxpa000336z6mop93asp	\N	superadmin@example.com	f	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36	2025-11-23 11:25:21.694
cmibmtqv2000536z6rhevt26o	\N	superadmin@example.com	f	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36	2025-11-23 11:25:59.486
cmibn0zah000936z6okpz818x	\N	superadmin@example.com	f	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36	2025-11-23 11:31:37.001
cmibn6zxv000b36z6nl3doagy	\N	superadmin@example.com	f	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36	2025-11-23 11:36:17.779
cmibl7bpd0003360x8bm312em	\N	\N	t	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36	2025-11-23 10:40:33.793
cmibmvfbg000736z620nfqdts	\N	admin@example.com	t	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36	2025-11-23 11:27:17.836
cmibn9z650001364ic3azv6xu	\N	admin@example.com	t	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36	2025-11-23 11:38:36.75
cmibntdxn0003364ip47rfpzd	\N	superadmin@example.com	f	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36	2025-11-23 11:53:42.346
cmibntqbu0005364ix163jbmb	\N	superadmin@example.com	f	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36	2025-11-23 11:53:58.411
cmibo6f6a000136sve1oqmhvp	\N	superadmin@example.com	f	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36	2025-11-23 12:03:50.481
cmibo7ey3000336svcwjwwhtb	cmibo586j000036mr4szvstjn	admin@example.com	f	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36	2025-11-23 12:04:36.843
cmibo89bc000536svruptrgif	cmibo586j000036mr4szvstjn	\N	t	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36	2025-11-23 12:05:16.2
cmiboc86k000a36svk5xdjtmj	cmibobjvj000636sv178w7wpl	\N	t	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36	2025-11-23 12:08:21.357
cmiboclwp000c36sv2dmrpd8u	cmibo586j000036mr4szvstjn	admin@example.com	f	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36	2025-11-23 12:08:39.146
cmibodnvi000e36svp6lr6pc3	cmibo586j000036mr4szvstjn	admin@example.com	t	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36	2025-11-23 12:09:28.35
cmigciu1x000136cn8zqc2ux2	\N	admin@example.com	t	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36	2025-11-26 18:36:25.117
cmigcj37p000336cnr4hckz1c	\N	admin@example.com	t	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36	2025-11-26 18:36:36.997
cmigckkqp000736cnytyo8mko	cmibo586j000036mr4szvstjn	admin@example.com	t	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36	2025-11-26 18:37:46.369
cmigcl6gh000936cn5tft4n6k	cmibo586j000036mr4szvstjn	admin@example.com	t	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36	2025-11-26 18:38:14.514
cmigcm8y9000d36cnssxygssp	cmibobjvj000636sv178w7wpl	\N	t	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36	2025-11-26 18:39:04.402
cmigcn9pf000f36cnmts6jlou	cmibo586j000036mr4szvstjn	admin@example.com	t	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36	2025-11-26 18:39:52.035
cmihbf0hh001s36j2t6qfu015	cmibobjvj000636sv178w7wpl	test@mail.com	t	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36	2025-11-27 10:53:13.397
cmihbfgqa001u36j2qso9fhka	cmibo586j000036mr4szvstjn	admin@example.com	t	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36	2025-11-27 10:53:34.45
cmiheu2hh000136nff08gv754	cmibobjvj000636sv178w7wpl	test@mail.com	t	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36	2025-11-27 12:28:54.677
cmiheuost000736nf4w3mr3ac	cmibo586j000036mr4szvstjn	admin@example.com	t	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36	2025-11-27 12:29:23.597
cmihf6zja000136ko9ak0s94i	cmibobjvj000636sv178w7wpl	test@mail.com	t	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36	2025-11-27 12:38:57.383
cmihf7ebg000336ko45j24qha	cmibo586j000036mr4szvstjn	admin@example.com	t	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36	2025-11-27 12:39:16.541
cmihxliw7000136x4ngb4z4r3	cmibobjvj000636sv178w7wpl	test@mail.com	t	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36	2025-11-27 21:14:08.744
cmihxlsbo000336x4hym722ca	cmibo586j000036mr4szvstjn	admin@example.com	t	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36	2025-11-27 21:14:20.964
cmiio3uos000136ijnuiyhxdj	cmibobjvj000636sv178w7wpl	test@mail.com	t	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36	2025-11-28 09:36:13.852
cmiio4nzi000336ijtf8jj95z	cmibo586j000036mr4szvstjn	admin@example.com	t	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36	2025-11-28 09:36:51.822
cmij02tza000136c1pfgbnnj7	cmibobjvj000636sv178w7wpl	test@mail.com	t	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36	2025-11-28 15:11:21.67
cmij031kd000336c1p9k2i7f2	cmibo586j000036mr4szvstjn	admin@example.com	t	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36	2025-11-28 15:11:31.501
cmij051ac000536c1td7jco0n	cmibo586j000036mr4szvstjn	admin@example.com	t	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36	2025-11-28 15:13:04.452
cmik5gpcl001e36do8dm0lecp	cmibobjvj000636sv178w7wpl	test@mail.com	t	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36	2025-11-29 10:29:53.109
cmik5gy6z001g36docds8pisa	cmibo586j000036mr4szvstjn	admin@example.com	t	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36	2025-11-29 10:30:04.571
cmik7zmhc001m36do3jqgx7o3	cmibobjvj000636sv178w7wpl	test@mail.com	t	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36	2025-11-29 11:40:35.088
cmika7kdv000136uxhsqrnbhw	cmibo586j000036mr4szvstjn	admin@example.com	t	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36	2025-11-29 12:42:44.851
\.


--
-- Data for Name: AdminPasswordReset; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."AdminPasswordReset" (id, "adminId", token, "expiresAt", "usedAt", "createdAt") FROM stdin;
\.


--
-- Data for Name: AdminUser; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."AdminUser" (id, email, "passwordHash", role, "createdAt", "totpSecret", "twoFactorEnabled", active, "displayName", "lastLoginAt", "updatedAt", "superTwoFactorEnabled", "superTotpSecret", timezone, "canViewUserDirectory", "canRevealMerchantApiKeys") FROM stdin;
cmibobjvj000636sv178w7wpl	test@mail.com	$2a$10$nil3SKwUDBDzjfLAVoZ.fOI0DUgm.vX9wkEp30b.boqUvVDfI4XzC	ADMIN	2025-11-23 12:07:49.856	HFTXSUSJJ44DMW2SLI5HUZJTN53HELDCMZZG6ORMMM5VITTGKJHA	t	t	\N	2025-11-29 11:40:35.074	2025-11-29 11:40:35.075	f	\N	\N	t	f
cmibo586j000036mr4szvstjn	admin@example.com	$2a$10$JhP.AWoVipABNIsjXmNHt./2SNmdbrcAzr8ktcDIfDsBIxIHWW0we	SUPER	2025-11-23 12:02:54.762	\N	f	t	Super Admin	2025-11-29 12:42:44.833	2025-11-29 12:42:44.834	t	HYVGQNCHJJQVGLB4HJ2GYTB4LBRX2UJ6OJUU43KEKMUFCQKCKU4Q	Asia/Kuala_Lumpur	t	f
\.


--
-- Data for Name: BankAccount; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."BankAccount" (id, "merchantId", currency, "holderName", "bankName", "accountNo", iban, instructions, active, "createdAt", method, label, fields, "publicId") FROM stdin;
cmigcu1i2000l36cnemdk1cv2	cmiboed99000f36sv6ukl1hmo	AUD	Demo Pty Ltd	Demo Bank	payid@demo.com		Enter the unique alphanumeric code in the reference field for faster processing. Extra details may cause delays rejection	t	2025-11-26 18:45:07.994	PAYID	\N	{"core": {"iban": {"label": "IBAN (optional)", "order": 40, "visible": false}, "label": {"label": "Label (shown to payers)", "order": 50, "visible": false}, "bankName": {"label": "Bank Name", "order": 20, "visible": false}, "publicId": {"label": "Public Id", "order": 60, "visible": false}, "accountNo": {"label": "Account / PayID Value", "order": 30, "visible": true}, "holderName": {"label": "Account Holder Name", "order": 10, "visible": true}}, "extra": []}	B0003
cmigcsedk000g36cns5se440j	cmiboed99000f36sv6ukl1hmo	AUD	Demo Pty Ltd	Demo Bank	0123456789		Enter the unique alphanumeric code in the reference field for faster processing. Extra details may cause delays rejection	t	2025-11-26 18:43:51.368	OSKO	\N	{"core": {"iban": {"label": "IBAN (optional)", "order": 40, "visible": false}, "label": {"label": "Label (shown to payers)", "order": 50, "visible": false}, "bankName": {"label": "Bank Name", "order": 20, "visible": false}, "publicId": {"label": "Public Id", "order": 60, "visible": false}, "accountNo": {"label": "Account / PayID Value", "order": 30, "visible": true}, "holderName": {"label": "Account Holder Name", "order": 10, "visible": true}}, "extra": [{"key": "bsb", "type": "number", "label": "BSB", "order": 10, "value": "123456", "visible": true}]}	B0002
\.


--
-- Data for Name: IdempotencyKey; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."IdempotencyKey" (id, scope, key, response, "createdAt") FROM stdin;
\.


--
-- Data for Name: KycVerification; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."KycVerification" (id, "userId", provider, status, "externalSessionId", "createdAt", "updatedAt") FROM stdin;
cmihew70u000c36nf5mg4vspk	\N	didit	approved	1a65227d-a655-4456-9eba-ede5f81da790	2025-11-27 12:30:33.87	2025-11-27 12:31:05.186
cmihfov3u000436kszz4klzkd	\N	didit	approved	321fa8aa-954e-4a6a-8128-6e962e61a3aa	2025-11-27 12:52:51.45	2025-11-27 12:53:24.192
cmihqnpei000936j9p72pnebt	\N	didit	approved	1640d9c5-57d2-4f0c-989c-6b640c9d48d2	2025-11-27 17:59:53.178	2025-11-27 18:00:14.623
cmij2qtfr000936jc4np83aus	\N	didit	approved	c5c2a26a-ecff-47eb-a2b5-8e78c6ff73b6	2025-11-28 16:25:59.944	2025-11-28 16:26:24.357
cmijcutw30004368e6wcizsmd	\N	didit	approved	9538f158-3476-4eb4-bdbb-e7d650ed5125	2025-11-28 21:09:03.315	2025-11-28 21:09:25.528
cmijdcrrp000436xmftviplj8	\N	didit	approved	2ab86eac-7dc1-4176-8834-0d4e77ec3827	2025-11-28 21:23:00.373	2025-11-28 21:23:20.88
cmijdmhhi000436ilfnjr7mt5	\N	didit	approved	d095fcb8-40d5-4477-801a-844c33e84d99	2025-11-28 21:30:33.607	2025-11-28 21:30:52.221
cmijeg5yq000k361qkfqyr90r	\N	didit	approved	929a4669-f057-44da-bf47-c5e10851fe57	2025-11-28 21:53:38.354	2025-11-28 21:53:58.088
cmijfbcbz000436tudt4e6yqb	\N	didit	approved	8a3b11b4-0349-4630-9e62-8a9689e02996	2025-11-28 22:17:52.943	2025-11-28 22:18:17.524
cmijfw46h001036tu3i8vxd6g	\N	didit	approved	788394d4-576a-4567-9632-67642253c944	2025-11-28 22:34:02.154	2025-11-28 22:34:26.366
cmijgmv9g000436do8t2vgsta	cmijgmuom000036do95yrx4mm	didit	approved	a35758ef-3c9e-4814-80db-ef57f8bd6483	2025-11-28 22:54:50.308	2025-11-29 10:50:45.111
\.


--
-- Data for Name: LedgerEntry; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."LedgerEntry" (id, "merchantId", "amountCents", reason, "paymentId", "createdAt") FROM stdin;
cmigdr9vz001736j2is1pwfv8	cmiboed99000f36sv6ukl1hmo	50000	Deposit T26219	cmigdqykd001336j24y6tn8vt	2025-11-26 19:10:58.512
cmigdrwhc001m36j2lr7vqdvb	cmiboed99000f36sv6ukl1hmo	10000	Deposit T09297	cmigdrqzx001i36j2xvg1zc14	2025-11-26 19:11:27.792
cmihe0ul5001436cdlolqezgi	cmiboed99000f36sv6ukl1hmo	50000	Deposit T79972	cmihe0l9e001036cdwb74adyn	2025-11-27 12:06:11.417
cmihe491v000t36t4d21w4oth	cmiboed99000f36sv6ukl1hmo	50000	Deposit T73432	cmihe400y000p36t433uxsxno	2025-11-27 12:08:50.132
cmihehkur001136thca7jjm8v	cmiboed99000f36sv6ukl1hmo	50000	Deposit T07478	cmihehd3v000x36thdcp8qxww	2025-11-27 12:19:11.955
cmihexerc001936nff3pd31d6	cmiboed99000f36sv6ukl1hmo	50000	Deposit T79681	cmihex16n001536nf1zgxm5ao	2025-11-27 12:31:30.552
cmihfq55z001136ksdigxccj9	cmiboed99000f36sv6ukl1hmo	50000	Deposit T54755	cmihfpr11000x36ksaadnzkxt	2025-11-27 12:53:51.144
cmihqqdsw001036j9gzl2xjie	cmiboed99000f36sv6ukl1hmo	500000	Deposit T49678	cmihqof6u000w36j9ix66c125	2025-11-27 18:01:58.112
\.


--
-- Data for Name: Merchant; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Merchant" (id, name, "webhookUrl", "balanceCents", status, "createdAt", "updatedAt", active, "defaultCurrency", email, "userDirectoryEnabled", "apiKeysSelfServiceEnabled") FROM stdin;
cmihcdkwk000236cd1naflp1x	Demo Merchant 2 	\N	0	active	2025-11-27 11:20:06.165	2025-11-27 11:20:06.165	t	MYR	\N	t	t
cmiboed99000f36sv6ukl1hmo	Demo Merchant	\N	810000	active	2025-11-23 12:10:01.245	2025-11-27 18:01:58.117	t	AUD	merchant@example.com	t	t
\.


--
-- Data for Name: MerchantAccountEntry; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."MerchantAccountEntry" (id, "merchantId", type, method, "amountCents", note, "receiptFileId", "createdById", "createdAt") FROM stdin;
\.


--
-- Data for Name: MerchantApiKey; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."MerchantApiKey" (id, "merchantId", "createdAt", active, "expiresAt", last4, "lastUsedAt", prefix, scopes, "secretEnc") FROM stdin;
\.


--
-- Data for Name: MerchantApiKeyRevealLog; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."MerchantApiKeyRevealLog" (id, "merchantApiKeyId", "merchantId", "actorType", "merchantUserId", "adminUserId", reason, outcome, ip, "userAgent", "createdAt") FROM stdin;
\.


--
-- Data for Name: MerchantClient; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."MerchantClient" (id, "merchantId", "userId", "externalId", email, "createdAt", "updatedAt", status) FROM stdin;
cmihe3cll000236t4ngsk7e0p	cmiboed99000f36sv6ukl1hmo	cmijgmuom000036do95yrx4mm	merchant-kl1hmo-test	\N	2025-11-27 12:08:08.074	2025-11-29 10:50:45.125	ACTIVE
\.


--
-- Data for Name: MerchantFormConfig; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."MerchantFormConfig" ("merchantId", deposit, withdrawal, "createdAt", "updatedAt", "bankAccountId", id) FROM stdin;
cmiboed99000f36sv6ukl1hmo	[{"name": "Account holder", "field": "text", "display": "input", "options": [], "required": true, "maxDigits": null, "minDigits": 0, "placeholder": "Full name on bank account"}, {"name": "Account number", "field": "number", "display": "input", "options": [], "required": true, "maxDigits": 12, "minDigits": 10, "placeholder": "Account number (10 - 12 digits)"}, {"name": "Bank Name", "field": null, "display": "select", "options": ["ANZ", "Australian Military Bank", "Australian Unity", "Bank Australia", "Bank First", "Bank of Melbourne", "Bank of us", "Bank SA", "BankVIC", "Bankwest", "BCU", "BDCU Alliance Bank", "Bendigo Bank", "Beyond Bank Australia", "Border Bank", "Citi", "Coastline", "CommBank", "Community First", "Credit Union SA", "Defence Bank", "Easy Street Financial Services", "Family First Credit Union", "Firefighters Mutual Bank", "G&C Mutual Bank", "Goulburn Murray Credit Union", "Greater Bank", "Great Southern Bank", "Horizon Bank", "Hume Bank", "Hunter United", "Illawarra Credit Union", "imb Bank", "ING", "Macquarie Bank", "MOVE", "MyState", "NAB", "Newcastle Permanent", "Northern Inland Credit Union", "Orange Credit Union", "P&N Bank", "People's Choice Credit Union", "Police Bank", "Police Credit Union", "QBANK", "Qudos Bank", "Queensland Country Credit Union", "Regional Australia Bank", "Reliance Bank", "Service One Alliance Bank", "South West Credit Union", "St.George", "Suncorp", "Teachers Mutual Bank", "The Mac", "The Mutual", "UniBank", "Unity Bank", "Ubank", "UP Bank", "Westpac"], "required": true, "maxDigits": null, "minDigits": 0, "placeholder": ""}, {"name": "BSB", "field": "number", "display": "input", "options": [], "required": true, "maxDigits": 6, "minDigits": 6, "placeholder": "BSB (6 digits)"}]	[{"name": "Account holder", "field": "text", "display": "input", "options": [], "required": true, "maxDigits": null, "minDigits": 0, "placeholder": "Full name on bank account"}, {"name": "Account number", "field": "number", "display": "input", "options": [], "required": true, "maxDigits": 12, "minDigits": 10, "placeholder": "Account number (10 - 12 digits)"}, {"name": "Bank Name", "field": null, "display": "select", "options": ["ANZ", "Australian Military Bank", "Australian Unity", "Bank Australia", "Bank First", "Bank of Melbourne", "Bank of us", "Bank SA", "BankVIC", "Bankwest", "BCU", "BDCU Alliance Bank", "Bendigo Bank", "Beyond Bank Australia", "Border Bank", "Citi", "Coastline", "CommBank", "Community First", "Credit Union SA", "Defence Bank", "Easy Street Financial Services", "Family First Credit Union", "Firefighters Mutual Bank", "G&C Mutual Bank", "Goulburn Murray Credit Union", "Greater Bank", "Great Southern Bank", "Horizon Bank", "Hume Bank", "Hunter United", "Illawarra Credit Union", "imb Bank", "ING", "Macquarie Bank", "MOVE", "MyState", "NAB", "Newcastle Permanent", "Northern Inland Credit Union", "Orange Credit Union", "P&N Bank", "People's Choice Credit Union", "Police Bank", "Police Credit Union", "QBANK", "Qudos Bank", "Queensland Country Credit Union", "Regional Australia Bank", "Reliance Bank", "Service One Alliance Bank", "South West Credit Union", "St.George", "Suncorp", "Teachers Mutual Bank", "The Mac", "The Mutual", "UniBank", "Unity Bank", "Ubank", "UP Bank", "Westpac"], "required": true, "maxDigits": null, "minDigits": 0, "placeholder": ""}, {"name": "BSB", "field": "number", "display": "input", "options": [], "required": true, "maxDigits": 6, "minDigits": 6, "placeholder": "BSB (6 digits)"}]	2025-11-26 18:56:57.226	2025-11-26 18:56:57.226	cmigcsedk000g36cns5se440j	cmigd98qy000z36cnqznoctpx
cmiboed99000f36sv6ukl1hmo	[{"name": "Account holder", "field": "text", "display": "input", "options": [], "required": true, "maxDigits": null, "minDigits": 0, "placeholder": "Full name on bank account"}, {"name": "PayID", "field": "phone_email", "display": "input", "options": [], "required": true, "maxDigits": null, "minDigits": 0, "placeholder": "Mobile +61XXXXXXXXX or email"}, {"name": "Bank Name", "field": null, "display": "select", "options": ["ANZ", "Australian Military Bank", "Australian Unity", "Bank Australia", "Bank First", "Bank of Melbourne", "Bank of us", "Bank SA", "BankVIC", "Bankwest", "BCU", "BDCU Alliance Bank", "Bendigo Bank", "Beyond Bank Australia", "Border Bank", "Citi", "Coastline", "CommBank", "Community First", "Credit Union SA", "Defence Bank", "Easy Street Financial Services", "Family First Credit Union", "Firefighters Mutual Bank", "G&C Mutual Bank", "Goulburn Murray Credit Union", "Greater Bank", "Great Southern Bank", "Horizon Bank", "Hume Bank", "Hunter United", "Illawarra Credit Union", "imb Bank", "ING", "Macquarie Bank", "MOVE", "MyState", "NAB", "Newcastle Permanent", "Northern Inland Credit Union", "Orange Credit Union", "P&N Bank", "People's Choice Credit Union", "Police Bank", "Police Credit Union", "QBANK", "Qudos Bank", "Queensland Country Credit Union", "Regional Australia Bank", "Reliance Bank", "Service One Alliance Bank", "South West Credit Union", "St.George", "Suncorp", "Teachers Mutual Bank", "The Mac", "The Mutual", "UniBank", "Unity Bank", "Ubank", "UP Bank", "Westpac"], "required": true, "maxDigits": null, "minDigits": 0, "placeholder": ""}]	[{"name": "Account holder", "field": "text", "display": "input", "options": [], "required": true, "maxDigits": null, "minDigits": 0, "placeholder": "Full name on bank account"}, {"name": "PayID", "field": "phone_email", "display": "input", "options": [], "required": true, "maxDigits": null, "minDigits": 0, "placeholder": "Mobile +61XXXXXXXXX or email"}, {"name": "Bank Name", "field": null, "display": "select", "options": ["ANZ", "Australian Military Bank", "Australian Unity", "Bank Australia", "Bank First", "Bank of Melbourne", "Bank of us", "Bank SA", "BankVIC", "Bankwest", "BCU", "BDCU Alliance Bank", "Bendigo Bank", "Beyond Bank Australia", "Border Bank", "Citi", "Coastline", "CommBank", "Community First", "Credit Union SA", "Defence Bank", "Easy Street Financial Services", "Family First Credit Union", "Firefighters Mutual Bank", "G&C Mutual Bank", "Goulburn Murray Credit Union", "Greater Bank", "Great Southern Bank", "Horizon Bank", "Hume Bank", "Hunter United", "Illawarra Credit Union", "imb Bank", "ING", "Macquarie Bank", "MOVE", "MyState", "NAB", "Newcastle Permanent", "Northern Inland Credit Union", "Orange Credit Union", "P&N Bank", "People's Choice Credit Union", "Police Bank", "Police Credit Union", "QBANK", "Qudos Bank", "Queensland Country Credit Union", "Regional Australia Bank", "Reliance Bank", "Service One Alliance Bank", "South West Credit Union", "St.George", "Suncorp", "Teachers Mutual Bank", "The Mac", "The Mutual", "UniBank", "Unity Bank", "Ubank", "UP Bank", "Westpac"], "required": true, "maxDigits": null, "minDigits": 0, "placeholder": ""}]	2025-11-26 18:57:06.364	2025-11-26 18:58:36.973	cmigcu1i2000l36cnemdk1cv2	cmigd9fsr001336cnunqvge3i
\.


--
-- Data for Name: MerchantLimits; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."MerchantLimits" ("merchantId", "maxReqPerMin", "ipAllowList", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: MerchantLoginLog; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."MerchantLoginLog" (id, "merchantUserId", email, success, ip, "userAgent", "createdAt") FROM stdin;
\.


--
-- Data for Name: MerchantPasswordReset; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."MerchantPasswordReset" (id, "merchantUserId", token, "expiresAt", "usedAt", "createdAt") FROM stdin;
\.


--
-- Data for Name: MerchantUser; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."MerchantUser" (id, "merchantId", email, "passwordHash", role, active, "twoFactorEnabled", "totpSecret", "createdAt", "updatedAt", "lastLoginAt", timezone, "canViewUserDirectory", "canRevealApiKeys") FROM stdin;
cmiboemon000j36svli5f8xcb	cmiboed99000f36sv6ukl1hmo	merchant@example.com	$2a$10$oZv4WltosAlDKeamdG70K.81KGtyOl4ZdaNcTqdaVqu30gHA/YiIO	OWNER	t	t	KI3CQO3WPM2VAZLIGVWVUMDZN5FECVJ3OVTVISL3IM7UMND2OIRQ	2025-11-23 12:10:13.464	2025-11-27 12:29:13.639	\N	\N	t	t
\.


--
-- Data for Name: NotificationChannel; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."NotificationChannel" (id, "merchantId", type, "chatId", direction, active, "createdAt") FROM stdin;
\.


--
-- Data for Name: PayerBlocklist; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."PayerBlocklist" (id, "merchantId", "userId", reason, active, "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: PaymentRequest; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."PaymentRequest" (id, type, status, "amountCents", currency, "referenceCode", "merchantId", "userId", "bankAccountId", "receiptFileId", "detailsJson", "rejectedReason", "createdAt", "updatedAt", notes, "processedByAdminId", "processedAt", "uniqueReference") FROM stdin;
cmihex16n001536nf1zgxm5ao	DEPOSIT	APPROVED	50000	AUD	T79681	cmiboed99000f36sv6ukl1hmo	\N	cmigcsedk000g36cns5se440j	cmihex16t001736nf31hy8i4h	{"payer": {"bsb": "123456", "bankName": "Westpac", "accountNo": "0123456789", "holderName": "Cristiano Ronaldo"}, "extras": {"BSB": "123456", "Bank Name": "Westpac", "Account holder": "Cristiano Ronaldo", "Account number": "0123456789"}, "method": "OSKO"}	\N	2025-11-27 12:31:12.96	2025-11-27 12:31:30.559	\N	cmibo586j000036mr4szvstjn	2025-11-27 12:31:30.551	UB97368
cmihfpr11000x36ksaadnzkxt	DEPOSIT	APPROVED	50000	AUD	T54755	cmiboed99000f36sv6ukl1hmo	\N	cmigcsedk000g36cns5se440j	cmihfpr16000z36ks8guboe9e	{"payer": {"bsb": "123456", "bankName": "Reliance Bank", "accountNo": "01234567890", "holderName": "Cristiano Ronaldo"}, "extras": {"BSB": "123456", "Bank Name": "Reliance Bank", "Account holder": "Cristiano Ronaldo", "Account number": "01234567890"}, "method": "OSKO"}	\N	2025-11-27 12:53:32.821	2025-11-27 12:53:51.15	\N	cmibo586j000036mr4szvstjn	2025-11-27 12:53:51.143	UB66972
cmihqof6u000w36j9ix66c125	DEPOSIT	APPROVED	500000	AUD	T49678	cmiboed99000f36sv6ukl1hmo	\N	cmigcsedk000g36cns5se440j	cmihqof72000y36j9ulpe7ha2	{"payer": {"bsb": "123456", "bankName": "Queensland Country Credit Union", "accountNo": "0123456789", "holderName": "Cristiano Ronaldo"}, "extras": {"BSB": "123456", "Bank Name": "Queensland Country Credit Union", "Account holder": "Cristiano Ronaldo", "Account number": "0123456789"}, "method": "OSKO"}	\N	2025-11-27 18:00:26.598	2025-11-27 18:01:58.122	\N	cmibo586j000036mr4szvstjn	2025-11-27 18:01:58.111	UB23871
cmijddgbv000p36xms9aqe918	DEPOSIT	REJECTED	50000	AUD	T73965	cmiboed99000f36sv6ukl1hmo	\N	cmigcsedk000g36cns5se440j	cmijddgc2000r36xmjwhtrhkh	{"payer": {"bsb": "123456", "bankName": "Suncorp", "accountNo": "01234567890", "holderName": "Cristiano Ronaldo"}, "extras": {"BSB": "123456", "Bank Name": "Suncorp", "Account holder": "Cristiano Ronaldo", "Account number": "01234567890"}, "method": "OSKO"}	Invalid	2025-11-28 21:23:32.204	2025-11-28 21:52:20.438	Invalid	cmibo586j000036mr4szvstjn	2025-11-28 21:52:20.437	UB26189
cmijcvktw000r368e84bq4pkf	DEPOSIT	REJECTED	50000	AUD	T31676	cmiboed99000f36sv6ukl1hmo	\N	cmigcsedk000g36cns5se440j	cmijcvku4000t368eyikigfpu	{"payer": {"bsb": "123456", "bankName": "Qudos Bank", "accountNo": "01234567890", "holderName": "Mike Tyson"}, "extras": {"BSB": "123456", "Bank Name": "Qudos Bank", "Account holder": "Mike Tyson", "Account number": "01234567890"}, "method": "OSKO"}	Invalid	2025-11-28 21:09:38.229	2025-11-28 21:52:22.652	Invalid	cmibo586j000036mr4szvstjn	2025-11-28 21:52:22.652	UB13001
cmij2rj5f000y36jczj3o2i6q	DEPOSIT	REJECTED	50000	AUD	T70574	cmiboed99000f36sv6ukl1hmo	\N	cmigcsedk000g36cns5se440j	cmij2rj5l001036jc90v6t4iy	{"payer": {"bsb": "123456", "bankName": "Westpac", "accountNo": "01234567890", "holderName": "Mike Tyson"}, "extras": {"BSB": "123456", "Bank Name": "Westpac", "Account holder": "Mike Tyson", "Account number": "01234567890"}, "method": "OSKO"}	Invalid	2025-11-28 16:26:33.267	2025-11-28 21:52:25.252	Invalid	cmibo586j000036mr4szvstjn	2025-11-28 21:52:25.251	UB79462
cmijdn492000p36illyor4sbp	DEPOSIT	REJECTED	40000	AUD	T92421	cmiboed99000f36sv6ukl1hmo	\N	cmigcsedk000g36cns5se440j	cmijdn497000r36illrhka68n	{"payer": {"bsb": "123456", "bankName": "ANZ", "accountNo": "01234567890", "holderName": "Mike Tyson"}, "extras": {"BSB": "123456", "Bank Name": "ANZ", "Account holder": "Mike Tyson", "Account number": "01234567890"}, "method": "OSKO"}	Invalid	2025-11-28 21:31:03.11	2025-11-28 21:52:03.111	Invalid	cmibo586j000036mr4szvstjn	2025-11-28 21:52:03.11	UB27642
cmijgot8i001636dol9q0xvfg	DEPOSIT	REJECTED	100000	AUD	T55087	cmiboed99000f36sv6ukl1hmo	cmijgmuom000036do95yrx4mm	cmigcsedk000g36cns5se440j	cmijgot8p001836dovx14rsls	{"payer": {"bsb": "123456", "bankName": "ANZ", "accountNo": "01234567890", "holderName": "Ramesh Subra,A/L Subramaniam"}, "extras": {"BSB": "123456", "Bank Name": "ANZ", "Account holder": "Ramesh Subra,A/L Subramaniam", "Account number": "01234567890"}, "method": "OSKO"}	Invalid Receipt	2025-11-28 22:56:20.994	2025-11-28 22:56:38.497	Invalid Receipt	cmibo586j000036mr4szvstjn	2025-11-28 22:56:38.496	UB65211
cmijegtw80015361quvgu9xen	DEPOSIT	REJECTED	100000	AUD	T71779	cmiboed99000f36sv6ukl1hmo	\N	cmigcsedk000g36cns5se440j	cmijegtwd0017361qqqp9n527	{"payer": {"bsb": "123456", "bankName": "Ubank", "accountNo": "01234567890", "holderName": "Donald Trump"}, "extras": {"BSB": "123456", "Bank Name": "Ubank", "Account holder": "Donald Trump", "Account number": "01234567890"}, "method": "OSKO"}	Invalid	2025-11-28 21:54:09.368	2025-11-28 22:34:49.047	Invalid	cmibo586j000036mr4szvstjn	2025-11-28 22:34:49.046	UB42127
cmijfc4j3000t36tu4rvmlm3j	DEPOSIT	REJECTED	10000	AUD	T687095	cmiboed99000f36sv6ukl1hmo	\N	cmigcsedk000g36cns5se440j	cmijfc4j9000v36tu3xz6xwa8	{"payer": {"bsb": "123456", "bankName": "ANZ", "accountNo": "01234567890", "holderName": "Mike Tyson"}, "extras": {"BSB": "123456", "Bank Name": "ANZ", "Account holder": "Mike Tyson", "Account number": "01234567890"}, "method": "OSKO"}	Invalid	2025-11-28 22:18:29.488	2025-11-28 22:34:51.459	Invalid	cmibo586j000036mr4szvstjn	2025-11-28 22:34:51.458	UB599155
cmijfwtlx001p36tued9wz3z2	DEPOSIT	REJECTED	19900	AUD	T12057	cmiboed99000f36sv6ukl1hmo	\N	cmigcsedk000g36cns5se440j	cmijfwtm3001r36tulgog2hyu	{"payer": {"bsb": "123456", "bankName": "Queensland Country Credit Union", "accountNo": "01234567890", "holderName": "Mike Tyson"}, "extras": {"BSB": "123456", "Bank Name": "Queensland Country Credit Union", "Account holder": "Mike Tyson", "Account number": "01234567890"}, "method": "OSKO"}	Invalid	2025-11-28 22:34:35.109	2025-11-28 22:34:46.321	Invalid	cmibo586j000036mr4szvstjn	2025-11-28 22:34:46.32	UB79837
\.


--
-- Data for Name: ReceiptFile; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."ReceiptFile" (id, path, "mimeType", size, original, "createdAt", "paymentId") FROM stdin;
cmihex16t001736nf31hy8i4h	/uploads/1764246672930_proprcii_1_.jpg	image/jpeg	58929	proprcii (1).jpg	2025-11-27 12:31:12.965	cmihex16n001536nf1zgxm5ao
cmihfpr16000z36ks8guboe9e	/uploads/1764248012792_proprcii_1_.jpg	image/jpeg	58929	proprcii (1).jpg	2025-11-27 12:53:32.827	cmihfpr11000x36ksaadnzkxt
cmihqof72000y36j9ulpe7ha2	/uploads/1764266426571_proprcii_1_.jpg	image/jpeg	58929	proprcii (1).jpg	2025-11-27 18:00:26.606	cmihqof6u000w36j9ix66c125
cmij2rj5l001036jc90v6t4iy	/uploads/1764347193235_proprcii_1_.jpg	image/jpeg	58929	proprcii (1).jpg	2025-11-28 16:26:33.273	cmij2rj5f000y36jczj3o2i6q
cmijcvku4000t368eyikigfpu	/uploads/1764364178201_proprcii_1_.jpg	image/jpeg	58929	proprcii (1).jpg	2025-11-28 21:09:38.236	cmijcvktw000r368e84bq4pkf
cmijddgc2000r36xmjwhtrhkh	/uploads/1764365012173_proprcii_1_.jpg	image/jpeg	58929	proprcii (1).jpg	2025-11-28 21:23:32.21	cmijddgbv000p36xms9aqe918
cmijdn497000r36illrhka68n	/uploads/1764365463077_proprcii_1_.jpg	image/jpeg	58929	proprcii (1).jpg	2025-11-28 21:31:03.116	cmijdn492000p36illyor4sbp
cmijegtwd0017361qqqp9n527	/uploads/1764366849341_proprcii_1_.jpg	image/jpeg	58929	proprcii (1).jpg	2025-11-28 21:54:09.373	cmijegtw80015361quvgu9xen
cmijfc4j9000v36tu3xz6xwa8	/uploads/1764368309456_proprcii_1_.jpg	image/jpeg	58929	proprcii (1).jpg	2025-11-28 22:18:29.494	cmijfc4j3000t36tu4rvmlm3j
cmijfwtm3001r36tulgog2hyu	/uploads/1764369275079_proprcii_1_.jpg	image/jpeg	58929	proprcii (1).jpg	2025-11-28 22:34:35.115	cmijfwtlx001p36tued9wz3z2
cmijgot8p001836dovx14rsls	/uploads/1764370580961_proprcii_1_.jpg	image/jpeg	58929	proprcii (1).jpg	2025-11-28 22:56:21.001	cmijgot8i001636dol9q0xvfg
\.


--
-- Data for Name: User; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."User" (id, email, phone, "diditSubject", "verifiedAt", "createdAt", "publicId", "updatedAt", "fullName") FROM stdin;
cmijgmuom000036do95yrx4mm	\N	\N	m:cmiboed99000f36sv6ukl1hmo:KgU4ApSMyGo1KTQYCwg8SvtuhPqTYnRc	2025-11-28 22:55:05.664	2025-11-28 22:54:49.558	U09166	2025-11-29 10:50:45.128	Ramesh Subra Subramaniam
\.


--
-- Data for Name: WithdrawalDestination; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."WithdrawalDestination" (id, "userId", currency, "bankName", "holderName", "accountNo", iban, "createdAt") FROM stdin;
\.


--
-- Data for Name: _prisma_migrations; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) FROM stdin;
d5596d37-a818-4c59-ba0c-cdad76985a6d	8817e97a13473ab76ef76d71c8af928e46fe32e1cca314ace0b97da465c39fae	2025-11-23 11:08:52.335129+00	20251203120000_super_admin_merchant_2fa		\N	2025-11-23 11:08:52.335129+00	0
e7833b92-bace-4d8d-8cb2-ff1eabe82753	c42c51cd994c0d41031ac036a7a85b13fb83ef24d817469582c8489dc4865b89	2025-11-22 22:06:23.133893+00	20251017151054_payments_platform_p2p	\N	\N	2025-11-22 22:06:23.107429+00	1
401ae70c-7737-48a9-a0d8-bd2604b3aef9	a37768a066587b782d50235cd14710c38781bc3e108ee139d1aea429ba0e1b02	2025-11-22 22:06:23.196065+00	20251102111639_add_merchant_form_config	\N	\N	2025-11-22 22:06:23.192997+00	1
3bc1a537-5142-4f36-a245-655984eb6c6f	7130aeae0634831c2fd76ef57a1ce843106f8f02e7fb87d86abc798608e27de1	2025-11-22 22:06:23.137632+00	20251018125847_add_adminuser_2fa	\N	\N	2025-11-22 22:06:23.134529+00	1
5dea2114-590b-40fd-84db-3fc241bc69b8	8fe3befd94dd4c2b9d62cf311e5bb21206a2f0bc8253bbf5fbf8d391af7c8e95	2025-11-22 22:06:23.142224+00	20251019180234_add_merchant_api_keys	\N	\N	2025-11-22 22:06:23.138244+00	1
235ef5ad-9dca-4497-a5d8-0589d6f20320	ceb9ba9c3298ca13ea8a3dc1c91db2a1fdb485ac14fe3f81e22b109e67d557fc	2025-11-22 22:06:23.165866+00	20251020132526_super_admin_and_audit	\N	\N	2025-11-22 22:06:23.142871+00	1
d3c05697-521b-49a2-b5e2-d8b397aca457	31037cb3bf5b21fda79bc580c8be17a586c3c8ed9c983ecd3eb32bd2ff24422c	2025-11-22 22:06:23.200445+00	20251102220016_formconfig_per_bank	\N	\N	2025-11-22 22:06:23.196687+00	1
a89a473b-64ca-4690-b2d2-36e8dbdfd349	eed2a8138238bd3443e8760eeb3b062642f43aa096b13421cce2d3e2c3dbe310	2025-11-22 22:06:23.171227+00	20251020224617_add_notification_channels	\N	\N	2025-11-22 22:06:23.166497+00	1
a7606242-026b-4473-a666-2a784ad25710	2f84977f4066f9eb02a609bab48172da5820304f92818a97906bf60c29a6de8c	2025-11-22 22:06:23.173629+00	20251021110310_add_merchant_email_active_currency	\N	\N	2025-11-22 22:06:23.171818+00	1
2f446260-2bc0-453e-a0f8-6cbcf61ab892	4372ae94af6e5b170c7c23aad8b5f4a224d4d6f07dd327a0ddf969d742f42e6e	2025-11-22 22:06:23.176069+00	20251022214031_add_payment_notes	\N	\N	2025-11-22 22:06:23.174189+00	1
4fd40e3a-afdd-4785-a8fc-a3d1bf333365	bbc4b70ac3aa3fbe3eb7b3351e917d35a7ad58ec73a79ba447e5e8f143680e23	2025-11-22 22:06:23.203597+00	20251104120000_add_payment_processed_fields	\N	\N	2025-11-22 22:06:23.201045+00	1
c5137e66-2b8c-4257-bdcc-5aa8674a8c08	326ad5d231e5f422ecc4215e0b508f9b72114cb3bf8a6080e9c8732d80341506	2025-11-22 22:06:23.179154+00	20251023133652_add_multi_receipts_nonbreaking	\N	\N	2025-11-22 22:06:23.176604+00	1
6d398e14-ad88-4089-aa89-68f31da81039	fa2aeb0fdc4a96d5534b37bf2e9e5ff776e845ea7e5f5d835cd3fdccd881f862	2025-11-22 22:06:23.182511+00	20251030_bank_method_selection	\N	\N	2025-11-22 22:06:23.179781+00	1
293dd02f-05ed-4e91-a148-01b055b34f27	619d921ce556c490b8ae5a1b19cb2befcb67b6b58282928890c8a1c3a2ab67f6	2025-11-22 22:06:23.185149+00	20251030133013_add_bankaccount_method_label	\N	\N	2025-11-22 22:06:23.18308+00	1
ce67347a-deb6-4fdb-be98-4817dda517fd	fd3ab6cb2fa2cdb0faf3c3336c1a9ed3cbe2d2805fed5b39a1cac58c26d3ab24	2025-11-22 22:06:23.21427+00	20251104120000_bank_public_id_seq_and_default	\N	\N	2025-11-22 22:06:23.204209+00	1
94005c5c-7d30-4e20-993b-771261fd4270	fcbf77914a15860379d4bc9ced2687ea5aea319abff14223df0fae2a5e7755d1	2025-11-22 22:06:23.187481+00	20251030152947_bank_dynamic_fields	\N	\N	2025-11-22 22:06:23.185736+00	1
7a2adbf4-4ed1-4a03-a51a-d29d75302490	d8a9fcd64968abdb31469c700eb020e280ecb5f745eeb049350f758023b68cb0	2025-11-22 22:06:23.190459+00	20251031203529_add_bank_promoted_fields	\N	\N	2025-11-22 22:06:23.188057+00	1
0fa996bf-00da-4b89-b505-dd3bc491c40b	1cb6ab8b7798820885682457ce6e99e21d13578f1b685c6f8c9343923c56ea9d	2025-11-22 22:06:23.192468+00	20251031203931_add_bank_promoted_fields	\N	\N	2025-11-22 22:06:23.190986+00	1
4697f2cd-c38c-41f7-9505-c38c132e2d00	973e44f9092917670738042a5291a7a8cee334cad5cd3f5722e855475e400407	2025-11-22 22:06:23.218678+00	20251105120000_short_ids	\N	\N	2025-11-22 22:06:23.214863+00	1
63863d51-8dcf-4762-a098-8a1009d0c3a5	8fb540400768a1031429fef17c7381a4279c5e8b21168304243fa9322c52c08c	\N	20251111215752_reconcile_schema_to_models	A migration failed to apply. New migrations cannot be applied before the error is recovered from. Read more about how to resolve migration issues in a production database: https://pris.ly/d/migrate-resolve\n\nMigration name: 20251111215752_reconcile_schema_to_models\n\nDatabase error code: 42701\n\nDatabase error:\nERROR: column "canRevealMerchantApiKeys" of relation "AdminUser" already exists\n\nDbError { severity: "ERROR", parsed_severity: Some(Error), code: SqlState(E42701), message: "column \\"canRevealMerchantApiKeys\\" of relation \\"AdminUser\\" already exists", detail: None, hint: None, position: None, where_: None, schema: None, table: None, column: None, datatype: None, constraint: None, file: Some("tablecmds.c"), line: Some(7347), routine: Some("check_for_column_name_collision") }\n\n   0: sql_schema_connector::apply_migration::apply_script\n           with migration_name="20251111215752_reconcile_schema_to_models"\n             at schema-engine/connectors/sql-schema-connector/src/apply_migration.rs:113\n   1: schema_commands::commands::apply_migrations::Applying migration\n           with migration_name="20251111215752_reconcile_schema_to_models"\n             at schema-engine/commands/src/commands/apply_migrations.rs:95\n   2: schema_core::state::ApplyMigrations\n             at schema-engine/core/src/state.rs:244	2025-11-23 10:58:33.713091+00	2025-11-23 10:53:30.244561+00	0
9828ff4a-2ad1-439a-9f36-93dd9fc41765	72cd9fc683ac791a1737e51f925684f0d2d97e74ce4ce29440aa0dad7b633c0f	2025-11-23 10:41:49.676998+00	20251106123000_bank_public_ids	\N	\N	2025-11-23 10:41:49.665932+00	1
c84eaed7-5e16-4c8d-9047-00a596b3aa42	8fb540400768a1031429fef17c7381a4279c5e8b21168304243fa9322c52c08c	2025-11-23 10:58:33.714598+00	20251111215752_reconcile_schema_to_models		\N	2025-11-23 10:58:33.714598+00	0
1934a0c2-bf1c-42a3-aa48-601004e1d2c8	ed2c77e8965cfee00dbef3a4dd5501c401bc7580e027c6ca3e5fdec90333d009	2025-11-23 10:42:54.855409+00	20251106120000_disable_cascade_deletes	\N	2025-11-23 10:41:44.164658+00	2025-11-22 22:06:23.219269+00	1
54333cd7-115b-46e5-b5a6-d2e7be0552ff	ed2c77e8965cfee00dbef3a4dd5501c401bc7580e027c6ca3e5fdec90333d009	2025-11-23 10:42:54.855409+00	20251106120000_disable_cascade_deletes	\N	\N	2025-11-23 10:41:44.167273+00	1
61f0016c-c2bb-42a5-b4ce-3c0ff73d82cc	6c0112f539c7bdbebefd186c9df05cff0db528dec3dd941c3dff045b48e5a298	\N	20251107150000_user_directory_flags	A migration failed to apply. New migrations cannot be applied before the error is recovered from. Read more about how to resolve migration issues in a production database: https://pris.ly/d/migrate-resolve\n\nMigration name: 20251107150000_user_directory_flags\n\nDatabase error code: 42701\n\nDatabase error:\nERROR: column "userDirectoryEnabled" of relation "Merchant" already exists\n\nDbError { severity: "ERROR", parsed_severity: Some(Error), code: SqlState(E42701), message: "column \\"userDirectoryEnabled\\" of relation \\"Merchant\\" already exists", detail: None, hint: None, position: None, where_: None, schema: None, table: None, column: None, datatype: None, constraint: None, file: Some("tablecmds.c"), line: Some(7347), routine: Some("check_for_column_name_collision") }\n\n   0: sql_schema_connector::apply_migration::apply_script\n           with migration_name="20251107150000_user_directory_flags"\n             at schema-engine/connectors/sql-schema-connector/src/apply_migration.rs:113\n   1: schema_commands::commands::apply_migrations::Applying migration\n           with migration_name="20251107150000_user_directory_flags"\n             at schema-engine/commands/src/commands/apply_migrations.rs:95\n   2: schema_core::state::ApplyMigrations\n             at schema-engine/core/src/state.rs:244	2025-11-23 10:53:24.659906+00	2025-11-23 10:41:49.678491+00	0
a2dbbf55-3ab5-455f-a1e8-f36de0649672	6c0112f539c7bdbebefd186c9df05cff0db528dec3dd941c3dff045b48e5a298	2025-11-23 10:53:24.662295+00	20251107150000_user_directory_flags		\N	2025-11-23 10:53:24.662295+00	0
864a34b8-60bb-4c16-a083-c67b2974d1cb	60b9ac6fb1c6d172f5dac6328d29ee873863d9f3515dcd710883d3c3c8a2cff1	\N	20251201090000_user_directory_permissions	A migration failed to apply. New migrations cannot be applied before the error is recovered from. Read more about how to resolve migration issues in a production database: https://pris.ly/d/migrate-resolve\n\nMigration name: 20251201090000_user_directory_permissions\n\nDatabase error code: 42701\n\nDatabase error:\nERROR: column "canViewUserDirectory" of relation "AdminUser" already exists\n\nDbError { severity: "ERROR", parsed_severity: Some(Error), code: SqlState(E42701), message: "column \\"canViewUserDirectory\\" of relation \\"AdminUser\\" already exists", detail: None, hint: None, position: None, where_: None, schema: None, table: None, column: None, datatype: None, constraint: None, file: Some("tablecmds.c"), line: Some(7347), routine: Some("check_for_column_name_collision") }\n\n   0: sql_schema_connector::apply_migration::apply_script\n           with migration_name="20251201090000_user_directory_permissions"\n             at schema-engine/connectors/sql-schema-connector/src/apply_migration.rs:113\n   1: schema_commands::commands::apply_migrations::Applying migration\n           with migration_name="20251201090000_user_directory_permissions"\n             at schema-engine/commands/src/commands/apply_migrations.rs:95\n   2: schema_core::state::ApplyMigrations\n             at schema-engine/core/src/state.rs:244	2025-11-23 11:01:00.987575+00	2025-11-23 10:58:41.611903+00	0
1ee3a5c8-18b7-484f-9679-e65e30f25d08	60b9ac6fb1c6d172f5dac6328d29ee873863d9f3515dcd710883d3c3c8a2cff1	2025-11-23 11:01:00.989665+00	20251201090000_user_directory_permissions		\N	2025-11-23 11:01:00.989665+00	0
7e1af65d-13f3-4aae-abde-9bb2be2359e5	54b966934721e24d37da87844b01ca3df3c2998e8b758fee5ff1a79095f4aea0	\N	20251202120000_accounts_module	A migration failed to apply. New migrations cannot be applied before the error is recovered from. Read more about how to resolve migration issues in a production database: https://pris.ly/d/migrate-resolve\n\nMigration name: 20251202120000_accounts_module\n\nDatabase error code: 42710\n\nDatabase error:\nERROR: type "MerchantAccountEntryType" already exists\n\nDbError { severity: "ERROR", parsed_severity: Some(Error), code: SqlState(E42710), message: "type \\"MerchantAccountEntryType\\" already exists", detail: None, hint: None, position: None, where_: None, schema: None, table: None, column: None, datatype: None, constraint: None, file: Some("typecmds.c"), line: Some(1167), routine: Some("DefineEnum") }\n\n   0: sql_schema_connector::apply_migration::apply_script\n           with migration_name="20251202120000_accounts_module"\n             at schema-engine/connectors/sql-schema-connector/src/apply_migration.rs:113\n   1: schema_commands::commands::apply_migrations::Applying migration\n           with migration_name="20251202120000_accounts_module"\n             at schema-engine/commands/src/commands/apply_migrations.rs:95\n   2: schema_core::state::ApplyMigrations\n             at schema-engine/core/src/state.rs:244	2025-11-23 11:03:58.602661+00	2025-11-23 11:01:05.86583+00	0
261fe783-903e-4b2e-94f1-512169f0a9f6	54b966934721e24d37da87844b01ca3df3c2998e8b758fee5ff1a79095f4aea0	2025-11-23 11:03:58.605454+00	20251202120000_accounts_module		\N	2025-11-23 11:03:58.605454+00	0
df32bb94-0fca-4b22-8e2a-4d28bc69ae96	8817e97a13473ab76ef76d71c8af928e46fe32e1cca314ace0b97da465c39fae	\N	20251203120000_super_admin_merchant_2fa	A migration failed to apply. New migrations cannot be applied before the error is recovered from. Read more about how to resolve migration issues in a production database: https://pris.ly/d/migrate-resolve\n\nMigration name: 20251203120000_super_admin_merchant_2fa\n\nDatabase error code: 42701\n\nDatabase error:\nERROR: column "superTwoFactorEnabled" of relation "AdminUser" already exists\n\nDbError { severity: "ERROR", parsed_severity: Some(Error), code: SqlState(E42701), message: "column \\"superTwoFactorEnabled\\" of relation \\"AdminUser\\" already exists", detail: None, hint: None, position: None, where_: None, schema: None, table: None, column: None, datatype: None, constraint: None, file: Some("tablecmds.c"), line: Some(7347), routine: Some("check_for_column_name_collision") }\n\n   0: sql_schema_connector::apply_migration::apply_script\n           with migration_name="20251203120000_super_admin_merchant_2fa"\n             at schema-engine/connectors/sql-schema-connector/src/apply_migration.rs:113\n   1: schema_commands::commands::apply_migrations::Applying migration\n           with migration_name="20251203120000_super_admin_merchant_2fa"\n             at schema-engine/commands/src/commands/apply_migrations.rs:95\n   2: schema_core::state::ApplyMigrations\n             at schema-engine/core/src/state.rs:244	2025-11-23 11:08:52.332511+00	2025-11-23 11:04:05.654921+00	0
a119e4ff-ce76-46d8-b8cc-7cca1f1bcecd	880a62999a065e2112df637c87ba1eeafac5dbcbb16b67caf13ab07516db435e	\N	20251210123000_add_merchant_client_map	A migration failed to apply. New migrations cannot be applied before the error is recovered from. Read more about how to resolve migration issues in a production database: https://pris.ly/d/migrate-resolve\n\nMigration name: 20251210123000_add_merchant_client_map\n\nDatabase error code: 42P07\n\nDatabase error:\nERROR: relation "MerchantClient" already exists\n\nDbError { severity: "ERROR", parsed_severity: Some(Error), code: SqlState(E42P07), message: "relation \\"MerchantClient\\" already exists", detail: None, hint: None, position: None, where_: None, schema: None, table: None, column: None, datatype: None, constraint: None, file: Some("heap.c"), line: Some(1150), routine: Some("heap_create_with_catalog") }\n\n   0: sql_schema_connector::apply_migration::apply_script\n           with migration_name="20251210123000_add_merchant_client_map"\n             at schema-engine/connectors/sql-schema-connector/src/apply_migration.rs:113\n   1: schema_commands::commands::apply_migrations::Applying migration\n           with migration_name="20251210123000_add_merchant_client_map"\n             at schema-engine/commands/src/commands/apply_migrations.rs:95\n   2: schema_core::state::ApplyMigrations\n             at schema-engine/core/src/state.rs:244	2025-11-23 11:09:22.600094+00	2025-11-23 11:09:02.50413+00	0
38b1d583-9916-437e-b39d-7d45904c5245	880a62999a065e2112df637c87ba1eeafac5dbcbb16b67caf13ab07516db435e	2025-11-23 11:09:22.601679+00	20251210123000_add_merchant_client_map		\N	2025-11-23 11:09:22.601679+00	0
e575f1c8-2b01-4d9a-9cd3-7915ab5a5669	1a8d785fae038d1dbbe79e9f927af12d2e3a3dafe0be218afda17bebb4e6bfb6	\N	20251212120000_rename_merchant_client_table	A migration failed to apply. New migrations cannot be applied before the error is recovered from. Read more about how to resolve migration issues in a production database: https://pris.ly/d/migrate-resolve\n\nMigration name: 20251212120000_rename_merchant_client_table\n\nDatabase error code: 42P01\n\nDatabase error:\nERROR: relation "MerchantClient_diditSubject_key" does not exist\n\nDbError { severity: "ERROR", parsed_severity: Some(Error), code: SqlState(E42P01), message: "relation \\"MerchantClient_diditSubject_key\\" does not exist", detail: None, hint: None, position: None, where_: None, schema: None, table: None, column: None, datatype: None, constraint: None, file: Some("namespace.c"), line: Some(434), routine: Some("RangeVarGetRelidExtended") }\n\n   0: sql_schema_connector::apply_migration::apply_script\n           with migration_name="20251212120000_rename_merchant_client_table"\n             at schema-engine/connectors/sql-schema-connector/src/apply_migration.rs:113\n   1: schema_commands::commands::apply_migrations::Applying migration\n           with migration_name="20251212120000_rename_merchant_client_table"\n             at schema-engine/commands/src/commands/apply_migrations.rs:95\n   2: schema_core::state::ApplyMigrations\n             at schema-engine/core/src/state.rs:244	2025-11-23 11:09:49.406474+00	2025-11-23 11:09:34.386576+00	0
94e7bf13-58c7-4de0-98fa-8240332a45b6	1a8d785fae038d1dbbe79e9f927af12d2e3a3dafe0be218afda17bebb4e6bfb6	2025-11-23 11:09:49.407653+00	20251212120000_rename_merchant_client_table		\N	2025-11-23 11:09:49.407653+00	0
64ff38f3-1f06-4986-85d3-e679f4e536da	810f74cfd36bb78df529b0d1811b6eb23946911269ad5417633a0953973ec7ab	2025-11-23 11:10:24.625653+00	20251231120000_unify_merchant_client_mapping	\N	\N	2025-11-23 11:10:24.613724+00	1
07726100-2fbd-4f05-b43b-27d62e25ad5c	aefd7910acc36d8bd75dc02be3bb307c41dbac830d7ee8f14e6829bf7b620eb7	\N	20251220120000_merchant_client_mapping	A migration failed to apply. New migrations cannot be applied before the error is recovered from. Read more about how to resolve migration issues in a production database: https://pris.ly/d/migrate-resolve\n\nMigration name: 20251220120000_merchant_client_mapping\n\nDatabase error code: 42P07\n\nDatabase error:\nERROR: relation "MerchantClient" already exists\n\nDbError { severity: "ERROR", parsed_severity: Some(Error), code: SqlState(E42P07), message: "relation \\"MerchantClient\\" already exists", detail: None, hint: None, position: None, where_: None, schema: None, table: None, column: None, datatype: None, constraint: None, file: Some("heap.c"), line: Some(1150), routine: Some("heap_create_with_catalog") }\n\n   0: sql_schema_connector::apply_migration::apply_script\n           with migration_name="20251220120000_merchant_client_mapping"\n             at schema-engine/connectors/sql-schema-connector/src/apply_migration.rs:113\n   1: schema_commands::commands::apply_migrations::Applying migration\n           with migration_name="20251220120000_merchant_client_mapping"\n             at schema-engine/commands/src/commands/apply_migrations.rs:95\n   2: schema_core::state::ApplyMigrations\n             at schema-engine/core/src/state.rs:244	2025-11-23 11:10:23.948682+00	2025-11-23 11:10:06.207628+00	0
88df397b-5795-43c7-a79e-0d13200c4d19	aefd7910acc36d8bd75dc02be3bb307c41dbac830d7ee8f14e6829bf7b620eb7	2025-11-23 11:10:23.95018+00	20251220120000_merchant_client_mapping		\N	2025-11-23 11:10:23.95018+00	0
63278236-6d35-4192-8042-9e54a1551286	d7e77725f53d5a3fde996c42b93e526aabbdd7890c2e134005dc79b319e779c0	2025-11-23 11:10:24.613101+00	20251223100000_cleanup_client_mapping	\N	\N	2025-11-23 11:10:24.60698+00	1
d1475e05-d2ea-4132-9069-72345233824c	2489772a7652e68a72c0129d1efacc2b0e8e76e9a2838f094050dbd8d1ad40f5	2025-11-23 11:10:24.628552+00	20251231123000_add_user_updated_at	\N	\N	2025-11-23 11:10:24.626448+00	1
6443b9d1-2882-43d1-90f4-358aa84919ae	7935a4826c73c4aab560aec929ace0275f14932042d1ee00f5bc391940ab1e21	2025-11-23 11:10:24.632216+00	20251301090000_add_user_updated_at	\N	\N	2025-11-23 11:10:24.629139+00	1
62baedde-f876-4d86-9108-8dfa092353ee	1a7df63819e570feda7094fdf08b160dfe4a5a347eb2592adec6121028a94fe5	2025-11-27 12:07:14.81235+00	20260101090000_disable_cascades_again	\N	\N	2025-11-27 12:07:14.794453+00	1
0619af6a-0041-4904-8f98-f05997b00338	7f8006a30976ab6bfb35f9474120e75f2328440adae17beb5492e8635bd51f66	2025-11-27 12:16:48.26063+00	20260115120000_stop_remaining_cascades	\N	\N	2025-11-27 12:16:48.254045+00	1
8355cc27-8f11-4ca1-892b-205059ccf06f	7067d9413b28c351bb1fde920f368fd18068507d58a76a3b8c00d2561333f9ff	2025-11-27 12:26:42.58739+00	20260321090000_enforce_safe_deletes	\N	\N	2025-11-27 12:26:42.5606+00	1
\.


--
-- Name: bank_public_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.bank_public_id_seq', 3, true);


--
-- Name: AdminAuditLog AdminAuditLog_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."AdminAuditLog"
    ADD CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY (id);


--
-- Name: AdminLoginLog AdminLoginLog_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."AdminLoginLog"
    ADD CONSTRAINT "AdminLoginLog_pkey" PRIMARY KEY (id);


--
-- Name: AdminPasswordReset AdminPasswordReset_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."AdminPasswordReset"
    ADD CONSTRAINT "AdminPasswordReset_pkey" PRIMARY KEY (id);


--
-- Name: AdminUser AdminUser_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."AdminUser"
    ADD CONSTRAINT "AdminUser_pkey" PRIMARY KEY (id);


--
-- Name: BankAccount BankAccount_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."BankAccount"
    ADD CONSTRAINT "BankAccount_pkey" PRIMARY KEY (id);


--
-- Name: BankAccount BankAccount_publicId_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."BankAccount"
    ADD CONSTRAINT "BankAccount_publicId_key" UNIQUE ("publicId");


--
-- Name: IdempotencyKey IdempotencyKey_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."IdempotencyKey"
    ADD CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY (id);


--
-- Name: KycVerification KycVerification_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."KycVerification"
    ADD CONSTRAINT "KycVerification_pkey" PRIMARY KEY (id);


--
-- Name: LedgerEntry LedgerEntry_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."LedgerEntry"
    ADD CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY (id);


--
-- Name: MerchantAccountEntry MerchantAccountEntry_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."MerchantAccountEntry"
    ADD CONSTRAINT "MerchantAccountEntry_pkey" PRIMARY KEY (id);


--
-- Name: MerchantAccountEntry MerchantAccountEntry_receiptFileId_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."MerchantAccountEntry"
    ADD CONSTRAINT "MerchantAccountEntry_receiptFileId_key" UNIQUE ("receiptFileId");


--
-- Name: MerchantApiKeyRevealLog MerchantApiKeyRevealLog_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."MerchantApiKeyRevealLog"
    ADD CONSTRAINT "MerchantApiKeyRevealLog_pkey" PRIMARY KEY (id);


--
-- Name: MerchantApiKey MerchantApiKey_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."MerchantApiKey"
    ADD CONSTRAINT "MerchantApiKey_pkey" PRIMARY KEY (id);


--
-- Name: MerchantClient MerchantClient_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."MerchantClient"
    ADD CONSTRAINT "MerchantClient_pkey" PRIMARY KEY (id);


--
-- Name: MerchantFormConfig MerchantFormConfig_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."MerchantFormConfig"
    ADD CONSTRAINT "MerchantFormConfig_pkey" PRIMARY KEY (id);


--
-- Name: MerchantLimits MerchantLimits_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."MerchantLimits"
    ADD CONSTRAINT "MerchantLimits_pkey" PRIMARY KEY ("merchantId");


--
-- Name: MerchantLoginLog MerchantLoginLog_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."MerchantLoginLog"
    ADD CONSTRAINT "MerchantLoginLog_pkey" PRIMARY KEY (id);


--
-- Name: MerchantPasswordReset MerchantPasswordReset_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."MerchantPasswordReset"
    ADD CONSTRAINT "MerchantPasswordReset_pkey" PRIMARY KEY (id);


--
-- Name: MerchantUser MerchantUser_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."MerchantUser"
    ADD CONSTRAINT "MerchantUser_pkey" PRIMARY KEY (id);


--
-- Name: Merchant Merchant_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Merchant"
    ADD CONSTRAINT "Merchant_pkey" PRIMARY KEY (id);


--
-- Name: NotificationChannel NotificationChannel_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."NotificationChannel"
    ADD CONSTRAINT "NotificationChannel_pkey" PRIMARY KEY (id);


--
-- Name: PayerBlocklist PayerBlocklist_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."PayerBlocklist"
    ADD CONSTRAINT "PayerBlocklist_pkey" PRIMARY KEY (id);


--
-- Name: PaymentRequest PaymentRequest_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."PaymentRequest"
    ADD CONSTRAINT "PaymentRequest_pkey" PRIMARY KEY (id);


--
-- Name: ReceiptFile ReceiptFile_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ReceiptFile"
    ADD CONSTRAINT "ReceiptFile_pkey" PRIMARY KEY (id);


--
-- Name: User User_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY (id);


--
-- Name: WithdrawalDestination WithdrawalDestination_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."WithdrawalDestination"
    ADD CONSTRAINT "WithdrawalDestination_pkey" PRIMARY KEY (id);


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: AdminAuditLog_adminId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "AdminAuditLog_adminId_idx" ON public."AdminAuditLog" USING btree ("adminId");


--
-- Name: AdminAuditLog_targetType_targetId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "AdminAuditLog_targetType_targetId_idx" ON public."AdminAuditLog" USING btree ("targetType", "targetId");


--
-- Name: AdminLoginLog_adminId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "AdminLoginLog_adminId_idx" ON public."AdminLoginLog" USING btree ("adminId");


--
-- Name: AdminLoginLog_email_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "AdminLoginLog_email_idx" ON public."AdminLoginLog" USING btree (email);


--
-- Name: AdminPasswordReset_adminId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "AdminPasswordReset_adminId_idx" ON public."AdminPasswordReset" USING btree ("adminId");


--
-- Name: AdminPasswordReset_token_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "AdminPasswordReset_token_key" ON public."AdminPasswordReset" USING btree (token);


--
-- Name: AdminUser_email_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "AdminUser_email_key" ON public."AdminUser" USING btree (email);


--
-- Name: BankAccount_merchantId_currency_method_active_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "BankAccount_merchantId_currency_method_active_idx" ON public."BankAccount" USING btree ("merchantId", currency, method, active);


--
-- Name: IdempotencyKey_scope_key_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "IdempotencyKey_scope_key_key" ON public."IdempotencyKey" USING btree (scope, key);


--
-- Name: KycVerification_externalSessionId_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "KycVerification_externalSessionId_key" ON public."KycVerification" USING btree ("externalSessionId");


--
-- Name: MerchantAccountEntry_createdAt_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "MerchantAccountEntry_createdAt_idx" ON public."MerchantAccountEntry" USING btree ("createdAt");


--
-- Name: MerchantAccountEntry_merchantId_type_createdAt_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "MerchantAccountEntry_merchantId_type_createdAt_idx" ON public."MerchantAccountEntry" USING btree ("merchantId", type, "createdAt");


--
-- Name: MerchantApiKeyRevealLog_adminUserId_createdAt_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "MerchantApiKeyRevealLog_adminUserId_createdAt_idx" ON public."MerchantApiKeyRevealLog" USING btree ("adminUserId", "createdAt");


--
-- Name: MerchantApiKeyRevealLog_merchantApiKeyId_createdAt_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "MerchantApiKeyRevealLog_merchantApiKeyId_createdAt_idx" ON public."MerchantApiKeyRevealLog" USING btree ("merchantApiKeyId", "createdAt");


--
-- Name: MerchantApiKeyRevealLog_merchantId_createdAt_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "MerchantApiKeyRevealLog_merchantId_createdAt_idx" ON public."MerchantApiKeyRevealLog" USING btree ("merchantId", "createdAt");


--
-- Name: MerchantApiKeyRevealLog_merchantUserId_createdAt_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "MerchantApiKeyRevealLog_merchantUserId_createdAt_idx" ON public."MerchantApiKeyRevealLog" USING btree ("merchantUserId", "createdAt");


--
-- Name: MerchantApiKey_merchantId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "MerchantApiKey_merchantId_idx" ON public."MerchantApiKey" USING btree ("merchantId");


--
-- Name: MerchantApiKey_prefix_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "MerchantApiKey_prefix_key" ON public."MerchantApiKey" USING btree (prefix);


--
-- Name: MerchantClient_merchantId_externalId_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "MerchantClient_merchantId_externalId_key" ON public."MerchantClient" USING btree ("merchantId", "externalId");


--
-- Name: MerchantClient_merchantId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "MerchantClient_merchantId_idx" ON public."MerchantClient" USING btree ("merchantId");


--
-- Name: MerchantClient_merchantId_userId_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "MerchantClient_merchantId_userId_key" ON public."MerchantClient" USING btree ("merchantId", "userId");


--
-- Name: MerchantClient_userId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "MerchantClient_userId_idx" ON public."MerchantClient" USING btree ("userId");


--
-- Name: MerchantFormConfig_merchantId_bankAccountId_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "MerchantFormConfig_merchantId_bankAccountId_key" ON public."MerchantFormConfig" USING btree ("merchantId", "bankAccountId");


--
-- Name: MerchantLoginLog_email_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "MerchantLoginLog_email_idx" ON public."MerchantLoginLog" USING btree (email);


--
-- Name: MerchantLoginLog_merchantUserId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "MerchantLoginLog_merchantUserId_idx" ON public."MerchantLoginLog" USING btree ("merchantUserId");


--
-- Name: MerchantPasswordReset_merchantUserId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "MerchantPasswordReset_merchantUserId_idx" ON public."MerchantPasswordReset" USING btree ("merchantUserId");


--
-- Name: MerchantPasswordReset_token_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "MerchantPasswordReset_token_key" ON public."MerchantPasswordReset" USING btree (token);


--
-- Name: MerchantUser_email_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "MerchantUser_email_key" ON public."MerchantUser" USING btree (email);


--
-- Name: MerchantUser_merchantId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "MerchantUser_merchantId_idx" ON public."MerchantUser" USING btree ("merchantId");


--
-- Name: NotificationChannel_merchantId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "NotificationChannel_merchantId_idx" ON public."NotificationChannel" USING btree ("merchantId");


--
-- Name: NotificationChannel_merchantId_type_chatId_direction_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "NotificationChannel_merchantId_type_chatId_direction_key" ON public."NotificationChannel" USING btree ("merchantId", type, "chatId", direction);


--
-- Name: PayerBlocklist_merchantId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "PayerBlocklist_merchantId_idx" ON public."PayerBlocklist" USING btree ("merchantId");


--
-- Name: PayerBlocklist_merchantId_userId_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "PayerBlocklist_merchantId_userId_key" ON public."PayerBlocklist" USING btree ("merchantId", "userId");


--
-- Name: PayerBlocklist_userId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "PayerBlocklist_userId_idx" ON public."PayerBlocklist" USING btree ("userId");


--
-- Name: PaymentRequest_processedByAdminId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "PaymentRequest_processedByAdminId_idx" ON public."PaymentRequest" USING btree ("processedByAdminId");


--
-- Name: PaymentRequest_receiptFileId_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "PaymentRequest_receiptFileId_key" ON public."PaymentRequest" USING btree ("receiptFileId");


--
-- Name: PaymentRequest_referenceCode_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "PaymentRequest_referenceCode_key" ON public."PaymentRequest" USING btree ("referenceCode");


--
-- Name: PaymentRequest_uniqueReference_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "PaymentRequest_uniqueReference_key" ON public."PaymentRequest" USING btree ("uniqueReference");


--
-- Name: ReceiptFile_paymentId_createdAt_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "ReceiptFile_paymentId_createdAt_idx" ON public."ReceiptFile" USING btree ("paymentId", "createdAt");


--
-- Name: User_diditSubject_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "User_diditSubject_key" ON public."User" USING btree ("diditSubject");


--
-- Name: User_email_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "User_email_key" ON public."User" USING btree (email);


--
-- Name: User_phone_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "User_phone_key" ON public."User" USING btree (phone);


--
-- Name: User_publicId_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "User_publicId_key" ON public."User" USING btree ("publicId");


--
-- Name: AdminAuditLog AdminAuditLog_adminId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."AdminAuditLog"
    ADD CONSTRAINT "AdminAuditLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES public."AdminUser"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: AdminLoginLog AdminLoginLog_adminId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."AdminLoginLog"
    ADD CONSTRAINT "AdminLoginLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES public."AdminUser"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: AdminPasswordReset AdminPasswordReset_adminId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."AdminPasswordReset"
    ADD CONSTRAINT "AdminPasswordReset_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES public."AdminUser"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: BankAccount BankAccount_merchantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."BankAccount"
    ADD CONSTRAINT "BankAccount_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES public."Merchant"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: KycVerification KycVerification_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."KycVerification"
    ADD CONSTRAINT "KycVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: LedgerEntry LedgerEntry_merchantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."LedgerEntry"
    ADD CONSTRAINT "LedgerEntry_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES public."Merchant"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: MerchantAccountEntry MerchantAccountEntry_createdById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."MerchantAccountEntry"
    ADD CONSTRAINT "MerchantAccountEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES public."AdminUser"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: MerchantAccountEntry MerchantAccountEntry_merchantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."MerchantAccountEntry"
    ADD CONSTRAINT "MerchantAccountEntry_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES public."Merchant"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: MerchantAccountEntry MerchantAccountEntry_receiptFileId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."MerchantAccountEntry"
    ADD CONSTRAINT "MerchantAccountEntry_receiptFileId_fkey" FOREIGN KEY ("receiptFileId") REFERENCES public."ReceiptFile"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: MerchantApiKeyRevealLog MerchantApiKeyRevealLog_adminUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."MerchantApiKeyRevealLog"
    ADD CONSTRAINT "MerchantApiKeyRevealLog_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES public."AdminUser"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: MerchantApiKeyRevealLog MerchantApiKeyRevealLog_merchantApiKeyId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."MerchantApiKeyRevealLog"
    ADD CONSTRAINT "MerchantApiKeyRevealLog_merchantApiKeyId_fkey" FOREIGN KEY ("merchantApiKeyId") REFERENCES public."MerchantApiKey"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: MerchantApiKeyRevealLog MerchantApiKeyRevealLog_merchantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."MerchantApiKeyRevealLog"
    ADD CONSTRAINT "MerchantApiKeyRevealLog_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES public."Merchant"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: MerchantApiKeyRevealLog MerchantApiKeyRevealLog_merchantUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."MerchantApiKeyRevealLog"
    ADD CONSTRAINT "MerchantApiKeyRevealLog_merchantUserId_fkey" FOREIGN KEY ("merchantUserId") REFERENCES public."MerchantUser"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: MerchantApiKey MerchantApiKey_merchantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."MerchantApiKey"
    ADD CONSTRAINT "MerchantApiKey_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES public."Merchant"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: MerchantClient MerchantClient_merchantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."MerchantClient"
    ADD CONSTRAINT "MerchantClient_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES public."Merchant"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: MerchantClient MerchantClient_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."MerchantClient"
    ADD CONSTRAINT "MerchantClient_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: MerchantFormConfig MerchantFormConfig_bankAccountId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."MerchantFormConfig"
    ADD CONSTRAINT "MerchantFormConfig_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES public."BankAccount"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: MerchantFormConfig MerchantFormConfig_merchantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."MerchantFormConfig"
    ADD CONSTRAINT "MerchantFormConfig_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES public."Merchant"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: MerchantLimits MerchantLimits_merchantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."MerchantLimits"
    ADD CONSTRAINT "MerchantLimits_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES public."Merchant"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: MerchantLoginLog MerchantLoginLog_merchantUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."MerchantLoginLog"
    ADD CONSTRAINT "MerchantLoginLog_merchantUserId_fkey" FOREIGN KEY ("merchantUserId") REFERENCES public."MerchantUser"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: MerchantPasswordReset MerchantPasswordReset_merchantUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."MerchantPasswordReset"
    ADD CONSTRAINT "MerchantPasswordReset_merchantUserId_fkey" FOREIGN KEY ("merchantUserId") REFERENCES public."MerchantUser"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: MerchantUser MerchantUser_merchantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."MerchantUser"
    ADD CONSTRAINT "MerchantUser_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES public."Merchant"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: NotificationChannel NotificationChannel_merchantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."NotificationChannel"
    ADD CONSTRAINT "NotificationChannel_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES public."Merchant"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: PayerBlocklist PayerBlocklist_merchantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."PayerBlocklist"
    ADD CONSTRAINT "PayerBlocklist_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES public."Merchant"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: PayerBlocklist PayerBlocklist_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."PayerBlocklist"
    ADD CONSTRAINT "PayerBlocklist_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: PaymentRequest PaymentRequest_bankAccountId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."PaymentRequest"
    ADD CONSTRAINT "PaymentRequest_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES public."BankAccount"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: PaymentRequest PaymentRequest_merchantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."PaymentRequest"
    ADD CONSTRAINT "PaymentRequest_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES public."Merchant"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: PaymentRequest PaymentRequest_processedByAdminId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."PaymentRequest"
    ADD CONSTRAINT "PaymentRequest_processedByAdminId_fkey" FOREIGN KEY ("processedByAdminId") REFERENCES public."AdminUser"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: PaymentRequest PaymentRequest_receiptFileId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."PaymentRequest"
    ADD CONSTRAINT "PaymentRequest_receiptFileId_fkey" FOREIGN KEY ("receiptFileId") REFERENCES public."ReceiptFile"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: PaymentRequest PaymentRequest_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."PaymentRequest"
    ADD CONSTRAINT "PaymentRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: ReceiptFile ReceiptFile_paymentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ReceiptFile"
    ADD CONSTRAINT "ReceiptFile_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES public."PaymentRequest"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: WithdrawalDestination WithdrawalDestination_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."WithdrawalDestination"
    ADD CONSTRAINT "WithdrawalDestination_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: postgres
--

REVOKE USAGE ON SCHEMA public FROM PUBLIC;


--
-- PostgreSQL database dump complete
--

\unrestrict nnqmsApr8DI7lc5jiqoidyjguZ8BlnQBJxzHefJj4xbai6D8pCrUle0vjsITcSx

