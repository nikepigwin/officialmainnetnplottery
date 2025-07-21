// Nikepig Lottery dApp - main.js (updated for Eternl, preview testnet enforced)

let lucid;
let api;
let walletAddress;
let blockfrostConfig;

// Backend API URL
const BACKEND_URL = 'https://official-mainnet-nplottery-backend.onrender.com';
// Contract address (update if redeployed)
const SCRIPT_ADDRESS = 'addr_test1wqphj86rnmxlzz9ntyrsu6rdk3ylpqsr492p3gz7wampp7cdsux3s';
const BLOCKFROST_PREVIEW_URL = 'https://cardano-preview.blockfrost.io/api/v0';

window.addEventListener('DOMContentLoaded', function() {
    console.log('🎰 Nikepig Lottery dApp initialized');
    document.getElementById('connectWallet').addEventListener('click', connectWallet);
    document.getElementById('sendAdaToContract').addEventListener('click', sendAdaToContract);
    loadLotteryStats();
});

// Connect to Eternl wallet and enforce preview testnet
async function connectWallet() {
    try {
        if (!window.cardano || !window.cardano.eternl) {
            showStatus('Eternl wallet not found! Please install Eternl extension.', 'error');
            return;
        }
        api = await window.cardano.eternl.enable();
        // Check Eternl network ID
        const networkId = await api.getNetworkId();
        console.log('Eternl Network ID:', networkId);
        if (networkId !== 0) {
            showStatus('Eternl is not set to Preview testnet. Please switch to Preview in Eternl settings.', 'error');
            throw new Error('Eternl is not on preview testnet!');
        }
        // Get Blockfrost config from backend
        const configResponse = await fetch(`${BACKEND_URL}/api/blockfrost-config`);
        blockfrostConfig = await configResponse.json();
        // Enforce preview Blockfrost URL
        if (blockfrostConfig.url !== BLOCKFROST_PREVIEW_URL) {
            showStatus('Blockfrost URL is not for preview testnet. Please check backend config.', 'error');
            throw new Error('Blockfrost URL is not preview!');
        }
        // Initialize Lucid for preview
        lucid = await window.Lucid.new(
            new window.Blockfrost(blockfrostConfig.url, blockfrostConfig.projectId),
            'Preview'
        );
        lucid.selectWallet(api);
        walletAddress = await lucid.wallet.address();
        console.log('Wallet Address:', walletAddress);
        if (!walletAddress.startsWith('addr_test1')) {
            showStatus('Wallet address is not on preview testnet. Please check Eternl network.', 'error');
            throw new Error('Wallet address is not on preview testnet!');
        }
        document.getElementById('walletAddress').textContent = walletAddress;
        document.getElementById('walletInfo').classList.remove('hidden');
        document.getElementById('connectWallet').textContent = 'Wallet Connected';
        document.getElementById('connectWallet').disabled = true;
        showStatus('Wallet connected successfully (Preview testnet)', 'success');
    } catch (error) {
        console.error('Wallet connection error:', error);
        showStatus(`Failed to connect wallet: ${error.message}`, 'error');
    }
}

// Load lottery statistics
async function loadLotteryStats() {
    try {
        const response = await fetch(`${BACKEND_URL}/api/lottery/stats`);
        const data = await response.json();
        if (data.success) {
            displayLotteryStats(data.stats);
        } else {
            throw new Error(data.error || 'Failed to load lottery stats');
        }
    } catch (error) {
        console.error('Error loading lottery stats:', error);
        document.getElementById('lotteryStats').innerHTML = `<p style="color: #ef4444;">Failed to load lottery stats: ${error.message}</p>`;
    }
}

// Display lottery statistics
function displayLotteryStats(stats) {
    const statsHtml = `
        <div class="stats-grid">
            <div class="stat-item">
                <div class="stat-value">${stats.totalParticipants}</div>
                <div class="stat-label">Total Participants</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${stats.totalTickets}</div>
                <div class="stat-label">Total Tickets</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${stats.totalPoolADA?.toFixed(2) ?? '0.00'}</div>
                <div class="stat-label">Total Pool (ADA)</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${stats.roundNumber ?? '-'}</div>
                <div class="stat-label">Round Number</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${stats.timeUntilDrawFormatted ?? '-'}</div>
                <div class="stat-label">Time Until Draw</div>
            </div>
            <div class="stat-item">
                <div class="stat-value">${stats.salesOpen ? 'Open' : 'Closed'}</div>
                <div class="stat-label">Sales Status</div>
            </div>
        </div>
    `;
    document.getElementById('lotteryStats').innerHTML = statsHtml;
}

// Send ADA to contract (initialize contract)
async function sendAdaToContract() {
    try {
        if (!lucid || !walletAddress) {
            showStatus('Please connect your wallet first', 'error');
            return;
        }
        const amountAda = parseFloat(document.getElementById('initAmount').value);
        if (isNaN(amountAda) || amountAda < 2) {
            showStatus('Enter at least 2 ADA to initialize contract', 'error');
            return;
        }
        showStatus('Building transaction...', 'info');
        const tx = await lucid
            .newTx()
            .payToAddress(SCRIPT_ADDRESS, { lovelace: BigInt(amountAda * 1_000_000) })
            .complete();
        showStatus('Signing transaction...', 'info');
        const signedTx = await tx.sign().complete();
        showStatus('Submitting transaction...', 'info');
        const txHash = await signedTx.submit();
        showStatus(`Transaction submitted! Hash: ${txHash}`, 'success');
    } catch (error) {
        console.error('Send ADA error:', error);
        showStatus(`Transaction failed: ${error.message}`, 'error');
    }
}

// Show status message
function showStatus(message, type = 'info') {
    const statusElement = document.getElementById('transactionStatus');
    statusElement.textContent = message;
    statusElement.className = type;
    if (type === 'success') {
        setTimeout(() => {
            statusElement.textContent = '';
            statusElement.className = '';
        }, 5000);
    }
}