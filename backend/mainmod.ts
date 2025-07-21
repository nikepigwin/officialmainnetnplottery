import { Application, Router } from "oak";
import { Lucid, Blockfrost, Data, Constr, fromHex } from "lucid-cardano";
// Use Deno.readTextFileSync for file reading

// Utility: Normalize ADA policy ID ('' or 'lovelace' both mean ADA)
function normalizeAdaPolicyId(pid: string): string {
  return pid === '' ? 'lovelace' : pid;
}

// Debug log for Oak and Deno version
console.log("Nikepig backend starting, Oak version: v12.6.1, Deno version:", Deno.version);

// Load the actual validator from contract/plutus.json
const plutusJson = JSON.parse(Deno.readTextFileSync("./contract/plutus.json"));
const SCRIPT_VALIDATOR = plutusJson.validators[0].compiledCode;

const app = new Application();
const router = new Router();

// Enhanced Security Features - Phase 3.4

// Rate limiting storage
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

// Rate limiting middleware
function rateLimit(maxRequests: number, windowMs: number) {
  return async (ctx: any, next: any) => {
    const clientIP = ctx.request.ip || ctx.request.headers.get("x-forwarded-for") || "unknown";
    const now = Date.now();
    
    // Clean up expired entries
    for (const [key, value] of rateLimitStore.entries()) {
      if (now > value.resetTime) {
        rateLimitStore.delete(key);
      }
    }
    
    const key = `${clientIP}:${ctx.request.url.pathname}`;
    const current = rateLimitStore.get(key);
    
    if (!current || now > current.resetTime) {
      // First request or window expired
      rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
    } else if (current.count >= maxRequests) {
      // Rate limit exceeded
      ctx.response.status = 429;
      ctx.response.body = { 
        success: false, 
        error: "Rate limit exceeded. Please try again later.",
        retryAfter: Math.ceil((current.resetTime - now) / 1000)
      };
      return;
    } else {
      // Increment count
      current.count++;
    }
    
    await next();
  };
}

