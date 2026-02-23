# Firebase Setup Guide for TripWise

## Step 1: Create a Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Add project" or select an existing project
3. Follow the setup wizard:
   - Enter project name (e.g., "tripwise")
   - Enable/disable Google Analytics (optional)
   - Click "Create project"

## Step 2: Register Your Web App

1. In Firebase Console, click the web icon `</>` to add a web app
2. Register app:
   - App nickname: "TripWise Web"
   - Check "Also set up Firebase Hosting" (optional)
   - Click "Register app"

## Step 3: Get Your Firebase Configuration

1. After registration, you'll see your Firebase configuration object
2. Copy the configuration values:
   ```javascript
   const firebaseConfig = {
     apiKey: "...",
     authDomain: "...",
     projectId: "...",
     storageBucket: "...",
     messagingSenderId: "...",
     appId: "...",
     measurementId: "..."
   };
   ```

## Step 4: Update Your Project Files

### Option A: Update firebase-config.js (Recommended for testing)
Replace the placeholder values in `firebase-config.js` with your actual credentials.

### Option B: Use .env file (For production)
1. Update `.env` file with your credentials
2. Use a bundler like Vite or Webpack to load environment variables
3. Install dotenv package if using Node.js

## Step 5: Enable Firestore Database

1. In Firebase Console, go to "Build" > "Firestore Database"
2. Click "Create database"
3. Choose a location (select closest to your users)
4. Start in **test mode** for development:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /{document=**} {
         allow read, write: if true;
       }
     }
   }
   ```
   ⚠️ **Important**: Change to production rules before deploying!

5. Recommended production rules:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /groups/{groupId} {
         allow read, write: if request.auth != null;
       }
       match /groups/{groupId}/people/{personId} {
         allow read, write: if request.auth != null;
       }
       match /groups/{groupId}/expenses/{expenseId} {
         allow read, write: if request.auth != null;
       }
     }
   }
   ```

## Step 6: (Optional) Enable Authentication

If you want to add user authentication:

1. In Firebase Console, go to "Build" > "Authentication"
2. Click "Get started"
3. Enable sign-in methods:
   - Email/Password
   - Google
   - Anonymous (useful for testing)

## Step 7: Test Your Setup

1. Open `index.html` in a web browser
2. Open browser console (F12)
3. You should see "Firebase initialized successfully!"
4. If you see errors, double-check your configuration

## Database Structure Recommendation

For TripWise, consider this Firestore structure:

```
groups (collection)
  └── {groupId} (document)
       ├── name: "Mountain Trip 2024"
       ├── createdAt: timestamp
       ├── people (subcollection)
       │    └── {personId} (document)
       │         ├── name: "John"
       │         └── addedAt: timestamp
       └── expenses (subcollection)
            └── {expenseId} (document)
                 ├── paidBy: "John"
                 ├── amount: 500
                 ├── description: "Lunch"
                 ├── sharedBy: ["John", "Jane", "Bob"]
                 └── createdAt: timestamp
```

## Next Steps

1. Replace localStorage calls in `script.js` with Firebase Firestore calls
2. Add real-time synchronization across devices
3. Implement user authentication (optional)
4. Add group sharing functionality
5. Deploy to Firebase Hosting

## Useful Resources

- [Firebase Documentation](https://firebase.google.com/docs)
- [Firestore Documentation](https://firebase.google.com/docs/firestore)
- [Firebase Authentication](https://firebase.google.com/docs/auth)
- [Firebase Web SDK Reference](https://firebase.google.com/docs/reference/js)

## Security Reminders

- ✅ DO: Add `.env` to `.gitignore`
- ✅ DO: Use Firebase security rules
- ✅ DO: Restrict API key usage in Firebase Console
- ❌ DON'T: Commit credentials to version control
- ❌ DON'T: Use test mode in production
