# 🎯 EXACT Environment Variable Values for Render

## ✅ FOUND: All Required Keys in `initialize_contract/` Folder

I found your private key and all required values! Here are the **exact values** to set in your Render dashboard:

## 🔑 Environment Variables to Set in Render

### 1. POOL_WALLET_PRIVATE_KEY
**Source:** `initialize_contract/admin.skey`
**Value:**
```json
{
    "type": "PaymentSigningKeyShelley_ed25519",
    "description": "Payment Signing Key",
    "cborHex": "5820e93cdb3805a07601b7f3b270e361b51d3823f6839d17393c634d4a78732ce809"
}
```

### 2. POOL_WALLET_ADDRESS  
**Source:** `initialize_contract/admin.addr`
**Value:**
```
addr_test1vp6jucpj0sdclz4trdnzvtqs6x3e7vaq8psauzhcl0jd0vc3qnet5
```

### 3. SCRIPT_ADDRESS
**Source:** `initialize_contract/contract.script.addr`
**Value:**
```
addr_test1wqphj86rnmxlzz9ntyrsu6rdk3ylpqsr492p3gz7wampp7cdsux3s
```

### 4. ADMIN_WALLET_ADDRESS
**Source:** `initialize_contract/admin.addr` (same as pool wallet)
**Value:**
```
addr_test1vp6jucpj0sdclz4trdnzvtqs6x3e7vaq8psauzhcl0jd0vc3qnet5
```

## 🚀 How to Set These in Render Dashboard

1. **Go to Render Dashboard:**
   - Login to [render.com](https://render.com)
   - Navigate to your `nikepig-lottery-backend` service

2. **Access Environment Tab:**
   - Click on your service
   - Go to **Environment** tab

3. **Add/Update Variables:**
   
   | Variable Name | Value |
   |---------------|--------|
   | `POOL_WALLET_PRIVATE_KEY` | `{"type": "PaymentSigningKeyShelley_ed25519", "description": "Payment Signing Key", "cborHex": "5820e93cdb3805a07601b7f3b270e361b51d3823f6839d17393c634d4a78732ce809"}` |
   | `POOL_WALLET_ADDRESS` | `addr_test1vp6jucpj0sdclz4trdnzvtqs6x3e7vaq8psauzhcl0jd0vc3qnet5` |
   | `SCRIPT_ADDRESS` | `addr_test1wqphj86rnmxlzz9ntyrsu6rdk3ylpqsr492p3gz7wampp7cdsux3s` |
   | `ADMIN_WALLET_ADDRESS` | `addr_test1vp6jucpj0sdclz4trdnzvtqs6x3e7vaq8psauzhcl0jd0vc3qnet5` |

4. **Save and Redeploy:**
   - Save the environment variables
   - Your service should auto-redeploy

## 🔍 Verification

After setting these values, your logs should show:
```
✅ Automated prize distribution completed successfully!
🏦 Using pool wallet: addr_test1vp6jucpj0sdclz4trdnzvtqs6x3e7vaq8psauzhcl0jd0vc3qnet5
💳 Pool wallet balance: XXX.XX ADA
🎉 Prize distribution confirmed on blockchain!
```

Instead of:
```
❌ Error in automated prize distribution: Invalid secret key
```

## 📝 Notes

- ✅ All keys were found in your `initialize_contract/` folder
- ✅ The admin wallet is being used as both pool wallet and admin wallet
- ✅ Private key is in correct Cardano CLI JSON format
- ✅ Created missing `contract.addr` file for backend compatibility 