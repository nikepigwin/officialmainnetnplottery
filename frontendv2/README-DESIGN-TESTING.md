# 🎨 FRONTENDV2 - DESIGN TESTING ENVIRONMENT

## Created: January 24, 2025

### 🎯 PURPOSE:
This folder is for **experimenting with new website designs** safely.

### 📁 FOLDER STRUCTURE:
- **`frontend/`** → **STABLE PRODUCTION** (don't touch - this serves the live site)
- **`frontendv2/`** → **DESIGN PLAYGROUND** (experiment freely here!)

### ✅ WHAT'S IN THIS VERSION:
- Copy of the fully working frontend (as of Jan 24, 2025)
- Clean console (no WebSocket/mobile log spam)
- All lottery functionality intact
- Perfect starting point for design changes

### 🎨 DESIGN WORKFLOW:

**1. Safe Experimentation:**
- Modify CSS, HTML, layouts in this folder
- Test new color schemes, typography, layouts
- Add new components or redesign existing ones

**2. Testing:**
- Use local development server to test changes
- Backend API calls will still work
- Lottery functionality remains operational

**3. When Happy with Changes:**
- Copy successful changes from `frontendv2/` → `frontend/`
- Or swap the folders when design is complete

### 🛡️ SAFETY NET:
If you break something in `frontendv2/`, you can always:
```bash
rm -rf frontendv2/
cp -r frontend/ frontendv2/
# Fresh copy ready for design experiments
```

### 🚀 DEPLOYMENT:
- `frontend/` is what Render serves to users
- Test in `frontendv2/`, deploy by copying to `frontend/`

**Happy designing! This folder is your creative sandbox.** 🎨 