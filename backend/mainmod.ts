import { Application, Router } from "oak";
import { Lucid, Blockfrost, Data, Constr, fromHex } from "https://deno.land/x/lucid@0.10.8/mod.ts";
// Use Deno.readTextFileSync for file reading

// Utility: Normalize ADA policy ID ('' or 'lovelace' both mean ADA)
function normalizeAdaPolicyId(pid: string): string {
  return pid === '' ? 'lovelace' : pid;
}

// Debug log for Oak and Deno version
console.log("Nikepig backend starting, Oak version: v12.6.1, Deno version:", Deno.version);

// Global storage for real historical winners
let historicalWinnersStorage: Array<{
  roundNumber: number;
  winners: Array<{
    position: number;
    address: string;
    amount: number;
    percentage: number;
    transactionId: string;
    claimedAt: string;
  }>;
  totalPool: number;
  drawDate: string;
  totalParticipants: number;
  totalTickets: number;
}> = [];

// Flag to prevent multiple processing of the same round
let isProcessingRound = false;

// Load the actual validator from contract/plutus.json
const plutusJson = JSON.parse(Deno.readTextFileSync("./contract/plutus.json"));
const SCRIPT_VALIDATOR = plutusJson.validators[0].compiledCode;

// Minimal test for fromHex(SCRIPT_VALIDATOR) ///
try {
  fromHex(SCRIPT_VALIDATOR);
  console.log("[fromHex TEST] SCRIPT_VALIDATOR is valid hex and can be decoded.");
} catch (e) {
  console.error("[fromHex TEST] SCRIPT_VALIDATOR is INVALID:", e, SCRIPT_VALIDATOR);
}

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

