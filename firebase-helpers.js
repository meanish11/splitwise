// Firebase Database Helper Functions
// These functions help you migrate from localStorage to Firebase Firestore

// Initialize Firebase on page load
document.addEventListener('DOMContentLoaded', function() {
    if (typeof initializeFirebase === 'function') {
        initializeFirebase();
    }
});

// Group ID management (you can generate or get from URL)
let currentGroupId = localStorage.getItem('tripwise-groupId') || generateGroupId();
localStorage.setItem('tripwise-groupId', currentGroupId);

function generateGroupId() {
    return 'group_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// ===== FIREBASE OPERATIONS =====

// Save people to Firebase
async function savePeopleToFirebase(peopleArray) {
    try {
        const docRef = window.firebaseDb.collection('groups').doc(currentGroupId);
        
        // Save each person
        const batch = window.firebaseDb.batch();
        peopleArray.forEach((person, index) => {
            const personRef = docRef.collection('people').doc(`person_${index}`);
            batch.set(personRef, {
                name: person.name,
                addedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
        });
        
        await batch.commit();
        console.log('People saved to Firebase successfully!');
        return true;
    } catch (error) {
        console.error('Error saving people to Firebase:', error);
        return false;
    }
}

// Load people from Firebase
async function loadPeopleFromFirebase() {
    try {
        const docRef = window.firebaseDb.collection('groups').doc(currentGroupId);
        const peopleSnapshot = await docRef.collection('people').get();
        
        const people = [];
        peopleSnapshot.forEach(doc => {
            people.push({
                name: doc.data().name
            });
        });
        
        console.log('People loaded from Firebase:', people);
        return people;
    } catch (error) {
        console.error('Error loading people from Firebase:', error);
        return [];
    }
}

// Save expenses to Firebase
async function saveExpenseToFirebase(expense) {
    try {
        const docRef = window.firebaseDb.collection('groups').doc(currentGroupId);
        
        await docRef.collection('expenses').add({
            paidBy: expense.paidBy,
            amount: expense.amount,
            sharedBy: expense.sharedBy || [],
            customAmounts: expense.customAmounts || {},
            description: expense.description || '',
            splittingMode: expense.splittingMode || 'equal',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        
        console.log('Expense saved to Firebase successfully!');
        return true;
    } catch (error) {
        console.error('Error saving expense to Firebase:', error);
        return false;
    }
}

// Load expenses from Firebase
async function loadExpensesFromFirebase() {
    try {
        const docRef = window.firebaseDb.collection('groups').doc(currentGroupId);
        const expensesSnapshot = await docRef.collection('expenses')
            .orderBy('createdAt', 'asc')
            .get();
        
        const expenses = [];
        expensesSnapshot.forEach(doc => {
            const data = doc.data();
            expenses.push({
                paidBy: data.paidBy,
                amount: data.amount,
                sharedBy: data.sharedBy || [],
                customAmounts: data.customAmounts || {},
                description: data.description || '',
                splittingMode: data.splittingMode || 'equal'
            });
        });
        
        console.log('Expenses loaded from Firebase:', expenses);
        return expenses;
    } catch (error) {
        console.error('Error loading expenses from Firebase:', error);
        return [];
    }
}

// Delete all data from Firebase for current group
async function clearFirebaseData() {
    try {
        const docRef = window.firebaseDb.collection('groups').doc(currentGroupId);
        
        // Delete all people
        const peopleSnapshot = await docRef.collection('people').get();
        const deletePromises = [];
        peopleSnapshot.forEach(doc => {
            deletePromises.push(doc.ref.delete());
        });
        
        // Delete all expenses
        const expensesSnapshot = await docRef.collection('expenses').get();
        expensesSnapshot.forEach(doc => {
            deletePromises.push(doc.ref.delete());
        });
        
        await Promise.all(deletePromises);
        console.log('Firebase data cleared successfully!');
        return true;
    } catch (error) {
        console.error('Error clearing Firebase data:', error);
        return false;
    }
}

// Real-time listener for people changes
function listenToPeopleChanges(callback) {
    const docRef = window.firebaseDb.collection('groups').doc(currentGroupId);
    
    return docRef.collection('people').onSnapshot((snapshot) => {
        const people = [];
        snapshot.forEach(doc => {
            people.push({
                name: doc.data().name
            });
        });
        callback(people);
    }, (error) => {
        console.error('Error listening to people changes:', error);
    });
}

// Real-time listener for expenses changes
function listenToExpensesChanges(callback) {
    const docRef = window.firebaseDb.collection('groups').doc(currentGroupId);
    
    return docRef.collection('expenses')
        .orderBy('createdAt', 'asc')
        .onSnapshot((snapshot) => {
            const expenses = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                expenses.push({
                    paidBy: data.paidBy,
                    amount: data.amount,
                    sharedBy: data.sharedBy || [],
                    customAmounts: data.customAmounts || {},
                    description: data.description || '',
                    splittingMode: data.splittingMode || 'equal'
                });
            });
            callback(expenses);
        }, (error) => {
            console.error('Error listening to expenses changes:', error);
        });
}

// ===== MIGRATION HELPER =====

// Migrate existing localStorage data to Firebase
async function migrateLocalStorageToFirebase() {
    try {
        const savedPeople = localStorage.getItem('tripwise-people');
        const savedExpenses = localStorage.getItem('tripwise-expenses');
        
        if (savedPeople) {
            const people = JSON.parse(savedPeople);
            await savePeopleToFirebase(people);
        }
        
        if (savedExpenses) {
            const expenses = JSON.parse(savedExpenses);
            for (const expense of expenses) {
                await saveExpenseToFirebase(expense);
            }
        }
        
        console.log('Migration completed successfully!');
        return true;
    } catch (error) {
        console.error('Error during migration:', error);
        return false;
    }
}

// Export functions for global use
window.savePeopleToFirebase = savePeopleToFirebase;
window.loadPeopleFromFirebase = loadPeopleFromFirebase;
window.saveExpenseToFirebase = saveExpenseToFirebase;
window.loadExpensesFromFirebase = loadExpensesFromFirebase;
window.clearFirebaseData = clearFirebaseData;
window.listenToPeopleChanges = listenToPeopleChanges;
window.listenToExpensesChanges = listenToExpensesChanges;
window.migrateLocalStorageToFirebase = migrateLocalStorageToFirebase;
window.currentGroupId = currentGroupId;
