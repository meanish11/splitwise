let people = [];
let expenses = [];
let activeTab = 'people';

// ----- Utility -----
function saveData() {
    localStorage.setItem('tripwise-people', JSON.stringify(people));
    localStorage.setItem('tripwise-expenses', JSON.stringify(expenses));
}

function loadData() {
    const savedPeople = localStorage.getItem('tripwise-people');
    const savedExpenses = localStorage.getItem('tripwise-expenses');
    if (savedPeople) people = JSON.parse(savedPeople);
    if (savedExpenses) expenses = JSON.parse(savedExpenses);
    displayPeople();
    displayExpenses();
    updatePersonDropdown();
    updateSharedWithCheckboxes();
    updateCustomAmountInputs();
    updateTotalExpenses();
}

// Tabs
function switchTab(tab) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector(`[onclick="switchTab('${tab}')"]`).classList.add('active');
    document.getElementById(`${tab}-tab`).classList.add('active');
    activeTab = tab;
    
    // Show/hide Money Settlement panel based on active tab and if expenses exist
    updateSettlementPanelVisibility();
}

// Show/hide Money Settlement panel
function updateSettlementPanelVisibility() {
    const settlementPanel = document.getElementById('moneySettlementPanel');
    // Only show if on expenses tab AND there are expenses
    if (activeTab === 'expenses' && expenses.length > 0) {
        settlementPanel.style.display = 'block';
    } else {
        settlementPanel.style.display = 'none';
    }
}

// ----- Splitting Mode Toggle -----
function toggleSplittingMode() {
    const mode = document.querySelector('input[name="splittingMode"]:checked').value;
    const equalSection = document.getElementById('equalSplitSection');
    const customSection = document.getElementById('customAmountsSection');
    
    if (mode === 'equal') {
        equalSection.style.display = 'block';
        customSection.style.display = 'none';
    } else {
        equalSection.style.display = 'none';
        customSection.style.display = 'block';
        updateCustomAmountInputs();
    }
}

// ----- Custom Amount Functions -----
function updateCustomAmountInputs() {
    const container = document.getElementById('customAmountInputs');
    container.innerHTML = '';
    
    people.forEach(person => {
        const div = document.createElement('div');
        div.className = 'custom-amount-item';
        div.innerHTML = `
            <label>${person.name}:</label>
            <input type="number" class="custom-amount-input" data-person="${person.name}" 
                   placeholder="₹0" step="1" min="0" oninput="checkCustomTotal()">
            <span>₹</span>
        `;
        container.appendChild(div);
    });
    checkCustomTotal();
}

function checkCustomTotal() {
    const inputs = document.querySelectorAll('.custom-amount-input');
    const totalExpenseAmount = parseInt(document.getElementById('expenseAmount').value) || 0;
    let customTotal = 0;
    
    inputs.forEach(input => {
        customTotal += parseInt(input.value) || 0;
    });
    
    const totalCheckDiv = document.getElementById('totalCheck');
    
    if (customTotal === 0) {
        totalCheckDiv.textContent = 'Enter amounts to see total';
        totalCheckDiv.className = 'total-check';
    } else if (customTotal === totalExpenseAmount && totalExpenseAmount > 0) {
        totalCheckDiv.textContent = `✓ Perfect! Custom total: ₹${customTotal} matches expense amount`;
        totalCheckDiv.className = 'total-check success';
    } else {
        totalCheckDiv.textContent = `⚠ Custom total: ₹${customTotal}, Expense amount: ₹${totalExpenseAmount}`;
        totalCheckDiv.className = 'total-check error';
    }
}

// Update total check when expense amount changes
document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('expenseAmount').addEventListener('input', checkCustomTotal);
});

// ----- Select All Functionality (for equal split) -----
function toggleSelectAll() {
    const checkboxes = document.querySelectorAll('.person-checkbox');
    const selectAllBtn = document.getElementById('selectAllBtn');
    
    if (checkboxes.length === 0) {
        alert('Please add people first!');
        return;
    }
    
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    
    if (allChecked) {
        checkboxes.forEach(cb => cb.checked = false);
        selectAllBtn.textContent = 'Select All';
    } else {
        checkboxes.forEach(cb => cb.checked = true);
        selectAllBtn.textContent = 'Unselect All';
    }
    updateSelectedCount();
}

