// Admin Dashboard Logic for Nikepig Lottery

const adminStats = document.getElementById('admin-stats');
const adminNotificationElement = document.getElementById('adminNotification');
const openRoundBtn = document.getElementById('open-round-btn');
const closeRoundBtn = document.getElementById('close-round-btn');
const drawWinnerBtn = document.getElementById('draw-winner-btn');
const resetLotteryBtn = document.getElementById('reset-lottery-btn');
const updateContractBtn = document.getElementById('update-contract-btn');
const initializeContractBtn = document.getElementById('initialize-contract-btn');
const API_BASE_URL = 'https://nikepig-lottery.onrender.com';

function showAdminNotification(msg, type = 'info') {
  if (!adminNotificationElement) return;
  adminNotificationElement.textContent = msg;
  adminNotificationElement.className = 'notification ' + type;
  adminNotificationElement.style.display = 'block';
  setTimeout(() => { adminNotificationElement.style.display = 'none'; }, 4000);
}

async function fetchAdminStats() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/lottery/stats`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to fetch stats');
    const stats = data.stats;
    
    // Build multi-token pool display
    let poolDisplay = `${stats.totalPoolADA} ADA`;
    if (stats.multiTokenPool) {
      const pool = stats.multiTokenPool;
      if (pool.SNEK > 0) {
        poolDisplay += `, ${pool.SNEK.toFixed(2)} SNEK`;
      }
      if (pool.NIKEPIG > 0) {
        poolDisplay += `, ${pool.NIKEPIG.toFixed(0)} NIKEPIG`;
      }
    }
    
    adminStats.innerHTML = `
      <div class="statss"><h5>Round</h5><p>${stats.roundNumber}</p></div>
      <div class="statss"><h5>Total Pool</h5><p>${poolDisplay}</p></div>
      <div class="statss"><h5>Participants</h5><p>${stats.totalParticipants}</p></div>
      <div class="statss"><h5>Tickets</h5><p>${stats.totalTickets}</p></div>
    `;
  } catch (_e) {
    adminStats.innerHTML = '<div class="statss">Failed to load stats</div>';
  }
}

async function refreshAdminHistory() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/lottery/admin/history`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to fetch history');
    const tbody = document.getElementById('historyTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    data.history.reverse().forEach(round => {
      tbody.innerHTML += `
        <tr>
          <td>${round.roundNumber}</td>
          <td>${round.totalPool ? round.totalPool.toFixed(2) : '0.00'}</td>
          <td>${round.winners ? round.winners.length : 0}</td>
          <td>${round.totalPool ? Math.floor(round.totalPool / 5) : 0}</td>
          <td>${round.isCurrent ? 'Open' : 'Closed'}</td>
          <td>${round.winners && round.winners.length ? round.winners.map(w => w.address ? w.address.slice(0,8)+'...' : 'Unknown').join('<br>') : '-'}</td>
          <td>${round.timestamp ? new Date(round.timestamp).toLocaleString() : '-'}</td>
        </tr>
      `;
    });
  } catch (e) {
    const tbody = document.getElementById('historyTableBody');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan='7'>Failed to load history: ${e.message}</td></tr>`;
  }
}

async function adminAction(endpoint, successMsg) {
  try {
    showAdminNotification('Processing...', 'info');
    const res = await fetch(`${API_BASE_URL}${endpoint}`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showAdminNotification(successMsg, 'success');
      await fetchAdminStats();
      await refreshAdminHistory();
    } else {
      showAdminNotification('Failed: ' + (data.error || data.message), 'error');
    }
  } catch (e) {
    showAdminNotification('Error: ' + e.message, 'error');
  }
}

async function ensureLucid() {
  if (!window.Lucid) {
    alert('Lucid web module not loaded!');
    return null;
  }
  if (!window.lucid) {
    window.lucid = await window.Lucid.new(
      new window.Blockfrost(
        "https://cardano-preview.blockfrost.io/api/v0",
        "previewyEaLt5aKLcelODYvUD4Ka8cmT41DurY0"
      ),
      "Preview"
    );
    console.log('Lucid initialized in adminboard.js');
  }
  return window.lucid;
}

if (openRoundBtn) openRoundBtn.onclick = () => adminAction('/api/lottery/admin/start-new-round', 'New round started!');
if (closeRoundBtn) closeRoundBtn.onclick = () => adminAction('/api/lottery/admin/close-round', 'Round closed!');
if (drawWinnerBtn) drawWinnerBtn.onclick = () => adminAction('/api/lottery/admin/distribute-prizes', 'Prizes distributed!');
if (resetLotteryBtn) resetLotteryBtn.onclick = () => adminAction('/api/lottery/reset', 'Lottery reset!');
if (updateContractBtn) {
  updateContractBtn.addEventListener('click', async () => {
    try {
      if (!window.lucid) {
        showAdminNotification('Lucid not initialized. Please connect your wallet first.', 'error');
        return;
      }
      showAdminNotification('Submitting minimal datum to contract...', 'info');
      // Minimal datum for debugging
      const datum = {
        total_pools: [["", 0n]], // "" is the hex for ADA
        ticket_prices: [["", 5000000n]],
        total_tickets: 0n,
        accepted_tokens: [""],
        prize_split: [["", [100n]]]
      };
      const SCRIPT_ADDRESS = "addr_test1wrp5ddnttmrlx9v9g2tkscv6dqppphj9rj3prpfu85ndwgqg0vj98";
      const MIN_ADA = 2000000;
      const tx = await window.lucid
        .newTx()
        .payToContract(
          SCRIPT_ADDRESS,
          { inline: datum },
          { lovelace: MIN_ADA }
        )
        .complete();
      const signedTx = await tx.sign().complete();
      const txHash = await signedTx.submit();
      showAdminNotification('Datum update transaction submitted! TxHash: ' + txHash, 'success');
    } catch (error) {
      showAdminNotification('Failed to update contract: ' + (error.message || error), 'error');
    }
  });
}

if (initializeContractBtn) {
  initializeContractBtn.addEventListener('click', async () => {
    try {
      const lucid = await ensureLucid();
      if (!lucid) {
        showAdminNotification('Lucid not initialized. Please connect your wallet first.', 'error');
        return;
      }
      showAdminNotification('Initializing smart contract with minimal datum...', 'info');
      console.log('Initialize Smart Contract button clicked.');
      // Minimal datum for contract initialization
      const datum = {
        total_pools: [["", 0n]],
        ticket_prices: [["", 5000000n]],
        total_tickets: 0n,
        accepted_tokens: [""],
        prize_split: [["", [100n]]]
      };
      const SCRIPT_ADDRESS = "addr_test1wrp5ddnttmrlx9v9g2tkscv6dqppphj9rj3prpfu85ndwgqg0vj98";
      const MIN_ADA = 2000000;
      const tx = await lucid
        .newTx()
        .payToContract(
          SCRIPT_ADDRESS,
          { inline: datum },
          { lovelace: MIN_ADA }
        )
        .complete();
      const signedTx = await tx.sign().complete();
      const txHash = await signedTx.submit();
      showAdminNotification('Smart contract initialized! TxHash: ' + txHash, 'success');
      console.log('Smart contract initialized! TxHash:', txHash);
    } catch (error) {
      showAdminNotification('Failed to initialize contract: ' + (error.message || error), 'error');
      console.error('Failed to initialize contract:', error);
    }
  });
}

globalThis.addEventListener('DOMContentLoaded', async () => {
  await fetchAdminStats();
  await refreshAdminHistory();
}); 