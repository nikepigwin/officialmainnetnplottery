// API Configuration
const API_BASE_URL = 'https://official-mainnet-nplottery-backend.onrender.com';

// Debug: Log script loading
console.log('🎰 Nikepig Lottery Frontend Initialized');
console.log('📁 Script.js loaded successfully');
console.log('🔧 Debug mode: ON');
console.log('🌐 API Base URL:', API_BASE_URL);

// Mobile and PWA specific variables
let deferredPrompt = null;
let isMobile = false;
let isStandalone = false;

// Mobile detection and PWA setup
function initializeMobileFeatures() {
    // Detect mobile device
    isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    
    // Add mobile-specific classes
    if (isMobile) {
        document.body.classList.add('mobile-device');
    }
    if (isStandalone) {
        document.body.classList.add('pwa-standalone');
    }
    
    // Handle PWA install prompt
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        
        // Show install button if not already installed
        if (!isStandalone) {
            showPWAInstallButton();
        }
    });
    
    // Handle PWA installed event
    window.addEventListener('appinstalled', () => {
        deferredPrompt = null;
        hidePWAInstallButton();
    });
    
    // Add touch-friendly event listeners
    addTouchEventListeners();
    
    // Handle viewport changes
    handleViewportChanges();
}

// Add touch event listeners for better mobile interaction
function addTouchEventListeners() {
    
    // Prevent zoom on double tap for buttons
    const buttons = document.querySelectorAll('.btn, .quantity-btn, .slider-arrow');
    buttons.forEach(button => {
        button.addEventListener('touchend', (e) => {
            e.preventDefault();
            button.click();
        });
        
        // Prevent double-tap zoom
        let lastTouchEnd = 0;
        button.addEventListener('touchend', (e) => {
            const now = (new Date()).getTime();
            if (now - lastTouchEnd <= 300) {
                e.preventDefault();
            }
            lastTouchEnd = now;
        });
    });
    
    // Add swipe gestures for pool slider
    let startX = 0;
    let startY = 0;
    const poolSlider = document.querySelector('.pool-slider-container');
    
    if (poolSlider) {
        poolSlider.addEventListener('touchstart', (e) => {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        });
        
        poolSlider.addEventListener('touchend', (e) => {
            const endX = e.changedTouches[0].clientX;
            const endY = e.changedTouches[0].clientY;
            const diffX = startX - endX;
            const diffY = startY - endY;
            
            // Only handle horizontal swipes
            if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 50) {
                if (diffX > 0) {
                    // Swipe left - next slide
                    document.getElementById('poolSliderRight')?.click();
                } else {
                    // Swipe right - previous slide
                    document.getElementById('poolSliderLeft')?.click();
                }
            }
        });
    }
}

// Handle viewport changes for responsive design
function handleViewportChanges() {
    const mediaQuery = window.matchMedia('(max-width: 768px)');
    
    function handleViewportChange(e) {
        if (e.matches) {
            document.body.classList.add('mobile-viewport');
        } else {
            document.body.classList.remove('mobile-viewport');
        }
    }
    
    mediaQuery.addListener(handleViewportChange);
    handleViewportChange(mediaQuery);
}

// Show PWA install button
function showPWAInstallButton() {
    const existingButton = document.getElementById('pwa-install-btn');
    if (existingButton) return;
    
    const installButton = document.createElement('button');
    installButton.id = 'pwa-install-btn';
    installButton.className = 'btn btn-primary pwa-install-btn';
    installButton.innerHTML = '📱 Install App';
    installButton.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 1000;
        background: #3BC117;
        color: white;
        border: none;
        border-radius: 8px;
        padding: 12px 20px;
        font-size: 14px;
        box-shadow: 0 4px 12px rgba(59, 193, 23, 0.3);
        animation: slideIn 0.3s ease-out;
    `;
    
    installButton.addEventListener('click', async () => {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            if (outcome === 'accepted') {
                hidePWAInstallButton();
            }
        }
    });
    
    document.body.appendChild(installButton);
}

// Hide PWA install button
function hidePWAInstallButton() {
    const installButton = document.getElementById('pwa-install-btn');
    if (installButton) {
        installButton.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => {
            installButton.remove();
        }, 300);
    }
}

// Enhanced mobile keyboard handling
function setupMobileKeyboardHandling() {
    const inputs = document.querySelectorAll('input[type="number"], input[type="text"]');
    
    inputs.forEach(input => {
        // Prevent zoom on focus (iOS)
        input.addEventListener('focus', () => {
            if (isMobile) {
                input.style.fontSize = '16px';
            }
        });
        
        // Handle virtual keyboard events
        input.addEventListener('blur', () => {
            if (isMobile) {
                input.style.fontSize = '';
            }
        });
    });
}

// Token management functions
async function loadAcceptedTokens() {
  try {
    console.log('🔄 Loading accepted tokens...');
    const response = await fetchAPI('/api/lottery/accepted-tokens');
    if (response.success) {
      acceptedTokens = response.tokens;
      // Patch: ensure ADA always has policyId 'lovelace'
      acceptedTokens = acceptedTokens.map(t => t.symbol === 'ADA' ? { ...t, policyId: 'lovelace' } : t);
      console.log('✅ Loaded accepted tokens:', acceptedTokens);
      // Fetch live prices from Minswap for each non-ADA token
      await fetchAndUpdateTokenPrices();
      console.log('🔄 Calling updateCustomDropdown...');
      updateCustomDropdown();
    } else {
      console.error('❌ Failed to load accepted tokens:', response.error);
    }
  } catch (error) {
    console.error('❌ Error loading accepted tokens:', error);
  }
}

// Fetch live prices from Minswap for each non-ADA token and update acceptedTokens
async function fetchAndUpdateTokenPrices() {
  // Policy IDs for known tokens (update as needed)
  const minswapPolicyIds = {
    'SNEK': '279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b',
    'NIKEPIG': 'REPLACE_WITH_NIKEPIG_POLICY_ID' // TODO: Replace with actual policyId
  };
  const fetchPrice = async (policyId, symbol) => {
    try {
      const url = `https://api.minswap.org/pools/${policyId}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Minswap API error');
      const data = await res.json();
      let price = 1;
      if (data && data.assetA && data.assetB && data.assetA.symbol === 'ADA') {
        price = parseFloat(data.price);
      } else if (data && data.assetA && data.assetB && data.assetB.symbol === 'ADA') {
        price = 1 / parseFloat(data.price);
      }
      return price;
    } catch (e) {
      console.warn(`Failed to fetch Minswap price for ${symbol}:`, e);
      return null;
    }
  };
  // Update acceptedTokens with live prices
  await Promise.all(acceptedTokens.map(async (token, i) => {
    if (token.symbol === 'ADA') {
      acceptedTokens[i].price = 1;
      return;
    }
    const policyId = minswapPolicyIds[token.symbol];
    if (!policyId) return;
    const price = await fetchPrice(policyId, token.symbol);
    if (price && !isNaN(price)) {
      acceptedTokens[i].price = price;
    }
  }));
  // No periodic refresh
  cleanupPriceUpdates();
}

// Token prices are now handled directly in the accepted tokens endpoint
// No need for separate price fetching functions

// Get current price for a token (using exchange rates from accepted tokens)
function getTokenPrice(policyId) {
  if (policyId === 'lovelace') {
    return 1; // ADA is always 1:1
  }
  
  // Get price from accepted tokens (exchange rate)
  const token = acceptedTokens.find(t => t.policyId === policyId);
  if (token && token.price) {
    return token.price;
  }
  
  return 1; // Default fallback
}

// Calculate token amount needed for 5 ADA equivalent
function calculateTokenAmount(policyId) {
  if (policyId === 'lovelace') {
    return 5; // 5 ADA
  }
  
  const price = getTokenPrice(policyId);
  if (price > 0) {
    return (5 / price).toFixed(6);
  }
  
  // Fallback to exchange rate
  const token = acceptedTokens.find(t => t.policyId === policyId);
  if (token) {
    return (5 * token.exchangeRate).toFixed(token.decimals || 0);
  }
  
  return '5.00';
}

function getSelectedTokenInfo() {
  // Always use 'lovelace' for ADA policyId
  if (selectedToken === 'lovelace' || selectedToken === '' || selectedToken === undefined) {
    return acceptedTokens.find(t => t.policyId === 'lovelace') || { policyId: 'lovelace', symbol: 'ADA', name: 'ADA', price: 1, decimals: 6 };
  }
  return acceptedTokens.find(t => t.policyId === selectedToken) || { policyId: 'lovelace', symbol: 'ADA', name: 'ADA', price: 1, decimals: 6 };
}

// Wallet state
let connectedWallet = null;
let walletApi = null;

// DOM Elements - will be initialized when DOM is ready
let poolAmount, lotteryForm, notification;
let connectWalletBtn, disconnectWalletBtn, walletAddressSpan, walletBalanceSpan;
let totalPool;
let ticketCountInput, totalCostSpan;
let spinner;
let walletDisconnected, walletConnected;
let tokenSelect, tokenExchangeRate;

// Token state
let acceptedTokens = [];
let selectedToken = 'lovelace';
let tokenPrices = {};
let priceUpdateInterval = null;

// 🕒 COUNTDOWN TIMER STATE (3-minute rounds)
let countdownTimer = null;
let roundStartTime = null;
let roundDuration = 3 * 60 * 1000; // 3 minutes in milliseconds

// 🔔 WEBSOCKET NOTIFICATIONS REMOVED
// let websocket = null;

// Initialize Lucid for transaction building
async function initializeLucid() {
  // Debug: Log Blockfrost and network setup
  console.log('Current window.Blockfrost:', window.Blockfrost);
  console.log('Setting up Lucid with Blockfrost...');
  // Get Blockfrost configuration from backend
  console.log('Fetching Blockfrost configuration from backend...');
  const configResponse = await fetch(`${API_BASE_URL}/api/blockfrost-config`);
  if (!configResponse.ok) throw new Error(`Failed to fetch Blockfrost config: ${configResponse.status}`);
  const config = await configResponse.json();
  console.log('Blockfrost config received:', { url: config.url, projectId: config.projectId ? '***' : 'empty' });
  if (!config.projectId) throw new Error('Blockfrost API key not configured. Please set BLOCKFROST_API_KEY in backend environment.');
  // Force Lucid to use Preview network
  lucid = await window.Lucid.new(
    new window.Blockfrost(config.url, config.projectId),
    'Preview'
  );
  console.log('✅ Lucid initialized successfully with Blockfrost');
  console.log('Lucid network should be Preview.');
  return lucid;
}

function hexToBytes(hex) {
  if (hex.startsWith('0x')) hex = hex.slice(2);
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

// Address conversion function
async function convertRawAddressToBech32(rawAddress, networkId = 0) {
  // If already bech32, return as is
  if (rawAddress.startsWith('addr_')) return rawAddress;

  console.log('Converting address:', rawAddress, 'networkId:', networkId);

  // Try Lucid's utility if available
  if (window.Lucid && window.Lucid.utils && window.Lucid.utils.addressToBech32) {
    try {
      console.log('Using Lucid addressToBech32...');
      return window.Lucid.utils.addressToBech32(rawAddress, networkId);
    } catch (e) {
      console.error('Lucid addressToBech32 failed:', e);
    }
  } else {
    console.log('Lucid utils not available:', {
      lucid: !!window.Lucid,
      utils: !!(window.Lucid && window.Lucid.utils),
      addressToBech32: !!(window.Lucid && window.Lucid.utils && window.Lucid.utils.addressToBech32)
    });
  }

  // Try CardanoWasm if available
  if (window.CardanoWasm) {
    try {
      console.log('Using CardanoWasm...');
      const { Address } = window.CardanoWasm;
      const address = Address.from_bytes(hexToBytes(rawAddress));
      return address.to_bech32();
    } catch (e) {
      console.error('CardanoWasm address conversion failed:', e);
    }
  }

  // Fallback: For testnet, try to construct a simple bech32 address
  // This is a simplified approach - in production, use proper libraries
  if (networkId === 0) { // Testnet
    try {
      console.log('Using fallback testnet address construction...');
      // For testnet, we'll use a known testnet address format
      // This is a temporary workaround
      return 'addr_test1qrpxk3kmrcy7u2dthmndu3nm7wvw9jlfmnm909qyvjck9qkapqpp4z89q6t3fsynhzslj4ad2t9vpyx3mlw0lszpv98sftkqtc';
    } catch (e) {
      console.error('Fallback address construction failed:', e);
    }
  }

  throw new Error('Could not convert raw address to bech32 format. Address length: ' + rawAddress.length);
}

// CBOR Decoding for wallet balance
function decodeCBORBalance(cborHex) {
  try {
    // Remove 0x prefix if present
    if (cborHex.startsWith('0x')) {
      cborHex = cborHex.slice(2);
    }
    
    // Convert hex to bytes
    const bytes = new Uint8Array(cborHex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(cborHex.substr(i * 2, 2), 16);
    }
    
    // Simple CBOR decoding for Cardano balance
    // Cardano balance is typically encoded as a map with coin values
    // For ADA, we look for the coin value in lovelace (1 ADA = 1,000,000 lovelace)
    
    if (bytes.length < 2) return 0;
    
    // Check if it's a map (major type 5)
    const firstByte = bytes[0];
    const majorType = (firstByte >> 5) & 0x07;
    const additionalInfo = firstByte & 0x1F;
    
    if (majorType === 5) { // Map
      let offset = 1;
      let mapSize = additionalInfo;
      
      // Handle additional info
      if (additionalInfo === 31) {
        // Indefinite length map - not supported in this simple decoder
        return 0;
      } else if (additionalInfo >= 24) {
        // Additional bytes for size
        const sizeBytes = additionalInfo - 23;
        mapSize = 0;
        for (let i = 0; i < sizeBytes; i++) {
          mapSize = (mapSize << 8) | bytes[offset + i];
        }
        offset += sizeBytes;
      }
      
      // Look for coin entries in the map
      for (let i = 0; i < mapSize; i++) {
        // Skip key (asset ID)
        const keyType = (bytes[offset] >> 5) & 0x07;
        const keyInfo = bytes[offset] & 0x1F;
        offset++;
        
        if (keyInfo >= 24) {
          const keySizeBytes = keyInfo - 23;
          offset += keySizeBytes;
        }
        
        // Read value (coin amount)
        if (offset < bytes.length) {
          const valueType = (bytes[offset] >> 5) & 0x07;
          const valueInfo = bytes[offset] & 0x1F;
          offset++;
          
          if (valueType === 0) { // Unsigned integer
            let value = valueInfo;
            if (valueInfo >= 24) {
              const valueSizeBytes = valueInfo - 23;
              value = 0;
              for (let j = 0; j < valueSizeBytes; j++) {
                value = (value << 8) | bytes[offset + j];
              }
              offset += valueSizeBytes;
            }
            return value / 1_000_000; // Convert lovelace to ADA
          } else {
            // Skip non-integer values
            if (valueInfo >= 24) {
              const valueSizeBytes = valueInfo - 23;
              offset += valueSizeBytes;
            }
          }
        }
      }
    }
    
    return 0;
  } catch (error) {
    console.error('Error decoding CBOR balance:', error);
    return 0;
  }
}

// Notification system with stacking and deduplication
let notificationQueue = [];
let activeNotifications = new Set();

function showNotification(message, type = 'info') {
    console.log(`showNotification called with: "${message}", type: "${type}"`);
    
    const notificationContainer = document.getElementById('notification-container');
    if (!notificationContainer) {
        console.error('Notification container not found');
        return;
    }
    
    // Check if this exact notification is already active
    const notificationKey = `${message}-${type}`;
    if (activeNotifications.has(notificationKey)) {
        console.log('Notification already active, skipping:', message);
        return;
    }
    
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    notification.style.display = 'block';
    
    // Add click handler to dismiss
    notification.addEventListener('click', () => {
        dismissNotification(notification, notificationKey);
    });
    
    // Add to container
    notificationContainer.appendChild(notification);
    
    // Add to active notifications set
    activeNotifications.add(notificationKey);
    
    // Trigger animation
    setTimeout(() => {
        notification.classList.add('show');
    }, 10);
    
    // Auto-dismiss after 5 seconds
    setTimeout(() => {
        if (notification.parentNode) {
            dismissNotification(notification, notificationKey);
        }
    }, 5000);
    
    console.log('Notification added:', message);
}

function dismissNotification(notification, notificationKey) {
    // Remove from active notifications
    activeNotifications.delete(notificationKey);
    
    // Animate out
        notification.classList.remove('show');
    
    // Remove from DOM after animation
        setTimeout(() => {
        if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
        }
    }, 300);
    
    console.log('Notification dismissed:', notification.textContent);
}

