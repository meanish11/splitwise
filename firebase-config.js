// ============================================================
//  TripWise — Firebase Configuration
//  ============================================================
//  SETUP STEPS:
//  1. Go to https://console.firebase.google.com/
//  2. Create a project (or open your existing one)
//  3. Click the gear ⚙ icon → Project Settings → Your apps → Add Web App (</>)
//  4. Copy the config values from the snippet shown and paste below
//  5. In Firestore Database: Create database → Start in TEST MODE
// ============================================================

const firebaseConfig = {
    apiKey:            "AIzaSyBBqoBspVZQKfzYKSCv0sfh-wr_MNlZh18",
    authDomain:        "splitwise-2d87f.firebaseapp.com",
    projectId:         "splitwise-2d87f",
    storageBucket:     "splitwise-2d87f.firebasestorage.app",
    messagingSenderId: "59283590276",
    appId:             "1:59283590276:web:e85e3c532a1739bf9406d1",
    measurementId:     "G-JR68HM4362"
};

// ── Initialize ──────────────────────────────────────────────
firebase.initializeApp(firebaseConfig);

// Exposed globals used by script.js
window.db = firebase.firestore();
