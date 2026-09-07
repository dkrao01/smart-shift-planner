# Smart Shift Planner

> Industrial shift management web app — React + TypeScript + Firebase PWA

A mobile-first Progressive Web App for managing shift workers at industrial facilities (HPCL-style teams). Replaces WhatsApp/phone-call-based shift coordination with a structured, rule-enforcing digital system.

## Continue on Another Laptop

The repository contains the complete application code, Supabase schema, migration scripts, and safe configuration templates. Secrets are intentionally excluded from GitHub. On a new laptop:

1. Clone the repository and run `npm install`.
2. Copy `.env.example` to `.env` and add the Supabase project URL and public key.
3. Set `VITE_DATA_PROVIDER=supabase` in `.env`.
4. Run `npm run dev -- --port 5176`.

The Supabase database and authentication users are cloud-hosted, so the data is available after configuring the new laptop. Firebase service-account files, `.env.migration`, `.env`, and `supabase-uid-map.json` are local secrets/backups and are intentionally not committed. The safe migration template and database schema are included.

---

## Problem It Solves

| Without This App | With This App |
|---|---|
| Manager calls/texts each employee manually | Employees submit availability on their phone |
| WhatsApp threads for swap requests | Structured swap requests with auto-validation |
| Manual Excel shift planning | 16-day schedule with visual grid |
| No fairness tracking for night shifts | Auto fairness tracker per shift type |
| No visibility on coverage gaps | Real-time shortage warnings |
| Overtime confusion | 48h cycle rule enforcement |

---

## Features

- **Employee**: View schedule, submit availability, request swaps, place/pick up open shifts
- **Manager**: Plan 16-day schedules, see all availability, approve/reject swaps & pickups
- **Smart Validation**: Checks 48h rules, min 2-person coverage, fairness balance before approvals
- **Demo Mode**: Works instantly without any Firebase setup
- **PWA**: Installable on any phone — no App Store needed

---

## Business Rules

### Schedule
- **16-day period** = 2 × 8-day cycles
- Each 8-day cycle = 6 working days + 2 rest days

### Shifts Per Day
| Shift | Time |
|---|---|
| Day | 06:00 – 14:00 |
| Evening | 14:00 – 22:00 |
| Night | 22:00 – 06:00 |

### Hours Rules
- Each employee must work **exactly 48h per 8-day cycle**
- Allowed durations: 8h, 12h, or 16h per shift
- Under/over 48h triggers a warning

### Coverage Rule
- **Minimum 2 employees per shift** — shortage highlighted in red

### Fairness Rotation (24-day)
- Each employee must complete **48h each** of Day, Evening, and Night shifts over a 24-day rotation
- Prevents shift-type avoidance through swaps

### Swap/Open Shift Approval
Manager must approve all swaps and open shift pickups.
Auto-validation checks coverage, hours, overlap, and fairness before approval.

---

## Tech Stack

| Tech | Version | Purpose |
|---|---|---|
| React | 18 | UI framework |
| TypeScript | 5 | Type safety |
| Vite | 5 | Dev server + bundler |
| Tailwind CSS | 3 | Styling |
| Firebase Auth | 10 | Authentication |
| Firebase Firestore | 10 | Real-time database |
| vite-plugin-pwa | 0.17 | PWA/service worker |
| date-fns | 3 | Date utilities |
| react-router-dom | 6 | Client-side routing |

---

## Folder Structure

