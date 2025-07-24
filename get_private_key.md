# Pool Wallet Private Key Extraction Guide

## Option 1: From Existing Wallet File
If you have the wallet files from when you created the pool wallet:

```bash
# If you have a .skey file
cat pool-wallet.skey

# If you have a mnemonic phrase, use a Cardano tool to convert it
```

## Option 2: From Wallet Software
If you created the wallet in:

### **Nami Wallet:**
1. Open Nami → Settings → Account → Show Private Key
2. Copy the private key (starts with `ed25519_sk1`)

### **Eternl Wallet:**
1. Settings → Security → Export Private Key
2. Copy the private key

### **Daedalus/Yoroi:**
1. Go to wallet settings
2. Export private key or seed phrase
3. Use cardano-cli to convert if needed

## Option 3: Create New Pool Wallet
If you need to create a new one:

```bash
# Generate new wallet
cardano-cli address key-gen \
  --verification-key-file pool-wallet.vkey \
  --signing-key-file pool-wallet.skey

# Get the private key
cat pool-wallet.skey

# Get the address  
cardano-cli address build \
  --payment-verification-key-file pool-wallet.vkey \
  --testnet-magic 2
```

## ⚠️ SECURITY WARNING
- **NEVER** commit private keys to git
- Store them securely in environment variables only
- Use testnet keys for testing only 