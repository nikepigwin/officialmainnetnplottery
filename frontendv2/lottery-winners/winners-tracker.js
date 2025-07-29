// Winners Tracker JavaScript

// Global variables
let winnersData = {
    current: [],
    previous: [],
    older: []
};

let currentTab = 'current';

// Initialize the page
document.addEventListener('DOMContentLoaded', function() {
    console.log('🎰 Winners Tracker initialized');
    initializeWinnersTracker();
});

// Main initialization function
function initializeWinnersTracker() {
    initializeTabs();
    initializeCloseButton();
    initializeSearch();
    // Get data from backend and populate tables
    getWinnersFromStorage();
}

// Initialize tab functionality
function initializeTabs() {
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const month = button.getAttribute('data-month');
            switchTab(month);
        });
    });
}

// Initialize close button
function initializeCloseButton() {
    const closeBtn = document.getElementById('closeTracker');
    console.log('🔍 Looking for closeTracker button:', closeBtn);
    
    if (closeBtn) {
        console.log('✅ Found closeTracker button, adding click listener');
        closeBtn.addEventListener('click', () => {
            console.log('🔄 Back button clicked, redirecting to main site');
            // Go back to main website
            window.location.href = 'https://nikepig.win/';
        });
    } else {
        console.error('❌ closeTracker button not found!');
    }
}

// Switch between tabs
function switchTab(month) {
    // Update active tab button
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-month="${month}"]`).classList.add('active');
    
    // Update active tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(`${month}-month`).classList.add('active');
    
    currentTab = month;
    updateTableVisibility(month);
}

// Update table visibility based on data
function updateTableVisibility(month) {
    const table = document.querySelector(`#${month}-month .winners-table`);
    const emptyMessage = document.getElementById(`${month}-empty`);
    const data = winnersData[month] || [];
    
    if (data.length === 0) {
        table.style.display = 'none';
        emptyMessage.style.display = 'block';
    } else {
        table.style.display = 'table';
        emptyMessage.style.display = 'none';
    }
}

// Load winners data from localStorage or initialize empty
function loadWinnersData() {
    const stored = localStorage.getItem('nikepigWinnersData');
    if (stored) {
        try {
            winnersData = JSON.parse(stored);
            console.log('📊 Loaded winners data from localStorage');
        } catch (error) {
            console.error('❌ Error loading winners data:', error);
            winnersData = { current: [], previous: [], older: [] };
        }
    } else {
        console.log('📊 No stored winners data found, initializing empty');
        winnersData = { current: [], previous: [], older: [] };
    }
    
    // Populate tables
    populateWinnersTables();
}

// Save winners data to localStorage
function saveWinnersData() {
    try {
        localStorage.setItem('nikepigWinnersData', JSON.stringify(winnersData));
        console.log('💾 Saved winners data to localStorage');
    } catch (error) {
        console.error('❌ Error saving winners data:', error);
    }
}

// Populate winners tables
function populateWinnersTables() {
    populateTable('current', winnersData.current);
    populateTable('previous', winnersData.previous);
    populateTable('older', winnersData.older);
    
    updateTableVisibility(currentTab);
}

// Populate a specific table
function populateTable(month, data) {
    const tbody = document.getElementById(`${month}-month-winners`);
    tbody.innerHTML = '';
    
    if (data.length === 0) {
        return;
    }
    
    data.forEach(winner => {
        const row = createWinnerRow(winner);
        tbody.appendChild(row);
    });
}

// Create a winner table row (simplified)
function createWinnerRow(winner) {
    const row = document.createElement('tr');
    
    const date = new Date(winner.timestamp);
    const formattedDate = date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
    
    row.innerHTML = `
        <td>${formattedDate}</td>
        <td><span class="winner-address">${formatAddress(winner.address)}</span></td>
        <td>${formatADA(winner.amount)} ADA</td>
        <td>
            <a href="https://preview.cardanoscan.io/transaction/${winner.transactionId}" 
               target="_blank" class="transaction-link">
                ${winner.transactionId.substring(0, 8)}...
            </a>
        </td>
    `;
    
    return row;
}

