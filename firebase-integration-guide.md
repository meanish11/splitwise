# Firebase Integration Guide for TripWise

This guide explains how to integrate Firebase with your existing TripWise app that currently uses localStorage.

## Files Created

1. **`.env`** - Environment variables for Firebase credentials (keep this secret!)
2. **`.gitignore`** - Prevents sensitive files from being committed
3. **`firebase-config.js`** - Firebase initialization
4. **`firebase-helpers.js`** - Helper functions for Firebase operations
5. **`firebase-setup-guide.md`** - Step-by-step Firebase setup instructions

## Quick Start

### Step 1: Get Firebase Credentials

1. Follow the instructions in `firebase-setup-guide.md`
2. Get your Firebase config from Firebase Console
3. Update `firebase-config.js` with your actual credentials:

```javascript
const firebaseConfig = {
    apiKey: "YOUR_ACTUAL_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    // ... other config values
};
```

### Step 2: Test Firebase Connection

1. Open `index.html` in your browser
2. Open Developer Console (F12)
3. You should see: "Firebase initialized successfully!"

### Step 3: Choose Your Integration Approach

#### Option A: Keep localStorage (Current - No Changes Needed)
Your app will continue working exactly as before with localStorage.

#### Option B: Hybrid Approach (Recommended for Testing)
Use both localStorage AND Firebase - best for gradual migration.

#### Option C: Full Firebase Migration
Replace all localStorage calls with Firebase calls.

## How to Migrate to Firebase (Option C)

### Current Code (localStorage):
```javascript
// Save data
function saveData() {
    localStorage.setItem('tripwise-people', JSON.stringify(people));
    localStorage.setItem('tripwise-expenses', JSON.stringify(expenses));
}

// Load data
function loadData() {
    const savedPeople = localStorage.getItem('tripwise-people');
    const savedExpenses = localStorage.getItem('tripwise-expenses');
    if (savedPeople) people = JSON.parse(savedPeople);
    if (savedExpenses) expenses = JSON.parse(savedExpenses);
}
```

### New Code (Firebase):
```javascript
// Save data
async function saveData() {
    await savePeopleToFirebase(people);
    // Expenses are saved individually when added
}

// Load data
async function loadData() {
    people = await loadPeopleFromFirebase();
    expenses = await loadExpensesFromFirebase();
    displayPeople();
    displayExpenses();
    updatePersonDropdown();
    updateSharedWithCheckboxes();
    updateCustomAmountInputs();
    updateTotalExpenses();
}
```

## Code Changes Required in script.js

### 1. Update the personForm submit handler:

**Find this code (around line 140-160):**
```javascript
document.getElementById('personForm').addEventListener('submit', function(e) {
    e.preventDefault();
    const nameInput = document.getElementById('personNameOnly');
    const name = nameInput.value.trim();
    
    if (!name) {
        alert('Please enter a name');
        return;
    }
    
    if (people.some(p => p.name === name)) {
        alert('Person already exists');
        return;
    }
    
    people.push({ name });
    nameInput.value = '';
    saveData();
    displayPeople();
    updatePersonDropdown();
    updateSharedWithCheckboxes();
    updateCustomAmountInputs();
});
```

**Replace with:**
```javascript
document.getElementById('personForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const nameInput = document.getElementById('personNameOnly');
    const name = nameInput.value.trim();
    
    if (!name) {
        alert('Please enter a name');
        return;
    }
    
    if (people.some(p => p.name === name)) {
        alert('Person already exists');
        return;
    }
    
    people.push({ name });
    nameInput.value = '';
    
    // Save to Firebase
    await savePeopleToFirebase(people);
    
    displayPeople();
    updatePersonDropdown();
    updateSharedWithCheckboxes();
    updateCustomAmountInputs();
});
```

### 2. Update the expenseForm submit handler:

**Find the expenseForm submit handler and add Firebase save:**
```javascript
// After adding expense to expenses array
expenses.push(expense);

// Add this line:
await saveExpenseToFirebase(expense);

// Then the rest of your code...
displayExpenses();
updateTotalExpenses();
```