function formatADA(amount) {
    if (amount === null || amount === undefined || isNaN(amount)) {
        console.log('🔍 formatADA received invalid amount:', amount);
        return '0.00 ADA';
    }
    return `${Number(amount).toFixed(2)} ADA`;
}

function formatAmountOnly(amount) {
    if (amount === null || amount === undefined || isNaN(amount)) {
        console.log('🔍 formatAmountOnly received invalid amount:', amount);
        return '0.00';
    }
    return `${Number(amount).toFixed(2)}`;
}

function formatAddress(address) {
    if (!address || typeof address !== 'string') {
        console.log('🔍 formatAddress received invalid address:', address);
        return 'Unknown Address';
    }
    if (address.length > 8) {
        // Only apply if both sides are at least 4 chars
        return `${address.substring(0, 4)}....${address.substring(address.length - 4)}`;
    }
    return address;
}

// API Functions
async function fetchAPI(endpoint, options = {}) {
    try {
        const url = `${API_BASE_URL}${endpoint}`;
        console.log('Making API request to:', url);
        console.log('Request options:', options);
        
        const response = await fetch(url, {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        });

        console.log('Response status:', response.status);
        console.log('Response headers:', Object.fromEntries(response.headers.entries()));

        if (!response.ok) {
            const errorText = await response.text();
            console.error('HTTP error response:', errorText);
            throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
        }

        const data = await response.json();
        console.log('Response data:', data);
        return data;
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}

// Lottery API Functions
async function getLotteryStats() {
    try {
        console.log('🔍 Fetching lottery stats...');
        const response = await fetchAPI('/api/lottery/stats');
        console.log('📊 Lottery stats response:', response);
        
        if (response.success && response.stats) {
            return response.stats;
        } else {
            console.error('❌ Invalid lottery stats response:', response);
            throw new Error('Invalid lottery stats response');
        }
    } catch (error) {
        console.error('Failed to get lottery stats:', error);
        throw error;
    }
}



async function getWinners() {
    try {
        console.log('🔍 Fetching winners...');
        const response = await fetchAPI('/api/lottery/winners');
        console.log('🏆 Winners response:', response);
        
        if (response.success) {
            // Return empty array if winners is null (no winners yet)
            const winners = response.winners || [];
            console.log('🏆 Winners data:', winners);
            return winners;
        } else {
            console.error('❌ Invalid winners response:', response);
            throw new Error('Invalid winners response');
        }
    } catch (error) {
        console.error('Failed to get winners:', error);
        throw error;
    }
}

async function buyTickets(address, ticketCount, tokenPolicyId) {
    try {
        console.log('Making API call to buy tickets:', { address, ticketCount, tokenPolicyId });
        const response = await fetchAPI('/api/lottery/buy-tickets', {
            method: 'POST',
            body: JSON.stringify({ address, ticketCount, tokenPolicyId })
        });
        console.log('API response received:', response);
        return response;
    } catch (error) {
        console.error('Failed to buy tickets:', error);
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            name: error.name
        });
        throw error;
    }
}

// Lottery Functions
async function refreshStats() {
    try {
        console.log('🔄 Refreshing lottery stats...');
        const stats = await getLotteryStats();
        console.log('📊 Stats received:', stats);
        // Update stats display with detailed logging
        console.log('🔍 Updating stats display with:', { 
            roundNumber: stats.roundNumber,
            totalParticipants: stats.totalParticipants, 
            totalTickets: stats.totalTickets,
            salesOpen: stats.salesOpen
        });
        

        
        // 🎯 UPDATE LEFT COLUMN: Connect statistics to left column elements
        const leftTotalParticipants = document.getElementById('total-participants-display');
        const leftTotalTickets = document.getElementById('total-tickets-display');
        
        if (leftTotalParticipants) leftTotalParticipants.textContent = stats.totalParticipants || 0;
        if (leftTotalTickets) leftTotalTickets.textContent = stats.totalTickets || 0;
        
        // 🕒 Update countdown timer with backend round start time (only if not processing)
        if (stats.processingStatus === 'idle') {
            if (stats.roundStartTime) {
                startCountdownTimer(stats.roundStartTime);
            } else if (roundStartTime === null) {
                // Start countdown from now if no backend time available
                startCountdownTimer(Date.now());
            }
        }
        

        // Update pool values with detailed logging
        console.log('🔄 Updating pool values:', stats.multiTokenPool);
        const poolElements = {
          poolADA: document.getElementById('poolADA'),
          poolSNEK: document.getElementById('poolSNEK'),
          poolNIKEPIG: document.getElementById('poolNIKEPIG'),
          poolADAOnly: document.getElementById('poolADAOnly'),
          poolSNEKOnly: document.getElementById('poolSNEKOnly'),
          poolNIKEPIGOnly: document.getElementById('poolNIKEPIGOnly')
        };
        
        // Log missing elements
        const missingElements = Object.entries(poolElements)
          .filter(([name, element]) => !element)
          .map(([name]) => name);
        if (missingElements.length > 0) {
          console.log('🔍 Missing pool elements:', missingElements);
        }
        
        // Update individual pool values
        const adaAmount = (stats.multiTokenPool?.ADA || 0);
        const snekAmount = (stats.multiTokenPool?.SNEK || 0);
        const nikepigAmount = (stats.multiTokenPool?.NIKEPIG || 0);
        
        if (poolElements.poolADA) poolElements.poolADA.textContent = adaAmount.toFixed(2);
        if (poolElements.poolSNEK) poolElements.poolSNEK.textContent = snekAmount.toFixed(2);
        if (poolElements.poolNIKEPIG) poolElements.poolNIKEPIG.textContent = nikepigAmount.toFixed(2);
        if (poolElements.poolADAOnly) poolElements.poolADAOnly.textContent = adaAmount.toFixed(2);
        if (poolElements.poolSNEKOnly) poolElements.poolSNEKOnly.textContent = snekAmount.toFixed(2);
        if (poolElements.poolNIKEPIGOnly) poolElements.poolNIKEPIGOnly.textContent = nikepigAmount.toFixed(2);
        
        // 🎯 UPDATE LEFT COLUMN: Connect pool amounts to left column elements
        const leftPoolADA = document.getElementById('pool-ada-amount');
        const leftPoolSNEK = document.getElementById('pool-snek-amount');
        const leftPoolNIKEPIG = document.getElementById('pool-nikepig-amount');
        
        if (leftPoolADA) leftPoolADA.textContent = adaAmount.toFixed(2);
        if (leftPoolSNEK) leftPoolSNEK.textContent = snekAmount.toFixed(2);
        if (leftPoolNIKEPIG) leftPoolNIKEPIG.textContent = nikepigAmount.toFixed(2); // NIKEPIG as decimal
        
        console.log('✅ Pool values updated:', { adaAmount, snekAmount, nikepigAmount });
        
        // 🎯 UPDATE PROCESSING STATUS AND SALES STATUS
        const salesStatusDisplay = document.getElementById('sales-status-display');
        const countdownDisplay = document.getElementById('countdown-timer-display');
        const buyTicketsBtn = document.getElementById('buy-tickets');
        const flashBuyButtons = document.querySelectorAll('.flash-buy-btn');
        
        // Track previous states for notifications
        if (!window.previousProcessingStatus) {
          window.previousProcessingStatus = 'idle';
        }
        if (!window.previousSalesStatus) {
          window.previousSalesStatus = true;
        }
        
        if (stats.processingStatus) {
          console.log('🔄 Processing status:', stats.processingStatus);
          
          // Update sales status based on processing status
          if (stats.processingStatus === 'rollover') {
            if (salesStatusDisplay) salesStatusDisplay.textContent = 'Processing Rollover';
            if (countdownDisplay) countdownDisplay.textContent = 'Rollover';
            // Stop countdown timer during processing
            stopCountdownTimer();
            // Darken buttons and prevent clicks during rollover
            if (buyTicketsBtn) {
              buyTicketsBtn.classList.add('processing');
            }
            flashBuyButtons.forEach(btn => {
              btn.classList.add('processing');
            });
            // Show processing message
            showProcessingMessage('Ticket sales are paused while we process the results. Please wait.');
            
            // Show rollover notification when status changes
            if (window.previousProcessingStatus !== 'rollover') {
              showNotification('↪️ Rollover', 'info');
            }
          } else if (stats.processingStatus === 'jackpot') {
            if (salesStatusDisplay) salesStatusDisplay.textContent = 'Preparing Jackpot';
            if (countdownDisplay) countdownDisplay.textContent = 'Jackpot!';
            // Stop countdown timer during processing
            stopCountdownTimer();
            // Darken buttons and prevent clicks during jackpot
            if (buyTicketsBtn) {
              buyTicketsBtn.classList.add('processing');
            }
            flashBuyButtons.forEach(btn => {
              btn.classList.add('processing');
            });
            // Show processing message
            showProcessingMessage('Ticket sales are paused while we process the results. Please wait.');
            
            // Show jackpot notification when status changes
            if (window.previousProcessingStatus !== 'jackpot') {
              showNotification('🏆 Jackpot', 'success');
              // Trigger jackpot celebration animation
              triggerJackpotCelebration();
              // Refresh winners after jackpot notification
              setTimeout(() => {
                refreshWinners();
              }, 3000); // Wait 3 seconds for backend to process
            }
          } else if (stats.processingStatus === 'idle') {
            if (salesStatusDisplay) salesStatusDisplay.textContent = 'Open';
            if (countdownDisplay) {
              // Restore normal countdown if we have round start time
              if (stats.roundStartTime) {
                startCountdownTimer(stats.roundStartTime);
              }
            }
            // Remove processing state when idle
            if (buyTicketsBtn) {
              buyTicketsBtn.classList.remove('processing');
            }
            flashBuyButtons.forEach(btn => {
              btn.classList.remove('processing');
            });
            // Hide processing message
            hideProcessingMessage();
            
            // Show new round notification when transitioning from processing to idle
            if (window.previousProcessingStatus === 'rollover' || window.previousProcessingStatus === 'jackpot') {
              showNotification('🎉 New Round', 'success');
              // Refresh winners immediately when new round starts (after successful distribution)
              setTimeout(() => {
                refreshWinners();
              }, 2000); // Wait 2 seconds for backend to update
            }
          }
          
          // Update previous processing status
          window.previousProcessingStatus = stats.processingStatus;
        }
        
        // Handle sales status changes
        const currentSalesStatus = stats.salesOpen;
        if (window.previousSalesStatus !== currentSalesStatus) {
          if (currentSalesStatus) {
            showNotification('🎉 New Round', 'success');
          }
          window.previousSalesStatus = currentSalesStatus;
        }
        
        // Update button states based on sales status
        updateButtonStates(currentSalesStatus);
        
        console.log('✅ Stats updated successfully');
        if (arguments.length > 0) {
            showNotification('Stats refreshed successfully', 'success');
        }
    } catch (error) {
        console.error('❌ Failed to refresh stats:', error);
        showNotification('Failed to refresh stats', 'error');
    }
}



async function fetchAndShowPrizeStatus() {
  if (!connectedWallet || !window.currentUserAddress) {
    hideWinnerBanner();
    return;
  }
  
  try {
    // Use stored address instead of fetching from wallet to avoid connection issues
    const walletAddress = window.currentUserAddress;
    
    const res = await fetch(`${API_BASE_URL}/api/lottery/prize-status?address=${encodeURIComponent(walletAddress)}`);
    const data = await res.json();
    if (data.isWinner) {
      showWinnerBanner(data.prizeAmount / 1_000_000, data.txHash, data.status);
    } else {
      hideWinnerBanner();
    }
  } catch (e) {
    console.log('Prize status check failed:', e);
    hideWinnerBanner();
  }
}

// Fetch and display user's tickets
async function fetchAndDisplayUserTickets() {
  try {
    if (!window.currentUserAddress) {
      console.log('No wallet connected, skipping user tickets fetch');
      return;
    }
    
    const response = await fetchAPI(`/api/lottery/my-tickets?address=${window.currentUserAddress}`);
    if (response.success) {
      console.log('User tickets data:', response);
      
      const userTicketsDisplay = document.getElementById('user-tickets-display');
      
      if (userTicketsDisplay) {
        userTicketsDisplay.textContent = response.tickets;
      }
    }
  } catch (error) {
    console.error('Failed to fetch user tickets:', error);
  }
}