```
smart-shift-planner/
├── public/
│   ├── icons/
│   │   ├── favicon.svg
│   │   ├── icon-192.png
│   │   └── icon-512.png
│   └── manifest.json
├── src/
│   ├── assets/
│   ├── components/
│   │   ├── common/
│   │   │   ├── Badge.tsx          # Status badges
│   │   │   ├── Button.tsx         # Button variants
│   │   │   ├── Card.tsx           # Card + StatCard
│   │   │   ├── LoadingSpinner.tsx  # Spinner, EmptyState, WarningBanner
│   │   │   └── Modal.tsx          # Modal + form helpers
│   │   └── layout/
│   │       ├── Sidebar.tsx        # Desktop sidebar
│   │       ├── Header.tsx         # Mobile header
│   │       ├── BottomNav.tsx      # Mobile bottom nav
│   │       └── Layout.tsx         # Main layout wrapper
│   ├── contexts/
│   │   └── AuthContext.tsx        # Auth state (Firebase + demo mode)
│   ├── data/
│   │   └── mockData.ts            # 10 employees + 16-day sample schedule
│   ├── lib/
│   │   └── firebase.ts            # Firebase init + IS_DEMO_MODE flag
│   ├── pages/
│   │   ├── LoginPage.tsx
│   │   ├── DashboardPage.tsx
│   │   ├── SchedulePage.tsx
│   │   ├── AvailabilityPage.tsx
│   │   ├── SwapsPage.tsx
│   │   ├── OpenShiftsPage.tsx
│   │   ├── FairnessPage.tsx
│   │   └── SettingsPage.tsx
│   ├── services/
│   │   ├── authService.ts
│   │   └── dataService.ts         # Unified data access (mock + Firebase)
│   ├── types/
│   │   └── index.ts               # All TypeScript interfaces
│   ├── utils/
│   │   ├── dateUtils.ts
│   │   └── scheduleUtils.ts       # Validation, summaries
│   ├── App.tsx
│   ├── main.tsx
│   ├── index.css
│   └── vite-env.d.ts
├── .env.example
├── index.html
├── package.json
├── postcss.config.js
├── tailwind.config.js
├── tsconfig.json
├── tsconfig.node.json
└── vite.config.ts
```

---

## How to Install

```bash
# 1. Clone or extract the project
cd smart-shift-planner

# 2. Install dependencies
npm install

# 3. Copy env file (leave blank for demo mode)
cp .env.example .env
```

---

## How to Run Locally

```bash
npm run dev
```

Open: **http://localhost:5173**

The app runs in **DEMO MODE** immediately — no Firebase setup required.

---

## Demo Login Credentials

All demo accounts use password: **`demo123`**

| Name | Email | Role |
|---|---|---|
| Subramaniam | `manager@shifts.demo` | Manager |
| Ravi | `ravi@shifts.demo` | Employee |
| Kumar | `kumar@shifts.demo` | Employee |
| Suresh | `suresh@shifts.demo` | Employee |
| Mahesh | `mahesh@shifts.demo` | Employee |
| Ramesh | `ramesh@shifts.demo` | Employee |
| Prasad | `prasad@shifts.demo` | Employee |
| Naresh | `naresh@shifts.demo` | Employee |
| Venkat | `venkat@shifts.demo` | Employee |
| Anil | `anil@shifts.demo` | Employee |
| Rajesh | `rajesh@shifts.demo` | Employee |

The sample data includes **intentional warnings**:
- Day 4 Evening shift: only 1 employee → shortage warning
- Anil: doing a 16h night shift (may push over 48h)
- Pre-loaded swap requests (1 pending, 1 approved, 1 rejected)
- Open shift request with pending pickup

---

## Firebase Setup (Step-by-Step)

### Step 1: Create Firebase Project
1. Go to [https://console.firebase.google.com](https://console.firebase.google.com)
2. Click "Add project" → name it (e.g. `shift-planner`)
3. Disable Google Analytics (not needed)

### Step 2: Enable Authentication
1. In Firebase console → Authentication → Get started
2. Sign-in method → Enable "Email/Password"

### Step 3: Create Firestore Database
1. Firestore Database → Create database
2. Choose "Start in production mode"
3. Select a region near you (e.g. `asia-south1` for India)

### Step 4: Register Web App
1. Project settings (gear icon) → "Add app" → Web (</>)
2. Name it "shift-planner-web"
3. Copy the config values

### Step 5: Configure Environment
```bash
# Edit .env with your Firebase values
VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=shift-planner.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=shift-planner
VITE_FIREBASE_STORAGE_BUCKET=shift-planner.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abc123
```

### Step 6: Set Firestore Security Rules
In Firestore → Rules tab, replace with:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read: if request.auth != null;
      allow write: if request.auth.uid == userId;
    }
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

### Step 7: Seed Initial Data
After configuring Firebase, seed employees and manager by running the seed script (or use the Firestore console to create documents manually).

**Firestore Collections to Create:**

**`users` collection:**
```json
{
  "uid": "<firebase_auth_uid>",
  "name": "Subramaniam (Manager)",
  "email": "manager@yourcompany.com",
  "role": "manager",
  "employeeId": ""
}
```

Repeat for each employee with `"role": "employee"` and unique `employeeId` (E001–E010).

---

## Firestore Collections

| Collection | Description |
|---|---|
| `users` | User profiles with role |
| `employees` | Employee records |
| `schedulePeriods` | 16-day schedule periods |
| `shiftAssignments` | Individual shift assignments |
| `availability` | Employee availability submissions |
| `swapRequests` | Shift swap requests |
| `openShiftRequests` | Open shift pool entries |

