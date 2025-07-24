# Generate Extended Private Key for Lucid

## 🎯 If Detailed Logs Show Key Format Issues

**Wait for the detailed error logs first**, but if they show Lucid needs an extended private key:

## 🔧 Generate Extended Key

```bash
# Navigate to your project
cd /home/van/official-mainnet-nplottery/initialize_contract

# Generate extended private key
./cardano-cli address key-gen \
  --extended-key \
  --verification-key-file pool-extended.vkey \
  --signing-key-file pool-extended.skey

# View the extended private key
cat pool-extended.skey

# Get the address from extended key
./cardano-cli address build \
  --payment-verification-key-file pool-extended.vkey \
  --testnet-magic 2
```

## 📋 Steps to Replace Key:

1. **Generate extended key** (command above)
2. **Extract cborHex** from `pool-extended.skey`
3. **Update Render environment** with new private key
4. **Send testnet ADA** to new address (if different)

## ⚠️ Important Notes:

- **Extended keys** have different format than regular keys
- **Address might change** - you'd need to fund the new address
- **Wait for detailed logs first** to confirm this is the issue

## 🔍 Monitor Next Round:

The improved logging will show exactly what Lucid needs, then we can fix accordingly. 