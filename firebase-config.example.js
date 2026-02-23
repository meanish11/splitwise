// ============================================================
//  SETUP: Copy this file → rename to firebase-config.js
//         Then fill in your actual Firebase credentials from:
//         Firebase Console → Project Settings → Your apps
// ============================================================

const firebaseConfig = {
    apiKey:            "YOUR_API_KEY",
    authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
    projectId:         "YOUR_PROJECT_ID",
    storageBucket:     "YOUR_PROJECT_ID.firebasestorage.app",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId:             "YOUR_APP_ID",
    measurementId:     "YOUR_MEASUREMENT_ID"
};

firebase.initializeApp(firebaseConfig);
window.db = firebase.firestore();
