# Render Deployment Guide - Automated Distribution Fix

## 🎯 What Was Fixed
Added missing environment variables required for automated prize distribution:
- `POOL_WALLET_PRIVATE_KEY` - Enables automatic transaction signing
- `SCRIPT_ADDRESS` - Smart contract address for operations

## 📋 Deployment Steps

### Step 1: Update Environment Variables in Render

1. **Go to Render Dashboard**
   - Visit [https://render.com](https://render.com)
   - Navigate to your `nikepig-lottery-backend` service

2. **Access Environment Tab**
   - Click on your service
   - Go to **Environment** tab

3. **Add Missing Variables**
   ```
   POOL_WALLET_PRIVATE_KEY = [Your wallet's private key - starts with ed25519_sk1]
   SCRIPT_ADDRESS = addr_test1wqphj86rnmxlzz9ntyrsu6rdk3ylpqsr492p3gz7wampp7cdsux3s
   POOL_WALLET_ADDRESS = addr_test1vp6jucpj0sdclz4trdnzvtqs6x3e7vaq8psauzhcl0jd0vc3qnet5
   ADMIN_WALLET_ADDRESS = [Your admin wallet address]
   ```

### Step 2: Deploy Updated Configuration

1. **Commit and Push Changes**
   ```bash
   git add render.yaml
   git commit -m "Add missing environment variables for automated distribution"
   git push origin main
   ```

2. **Trigger Render Deployment**
   - Render should auto-deploy from your git push
   - Or manually trigger deployment in dashboard

### Step 3: Verify Deployment

1. **Check Service Logs**
   - Look for: `🚀 Starting automated 3-minute lottery rounds...`
   - Should see timer logs every 10 seconds

2. **Test Backend Endpoints**
   ```bash
   # Check if backend is running
   curl https://nikepig-lottery-backend.onrender.com/health
   
   # Check lottery stats  
   curl https://nikepig-lottery-backend.onrender.com/api/lottery/stats
   
   # Check environment variables (without showing secrets)
   curl https://nikepig-lottery-backend.onrender.com/api/debug-env
   ```

## 🔍 How to Monitor Automated Distribution

### Backend Logs to Watch For:
```
✅ Starting automated 3-minute lottery rounds...
⏰ Round age: X seconds / 180 seconds  
🎉 Selected 3 winners for round Y
🚀 Auto-distributing X.XX ADA pool to 3 winners...
✅ Automated prize distribution completed successfully!
```

### Error Logs (What Should NOT Appear):
```
❌ POOL_WALLET_PRIVATE_KEY not configured - cannot auto-distribute prizes
❌ Error in automated prize distribution
```

### Frontend Monitoring:
- Sales status changes automatically
- Winner announcements appear
- Pool amounts update in real-time

## 🧪 Testing Automated Distribution

1. **Buy 4+ Tickets** (minimum participants required)
2. **Wait 3 Minutes** (round duration)
3. **Check Logs** for winner selection
4. **Verify Transactions** on [Cardanoscan Preview](https://preview.cardanoscan.io)

## 🚨 Troubleshooting

### If Distribution Still Fails:

1. **Check Environment Variables**
   ```bash
   curl https://nikepig-lottery-backend.onrender.com/api/debug-env
   ```

2. **Check Pool Wallet Balance**
   - Ensure pool wallet has sufficient ADA
   - Check on Cardanoscan

3. **Manual Distribution Options**
   ```bash
   # Emergency manual distribution
   POST /api/lottery/admin/emergency-distribute
   
   # Multi-token distribution
   POST /api/lottery/admin/distribute-multi-token-prizes
   ```

## 🔒 Security Notes

- **Private keys are stored securely** in Render environment variables
- **Never commit private keys** to git repositories  
- **Use testnet keys only** for preview environment
- **Monitor logs** for any unauthorized access attempts

## 📞 Support

If automated distribution still doesn't work after these steps:
1. Check Render service logs for specific error messages
2. Verify all environment variables are set correctly
3. Test manually with the emergency distribution endpoint
4. Ensure minimum participants (4+) are met for automatic processing 