### 3. Update clearAllData function:

```javascript
async function clearAllData() {
    if (confirm('Are you sure? This will delete all people and expenses!')) {
        people = [];
        expenses = [];
        
        // Clear from Firebase
        await clearFirebaseData();
        
        saveData();
        displayPeople();
        displayExpenses();
        updatePersonDropdown();
        updateSharedWithCheckboxes();
        updateCustomAmountInputs();
        updateTotalExpenses();
        updateSettlementPanelVisibility();
    }
}
```

### 4. Update loadData to be async:

```javascript
async function loadData() {
    // Try to load from Firebase first
    const firebasePeople = await loadPeopleFromFirebase();
    const firebaseExpenses = await loadExpensesFromFirebase();
    
    if (firebasePeople.length > 0 || firebaseExpenses.length > 0) {
        people = firebasePeople;
        expenses = firebaseExpenses;
    } else {
        // Fallback to localStorage
        const savedPeople = localStorage.getItem('tripwise-people');
        const savedExpenses = localStorage.getItem('tripwise-expenses');
        if (savedPeople) people = JSON.parse(savedPeople);
        if (savedExpenses) expenses = JSON.parse(savedExpenses);
    }
    
    displayPeople();
    displayExpenses();
    updatePersonDropdown();
    updateSharedWithCheckboxes();
    updateCustomAmountInputs();
    updateTotalExpenses();
}
```

### 5. Call loadData when page loads:

```javascript
// At the end of script.js or in window.onload
window.addEventListener('DOMContentLoaded', function() {
    loadData();
});
```

## Real-time Sync (Advanced)

For real-time synchronization across multiple devices:

```javascript
// In loadData() function, add listeners
function loadData() {
    // Setup real-time listeners
    listenToPeopleChanges((updatedPeople) => {
        people = updatedPeople;
        displayPeople();
        updatePersonDropdown();
        updateSharedWithCheckboxes();
        updateCustomAmountInputs();
    });
    
    listenToExpensesChanges((updatedExpenses) => {
        expenses = updatedExpenses;
        displayExpenses();
        updateTotalExpenses();
    });
}
```

## Migration Helper

To migrate existing localStorage data to Firebase:

1. Open browser console
2. Run: `migrateLocalStorageToFirebase()`
3. Check Firebase Console to verify data was migrated

## Benefits of Firebase

✅ **Cloud Sync**: Access your data from any device
✅ **Real-time Updates**: Changes sync instantly across all connected devices
✅ **No Data Loss**: Data stored in cloud, not just browser
✅ **Group Sharing**: Multiple people can work on the same trip expenses
✅ **Backup**: Your data is automatically backed up

## Testing

1. Add a person → Check Firebase Console → "groups" collection
2. Add an expense → Check Firebase Console → "expenses" subcollection
3. Open in another browser/device with same group ID → See same data
4. Make changes in one place → See updates everywhere (with real-time listeners)

## Troubleshooting

**"Firebase is not defined"**
- Check that Firebase scripts are loading in index.html
- Check browser console for network errors

**"Permission denied"**
- Check Firestore security rules in Firebase Console
- Make sure you're using test mode rules for development

**Data not saving**
- Check browser console for errors
- Verify Firebase configuration is correct
- Check Firebase Console quotas

**Old localStorage data not showing**
- Run `migrateLocalStorageToFirebase()` in browser console
- Or manually add data through the app after Firebase is setup

## Security Note

⚠️ **Important**: Never commit `.env` file to Git!  
✅ The `.gitignore` file is already configured to protect your credentials.

## Next Steps

1. Set up Firebase project (see firebase-setup-guide.md)
2. Update firebase-config.js with your credentials
3. Test the connection
4. Migrate your code (follow steps above)
5. Test thoroughly
6. Deploy!

For detailed Firebase setup instructions, see **firebase-setup-guide.md**