function updateSelectedCount() {
    const checkboxes = document.querySelectorAll('.person-checkbox');
    const checkedCount = Array.from(checkboxes).filter(cb => cb.checked).length;
    const selectedCountElement = document.getElementById('selectedCount');
    const selectAllBtn = document.getElementById('selectAllBtn');
    
    if (selectedCountElement) selectedCountElement.textContent = `${checkedCount} selected`;
    
    if (selectAllBtn) {
        if (checkedCount === 0) {
            selectAllBtn.textContent = 'Select All';
        } else if (checkedCount === checkboxes.length) {
            selectAllBtn.textContent = 'Unselect All';
        } else {
            selectAllBtn.textContent = 'Select All';
        }
    }
}

// ----- Add People -----
document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('personForm').addEventListener('submit', function(e) {
        e.preventDefault();
        const name = document.getElementById('personNameOnly').value.trim();
        if (name && !people.find(p => p.name.toLowerCase() === name.toLowerCase())) {
            const person = {
                id: Date.now(),
                name: name
            };
            people.push(person);
            displayPeople();
            updatePersonDropdown();
            updateSharedWithCheckboxes();
            updateCustomAmountInputs();
            saveData();
            document.getElementById('personForm').reset();
            document.getElementById('settlementResults').innerHTML = 
                '<div class="no-data">Click calculate button to see settlements</div>';
        } else if (people.find(p => p.name.toLowerCase() === name.toLowerCase())) {
            alert('This name already exists!');
        }
    });

    // ----- Add Expenses with equal or custom splitting -----
    document.getElementById('expenseForm').addEventListener('submit', function(e) {
        e.preventDefault();
        const payer = document.getElementById('personSelect').value;
        const amount = parseInt(document.getElementById('expenseAmount').value) || 0;
        const description = document.getElementById('expenseDescription').value.trim();
        const splittingMode = document.querySelector('input[name="splittingMode"]:checked').value;

        if (!payer) {
            alert('Please select who paid.');
            return;
        }
        if (amount <= 0) {
            alert('Please enter a valid amount.');
            return;
        }

        let sharedWith = [];
        let customAmounts = {};

        if (splittingMode === 'equal') {
            const checkboxes = document.querySelectorAll('.person-checkbox');
            sharedWith = Array.from(checkboxes).filter(c => c.checked).map(c => c.value);
            if (sharedWith.length === 0) {
                alert('Please select at least one person who shared this expense.');
                return;
            }
        } else {
            // Custom amounts mode
            const customInputs = document.querySelectorAll('.custom-amount-input');
            let customTotal = 0;
            
            customInputs.forEach(input => {
                const personName = input.dataset.person;
                const personAmount = parseInt(input.value) || 0;
                if (personAmount > 0) {
                    sharedWith.push(personName);
                    customAmounts[personName] = personAmount;
                    customTotal += personAmount;
                }
            });
            
            if (sharedWith.length === 0) {
                alert('Please enter amounts for at least one person.');
                return;
            }
            
            if (customTotal !== amount) {
                alert(`Custom amounts total (₹${customTotal}) must equal the expense amount (₹${amount}).`);
                return;
            }
        }

        const expense = {
            id: Date.now(),
            name: payer,
            amount: amount,
            description: description || 'General expense',
            sharedWith: sharedWith,
            splittingMode: splittingMode,
            customAmounts: splittingMode === 'custom' ? customAmounts : null
        };
        
        expenses.push(expense);
        displayExpenses();
        displayPeople();
        updateTotalExpenses();
        updateSettlementPanelVisibility();
        saveData();
        document.getElementById('expenseForm').reset();
        updateSharedWithCheckboxes();
        updateCustomAmountInputs();
        checkCustomTotal();
        document.getElementById('settlementResults').innerHTML = 
            '<div class="no-data">Click calculate button to see settlements</div>';
    });
});

// ----- UI functions -----
function displayPeople() {
    const container = document.getElementById('peopleContainer');
    if (people.length === 0) {
        container.innerHTML = '<div class="no-data">No people added yet</div>';
        return;
    }
    const peopleHTML = people.map(person => `
        <div class="person-item">
            <div class="person-details">
                <div class="person-name">${person.name}</div>
            </div>
            <button class="btn-delete-person" onclick="removePerson('${person.name}')" title="Delete person">×</button>
        </div>
    `).join('');
    container.innerHTML = `<div class="people-grid">${peopleHTML}</div>`;
}