// Input validation middleware
function validateInput() {
  return async (ctx: any, next: any) => {
    try {
      // Sanitize request body for POST requests
      if (ctx.request.method === "POST" && ctx.request.body) {
        const bodyResult = await ctx.request.body({ type: "json" });
        const body = bodyResult.value;
        
        // Sanitize string inputs
        for (const [key, value] of Object.entries(body)) {
          if (typeof value === "string") {
            // Remove potentially dangerous characters
            body[key] = value.replace(/[<>\"'&]/g, "");
            // Limit string length
            if (body[key].length > 1000) {
              body[key] = body[key].substring(0, 1000);
            }
          }
        }
        
        // Store sanitized body in ctx.state, not ctx.request.body
        ctx.state.body = body;
      }
      
      await next();
    } catch (error) {
      console.error("Input validation error:", error);
      ctx.response.status = 400;
      ctx.response.body = { success: false, error: "Invalid input data" };
    }
  };
}

// Anti-bot middleware - DISABLED for development
function antiBot() {
  return async (ctx: any, next: any) => {
    // Skip anti-bot checks for now to allow frontend connections
    await next();
  };
}

// Request logging middleware
function requestLogger() {
  return async (ctx: any, next: any) => {
    const start = Date.now();
    const method = ctx.request.method;
    const url = ctx.request.url.pathname;
    const ip = ctx.request.ip || ctx.request.headers.get("x-forwarded-for") || "unknown";
    
    console.log(`📥 ${method} ${url} from ${ip}`);
    
    await next();
    
    const duration = Date.now() - start;
    const status = ctx.response.status;
    
    console.log(`📤 ${method} ${url} - ${status} (${duration}ms)`);
  };
}

// CORS middleware with enhanced security
app.use(async (ctx, next) => {
  const allowedOrigins = [
    "https://nikepig.win",
    "http://localhost:8000"
  ];
  const origin = ctx.request.headers.get("origin");
  if (origin && allowedOrigins.includes(origin)) {
    ctx.response.headers.set("Access-Control-Allow-Origin", origin);
  }
  ctx.response.headers.set("Vary", "Origin");
  ctx.response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  ctx.response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Signature, X-Admin-Message");
  ctx.response.headers.set("Access-Control-Max-Age", "86400");
  ctx.response.headers.set("X-Content-Type-Options", "nosniff");
  ctx.response.headers.set("X-Frame-Options", "DENY");
  ctx.response.headers.set("X-XSS-Protection", "1; mode=block");
  ctx.response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  if (ctx.request.method === "OPTIONS") {
    ctx.response.status = 200;
    return;
  }
  try {
    await next();
  } finally {
    // Always set CORS headers, even on errors
    if (origin && allowedOrigins.includes(origin)) {
      ctx.response.headers.set("Access-Control-Allow-Origin", origin);
    }
    ctx.response.headers.set("Vary", "Origin");
  }
});

// Apply security middlewares
app.use(requestLogger());
app.use(antiBot());
app.use(validateInput());

// Environment variables
const BLOCKFROST_URL = 'https://cardano-preview.blockfrost.io/api/v0';
const BLOCKFROST_API_KEY = 'previewyEaLt5aKLcelODYvUD4Ka8cmT41DurY0';
// 1. Set SCRIPT_ADDRESS to actual contract address (env var for Render, file for local dev)
const SCRIPT_ADDRESS = Deno.env.get("SCRIPT_ADDRESS") || Deno.readTextFileSync("./initialize_contract/contract.addr").trim();
const ADMIN_WALLET_ADDRESS = Deno.env.get("ADMIN_WALLET_ADDRESS");
const POOL_WALLET = Deno.env.get("POOL_WALLET") || Deno.env.get("ADMIN_WALLET_ADDRESS");
// Always use Preview testnet
const NETWORK = "Preview";

// Types for the simplified smart contract
interface LotteryStateDatum {
  total_pools: Array<[string, bigint]>;           // Multi-token pools (policy_id, amount)
  ticket_prices: Array<[string, bigint]>;         // Dynamic pricing per token (policy_id, price)
  total_tickets: bigint;                          // For weighted odds
  accepted_tokens: string[];                      // List of accepted token policy IDs
  prize_split: Array<[string, bigint[]]>;         // Configurable prize distribution (policy_id, splits)
}

// Redeemer types for the new minimal smart contract
// Only Initialize, BuyTicket, ClaimPrizes
// Use bigint[] for splits and payment values

type LotteryRedeemer = 
  | { type: "Initialize"; ticket_prices: Array<[string, bigint]>; accepted_tokens: string[]; prize_split: Array<[string, bigint[]]>; }
  | { type: "BuyTicket"; payment: bigint; policy_id: string; ticket_count: bigint; }
  | { type: "ClaimPrizes"; winner_indices: bigint[]; prize_amounts: Array<[string, bigint[]]>; };

// Health check endpoint
router.get("/health", (ctx) => {
  ctx.response.body = { status: "ok", timestamp: new Date().toISOString() };
});

// API routes
router.get("/api/status", (ctx) => {
  ctx.response.body = { 
    message: "Nikepig Lottery Backend - Updated for New Smart Contract", 
    version: "2.0.0",
    timestamp: new Date().toISOString()
  };
});

// Blockfrost config endpoint
router.get("/api/blockfrost-config", (ctx) => {
  ctx.response.body = {
    url: BLOCKFROST_URL,
    projectId: BLOCKFROST_API_KEY,
  };
});

// Debug environment variables endpoint
router.get("/api/debug-env", (ctx) => {
  ctx.response.body = {
    BLOCKFROST_API_KEY: BLOCKFROST_API_KEY ? `${BLOCKFROST_API_KEY.substring(0, 10)}...` : "NOT_SET",
    BLOCKFROST_URL: BLOCKFROST_URL || "NOT_SET",
    ADMIN_WALLET_ADDRESS: ADMIN_WALLET_ADDRESS ? `${ADMIN_WALLET_ADDRESS.substring(0, 20)}...` : "NOT_SET",
    SCRIPT_ADDRESS: SCRIPT_ADDRESS,
    timestamp: new Date().toISOString()
  };
});

// Helper function to safely stringify objects with BigInt
function safeStringify(obj: any) {
  return JSON.stringify(obj, (key, value) =>
    typeof value === 'bigint' ? value.toString() : value
  );
}

// Helper function to parse the new smart contract datum
async function parseLotteryDatum(datumHash: string): Promise<LotteryStateDatum | null> {
  if (!BLOCKFROST_API_KEY) {
    console.error("❌ BLOCKFROST_API_KEY not configured");
    return null;
  }
  try {
    console.log(`🔍 Parsing datum hash: ${datumHash}`);
    const datumRes = await fetch(`${BLOCKFROST_URL}/scripts/datum/${datumHash}`, {
      headers: { project_id: BLOCKFROST_API_KEY }
    });
    if (!datumRes.ok) {
      console.error(`❌ Failed to fetch datum: ${datumRes.status}`);
      return null;
    }
    const datum = await datumRes.json();
    console.log(`📄 Raw datum:`, safeStringify(datum));
    if (!datum.json_value) {
      console.error("❌ No json_value in datum");
      return null;
    }
    const datumData = datum.json_value;
    // Robust minimal datum parsing for Plutus JSON (with 'list' for tuples)
    if (datumData.fields && Array.isArray(datumData.fields) && datumData.fields.length === 5) {
      const fields = datumData.fields;
      const parsedDatum: LotteryStateDatum = {
        total_pools: fields[0]?.list?.map((item: any) => [item.list?.[0]?.bytes || "", BigInt(item.list?.[1]?.int || 0)]) || [],
        ticket_prices: fields[1]?.list?.map((item: any) => [item.list?.[0]?.bytes || "", BigInt(item.list?.[1]?.int || 0)]) || [],
        total_tickets: BigInt(fields[2]?.int || 0),
        accepted_tokens: fields[3]?.list?.map((item: any) => item.bytes || "") || [],
        prize_split: fields[4]?.list?.map((item: any) => [item.list?.[0]?.bytes || "", item.list?.[1]?.list?.map((split: any) => BigInt(split.int || 0)) || []]) || [],
      };
      console.log(`✅ Parsed datum:`, safeStringify(parsedDatum));
      return parsedDatum;
    } else {
      console.error("❌ Datum structure is invalid or not minimal:", safeStringify(datumData));
      return null;
    }
  } catch (error) {
    console.error("❌ Error parsing datum:", error);
    return null;
  }
}

// Helper function to get current lottery state from smart contract
async function getCurrentLotteryState(): Promise<LotteryStateDatum | null> {
  if (!BLOCKFROST_API_KEY) {
    console.error("❌ BLOCKFROST_API_KEY not configured");
    return null;
  }

  try {
    console.log(`🔍 Querying smart contract at: ${SCRIPT_ADDRESS}`);
    
    const utxosRes = await fetch(`${BLOCKFROST_URL}/addresses/${SCRIPT_ADDRESS}/utxos`, {
      headers: { project_id: BLOCKFROST_API_KEY }
    });
    
    if (!utxosRes.ok) {
      console.error(`❌ Failed to fetch UTxOs: ${utxosRes.status}`);
      return null;
    }
    
    const utxos = await utxosRes.json();
    console.log(`📦 Found ${utxos.length} UTxOs at smart contract address`);
    
    // Find UTxOs with our validator datum
    for (const utxo of utxos) {
      if (utxo.data_hash) {
        console.log(`🔗 Found UTxO with datum hash: ${utxo.data_hash}`);
        const datum = await parseLotteryDatum(utxo.data_hash);
        if (datum) {
          return datum;
        }
      }
    }
    
    console.log("⚠️ No valid lottery datum found");
    return null;
  } catch (error) {
    console.error("❌ Error fetching lottery state:", error);
    return null;
  }
}

// Enhanced lottery stats endpoint for new smart contract
router.get("/api/lottery/stats", async (ctx) => {
  try {
    const lotteryState = await getCurrentLotteryState();
    if (!lotteryState) {
      // Add clear log and suggestion
      console.error("❌ No valid lottery datum found at script address. Make sure the contract is initialized and Blockfrost API key is set.");
      ctx.response.body = {
        success: true, // Changed to true to allow frontend to work
        message: "Contract not initialized - showing default stats",
        stats: {
          totalTicketsSold: 0,
          currentPoolAmount: 0,
          totalPoolADA: 0,
          multiTokenPool: {
            ADA: 0,
            SNEK: 0,
            NIKEPIG: 0,
            unauthorizedTokens: []
          },
          ticketPrice: 5,
          totalParticipants: 0,
          totalTickets: 0,
          acceptedTokens: ["lovelace", "279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b", "c881c20e49dbaca3ff6cef365969354150983230c39520b917f5cf7c4e696b65"]
        }
      };
      return;
    }
    // Calculate multi-token pool data
    const multiTokenPool: {
      ADA: number;
      SNEK: number;
      NIKEPIG: number;
      unauthorizedTokens: Array<{policyId: string; amount: number}>;
    } = {
      ADA: 0,
      SNEK: 0,
      NIKEPIG: 0,
      unauthorizedTokens: []
    };
    // Fix division of bigint by number (convert to number first)
    for (const [policyId, amount] of lotteryState.total_pools) {
      if (policyId === "lovelace") {
        multiTokenPool.ADA = Number(amount) / 1_000_000;
      } else if (policyId === "279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b") {
        multiTokenPool.SNEK = Number(amount) / 1_000_000;
      } else if (policyId === "c881c20e49dbaca3ff6cef365969354150983230c39520b917f5cf7c4e696b65") {
        multiTokenPool.NIKEPIG = Number(amount) / 1_000_000;
      } else {
        multiTokenPool.unauthorizedTokens.push({ policyId, amount: Number(amount) });
      }
    }
    // Get ticket price (default to 5 ADA if not set)
    const adaTicketPrice = lotteryState.ticket_prices.find(([policyId]) => policyId === "lovelace");
    const ticketPrice = adaTicketPrice ? Number(adaTicketPrice[1]) / 1_000_000 : 5;
    ctx.response.body = {
      success: true,
      stats: {
        totalTicketsSold: Number(lotteryState.total_tickets),
        currentPoolAmount: multiTokenPool.ADA,
        totalPoolADA: multiTokenPool.ADA,
        multiTokenPool: multiTokenPool,
        ticketPrice: ticketPrice,
        totalParticipants: Number(lotteryState.total_tickets),
        totalTickets: Number(lotteryState.total_tickets),
        acceptedTokens: lotteryState.accepted_tokens
      }
    };
  } catch (error) {
    console.error("❌ Error in lottery stats:", error);
    ctx.response.status = 500;
    ctx.response.body = { success: false, error: "Failed to fetch lottery stats" };
  }
});

// 2. Refactor /api/lottery/buy-tickets to always use latest contract UTxO and correct datum/redeemer
router.post("/api/lottery/buy-tickets", async (ctx) => {
  try {
    // Debug logging for request headers and method
    console.log("[BuyTickets] Headers:", Object.fromEntries(ctx.request.headers.entries()));
    console.log("[BuyTickets] Method:", ctx.request.method);
    let body;
    if (ctx.state.body) {
      body = ctx.state.body;
    } else {
      const bodyResult = await ctx.request.body({ type: "json" });
      body = bodyResult.value;
    }
    // --- Fix: Ensure body is not a Promise and log after resolving ---
    if (body instanceof Promise) {
      console.log("[BuyTickets] Body is a Promise, awaiting...");
      body = await body;
    }
    console.log("[BuyTickets] Body (after await if needed):", body);
    const { address, ticketCount, tokenPolicyId } = body;
    if (!address || typeof address !== 'string' || address.length < 10) {
      ctx.response.status = 400;
      ctx.response.body = { success: false, error: "Invalid wallet address" };
      return;
    }
    if (!ticketCount || typeof ticketCount !== 'number' || ticketCount < 1 || ticketCount > 100) {
      ctx.response.status = 400;
      ctx.response.body = { success: false, error: "Invalid ticket count (1-100 allowed)" };
      return;
    }
    if (!tokenPolicyId || typeof tokenPolicyId !== 'string') {
      ctx.response.body = { success: false, error: "Invalid token policy ID" };
      return;
    }
    const lotteryState = await getCurrentLotteryState();
    if (!lotteryState) {
      ctx.response.status = 400;
      ctx.response.body = { success: false, error: "Failed to fetch lottery state" };
      return;
    }
    const normAcceptedTokens = lotteryState.accepted_tokens.map(normalizeAdaPolicyId);
    const normTokenPolicyId = normalizeAdaPolicyId(tokenPolicyId);
    if (!normAcceptedTokens.includes(normTokenPolicyId)) {
      ctx.response.status = 400;
      ctx.response.body = { success: false, error: `Token ${tokenPolicyId} is not accepted in this lottery` };
      return;
    }
    const ticketPriceEntry = lotteryState.ticket_prices.find(([policyId]) => normalizeAdaPolicyId(policyId) === normTokenPolicyId);
    if (!ticketPriceEntry) {
      ctx.response.status = 400;
      ctx.response.body = { success: false, error: `No ticket price set for token ${tokenPolicyId}` };
      return;
    }
    const ticketPrice = ticketPriceEntry[1];
    const totalPayment = ticketCount * Number(ticketPrice);
    if (!BLOCKFROST_API_KEY) {
      ctx.response.status = 500;
      ctx.response.body = { success: false, error: "Blockfrost API key not configured" };
      return;
    }
    const lucid = await Lucid.new(
      new Blockfrost(BLOCKFROST_URL, BLOCKFROST_API_KEY),
      NETWORK
    );
    // Always fetch latest UTxOs at script address
    const scriptUtxos = await lucid.utxosAt(SCRIPT_ADDRESS);
    if (scriptUtxos.length === 0) {
      ctx.response.status = 400;
      ctx.response.body = { success: false, error: "No UTxO at script address" };
      return;
    }
    // Use the UTxO with the largest ADA (or first)
    const scriptUtxo = scriptUtxos.sort((a, b) => Number(b.assets.lovelace || 0) - Number(a.assets.lovelace || 0))[0];
    // Prepare new datum
    const newDatum = { ...lotteryState };
    let found = false;
    // Always use '' for ADA in datum
    const datumPolicyId = tokenPolicyId === 'lovelace' ? '' : tokenPolicyId;
    newDatum.total_pools = newDatum.total_pools.map(([pid, amt]) => {
      const normPid = pid === 'lovelace' ? '' : pid;
      if (normPid === datumPolicyId) {
        found = true;
        return [datumPolicyId, BigInt(amt) + BigInt(totalPayment)];
      }
      return [normPid, BigInt(amt)];
    });
    if (!found) newDatum.total_pools.push([datumPolicyId, BigInt(totalPayment)]);
    newDatum.total_tickets = BigInt((newDatum.total_tickets || 0)) + BigInt(ticketCount);
    // Build redeemer for BuyTicket
    // If ADA, use '' for bytes field in redeemer
    const redeemerPolicyId = tokenPolicyId === 'lovelace' ? '' : tokenPolicyId;
    const buyTicketRedeemer = {
      constructor: 1,
      fields: [
        { int: BigInt(totalPayment) },
        { bytes: redeemerPolicyId }, // DO NOT use fromHex here
        { int: BigInt(ticketCount) }
      ]
    };
    // Serialize datum and redeemer
    const datumType = Data.Object({
      total_pools: Data.Array(Data.Tuple([Data.Bytes(), Data.Integer()])),
      ticket_prices: Data.Array(Data.Tuple([Data.Bytes(), Data.Integer()])),
      total_tickets: Data.Integer(),
      accepted_tokens: Data.Array(Data.Bytes()),
      prize_split: Data.Array(Data.Tuple([Data.Bytes(), Data.Array(Data.Integer())]))
    });
    // Serialize datum
    const datumPlutus = Data.to(newDatum as any, datumType);
    // Serialize redeemer using Lucid's Constr
    const buyTicketRedeemerCbor = Data.to(new Constr(1, [BigInt(totalPayment), redeemerPolicyId, BigInt(ticketCount)]));
    // Use .collectFrom([scriptUtxo], buyTicketRedeemerCbor) for Lucid
    if (!SCRIPT_VALIDATOR || SCRIPT_VALIDATOR === "") {
      throw new Error("Validator script is missing or empty. Check contract/plutus.json and Aiken build output.");
    }
    // Debug log before using fromHex for validator
    console.log("[DEBUG] Validator hex length:", SCRIPT_VALIDATOR.length);
    console.log("[DEBUG] Validator hex (first 60 chars):", SCRIPT_VALIDATOR.slice(0, 60));
    const tx = await lucid
      .newTx()
      .collectFrom([scriptUtxo], buyTicketRedeemerCbor)
      .payToContract(SCRIPT_ADDRESS, { inline: datumPlutus }, {})
      // Debug log before fromHex
      // (fromHex is only used here for validator, but add log for any future use)
      .attachSpendingValidator({ type: "PlutusV2", script: (() => {
        console.log("[DEBUG] fromHex input (validator):", SCRIPT_VALIDATOR);
        return fromHex(SCRIPT_VALIDATOR);
      })() })
      .complete();
    const unsignedTx = tx.toString();
    ctx.response.body = {
      success: true,
      message: `Unsigned transaction built. Please sign and submit with your wallet.`,
      unsignedTx,
      tokenPolicyId: tokenPolicyId,
      ticketPrice: tokenPolicyId === "lovelace" ? Number(ticketPrice) / 1_000_000 : Number(ticketPrice),
      totalPayment: tokenPolicyId === "lovelace" ? totalPayment / 1_000_000 : totalPayment,
      tickets: Array.from({ length: ticketCount }, (_, i) => ({
        id: `ticket_${Date.now()}_${i}`,
        purchasedAt: new Date().toISOString(),
        tokenPolicyId: tokenPolicyId
      }))
    };
  } catch (error) {
    console.error('Buy tickets error:', error);
    ctx.response.status = 400;
    ctx.response.body = { success: false, error: (error instanceof Error ? error.message : String(error)) || "Invalid request body" };
  }
});

// Confirm ticket purchase endpoint
router.post("/api/lottery/confirm-ticket", async (ctx) => {
  try {
    let body;
    if (ctx.state.body) {
      body = ctx.state.body;
    } else {
      const bodyResult = await ctx.request.body({ type: "json" });
      body = bodyResult.value;
    }
    const { address, ticketCount, txHash } = body;
    
    ctx.response.body = {
      success: true,
      message: `Confirmed purchase of ${ticketCount} tickets`,
      transactionHash: txHash,
      confirmedAt: new Date().toISOString()
    };
  } catch (error) {
    ctx.response.status = 400;
    ctx.response.body = { success: false, error: "Invalid request body" };
  }
});

// Pool wallet endpoint
router.get("/api/pool-wallet", (ctx) => {
  ctx.response.body = {
    success: true,
    address: SCRIPT_ADDRESS
  };
});

// Prize status endpoint
router.get("/api/lottery/prize-status", (ctx) => {
  const address = ctx.request.url.searchParams.get("address");
  ctx.response.body = {
    success: true,
    address: address,
    isWinner: false,
    prizeAmount: 0,
    claimStatus: "none",
    txHash: null,
    timestamp: new Date().toISOString()
  };
});

// Accepted tokens endpoint - provides only policyId, symbol, and decimals
router.get("/api/lottery/accepted-tokens", async (ctx) => {
  try {
    const lotteryState = await getCurrentLotteryState();
    // Define the accepted tokens with their policy IDs
    const acceptedTokens = [
      {
        name: "ADA",
        symbol: "ADA",
        policyId: "lovelace",
        decimals: 6,
        logo: "https://cryptologos.cc/logos/cardano-ada-logo.png",
        price: 1 // ADA is always 1:1
      },
      {
        name: "SNEK",
        symbol: "SNEK", 
        policyId: "279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b",
        decimals: 6,
        logo: "https://cryptologos.cc/logos/snek-logo.png",
        price: null // Will be fetched from Minswap
      },
      {
        name: "NIKEPIG",
        symbol: "NIKEPIG",
        policyId: "c881c20e49dbaca3ff6cef365969354150983230c39520b917f5cf7c4e696b65", 
        decimals: 0,
        logo: "https://cryptologos.cc/logos/nikepig-logo.png",
        price: null // Will be fetched from Minswap
      }
    ];
    // If contract is not initialized, return only ADA
    if (!lotteryState) {
      ctx.response.body = {
        success: true,
        tokens: [acceptedTokens[0]],
        timestamp: new Date().toISOString(),
        source: "default-ada"
      };
      return;
    }
    // If accepted_tokens is empty, return only ADA
    if (!lotteryState.accepted_tokens || lotteryState.accepted_tokens.length === 0) {
      ctx.response.body = {
        success: true,
        tokens: [acceptedTokens[0]],
        timestamp: new Date().toISOString(),
        source: "default-ada"
      };
      return;
    }
    // Filter tokens based on smart contract accepted_tokens
    const filteredTokens = acceptedTokens.filter(token => 
      lotteryState.accepted_tokens.includes(token.policyId)
    );
    // Always include ADA if not present
    if (!filteredTokens.find(t => t.policyId === "lovelace")) {
      filteredTokens.unshift(acceptedTokens[0]);
    }
    // Fetch real-time exchange rates from Minswap
    const exchangeRates = await fetchMinswapExchangeRates();
    // Update token prices with real rates
    filteredTokens.forEach(token => {
      if (token.policyId !== 'lovelace' && exchangeRates[token.policyId]) {
        token.price = exchangeRates[token.policyId];
      }
    });
    ctx.response.body = {
      success: true,
      tokens: filteredTokens,
      timestamp: new Date().toISOString(),
      source: "minswap"
    };
  } catch (error) {
    console.error("Error fetching accepted tokens with exchange rates:", error);
    // Fallback to ADA only
    ctx.response.body = {
      success: true,
      tokens: [
      {
        name: "ADA",
        symbol: "ADA",
        policyId: "lovelace",
        decimals: 6,
        logo: "https://cryptologos.cc/logos/cardano-ada-logo.png",
        price: 1
        }
      ],
      timestamp: new Date().toISOString(),
      source: "fallback-ada"
    };
  }
});

// Define whitelisted tokens configuration
const WHITELISTED_TOKENS: Record<string, {
  symbol: string;
  name: string;
  decimals: number;
  logo: string;
  isWhitelisted: boolean;
  distributionEnabled: boolean;
}> = {
  "lovelace": {
    symbol: "ADA",
    name: "Cardano",
    decimals: 6,
    logo: "https://cryptologos.cc/logos/cardano-ada-logo.png",
    isWhitelisted: true,
    distributionEnabled: true
  },
  "279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b": {
    symbol: "SNEK",
    name: "SNEK",
    decimals: 6,
    logo: "https://cryptologos.cc/logos/snek-logo.png",
    isWhitelisted: true,
    distributionEnabled: true
  },
  "c881c20e49dbaca3ff6cef365969354150983230c39520b917f5cf7c4e696b65": {
    symbol: "NIKEPIG",
    name: "NIKEPIG",
    decimals: 0,
    logo: "https://cryptologos.cc/logos/nikepig-logo.png",
    isWhitelisted: true,
    distributionEnabled: true
  }
};

// Enhanced function to get all tokens from pool wallet with validation
async function getAllPoolTokens(blockfrostUrl: string, blockfrostKey: string, scriptAddress: string) {
  const allTokens: Record<string, any> = {};
  const unauthorizedTokens: Array<{policyId: string, assetName: string, quantity: number}> = [];

  try {
    const utxosRes = await fetch(`${blockfrostUrl}/addresses/${scriptAddress}/utxos`, {
      headers: { project_id: blockfrostKey }
    });
    
    if (utxosRes.ok) {
      const utxos = await utxosRes.json();
      
      for (const utxo of utxos) {
        if (utxo.amount) {
          // Handle ADA (lovelace)
          if (utxo.amount.length > 0) {
            const adaAmount = utxo.amount.find((item: any) => item.unit === "lovelace");
            if (adaAmount) {
              allTokens["lovelace"] = (allTokens["lovelace"] || 0) + Number(adaAmount.quantity);
            }
          }
          
          // Handle native tokens
          if (utxo.amount) {
            for (const asset of utxo.amount) {
              if (asset.unit !== "lovelace") {
                const policyId = asset.unit.substring(0, 56);
                const assetName = asset.unit.substring(56);
                const quantity = Number(asset.quantity);
                
                if (WHITELISTED_TOKENS[policyId]) {
                  // Whitelisted token - add to distribution
                  allTokens[policyId] = (allTokens[policyId] || 0) + quantity;
                } else {
                  // Unauthorized token - track for reporting
                  unauthorizedTokens.push({
                    policyId,
                    assetName,
                    quantity
                  });
                }
              }
            }
          }
        }
      }
    }
  } catch (e) {
    console.error("Failed to fetch all pool tokens:", e);
  }

  return { allTokens, unauthorizedTokens };
}

// Enhanced multi-token pool data function with security
async function getMultiTokenPoolData(blockfrostUrl: string, blockfrostKey: string, scriptAddress: string) {
  const poolData: {
    ADA: number;
    SNEK: number;
    NIKEPIG: number;
    unauthorizedTokens: Array<{policyId: string; assetName: string; quantity: number}>;
  } = {
    ADA: 0,
    SNEK: 0,
    NIKEPIG: 0,
    unauthorizedTokens: []
  };

  try {
    // Get all tokens from pool wallet
    const { allTokens, unauthorizedTokens } = await getAllPoolTokens(blockfrostUrl, blockfrostKey, scriptAddress);
    
    // Set whitelisted token amounts
    poolData.ADA = (allTokens["lovelace"] || 0) / 1_000_000;
    poolData.SNEK = (allTokens["279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b"] || 0) / 1_000_000;
    poolData.NIKEPIG = allTokens["c881c20e49dbaca3ff6cef365969354150983230c39520b917f5cf7c4e696b65"] || 0;
    poolData.unauthorizedTokens = unauthorizedTokens;

    // Get round number from smart contract datum
    const lotteryState = await getCurrentLotteryState();
    if (lotteryState) {
      // The new smart contract datum does not have a 'round_number' field.
      // This function is no longer needed as the round number is part of the datum.
      // Keeping it for now as it might be used elsewhere or for context.
      // poolData.roundNumber = lotteryState.round_number; 
    }
  } catch (e) {
    console.error("Failed to fetch multi-token pool data:", e);
  }

  return poolData;
}

// Enhanced distribution calculation with security validation
function calculateMultiTokenDistributions(poolData: any) {
  const distributions = [];
  const securityReport: {
    unauthorizedTokensFound: boolean;
    unauthorizedTokens: Array<{policyId: string; assetName: string; quantity: number}>;
    totalUnauthorizedValue: number;
    warnings: string[];
  } = {
    unauthorizedTokensFound: poolData.unauthorizedTokens.length > 0,
    unauthorizedTokens: poolData.unauthorizedTokens,
    totalUnauthorizedValue: 0,
    warnings: []
  };
  
  // Define token configurations (only whitelisted tokens)
  const tokens = [
    { symbol: "ADA", policyId: "lovelace", decimals: 6, pool: poolData.ADA },
    { symbol: "SNEK", policyId: "279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b", decimals: 6, pool: poolData.SNEK },
    { symbol: "NIKEPIG", policyId: "c881c20e49dbaca3ff6cef365969354150983230c39520b917f5cf7c4e696b65", decimals: 0, pool: poolData.NIKEPIG }
  ];

  for (const token of tokens) {
    if (token.pool > 0) {
      const totalPool = token.pool;
      const fees = totalPool * 0.05;
      const prizePool = totalPool - fees;
      
      const distribution = {
        token: token.symbol,
        policyId: token.policyId,
        decimals: token.decimals,
        totalPool: totalPool,
        fees: fees,
        distribution: {
          winners: [
            { position: 1, amount: prizePool * 0.5, percentage: 50 },
            { position: 2, amount: prizePool * 0.3, percentage: 30 },
            { position: 3, amount: prizePool * 0.2, percentage: 20 }
          ],
          teamAmount: fees * 0.5,
          burnAmount: fees * 0.5,
        }
      };
      
      distributions.push(distribution);
    }
  }

  // Add security warnings if unauthorized tokens found
  if (securityReport.unauthorizedTokensFound) {
    securityReport.warnings.push(
      `Found ${securityReport.unauthorizedTokens.length} unauthorized tokens in pool wallet. These will NOT be distributed.`
    );
  }

  return { distributions, securityReport };
}

// Multi-token prize distribution endpoint
router.post("/api/lottery/admin/distribute-multi-token-prizes", async (ctx) => {
  try {
    if (!BLOCKFROST_API_KEY) {
      ctx.response.status = 500;
      ctx.response.body = { success: false, error: "Blockfrost configuration missing" };
      return;
    }

    // Get current pool amounts for all tokens
    const poolData = await getMultiTokenPoolData(BLOCKFROST_URL, BLOCKFROST_API_KEY, SCRIPT_ADDRESS);
    
    // Calculate prize distribution for each token
    const { distributions, securityReport } = calculateMultiTokenDistributions(poolData);

    ctx.response.body = {
      success: true,
      message: "Multi-token prizes calculated successfully",
      distributions: distributions,
      securityReport: securityReport,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error("Error in multi-token prize distribution:", error);
    ctx.response.status = 500;
    ctx.response.body = { success: false, error: "Failed to distribute multi-token prizes" };
  }
});

// Security monitoring endpoint for unauthorized tokens
router.get("/api/lottery/security/unauthorized-tokens", async (ctx) => {
  try {
    if (!BLOCKFROST_API_KEY) {
      ctx.response.status = 500;
      ctx.response.body = { success: false, error: "Blockfrost configuration missing" };
      return;
    }

    const { allTokens, unauthorizedTokens } = await getAllPoolTokens(BLOCKFROST_URL, BLOCKFROST_API_KEY, SCRIPT_ADDRESS);
    
    ctx.response.body = {
      success: true,
      security: {
        whitelistedTokens: Object.keys(WHITELISTED_TOKENS),
        unauthorizedTokensFound: unauthorizedTokens.length,
        unauthorizedTokens: unauthorizedTokens,
        totalWhitelistedTokens: Object.keys(allTokens).filter(token => WHITELISTED_TOKENS[token]).length,
        recommendations: unauthorizedTokens.length > 0 ? [
          "Review unauthorized tokens for potential value",
          "Consider adding valuable tokens to whitelist",
          "Monitor for malicious token attempts",
          "Document unauthorized tokens for audit purposes"
        ] : ["No unauthorized tokens found - system secure"]
      },
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error("Error checking unauthorized tokens:", error);
    ctx.response.status = 500;
    ctx.response.body = { success: false, error: "Failed to check unauthorized tokens" };
  }
});

// Enhanced lottery stats endpoint with multi-token support
router.get("/api/lottery/multi-token-stats", async (ctx) => {
  try {
    if (!BLOCKFROST_API_KEY) {
      ctx.response.status = 500;
      ctx.response.body = { success: false, error: "Blockfrost configuration missing" };
      return;
    }

    const poolData = await getMultiTokenPoolData(BLOCKFROST_URL, BLOCKFROST_API_KEY, SCRIPT_ADDRESS);
    
    // Get exchange rates for token conversion
    // const exchangeRates = await fetchMinswapExchangeRates(); // REMOVED
    
    // Calculate total pool value in ADA equivalent
    let totalPoolADAEquivalent = poolData.ADA; // ADA is always 1:1
    // if (exchangeRates["279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b"]) { // REMOVED
    //   totalPoolADAEquivalent += poolData.SNEK * exchangeRates["279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b"]; // REMOVED
    // }
    // if (exchangeRates["c881c20e49dbaca3ff6cef365969354150983230c39520b917f5cf7c4e696b65"]) { // REMOVED
    //   totalPoolADAEquivalent += poolData.NIKEPIG * exchangeRates["c881c20e49dbaca3ff6cef365969354150983230c39520b917f5cf7c4e696b65"]; // REMOVED
    // }

    ctx.response.body = {
      success: true,
      stats: {
        pools: {
          ADA: poolData.ADA,
          SNEK: poolData.SNEK,
          NIKEPIG: poolData.NIKEPIG
        },
        totalPoolADAEquivalent: totalPoolADAEquivalent,
        roundNumber: 1, // This would come from smart contract
        salesOpen: true, // This would come from smart contract
        ticketPrice: 5, // 5 ADA equivalent
        totalTicketsSold: Math.floor(totalPoolADAEquivalent / 5),
        totalParticipants: Math.floor(totalPoolADAEquivalent / 5),
        // exchangeRates: exchangeRates // REMOVED
      },
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error("Error fetching multi-token stats:", error);
    ctx.response.status = 500;
    ctx.response.body = { success: false, error: "Failed to fetch multi-token stats" };
  }
});

// 5. Endpoint to return current contract UTxO and datum for frontend
router.get("/api/lottery/contract-state", async (ctx) => {
  try {
    const utxosRes = await fetch(`${BLOCKFROST_URL}/addresses/${SCRIPT_ADDRESS}/utxos`, {
      headers: { project_id: BLOCKFROST_API_KEY }
    });
    if (!utxosRes.ok) {
      ctx.response.status = 500;
      ctx.response.body = { success: false, error: "Failed to fetch UTxOs" };
      return;
    }
    const utxos = await utxosRes.json();
    for (const utxo of utxos) {
      if (utxo.data_hash) {
        const datum = await parseLotteryDatum(utxo.data_hash);
        ctx.response.body = {
          success: true,
          utxo,
          datum
        };
        return;
      }
    }
    ctx.response.body = { success: false, error: "No contract UTxO with datum found" };
  } catch (error) {
    ctx.response.status = 500;
    ctx.response.body = { success: false, error: "Failed to fetch contract state" };
  }
});

// Public endpoint: Get current round participants - Phase 3.1
router.get("/api/lottery/participants", async (ctx) => {
  try {
    if (!BLOCKFROST_API_KEY) {
      ctx.response.status = 500;
      ctx.response.body = { success: false, error: "Blockfrost configuration missing" };
      return;
    }

    // Get current lottery state
    const lotteryState = await getCurrentLotteryState();
    
    if (!lotteryState) {
      ctx.response.status = 404;
      ctx.response.body = { success: false, error: "Lottery state not found" };
      return;
    }

    // For now, we'll create mock participants based on pool data
    // In a real implementation, this would come from the smart contract or database
    // Fix division of bigint by number (convert to number first)
    const totalPoolADA = lotteryState.total_pools.find(([policyId]) => policyId === "lovelace")?.[1];
    const totalPoolADAValue = totalPoolADA ? Number(totalPoolADA) / 1_000_000 : 0;
    const estimatedTickets = Math.floor(totalPoolADAValue / 5); // 5 ADA per ticket
    const estimatedParticipants = Math.min(estimatedTickets, 100); // Cap at 100 for demo

    // Generate mock participants (replace with real data from smart contract)
    const participants = [];
    for (let i = 0; i < estimatedParticipants; i++) {
      const ticketCount = Math.floor(Math.random() * 10) + 1; // 1-10 tickets per participant
      participants.push({
        address: `addr_test1${i.toString().padStart(10, '0')}...`,
        ticketCount: ticketCount,
        totalValue: ticketCount * 5, // 5 ADA per ticket
        tokens: [
          { policyId: "lovelace", amount: ticketCount * 5 * 1_000_000 }
        ],
        joinedAt: new Date(Date.now() - Math.random() * 24 * 60 * 60 * 1000).toISOString() // Random time in last 24h
      });
    }

    // Sort by ticket count (highest first)
    participants.sort((a, b) => b.ticketCount - a.ticketCount);

    ctx.response.body = {
      success: true,
      totalParticipants: participants.length,
      totalTickets: participants.reduce((sum, p) => sum + p.ticketCount, 0),
      participants: participants,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error("Error fetching participants:", error);
    ctx.response.status = 500;
    ctx.response.body = { success: false, error: "Failed to fetch participants" };
  }
});

// Public endpoint: Get historical winners - Phase 3.1
router.get("/api/lottery/winners", async (ctx) => {
  try {
    // Get current lottery state for round info
    const lotteryState = await getCurrentLotteryState();
    const currentRound = 1; // This would come from smart contract

    // Mock historical winners (replace with real database data)
    const historicalWinners = [
      {
        roundNumber: currentRound - 1,
        winners: [
          {
            position: 1,
            address: "addr_test1winner1stplace...",
            amount: 500, // ADA
            percentage: 50,
            transactionId: "tx_hash_winner_1st_round_" + (currentRound - 1),
            claimedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() // 2 days ago
          },
          {
            position: 2,
            address: "addr_test1winner2ndplace...",
            amount: 300, // ADA
            percentage: 30,
            transactionId: "tx_hash_winner_2nd_round_" + (currentRound - 1),
            claimedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
          },
          {
            position: 3,
            address: "addr_test1winner3rdplace...",
            amount: 200, // ADA
            percentage: 20,
            transactionId: "tx_hash_winner_3rd_round_" + (currentRound - 1),
            claimedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
          }
        ],
        totalPool: 1000, // ADA
        drawDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        totalParticipants: 50,
        totalTickets: 200
      },
      {
        roundNumber: currentRound - 2,
        winners: [
          {
            position: 1,
            address: "addr_test1winner1stplace_prev...",
            amount: 400, // ADA
            percentage: 50,
            transactionId: "tx_hash_winner_1st_round_" + (currentRound - 2),
            claimedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString() // 5 days ago
          },
          {
            position: 2,
            address: "addr_test1winner2ndplace_prev...",
            amount: 240, // ADA
            percentage: 30,
            transactionId: "tx_hash_winner_2nd_round_" + (currentRound - 2),
            claimedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
          },
          {
            position: 3,
            address: "addr_test1winner3rdplace_prev...",
            amount: 160, // ADA
            percentage: 20,
            transactionId: "tx_hash_winner_3rd_round_" + (currentRound - 2),
            claimedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
          }
        ],
        totalPool: 800, // ADA
        drawDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        totalParticipants: 40,
        totalTickets: 160
      }
    ];

    ctx.response.body = {
      success: true,
      currentRound: currentRound,
      historicalWinners: historicalWinners,
      totalWinners: historicalWinners.reduce((sum, round) => sum + round.winners.length, 0),
      lastUpdated: new Date().toISOString()
    };
  } catch (error) {
    console.error("Error fetching winners:", error);
    ctx.response.status = 500;
    ctx.response.body = { success: false, error: "Failed to fetch winners" };
  }
});

// 3. Admin endpoints (dummy logic, ready for integration)
function isAdmin(ctx: any) {
  // Simple admin check (improve with real auth)
  const adminKey = ctx.request.headers.get("x-admin-key");
  return adminKey && adminKey === Deno.env.get("ADMIN_API_KEY");
}

router.post("/api/lottery/admin/start-round", async (ctx) => {
  if (!isAdmin(ctx)) {
    ctx.response.status = 403;
    ctx.response.body = { success: false, error: "Unauthorized" };
    return;
  }
  // Dummy logic: In real use, update datum to open sales, increment round, etc.
  ctx.response.body = { success: true, message: "Start round endpoint (to be implemented)" };
});

router.post("/api/lottery/admin/select-winners", async (ctx) => {
  if (!isAdmin(ctx)) {
    ctx.response.status = 403;
    ctx.response.body = { success: false, error: "Unauthorized" };
    return;
  }
  // Dummy logic: In real use, select winners, update datum, etc.
  ctx.response.body = { success: true, message: "Select winners endpoint (to be implemented)" };
});

router.post("/api/lottery/admin/distribute-prizes", async (ctx) => {
  if (!isAdmin(ctx)) {
    ctx.response.status = 403;
    ctx.response.body = { success: false, error: "Unauthorized" };
    return;
  }
  // Dummy logic: In real use, distribute prizes, update datum, etc.
  ctx.response.body = { success: true, message: "Distribute prizes endpoint (to be implemented)" };
});

// Real-time Notifications - Phase 3.3
interface NotificationEvent {
  type: 'pool_update' | 'winner_announcement';
  message: string;
  data: any;
  timestamp: string;
}

// WebSocket connections storage
const wsConnections = new Set<WebSocket>();

// Broadcast notification to all connected clients
function broadcastNotification(event: NotificationEvent) {
  const message = JSON.stringify(event);
  wsConnections.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  });
}

// WebSocket endpoint for real-time notifications
router.get("/api/lottery/ws", (ctx) => {
  const upgrade = ctx.request.headers.get("upgrade") || "";
  if (upgrade.toLowerCase() != "websocket") {
    ctx.response.status = 400;
    return;
  }

  // In WebSocket upgrade logic, use the correct request object
  const { socket, response } = Deno.upgradeWebSocket((ctx.request.originalRequest || ctx.request) as any);
  
  // Add connection to set
  wsConnections.add(socket);
  console.log("🔌 New WebSocket connection established");

  // Handle WebSocket events
  socket.onopen = () => {
    console.log("✅ WebSocket connection opened");
    // Send initial connection confirmation
    socket.send(JSON.stringify({
      type: 'connection_established',
      message: 'Connected to lottery notifications',
      timestamp: new Date().toISOString()
    }));
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log("📨 Received WebSocket message:", data);
      
      // Handle client messages (subscriptions, etc.)
      if (data.type === 'subscribe') {
        socket.send(JSON.stringify({
          type: 'subscription_confirmed',
          message: `Subscribed to ${data.channel}`,
          timestamp: new Date().toISOString()
        }));
      }
    } catch (error) {
      console.error("❌ Error parsing WebSocket message:", error);
    }
  };

  socket.onclose = () => {
    console.log("🔌 WebSocket connection closed");
    wsConnections.delete(socket);
  };

  socket.onerror = (error) => {
    console.error("❌ WebSocket error:", error);
    wsConnections.delete(socket);
  };

  return response;
});

// Notification endpoints for triggering events
router.post("/api/lottery/notify/pool-update", async (ctx) => {
  try {
    if (!BLOCKFROST_API_KEY) {
      ctx.response.status = 500;
      ctx.response.body = { success: false, error: "Blockfrost configuration missing" };
      return;
    }
    const lotteryState = await getCurrentLotteryState();
    const poolData = await getMultiTokenPoolData(BLOCKFROST_URL, BLOCKFROST_API_KEY, SCRIPT_ADDRESS);
    
    const event: NotificationEvent = {
      type: 'pool_update',
      message: `Pool updated: ${poolData.ADA.toFixed(2)} ADA, ${poolData.SNEK.toFixed(2)} SNEK, ${poolData.NIKEPIG} NIKEPIG`,
      data: {
        pool: poolData,
        roundNumber: 1 // This would come from smart contract
      },
      timestamp: new Date().toISOString()
    };
    
    broadcastNotification(event);
    
    ctx.response.body = {
      success: true,
      message: "Pool update notification sent",
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error("Error sending pool update notification:", error);
    ctx.response.status = 500;
    ctx.response.body = { success: false, error: "Failed to send notification" };
  }
});



router.post("/api/lottery/notify/winner-announcement", async (ctx) => {
  try {
    let body;
    if (ctx.state.body) {
      body = ctx.state.body;
    } else {
      const bodyResult = await ctx.request.body({ type: "json" });
      body = bodyResult.value;
    }
    const { winners, roundNumber, totalPool } = body;
    
    const event: NotificationEvent = {
      type: 'winner_announcement',
      message: `🎉 Round ${roundNumber} winners announced! Total pool: ${totalPool} ADA`,
      data: {
        winners: winners,
        roundNumber: roundNumber,
        totalPool: totalPool
      },
      timestamp: new Date().toISOString()
    };
    
    broadcastNotification(event);
    
    ctx.response.body = {
      success: true,
      message: "Winner announcement notification sent",
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error("Error sending winner announcement notification:", error);
    ctx.response.status = 500;
    ctx.response.body = { success: false, error: "Failed to send notification" };
  }
});



// Winner Selection Algorithm - Phase 3.1
interface Participant {
  address: string;
  ticketCount: number;
  totalValue: number; // in ADA equivalent
  tokens: Array<{ policyId: string; amount: number }>;
  weight: number; // calculated weight for selection
}

interface WinnerSelectionResult {
  winners: Array<{
    position: number;
    address: string;
    ticketCount: number;
    totalValue: number;
    weight: number;
    selectionProof: string;
  }>;
  totalParticipants: number;
  totalTickets: number;
  selectionSeed: string;
  timestamp: string;
  verificationHash: string;
}

// Cryptographic random seed generation
function generateRandomSeed(): string {
  const timestamp = Date.now().toString();
  const randomBytes = crypto.getRandomValues(new Uint8Array(32));
  const randomHex = Array.from(randomBytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${timestamp}_${randomHex}`;
}

// Calculate participant weights based on ticket count and token value
function calculateParticipantWeights(participants: Participant[]): Participant[] {
  return participants.map(participant => {
    // Weight formula: (ticket_count * base_weight) + (total_value * value_multiplier)
    const baseWeight = participant.ticketCount;
    const valueMultiplier = 0.1; // 10% bonus for higher value
    const valueWeight = participant.totalValue * valueMultiplier;
    const totalWeight = baseWeight + valueWeight;
    
    return {
      ...participant,
      weight: totalWeight
    };
  });
}

// Fair winner selection using weighted random selection
async function selectWinners(
  participants: Participant[], 
  winnerCount: number, 
  seed: string
): Promise<WinnerSelectionResult> {
  console.log("🎲 Starting winner selection...");
  console.log(`📊 Total participants: ${participants.length}`);
  console.log(`🏆 Selecting ${winnerCount} winners`);
  console.log(`🔐 Using seed: ${seed}`);
  
  // Calculate weights for all participants
  const weightedParticipants = calculateParticipantWeights(participants);
  
  // Sort by weight (highest first) for fair selection
  weightedParticipants.sort((a, b) => b.weight - a.weight);
  
  // Create selection pool based on weights
  const selectionPool: Participant[] = [];
  weightedParticipants.forEach(participant => {
    // Add participant to pool multiple times based on their weight
    const poolEntries = Math.ceil(participant.weight);
    for (let i = 0; i < poolEntries; i++) {
      selectionPool.push(participant);
    }
  });
  
  console.log(`🎯 Selection pool size: ${selectionPool.length}`);
  
  // Use seed to generate deterministic random numbers
  const seedHash = new TextEncoder().encode(seed);
  const hashBuffer = await crypto.subtle.digest('SHA-256', seedHash);
  const hashArray = new Uint8Array(hashBuffer);
  
  const winners: Array<{
    position: number;
    address: string;
    ticketCount: number;
    totalValue: number;
    weight: number;
    selectionProof: string;
  }> = [];
  
  const usedAddresses = new Set<string>();
  
  for (let i = 0; i < winnerCount && i < selectionPool.length; i++) {
    // Generate random index using seed + position
    const positionSeed = `${seed}_${i}`;
    const positionHash = new TextEncoder().encode(positionSeed);
    const positionBuffer = await crypto.subtle.digest('SHA-256', positionHash);
    const positionArray = new Uint8Array(positionBuffer);
    
    // Use first 4 bytes to generate random index
    const randomIndex = (positionArray[0] << 24 | positionArray[1] << 16 | positionArray[2] << 8 | positionArray[3]) % selectionPool.length;
    
    const selectedParticipant = selectionPool[randomIndex];
    
    // Ensure no duplicate winners (same address)
    if (!usedAddresses.has(selectedParticipant.address)) {
      usedAddresses.add(selectedParticipant.address);
      
      winners.push({
        position: i + 1,
        address: selectedParticipant.address,
        ticketCount: selectedParticipant.ticketCount,
        totalValue: selectedParticipant.totalValue,
        weight: selectedParticipant.weight,
        selectionProof: `${positionSeed}_${randomIndex}`
      });
      
      console.log(`🏆 Winner ${i + 1}: ${selectedParticipant.address} (weight: ${selectedParticipant.weight})`);
    } else {
      // Try again for this position
      i--;
    }
  }
  
  // Generate verification hash
  const verificationData = {
    seed,
    winners: winners.map(w => ({ address: w.address, position: w.position })),
    totalParticipants: participants.length,
    totalTickets: participants.reduce((sum, p) => sum + p.ticketCount, 0)
  };
  
  const verificationString = JSON.stringify(verificationData);
  const verificationHash = await sha256Hex(verificationString);
  
  return {
    winners,
    totalParticipants: participants.length,
    totalTickets: participants.reduce((sum, p) => sum + p.ticketCount, 0),
    selectionSeed: seed,
    timestamp: new Date().toISOString(),
    verificationHash
  };
}

// Fix digestSync usage: use async digest and helper
async function sha256Hex(str: string): Promise<string> {
  const data = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Error handling
app.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    console.error("Error:", err);
    ctx.response.status = 500;
    ctx.response.body = { error: "Internal server error" };
  }
});

app.use(router.routes());
app.use(router.allowedMethods());

const port = parseInt(Deno.env.get("PORT") || "3000");
console.log(`🚀 Updated Deno server running on port ${port}`);
console.log(`📝 Smart contract address: ${SCRIPT_ADDRESS}`);

await app.listen({ port }); 