async function refreshWinners() {
    try {
        console.log('🔄 Refreshing winners...');
        const response = await fetchAPI('/api/lottery/winners');
        if (!response.success) throw new Error('Failed to fetch winners');
        const { currentRoundWinners, historicalWinners } = response;
        
        console.log('📊 Winners response:', {
            currentRoundWinners: currentRoundWinners?.length || 0,
            historicalWinners: historicalWinners?.length || 0,
            currentRoundWinnersData: currentRoundWinners,
            historicalWinnersData: historicalWinners
        });
        
        // Flatten historical winners structure - backend returns nested structure
        let flatHistoricalWinners = [];
        if (historicalWinners && Array.isArray(historicalWinners)) {
            console.log('🔍 Processing historical winners structure...');
            historicalWinners.forEach(round => {
                if (round.winners && Array.isArray(round.winners)) {
                    round.winners.forEach(winner => {
                        flatHistoricalWinners.push({
                            ...winner,
                            roundNumber: round.roundNumber,
                            timestamp: round.drawDate || winner.claimedAt,
                            txHash: winner.transactionId,
                            amountADA: winner.amount // Backend uses 'amount', frontend expects 'amountADA'
                        });
                    });
                }
            });
            console.log('🔍 Flattened historical winners:', flatHistoricalWinners);
        }
        
        // Store in global variables for lottery-winners page access
        window.flatHistoricalWinners = flatHistoricalWinners;
        window.currentRoundWinners = currentRoundWinners || [];
        
        // Check if current user is a winner (for winner banner)
        let userIsWinner = false;
        let userPrize = 0;
        let userTxHash = '';
        let userStatus = '';
        
        // Check current round winners for user
        if (currentRoundWinners && currentRoundWinners.length > 0) {
            const userWinner = currentRoundWinners.find(winner => 
                connectedWallet && winner.address && winner.address === window.currentUserAddress
            );
            if (userWinner) {
                                userIsWinner = true;
                userPrize = userWinner.amountADA;
                userTxHash = userWinner.txHash || '';
                userStatus = userWinner.status || '';
            }
        }
        
        // Check flattened historical winners for user 
        if (!userIsWinner && flatHistoricalWinners && flatHistoricalWinners.length > 0) {
            const userWinner = flatHistoricalWinners.find(winner => 
                connectedWallet && winner.address && winner.address === window.currentUserAddress
            );
            if (userWinner) {
                userIsWinner = true;
                userPrize = userWinner.amountADA;
                userTxHash = userWinner.txHash || '';
                userStatus = userWinner.status || '';
            }
        }
        
        // Show/hide winner banner
            if (userIsWinner) {
                showWinnerBanner(userPrize, userTxHash, userStatus);
            } else {
                hideWinnerBanner();
        }
        
        // Sync winners data to lottery-winners page
        syncWinnersToTrackerPage();
        
        // Save winners data to localStorage for lottery-winners page access
        saveWinnersToLocalStorage();

        // --- Historical Winners (Scroll Container) ---
        const historicalWinnersList = document.getElementById('historicalWinnersList');
        if (!flatHistoricalWinners || flatHistoricalWinners.length === 0) {
            historicalWinnersList.innerHTML = '<p>No historical winners yet</p>';
        } else {
            // Group winners by round number (same round = same box)
            const groupedByRound = {};
            
            flatHistoricalWinners.forEach(winner => {
                const roundKey = winner.roundNumber || 'unknown-round';
                
                if (!groupedByRound[roundKey]) {
                    groupedByRound[roundKey] = {
                        winners: [],
                        timestamp: winner.timestamp,
                        roundNumber: winner.roundNumber,
                        txHash: winner.txHash // Use first winner's txHash for the group
                    };
                }
                groupedByRound[roundKey].winners.push(winner);
            });
            
            // Sort groups by timestamp (most recent first)
            const sortedGroups = Object.entries(groupedByRound).sort((a, b) => {
                const timestampA = a[1].timestamp ? new Date(a[1].timestamp) : new Date(0);
                const timestampB = b[1].timestamp ? new Date(b[1].timestamp) : new Date(0);
                return timestampB - timestampA;
            });
            
            console.log(`📊 Total rounds found: ${sortedGroups.length}`);
            
            let html = '<div class="historical-winners-container">';
            
            // Use only real data - limit to 7 most recent rounds (first-in-last-out)
            const limitedGroups = sortedGroups.slice(0, 7);
            console.log(`📊 Displaying ${limitedGroups.length} most recent rounds`);
            
            if (limitedGroups.length === 0) {
                historicalWinnersList.innerHTML = '<p>No historical winners yet</p>';
                return;
            }
            
            limitedGroups.forEach(([roundKey, group]) => {
                // Sort winners within group by position (1st, 2nd, 3rd place)
                const sortedWinners = group.winners.sort((a, b) => {
                    // Sort by position (1st place first, 3rd place last)
                    const positionA = a.position || 0;
                    const positionB = b.position || 0;
                    return positionA - positionB;
                });
                
                html += '<div class="winner-group">';
                
                // Add round info header - only show date
                const timestamp = group.timestamp ? new Date(group.timestamp) : null;
                const formattedDate = timestamp ? `${timestamp.getDate()}-${timestamp.getMonth() + 1}-${timestamp.getFullYear()}` : '';
                html += `<div class="winner-group-header">${formattedDate || 'Recent Round'}</div>`;
                
                // Add compact winners grid (3 winners in one box)
                html += '<div class="winners-grid">';
                sortedWinners.forEach(winner => {
                    const address = winner.address || 'Unknown Address';
                    
                    // Handle real token amounts from backend
                    const amounts = [];
                    if (winner.amountADA || winner.amount) {
                        amounts.push({
                            amount: winner.amountADA || winner.amount,
                            token: 'ADA'
                        });
                    }
                    if (winner.amountSNEK) {
                        amounts.push({
                            amount: winner.amountSNEK,
                            token: 'SNEK'
                        });
                    }
                    if (winner.amountNIKEPIG) {
                        amounts.push({
                            amount: winner.amountNIKEPIG,
                            token: 'NIKEPIG'
                        });
                    }

                    html += `
                        <div class="winner-compact">
                            <div class="winner-info">
                                <div class="winner-address">${formatAddress(address)}</div>
                                <div class="winner-amounts">
                                    ${amounts.map(item => `
                                        <div class="winner-amount-item">
                                            <span class="winner-amount">${formatAmountOnly(item.amount)}</span>
                                            <span class="winner-token">${item.token}</span>
                            </div>
                                    `).join('')}
                                </div>
                            </div>
                        </div>
                    `;
                });
                html += '</div>'; // Close winners-grid
                
                // Add transaction button below the group with real transaction ID
                const txHash = group.txHash || '';
                const cardanoscanUrl = txHash ? 
                    `https://preview.cardanoscan.io/transaction/${txHash}` : 
                    '#';
                
                html += `
                        <div class="winner-tx-group">
                        <a href="${cardanoscanUrl}" target="_blank" 
                           class="tx-button" title="View transaction on Cardanoscan"
                           ${!txHash ? 'style="opacity: 0.5; pointer-events: none;"' : ''}>
                            View Transaction
                            </a>
                        </div>
                    `;
                
                html += '</div>'; // Close winner-group
            });
            html += '</div>';
            console.log('🔍 Rendering historical winners:', html);
            historicalWinnersList.innerHTML = html;
        }

        // Only show notification if manually triggered
        if (arguments.length > 0) {
            showNotification('Winners refreshed successfully', 'success');
        }
        await fetchAndShowPrizeStatus();
    } catch (error) {
        console.error('❌ Failed to refresh winners - detailed error:', error);
        console.error('❌ Error message:', error.message);
        console.error('❌ Error stack:', error.stack);
        hideWinnerBanner();
        showNotification('Failed to refresh winners', 'error');
    }
}

// Wallet Connection Functions
async function connectWallet() {
  console.log('🔌 connectWallet function called!');
  console.log('🔌 Attempting to connect wallet...');
  
  try {
    // Initialize Lucid first
    if (!lucid) {
      lucid = await initializeLucid();
      window.lucid = lucid;
    }
    
    // Select wallet using web bundle API
    const api = await window.cardano.eternl.enable();
    lucid.selectWallet(api);
    window.lucid = lucid;
    
    // Get wallet address
    const address = await lucid.wallet.address();
    console.log('✅ Wallet connected, address:', address);
    console.log('Address prefix:', address.slice(0, 8));
    
    // Get wallet balance
    const utxos = await lucid.wallet.getUtxos();
    let totalLovelace = utxos.reduce((sum, utxo) => sum + BigInt(utxo.assets['lovelace'] || 0n), 0n);
    let balanceADA = Number(totalLovelace) / 1_000_000;
    
    console.log('✅ Balance calculated:', balanceADA, 'ADA');
    
    // Store wallet connection
    connectedWallet = lucid.wallet;
    window.currentUserAddress = address;
    
    // Check if this is the admin wallet
    const adminWalletAddress = 'addr_test1qrpxk3kmrcy7u2dthmndu3nm7wvw9jlfmnm909qyvjck9qkapqpp4z89q6t3fsynhzslj4ad2t9vpyx3mlw0lszpv98sftkqtc';
    const isAdminWallet = address === adminWalletAddress;
    
    // Show/hide admin section based on wallet
    const adminSection = document.getElementById('adminSection');
    if (adminSection) {
      adminSection.style.display = isAdminWallet ? 'block' : 'none';
    }
    
    // Update UI (wallet balance is optional since we removed it from display)
    const walletBalanceSpan = document.getElementById('wallet-ada');
    if (walletBalanceSpan) {
      walletBalanceSpan.textContent = balanceADA.toFixed(2);
    }
    
    const walletAddressSpan = document.getElementById('wallet-address');
    if (walletAddressSpan) {
      walletAddressSpan.textContent = formatAddress(address);
    }
    
    // Show connected state
    const walletDisconnected = document.getElementById('wallet-disconnected');
    const walletConnected = document.getElementById('wallet-connected');
    
    if (walletDisconnected) walletDisconnected.style.display = 'none';
    if (walletConnected) walletConnected.style.display = 'block';
    
    // Show ticket section when wallet connects
    const myTicketsSection = document.getElementById('my-tickets-section');
    if (myTicketsSection) {
      myTicketsSection.style.display = 'flex';
    }
    
    // Update sales status display
    updateSalesStatus();
    
            showNotification('🟢 Wallet Connected', 'success');
    
    // Refresh data
    await Promise.all([refreshStats(), refreshWinners()]);
    await fetchAndShowPrizeStatus();
    await fetchAndDisplayUserTickets();
    
    // Reset buyTicketsBtn state
    const buyTicketsBtn = document.getElementById('buy-tickets');
    if (buyTicketsBtn) {
      buyTicketsBtn.textContent = 'Buy Tickets';
      buyTicketsBtn.disabled = false;
    }
    
    // After successful connection:
    // Note: Don't modify connect button - we use separate wallet states now
    // const connectBtn = document.getElementById('connect-wallet-btn');
    // if (connectBtn) {
    //   connectBtn.textContent = 'Disconnect Wallet';
    //   connectBtn.classList.remove('btn-primary');
    //   connectBtn.classList.add('btn-danger');
    //   connectBtn.onclick = disconnectWallet;
    // }
    // const addrDiv = document.getElementById('wallet-address-top');
    // if (addrDiv) {
    //   addrDiv.textContent = formatAddress(window.currentUserAddress);
    //   addrDiv.style.display = 'block';
    // }
    
    updateAdminButtonState();
  } catch (error) {
    console.error('❌ Wallet connection failed:', error);
            showNotification('🔴 Wallet Connection Failed', 'error');
  }
}

function disconnectWallet() {
  connectedWallet = null;
  lucid = null;
  
  // Hide admin section when disconnecting
  const adminSection = document.getElementById('adminSection');
  if (adminSection) {
    adminSection.style.display = 'none';
  }
  
  // Hide connected state
  if (walletDisconnected) {
    walletDisconnected.style.display = 'flex';
  }
  if (walletConnected) {
    walletConnected.style.display = 'none';
  }
  
  if (walletAddressSpan) {
    walletAddressSpan.textContent = 'e0dd...614f';
  }
  // Wallet balance is optional since we removed it from display
  if (walletBalanceSpan) {
    walletBalanceSpan.textContent = '0';
  }
  
      showNotification('🔴 Wallet Disconnected', 'info');

  // Reset user tickets display
  const userTicketsDisplay = document.getElementById('user-tickets-display');
  if (userTicketsDisplay) {
    userTicketsDisplay.textContent = '0';
  }

  // Reset buyTicketsBtn state
  const buyTicketsBtn = document.getElementById('buy-tickets');
  if (buyTicketsBtn) {
    buyTicketsBtn.textContent = 'Buy Tickets';
    buyTicketsBtn.disabled = false;
  }
  // Note: Don't modify connect button - we use separate wallet states now
  // const connectBtn = document.getElementById('connect-wallet-btn');
  // if (connectBtn) {
  //   connectBtn.textContent = 'Connect Wallet';
  //   connectBtn.classList.remove('btn-danger');
  //   connectBtn.classList.add('btn-primary');
  //   connectBtn.onclick = connectWallet;
  // }
  // const addrDiv = document.getElementById('wallet-address-top');
  // if (addrDiv) {
  //   addrDiv.textContent = '';
  //   addrDiv.style.display = 'none';
  // }

  updateAdminButtonState();
}

// Buy Tickets Function
async function buyTicketsForLottery(ticketCount) {
  try {
    console.log('🟢 buyTicketsForLottery called with', ticketCount);
    if (!lucid || !lucid.wallet) {
      throw new Error('Please connect your wallet first');
    }
    
    // Get the current script address from the backend
    const configResponse = await fetchAPI('/api/blockfrost-config');
    const actualScriptAddress = configResponse.scriptAddress || scriptAddress;
    
    // Fetch UTxOs
    console.log('🔍 Fetching UTxOs at script address:', actualScriptAddress);
    const utxos = await lucid.utxosAt(actualScriptAddress);
    console.log('Script UTxOs:', utxos);
    // Select only UTxOs with a valid, non-empty datum (fields.length === 5)
    const validUtxo = utxos.find((u) => {
      if (!u.datum || u.datum === 'd87980') return false;
      try {
        const d = window.Lucid.Data.from(u.datum);
        return d.fields && d.fields.length === 5;
      } catch {
        return false;
      }
    });
    if (!validUtxo) {
      showNotification('No valid lottery UTxO with initialized datum found. Please initialize the contract.', 'error');
      console.error('❌ No valid lottery UTxO with initialized datum found. Aborting.');
      throw new Error('No valid lottery UTxO with initialized datum found');
    }
    console.log('✅ Selected UTxO for lottery:', validUtxo);
    if (!utxos.length) {
      console.error('❌ No UTxO at script address. You must initialize the contract with a valid datum.');
      showNotification('No UTxO at script address. Please initialize the contract.', 'error');
      throw new Error('No UTxO at script address');
    }
    utxos.forEach((utxo, idx) => {
      console.log(`UTxO[${idx}] datum:`, utxo.datum, 'datumHash:', utxo.datumHash);
    });
    // --- PATCH: Minimal datum with correct types and valid bytes for Lucid Data schema ---
    // Only use minimal fields for datum update
    // Call buyTickets and handle response
    const address = window.currentUserAddress;
    const tokenPolicyId = getSelectedTokenInfo().policyId;
    console.log('🟢 Calling buyTickets with', { address, ticketCount, tokenPolicyId });
    const buyResponse = await buyTickets(address, ticketCount, tokenPolicyId);
    console.log('🟢 buyTickets response:', buyResponse);
    if (!buyResponse || !buyResponse.success) {
      showNotification('Failed to build transaction: ' + (buyResponse?.error || 'Unknown error'), 'error');
      throw new Error('Failed to build transaction: ' + (buyResponse?.error || 'Unknown error'));
    }
    // If transaction parameters are returned, build transaction on frontend
    if (buyResponse.transactionParams) {
      console.log('🟢 Transaction parameters received, building transaction on frontend');
      try {
        const params = buyResponse.transactionParams;
        console.log('🟢 Transaction parameters:', params);
        
        // Convert script UTxO assets back to bigint
        const scriptUtxo = {
          ...params.scriptUtxo,
          assets: Object.fromEntries(
            Object.entries(params.scriptUtxo.assets).map(([k, v]) => [k, BigInt(v)])
          )
        };
        
        // Build the transaction with proper wallet context
        console.log('🟢 Building transaction with Lucid...');
        console.log('🔍 Transaction params received:', params);
        const Data = window.Lucid.Data;
        
        // Try to use CBOR data from backend, fall back to manual construction
        let redeemerData, datumData;
        
        // Try using minimal data to isolate the issue
        console.log('🔍 Using CBOR redeemer:', params.redeemerCbor);
        console.log('🔍 Using CBOR datum:', params.datumCbor);
        
        // Use minimal redeemer - try empty array or simple data
        try {
          redeemerData = Data.to([]);
          console.log('🔍 Using empty array for redeemer');
        } catch (e) {
          console.log('🔍 Empty array redeemer failed:', e.message);
          try {
            redeemerData = Data.to(0);
            console.log('🔍 Using simple number for redeemer');
          } catch (e2) {
            console.log('🔍 Simple redeemer failed, using raw CBOR:', e2.message);
            redeemerData = params.redeemerCbor;
          }
        }
        
        // Use minimal datum - try simple data structure
        try {
          datumData = Data.to([]);
          console.log('🔍 Using empty array for datum');
        } catch (e) {
          console.log('🔍 Empty array datum failed:', e.message);
          try {
            datumData = Data.to(0);
            console.log('🔍 Using simple number for datum');
          } catch (e2) {
            console.log('🔍 Simple datum failed, using raw CBOR:', e2.message);
            datumData = params.datumCbor;
          }
        }
        
        console.log('🔍 Converted redeemer:', redeemerData);
        console.log('🔍 Converted datum:', datumData);
        console.log('🔍 Script validator length:', params.scriptValidator.length);
        console.log('🔍 Script validator (first 100 chars):', params.scriptValidator.substring(0, 100));
        console.log('🔍 Script UTxO:', scriptUtxo);
        console.log('🔍 Payment amount:', params.paymentAmount, typeof params.paymentAmount);
        
        // Use simple payment to pool wallet (no smart contract needed)
        console.log('🏦 Using simple payment to pool wallet');
        const poolWalletAddress = params.poolWalletAddress || params.scriptAddress;
        console.log('🏦 Sending funds to pool wallet:', poolWalletAddress);
        
        try {
          const tx = await lucid
            .newTx()
            .payToAddress(poolWalletAddress, { lovelace: BigInt(params.paymentAmount) })
            .complete();
          
          console.log('🔍 ✅ Simple payment built successfully!');
          
          const signedTx = await tx.sign().complete();
          const txHash = await signedTx.submit();
          
          showNotification('✅ Transaction Successful', 'success');
          console.log('🎟️ Payment submitted! Tx Hash:', txHash);
          
          // Confirm ticket purchase with backend
          console.log('🔄 Starting backend confirmation...');
          try {
            const confirmResponse = await fetch(`${API_BASE_URL}/api/lottery/confirm-ticket`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                address: window.currentUserAddress,
                ticketCount: ticketCount,
                txHash: txHash,
                poolWalletAddress: poolWalletAddress
              })
            });
            
            if (confirmResponse.ok) {
              const confirmResult = await confirmResponse.json();
              console.log('✅ Ticket purchase confirmed with backend:', confirmResult);
            } else {
              console.error('❌ Backend confirmation failed:', confirmResponse.status, await confirmResponse.text());
            }
          } catch (confirmError) {
            console.error('❌ Failed to confirm purchase with backend:', confirmError);
          }
          
          return;
          
        } catch (paymentError) {
          console.log('🔍 ❌ Simple payment failed:', paymentError.message);
          throw paymentError;
        }
      } catch (walletError) {
        showNotification('❌ Transaction Failed', 'error');
        console.error('❌ Transaction build/signing failed:', walletError);
        throw walletError;
      }
    } else if (buyResponse.unsignedTx) {
      // Fallback to old method if backend still returns unsignedTx
      console.log('🟢 Unsigned transaction received, requesting wallet to sign and submit');
      try {
        // Convert hex string to transaction object using fromTx
        const unsignedTxObj = lucid.fromTx(buyResponse.unsignedTx);
        console.log('🟢 Transaction object created:', unsignedTxObj);
        const signedTx = await lucid.wallet.signTx(unsignedTxObj);
        const txHash = await lucid.wallet.submitTx(signedTx);
        showNotification('✅ Transaction Successful', 'success');
        console.log('🎟️ Ticket purchase submitted! Tx Hash:', txHash);
        
        // Refresh user's tickets and stats after successful purchase
        await fetchAndDisplayUserTickets();
        await refreshStats();
      } catch (walletError) {
        showNotification('❌ Transaction Failed', 'error');
        console.error('❌ Wallet signing/submission failed:', walletError);
        throw walletError;
      }
    } else {
      showNotification('No transaction data returned from backend', 'error');
      console.warn('No transaction data returned from backend');
    }
  } catch (error) {
    console.error('Ticket purchase error:', error);
            showNotification('❌ Transaction Failed', 'error');
    throw error;
  }
}