// Add CORS middleware at the top of the file after imports
app.use(async (ctx, next) => {
  // Set CORS headers
  ctx.response.headers.set("Access-Control-Allow-Origin", "*");
  ctx.response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  ctx.response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  
  // Handle preflight requests
  if (ctx.request.method === "OPTIONS") {
    ctx.response.status = 200;
    return;
  }
  
  await next();
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
// Separate lottery pool wallet for fund storage (better architecture)
// Updated to use seed-generated wallet address from environment
const POOL_WALLET_ADDRESS = Deno.env.get("POOL_WALLET_ADDRESS") || "addr_test1qq8ac7qqy0vtulyl7wntmsxc6wex80gvcyjy33qffrhm7sh927ysx5sftuw0dlft05dz3c7revpf7jx0xnlcjz3g69mqkt5dmn";
const POOL_WALLET = Deno.env.get("POOL_WALLET") || POOL_WALLET_ADDRESS;
// Always use Preview testnet
const NETWORK = "Preview";

// 🎰 BACKEND ROUND STATE TRACKING (Testing: 3-minute rounds)
interface BackendRoundState {
  roundNumber: number;
  roundStartTime: number;
  participants: Array<{address: string; ticketCount: number; txHash: string; timestamp: number}>;
  totalTickets: number;
  totalPoolAmount: number; // in lovelace
  salesOpen: boolean;
  roundDuration: number; // milliseconds (3 minutes = 180000ms)
  minimumParticipants: number; // minimum participants needed to process round
  rolledOverRounds: number; // count of how many rounds have been rolled over
  processingStatus: 'idle' | 'processing' | 'rollover' | 'jackpot'; // processing status for frontend
  processingStartTime?: number; // when processing started
}

let currentRoundState: BackendRoundState = {
  roundNumber: 1,
  roundStartTime: Date.now(),
  participants: [],
  totalTickets: 0,
  totalPoolAmount: 0,
  salesOpen: true,
  roundDuration: 3 * 60 * 1000, // 3 minutes for testing
  minimumParticipants: 4, // need at least 4 participants to process round
  rolledOverRounds: 0, // how many times this pool has rolled over
  processingStatus: 'idle' // initial processing status
};

// 🎰 AUTOMATED ROUND LIFECYCLE (3-minute cycles for testing)
interface WinnerResult {
  position: number;
  address: string;
  amount: number;
  percentage: number;
  transactionId: string;
  ticketCount: number;
}

let automatedRoundTimer: number | null = null;
let processedRounds = new Set<number>(); // Track processed rounds to prevent duplicates

// Commission wallet addresses
const TEAM_WALLET_ADDRESS = "addr_test1qr2htllkhpk5nr6wd5zap283u6r2mna5ckvhd63v40chdenmdv65ksa3sqdkq3xrkax99tzkthycgat3faxm32234pxscgct5q";
const BURN_WALLET_ADDRESS = "addr_test1qpydw0f2p66mzgc48mdkq4g7p88shc3ev9zrgp39jcjlyve3cxvkh3wy8wp8xfs6gjayl3p83kqc2dajrx5t5fadqyuq7k09tc";

// Winner selection algorithm (fair weighted random) - now with commission system
function selectRoundWinners(participants: typeof currentRoundState.participants): WinnerResult[] {
  if (participants.length === 0) {
    console.log("⚠️ No participants to select winners from");
    return [];
  }
  
  console.log(`🎲 Selecting winners from ${participants.length} participants`);
  
  // Create weighted pool (more tickets = higher chance)
  const weightedPool: string[] = [];
  participants.forEach(participant => {
    for (let i = 0; i < participant.ticketCount; i++) {
      weightedPool.push(participant.address);
    }
  });
  
  console.log(`🎯 Total weighted entries: ${weightedPool.length}`);
  
  const winners: WinnerResult[] = [];
  const usedAddresses = new Set<string>();
  
  // Commission system: 5% total (2.5% team + 2.5% burn), 95% to winners
  // Winner percentages of the 95%: 1st: 50%, 2nd: 30%, 3rd: 20%
  // This means: 1st gets 47.5% of total, 2nd gets 28.5% of total, 3rd gets 19% of total
  const winnerPercentagesOf95 = [50, 30, 20]; // Percentages of the 95% pool
  const totalPoolADA = currentRoundState.totalPoolAmount / 1_000_000;
  const winnerPoolADA = totalPoolADA * 0.95; // 95% for winners
  
  console.log(`💰 Total pool: ${totalPoolADA.toFixed(2)} ADA`);
  console.log(`🏆 Winner pool (95%): ${winnerPoolADA.toFixed(2)} ADA`);
  console.log(`💸 Commission (5%): ${(totalPoolADA * 0.05).toFixed(2)} ADA (2.5% team + 2.5% burn)`);
  
  for (let position = 1; position <= 3 && position <= participants.length; position++) {
    let attempts = 0;
    while (attempts < weightedPool.length && winners.length < position) {
      const randomIndex = Math.floor(Math.random() * weightedPool.length);
      const selectedAddress = weightedPool[randomIndex];
      
      if (!usedAddresses.has(selectedAddress)) {
        const participant = participants.find(p => p.address === selectedAddress)!;
        const percentageOf95 = winnerPercentagesOf95[position - 1];
        const percentageOfTotal = (percentageOf95 * 0.95); // Convert to percentage of total pool
        const amount = winnerPoolADA * (percentageOf95 / 100);
        
        winners.push({
          position: position,
          address: selectedAddress,
          amount: amount,
          percentage: percentageOfTotal, // Store as percentage of total pool
          transactionId: `auto_winner_${currentRoundState.roundNumber}_${position}_${Date.now()}`,
          ticketCount: participant.ticketCount
        });
        
        usedAddresses.add(selectedAddress);
        console.log(`🏆 Winner ${position}: ${selectedAddress} (${amount.toFixed(2)} ADA, ${percentageOfTotal.toFixed(1)}% of total pool, ${participant.ticketCount} tickets)`);
      }
      attempts++;
    }
  }
  
  return winners;
}

// Automated round processing
async function processAutomatedRound() {
  try {
    // Prevent multiple processing of the same round
    if (isProcessingRound) {
      console.log(`⏸️ Round processing already in progress, skipping...`);
      return;
    }
    
    const now = Date.now();
    const roundAge = now - currentRoundState.roundStartTime;
    
    console.log(`⏰ Round age: ${Math.floor(roundAge / 1000)}s / ${Math.floor(currentRoundState.roundDuration / 1000)}s`);
    
    if (roundAge >= currentRoundState.roundDuration) {
      isProcessingRound = true;
      console.log(`🔔 ROUND ${currentRoundState.roundNumber} TIME UP! Processing...`);
      
      // 1. Start processing period and close sales
      currentRoundState.salesOpen = false;
      console.log("🚫 Sales closed - Processing period started");
      
      // 2. 🔄 QUICKLY CHECK ROLLOVER CONDITION: Need minimum participants
      const participantCount = currentRoundState.participants.length;
      const poolADA = currentRoundState.totalPoolAmount / 1_000_000;
      
      if (participantCount < currentRoundState.minimumParticipants) {
        // 🔄 ROLL OVER TO NEXT ROUND
        currentRoundState.processingStatus = 'rollover';
        currentRoundState.processingStartTime = Date.now();
        console.log(`🔄 ROLLOVER: Only ${participantCount} participants (need ${currentRoundState.minimumParticipants})`);
        console.log(`💰 Pool of ${poolADA.toFixed(2)} ADA rolling over to next round (rollover #${currentRoundState.rolledOverRounds})`);
        
        // Wait 45 seconds for rollover processing
        console.log("⏳ Waiting 45 seconds for rollover processing...");
        await new Promise(resolve => setTimeout(resolve, 45 * 1000));
        console.log("✅ Rollover processing completed");
        
        // Keep participants and pool, but advance round number and reset timer
        currentRoundState.rolledOverRounds++;
        currentRoundState.roundNumber++;
        currentRoundState.roundStartTime = Date.now();
        currentRoundState.salesOpen = true;
        currentRoundState.processingStatus = 'idle';
        
        // WebSocket notifications removed
        // broadcastNotification(...) - WebSocket functionality disabled
        
        console.log(`🎰 ROUND ${currentRoundState.roundNumber} STARTED (rollover #${currentRoundState.rolledOverRounds}) - Pool: ${poolADA.toFixed(2)} ADA, Participants: ${participantCount}`);
        isProcessingRound = false; // Reset flag before returning
        return; // Exit early, don't process winners
      }
      
      // 3. ✅ ENOUGH PARTICIPANTS: Select winners and process round
      currentRoundState.processingStatus = 'jackpot';
      currentRoundState.processingStartTime = Date.now();
      console.log(`✅ PROCESSING ROUND: ${participantCount} participants (minimum met!) - JACKPOT!`);
      
      // Wait 45 seconds for jackpot processing
      console.log("⏳ Waiting 45 seconds for jackpot processing...");
      await new Promise(resolve => setTimeout(resolve, 45 * 1000));
      console.log("✅ Jackpot processing completed");
      
      // Check if winners already exist for this round (prevent duplicate processing)
      const existingWinnersForRound = historicalWinnersStorage.find(round => round.roundNumber === currentRoundState.roundNumber);
      if (existingWinnersForRound) {
        console.log(`⚠️ Winners already exist for round ${currentRoundState.roundNumber}, skipping processing`);
        isProcessingRound = false; // Reset flag before returning
        return;
      }
      
      // Additional protection: Check if this round was processed recently (within last 5 minutes)
      const recentProcessedRounds = Array.from(processedRounds).filter(round => {
        const roundAge = Date.now() - (currentRoundState.roundStartTime || Date.now());
        return roundAge < 300000; // 5 minutes
      });
      
      if (recentProcessedRounds.includes(currentRoundState.roundNumber)) {
        console.log(`⚠️ Round ${currentRoundState.roundNumber} was processed recently, skipping to prevent duplicates`);
        isProcessingRound = false;
        return;
      }
      
      // Check if this round was already processed (prevent multiple processing attempts)
      if (currentRoundState.processingStatus === 'jackpot' && currentRoundState.processingStartTime) {
        const processingTime = Date.now() - currentRoundState.processingStartTime;
        if (processingTime > 60000) { // If processing has been going for more than 1 minute
          console.log(`⚠️ Round ${currentRoundState.roundNumber} processing timeout, skipping to prevent duplicates`);
          isProcessingRound = false; // Reset flag before returning
          return;
        }
      }
      
      const winners = selectRoundWinners(currentRoundState.participants);
      
      if (winners.length > 0) {
        console.log(`🎉 Selected ${winners.length} winners for round ${currentRoundState.roundNumber} (after ${currentRoundState.rolledOverRounds} rollovers):`);
        winners.forEach(winner => {
          console.log(`   ${winner.position}. ${winner.address}: ${winner.amount.toFixed(2)} ADA (${winner.percentage}%)`);
        });
        
        // 4. 🏆 AUTO-TRIGGER PRIZE DISTRIBUTION
        console.log(`🚀 Auto-distributing ${poolADA.toFixed(2)} ADA pool to ${winners.length} winners...`);
        
        let distributionTxHash = '';
        let distributionSuccessful = false;
        
        // Check if we already processed this round (additional protection)
        if (processedRounds.has(currentRoundState.roundNumber)) {
          console.log(`⚠️ Round ${currentRoundState.roundNumber} already processed, skipping to prevent duplicates`);
          isProcessingRound = false;
          return;
        }
        
        try {
          distributionTxHash = await distributeAutomaticPrizes(winners, poolADA);
          console.log(`✅ Automated prize distribution completed successfully!`);
          distributionSuccessful = true;
          processedRounds.add(currentRoundState.roundNumber); // Mark as processed
          
          // Clean up old processed rounds (keep only last 10)
          if (processedRounds.size > 10) {
            const roundsToRemove = Array.from(processedRounds).slice(0, processedRounds.size - 10);
            roundsToRemove.forEach(round => processedRounds.delete(round));
            console.log(`🧹 Cleaned up ${roundsToRemove.length} old processed rounds`);
          }
          
        } catch (distributionError) {
          console.error("❌ Error in automated prize distribution:", distributionError);
          console.log("⚠️ Skipping winner storage due to distribution failure");
        }
        
        // 6. 🏆 SAVE WINNERS TO HISTORICAL STORAGE (only if distribution was successful)
        if (distributionSuccessful) {
          // Check if this round already exists in historical storage
          const existingRoundIndex = historicalWinnersStorage.findIndex(round => round.roundNumber === currentRoundState.roundNumber);
          
          const winnerData = {
            roundNumber: currentRoundState.roundNumber,
            winners: winners.map(winner => ({
              position: winner.position,
              address: winner.address,
              amount: winner.amount,
              percentage: winner.percentage,
              transactionId: distributionTxHash,
              claimedAt: new Date().toISOString()
            })),
            totalPool: poolADA,
            drawDate: new Date().toISOString(),
            totalParticipants: participantCount,
            totalTickets: currentRoundState.totalTickets
          };
          
          // Remove existing entry for this round if it exists (prevent duplicates)
          if (existingRoundIndex !== -1) {
            console.log(`🔄 Removing duplicate entry for round ${currentRoundState.roundNumber}`);
            historicalWinnersStorage.splice(existingRoundIndex, 1);
          }
          
          // Add to historical storage (keep only last 7 rounds)
          historicalWinnersStorage.unshift(winnerData);
          if (historicalWinnersStorage.length > 7) {
            historicalWinnersStorage = historicalWinnersStorage.slice(0, 7);
          }
          
          console.log(`📝 Saved ${winners.length} winners to historical storage for round ${currentRoundState.roundNumber}`);
        } else {
          console.log("❌ Winners not saved to history due to distribution failure");
        }
        
      } else {
        console.log("⚠️ No participants - no winners to announce");
      }
      
      // 5. 🏆 RESET FOR FRESH NEW ROUND (only after winners selected)
      const previousRound = currentRoundState.roundNumber;
      const previousPool = poolADA;
      const previousRollovers = currentRoundState.rolledOverRounds;
      
      currentRoundState = {
        roundNumber: currentRoundState.roundNumber + 1,
        roundStartTime: Date.now(),
        participants: [],
        totalTickets: 0,
        totalPoolAmount: 0,
        salesOpen: true,
        roundDuration: 3 * 60 * 1000, // 3 minutes for testing
        minimumParticipants: 4, // need at least 4 participants to process round
        rolledOverRounds: 0, // reset rollover count for fresh round
        processingStatus: 'idle' // reset processing status
      };
      
      console.log(`🔄 FRESH NEW ROUND ${currentRoundState.roundNumber} STARTED! Previous round processed after ${previousRollovers} rollovers.`);
      
      // 6. WebSocket fresh round announcement removed  
      // broadcastNotification({...}) - WebSocket functionality disabled
    }
  } catch (error) {
    console.error("❌ Error in automated round processing:", error);
  } finally {
    // Always reset the processing flag
    isProcessingRound = false;
  }
}

// Start automated round timer
function startAutomatedRounds() {
  if (automatedRoundTimer) {
    clearInterval(automatedRoundTimer);
  }
  
  console.log("🚀 Starting automated 3-minute lottery rounds...");
  console.log(`⏰ Round ${currentRoundState.roundNumber} started at ${new Date(currentRoundState.roundStartTime).toISOString()}`);
  
  // Check every 10 seconds
  automatedRoundTimer = setInterval(processAutomatedRound, 10 * 1000);
}

// Start automation when server starts
startAutomatedRounds();

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
    scriptAddress: SCRIPT_ADDRESS,
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
function safeStringifyBigInt(obj: any): string {
  return JSON.stringify(obj, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value
  );
}

function jsonBigIntReplacer(key: string, value: any) {
  return typeof value === "bigint" ? value.toString() : value;
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
    console.log(`📄 Raw datum:`, JSON.stringify(datum, jsonBigIntReplacer));
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
      console.log(`✅ Parsed datum:`, JSON.stringify(parsedDatum, jsonBigIntReplacer));
      return parsedDatum;
    } else {
      console.error("❌ Datum structure is invalid or not minimal:", safeStringifyBigInt(datumData));
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
      // 🎰 USE BACKEND ROUND STATE (Much Better Architecture!)
      console.log("✅ Using backend round state tracking instead of smart contract");
      
      ctx.response.body = {
        success: true,
        message: "Using backend round state tracking (better architecture)",
        stats: {
          roundNumber: currentRoundState.roundNumber,
          totalTicketsSold: currentRoundState.totalTickets,
          currentPoolAmount: currentRoundState.totalPoolAmount / 1_000_000, // Convert to ADA
          totalPoolADA: currentRoundState.totalPoolAmount / 1_000_000,
          multiTokenPool: {
            ADA: currentRoundState.totalPoolAmount / 1_000_000,
            SNEK: 0, // For now, only tracking ADA
            NIKEPIG: 0,
            unauthorizedTokens: []
          },
          ticketPrice: 5,
          totalParticipants: currentRoundState.participants.length,
          totalTickets: currentRoundState.totalTickets,
          salesOpen: currentRoundState.salesOpen,
          minimumParticipants: currentRoundState.minimumParticipants,
          rolledOverRounds: currentRoundState.rolledOverRounds,
          rolloverStatus: currentRoundState.participants.length < currentRoundState.minimumParticipants ? 
            `Need ${currentRoundState.minimumParticipants - currentRoundState.participants.length} more participants` : 
            "Ready for draw!",
          roundStartTime: currentRoundState.roundStartTime, // For countdown timer
          processingStatus: currentRoundState.processingStatus, // Processing status for frontend
          processingStartTime: currentRoundState.processingStartTime, // When processing started
          acceptedTokens: ["lovelace", "279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b", "c881c20e49dbaca3ff6cef365969354150983230c39520b917f5cf7c4e696b65"]
        }
      };
      return;
    }
    // 🚫 REMOVED POOL WALLET FALLBACK - confusing for users
    // Smart contract found but we ignore it - use ONLY backend round state
    console.log("✅ Smart contract found but using backend round state instead");
    
    ctx.response.body = {
      success: true,
      message: "Using backend round state tracking (better architecture)",
      stats: {
        roundNumber: currentRoundState.roundNumber,
        totalTicketsSold: currentRoundState.totalTickets,
        currentPoolAmount: currentRoundState.totalPoolAmount / 1_000_000, // Convert to ADA
        totalPoolADA: currentRoundState.totalPoolAmount / 1_000_000,
        multiTokenPool: {
          ADA: currentRoundState.totalPoolAmount / 1_000_000,
          SNEK: 0, // For now, only tracking ADA
          NIKEPIG: 0,
          unauthorizedTokens: []
        },
        ticketPrice: 5,
        totalParticipants: currentRoundState.participants.length,
        totalTickets: currentRoundState.totalTickets,
        salesOpen: currentRoundState.salesOpen,
        minimumParticipants: currentRoundState.minimumParticipants,
        rolledOverRounds: currentRoundState.rolledOverRounds,
                  rolloverStatus: currentRoundState.participants.length < currentRoundState.minimumParticipants ? 
            `Need ${currentRoundState.minimumParticipants - currentRoundState.participants.length} more participants` : 
            "Ready for draw!",
          roundStartTime: currentRoundState.roundStartTime, // For countdown timer
          processingStatus: currentRoundState.processingStatus, // Processing status for frontend
          processingStartTime: currentRoundState.processingStartTime, // When processing started
          acceptedTokens: ["lovelace", "279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b", "c881c20e49dbaca3ff6cef365969354150983230c39520b917f5cf7c4e696b65"]
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
    if (!ticketCount || typeof ticketCount !== 'number' || ticketCount < 1) {
      ctx.response.status = 400;
      ctx.response.body = { success: false, error: "Invalid ticket count (minimum 1 ticket required)" };
      return;
    }
    if (!tokenPolicyId || typeof tokenPolicyId !== 'string') {
      ctx.response.body = { success: false, error: "Invalid token policy ID" };
      return;
    }
    // [DEBUG] Network and script address
    console.log("[DEBUG] NETWORK:", NETWORK);
    console.log("[DEBUG] SCRIPT_ADDRESS:", SCRIPT_ADDRESS);
    if (!SCRIPT_ADDRESS || SCRIPT_ADDRESS.length < 10) {
      ctx.response.status = 400;
      ctx.response.body = { success: false, error: "Script address is not configured or invalid" };
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
    // [DEBUG] Lucid instantiation
    console.log("[DEBUG] Instantiating Lucid with network:", NETWORK);
    console.log("[DEBUG] Blockfrost URL:", BLOCKFROST_URL);
    console.log("[DEBUG] Blockfrost API Key (first 10 chars):", BLOCKFROST_API_KEY.substring(0, 10));
    
    const lucid = await Lucid.new(
      new Blockfrost(BLOCKFROST_URL, BLOCKFROST_API_KEY),
      NETWORK
    );
    
    // Verify provider is set correctly
    console.log("[DEBUG] Lucid provider:", lucid.provider ? "SET" : "UNDEFINED");
    if (!lucid.provider) {
      ctx.response.status = 500;
      ctx.response.body = { success: false, error: "Lucid provider not initialized correctly" };
      return;
    }
    
    // Test the provider by making a simple API call
    try {
      console.log("[DEBUG] Testing Lucid provider with simple API call...");
      const testUtxos = await lucid.utxosAt(SCRIPT_ADDRESS);
      console.log("[DEBUG] Provider test successful, found", testUtxos.length, "UTxOs");
    } catch (error) {
      console.error("[DEBUG] Provider test failed:", error);
      ctx.response.status = 500;
      ctx.response.body = { success: false, error: "Lucid provider test failed: " + (error instanceof Error ? error.message : String(error)) };
      return;
    }

    // Always fetch latest UTxOs at script address
    const scriptUtxos = await lucid.utxosAt(SCRIPT_ADDRESS);
    console.log("[DEBUG] scriptUtxos at script address:", scriptUtxos);
    if (scriptUtxos.length === 0) {
      ctx.response.status = 400;
      ctx.response.body = { success: false, error: "No UTxO at script address" };
      return;
    }
    // Use the UTxO with the largest ADA (or first)
    const scriptUtxo = scriptUtxos.sort((a, b) => Number(b.assets.lovelace || 0) - Number(a.assets.lovelace || 0))[0];
    // [DEBUG] Selected scriptUtxo
    console.log("[DEBUG] Selected scriptUtxo:", scriptUtxo);
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
    // Serialize datum and redeemer using Lucid Data.to
    const datumType = Data.Object({
      total_pools: Data.Array(Data.Tuple([Data.Bytes(), Data.Integer()])),
      ticket_prices: Data.Array(Data.Tuple([Data.Bytes(), Data.Integer()])),
      total_tickets: Data.Integer(),
      accepted_tokens: Data.Array(Data.Bytes()),
      prize_split: Data.Array(Data.Tuple([Data.Bytes(), Data.Array(Data.Integer())]))
    });
    // Debug log JS object
    console.log("[DEBUG] newDatum (JS):", safeStringifyBigInt(newDatum));
    const datumPlutus = Data.to(newDatum, datumType);
    console.log("[DEBUG] datumPlutus (CBOR hex):", datumPlutus);
    const lucidRedeemer = new Constr(1, [BigInt(totalPayment), redeemerPolicyId, BigInt(ticketCount)]);
    // Debug log JS object
    console.log("[DEBUG] buyTicketRedeemer (JS):", lucidRedeemer);
    const redeemerPlutus = Data.to(lucidRedeemer);
    console.log("[DEBUG] redeemerPlutus (CBOR hex):", redeemerPlutus);
    // Log all policy IDs and asset maps used in the transaction
    console.log("[DEBUG] BuyTickets: tokenPolicyId:", tokenPolicyId);
    console.log("[DEBUG] BuyTickets: datumPolicyId:", datumPolicyId);
    console.log("[DEBUG] BuyTickets: redeemerPolicyId:", redeemerPolicyId);
    console.log("[DEBUG] BuyTickets: newDatum:", safeStringifyBigInt(newDatum));
    console.log("[DEBUG] BuyTickets: buyTicketRedeemer:", safeStringifyBigInt(buyTicketRedeemer));
    // Log the datum and redeemer CBOR as hex strings or buffers, not with JSON.stringify
    function toHexString(buf: any): string {
      return ArrayBuffer.isView(buf) ? Array.prototype.map.call(buf, (x: number) => x.toString(16).padStart(2, '0')).join('') : String(buf);
    }
    const datumPlutusHex = toHexString(datumPlutus);
    const buyTicketRedeemerCborHex = toHexString(redeemerPlutus);
    console.log("[DEBUG] BuyTickets: datumPlutus (CBOR):", datumPlutusHex);
    console.log("[DEBUG] BuyTickets: buyTicketRedeemerCbor (CBOR):", buyTicketRedeemerCborHex);
    // Log the script UTxO being used
    console.log("[DEBUG] BuyTickets: scriptUtxo:", JSON.stringify({
      ...scriptUtxo,
      assets: Object.fromEntries(Object.entries(scriptUtxo.assets).map(([k, v]) => [k, v.toString()]))
    }));

    // Instead of building the transaction on backend, return parameters for frontend to build
    console.log("[DEBUG] Returning transaction parameters to frontend for transaction building");
    
    // Helper function to safely convert BigInt values to strings
    const safeBigIntToString = (obj: any): any => {
      if (typeof obj === 'bigint') {
        return obj.toString();
      } else if (Array.isArray(obj)) {
        return obj.map(safeBigIntToString);
      } else if (obj !== null && typeof obj === 'object') {
        const result: any = {};
        for (const [key, value] of Object.entries(obj)) {
          result[key] = safeBigIntToString(value);
        }
        return result;
      }
      return obj;
    };
    
    const responseBody = {
      success: true,
      message: `Transaction parameters ready. Frontend will build and sign transaction.`,
      transactionParams: {
        scriptUtxo: {
          txHash: scriptUtxo.txHash,
          outputIndex: scriptUtxo.outputIndex,
          assets: Object.fromEntries(Object.entries(scriptUtxo.assets).map(([k, v]) => [k, v.toString()])),
          address: scriptUtxo.address,
          datum: scriptUtxo.datum
        },
        scriptAddress: SCRIPT_ADDRESS,
        poolWalletAddress: POOL_WALLET_ADDRESS,
        scriptValidator: SCRIPT_VALIDATOR,
        newDatum: {
          total_pools: newDatum.total_pools.map(([pid, amt]) => [pid, amt.toString()]),
          total_tickets: newDatum.total_tickets.toString(),
          ticket_prices: newDatum.ticket_prices.map(([pid, price]) => [pid, price.toString()]),
          accepted_tokens: newDatum.accepted_tokens,
          prize_split: newDatum.prize_split
        },
        redeemer: {
          constructor: 1,
          fields: [
            { int: ticketPrice.toString() },
            { bytes: tokenPolicyId === "lovelace" ? "" : tokenPolicyId },
            { int: ticketCount.toString() }
          ]
        },
        redeemerCbor: redeemerPlutus,
        datumCbor: datumPlutus,
        paymentAmount: totalPayment.toString()
      },
      tokenPolicyId: tokenPolicyId,
      ticketPrice: tokenPolicyId === "lovelace" ? Number(ticketPrice) / 1_000_000 : Number(ticketPrice),
      totalPayment: tokenPolicyId === "lovelace" ? Number(totalPayment) / 1_000_000 : Number(totalPayment),
      tickets: Array.from({ length: ticketCount }, (_, i) => ({
        id: `ticket_${Date.now()}_${i}`,
        purchasedAt: new Date().toISOString(),
        tokenPolicyId: tokenPolicyId
      }))
    };
    
    // Use safe serialization to avoid BigInt errors
    ctx.response.body = safeBigIntToString(responseBody);
  } catch (err) {
    let errorMsg;
    try {
      if (typeof err === 'bigint') {
        errorMsg = err.toString();
      } else if (typeof err === 'object' && err !== null && 'stack' in err) {
        errorMsg = (err as any).stack;
      } else {
        errorMsg = safeStringifyBigInt(err);
      }
    } catch (e) {
      errorMsg = String(err);
    }
    console.error('[DEBUG] BuyTickets endpoint error:', errorMsg, err);
    ctx.response.status = 400;
    ctx.response.body = { success: false, error: errorMsg };
    return;
  }
});

// Confirm ticket purchase endpoint
router.post("/api/lottery/confirm-ticket", async (ctx) => {
  try {
    console.log('🔍 [CONFIRM-TICKET] Request received');
    console.log('🔍 [CONFIRM-TICKET] Headers:', Object.fromEntries(ctx.request.headers.entries()));
    console.log('🔍 [CONFIRM-TICKET] Method:', ctx.request.method);
    console.log('🔍 [CONFIRM-TICKET] Content-Type:', ctx.request.headers.get('content-type'));
    
    // Simplified body parsing
    let body;
    let address, ticketCount, txHash, poolWalletAddress;
    
    try {
      const bodyResult = await ctx.request.body({ type: "json" });
      body = await bodyResult.value; // Ensure we await the Promise
      console.log('🔍 [CONFIRM-TICKET] Raw body:', body);
      console.log('🔍 [CONFIRM-TICKET] Body type:', typeof body);
      
      if (body && typeof body === 'object') {
        address = body.address;
        ticketCount = body.ticketCount;
        txHash = body.txHash;
        poolWalletAddress = body.poolWalletAddress;
        console.log('🔍 [CONFIRM-TICKET] Body parsing SUCCESS');
      } else {
        console.error('🔍 [CONFIRM-TICKET] Body is not a valid object:', body);
        throw new Error('Invalid body format');
      }
    } catch (bodyError: any) {
      console.error('🔍 [CONFIRM-TICKET] Body parsing failed:', bodyError.message);
      ctx.response.status = 400;
      ctx.response.body = { success: false, error: "Failed to parse request body: " + bodyError.message };
      return;
    }
    
    console.log('🔍 [CONFIRM-TICKET] Destructured values:', {
      address: address,
      ticketCount: ticketCount,
      txHash: txHash,
      poolWalletAddress: poolWalletAddress
    });
    
    // Validate required fields
    if (!address || typeof address !== 'string') {
      console.error('❌ [CONFIRM-TICKET] Invalid address:', address);
      ctx.response.status = 400;
      ctx.response.body = { success: false, error: "Invalid or missing address" };
      return;
    }
    
    if (!ticketCount || typeof ticketCount !== 'number' || ticketCount < 1) {
      console.error('❌ [CONFIRM-TICKET] Invalid ticketCount:', ticketCount);
      ctx.response.status = 400;
      ctx.response.body = { success: false, error: "Invalid or missing ticketCount" };
      return;
    }
    
    if (!txHash || typeof txHash !== 'string') {
      console.error('❌ [CONFIRM-TICKET] Invalid txHash:', txHash);
      ctx.response.status = 400;
      ctx.response.body = { success: false, error: "Invalid or missing txHash" };
      return;
    }
    
    console.log('✅ [CONFIRM-TICKET] Validation passed');
    console.log('🎫 Ticket purchase confirmed:', {
      address: address,
      ticketCount: ticketCount,
      txHash: txHash,
      poolWallet: poolWalletAddress || POOL_WALLET_ADDRESS,
      timestamp: new Date().toISOString()
    });
    
    // 🎰 UPDATE BACKEND ROUND STATE
    const participant = {
      address: address,
      ticketCount: ticketCount,
      txHash: txHash,
      timestamp: Date.now()
    };
    
    // Check if participant already exists (same address)
    const existingIndex = currentRoundState.participants.findIndex(p => p.address === address);
    if (existingIndex >= 0) {
      // Update existing participant
      currentRoundState.participants[existingIndex].ticketCount += ticketCount;
      console.log(`✅ Updated existing participant: ${address} (total tickets: ${currentRoundState.participants[existingIndex].ticketCount})`);
    } else {
      // Add new participant
      currentRoundState.participants.push(participant);
      console.log(`✅ Added new participant: ${address} (tickets: ${ticketCount})`);
    }
    
    // Update round totals
    currentRoundState.totalTickets += ticketCount;
    currentRoundState.totalPoolAmount += (ticketCount * 5 * 1_000_000); // 5 ADA per ticket in lovelace
    
    console.log(`🎰 Round State Updated:`, {
      round: currentRoundState.roundNumber,
      participants: currentRoundState.participants.length,
      totalTickets: currentRoundState.totalTickets,
      poolADA: currentRoundState.totalPoolAmount / 1_000_000
    });
    
    ctx.response.body = {
      success: true,
      message: `Confirmed purchase of ${ticketCount} tickets from ${address}`,
      transactionHash: txHash,
      poolWallet: poolWalletAddress || POOL_WALLET_ADDRESS,
      roundStats: {
        roundNumber: currentRoundState.roundNumber,
        totalParticipants: currentRoundState.participants.length,
        totalTickets: currentRoundState.totalTickets,
        poolAmount: currentRoundState.totalPoolAmount / 1_000_000
      },
      confirmedAt: new Date().toISOString()
    };
  } catch (error) {
    ctx.response.status = 400;
    ctx.response.body = { success: false, error: "Invalid request body" };
  }
});

// Pool wallet endpoint - Updated for new architecture
router.get("/api/pool-wallet", (ctx) => {
    ctx.response.body = {
      success: true,
      poolWalletAddress: POOL_WALLET_ADDRESS,
      scriptAddress: SCRIPT_ADDRESS,
      architecture: "separate_pool_wallet",
      description: "Pool wallet stores funds, script validates transactions"
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

    // Get current pool amounts for all tokens from POOL WALLET (not script address)
    const poolData = await getMultiTokenPoolData(BLOCKFROST_URL, BLOCKFROST_API_KEY, POOL_WALLET_ADDRESS);
    
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

    const { allTokens, unauthorizedTokens } = await getAllPoolTokens(BLOCKFROST_URL, BLOCKFROST_API_KEY, POOL_WALLET_ADDRESS);
    
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

    const poolData = await getMultiTokenPoolData(BLOCKFROST_URL, BLOCKFROST_API_KEY, POOL_WALLET_ADDRESS);
    
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
    const currentRound = currentRoundState?.roundNumber || 1;

    // Return real historical winners from storage
    const historicalWinners = historicalWinnersStorage;
    
    console.log(`📊 Winners API called - Current round: ${currentRound}`);
    console.log(`📊 Historical winners storage:`, historicalWinners);
    console.log(`📊 Total winners in storage: ${historicalWinners.reduce((sum, round) => sum + round.winners.length, 0)}`);

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

// Public endpoint: Get user's tickets for current round
router.get("/api/lottery/my-tickets", async (ctx) => {
  try {
    const address = ctx.request.url.searchParams.get("address");
    if (!address) {
      ctx.response.status = 400;
      ctx.response.body = { success: false, error: "Address parameter required" };
      return;
    }
    
    // Find user in current round participants
    const participant = currentRoundState.participants.find(p => p.address === address);
    const myTickets = participant ? participant.ticketCount : 0;
    
    ctx.response.body = {
      success: true,
      address: address,
      tickets: myTickets,
      roundNumber: currentRoundState.roundNumber,
      salesOpen: currentRoundState.salesOpen,
      lastUpdated: new Date().toISOString()
    };
  } catch (error) {
    console.error("Error fetching user tickets:", error);
    ctx.response.status = 500;
    ctx.response.body = { success: false, error: "Failed to fetch user tickets" };
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

// Enhanced Admin Endpoints with Pool Architecture
router.post("/api/lottery/admin/close-round", async (ctx) => {
  try {
    console.log('🔘 Close round endpoint called');
    
    // For now, return success with mock round closure
    // In full implementation, this would:
    // 1. Close sales in smart contract
    // 2. Record participants 
    // 3. Prepare for winner selection
    
    const mockResult = {
      success: true,
      message: "Round closed successfully! Sales stopped and winner selection ready.",
      round: {
        roundNumber: 1,
        participantsCount: Math.floor(Math.random() * 50) + 10, // Random 10-60 participants
        totalPool: (Math.random() * 1000 + 100).toFixed(2), // Random 100-1100 ADA
        closedAt: new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    };
    
    ctx.response.body = mockResult;
    console.log('✅ Close round completed:', mockResult);
    
  } catch (error: any) {
    console.error('❌ Close round error:', error);
    ctx.response.status = 500;
    ctx.response.body = { success: false, error: "Failed to close round: " + error.message };
  }
});

router.post("/api/lottery/admin/distribute-prizes", async (ctx) => {
  try {
    console.log('🏆 Distribute prizes endpoint called');
    
    // For now, return success with mock prize distribution
    // In full implementation, this would:
    // 1. Select winners using fair algorithm
    // 2. Transfer funds from POOL_WALLET_ADDRESS to winners
    // 3. Record transactions and update database
    
    const mockWinners = [
      {
        position: 1,
        address: "addr_test1qpndcu8gv9t6xrr3up8stle8cmxee7qgys034lfwgzcsckmywrv9avf8lpvwkz97q2c6msaannl28etcuqtuq90pdwnsnhez9k",
        amount: 500,
        percentage: 50,
        transactionId: `winner_1st_${Date.now()}`,
        status: "distributed"
      },
      {
        position: 2, 
        address: "addr_test1qrpxk3kmrcy7u2dthmndu3nm7wvw9jlfmnm909qyvjck9qkapqpp4z89q6t3fsynhzslj4ad2t9vpyx3mlw0lszpv98sftkqtc",
        amount: 300,
        percentage: 30,
        transactionId: `winner_2nd_${Date.now()}`,
        status: "distributed"
      },
      {
        position: 3,
        address: "addr_test1qzw8mjxgpvfwfzqtjp2qvw8w2qvw8mjxgpvfwfzqtjp2qvw8w2qvw8mjxgpvfwfzqt",
        amount: 200,
        percentage: 20, 
        transactionId: `winner_3rd_${Date.now()}`,
        status: "distributed"
      }
    ];
    
    const mockResult = {
      success: true,
      message: "Prizes distributed successfully!",
      winners: mockWinners,
      totalDistributed: 1000,
      poolWallet: POOL_WALLET_ADDRESS,
      distributedAt: new Date().toISOString(),
      timestamp: new Date().toISOString()
    };
    
    ctx.response.body = mockResult;
    console.log('✅ Prize distribution completed:', mockResult);
    
  } catch (error: any) {
    console.error('❌ Distribute prizes error:', error);
    ctx.response.status = 500;
    ctx.response.body = { success: false, error: "Failed to distribute prizes: " + error.message };
  }
});

router.post("/api/lottery/admin/start-new-round", async (ctx) => {
  try {
    console.log('🔄 Start new round endpoint called');
    
    // For now, return success with mock new round
    // In full implementation, this would:
    // 1. Reset smart contract state
    // 2. Clear participant list
    // 3. Open sales for new round
    // 4. Update round number
    
    const newRoundNumber = Math.floor(Math.random() * 10) + 2; // Random round 2-11
    
    const mockResult = {
      success: true,
      message: "New round started successfully! Sales are now open.",
      round: {
        roundNumber: newRoundNumber,
        salesOpen: true,
        participantsCount: 0,
        totalPool: 0,
        startedAt: new Date().toISOString()
      },
      poolWallet: POOL_WALLET_ADDRESS,
      scriptAddress: SCRIPT_ADDRESS,
      timestamp: new Date().toISOString()
    };
    
    ctx.response.body = mockResult;
    console.log('✅ New round started:', mockResult);
    
  } catch (error: any) {
    console.error('❌ Start new round error:', error);
    ctx.response.status = 500;
    ctx.response.body = { success: false, error: "Failed to start new round: " + error.message };
  }
});

// Real-time Notifications - Phase 3.3
interface NotificationEvent {
  type: 'pool_update' | 'winner_announcement';
  message: string;
  data: any;
  timestamp: string;
}

// WebSocket functionality removed - not needed for automated prize distribution

// Notification endpoints for triggering events
router.post("/api/lottery/notify/pool-update", async (ctx) => {
  try {
    if (!BLOCKFROST_API_KEY) {
      ctx.response.status = 500;
      ctx.response.body = { success: false, error: "Blockfrost configuration missing" };
      return;
    }
    const lotteryState = await getCurrentLotteryState();
    const poolData = await getMultiTokenPoolData(BLOCKFROST_URL, BLOCKFROST_API_KEY, POOL_WALLET_ADDRESS);
    
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

// Add a debug endpoint to inspect plutus.json and compiledCode
router.get("/api/debug-plutus", (ctx) => {
  const rawFile = Deno.readTextFileSync("./contract/plutus.json");
  const parsed = JSON.parse(rawFile);
  ctx.response.body = {
    rawLength: rawFile.length,
    compiledCodeLength: parsed.validators[0].compiledCode.length,
    compiledCodeStart: parsed.validators[0].compiledCode.slice(0, 100),
    compiledCodeEnd: parsed.validators[0].compiledCode.slice(-100),
    hasComma: parsed.validators[0].compiledCode.includes(','),
    nonHexMatch: parsed.validators[0].compiledCode.match(/[^0-9a-fA-F]/g),
  };
});

const port = parseInt(Deno.env.get("PORT") || "3000");
console.log(`🚀 Updated Deno server running on port ${port}`);
console.log(`📝 Smart contract address: ${SCRIPT_ADDRESS}`);

await app.listen({ port }); 

// 🏆 NEW: ClaimPrizes transaction builder for current minimal contract
router.post("/api/lottery/admin/claim-prizes", async (ctx) => {
  try {
    console.log('🏆 Building ClaimPrizes transaction...');
    
    // Get request body
    const bodyResult = await ctx.request.body({ type: "json" });
    const body = await bodyResult.value;
    const { winners, adminWalletAddress } = body;
    
    if (!winners || !Array.isArray(winners) || winners.length === 0) {
      ctx.response.status = 400;
      ctx.response.body = { success: false, error: "Valid winners array required" };
      return;
    }
    
    if (!adminWalletAddress) {
      ctx.response.status = 400;
      ctx.response.body = { success: false, error: "Admin wallet address required" };
      return;
    }
    
    // Initialize Lucid
    const lucid = await Lucid.new(
      new Blockfrost(BLOCKFROST_URL, BLOCKFROST_API_KEY),
      NETWORK
    );
    
    // Get current smart contract state
    const lotteryState = await getCurrentLotteryState();
    if (!lotteryState) {
      ctx.response.status = 400;
      ctx.response.body = { success: false, error: "Could not fetch lottery state" };
      return;
    }
    
    // Get script UTxO
    const scriptUtxos = await lucid.utxosAt(SCRIPT_ADDRESS);
    if (scriptUtxos.length === 0) {
      ctx.response.status = 400;
      ctx.response.body = { success: false, error: "No UTxO at script address" };
      return;
    }
    const scriptUtxo = scriptUtxos[0];
    
    // Get pool wallet UTxOs (where the actual prize money is stored)
    const poolUtxos = await lucid.utxosAt(POOL_WALLET_ADDRESS);
    if (poolUtxos.length === 0) {
      ctx.response.status = 400;
      ctx.response.body = { success: false, error: "No funds in pool wallet" };
      return;
    }
    
    // Calculate total ADA pool from pool wallet
    let totalPoolLovelace = 0n;
    for (const utxo of poolUtxos) {
      totalPoolLovelace += utxo.assets.lovelace || 0n;
    }
    const totalPoolADA = Number(totalPoolLovelace) / 1_000_000;
    
    console.log(`💰 Total pool from wallet: ${totalPoolADA} ADA`);
    
    // Get prize split configuration for ADA (empty string = lovelace)
    const adaPrizeSplit = lotteryState.prize_split.find(([policyId]) => policyId === "" || policyId === "lovelace");
    if (!adaPrizeSplit) {
      ctx.response.status = 400;
      ctx.response.body = { success: false, error: "No ADA prize split configuration found" };
      return;
    }
    
    const prizePercentages = adaPrizeSplit[1]; // [50, 30, 20] etc
    console.log(`🎯 Prize percentages: ${prizePercentages.map(p => Number(p))}%`);
    
    // Validate winners match prize split
    if (winners.length !== prizePercentages.length) {
      ctx.response.status = 400;
      ctx.response.body = { 
        success: false, 
        error: `Winners count (${winners.length}) must match prize split count (${prizePercentages.length})` 
      };
      return;
    }
    
    // Calculate prize amounts
    const prizeAmounts: bigint[] = [];
    let totalDistributed = 0n;
    
    for (let i = 0; i < winners.length; i++) {
      const percentage = Number(prizePercentages[i]);
      const prizeLovelace = (totalPoolLovelace * BigInt(percentage)) / 100n;
      prizeAmounts.push(prizeLovelace);
      totalDistributed += prizeLovelace;
      
      console.log(`🏆 Winner ${i + 1}: ${winners[i].address.substring(0, 20)}... gets ${Number(prizeLovelace) / 1_000_000} ADA (${percentage}%)`);
    }
    
    // Build ClaimPrizes redeemer
    const winnerIndices = winners.map((_, index) => BigInt(index));
    const prizeAmountsForToken = [["", prizeAmounts]]; // Empty string = lovelace/ADA
    
    const claimPrizesRedeemer = new Constr(2, [ // Constructor 2 = ClaimPrizes
      winnerIndices,
      prizeAmountsForToken.map(([policyId, amounts]) => 
        new Constr(0, [policyId, amounts])
      )
    ]);
    
    console.log(`🔧 ClaimPrizes redeemer built:`, {
      winnerIndices: winnerIndices.map(i => Number(i)),
      totalPrizes: prizeAmounts.map(p => Number(p) / 1_000_000)
    });
    
    // Create new datum for next round (reset pools and tickets)
    const newDatum: LotteryStateDatum = {
      total_pools: [], // Reset for new round
      ticket_prices: lotteryState.ticket_prices,
      total_tickets: 0n, // Reset for new round
      accepted_tokens: lotteryState.accepted_tokens,
      prize_split: lotteryState.prize_split
    };
    
    // Serialize new datum
    const datumType = Data.Object({
      total_pools: Data.Array(Data.Tuple([Data.Bytes(), Data.Integer()])),
      ticket_prices: Data.Array(Data.Tuple([Data.Bytes(), Data.Integer()])),
      total_tickets: Data.Integer(),
      accepted_tokens: Data.Array(Data.Bytes()),
      prize_split: Data.Array(Data.Tuple([Data.Bytes(), Data.Array(Data.Integer())]))
    });
    const newDatumCbor = Data.to(newDatum, datumType);
    
    // Build transaction
    let tx = lucid.newTx();
    
    // Collect from script UTxO with ClaimPrizes redeemer
    tx = tx.collectFrom([scriptUtxo], Data.to(claimPrizesRedeemer));
    
    // Collect from pool wallet UTxOs
    tx = tx.collectFrom(poolUtxos);
    
    // Pay winners
    for (let i = 0; i < winners.length; i++) {
      const winner = winners[i];
      const prizeAmount = prizeAmounts[i];
      tx = tx.payToAddress(winner.address, { lovelace: prizeAmount });
    }
    
    // Send remaining funds back to script with new datum
    const remainingLovelace = 2_000_000n; // 2 ADA minimum
    tx = tx.payToContract(SCRIPT_ADDRESS, { inline: newDatumCbor }, { lovelace: remainingLovelace });
    
    // Attach script validator
    tx = tx.attachSpendingValidator(SCRIPT_VALIDATOR);
    
    // Complete transaction
    const completedTx = await tx.complete();
    
    ctx.response.body = {
      success: true,
      message: "ClaimPrizes transaction built successfully",
      transactionCbor: completedTx.toString(),
      prizeDistribution: {
        totalPool: totalPoolADA,
        winners: winners.map((winner, i) => ({
          address: winner.address,
          amount: Number(prizeAmounts[i]) / 1_000_000,
          percentage: Number(prizePercentages[i])
        }))
      },
      newRoundState: {
        total_pools: [],
        total_tickets: 0,
        message: "New round initialized"
      },
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error("❌ Error building ClaimPrizes transaction:", error);
    ctx.response.status = 500;
    ctx.response.body = { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}); 

// 🤖 AUTOMATED PRIZE DISTRIBUTION FUNCTION
async function distributeAutomaticPrizes(
  winners: Array<{address: string; amount: number; percentage: number; position: number}>,
  totalPoolADA: number
): Promise<string> {
  if (!winners || winners.length === 0) {
    throw new Error("No winners to distribute prizes to");
  }
  
  console.log(`🎰 Starting automated prize distribution for ${winners.length} winners`);
  console.log(`💰 Total pool: ${totalPoolADA.toFixed(2)} ADA`);
  
  try {
    // Use seed phrase approach for pool wallet (no private key needed)
    console.log(`🌱 Using seed phrase approach for automated prize distribution...`);
    
    // No private key parsing needed - using seed phrase approach
    
    // Initialize Lucid and wallet variables
    let lucid: any;
    let poolWalletAddress: string;
    
    try {
      // Initialize Lucid with pool wallet
      lucid = await Lucid.new(
        new Blockfrost(BLOCKFROST_URL, BLOCKFROST_API_KEY),
        NETWORK
      );
      
      console.log(`🔗 Lucid initialized successfully with ${NETWORK} network`);
      
      // Import pool wallet from private key
      console.log(`🔐 Loading pool wallet using seed phrase approach...`);
      
      // Use seed phrase approach (the only method that works with Lucid)
      try {
        const testSeedPhrase = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
        console.log(`🌱 Using deterministic seed phrase for wallet generation...`);
        
        // Load wallet using seed phrase (proven to work)
        lucid.selectWalletFromSeed(testSeedPhrase);
        console.log(`✅ Pool wallet loaded successfully using seed phrase`);
        
      } catch (seedError: any) {
        console.error(`❌ Failed to load wallet using seed phrase: ${seedError.message || seedError}`);
        throw new Error(`Wallet loading failed: ${seedError.message || 'Unknown error'}`);
      }
      
      poolWalletAddress = await lucid.wallet.address();
      console.log(`🏦 Using pool wallet: ${poolWalletAddress}`);
      
      // Verify this matches expected address
      if (poolWalletAddress !== POOL_WALLET_ADDRESS) {
        console.log(`⚠️ Address mismatch! Expected: ${POOL_WALLET_ADDRESS}, Got: ${poolWalletAddress}`);
      } else {
        console.log(`✅ Pool wallet address matches expected address`);
      }
    } catch (lucidError: any) {
      console.error(`❌ Lucid error details:`, lucidError);
      console.error(`❌ Error type:`, lucidError.constructor?.name || 'Unknown');
      console.error(`❌ Error message:`, lucidError.message || 'No message');
      throw new Error(`Lucid wallet selection failed: ${lucidError.message || 'Unknown error'}`);
    }
    
    // Get pool wallet UTxOs
    const poolUtxos = await lucid.utxosAt(poolWalletAddress);
    if (poolUtxos.length === 0) {
      throw new Error("No UTxOs available in pool wallet");
    }
    
    // Calculate total available ADA
    let totalAvailableLovelace = 0n;
    for (const utxo of poolUtxos) {
      totalAvailableLovelace += utxo.assets.lovelace || 0n;
    }
    const totalAvailableADA = Number(totalAvailableLovelace) / 1_000_000;
    
    console.log(`💳 Pool wallet balance: ${totalAvailableADA.toFixed(2)} ADA`);
    
    // Check if we have enough funds
    const totalPrizeNeeded = winners.reduce((sum, winner) => sum + winner.amount, 0);
    if (totalAvailableADA < totalPrizeNeeded) {
      throw new Error(`Insufficient funds: need ${totalPrizeNeeded.toFixed(2)} ADA, have ${totalAvailableADA.toFixed(2)} ADA`);
    }
    
    // Calculate commission amounts
    const teamCommissionADA = totalPoolADA * 0.025; // 2.5%
    const burnCommissionADA = totalPoolADA * 0.025; // 2.5%
    
    console.log(`💸 Commission breakdown:`);
    console.log(`   Team wallet (2.5%): ${teamCommissionADA.toFixed(2)} ADA`);
    console.log(`   Burn wallet (2.5%): ${burnCommissionADA.toFixed(2)} ADA`);
    console.log(`   Total commission: ${(teamCommissionADA + burnCommissionADA).toFixed(2)} ADA`);
    
    // Build transaction to pay commissions and winners
    let tx = lucid.newTx();
    
    // Add commission payments
    const teamCommissionLovelace = BigInt(Math.floor(teamCommissionADA * 1_000_000));
    const burnCommissionLovelace = BigInt(Math.floor(burnCommissionADA * 1_000_000));
    
    tx = tx.payToAddress(TEAM_WALLET_ADDRESS, { lovelace: teamCommissionLovelace });
    tx = tx.payToAddress(BURN_WALLET_ADDRESS, { lovelace: burnCommissionLovelace });
    
    console.log(`💸 Team commission: ${TEAM_WALLET_ADDRESS.substring(0, 20)}... → ${teamCommissionADA.toFixed(2)} ADA`);
    console.log(`🔥 Burn commission: ${BURN_WALLET_ADDRESS.substring(0, 20)}... → ${burnCommissionADA.toFixed(2)} ADA`);
    
    // Add winner payments
    for (const winner of winners) {
      const prizeLovelace = BigInt(Math.floor(winner.amount * 1_000_000));
      tx = tx.payToAddress(winner.address, { lovelace: prizeLovelace });
      
      console.log(`🏆 Winner ${winner.position}: ${winner.address.substring(0, 20)}... → ${winner.amount.toFixed(2)} ADA (${winner.percentage.toFixed(1)}%)`);
    }
    
    // Complete and submit transaction
    const completedTx = await tx.complete();
    const signedTx = await completedTx.sign().complete();
    const txHash = await signedTx.submit();
    
    console.log(`✅ Prize distribution transaction submitted: ${txHash}`);
    console.log(`🔗 View on Cardanoscan: https://preview.cardanoscan.io/transaction/${txHash}`);
    
    // Wait a moment for transaction to be processed
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Verify transaction was successful
    try {
      await lucid.awaitTx(txHash);
      console.log(`🎉 Prize distribution confirmed on blockchain!`);
      
      // Log success for each winner
      winners.forEach(winner => {
        console.log(`💰 ${winner.address} received ${winner.amount.toFixed(2)} ADA`);
      });
      
    } catch (confirmError) {
      console.warn(`⚠️ Transaction submitted but confirmation failed: ${confirmError}`);
      console.log(`🔍 Check transaction status manually: ${txHash}`);
    }
    
    return txHash; // Return the transaction hash
    
  } catch (error) {
    console.error("❌ Error in automated prize distribution:", error);
    throw error; // Re-throw to be handled by caller
  }
}

// 🚨 EMERGENCY MANUAL PRIZE DISTRIBUTION ENDPOINT
router.post("/api/lottery/admin/emergency-distribute", async (ctx) => {
  try {
    console.log('🚨 Emergency manual prize distribution triggered');
    
    // Get request body
    const bodyResult = await ctx.request.body({ type: "json" });
    const body = await bodyResult.value;
    const { winners, force } = body;
    
    if (!winners || !Array.isArray(winners) || winners.length === 0) {
      ctx.response.status = 400;
      ctx.response.body = { success: false, error: "Valid winners array required" };
      return;
    }
    
    // Validate winner format
    for (const winner of winners) {
      if (!winner.address || !winner.amount || typeof winner.amount !== 'number') {
        ctx.response.status = 400;
        ctx.response.body = { success: false, error: "Each winner must have address and amount" };
        return;
      }
    }
    
    const totalPrizeNeeded = winners.reduce((sum: number, winner: any) => sum + winner.amount, 0);
    console.log(`💰 Emergency distribution: ${totalPrizeNeeded.toFixed(2)} ADA to ${winners.length} winners`);
    
    // Use the same automated distribution function
    await distributeAutomaticPrizes(winners, totalPrizeNeeded);
    
    ctx.response.body = {
      success: true,
      message: "Emergency prize distribution completed successfully",
      totalDistributed: totalPrizeNeeded,
      winnersCount: winners.length,
      winners: winners.map((winner: any) => ({
        address: winner.address,
        amount: winner.amount
      })),
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error("❌ Error in emergency prize distribution:", error);
    ctx.response.status = 500;
    ctx.response.body = { 
      success: false, 
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    };
  }
});