function displayExpenses() {
    const container = document.getElementById('expensesContainer');
    if (expenses.length === 0) {
        container.innerHTML = '<div class="no-data">No expenses added yet</div>';
        return;
    }
    container.innerHTML = expenses.map(expense => {
        let sharingInfo = '';
        if (expense.splittingMode === 'custom' && expense.customAmounts) {
            const customDetails = Object.entries(expense.customAmounts)
                .map(([person, amount]) => `${person}: ₹${amount}`)
                .join(', ');
            sharingInfo = `Custom amounts - ${customDetails}`;
        } else {
            sharingInfo = `Equal split - ${expense.sharedWith ? expense.sharedWith.join(', ') : ''}`;
        }
        
        return `
            <div class="expense-item">
                <div class="expense-details">
                    <div class="expense-name">${expense.name} paid ₹${expense.amount}</div>
                    <div style="font-size: 0.85rem; color: #666;">
                        For: ${expense.description} • ${sharingInfo}
                    </div>
                </div>
                <button class="btn-delete-expense" onclick="removeExpense(${expense.id})" title="Delete expense">×</button>
            </div>
        `;
    }).join('');
}

function updatePersonDropdown() {
    const select = document.getElementById('personSelect');
    select.innerHTML = '<option value="">Select person</option>';
    people.forEach(person => {
        const option = document.createElement('option');
        option.value = person.name;
        option.textContent = person.name;
        select.appendChild(option);
    });
}

function updateSharedWithCheckboxes() {
    const container = document.getElementById('sharedWithCheckboxes');
    container.innerHTML = '';
    people.forEach(person => {
        const div = document.createElement('span');
        div.className = 'multi-checkbox-person';
        div.innerHTML = `<label><input type="checkbox" class="person-checkbox" value="${person.name}" onchange="updateSelectedCount()" /> ${person.name}</label>`;
        container.appendChild(div);
    });
    updateSelectedCount();
}

function removePerson(name) {
    const hasExpenses = expenses.some(expense => 
        expense.name === name || (expense.sharedWith && expense.sharedWith.includes(name)));
    if (hasExpenses) {
        alert('Please remove all expenses for or involving this person first!');
        return;
    }
    if (confirm(`Are you sure you want to delete "${name}"?`)) {
        people = people.filter(person => person.name !== name);
        displayPeople();
        updatePersonDropdown();
        updateSharedWithCheckboxes();
        updateCustomAmountInputs();
        saveData();
        document.getElementById('settlementResults').innerHTML = 
            '<div class="no-data">Click calculate button to see settlements</div>';
    }
}

function removeExpense(id) {
    if (confirm('Are you sure you want to delete this expense?')) {
        expenses = expenses.filter(expense => expense.id !== id);
        displayExpenses();
        displayPeople();
        updateTotalExpenses();
        updateSettlementPanelVisibility();
        updateSharedWithCheckboxes();
        updateCustomAmountInputs();
        saveData();
        document.getElementById('settlementResults').innerHTML = 
            '<div class="no-data">Click calculate button to see settlements</div>';
    }
}

function updateTotalExpenses() {
    const total = expenses.reduce((sum, expense) => sum + (expense.amount || 0), 0);
    const totalDiv = document.getElementById('totalExpenses');
    if (total > 0) {
        totalDiv.style.display = 'block';
        totalDiv.querySelector('.total-amount').textContent = `₹${total}`;
    } else {
        totalDiv.style.display = 'none';
    }
}

function clearAllData() {
    if (confirm('Are you sure you want to clear all data? This cannot be undone.')) {
        people = [];
        expenses = [];
        localStorage.removeItem('tripwise-people');
        localStorage.removeItem('tripwise-expenses');
        displayPeople();
        displayExpenses();
        updatePersonDropdown();
        updateSharedWithCheckboxes();
        updateCustomAmountInputs();
        updateTotalExpenses();
        updateSettlementPanelVisibility();
        document.getElementById('settlementResults').innerHTML =
            '<div class="no-data">First add people and expenses, then calculate</div>';
    }
}

