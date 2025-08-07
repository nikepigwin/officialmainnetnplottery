// Script to help update Render environment variable with winners data
// Run this locally to format your winners data for Render

const sampleWinnersData = [
  {
    roundNumber: 1,
    winners: [
      {
        position: 1,
        address: "addr_test1qq8ac7qqy0vtulyl7wntmsxc6wex80gvcyjy33qffrhm7sh927ysx5sftuw0dlft05dz3c7revpf7jx0xnlcjz3g69mqkt5dmn",
        amount: 100,
        percentage: 50,
        transactionId: "tx_hash_here_1",
        claimedAt: "2025-08-06T10:00:00.000Z"
      },
      {
        position: 2,
        address: "addr_test1qq8ac7qqy0vtulyl7wntmsxc6wex80gvcyjy33qffrhm7sh927ysx5sftuw0dlft05dz3c7revpf7jx0xnlcjz3g69mqkt5dmn",
        amount: 60,
        percentage: 30,
        transactionId: "tx_hash_here_2",
        claimedAt: "2025-08-06T10:00:00.000Z"
      },
      {
        position: 3,
        address: "addr_test1qq8ac7qqy0vtulyl7wntmsxc6wex80gvcyjy33qffrhm7sh927ysx5sftuw0dlft05dz3c7revpf7jx0xnlcjz3g69mqkt5dmn",
        amount: 40,
        percentage: 20,
        transactionId: "tx_hash_here_3",
        claimedAt: "2025-08-06T10:00:00.000Z"
      }
    ],
    totalPool: 200,
    drawDate: "2025-08-06T10:00:00.000Z",
    totalParticipants: 5,
    totalTickets: 10
  },
  {
    roundNumber: 2,
    winners: [
      {
        position: 1,
        address: "addr_test1qq8ac7qqy0vtulyl7wntmsxc6wex80gvcyjy33qffrhm7sh927ysx5sftuw0dlft05dz3c7revpf7jx0xnlcjz3g69mqkt5dmn",
        amount: 150,
        percentage: 50,
        transactionId: "tx_hash_here_4",
        claimedAt: "2025-08-06T13:00:00.000Z"
      },
      {
        position: 2,
        address: "addr_test1qq8ac7qqy0vtulyl7wntmsxc6wex80gvcyjy33qffrhm7sh927ysx5sftuw0dlft05dz3c7revpf7jx0xnlcjz3g69mqkt5dmn",
        amount: 90,
        percentage: 30,
        transactionId: "tx_hash_here_5",
        claimedAt: "2025-08-06T13:00:00.000Z"
      },
      {
        position: 3,
        address: "addr_test1qq8ac7qqy0vtulyl7wntmsxc6wex80gvcyjy33qffrhm7sh927ysx5sftuw0dlft05dz3c7revpf7jx0xnlcjz3g69mqkt5dmn",
        amount: 60,
        percentage: 20,
        transactionId: "tx_hash_here_6",
        claimedAt: "2025-08-06T13:00:00.000Z"
      }
    ],
    totalPool: 300,
    drawDate: "2025-08-06T13:00:00.000Z",
    totalParticipants: 8,
    totalTickets: 15
  }
];

// Format the data for Render environment variable
const formattedData = JSON.stringify(sampleWinnersData, null, 2);

console.log('🎰 Winners Data for Render Environment Variable');
console.log('==============================================');
console.log('');
console.log('Copy this value to your Render environment variable:');
console.log('Key: NIKEPIG_HISTORICAL_WINNERS');
console.log('Value:');
console.log(formattedData);
console.log('');
console.log('📋 Instructions:');
console.log('1. Go to your Render dashboard');
console.log('2. Navigate to your service');
console.log('3. Click on "Environment" tab');
console.log('4. Add/Update the NIKEPIG_HISTORICAL_WINNERS variable');
console.log('5. Paste the JSON data above as the value');
console.log('6. Save and redeploy your service');
console.log('');
console.log('✅ After deployment, check:');
console.log('- Backend logs for "Loaded X rounds from environment"');
console.log('- API endpoint: /api/lottery/winners');
console.log('- Frontend Weekly/Monthly tabs'); 