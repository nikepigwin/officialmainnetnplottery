# URGENT: Extract Pool Wallet Private Key

## 🎯 Problem: "Invalid secret key" error in automated distribution

Your logs show: `❌ Error in automated prize distribution: Invalid secret key`

## 📋 Solution Steps:

### Method 1: From Existing .skey File
If you have the original pool wallet .skey file:

```bash
# Read the private key file
cat pool-wallet.skey

# Should output something like:
{
    "type": "PaymentExtendedSigningKeyShelley_ed25519",
    "description": "Payment Signing Key", 
    "cborHex": "5880abc123def456..."
}

# Use the ENTIRE JSON content as the environment variable value
```

### Method 2: From Wallet Software

#### **Nami Wallet:**
1. Open Nami Extension
2. Settings → Account → Show Private Key
3. Copy the private key (starts with `ed25519e_sk1` or `ed25519_sk1`)

#### **Eternl Wallet:**
1. Settings → Security → Export Private Key
2. Enter password
3. Copy the extended private key

#### **Yoroi Wallet:**
1. Settings → Wallet → Export Private Key
2. Copy the private key in extended format

### Method 3: Generate New Pool Wallet (if needed)

```bash
# Generate new wallet
cardano-cli address key-gen \
  --verification-key-file pool-new.vkey \
  --signing-key-file pool-new.skey

# View the private key
cat pool-new.skey

# Get the address
cardano-cli address build \
  --payment-verification-key-file pool-new.vkey \
  --testnet-magic 2
```

## 🔧 Set Environment Variable in Render

1. **Render Dashboard** → Your Service → **Environment**
2. **Add Variable:**
   - **Name:** `POOL_WALLET_PRIVATE_KEY`
   - **Value:** [Your complete private key - JSON format or ed25519_sk1...]

### ✅ Examples of Correct Values:

**JSON Format:**
```json
{
    "type": "PaymentExtendedSigningKeyShelley_ed25519",
    "description": "Payment Signing Key",
    "cborHex": "5880abc123def456789..."
}
```

**Extended Key Format:**
```
ed25519e_sk1abc123def456789...
```

**Regular Key Format:**
```
ed25519_sk1abc123def456789...
```

## 🚀 After Setting the Variable:

1. **Save** in Render dashboard
2. **Redeploy** your service (automatic or manual)
3. **Monitor logs** for:
   ```
   ✅ Automated prize distribution completed successfully!
   🔗 View on Cardanoscan: https://preview.cardanoscan.io/transaction/...
   ```

## 🔍 Verify It's Working:

Watch your logs for these success messages:
- `🏦 Using pool wallet: addr_test1...`
- `💳 Pool wallet balance: X.XX ADA`  
- `🏆 Winner 1: addr... → X.XX ADA`
- `✅ Prize distribution transaction submitted: txhash`
- `🎉 Prize distribution confirmed on blockchain!`

## ⚠️ Security Notes:

- **Never commit private keys to git**
- **Use only testnet keys** for preview environment
- **Keep production keys secure** 