// Add a new winner to the data
function addWinner(winner) {
    // Use winner.date if available, otherwise use current timestamp
    const winnerDate = winner.date ? new Date(winner.date) : new Date();
    const currentDate = new Date();
    const currentMonth = currentDate.getMonth();
    const currentYear = currentDate.getFullYear();
    const winnerMonth = winnerDate.getMonth();
    const winnerYear = winnerDate.getFullYear();
    
    // Create a unique identifier for this winner to avoid duplicates
    const winnerId = `${winner.address}-${winner.roundNumber}-${winner.position}`;
    
    // Determine which month category this winner belongs to
    let targetMonth;
    if (winnerMonth === currentMonth && winnerYear === currentYear) {
        targetMonth = 'current';
    } else if ((winnerMonth === currentMonth - 1 && winnerYear === currentYear) ||
               (winnerMonth === 11 && winnerYear === currentYear - 1 && currentMonth === 0)) {
        targetMonth = 'previous';
    } else {
        targetMonth = 'older';
    }
    
    // Check if this winner already exists to avoid duplicates
    const existingWinner = winnersData[targetMonth].find(w => 
        w.address === winner.address && 
        w.roundNumber === winner.roundNumber && 
        w.position === winner.position
    );
    
    if (existingWinner) {
        console.log(`🏆 Winner already exists, skipping:`, winner);
        return;
    }
    
    // Add winner to appropriate month
    winnersData[targetMonth].unshift(winner);
    
    // Keep only last 100 winners per month to prevent localStorage overflow
    if (winnersData[targetMonth].length > 100) {
        winnersData[targetMonth] = winnersData[targetMonth].slice(0, 100);
    }
    
    // Save and update
    saveWinnersData();
    populateWinnersTables();
    // Removed updateStats() call since we no longer have stat cards
    
    console.log(`🏆 Added winner to ${targetMonth} month:`, winner);
}

// Utility functions (reused from main script)
function formatADA(amount) {
    if (typeof amount === 'string') {
        amount = parseInt(amount);
    }
    return (amount / 1000000).toFixed(2);
}

function formatAddress(address) {
    if (!address) return 'Unknown';
    if (address.length <= 20) return address;
    return address.substring(0, 10) + '...' + address.substring(address.length - 10);
}

// Notification system (reused from main script)
function showNotification(message, type = 'info') {
    const container = document.getElementById('notification-container');
    if (!container) return;
    
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    container.appendChild(notification);
    
    // Show notification
    setTimeout(() => {
        notification.classList.add('show');
    }, 100);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            if (container.contains(notification)) {
                container.removeChild(notification);
            }
        }, 300);
    }, 5000);
    
    // Click to dismiss
    notification.addEventListener('click', () => {
        notification.classList.remove('show');
        setTimeout(() => {
            if (container.contains(notification)) {
                container.removeChild(notification);
            }
        }, 300);
    });
}

// Function to sync winners data manually (called from main page)
window.syncWinnersToTracker = function(winnersData) {
    console.log('🔄 Syncing winners data to tracker:', winnersData);
    
    if (winnersData && Array.isArray(winnersData)) {
        // Clear existing data
        winnersData = { current: [], previous: [], older: [] };
        
        // Process each winner
        winnersData.forEach(winner => {
            const winnerData = {
                date: winner.timestamp || winner.claimedAt || new Date().toISOString(),
                address: winner.address,
                amount: winner.amountADA || winner.amount,
                token: winner.token || 'ADA',
                transactionId: winner.txHash || winner.transactionId,
                roundNumber: winner.roundNumber,
                position: winner.position
            };
            
            console.log('🏆 Adding winner from sync:', winnerData);
            addWinner(winnerData);
        });
        
        // Update display
        populateWinnersTables();
    }
};

// Function to get winners data (localStorage only for now)
function getWinnersFromStorage() {
    try {
        console.log('🔄 Loading winners from localStorage...');
        loadWinnersData();
        populateWinnersTables();
    } catch (error) {
        console.error('❌ Error loading winners from storage:', error);
    }
}

// Function to manually sync from main page
function syncFromMainPage() {
    try {
        console.log('🔄 Manual sync from main page...');
        
        // Try to open main page in new window and get data
        const mainPage = window.open('https://nikepig.win/', '_blank');
        
        if (mainPage) {
            // Wait for main page to load and then try to get data
            setTimeout(() => {
                try {
                    if (mainPage.getMainPageWinnersData) {
                        const data = mainPage.getMainPageWinnersData();
                        console.log('📊 Got data from main page:', data);
                        
                        // Process the data
                        const allWinners = [...(data.currentRoundWinners || []), ...(data.flatHistoricalWinners || [])];
                        
                        // Clear existing data
                        winnersData = { current: [], previous: [], older: [] };
                        
                        // Process each winner
                        allWinners.forEach(winner => {
                            const winnerData = {
                                date: winner.timestamp || winner.claimedAt || new Date().toISOString(),
                                address: winner.address,
                                amount: winner.amountADA || winner.amount,
                                token: winner.token || 'ADA',
                                transactionId: winner.txHash || winner.transactionId,
                                roundNumber: winner.roundNumber,
                                position: winner.position
                            };
                            
                            console.log('🏆 Adding winner from main page:', winnerData);
                            addWinner(winnerData);
                        });
                        
                        // Update display
                        populateWinnersTables();
                        saveWinnersData();
                        
                        console.log('✅ Manual sync completed');
                    }
                } catch (error) {
                    console.error('❌ Error getting data from main page:', error);
                }
            }, 2000); // Wait 2 seconds for main page to load
        }
    } catch (error) {
        console.error('❌ Error in manual sync:', error);
    }
}

// Make function globally available
window.syncFromMainPage = syncFromMainPage;