// Update sales status display
function updateSalesStatus() {
  const salesStatusDisplay = document.getElementById('sales-status-display');
  if (salesStatusDisplay) {
    // This will be updated based on backend data
    salesStatusDisplay.textContent = 'Open';
  }
}

// Flash Buy functionality
function setupFlashBuyButtons() {
  const flashBuyButtons = document.querySelectorAll('.flash-buy-btn');
  
  flashBuyButtons.forEach(button => {
    button.addEventListener('click', async (e) => {
      e.preventDefault();
      
      // Check if sales are closed
      if (button.classList.contains('processing') || button.disabled) {
        showNotification('🔒 Sales Closed', 'error');
        return;
      }
      
      if (!connectedWallet || !window.currentUserAddress) {
        showNotification('🟡 Connect your Wallet', 'error');
        return;
      }
      
      const ticketCount = parseInt(button.getAttribute('data-tickets'));
      console.log(`⚡ Flash buying ${ticketCount} tickets`);
      
      try {
        // Update the ticket input
        const ticketInput = document.getElementById('ticket-amount');
        if (ticketInput) {
          ticketInput.value = ticketCount;
          // Trigger input event to update total cost
          ticketInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        
        // Call the existing buy tickets function
        await buyTicketsForLottery(ticketCount);
        
        showNotification(`⚡ Flash bought ${ticketCount} tickets!`, 'success');
      } catch (error) {
        console.error('Flash buy error:', error);
        showNotification('❌ Transaction Failed', 'error');
      }
    });
  });
}

// Add helper to get current pool amount in ADA
async function getCurrentPoolAmount() {
  try {
    const stats = await getLotteryStats();
    return stats.totalPoolADA || 0;
  } catch {
    return 0;
  }
}

// Sales status monitoring
let salesStatusMonitor = null;
let lastSalesStatus = null;

// Function to update button states based on sales status
function updateButtonStates(salesOpen) {
  const buyTicketsBtn = document.getElementById('buy-tickets');
  const flashBuyButtons = document.querySelectorAll('.flash-buy-btn');
  
  if (buyTicketsBtn) {
    if (!salesOpen) {
      buyTicketsBtn.disabled = true;
      buyTicketsBtn.classList.add('processing');
      buyTicketsBtn.textContent = 'Sales Closed';
    } else {
      buyTicketsBtn.disabled = false;
      buyTicketsBtn.classList.remove('processing');
      buyTicketsBtn.textContent = 'Buy Tickets';
    }
  }
  
  flashBuyButtons.forEach(button => {
    if (!salesOpen) {
      button.disabled = true;
      button.classList.add('processing');
    } else {
      button.disabled = false;
      button.classList.remove('processing');
    }
  });
}

// Initialize DOM elements
function initializeDOMElements() {
  console.log('🔍 Initializing DOM elements...');
  
  // Main UI elements
      // timeUntilDraw element removed from frontendv2 - using countdown-timer-display instead
  
  // Form elements - use the correct IDs from the HTML
  ticketCountInput = document.getElementById('ticket-amount'); // Changed from 'ticketCount'
  totalCostSpan = document.getElementById('ticket-total'); // Changed from 'totalCost'
  
  // Other elements
  lotteryForm = document.getElementById('lotteryForm');
  notification = document.getElementById('notification');
  connectWalletBtn = document.getElementById('connect-wallet-btn');
  disconnectWalletBtn = document.getElementById('disconnectWalletBtn');
  walletAddressSpan = document.getElementById('wallet-address');
  walletBalanceSpan = document.getElementById('wallet-ada'); // Changed from 'walletBalance'
  spinner = document.getElementById('spinner');
  walletDisconnected = document.getElementById('wallet-disconnected');
  walletConnected = document.getElementById('wallet-connected');
  
  // Token selection elements (new design doesn't need these)
  // tokenSelect = document.getElementById('token-select');
  // tokenExchangeRate = document.getElementById('token-exchange-rate');
  
  // Debug: Log all found elements
  console.log('🔍 DOM Elements found:');
  console.log('connectWalletBtn:', connectWalletBtn);
  console.log('disconnectWalletBtn:', disconnectWalletBtn);
  console.log('walletAddressSpan:', walletAddressSpan);
  console.log('walletBalanceSpan:', walletBalanceSpan);
  console.log('walletDisconnected:', walletDisconnected);
  console.log('walletConnected:', walletConnected);
  console.log('ticketCountInput:', ticketCountInput);
  console.log('totalCostSpan:', totalCostSpan);
  console.log('notification:', notification);
  console.log('spinner:', spinner);
  
  // Check if all essential elements were found
  const essentialElements = {
    connectWalletBtn, disconnectWalletBtn, walletAddressSpan,
    walletDisconnected, walletConnected, ticketCountInput, totalCostSpan
  };
  
  const missingElements = Object.entries(essentialElements)
    .filter(([name, element]) => !element)
    .map(([name]) => name);
  
  if (missingElements.length > 0) {
    console.error('❌ Missing essential DOM elements:', missingElements);
    console.error('�� Available elements with "wallet" in ID:', Array.from(document.querySelectorAll('[id*="wallet"]')).map(el => el.id));
    console.error('🔍 Available elements with "connect" in ID:', Array.from(document.querySelectorAll('[id*="connect"]')).map(el => el.id));
    return false;
  }
  
  console.log('✅ All essential DOM elements initialized successfully');
  return true;
}

// Event Listeners - will be set up in init function
let eventListenersSetup = false;

function setupEventListeners() {
  if (eventListenersSetup) return;
  
  console.log('🔧 Setting up event listeners...');
  

  
  // Event Listeners for main UI
  if (connectWalletBtn) {
    console.log('✅ Adding click listener to connectWalletBtn');
    connectWalletBtn.addEventListener('click', connectWallet);
  } else {
    console.error('❌ connectWalletBtn not found for event listener');
  }
  
  if (disconnectWalletBtn) {
    console.log('✅ Adding click listener to disconnectWalletBtn');
    disconnectWalletBtn.addEventListener('click', disconnectWallet);
  } else {
    console.error('❌ disconnectWalletBtn not found for event listener');
  }



  // Ticket amount controls
  const minusTicketBtn = document.getElementById('minus-ticket');
  const plusTicketBtn = document.getElementById('plus-ticket');
  const buyTicketsBtn = document.getElementById('buy-tickets');

  if (minusTicketBtn) {
    minusTicketBtn.addEventListener('click', () => {
      const currentValue = parseInt(ticketCountInput.value) || 1;
      if (currentValue > 1) {
        ticketCountInput.value = currentValue - 1;
        updateTotalCost();
      }
    });
  }

  if (plusTicketBtn) {
    plusTicketBtn.addEventListener('click', () => {
      const currentValue = parseInt(ticketCountInput.value) || 1;
        ticketCountInput.value = currentValue + 1;
        updateTotalCost();
    });
  }

  // Buy tickets button handler
  if (buyTicketsBtn) {
    console.log('✅ Adding click listener to buyTicketsBtn');
    buyTicketsBtn.addEventListener('click', async (e) => {
      console.log('🔘 Buy tickets button clicked!');
      e.preventDefault();
      
      // Check if sales are closed
      if (buyTicketsBtn.classList.contains('processing') || buyTicketsBtn.disabled) {
        showNotification('🔒 Sales Closed', 'error');
        return;
      }
      
      const ticketCount = parseInt(ticketCountInput.value);
      console.log('🎫 Attempting to buy', ticketCount, 'tickets');
      if (!ticketCount || ticketCount <= 0) {
        showNotification('⚡ Select a Ticket', 'error');
        return;
      }
      if (!connectedWallet) {
        showNotification('🟡 Connect your Wallet', 'error');
        return;
      }
      const purchaseWalletAddress = window.currentUserAddress;
      try {
        buyTicketsBtn.textContent = 'Processing...';
        // Add log before calling buyTicketsForLottery
        console.log('🚀 Calling buyTicketsForLottery with', ticketCount);
        await buyTicketsForLottery(ticketCount);

      } catch (error) {
        console.error('❌ Error in buyTicketsBtn handler:', error);
        showNotification('❌ Transaction Failed', 'error');
      } finally {
        buyTicketsBtn.textContent = 'Buy Tickets';
      }
    });
  } else {
    console.error('❌ buyTicketsBtn not found!');
    console.log('🔍 Available buttons:', Array.from(document.querySelectorAll('button')).map(btn => ({ id: btn.id, text: btn.textContent })));
  }

  // Flash buy buttons
  const flashBuyButtons = document.querySelectorAll('[data-amt]');
  flashBuyButtons.forEach(button => {
    button.addEventListener('click', () => {
      const amount = parseInt(button.getAttribute('data-amt'));
      ticketCountInput.value = amount;
      updateTotalCost();
    });
  });



  // Ticket count input handler
  if (ticketCountInput) {
    ticketCountInput.addEventListener('input', updateTotalCost);
  }
  
  // Token selection handler (now handled by click events on token options)
  // if (tokenSelect) {
  //   tokenSelect.addEventListener('change', onTokenChange);
  // }
  
  // Event Listeners for admin controls
  const closeRoundBtn = document.getElementById('close-round-btn');
  const distributePrizesBtn = document.getElementById('distribute-prizes-btn');
  const startNewRoundBtn = document.getElementById('start-new-round-btn');
  const viewHistoryBtn = document.getElementById('view-history-btn');
  const initializeContractBtn = document.getElementById('initialize-contract-btn');
  
  if (closeRoundBtn) {
    closeRoundBtn.addEventListener('click', async () => {
      console.log('🔘 Close round button clicked!');
      try {
        showSpinner(true, 'Closing round and selecting winners...');
        
        // First, check current sales status
        const beforeStats = await fetchAPI('/api/lottery/stats');
        console.log('📊 Sales status BEFORE close round:', {
          salesOpen: beforeStats.stats.salesOpen,
          roundNumber: beforeStats.stats.roundNumber
        });
        
        const response = await fetch(`${API_BASE_URL}/api/lottery/admin/close-round`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        
        const result = await response.json();
        showSpinner(false);
        
        if (result.success) {
          showNotification('✅ Round closed successfully! Winners selected and new round automatically started.', 'success');
          console.log('Round close result:', result);
          
          // Immediately check sales status after close round
          console.log('⏳ Checking sales status immediately after close round...');
          const afterStats = await fetchAPI('/api/lottery/stats');
          console.log('📊 Sales status AFTER close round:', {
            salesOpen: afterStats.stats.salesOpen,
            roundNumber: afterStats.stats.roundNumber
          });
          
          // Show transition notification
          if (beforeStats.stats.salesOpen && afterStats.stats.salesOpen) {
            showNotification('🔄 Sales briefly closed during winner selection, now open for new round!', 'info');
          }
          
          // Add a delay to ensure backend has processed everything
          console.log('⏳ Waiting 2 seconds for backend to process round closure...');
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Refresh all data
          await Promise.all([
            refreshStats(),
            refreshWinners()
          ]);
          
          // Show additional info about the winners
          if (result.winners && result.winners.length > 0) {
            const winnerInfo = result.winners.map(w => 
              `${w.positionText}: ${formatAddress(w.address)} (${formatADA(w.amount / 1000000)} ADA)`
            ).join(', ');
            showNotification(`🏆 Winners: ${winnerInfo}`, 'info');
          }
        } else {
          showNotification(`❌ Failed to close round: ${result.error}`, 'error');
        }
      } catch (error) {
        showSpinner(false);
        console.error('Close round error:', error);
        showNotification(`❌ Failed to close round: ${error.message}`, 'error');
      }
    });
    console.log('✅ Adding click listener to closeRoundBtn');
  }
  
  if (distributePrizesBtn) {
    distributePrizesBtn.addEventListener('click', async () => {
      console.log('🔘 Distribute prizes button clicked!');
      try {
        showSpinner(true, 'Distributing prizes...');
        const response = await fetch(`${API_BASE_URL}/api/lottery/admin/distribute-prizes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        
        const result = await response.json();
        showSpinner(false);
        
        if (result.success) {
          showNotification('✅ Prizes distributed successfully!', 'success');
          console.log('Prize distribution result:', result);
          await refreshStats();
          await refreshWinners();
        } else {
          showNotification(`❌ Failed to distribute prizes: ${result.error}`, 'error');
        }
      } catch (error) {
        showSpinner(false);
        console.error('Distribute prizes error:', error);
        showNotification(`❌ Failed to distribute prizes: ${error.message}`, 'error');
      }
    });
    console.log('✅ Adding click listener to distributePrizesBtn');
  }
  
  if (startNewRoundBtn) {
    startNewRoundBtn.addEventListener('click', async () => {
      console.log('🔘 Start new round button clicked!');
      try {
        showSpinner(true, 'Starting new round...');
        const response = await fetch(`${API_BASE_URL}/api/lottery/admin/start-new-round`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        
        const result = await response.json();
        showSpinner(false);
        
        if (result.success) {
          showNotification('✅ New round started successfully!', 'success');
          console.log('Start new round result:', result);
          
          // Add a delay to ensure backend has processed everything
          console.log('⏳ Waiting 2 seconds for backend to process new round...');
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Refresh all data
          await Promise.all([
            refreshStats(),
            refreshWinners()
          ]);
        } else {
          showNotification(`❌ Failed to start new round: ${result.error}`, 'error');
        }
      } catch (error) {
        showSpinner(false);
        console.error('Start new round error:', error);
        showNotification(`❌ Failed to start new round: ${error.message}`, 'error');
      }
    });
    console.log('✅ Adding click listener to startNewRoundBtn');
  }
  
  if (viewHistoryBtn) {
    viewHistoryBtn.addEventListener('click', async () => {
      console.log('🔘 View history button clicked!');
      try {
        showSpinner(true, 'Loading round history...');
        const response = await fetch(`${API_BASE_URL}/api/lottery/rounds-history`);
        
        const result = await response.json();
        showSpinner(false);
        
        if (result.success) {
          console.log('Round history:', result.history);
          showNotification(`📊 Loaded ${result.history.length} rounds of history`, 'info');
          
          // Display history in a simple format
          if (result.history.length > 0) {
            const latestRound = result.history[result.history.length - 1];
            const historyText = `Latest Round ${latestRound.roundNumber}: ${latestRound.winners.length} winners, ${latestRound.prizeDistributions.length} prizes distributed`;
            showNotification(historyText, 'info');
          } else {
            showNotification('No round history available yet', 'info');
          }
        } else {
          showNotification(`❌ Failed to load history: ${result.error}`, 'error');
        }
      } catch (error) {
        showSpinner(false);
        console.error('View history error:', error);
        showNotification(`❌ Failed to load history: ${error.message}`, 'error');
      }
    });
    console.log('✅ Adding click listener to viewHistoryBtn');
  }

  if (initializeContractBtn) {
    initializeContractBtn.addEventListener('click', async () => {
      console.log('🔘 Initialize contract button clicked!');
      try {
        if (!window.lucid || !window.lucid.wallet) {
          showNotification('❌ Please connect your wallet first', 'error');
          await connectWallet();
          updateAdminButtonState();
          return;
        }
        if (!window.currentUserAddress) {
          showNotification('❌ Please connect your wallet first', 'error');
          await connectWallet();
          updateAdminButtonState();
          return;
        }
        showSpinner(true, 'Initializing smart contract...');
        initializeContractBtn.disabled = true;
        initializeContractBtn.textContent = '⏳ Initializing...';
        const result = await initializeSmartContract();
        if (result.success) {
          showNotification(`🎉 Smart contract initialized successfully!\nTransaction Hash: ${result.txHash}`, 'success');
          console.log('Contract initialization result:', result);
        } else {
          showNotification(`❌ Contract initialization failed: ${result.error}`, 'error');
        }
      } catch (error) {
        console.error('Contract initialization error:', error);
        showNotification(`❌ Contract initialization error: ${error.message}`, 'error');
      } finally {
        updateAdminButtonState();
        initializeContractBtn.textContent = '🚀 Initialize Smart Contract';
        showSpinner(false);
      }
    });
    updateAdminButtonState();
  }

  
  // Footer tab functionality
  const footerTabs = document.querySelectorAll('.footer-tab');
  const footerContents = document.querySelectorAll('.footer-tab-content');
  const footerContentContainer = document.querySelector('.footer-content');
  
  footerTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.getAttribute('data-tab');
      const targetContent = document.getElementById(`${targetTab}-content`);
      
      // If the clicked tab is already active, close it
      if (tab.classList.contains('active')) {
        tab.classList.remove('active');
        targetContent.classList.remove('active');
        footerContentContainer.classList.remove('has-active-tab');
      } else {
      // Remove active class from all tabs and contents
      footerTabs.forEach(t => t.classList.remove('active'));
      footerContents.forEach(c => c.classList.remove('active'));
      
      // Add active class to clicked tab and corresponding content
      tab.classList.add('active');
        targetContent.classList.add('active');
        footerContentContainer.classList.add('has-active-tab');
      }
    });
  });
  
  eventListenersSetup = true;
  console.log('✅ Event listeners set up successfully');
  
  // Initialize info slider
  initializeInfoSlider();
  
  // Winners spreadsheet functionality
  const toggleWinnersBtn = document.getElementById('toggleWinnersSpreadsheet');
  if (toggleWinnersBtn) {
      toggleWinnersBtn.addEventListener('click', toggleWinnersSpreadsheet);
  }
  
  // Winners search functionality
  const winnersSearchInput = document.getElementById('winners-search');
  if (winnersSearchInput) {
      winnersSearchInput.addEventListener('input', (e) => {
          searchWinners(e.target.value);
      });
  }
  
  const clearSearchBtn = document.getElementById('clear-search');
  if (clearSearchBtn) {
      clearSearchBtn.addEventListener('click', clearWinnersSearch);
  }
  
  // Spreadsheet tab buttons (removed - no longer needed)
  // Tab switching functionality removed since we now show current month only
}

// Info Slider functionality
function initializeInfoSlider() {
  const slider = document.querySelector('.info-slider');
  const prevBtn = document.getElementById('info-prev-btn');
  const nextBtn = document.getElementById('info-next-btn');
  const dotsContainer = document.getElementById('info-dots');
  
  if (!slider || !prevBtn || !nextBtn || !dotsContainer) return;
  
  const items = slider.querySelectorAll('.info-item');
  const totalItems = items.length;
  const itemsPerSlide = window.innerWidth <= 768 ? 1 : 3; // 1 on mobile, 3 on desktop
  const totalSlides = Math.ceil(totalItems / itemsPerSlide);
  let currentSlide = 0;
  
  // Create dots for slides (not individual items)
  for (let i = 0; i < totalSlides; i++) {
    const dot = document.createElement('div');
    dot.className = `slider-dot ${i === 0 ? 'active' : ''}`;
    dot.addEventListener('click', () => goToSlide(i));
    dotsContainer.appendChild(dot);
  }
  
  function updateSlider() {
    const itemWidth = items[0].offsetWidth + 24; // Include gap
    const slideWidth = itemWidth * itemsPerSlide;
    slider.scrollLeft = currentSlide * slideWidth;
    
    // Update dots
    document.querySelectorAll('.slider-dot').forEach((dot, index) => {
      dot.classList.toggle('active', index === currentSlide);
    });
    
    // Never disable buttons - always allow looping
    prevBtn.disabled = false;
    nextBtn.disabled = false;
  }
  
  function goToSlide(slideIndex) {
    currentSlide = slideIndex;
    updateSlider();
  }
  
  function nextSlide() {
    currentSlide = (currentSlide + 1) % totalSlides; // Loop back to 0
    updateSlider();
  }
  
  function prevSlide() {
    currentSlide = (currentSlide - 1 + totalSlides) % totalSlides; // Loop to last slide
    updateSlider();
  }
  
  // Event listeners
  prevBtn.addEventListener('click', prevSlide);
  nextBtn.addEventListener('click', nextSlide);
  
  // Touch/swipe support for mobile
  let startX = 0;
  let endX = 0;
  
  slider.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
  });
  
  slider.addEventListener('touchend', (e) => {
    endX = e.changedTouches[0].clientX;
    const diff = startX - endX;
    
    if (Math.abs(diff) > 50) { // Minimum swipe distance
      if (diff > 0) {
        nextSlide();
      } else {
        prevSlide();
      }
    }
  });
  
  // Auto-play (optional)
  let autoPlayInterval;
  
  function startAutoPlay() {
    autoPlayInterval = setInterval(() => {
      nextSlide(); // Always move to next slide (loops automatically)
    }, 5000); // Change slide every 5 seconds
  }
  
  function stopAutoPlay() {
    clearInterval(autoPlayInterval);
  }
  
  // Start auto-play and stop on user interaction
  startAutoPlay();
  
  slider.addEventListener('mouseenter', stopAutoPlay);
  slider.addEventListener('mouseleave', startAutoPlay);
  prevBtn.addEventListener('click', stopAutoPlay);
  nextBtn.addEventListener('click', stopAutoPlay);
  
  // Handle window resize to update items per slide
  function handleResize() {
    const newItemsPerSlide = window.innerWidth <= 768 ? 1 : 3;
    if (newItemsPerSlide !== itemsPerSlide) {
      // Recalculate total slides and update dots
      const newTotalSlides = Math.ceil(totalItems / newItemsPerSlide);
      dotsContainer.innerHTML = '';
      
      for (let i = 0; i < newTotalSlides; i++) {
        const dot = document.createElement('div');
        dot.className = `slider-dot ${i === 0 ? 'active' : ''}`;
        dot.addEventListener('click', () => goToSlide(i));
        dotsContainer.appendChild(dot);
      }
      
      // Reset to first slide
      currentSlide = 0;
      updateSlider();
    }
  }
  
  window.addEventListener('resize', handleResize);
  
  // Initialize
  updateSlider();
}

// Update custom dropdown with tokens from backend
function updateCustomDropdown() {
  console.log('🔄 Updating custom dropdown...');
  const dropdownOptions = document.getElementById('dropdown-options');
  if (!dropdownOptions) {
    console.error('❌ Dropdown options element not found');
    return;
  }
  console.log('📋 Accepted tokens:', acceptedTokens);
  // Clear existing options
  dropdownOptions.innerHTML = '';
  // Add tokens from backend
  acceptedTokens.forEach(token => {
    // For ADA, force policyId to ''
    if (token.symbol === 'ADA') token.policyId = '';
    console.log('➕ Adding token:', token.symbol, 'Policy ID:', token.policyId);
    const tokenOption = document.createElement('div');
    tokenOption.className = 'token-option';
    tokenOption.setAttribute('data-token', token.policyId);
    // Get appropriate logo for known tokens
    let logoPath = '';
    if (token.symbol === 'ADA') {
      logoPath = 'img/cardanologo.png';
    } else if (token.symbol === 'SNEK') {
      logoPath = 'img/SNEKlogo.png';
    } else if (token.symbol === 'NIKEPIG') {
      logoPath = 'img/nikelogo.png';
    }
    // Only show logo and name (no price)
    tokenOption.innerHTML = `
      <div class="token-icon">
        <img src="${logoPath}" alt="${token.symbol}" class="token-logo">
      </div>
      <div class="token-details">
        <div class="token-name">${token.symbol}</div>
      </div>
    `;
    dropdownOptions.appendChild(tokenOption);
  });
  console.log('✅ Dropdown updated with', acceptedTokens.length, 'tokens');
  // Add click handlers to the new token options
  addTokenOptionHandlers();
  
  // Setup flash buy buttons
  setupFlashBuyButtons();
}

// Custom Dropdown Integration
function initializeCustomDropdown() {
  const dropdownTrigger = document.getElementById('dropdown-trigger');
  const dropdownOptions = document.getElementById('dropdown-options');
  
  if (!dropdownTrigger || !dropdownOptions) {
    console.error('❌ Dropdown elements not found');
    return;
  }
  
  console.log('✅ Initializing dropdown trigger...');
  
  // Remove existing event listeners to prevent duplicates
  const newDropdownTrigger = dropdownTrigger.cloneNode(true);
  dropdownTrigger.parentNode.replaceChild(newDropdownTrigger, dropdownTrigger);
  
  // Toggle dropdown
  newDropdownTrigger.addEventListener('click', function(e) {
    e.stopPropagation();
    console.log('🖱️ Dropdown clicked, toggling...');
    this.classList.toggle('open');
    dropdownOptions.classList.toggle('show');
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', function(e) {
    if (!newDropdownTrigger.contains(e.target)) {
      newDropdownTrigger.classList.remove('open');
      dropdownOptions.classList.remove('show');
    }
  });
  
  console.log('✅ Dropdown trigger initialized');
}

// Add click handlers to token options
function addTokenOptionHandlers() {
  const dropdownOptions = document.getElementById('dropdown-options');
  const dropdownTrigger = document.getElementById('dropdown-trigger');
  const selectedTokenDisplay = dropdownTrigger.querySelector('.selected-token');
  
  if (!dropdownOptions || !dropdownTrigger) {
    console.error('❌ Dropdown elements not found for token handlers');
    return;
  }
  
  console.log('🔄 Adding token option handlers...');
  
  // Handle token selection in dropdown
  dropdownOptions.querySelectorAll('.token-option').forEach(option => {
    // Remove existing event listeners
    const newOption = option.cloneNode(true);
    option.parentNode.replaceChild(newOption, option);
    
    newOption.addEventListener('click', function(e) {
      e.stopPropagation();
      console.log('🖱️ Token option clicked:', this.getAttribute('data-token'));
      
      // Remove selected class from all options
      dropdownOptions.querySelectorAll('.token-option').forEach(opt => {
        opt.classList.remove('selected');
      });
      
      // Add selected class to clicked option
      this.classList.add('selected');
      
      // Update the selected token display
      const tokenIcon = this.querySelector('.token-icon').innerHTML;
      const tokenName = this.querySelector('.token-name').textContent;
      
      selectedTokenDisplay.innerHTML = `
        <div class="token-icon">${tokenIcon}</div>
        <div class="token-details">
          <div class="token-name">${tokenName}</div>
        </div>
      `;
      
      // Update selectedToken variable
      // For ADA, force selectedToken to ''
      if (tokenName === 'ADA') {
        selectedToken = '';
      } else {
        selectedToken = this.getAttribute('data-token');
      }
      
      // No need to load token prices - using exchange rates from accepted tokens
      
      // Auto-set ticket quantity to 1 (5 ADA equivalent in selected token)
      if (ticketCountInput) {
        ticketCountInput.value = 1;
      }
      
      updateTotalCost();
      
      // Close dropdown
      dropdownTrigger.classList.remove('open');
      dropdownOptions.classList.remove('show');
      
      console.log('✅ Selected token:', tokenName, 'Policy ID:', selectedToken);
    });
  });
  
  console.log('✅ Token option handlers added');
}



// Health Check
async function checkBackendHealth() {
    try {
        console.log('🔍 Checking backend health...');
        const response = await fetch(`${API_BASE_URL}/health`);
        console.log('Health check response status:', response.status);
        
        if (response.ok) {
            const data = await response.json();
            console.log('✅ Backend is healthy:', data);
    
        } else {
            console.error('❌ Backend health check failed:', response.status);
            showNotification('Backend health check failed', 'error');
        }
    } catch (error) {
        console.error('❌ Backend health check error:', error);
        showNotification('Backend is not responding. Please check if the server is running.', 'error');
    }
}

// --- Smart Contract Initialization ---
async function initializeSmartContract() {
  console.log('🚀 Starting smart contract initialization...');
  try {
    if (!lucid) {
      lucid = await initializeLucid();
    }
    const SCRIPT_ADDRESS = "addr_test1wqphj86rnmxlzz9ntyrsu6rdk3ylpqsr492p3gz7wampp7cdsux3s";
    const MIN_ADA = 2000000n;
    // Minimal datum only - simplified structure
    const datum = {
      constructor: 0,
      fields: [
        { list: [ [ { bytes: "" }, { int: 0 } ] ] },
        { list: [ [ { bytes: "" }, { int: 5000000 } ] ] },
        { int: 0 },
        { list: [ { bytes: "" } ] },
        { list: [ [ { bytes: "" }, { list: [ { int: 100 } ] } ] ] }
      ]
    };
    // Use the datum directly without complex type definition
    const address = await lucid.wallet.address();
    const utxos = await lucid.wallet.getUtxos();
    const balance = utxos.reduce((sum, utxo) => sum + (utxo.assets.lovelace || 0n), 0n);
    if (balance < MIN_ADA) {
      return { success: false, error: "Insufficient balance" };
    }
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
    return { success: true, txHash };
  } catch (error) {
    console.error('❌ Error during contract initialization:', error);
    return { success: false, error: error.message };
  }
}

// Initialize the application
async function init() {
    console.log('🎰 Nikepig Lottery Frontend Initialized');
    console.log('%cNikepig Lottery: Make sure BOTH backend (npm run dev, port 3000) and frontend (python3 -m http.server 8000) are running!','color: #00ff99; font-weight: bold; font-size: 1.2em;');
    
    // Initialize mobile features and PWA
    initializeMobileFeatures();
    
    // Initialize DOM elements first
    const domInitialized = initializeDOMElements();
    if (!domInitialized) {
        console.error('❌ Failed to initialize DOM elements');
        return;
    }
    
    // Initialize custom dropdown
    initializeCustomDropdown();
    
    // Set up event listeners
    setupEventListeners();
    
    // Set up mobile keyboard handling
    setupMobileKeyboardHandling();
    
    // Debug: Check what's available globally
    console.log('Global objects available:');
    console.log('window.Lucid:', typeof window.Lucid);
    console.log('window.lucid:', typeof window.lucid);
    console.log('window.lucidCardano:', typeof window.lucidCardano);
    console.log('window.LucidCardano:', typeof window.LucidCardano);
    console.log('window.Blockfrost:', typeof window.Blockfrost);
    console.log('window.blockfrost:', typeof window.blockfrost);
    console.log('Available window properties:', Object.keys(window).filter(key => 
      key.toLowerCase().includes('lucid') || key.toLowerCase().includes('cardano') || key.toLowerCase().includes('blockfrost')
    ));
    
    // Initialize Lucid for transaction building
    let lucidInitialized = await initializeLucid();
    if (!lucidInitialized) {
        console.warn('⚠️ Lucid initialization failed, but continuing with basic functionality');
        console.warn('⚠️ Ticket purchases will work in demo mode without blockchain transactions');
    }
    
    // Check backend health
    await checkBackendHealth();
    
    // Test lottery stats API
    try {
        console.log('🔍 Testing lottery stats API...');
        const statsResponse = await fetch(`${API_BASE_URL}/api/lottery/stats`);
        console.log('Stats API response status:', statsResponse.status);
        
        if (statsResponse.ok) {
            const statsData = await statsResponse.json();
            console.log('✅ Lottery stats API working:', statsData);
        } else {
            console.error('❌ Lottery stats API failed:', statsResponse.status);
        }
    } catch (error) {
        console.error('❌ Lottery stats API error:', error);
    }
    
    // Initialize total cost display
    updateTotalCost();
    
    // Load initial data
    console.log('Loading initial data...');
    await Promise.all([
        refreshStats(),
        refreshWinners(),
        loadAcceptedTokens()
    ]);
    
    // Force refresh stats to ensure we have the latest data
    console.log('Force refreshing stats...');
    await refreshStats();
    
    // Set up auto-refresh every 30 seconds
    setInterval(async () => {
        await Promise.all([
            refreshStats(),
            refreshWinners()
        ]);
    }, 30000);
    
    // Set up frequent winner refresh during processing periods (every 10 seconds)
    setInterval(async () => {
        const stats = await getLotteryStats();
        if (stats.processingStatus === 'jackpot' || stats.processingStatus === 'rollover') {
            await refreshWinners();
        }
    }, 10000);
    
    // Start sales status monitoring
    startSalesStatusMonitoring();
    
    // 🔔 WebSocket removed to eliminate connection errors
    // connectWebSocket();
    
    // 🕒 Start initial countdown timer
    startCountdownTimer(Date.now());
}

// Update total cost display
function updateTotalCost() {
  if (!ticketCountInput) return;
  const ticketCount = parseInt(ticketCountInput.value) || 0;
  const tokenInfo = getSelectedTokenInfo();
  let totalCostText = '';

  console.log('🔄 Updating total cost for token:', tokenInfo);

  if (tokenInfo.policyId === 'lovelace') {
    // ADA calculation
    const totalCostADA = ticketCount * 5; // 5 ADA per ticket
    totalCostText = `${totalCostADA.toFixed(2)} ADA`;
  } else {
    // Other token calculation using exchange rate from backend
    const adaEquivalent = ticketCount * 5; // 5 ADA equivalent per ticket
    
    // Use exchange rate from accepted tokens (simpler approach)
    if (tokenInfo.price && tokenInfo.price > 0) {
      const tokenAmount = adaEquivalent / tokenInfo.price;
      // Show only 2 decimal places for native tokens to keep it clean
      const formattedAmount = tokenAmount.toFixed(2);
      totalCostText = `${formattedAmount} ${tokenInfo.symbol}`;
    } else {
      // Fallback to a default exchange rate if not available
      const defaultRate = 0.001; // Default rate for tokens without price
      const tokenAmount = adaEquivalent / defaultRate;
      const formattedAmount = tokenAmount.toFixed(2);
      totalCostText = `${formattedAmount} ${tokenInfo.symbol}`;
    }
  }

  console.log('💰 Total cost calculated:', totalCostText);

  // Update total cost span
  if (totalCostSpan) {
    totalCostSpan.textContent = totalCostText;
  }
  // Also update the custom dropdown total if present
  const customDropdownTotal = document.getElementById('custom-dropdown-total');
  if (customDropdownTotal) {
    customDropdownTotal.textContent = totalCostText;
  }
  
  // Update summary quantity
  const summaryQuantity = document.getElementById('summary-quantity');
  if (summaryQuantity) {
    summaryQuantity.textContent = ticketCount;
  }
}

// Export functions for global access (for onclick handlers)
window.refreshStats = refreshStats;
window.refreshWinners = refreshWinners;

// Start the application when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    // DOM is already loaded, run init immediately
    init();
}

// Cleanup function for price updates
function cleanupPriceUpdates() {
    // No interval to clear anymore, but keep function for compatibility
        priceUpdateInterval = null;
}

// Clean up when page is unloaded
window.addEventListener('beforeunload', cleanupPriceUpdates);

function showSpinner(show = true, message = '') {
  if (!spinner) return;
  spinner.style.display = show ? 'flex' : 'none';
  spinner.textContent = message || (show ? 'Processing...' : '');
}

// Winner banner functions disabled to prevent glitching
function showWinnerBanner(prizeAmount, txHash, status) {
  // Function disabled to prevent website glitching
}

function hideWinnerBanner() {
  // Function disabled to prevent website glitching
}

// 🕒 COUNTDOWN TIMER FUNCTIONS
function updateCountdown() {
  if (!roundStartTime) return;
  
  const now = Date.now();
  const elapsed = now - roundStartTime;
  const remaining = Math.max(0, roundDuration - elapsed);
  
  const displayText = remaining <= 0 ? "00:00" : 
    `${Math.floor(remaining / 60000)}:${Math.floor((remaining % 60000) / 1000).toString().padStart(2, '0')}`;
  
  // 🎯 UPDATE LEFT COLUMN: Connect countdown timer to left column element
  const leftCountdownTimer = document.getElementById('countdown-timer-display');
  if (leftCountdownTimer) leftCountdownTimer.textContent = displayText;
}

function startCountdownTimer(startTime) {
  if (countdownTimer) {
    clearInterval(countdownTimer);
  }
  
  roundStartTime = startTime || Date.now();
  console.log(`⏰ Starting countdown timer for round at ${new Date(roundStartTime).toISOString()}`);
  
  // Update immediately
  updateCountdown();
  
  // Update every second
  countdownTimer = setInterval(updateCountdown, 1000);
}

function stopCountdownTimer() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
    console.log('⏹️ Countdown timer stopped');
  }
}

// Show processing message inside flash buy section
function showProcessingMessage(message) {
  let processingMessage = document.getElementById('processing-message');
  if (!processingMessage) {
    processingMessage = document.createElement('div');
    processingMessage.id = 'processing-message';
    processingMessage.className = 'processing-message';
    // Insert inside flash buy section
    const flashBuySection = document.querySelector('.flash-buy-section');
    if (flashBuySection) {
      flashBuySection.appendChild(processingMessage);
    }
  }
  processingMessage.textContent = message;
  processingMessage.style.display = 'block';
}

// Hide processing message
function hideProcessingMessage() {
  const processingMessage = document.getElementById('processing-message');
  if (processingMessage) {
    processingMessage.style.display = 'none';
  }
}

// Jackpot celebration animation function
function triggerJackpotCelebration() {
    // Find the timer card (Time Until Draw section)
    const timerCard = document.querySelector('.timer-card');
    if (!timerCard) {
        console.log('Timer card not found for jackpot celebration');
        return;
    }
    
    // Remove any existing celebration classes
    timerCard.classList.remove('jackpot-celebration');
    
    // Add celebration class
    timerCard.classList.add('jackpot-celebration');
    
    // Remove celebration after 10 seconds (animation runs for 3s infinite, but we stop after 10s)
    setTimeout(() => {
        timerCard.classList.remove('jackpot-celebration');
    }, 10000);
}



// 🔔 WEBSOCKET FUNCTIONS REMOVED (was causing connection errors)
// function connectWebSocket() {
//   try {
//     const wsUrl = API_BASE_URL.replace('http', 'ws') + '/api/lottery/ws';
//     console.log('🔌 Connecting to WebSocket:', wsUrl);
//     
//     websocket = new WebSocket(wsUrl);
//     
//     websocket.onopen = () => {
//       console.log('✅ WebSocket connected');
//     };
//     
//     websocket.onmessage = (event) => {
//       try {
//         const data = JSON.parse(event.data);
//         console.log('📨 WebSocket message:', data);
//         
//         if (data.type === 'pool_update') {
//           // Handle rollover notifications
//           if (data.data.rollover) {
//             showNotification(`🔄 Round rolled over! Pool: ${data.data.poolAmount.toFixed(2)} ADA. Need ${data.data.minimumParticipants - data.data.participantCount} more participants.`, 'info');
//           } else if (data.data.freshRound) {
//             showNotification(`🎰 Fresh round started! Previous round distributed ${data.data.previousRound.pool.toFixed(2)} ADA after ${data.data.previousRound.rollovers} rollovers.`, 'success');
//           }
//           
//           // Update round timer
//           if (data.data.roundNumber) {
//             startCountdownTimer(Date.now());
//           }
//           
//           // Refresh stats
//           refreshStats();
//         } else if (data.type === 'winner_announcement') {
//           // Handle winner announcements
//           const winners = data.data.winners || [];
//           const winnerCount = winners.length;
//           const pool = data.data.totalPool || 0;
//           
//           showNotification(`🏆 Winners selected! ${winnerCount} winners from ${pool.toFixed(2)} ADA pool!`, 'success');
//           
//           // Show individual winners
//           winners.forEach((winner, index) => {
//             setTimeout(() => {
//               showNotification(`${winner.position}. ${winner.address.substring(0, 20)}... won ${winner.amount.toFixed(2)} ADA!`, 'success');
//             }, (index + 1) * 2000);
//           });
//           
//           // Refresh data
//           setTimeout(() => {
//             refreshStats();
//             refreshWinners();
//           }, 1000);
//         }
//       } catch (error) {
//         console.error('❌ Error parsing WebSocket message:', error);
//       }
//     };
//     
//     websocket.onclose = () => {
//       console.log('🔌 WebSocket disconnected, attempting to reconnect...');
//       setTimeout(connectWebSocket, 5000);
//     };
//     
//     websocket.onerror = (error) => {
//       console.error('❌ WebSocket error:', error);
//     };
//   } catch (error) {
//     console.error('❌ Failed to connect WebSocket:', error);
//   }
// }

// Sales status monitoring functions
function startSalesStatusMonitoring() {
  if (salesStatusMonitor) return;
  
  salesStatusMonitor = setInterval(async () => {
    try {
      const stats = await getLotteryStats();
      const currentSalesStatus = stats.salesOpen;
      
      // Check if sales status changed
      if (lastSalesStatus !== null && lastSalesStatus !== currentSalesStatus) {
        console.log('🔄 Sales status changed:', {
          from: lastSalesStatus ? 'Open' : 'Closed',
          to: currentSalesStatus ? 'Open' : 'Closed',
          roundNumber: stats.roundNumber
        });
        
        if (currentSalesStatus) {

        } else {

        }
      }
      
      lastSalesStatus = currentSalesStatus;
    } catch (error) {
      console.error('Sales status monitoring error:', error);
    }
  }, 5000); // Check every 5 seconds
  
  console.log('✅ Sales status monitoring started');
}

function stopSalesStatusMonitoring() {
  if (salesStatusMonitor) {
    clearInterval(salesStatusMonitor);
    salesStatusMonitor = null;
    console.log('⏹️ Sales status monitoring stopped');
  }
}

function updateAdminButtonState() {
  const btn = document.getElementById('initialize-contract-btn');
  if (btn) {
    const lucidReady = !!window.lucid;
    const walletReady = !!(window.lucid && window.lucid.wallet);
    const addressReady = !!window.currentUserAddress;
    const enabled = lucidReady && walletReady && addressReady;
    btn.disabled = !enabled;
    // Debug info in button tooltip
    btn.title = enabled
      ? 'Ready to initialize contract'
      : `lucid: ${lucidReady}, wallet: ${walletReady}, address: ${addressReady}`;
    // Also show debug info in the admin panel for quick diagnosis
    let debugDiv = document.getElementById('admin-debug-info');
    if (!debugDiv) {
      debugDiv = document.createElement('div');
      debugDiv.id = 'admin-debug-info';
      debugDiv.style = 'font-size:12px;color:#3BC117;margin-top:8px;word-break:break-all;';
      btn.parentNode.insertBefore(debugDiv, btn.nextSibling);
    }
    debugDiv.innerHTML =
      `<b>lucid:</b> ${lucidReady} | <b>wallet:</b> ${walletReady} | <b>address:</b> ${addressReady}<br>` +
      `<b>lucid:</b> ${window.lucid ? '[object]' : 'undefined'}<br>` +
      `<b>lucid.wallet:</b> ${window.lucid && window.lucid.wallet ? '[object]' : 'undefined'}<br>` +
      `<b>currentUserAddress:</b> ${window.currentUserAddress || 'undefined'}`;
  }
}

// === BEGIN: LotteryStateDatum Fill-in Form Logic ===

function createInput(placeholder = '', type = 'text', value = '') {
  const input = document.createElement('input');
  input.type = type;
  input.placeholder = placeholder;
  input.value = value;
  input.className = 'datum-form-input';
  return input;
}

function addPoolEntry(policy = '', amount = '') {
  const container = document.getElementById('totalPoolsList');
  const row = document.createElement('div');
  row.className = 'datum-list-row';
  const policyInput = createInput('policy_id (hex, e.g. 0x for ADA)', 'text', policy);
  const amountInput = createInput('amount', 'number', amount);
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.textContent = '✕';
  removeBtn.className = 'btn btn-danger btn-xs';
  removeBtn.onclick = () => row.remove();
  row.append(policyInput, amountInput, removeBtn);
  container.appendChild(row);
}

function addTicketPriceEntry(policy = '', price = '') {
  const container = document.getElementById('ticketPricesList');
  const row = document.createElement('div');
  row.className = 'datum-list-row';
  const policyInput = createInput('policy_id (hex, e.g. 0x for ADA)', 'text', policy);
  const priceInput = createInput('price', 'number', price);
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.textContent = '✕';
  removeBtn.className = 'btn btn-danger btn-xs';
  removeBtn.onclick = () => row.remove();
  row.append(policyInput, priceInput, removeBtn);
  container.appendChild(row);
}

function addAcceptedTokenEntry(policy = '') {
  const container = document.getElementById('acceptedTokensList');
  const row = document.createElement('div');
  row.className = 'datum-list-row';
  const policyInput = createInput('policy_id (hex, e.g. 0x for ADA)', 'text', policy);
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.textContent = '✕';
  removeBtn.className = 'btn btn-danger btn-xs';
  removeBtn.onclick = () => row.remove();
  row.append(policyInput, removeBtn);
  container.appendChild(row);
}

function addPrizeSplitEntry(policy = '', splits = ['']) {
  const container = document.getElementById('prizeSplitList');
  const row = document.createElement('div');
  row.className = 'datum-list-row';
  const policyInput = createInput('policy_id (hex, e.g. 0x for ADA)', 'text', policy);
  const splitsContainer = document.createElement('div');
  splitsContainer.className = 'splits-container';
  splits.forEach(split => addSplitInput(splitsContainer, split));
  const addSplitBtn = document.createElement('button');
  addSplitBtn.type = 'button';
  addSplitBtn.textContent = '+ Split';
  addSplitBtn.className = 'btn btn-secondary btn-xs';
  addSplitBtn.onclick = () => addSplitInput(splitsContainer, '');
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.textContent = '✕';
  removeBtn.className = 'btn btn-danger btn-xs';
  removeBtn.onclick = () => row.remove();
  row.append(policyInput, splitsContainer, addSplitBtn, removeBtn);
  container.appendChild(row);
}

function addSplitInput(container, value = '') {
  const input = createInput('split %', 'number', value);
  input.style.width = '70px';
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.textContent = '✕';
  removeBtn.className = 'btn btn-danger btn-xs';
  removeBtn.onclick = () => input.parentElement.remove();
  const wrapper = document.createElement('span');
  wrapper.className = 'split-input-wrapper';
  wrapper.append(input, removeBtn);
  container.appendChild(wrapper);
}

function getListValues(containerId, pair = false, nestedList = false) {
  const container = document.getElementById(containerId);
  const rows = Array.from(container.children);
  if (nestedList) {
    // For prizeSplit: [policy_id, [splits]]
    return rows.map(row => {
      const policy = row.children[0].value.trim();
      const splitsContainer = row.querySelector('.splits-container');
      const splits = Array.from(splitsContainer.querySelectorAll('input')).map(i => parseInt(i.value, 10));
      return [policy, splits];
    });
  } else if (pair) {
    return rows.map(row => [row.children[0].value.trim(), parseInt(row.children[1].value, 10)]);
  } else {
    return rows.map(row => row.children[0].value.trim());
  }
}

function showDatumFormNotification(msg, type = 'info') {
  const el = document.getElementById('datumFormNotification');
  if (!el) return;
  el.textContent = msg;
  el.className = 'notification ' + type;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 5000);
}

function clearDatumForm() {
  document.getElementById('totalPoolsList').innerHTML = '';
  document.getElementById('ticketPricesList').innerHTML = '';
  document.getElementById('acceptedTokensList').innerHTML = '';
  document.getElementById('prizeSplitList').innerHTML = '';
  document.getElementById('datumFillForm').reset();
}

function buildDatumFromForm() {
  // Build the datum object from form values
  return {
    constructor: 0,
    fields: [
      { list: getListValues('totalPoolsList', true) },
      { list: getListValues('ticketPricesList', true) },
      { int: document.getElementById('totalTicketsInput').value },
      { bool: document.getElementById('salesOpenInput').value === 'true' },
      { int: document.getElementById('salesCloseSlotInput').value },
      { int: document.getElementById('drawSlotInput').value },
      { int: document.getElementById('roundNumberInput').value },
      { list: getListValues('acceptedTokensList') },
      { list: getListValues('prizeSplitList', false, true) },
      { int: document.getElementById('burnPercentageInput').value },
      { int: document.getElementById('teamPercentageInput').value },
      { bytes: document.getElementById('adminPkhInput').value.trim() },
      { bool: document.getElementById('timingEnabledInput').value === 'true' },
      { int: document.getElementById('currentRoundStartTimeInput').value },
      { int: document.getElementById('roundDurationSecondsInput').value },
      { bytes: document.getElementById('burnAddressInput').value.trim() },
      { bytes: document.getElementById('teamAddressInput').value.trim() }
    ]
  };
}

async function submitDatumForm(e) {
  e.preventDefault();
  if (!window.lucid) {
    showDatumFormNotification('Lucid not initialized. Please connect your wallet first.', 'error');
    return;
  }
  const datum = buildDatumFromForm();
  const SCRIPT_ADDRESS = "addr_test1wyhrg9hr9mz2smdxsfwq5swa35gwtehlft5dyxrrf34285qfdxfw3";
  const MIN_ADA = 2000000;
  try {
    showDatumFormNotification('Submitting datum to contract...', 'info');
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
    showDatumFormNotification('Datum submitted! TxHash: ' + txHash, 'success');
    clearDatumForm();
  } catch (error) {
    showDatumFormNotification('Failed to submit datum: ' + (error.message || error), 'error');
  }
}

function setupDatumForm() {
  // Add one default entry for each list for user convenience
  addPoolEntry('0x', '0');
  addTicketPriceEntry('0x', '1000000');
  addAcceptedTokenEntry('0x');
  addPrizeSplitEntry('0x', ['90']);
  // Attach submit handler
  const form = document.getElementById('datumFillForm');
  if (form) form.onsubmit = submitDatumForm;
}

// Only run if admin section is present
if (document.getElementById('datumFillForm')) {
  setupDatumForm();
}
// === END: LotteryStateDatum Fill-in Form Logic ===
 
// --- Cardano Plutus Script Validator (update if redeployed) ---
const SCRIPT_VALIDATOR = {
  type: "PlutusV3",
  script: "59139759139401010029800aba2aba1aba0aab9faab9eaab9dab9a488888896600264653001300800198041804800cdc3a400530080024888966002600460106ea800e3300130093754007370e90004dc3a40092232330010010032233003001300200298041baa004488888c8cc8966002600e009132323232323232323232323298009bae30200019bac302000b9bac302000a9bad30200099bad30200089bae30200079bad30200069bad3020005992cc004c0780062b3001337129002180e800c5a2602e603a00280e22c80f8dd518100024dd69810001cdd71810001244444444444b3001302c00c89980e1bac302b017225980080144cc078030896600200513302000d2259800801407e2646644b300130350018998129bac3034001225980080144c018c0dc01e264600460700066eb4c0d80090344590321bae3032001303300137586062004817a264600460620066eb8c0bc00902d44c8c8cc896600260640071300530320068b205e375a605e0026eb8c0bc008c0bc004dd6181680120568b20521810000980f800980f000980e800980e000980d800980d000980c800980c000980b800980b00098089baa00c8acc004c02801226464653001375a602e003375a602e007375c602e0049112cc004c06c0120111640603017001301600130113754019159800980300244c8c8c8c8c8ca60026eb8c0680066eb0c0680166eb0c0680126eb0c06800e6eb8c0680092222259800981000344cc040dd6180f805912cc00400a26602400c44b300100289980a003912cc00400a26602c01044b300100280ac4c8c8cc8966002605800713005302c0068b2052375a60520026eb8c0a4008c0a4004dd61813801204a8991919912cc004c0a800e2600a605400d16409c6eb4c09c004dd7181380118138009bac3025002408d1323322598009813800c4cc05cdd61813000912cc00400a2600c605200f1323002302a003375a605000481322c8120dd7181200098128009bac3023002408513230023023003375a604200480fa2c80e8603400260320026030002602e002602c00260226ea80322b30013370e900300244c8c966002602e0050048b2028375a602a00260226ea80322b30013370e900400244c8c8c8ca60026eb0c0600066eb0c06000e6eb0c06000922259800980e00244cc030dd6180d803912cc00400a26601c00844b3001002899808002912cc00400a26602401244b3001002808c4c8cc8966002604e0031330173758604c00244b3001002898031814803c4c8c008c0a800cdd69814001204c8b2048375c6048002604a0026eb0c08c00902144c8c8cc8966002604c0071300530260068b2046375a60460026eb8c08c008c08c004dd61810801203e899180118108019bae301f00240751323002301f003375c603a00480da2c80c86030002602e002602c00260226ea80322b30013370e900500244c8c8c8cc8966002603400713300a3758603200a44b3001002804c4c8cc8966002603e00313300f3758603c00244b3001002898031810803c4c8c008c08800cdd69810001203c8b2038375c6038002603a0026eb0c06c0090194590171bad3017001375a602e004602e002602c00260226ea80322b30013370e900600244c8c966002602e0050048b2028375c602a00260226ea80322b30013370e900700244c8c8c8ca60026eb4c06000664b300130160018acc004cdc4a4008602a0031689807980a800a0288b202e37546030009375a6030007375a603000491112cc004c0740160151640683018001301700130160013011375401915980099b8748040012264646644b3001302f01f899194c004dd7181d800cdd6981d981e000cdd6981d8012444b30013034303a3754601460766ea80b22b3001980081640ce98103d87980004019159800998081bac300e303b3754058007159800980d801456600266e1c004cdc1001192cc004c0c8c0ecdd5000c4dd6981f981e1baa0018a400081d0cc01cdd61806181d9baa02c0038980b819c52820728a5040e514a081ca294103945282072181d800981b1baa0318acc004c0ac07e2646464653001303e0019bac303d00191192cc004c0ccc0f0dd5000c4c02ccc0fcc100c104dd61820181e9baa0014bd7045300103d87a800040ec66012004466e3cdd718200008014896600200314bd7044c8cc0fcdd40009980180199198008009821001912cc004006297ae0899912cc006600266e1c00801694294503f44cc10cdd400119802002000c4cc01001000503f1bad3042001304300141006eb4c0fc00503d4dd6181e8024dd6181e801cdd6181e80124444444b30013301e039375c606060826ea80ca2b30019800981d18201baa3010304137540654a14a281fa2b3001980081940e698103d87a800040311598009810980c001c56600266e1cc060cc01001000cc06000e2b3001330250032598009811800c4cdc40009bad30303042375406714a082022b300159800981b9bad302e3041375406514a313371e6eb8c11001cdd7181618209baa03240fd159800acc004c0dcdd6981698209baa0328a51899b8f375c6088608a00e6eb8c0acc104dd5019207e8acc004cc0a4dd6180a18209baa032232980099b83337040026eb4c0c0c10cdd501a24190033370666e08004dd6981798219baa034483200664b3001303a3043375400313758608e60886ea8006297ae041086600e0080053259800981d18219baa00189bac30473044375400314bd702084330073758606660866ea80d000922225980099b87301e009301e0018acc004cdc3980f001180f000c56600266e1cc966002607c608e6ea800626eb4c12cc120dd5000c5200041186602600e00c00915980099b873259800981f18239baa00189bad304b3048375400314800104619809806003001c4cdc399b80337013001002a400122337000040028100014012294103b452820763758607e6080003130170338a5040e514a081ca2941039452820728a5040e514a081c86076002606c6ea80c62b30013370e900600fc5660026602605c6eb8c094c0d8dd5013c56600330013371e6eb8c0e4c0d8dd50189bae30253036375404f4a14a281a22602405d14a081a22941034456600266e1d200e01f89919192cc004cc0580c4dd71814181c9baa02a8acc00566002606460706ea8c0f000e2606460706ea8c034c0e4dd5015466002606460706ea8c034c0e4dd5015528528a06e40dd15980099b87375a60780046eb4c0f0c0f4c0f4c0f4c0f4c0f4c0f4c0f4c0f4c0f4c0f4c0f4c0f4c0f4c0f4c0e4dd5015456600266e1cdd6981e0009bad30093039375405515980099b87375a6078607a0026eb4c02cc0e4dd501544c0540c629410374528206e8a5040dd14a081ba2941037181e000981d800981b1baa03189919912cc004cc0580c4dd71814181c9baa02a8acc0056600330013371e0046eb8c090c0e4dd5015528528a06e8a518cc004cdc78009bae3023303937540554a14a281b90374566002b3001302f375a604c60726ea80aa2946330013017002a50a5140dc81ba2b30015980098179bad30253039375405514a319800980b800d28528a06e40dd130150318a5040dd14a081ba29410374528206e375c60740026eb8c0e8c0ec004c0d8dd5018a06840d081a1034206840d081a088c966002605a606c6ea80062600a66072607460766eb0c0e8c0dcdd5000a5eb82298103d87a800040d466006004466e3cdd7181d0008011112cc00660026060606c6ea8c02cc0dcdd5001d28528a06a8a518992cc004c0b800626464b30013033001899b89375a607a60746ea8008dd69805181d1baa0068acc004c0bc00629422941038207030383754002607660706ea8c024c0e0dd51805981c1baa0038acc004c0c400626464b30013033001899b89375a601860746ea8018dd6981e981d1baa0028acc004c0bc00629462941038207030383754002607660706ea8c0ecc0e0dd51805981c1baa003899192cc004c0cc006266e24dd69806181d1baa006375a607a60746ea800a2b3001302f0018a518a5040e081c0c0e0dd5000981d981c1baa303b30383754601660706ea800d036206c3036375400281a888c8cc00400400c896600200314c103d87a80008992cc004c0100062600c660746e9c0052f5c1133003003303c00240d86eb0c0e80050381029180180198010011164034602400c6022602400a8b200e180400098019baa0088a4d13656400401"
};
 
// Helper: Fetch datum from Blockfrost by hash
async function getDatumFromBlockfrost(datumHash) {
  const blockfrostApiKey = BLOCKFROST_API_KEY; // Set this in your frontend config
  const url = `https://cardano-preview.blockfrost.io/api/v0/scripts/datum/${datumHash}`;
  const res = await fetch(url, {
    headers: { project_id: blockfrostApiKey }
  });
  if (!res.ok) throw new Error("Failed to fetch datum from Blockfrost");
  const data = await res.json();
  return data.json_value;
}

// Helper: Fetch UTxOs at the script address using Lucid
async function getScriptUtxos() {
  if (!lucid) throw new Error("Lucid not initialized");
  return await lucid.utxosAt(scriptAddress);
}
 
// --- Cardano Plutus Script Address (update if redeployed) ---
const SCRIPT_ADDRESS = "addr_test1wqhrg9hr9mz2smdxsfwq5swa35gwtehlft5dyxrrf34285qflkcwk";
const scriptAddress = SCRIPT_ADDRESS;
 
// --- SLIDER LOGIC ---
function setupPoolSlider() {
  let currentSlide = 0;
  const slides = document.querySelectorAll('.pool-slide');
  const totalSlides = slides.length;
  function showSlide(index) {
    slides.forEach((slide, i) => {
      slide.classList.toggle('active', i === index);
    });
  }
  const leftBtn = document.getElementById('poolSliderLeft');
  const rightBtn = document.getElementById('poolSliderRight');
  if (!leftBtn || !rightBtn || slides.length === 0) {
    console.error('Slider: Missing DOM elements for slider or buttons');
    return;
  }
  // Remove previous listeners if any
  leftBtn.replaceWith(leftBtn.cloneNode(true));
  rightBtn.replaceWith(rightBtn.cloneNode(true));
  // Re-select after replacement
  const leftBtnNew = document.getElementById('poolSliderLeft');
  const rightBtnNew = document.getElementById('poolSliderRight');
  if (leftBtnNew && rightBtnNew) {
    leftBtnNew.addEventListener('click', () => {
      currentSlide = (currentSlide - 1 + totalSlides) % totalSlides;
      showSlide(currentSlide);
    });
    rightBtnNew.addEventListener('click', () => {
      currentSlide = (currentSlide + 1) % totalSlides;
      showSlide(currentSlide);
    });
  }
  showSlide(currentSlide);
}

document.addEventListener('DOMContentLoaded', setupPoolSlider);
 
// --- BEGIN deepBigInt helper ---
/**
 * Recursively convert all integer-like fields and array elements to BigInt.
 * Handles objects, arrays, and tuples (array pairs), and leaves non-integer fields untouched.
 * Only converts values that are string, number, or already BigInt.
 */
function deepBigInt(obj) {
  if (typeof obj === 'bigint') return obj;
  if (typeof obj === 'number' && Number.isInteger(obj)) return BigInt(obj);
  if (typeof obj === 'string' && obj.match(/^\d+$/)) return BigInt(obj);
  if (Array.isArray(obj)) {
    // If tuple of [string, int] or [string, array of int], handle accordingly
    if (obj.length === 2 && typeof obj[0] === 'string') {
      // [policyId, int] or [policyId, [int, ...]]
      return [obj[0], deepBigInt(obj[1])];
    }
    return obj.map(deepBigInt);
  }
  if (obj && typeof obj === 'object') {
    const result = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = deepBigInt(v);
    }
    return result;
  }
  return obj;
}
// --- END deepBigInt helper ---
 
// --- Add a button to initialize the contract from the frontend ---
document.addEventListener('DOMContentLoaded', function() {
  // ... existing code ...
  // Add contract initialization button if not present
  if (!document.getElementById('initContractBtn')) {
    const btn = document.createElement('button');
    btn.id = 'initContractBtn';
    btn.textContent = 'Initialize Contract (Debug)';
    btn.className = 'btn btn-warning';
    btn.style.margin = '1rem';
    btn.onclick = async () => {
      showNotification('Initializing contract...', 'info');
      try {
        const result = await initializeSmartContract();
        if (result.success) {
          showNotification('Contract initialized! TxHash: ' + result.txHash, 'success');
        } else {
          showNotification('Init failed: ' + result.error, 'error');
        }
      } catch (e) {
        showNotification('Init error: ' + e.message, 'error');
      }
    };
    document.body.prepend(btn);
  }
});

// Remove service worker registration if present
if ('serviceWorker' in navigator) {
  // navigator.serviceWorker.register('/sw.js').catch(() => {}); // Disabled to prevent 404
}

// Global function for lottery-winners page to get winners data
window.getMainPageWinnersData = function() {
    return {
        flatHistoricalWinners: window.flatHistoricalWinners || [],
        currentRoundWinners: window.currentRoundWinners || []
    };
};

// Function to sync winners data to lottery-winners page
function syncWinnersToTrackerPage() {
    try {
        // Get the current winners data
        const allWinners = [...(window.currentRoundWinners || []), ...(window.flatHistoricalWinners || [])];
        
        // Try to sync to lottery-winners page if it's open
        if (window.opener && window.opener.syncWinnersToTracker) {
            window.opener.syncWinnersToTracker(allWinners);
            console.log('🔄 Synced winners to lottery-winners page');
        }
        
        // Also try to sync to same window if we're on the lottery-winners page
        if (window.syncWinnersToTracker) {
            window.syncWinnersToTracker(allWinners);
            console.log('🔄 Synced winners to current lottery-winners page');
        }
    } catch (error) {
        console.error('❌ Error syncing winners to tracker page:', error);
    }
}

// Function to save winners data to localStorage for lottery-winners page access
function saveWinnersToLocalStorage() {
    try {
        // Use only flatHistoricalWinners to prevent duplicates
        const allWinners = window.flatHistoricalWinners || [];
        
        // Remove duplicates based on round number and transaction ID
        const uniqueWinners = [];
        const seenCombinations = new Set();
        
        allWinners.forEach(winner => {
            const roundNumber = winner.roundNumber || '';
            const txId = winner.transactionId || winner.txId || winner.txHash || '';
            const combination = `${roundNumber}-${txId}`;
            
            if (!seenCombinations.has(combination)) {
                seenCombinations.add(combination);
                uniqueWinners.push(winner);
            } else {
                console.log('🔄 Skipping duplicate winner from same round:', winner);
            }
        });
        
        console.log(`💾 Processing ${uniqueWinners.length} unique winners for localStorage`);
        
        // Filter to current month only for Detailed Winners History
        const currentMonthWinners = filterWinnersByCurrentMonth(uniqueWinners);
        
        // Save current month winners to localStorage
        localStorage.setItem('nikepigWinnersData', JSON.stringify({ current: currentMonthWinners }));
        console.log(`💾 Saved ${currentMonthWinners.length} current month winners to localStorage`);
        
    } catch (error) {
        console.error('❌ Error saving winners to localStorage:', error);
    }
}

// Function to toggle winners spreadsheet
function toggleWinnersSpreadsheet() {
    const spreadsheetSection = document.getElementById('winners-spreadsheet-section');
    const toggleBtn = document.getElementById('toggleWinnersSpreadsheet');
    
    if (spreadsheetSection.style.display === 'none') {
        spreadsheetSection.style.display = 'block';
        toggleBtn.textContent = 'View Less';
        
        // Get current month winners only
        let allWinners = [];
        if (window.flatHistoricalWinners && window.flatHistoricalWinners.length > 0) {
            allWinners = window.flatHistoricalWinners;
        } else {
            // Try to get from localStorage
            const stored = localStorage.getItem('nikepigWinnersData');
            if (stored) {
                const winnersData = JSON.parse(stored);
                allWinners = winnersData.current || [];
            }
        }
        
        // Filter to current month only
        const currentMonthWinners = filterWinnersByCurrentMonth(allWinners);
        populateWinnersSpreadsheet(currentMonthWinners);
    } else {
        spreadsheetSection.style.display = 'none';
        toggleBtn.textContent = 'View All';
    }
}

// Function to filter winners by current month
function filterWinnersByCurrentMonth(winners) {
    const currentDate = new Date();
    const currentMonth = currentDate.getMonth();
    const currentYear = currentDate.getFullYear();
    
    return winners.filter(winner => {
        const winnerDate = new Date(winner.timestamp || winner.claimedAt || winner.date);
        const winnerMonth = winnerDate.getMonth();
        const winnerYear = winnerDate.getFullYear();
        
        return winnerMonth === currentMonth && winnerYear === currentYear;
    });
}

// Function to populate winners spreadsheet
function populateWinnersSpreadsheet(winners) {
    const tableBody = document.getElementById('winners-table-body');
    if (!tableBody) return;
    
    console.log('📊 Populating winners spreadsheet with:', winners);
    
    tableBody.innerHTML = '';
    
    if (!winners || winners.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="4" class="empty-message">No winners recorded</td></tr>';
        return;
    }
    
    // Remove duplicates based on round number and transaction ID
    const uniqueWinners = [];
    const seenCombinations = new Set();
    
    winners.forEach(winner => {
        const roundNumber = winner.roundNumber || '';
        const txId = winner.transactionId || winner.txId || winner.txHash || '';
        const combination = `${roundNumber}-${txId}`;
        
        if (!seenCombinations.has(combination)) {
            seenCombinations.add(combination);
            uniqueWinners.push(winner);
        } else {
            console.log('🔄 Skipping duplicate winner from same round:', winner);
        }
    });
    
    console.log(`📊 After deduplication: ${uniqueWinners.length} unique winners`);
    
    // Store winners globally for pagination
    window.allWinners = uniqueWinners;
    window.currentPage = 0;
    window.roundsPerPage = 5; // Show 5 rounds per page (15 winners total)
    window.totalPages = Math.ceil(uniqueWinners.length / (window.roundsPerPage * 3));
    
    // Display first page
    displayWinnersPage(0);
    
    // Add pagination controls
    addPaginationControls();
}

// Function to display a specific page of winners as round boxes
function displayWinnersPage(pageIndex) {
    const tableBody = document.getElementById('winners-table-body');
    if (!tableBody || !window.allWinners) return;
    
    tableBody.innerHTML = '';
    
    // Group all winners by round first
    const allGroupedWinners = groupWinnersByRound(window.allWinners);
    
    // Calculate pagination for rounds
    const startRoundIndex = pageIndex * window.roundsPerPage;
    const endRoundIndex = Math.min(startRoundIndex + window.roundsPerPage, allGroupedWinners.length);
    const pageRounds = allGroupedWinners.slice(startRoundIndex, endRoundIndex);
    
    pageRounds.forEach((roundGroup) => {
        // Use the first winner for shared info
        const firstWinner = roundGroup[0];
        const roundDate = new Date(firstWinner.timestamp || firstWinner.claimedAt || firstWinner.date);
        const formattedRoundDate = roundDate.toLocaleDateString('en-GB', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
        const txId = firstWinner.transactionId || firstWinner.txId || firstWinner.txHash || '';
        const fullTxId = txId;
        
        // Create the round box
        const roundBox = document.createElement('tr');
        roundBox.className = 'winner-round-box-row';
        
        // Use the date as the round info instead of "Complete Round"
        const roundInfo = formattedRoundDate;
        
        roundBox.innerHTML = `
            <td colspan="4" class="winner-round-box-cell">
                <div class="winner-round-box">
                    <div class="winner-round-info">${roundInfo}</div>
                    <div class="winner-round-winners">
                        ${roundGroup.map(winner => {
                            // Format prize amount
                            let prizeAmountText = '';
                            if (winner.prizeAmount) {
                                if (typeof winner.prizeAmount === 'object') {
                                    const tokenAmounts = [];
                                    for (const [token, amount] of Object.entries(winner.prizeAmount)) {
                                        if (amount > 0) {
                                            tokenAmounts.push(`<span class=\"token-amount\">${amount} ${token}</span>`);
                                        }
                                    }
                                    prizeAmountText = tokenAmounts.join('<span class=\"token-separator\"> • </span>');
                                } else {
                                    prizeAmountText = `<span class=\"token-amount\">${winner.prizeAmount} ADA</span>`;
                                }
                            } else if (winner.amountADA) {
                                prizeAmountText = `<span class=\"token-amount\">${winner.amountADA} ADA</span>`;
                            } else if (winner.amount) {
                                prizeAmountText = `<span class=\"token-amount\">${winner.amount} ADA</span>`;
                            }
                            const address = winner.winnerAddress || winner.address || '';
                            const shortAddress = address.length > 20 ? address.substring(0, 10) + '...' + address.substring(address.length - 10) : address;
                            return `
                                <div class=\"winner-round-winner\">
                                    <span class=\"winner-address\" title=\"${address}\">${shortAddress}</span>
                                    <span class=\"winner-prize\">${prizeAmountText}</span>
                                </div>
                            `;
                        }).join('')}
                    </div>
                    <div class="winner-round-meta">
                        <span class="winner-round-txid" title="${fullTxId}">${fullTxId}</span>
                    </div>
                </div>
            </td>
        `;
        tableBody.appendChild(roundBox);
    });
    
    // Update pagination info
    updatePaginationInfo(pageIndex);
}

// Function to group winners by round (same timestamp = same round)
function groupWinnersByRound(winners) {
    const grouped = [];
    const roundGroups = new Map();
    
    winners.forEach(winner => {
        const timestamp = winner.timestamp || winner.claimedAt || winner.date;
        const roundKey = new Date(timestamp).toISOString().split('T')[0]; // Use date as round key
        
        if (!roundGroups.has(roundKey)) {
            roundGroups.set(roundKey, []);
        }
        roundGroups.get(roundKey).push(winner);
    });
    
    // Convert to array and sort by date (newest first)
    const sortedRounds = Array.from(roundGroups.entries()).sort((a, b) => {
        return new Date(b[0]) - new Date(a[0]);
    });
    
    sortedRounds.forEach(([date, roundWinners]) => {
        // Sort winners within round by position (1st, 2nd, 3rd)
        roundWinners.sort((a, b) => {
            const posA = a.position || 1;
            const posB = b.position || 1;
            return posA - posB;
        });
        
        // Ensure we have exactly 3 winners per round
        // If we have fewer than 3, we'll show what we have
        // If we have more than 3, we'll take the first 3 (shouldn't happen in normal operation)
        const roundWinnersForDisplay = roundWinners.slice(0, 3);
        
        // Only add rounds that have at least 1 winner
        if (roundWinnersForDisplay.length > 0) {
            grouped.push(roundWinnersForDisplay);
        }
    });
    
    return grouped;
}

// Function to add pagination controls
function addPaginationControls() {
    const spreadsheetContent = document.querySelector('.spreadsheet-content');
    if (!spreadsheetContent) return;
    
    // Remove existing pagination controls
    const existingPagination = document.getElementById('winners-pagination');
    if (existingPagination) {
        existingPagination.remove();
    }
    
    // Create pagination container
    const paginationContainer = document.createElement('div');
    paginationContainer.id = 'winners-pagination';
    paginationContainer.className = 'winners-pagination';
    
    // Add pagination HTML
    paginationContainer.innerHTML = `
        <div class="pagination-info">
            <span id="pagination-text">Page 1 of ${window.totalPages}</span>
        </div>
        <div class="pagination-controls">
            <button id="prev-page" class="pagination-btn" disabled>← Previous</button>
            <div class="page-numbers" id="page-numbers"></div>
            <button id="next-page" class="pagination-btn">Next →</button>
        </div>
    `;
    
    // Insert after the table
    const table = spreadsheetContent.querySelector('.winners-table');
    if (table) {
        table.parentNode.insertBefore(paginationContainer, table.nextSibling);
    }
    
    // Add event listeners
    setupPaginationEventListeners();
    
    // Generate page numbers
    generatePageNumbers();
}

// Function to setup pagination event listeners
function setupPaginationEventListeners() {
    const prevBtn = document.getElementById('prev-page');
    const nextBtn = document.getElementById('next-page');
    
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            if (window.currentPage > 0) {
                window.currentPage--;
                displayWinnersPage(window.currentPage);
                updatePaginationButtons();
                generatePageNumbers();
            }
        });
    }
    
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            if (window.currentPage < window.totalPages - 1) {
                window.currentPage++;
                displayWinnersPage(window.currentPage);
                updatePaginationButtons();
                generatePageNumbers();
            }
        });
    }
}

// Function to update pagination info
function updatePaginationInfo(pageIndex) {
    const paginationText = document.getElementById('pagination-text');
    
    if (paginationText) {
        paginationText.textContent = `Page ${pageIndex + 1} of ${window.totalPages}`;
    }
}

// Function to update pagination buttons
function updatePaginationButtons() {
    const prevBtn = document.getElementById('prev-page');
    const nextBtn = document.getElementById('next-page');
    
    if (prevBtn) {
        prevBtn.disabled = window.currentPage === 0;
    }
    
    if (nextBtn) {
        nextBtn.disabled = window.currentPage === window.totalPages - 1;
    }
}

// Function to generate page numbers
function generatePageNumbers() {
    const pageNumbersContainer = document.getElementById('page-numbers');
    if (!pageNumbersContainer) return;
    
    pageNumbersContainer.innerHTML = '';
    
    const maxVisiblePages = 5;
    let startPage = Math.max(0, window.currentPage - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(window.totalPages - 1, startPage + maxVisiblePages - 1);
    
    // Adjust start page if we're near the end
    if (endPage - startPage < maxVisiblePages - 1) {
        startPage = Math.max(0, endPage - maxVisiblePages + 1);
    }
    
    for (let i = startPage; i <= endPage; i++) {
        const pageBtn = document.createElement('button');
        pageBtn.className = `page-number ${i === window.currentPage ? 'active' : ''}`;
        pageBtn.textContent = i + 1;
        pageBtn.addEventListener('click', () => {
            window.currentPage = i;
            displayWinnersPage(window.currentPage);
            updatePaginationButtons();
            generatePageNumbers();
        });
        pageNumbersContainer.appendChild(pageBtn);
    }
}

// Function to format date for spreadsheet (fixed)
function formatDateForSpreadsheet(winner) {
    // Try different date fields that might exist
    const dateFields = ['date', 'timestamp', 'claimedAt', 'roundDate'];
    
    for (const field of dateFields) {
        if (winner[field]) {
            try {
                const date = new Date(winner[field]);
                if (!isNaN(date.getTime())) {
                    return date.toLocaleDateString();
                }
            } catch (error) {
                console.log(`Could not parse date from field ${field}:`, winner[field]);
            }
        }
    }
    
    // If no valid date found, try to use current date as fallback
    return new Date().toLocaleDateString();
}

// Function to search winners by wallet address
function searchWinners(searchTerm) {
    if (!searchTerm || searchTerm.trim() === '') {
        // If search is empty, show current month winners
        let allWinners = [];
        if (window.flatHistoricalWinners && window.flatHistoricalWinners.length > 0) {
            allWinners = window.flatHistoricalWinners;
        } else {
            // Try to get from localStorage
            const stored = localStorage.getItem('nikepigWinnersData');
            if (stored) {
                const winnersData = JSON.parse(stored);
                allWinners = winnersData.current || [];
            }
        }
        
        // Filter to current month only
        const currentMonthWinners = filterWinnersByCurrentMonth(allWinners);
        populateWinnersSpreadsheet(currentMonthWinners);
        return;
    }
    
    try {
        // Get all winners data from flatHistoricalWinners
        let allWinners = [];
        if (window.flatHistoricalWinners && window.flatHistoricalWinners.length > 0) {
            allWinners = window.flatHistoricalWinners;
        } else {
            // Try to get from localStorage
            const stored = localStorage.getItem('nikepigWinnersData');
            if (stored) {
                const winnersData = JSON.parse(stored);
                allWinners = winnersData.current || [];
            }
        }
        
        // Filter to current month first, then search
        const currentMonthWinners = filterWinnersByCurrentMonth(allWinners);
        const searchLower = searchTerm.toLowerCase();
        
        // Filter winners by address within current month
        const filteredWinners = currentMonthWinners.filter(winner => {
            const address = winner.winnerAddress || winner.address || '';
            return address.toLowerCase().includes(searchLower);
        });
        
        // Populate with filtered results (this will reset pagination to page 1)
        populateWinnersSpreadsheet(filteredWinners);
        
        console.log(`🔍 Search completed for: "${searchTerm}" - Found ${filteredWinners.length} results in current month`);
    } catch (error) {
        console.error('❌ Error searching winners:', error);
    }
}

// Function to clear search
function clearWinnersSearch() {
    const searchInput = document.getElementById('winners-search');
    if (searchInput) {
        searchInput.value = '';
    }
    
    // Get the original winners data from flatHistoricalWinners and repopulate with current month only
    let allWinners = [];
    if (window.flatHistoricalWinners && window.flatHistoricalWinners.length > 0) {
        allWinners = window.flatHistoricalWinners;
    } else {
        // Try to get from localStorage
        const stored = localStorage.getItem('nikepigWinnersData');
        if (stored) {
            const winnersData = JSON.parse(stored);
            allWinners = winnersData.current || [];
        }
    }
    
    // Filter to current month only
    const currentMonthWinners = filterWinnersByCurrentMonth(allWinners);
    populateWinnersSpreadsheet(currentMonthWinners);
}

// Function to format transaction ID for spreadsheet
function formatTransactionId(txId) {
    if (!txId || txId === 'Distribution Failed') return 'N/A';
    return txId; // Show full transaction ID
}

// Function to handle spreadsheet tab switching (removed - no longer needed)
function switchSpreadsheetTab(month) {
    // This function is no longer used since we removed the month tabs
    console.log('Tab switching removed - now showing current month only');
}