// ----- Settlement Calculation with Custom Amounts -----
function calculateSettlements() {
    if (people.length === 0) {
        document.getElementById('settlementResults').innerHTML = 
            '<div class="no-data">Please add people first</div>';
        return;
    }
    if (expenses.length === 0) {
        document.getElementById('settlementResults').innerHTML = 
            '<div class="no-data">Please add some expenses first</div>';
        return;
    }

    const totalSpentByPerson = {};
    const totalShouldPay = {};
    people.forEach(person => {
        totalSpentByPerson[person.name] = 0;
        totalShouldPay[person.name] = 0;
    });

    expenses.forEach(expense => {
        totalSpentByPerson[expense.name] += expense.amount;
        
        if (expense.splittingMode === 'custom' && expense.customAmounts) {
            // Use custom amounts
            Object.entries(expense.customAmounts).forEach(([personName, amount]) => {
                totalShouldPay[personName] += amount;
            });
        } else {
            // Equal split
            const share = expense.amount / expense.sharedWith.length;
            expense.sharedWith.forEach(personName => {
                totalShouldPay[personName] += share;
            });
        }
    });

    const balances = {};
    people.forEach(person => {
        balances[person.name] = Math.round(totalSpentByPerson[person.name] - totalShouldPay[person.name]);
    });

    const settlements = generateOptimalSettlements(balances);
    const totalAmount = expenses.reduce((s, e) => s + (e.amount || 0), 0);
    displaySettlements(settlements, totalSpentByPerson, totalShouldPay, totalAmount);
}

function generateOptimalSettlements(balances) {
    const settlements = [];
    const creditors = [], debtors = [];
    Object.entries(balances).forEach(([person, balance]) => {
        if (balance > 0) creditors.push({ name: person, amount: balance });
        else if (balance < 0) debtors.push({ name: person, amount: -balance });
    });
    creditors.sort((a, b) => b.amount - a.amount);
    debtors.sort((a, b) => b.amount - a.amount);
    let i = 0, j = 0;
    while (i < creditors.length && j < debtors.length) {
        const creditor = creditors[i];
        const debtor = debtors[j];
        const amount = Math.min(creditor.amount, debtor.amount);
        if (amount > 0) {
            settlements.push({
                from: debtor.name, to: creditor.name, amount: amount
            });
        }
        creditor.amount -= amount;
        debtor.amount -= amount;
        if (creditor.amount <= 0) i++;
        if (debtor.amount <= 0) j++;
    }
    return settlements;
}

function displaySettlements(settlements, totalSpentByPerson, totalShouldPay, totalAmount) {
    const container = document.getElementById('settlementResults');
    if (settlements.length === 0) {
        container.innerHTML = `
            <div class="settlements">
                <h3 style="color: #28a745; text-align: center; margin-bottom: 15px;">
                    🎉 Everyone is settled!
                </h3>
                <div style="text-align: center; color: #666;">
                    Everyone has paid their fair share.
                </div>
            </div>
            ${summaryBreakdown(totalSpentByPerson, totalShouldPay, totalAmount)}
        `;
        return;
    }
    let html = `
        <div class="settlements">
            <h3 style="color: #333; margin-bottom: 15px;">💸 Who Should Pay Whom:</h3>
    `;
    settlements.forEach(settlement => {
        html += `
            <div class="settlement-item debt">
                <div class="settlement-text">
                    <strong>${settlement.from}</strong> should pay <strong>${settlement.to}</strong>
                </div>
                <div class="settlement-amount" style="color: #dc3545;">
                    ₹${settlement.amount}
                </div>
            </div>
        `;
    });
    html += '</div>' + summaryBreakdown(totalSpentByPerson, totalShouldPay, totalAmount);
    container.innerHTML = html;
    
    // Show export button after calculation
    document.getElementById('exportBtn').style.display = 'block';
}

function summaryBreakdown(totalSpentByPerson, totalShouldPay, totalAmount) {
    let html = `
        <div class="settlements" style="margin-top: 20px;">
            <h3 style="color: #333; margin-bottom: 15px;">📈 Breakdown:</h3>
            <div style="margin-bottom: 15px; text-align: center; background: #e9ecef; padding: 10px; border-radius: 8px;">
                <strong>Total Expenses: ₹${Math.round(totalAmount)}</strong>
            </div>
    `;
    people.forEach(person => {
        const spent = Math.round(totalSpentByPerson[person.name]);
        const share = Math.round(totalShouldPay[person.name]);
        const balance = spent - share;
        html += `
            <div class="settlement-item ${balance > 0 ? '' : 'debt'}">
                <div class="settlement-text">
                    <strong>${person.name}</strong> paid ₹${spent}, should pay ₹${share}
                </div>
                <div class="settlement-amount" style="color: ${balance > 0 ? '#28a745' : balance < 0 ? '#dc3545' : '#333'};">
                    ${balance > 0 ? '+' : ''}₹${balance}
                </div>
            </div>
        `;
    });
    html += '</div>';
    return html;
}

