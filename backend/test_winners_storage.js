// Test script for winners storage system
import { Application } from "oak";

// Test the winners storage functionality
async function testWinnersStorage() {
  console.log('🧪 Testing winners storage system...');
  
  // Test 1: Check if /tmp directory exists and is writable
  try {
    const testFile = '/tmp/test_winners_storage.json';
    const testData = JSON.stringify([{ roundNumber: 1, winners: [] }]);
    Deno.writeTextFileSync(testFile, testData);
    const readData = Deno.readTextFileSync(testFile);
    console.log('✅ /tmp directory is writable');
    Deno.removeSync(testFile);
  } catch (error) {
    console.error('❌ /tmp directory is not writable:', error);
    return;
  }
  
  // Test 2: Check environment variable
  const envData = Deno.env.get('NIKEPIG_HISTORICAL_WINNERS');
  if (envData) {
    try {
      const parsed = JSON.parse(envData);
      console.log(`✅ Environment variable contains ${parsed.length} rounds`);
    } catch (error) {
      console.error('❌ Environment variable contains invalid JSON:', error);
    }
  } else {
    console.log('ℹ️ Environment variable is empty (this is normal for fresh deployment)');
  }
  
  console.log('🧪 Winners storage test completed');
}

// Run the test
testWinnersStorage(); 