---

## How to Build for Production

```bash
npm run build
```

Output in `dist/` folder — ready to deploy.

---

## How to Deploy

### Option A: Firebase Hosting (Recommended)
```bash
npm install -g firebase-tools
firebase login
firebase init hosting
# Set public directory to: dist
# Configure as single-page app: Yes
npm run build
firebase deploy
```

### Option B: Netlify (Easiest)
1. Run `npm run build`
2. Drag the `dist/` folder to [netlify.com/drop](https://netlify.com/drop)
3. Done — get a free URL instantly

### Option C: Vercel
```bash
npm install -g vercel
npm run build
vercel deploy dist/
```

---

## How to Install on Mobile as PWA

### iPhone (Safari — Required, Chrome won't show install option on iOS):
1. Open your deployed URL in **Safari**
2. Tap the **Share button** (📤 box with arrow at bottom)
3. Scroll down → tap **"Add to Home Screen"**
4. Name it "Shifts" → tap **"Add"**
5. App icon appears on home screen — opens fullscreen like a native app

### Android (Chrome):
1. Open your deployed URL in **Chrome**
2. Tap **⋮ menu** (top right)
3. Tap **"Add to Home screen"** or **"Install app"**
4. Tap **"Add"**
5. App icon appears on home screen

> ✅ No App Store. No Play Store. No approval wait. Staff just visit the URL and install.

---

## How to Zip and Continue in VS Code

### Create ZIP:
```bash
# From the parent directory:
zip -r smart-shift-planner.zip smart-shift-planner/ --exclude "*/node_modules/*" --exclude "*/.git/*" --exclude "*/dist/*"
```

### Open in VS Code:
1. Extract the zip
2. Open VS Code → File → Open Folder → select `smart-shift-planner`
3. Run `npm install` in terminal
4. Run `npm run dev`
5. Start editing — hot reload is instant

### Recommended VS Code Extensions:
- Tailwind CSS IntelliSense
- ES7+ React/Redux/React-Native snippets
- TypeScript Hero
- Prettier - Code formatter
- GitLens

---

## Continuing Development in VS Code / Codex

Key files to edit for common changes:

| What to change | File |
|---|---|
| Business rules (48h, etc.) | `src/utils/scheduleUtils.ts` |
| Add new shift types | `src/types/index.ts` |
| Modify mock data | `src/data/mockData.ts` |
| Add a new page | `src/pages/` + add route in `App.tsx` |
| Change colors/theme | `tailwind.config.js` |
| Firebase queries | `src/services/dataService.ts` |
| Auth logic | `src/contexts/AuthContext.tsx` |

---

## Future Improvements

### Near-term
- [ ] Export schedule to PDF/Excel
- [ ] Push notifications for shift assignments
- [ ] Manager reports (monthly summary)
- [ ] Bulk shift assignment
- [ ] Employee profile photos

### Microsoft Ecosystem Version
If the company moves to Microsoft 365, this same system can be rebuilt as:
- **Microsoft Power Apps** canvas app (mobile-friendly)
- **SharePoint Lists** or **Dataverse** instead of Firestore
- **Power Automate** for approval notifications
- **Microsoft Teams** notifications for shift alerts
- **Power BI** dashboards for manager analytics

> The React + Firebase version is ideal for quick deployment and VS Code development without Microsoft licensing.

### Other Integrations
- WhatsApp Business API for shift notifications
- SMS alerts via Twilio
- HR system integration (attendance export)
- Biometric attendance sync

---

## Feature Checklist

- [x] Employee login
- [x] Manager login
- [x] Employee availability submission
- [x] Manager availability view (grid table)
- [x] 16-day schedule view
- [x] Manager shift assignment/editing
- [x] 2-person manpower coverage warnings (red badge)
- [x] 48-hour per 8-day cycle warnings
- [x] Day/evening/night fairness tracking with progress bars
- [x] Swap request creation
- [x] Manager swap approval/rejection
- [x] Open shift pool
- [x] Manager open shift approval/rejection
- [x] Mobile responsive UI (bottom nav on phone)
- [x] PWA install support (manifest + service worker)
- [x] Firebase-ready sync
- [x] Demo/mock mode (works without Firebase)
- [x] TypeScript throughout
- [x] Validation before approvals
- [x] Loading states
- [x] Empty states
- [x] Error messages

---

*Built for HPCL-style industrial shift teams. Designed to replace WhatsApp coordination with structured digital scheduling.*