// ----- PDF Export Function -----
function exportToPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    // Add border and professional styling
    doc.setDrawColor(102, 126, 234);
    doc.setLineWidth(0.5);
    doc.rect(10, 10, 190, 277);
    
    // Title with background
    doc.setFillColor(102, 126, 234);
    doc.rect(15, 15, 180, 15, 'F');
    doc.setFontSize(18);
    doc.setTextColor(255, 255, 255);
    doc.setFont(undefined, 'bold');
    doc.text('TRIPWISE - EXPENSE REPORT', 105, 24, { align: 'center' });
    
    // Date
    doc.setFontSize(9);
    doc.setTextColor(100);
    doc.setFont(undefined, 'normal');
    const today = new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
    doc.text(`Generated on: ${today}`, 105, 36, { align: 'center' });
    
    let yPos = 48;
    
    // Total Expenses Box
    if (expenses.length > 0) {
        const totalAmount = expenses.reduce((s, e) => s + (e.amount || 0), 0);
        doc.setFillColor(240, 240, 240);
        doc.rect(15, yPos - 5, 180, 12, 'F');
        doc.setFontSize(13);
        doc.setTextColor(0);
        doc.setFont(undefined, 'bold');
        doc.text(`TOTAL TRIP EXPENSES: Rs. ${totalAmount}`, 105, yPos + 2, { align: 'center' });
        doc.setFont(undefined, 'normal');
        yPos += 16;
    }
    
    // People Section
    doc.setDrawColor(102, 126, 234);
    doc.setLineWidth(0.3);
    doc.line(15, yPos, 195, yPos);
    yPos += 6;
    
    doc.setFontSize(13);
    doc.setTextColor(102, 126, 234);
    doc.setFont(undefined, 'bold');
    doc.text('PEOPLE IN THE TRIP', 20, yPos);
    doc.setFont(undefined, 'normal');
    yPos += 7;
    
    doc.setFontSize(10);
    doc.setTextColor(0);
    if (people.length === 0) {
        doc.text('No people added', 25, yPos);
        yPos += 7;
    } else {
        people.forEach((person, index) => {
            doc.text(`${index + 1}. ${person.name}`, 25, yPos);
            yPos += 6;
        });
    }
    yPos += 6;
    
    // Expenses Section
    if (yPos > 245) { doc.addPage(); yPos = 20; }
    doc.setDrawColor(102, 126, 234);
    doc.line(15, yPos, 195, yPos);
    yPos += 6;
    
    doc.setFontSize(13);
    doc.setTextColor(102, 126, 234);
    doc.setFont(undefined, 'bold');
    doc.text('ALL EXPENSES', 20, yPos);
    doc.setFont(undefined, 'normal');
    yPos += 7;
    
    doc.setFontSize(10);
    doc.setTextColor(0);
    if (expenses.length === 0) {
        doc.text('No expenses added', 25, yPos);
        yPos += 7;
    } else {
        expenses.forEach((expense, index) => {
            if (yPos > 265) { doc.addPage(); yPos = 20; }
            
            doc.setFont(undefined, 'bold');
            doc.text(`${index + 1}. ${expense.name} paid Rs. ${expense.amount}`, 25, yPos);
            yPos += 5;
            
            doc.setFont(undefined, 'normal');
            doc.setFontSize(9);
            doc.text(`For: ${expense.description}`, 30, yPos);
            yPos += 4;
            
            if (expense.splittingMode === 'custom' && expense.customAmounts) {
                const customDetails = Object.entries(expense.customAmounts)
                    .map(([person, amount]) => `${person}: Rs. ${amount}`)
                    .join(', ');
                doc.text(`Custom amounts - ${customDetails}`, 30, yPos);
            } else {
                doc.text(`Equal split - ${expense.sharedWith ? expense.sharedWith.join(', ') : ''}`, 30, yPos);
            }
            doc.setFontSize(10);
            yPos += 7;
        });
    }
    yPos += 6;
    
    // Settlements Section
    if (expenses.length > 0 && people.length > 0) {
        if (yPos > 250) { doc.addPage(); yPos = 20; }
        
        // Calculate settlements
        const totalSpentByPerson = {};
        const totalShouldPay = {};
        people.forEach(person => {
            totalSpentByPerson[person.name] = 0;
            totalShouldPay[person.name] = 0;
        });
        
        expenses.forEach(expense => {
            totalSpentByPerson[expense.name] += expense.amount;
            
            if (expense.splittingMode === 'custom' && expense.customAmounts) {
                Object.entries(expense.customAmounts).forEach(([personName, amount]) => {
                    totalShouldPay[personName] += amount;
                });
            } else {
                const share = expense.amount / expense.sharedWith.length;
                expense.sharedWith.forEach(personName => {
                    totalShouldPay[personName] += share;
                });
            }
        });
        
        const balances = {};
        people.forEach(person => {
            balances[person.name] = Math.round(totalSpentByPerson[person.name] - totalShouldPay[person.name]);
        });
        
        const settlements = generateOptimalSettlements(balances);
        
        // Settlement Plan Section
        if (yPos > 240) { doc.addPage(); yPos = 20; }
        doc.setDrawColor(102, 126, 234);
        doc.line(15, yPos, 195, yPos);
        yPos += 6;
        
        doc.setFontSize(13);
        doc.setTextColor(102, 126, 234);
        doc.setFont(undefined, 'bold');
        doc.text('SETTLEMENT PLAN', 20, yPos);
        doc.setFont(undefined, 'normal');
        yPos += 7;
        
        doc.setFontSize(10);
        doc.setTextColor(0);
        
        if (settlements.length === 0) {
            doc.setFillColor(212, 237, 218);
            doc.rect(20, yPos - 4, 170, 10, 'F');
            doc.setTextColor(21, 87, 36);
            doc.setFont(undefined, 'bold');
            doc.text('Everyone is settled! No payments needed.', 25, yPos + 2);
            doc.setFont(undefined, 'normal');
            doc.setTextColor(0);
            yPos += 10;
        } else {
            settlements.forEach((settlement, index) => {
                if (yPos > 265) { doc.addPage(); yPos = 20; }
                doc.setFillColor(255, 240, 245);
                doc.rect(20, yPos - 4, 170, 9, 'F');
                doc.setTextColor(220, 53, 69);
                doc.setFont(undefined, 'bold');
                doc.text(`${index + 1}. ${settlement.from} should pay ${settlement.to}: Rs. ${settlement.amount}`, 25, yPos + 2);
                doc.setFont(undefined, 'normal');
                doc.setTextColor(0);
                yPos += 10;
            });
        }
        yPos += 6;
        
        // Individual Breakdown Section
        if (yPos > 225) { doc.addPage(); yPos = 20; }
        doc.setDrawColor(102, 126, 234);
        doc.line(15, yPos, 195, yPos);
        yPos += 6;
        
        doc.setFontSize(13);
        doc.setTextColor(102, 126, 234);
        doc.setFont(undefined, 'bold');
        doc.text('INDIVIDUAL BREAKDOWN', 20, yPos);
        doc.setFont(undefined, 'normal');
        yPos += 7;
        
        doc.setFontSize(10);
        doc.setTextColor(0);
        people.forEach(person => {
            if (yPos > 265) { doc.addPage(); yPos = 20; }
            const spent = Math.round(totalSpentByPerson[person.name]);
            const share = Math.round(totalShouldPay[person.name]);
            const balance = spent - share;
            
            doc.setFont(undefined, 'bold');
            doc.text(`${person.name}:`, 25, yPos);
            doc.setFont(undefined, 'normal');
            doc.text(`Paid Rs. ${spent}, Should pay Rs. ${share}`, 55, yPos);
            yPos += 5;
            
            if (balance > 0) {
                doc.setFillColor(212, 237, 218);
                doc.rect(30, yPos - 4, 100, 7, 'F');
                doc.setTextColor(21, 87, 36);
                doc.text(`Balance: +Rs. ${balance} (Gets back)`, 33, yPos + 1);
            } else if (balance < 0) {
                doc.setFillColor(248, 215, 218);
                doc.rect(30, yPos - 4, 100, 7, 'F');
                doc.setTextColor(114, 28, 36);
                doc.text(`Balance: Rs. ${balance} (Owes)`, 33, yPos + 1);
            } else {
                doc.setTextColor(0);
                doc.text(`Balance: Rs. 0 (Settled)`, 33, yPos + 1);
            }
            doc.setTextColor(0);
            yPos += 9;
        });
    }
    
    // Footer
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(150);
        doc.text(`Page ${i} of ${pageCount}`, 105, 290, { align: 'center' });
        doc.text('Generated by TripWise', 195, 290, { align: 'right' });
    }
    
    // Save PDF
    doc.save('TripWise-Expense-Report.pdf');
}

// Init
window.addEventListener('load', loadData);
