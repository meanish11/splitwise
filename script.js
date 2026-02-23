// ============================================================
//  TripWise â€” Main Script  (Firebase Firestore + Real-time sync)
// ============================================================
//  Firestore structure:
//    Collection: "groups"
//    Document ID: 6-digit group code  (e.g. "AB3C7X")
//    Fields: { name, code, people: [], expenses: [], createdAt }
// ============================================================

let people      = [];
let expenses    = [];
let activeTab   = 'people';
let currentGroupCode  = null;   // code of the open group
let groupUnsubscribe  = null;   // Firestore onSnapshot unsubscribe fn


// ============================================================
//  HELPERS
// ============================================================

/** Generate a random 6-char alphanumeric code (unambiguous chars) */
function generateGroupCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    return code;
}

/** Toast notification */
function showToast(message, type = '') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast-item' + (type ? ' ' + type : '');
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        toast.style.transition = 'all .3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

/** Show/hide a full-screen loading overlay while Firestore calls run */
function setLoading(on, msg = 'Loadingâ€¦') {
    let overlay = document.getElementById('fw-loading-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'fw-loading-overlay';
        overlay.innerHTML = `<div class="fw-loading-box"><div class="fw-spinner"></div><p id="fw-loading-msg">${msg}</p></div>`;
        overlay.style.cssText = `
            position:fixed;inset:0;z-index:9999;
            background:rgba(10,8,40,.82);backdrop-filter:blur(8px);
            display:flex;align-items:center;justify-content:center;
        `;
        const box = overlay.querySelector('.fw-loading-box');
        box.style.cssText = 'text-align:center;color:#E0E7FF;';
        const spinner = overlay.querySelector('.fw-spinner');
        spinner.style.cssText = `
            width:44px;height:44px;border:4px solid rgba(139,92,246,.3);
            border-top-color:#8B5CF6;border-radius:50%;
            animation:fw-spin .8s linear infinite;margin:0 auto 16px;
        `;
        if (!document.querySelector('#fw-spin-keyframe')) {
            const style = document.createElement('style');
            style.id = 'fw-spin-keyframe';
            style.textContent = '@keyframes fw-spin{to{transform:rotate(360deg)}}';
            document.head.appendChild(style);
        }
        document.body.appendChild(overlay);
    }
    document.getElementById('fw-loading-msg').textContent = msg;
    overlay.style.display = on ? 'flex' : 'none';
}


// ============================================================
//  GROUP MANAGEMENT  (Firestore)
// ============================================================

/** Create a new group document in Firestore, show code modal */
async function createGroup(tripName) {
    setLoading(true, 'Creating your tripâ€¦');
    try {
        const groupsRef = db.collection('groups');
        let code;
        let attempts = 0;
        // Find a unique code
        do {
            code = generateGroupCode();
            attempts++;
            const snap = await groupsRef.doc(code).get();
            if (!snap.exists) break;
        } while (attempts < 20);

        await groupsRef.doc(code).set({
            name:      tripName,
            code:      code,
            people:    [],
            expenses:  [],
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        setLoading(false);
        // Show code-reveal modal
        document.getElementById('modalTripName').textContent = tripName;
        document.getElementById('modalCode').textContent = code;
        document.getElementById('codeModal').style.display = 'flex';
        document.getElementById('codeModal').dataset.pendingCode = code;

    } catch (err) {
        setLoading(false);
        console.error('createGroup error:', err);
        showToast('âŒ Could not create group. Check your Firebase config.', 'error');
    }
}

/** Close the modal and enter the workspace */
function closeModalAndEnter() {
    const code = document.getElementById('codeModal').dataset.pendingCode;
    document.getElementById('codeModal').style.display = 'none';
    openWorkspace(code);
}

/** Handle clicking the modal overlay (outside card = close + enter) */
function handleModalOverlayClick(e) {
    if (e.target === document.getElementById('codeModal')) closeModalAndEnter();
}

/** Copy the code shown in the modal */
function copyCodeFromModal() {
    const code = document.getElementById('modalCode').textContent;
    navigator.clipboard.writeText(code).then(() => showToast('Code copied! ðŸŽ‰', 'success'));
}

/** Join an existing group by code */
async function joinGroup(code) {
    setLoading(true, 'Looking up groupâ€¦');
    try {
        const snap = await db.collection('groups').doc(code).get();
        setLoading(false);
        if (!snap.exists) {
            const errEl = document.getElementById('joinError');
            errEl.style.display = 'block';
            errEl.textContent = `âŒ No trip found with code "${code}". Please check and try again.`;
            return;
        }
        openWorkspace(code);
    } catch (err) {
        setLoading(false);
        console.error('joinGroup error:', err);
        showToast('âŒ Could not connect to database. Check your Firebase config.', 'error');
    }
}

/** Show the landing page with a specific tab highlighted */
function showLandingTab(tab) {
    document.querySelectorAll('.landing-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tnav-tab').forEach(el => el.classList.remove('active'));
    const content = document.getElementById('ltab-' + tab);
    const tabBtn  = document.querySelector('.tnav-tab[data-tab="' + tab + '"]');
    if (content) content.classList.add('active');
    if (tabBtn)  tabBtn.classList.add('active');
    const errEl = document.getElementById('joinError');
    if (errEl) errEl.style.display = 'none';
}

/**
 * Open the workspace for a given code.
 * Sets up a real-time Firestore onSnapshot listener so that any device
 * updating the group is reflected instantly on all connected clients.
 */
function openWorkspace(code) {
    // Unsubscribe from any previous listener
    if (groupUnsubscribe) { groupUnsubscribe(); groupUnsubscribe = null; }

    currentGroupCode = code;

    // Switch views immediately (show a loading state in panels)
    document.getElementById('landing-page').style.display   = 'none';
    document.getElementById('workspace-page').style.display = 'flex';
    document.getElementById('groupDisplayCode').textContent = code;
    document.getElementById('groupDisplayName').textContent = 'â€¦';

    initMobilePanels();

    // â”€â”€ Real-time listener â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    groupUnsubscribe = db.collection('groups').doc(code)
        .onSnapshot(snap => {
            if (!snap.exists) {
                showToast('âš  This group was deleted.', 'error');
                goBackToLanding();
                return;
            }
            const data = snap.data();

            // Update runtime state
            people   = data.people   || [];
            expenses = data.expenses || [];

            // Update header
            document.getElementById('groupDisplayName').textContent = data.name || code;

            // Refresh all panels
            displayPeople();
            displayExpenses();
            updatePersonDropdown();
            updateSharedWithCheckboxes();
            updateCustomAmountInputs();
            updateTotalExpenses();

            const srEl = document.getElementById('settlementResults');
            if (srEl) srEl.innerHTML = '<div class="no-data">Add people &amp; expenses, then click Calculate</div>';
            const expBtn = document.getElementById('exportBtn');
            if (expBtn) expBtn.style.display = 'none';
        },
        err => {
            console.error('onSnapshot error:', err);
            showToast('âš  Lost connection to group. Retryingâ€¦', 'error');
        });
}

/** Go back to landing page, detach Firestore listener */
function goBackToLanding() {
    if (groupUnsubscribe) { groupUnsubscribe(); groupUnsubscribe = null; }
    currentGroupCode = null;
    document.getElementById('workspace-page').style.display = 'none';
    document.getElementById('landing-page').style.display   = 'flex';
    showLandingTab('home');
}

/** Copy the current group code to clipboard */
function copyGroupCode() {
    const code = document.getElementById('groupDisplayCode').textContent;
    navigator.clipboard.writeText(code).then(() => showToast('Group code copied! Share it with your friends ðŸŽ‰', 'success'));
}


// ============================================================
//  FIRESTORE WRITE HELPER
// ============================================================

/**
 * Persist the current `people` and `expenses` arrays to Firestore.
 * This is the single write point â€” all mutations call this.
 */
async function saveData() {
    if (!currentGroupCode) return;
    try {
        await db.collection('groups').doc(currentGroupCode).update({
            people:   people,
            expenses: expenses
        });
    } catch (err) {
        console.error('saveData error:', err);
        showToast('âš  Could not save changes.', 'error');
    }
}


// ============================================================
//  DATA INITIALIZATION
// ============================================================

function loadData() {
    // No localStorage â€” just show landing page on first load.
    // The URL hash trick: if someone navigates with ?code=XXXXXX auto-join
    const params = new URLSearchParams(window.location.search);
    const codeParam = params.get('code');
    if (codeParam && codeParam.length === 6) {
        joinGroup(codeParam.toUpperCase());
        return;
    }
    document.getElementById('landing-page').style.display   = 'flex';
    document.getElementById('workspace-page').style.display = 'none';
    showLandingTab('home');
}


// ============================================================
//  PANEL / TAB SYSTEM
// ============================================================

const PANEL_MAP = {
    people:     'panel-people',
    expenses:   'panel-expenses',
    settlement: 'moneySettlementPanel'
};

function isMobile() { return window.innerWidth <= 900; }

function initMobilePanels() {
    if (!isMobile()) return;
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('panel-active'));
    const peoplePanelEl = document.getElementById(PANEL_MAP['people']);
    if (peoplePanelEl) peoplePanelEl.classList.add('panel-active');
    syncMobileTabHighlight('people');
}

function syncMobileTabHighlight(tab) {
    document.querySelectorAll('.mobile-tab').forEach(btn => {
        btn.classList.remove('active');
        btn.setAttribute('aria-selected', 'false');
    });
    const key = tab === 'settlement' ? 'moneySettlementPanel' : tab + '-tab';
    const btn = document.querySelector(`.mobile-tab[data-target="${key}"]`);
    if (btn) { btn.classList.add('active'); btn.setAttribute('aria-selected', 'true'); }
}

function switchTab(tab) {
    activeTab = tab;
    if (!isMobile()) return;
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('panel-active'));
    const panelEl = document.getElementById(PANEL_MAP[tab]);
    if (panelEl) panelEl.classList.add('panel-active');
    syncMobileTabHighlight(tab);
}

function updateSettlementPanelVisibility() { /* handled by CSS / switchTab */ }

window.addEventListener('resize', function() {
    if (!isMobile()) {
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('panel-active'));
    } else {
        const anyActive = document.querySelector('.panel.panel-active');
        if (!anyActive) initMobilePanels();
    }
});


// ============================================================
//  SPLITTING MODE
// ============================================================

function toggleSplittingMode() {
    const mode = document.querySelector('input[name="splittingMode"]:checked').value;
    document.getElementById('equalSplitSection').style.display  = mode === 'equal'  ? 'block' : 'none';
    document.getElementById('customAmountsSection').style.display = mode === 'custom' ? 'block' : 'none';
    if (mode === 'custom') updateCustomAmountInputs();
}

function updateCustomAmountInputs() {
    const container = document.getElementById('customAmountInputs');
    container.innerHTML = '';
    people.forEach(person => {
        const div = document.createElement('div');
        div.className = 'custom-amount-item';
        div.innerHTML = `
            <label>${person.name}:</label>
            <input type="number" class="custom-amount-input" data-person="${person.name}"
                   placeholder="â‚¹0" step="1" min="0" oninput="checkCustomTotal()">
            <span>â‚¹</span>
        `;
        container.appendChild(div);
    });
    checkCustomTotal();
}

function checkCustomTotal() {
    const inputs      = document.querySelectorAll('.custom-amount-input');
    const expAmount   = parseInt(document.getElementById('expenseAmount').value) || 0;
    let customTotal   = 0;
    inputs.forEach(inp => { customTotal += parseInt(inp.value) || 0; });
    const el = document.getElementById('totalCheck');
    if (customTotal === 0) {
        el.textContent = 'Enter amounts to see total';
        el.className = 'total-check';
    } else if (customTotal === expAmount && expAmount > 0) {
        el.textContent = `âœ“ Perfect! Custom total: â‚¹${customTotal} matches expense amount`;
        el.className = 'total-check success';
    } else {
        el.textContent = `âš  Custom total: â‚¹${customTotal}, Expense amount: â‚¹${expAmount}`;
        el.className = 'total-check error';
    }
}


// ============================================================
//  SELECT-ALL (equal split)
// ============================================================

function toggleSelectAll() {
    const checkboxes = document.querySelectorAll('.person-checkbox');
    if (checkboxes.length === 0) { alert('Please add people first!'); return; }
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    checkboxes.forEach(cb => cb.checked = !allChecked);
    document.getElementById('selectAllBtn').textContent = allChecked ? 'Select All' : 'Unselect All';
    updateSelectedCount();
}

function updateSelectedCount() {
    const checkboxes = document.querySelectorAll('.person-checkbox');
    const n = Array.from(checkboxes).filter(cb => cb.checked).length;
    const el = document.getElementById('selectedCount');
    const btn = document.getElementById('selectAllBtn');
    if (el) el.textContent = `${n} selected`;
    if (btn) btn.textContent = (n === 0) ? 'Select All' : (n === checkboxes.length ? 'Unselect All' : 'Select All');
}


// ============================================================
//  ADD / REMOVE PEOPLE
// ============================================================

document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('personForm').addEventListener('submit', async function(e) {
        e.preventDefault();
        const name = document.getElementById('personNameOnly').value.trim();
        if (!name) return;
        if (people.find(p => p.name.toLowerCase() === name.toLowerCase())) {
            alert('This name already exists!'); return;
        }
        people.push({ id: Date.now(), name });
        displayPeople();
        updatePersonDropdown();
        updateSharedWithCheckboxes();
        updateCustomAmountInputs();
        document.getElementById('personForm').reset();
        document.getElementById('settlementResults').innerHTML =
            '<div class="no-data">Click calculate button to see settlements</div>';
        await saveData();
    });
});

async function removePerson(name) {
    const hasExpenses = expenses.some(ex => ex.name === name || (ex.sharedWith && ex.sharedWith.includes(name)));
    if (hasExpenses) { alert('Please remove all expenses involving this person first!'); return; }
    if (!confirm(`Delete "${name}"?`)) return;
    people = people.filter(p => p.name !== name);
    displayPeople();
    updatePersonDropdown();
    updateSharedWithCheckboxes();
    updateCustomAmountInputs();
    document.getElementById('settlementResults').innerHTML =
        '<div class="no-data">Click calculate button to see settlements</div>';
    await saveData();
}


// ============================================================
//  ADD / REMOVE EXPENSES
// ============================================================

document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('expenseForm').addEventListener('submit', async function(e) {
        e.preventDefault();
        const payer       = document.getElementById('personSelect').value;
        const amount      = parseInt(document.getElementById('expenseAmount').value) || 0;
        const description = document.getElementById('expenseDescription').value.trim();
        const mode        = document.querySelector('input[name="splittingMode"]:checked').value;

        if (!payer)    { alert('Please select who paid.'); return; }
        if (amount <= 0) { alert('Please enter a valid amount.'); return; }

        let sharedWith = [], customAmounts = {};

        if (mode === 'equal') {
            sharedWith = Array.from(document.querySelectorAll('.person-checkbox'))
                             .filter(c => c.checked).map(c => c.value);
            if (sharedWith.length === 0) { alert('Please select at least one person.'); return; }
        } else {
            let customTotal = 0;
            document.querySelectorAll('.custom-amount-input').forEach(inp => {
                const pa = parseInt(inp.value) || 0;
                if (pa > 0) {
                    sharedWith.push(inp.dataset.person);
                    customAmounts[inp.dataset.person] = pa;
                    customTotal += pa;
                }
            });
            if (sharedWith.length === 0) { alert('Please enter amounts for at least one person.'); return; }
            if (customTotal !== amount) {
                alert(`Custom amounts total (â‚¹${customTotal}) must equal the expense amount (â‚¹${amount}).`); return;
            }
        }

        expenses.push({
            id:           Date.now(),
            name:         payer,
            amount:       amount,
            description:  description || 'General expense',
            sharedWith:   sharedWith,
            splittingMode: mode,
            customAmounts: mode === 'custom' ? customAmounts : null
        });

        displayExpenses();
        displayPeople();
        updateTotalExpenses();
        document.getElementById('expenseForm').reset();
        updateSharedWithCheckboxes();
        updateCustomAmountInputs();
        checkCustomTotal();
        document.getElementById('settlementResults').innerHTML =
            '<div class="no-data">Click calculate button to see settlements</div>';
        await saveData();
    });

    // Track expense amount field for custom-total check
    const amtInput = document.getElementById('expenseAmount');
    if (amtInput) amtInput.addEventListener('input', checkCustomTotal);

    // Landing — Create Group form
    const createForm = document.getElementById('createGroupForm');
    if (createForm) {
        createForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const name = document.getElementById('tripName').value.trim();
            if (!name) return;
            createGroup(name);
            this.reset();
        });
    }

    // Landing — Join Group form
    const joinForm = document.getElementById('joinGroupForm');
    if (joinForm) {
        joinForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const code = document.getElementById('joinCode').value.trim().toUpperCase();
            if (code.length !== 6) {
                const errEl = document.getElementById('joinError');
                errEl.style.display = 'block';
                errEl.textContent = '❌ Please enter a valid 6-character code.';
                return;
            }
            joinGroup(code);
            this.reset();
        });
    }

    initMobilePanels();
});

async function removeExpense(id) {
    if (!confirm('Delete this expense?')) return;
    expenses = expenses.filter(ex => ex.id !== id);
    displayExpenses();
    displayPeople();
    updateTotalExpenses();
    updateSharedWithCheckboxes();
    updateCustomAmountInputs();
    document.getElementById('settlementResults').innerHTML =
        '<div class="no-data">Click calculate button to see settlements</div>';
    await saveData();
}

async function clearAllData() {
    if (!confirm('Clear ALL people and expenses in this trip? This cannot be undone.')) return;
    people = []; expenses = [];
    await saveData();
    displayPeople(); displayExpenses();
    updatePersonDropdown(); updateSharedWithCheckboxes();
    updateCustomAmountInputs(); updateTotalExpenses();
    document.getElementById('settlementResults').innerHTML =
        '<div class="no-data">First add people and expenses, then calculate</div>';
}


// ============================================================
//  UI RENDER FUNCTIONS
// ============================================================

function displayPeople() {
    const container = document.getElementById('peopleContainer');
    if (people.length === 0) {
        container.innerHTML = '<div class="no-data">No people added yet ðŸ¤·</div>'; return;
    }
    container.innerHTML = `<div class="people-grid">${
        people.map(p => `
            <div class="person-item">
                <div class="person-details"><div class="person-name">${p.name}</div></div>
                <button class="btn-delete-person" onclick="removePerson('${p.name}')" title="Delete">Ã—</button>
            </div>`).join('')
    }</div>`;
}

function displayExpenses() {
    const container = document.getElementById('expensesContainer');
    if (expenses.length === 0) {
        container.innerHTML = '<div class="no-data">No expenses added yet ðŸ“­</div>'; return;
    }
    container.innerHTML = expenses.map(ex => {
        let info = ex.splittingMode === 'custom' && ex.customAmounts
            ? 'Custom: ' + Object.entries(ex.customAmounts).map(([p,a]) => `${p}: â‚¹${a}`).join(', ')
            : 'Equal split â€” ' + (ex.sharedWith ? ex.sharedWith.join(', ') : '');
        return `
            <div class="expense-item">
                <div class="expense-details">
                    <div class="expense-name">${ex.name} paid â‚¹${ex.amount}</div>
                    <div class="expense-amount">For: ${ex.description} â€¢ ${info}</div>
                </div>
                <button class="btn-delete-expense" onclick="removeExpense(${ex.id})" title="Delete">Ã—</button>
            </div>`;
    }).join('');
}

function updatePersonDropdown() {
    const sel = document.getElementById('personSelect');
    sel.innerHTML = '<option value="">Select person</option>';
    people.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name; opt.textContent = p.name;
        sel.appendChild(opt);
    });
}

function updateSharedWithCheckboxes() {
    const container = document.getElementById('sharedWithCheckboxes');
    container.innerHTML = '';
    people.forEach(p => {
        const span = document.createElement('span');
        span.className = 'multi-checkbox-person';
        span.innerHTML = `<label><input type="checkbox" class="person-checkbox" value="${p.name}" onchange="updateSelectedCount()"> ${p.name}</label>`;
        container.appendChild(span);
    });
    updateSelectedCount();
}

function updateTotalExpenses() {
    const total  = expenses.reduce((s, ex) => s + (ex.amount || 0), 0);
    const div    = document.getElementById('totalExpenses');
    if (total > 0) {
        div.style.display = 'block';
        div.querySelector('.total-amount').textContent = `â‚¹${total}`;
    } else {
        div.style.display = 'none';
    }
}


// ============================================================
//  SETTLEMENT CALCULATION
// ============================================================

function calculateSettlements() {
    if (people.length  === 0) { document.getElementById('settlementResults').innerHTML = '<div class="no-data">Please add people first</div>'; return; }
    if (expenses.length === 0) { document.getElementById('settlementResults').innerHTML = '<div class="no-data">Please add some expenses first</div>'; return; }

    const spent  = {}, shouldPay = {};
    people.forEach(p => { spent[p.name] = 0; shouldPay[p.name] = 0; });

    expenses.forEach(ex => {
        spent[ex.name] += ex.amount;
        if (ex.splittingMode === 'custom' && ex.customAmounts) {
            Object.entries(ex.customAmounts).forEach(([name, amt]) => { shouldPay[name] += amt; });
        } else {
            const share = ex.amount / ex.sharedWith.length;
            ex.sharedWith.forEach(name => { shouldPay[name] += share; });
        }
    });

    const balances = {};
    people.forEach(p => { balances[p.name] = Math.round(spent[p.name] - shouldPay[p.name]); });

    const settlements = generateOptimalSettlements(balances);
    const totalAmt    = expenses.reduce((s, ex) => s + (ex.amount || 0), 0);
    displaySettlements(settlements, spent, shouldPay, totalAmt);
}

function generateOptimalSettlements(balances) {
    const creditors = [], debtors = [];
    Object.entries(balances).forEach(([name, bal]) => {
        if (bal > 0) creditors.push({ name, amount: bal });
        else if (bal < 0) debtors.push({ name, amount: -bal });
    });
    creditors.sort((a, b) => b.amount - a.amount);
    debtors.sort((a, b) => b.amount - a.amount);
    const settlements = [];
    let i = 0, j = 0;
    while (i < creditors.length && j < debtors.length) {
        const c = creditors[i], d = debtors[j];
        const amt = Math.min(c.amount, d.amount);
        if (amt > 0) settlements.push({ from: d.name, to: c.name, amount: amt });
        c.amount -= amt; d.amount -= amt;
        if (c.amount <= 0) i++;
        if (d.amount <= 0) j++;
    }
    return settlements;
}

function displaySettlements(settlements, spent, shouldPay, totalAmt) {
    const container = document.getElementById('settlementResults');
    let html = '';

    if (settlements.length === 0) {
        html = `
            <div class="settlement-item" style="border-left-color:#10B981;">
                <div class="settlement-text">ðŸŽ‰ Everyone is settled up!</div>
                <div class="settlement-amount" style="color:#34D399;">No payments needed</div>
            </div>`;
    } else {
        html = `<div style="font-size:.8rem;color:rgba(199,210,254,.6);font-weight:700;text-transform:uppercase;letter-spacing:.6px;margin-bottom:10px;">ðŸ’¸ Who Pays Whom</div>`;
        settlements.forEach(s => {
            html += `
                <div class="settlement-item debt">
                    <div class="settlement-text"><strong>${s.from}</strong> â†’ <strong>${s.to}</strong></div>
                    <div class="settlement-amount">â‚¹${s.amount}</div>
                </div>`;
        });
    }

    // Breakdown
    html += `<div style="font-size:.8rem;color:rgba(199,210,254,.6);font-weight:700;text-transform:uppercase;letter-spacing:.6px;margin:20px 0 10px;">ðŸ“Š Breakdown</div>`;
    people.forEach(p => {
        const s = Math.round(spent[p.name]), sh = Math.round(shouldPay[p.name]), bal = s - sh;
        html += `
            <div class="settlement-item ${bal < 0 ? 'debt' : ''}">
                <div class="settlement-text"><strong>${p.name}</strong> paid â‚¹${s}, owes â‚¹${sh}</div>
                <div class="settlement-amount" style="color:${bal > 0 ? '#34D399' : bal < 0 ? '#F87171' : '#A5B4FC'}">
                    ${bal > 0 ? '+' : ''}â‚¹${bal}
                </div>
            </div>`;
    });

    container.innerHTML = html;
    const expBtn = document.getElementById('exportBtn');
    if (expBtn) expBtn.style.display = 'block';
}


// ============================================================
//  PDF EXPORT  (unchanged logic, updated colors)
// ============================================================

function exportToPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    doc.setDrawColor(99, 102, 241);
    doc.setLineWidth(0.5);
    doc.rect(10, 10, 190, 277);

    doc.setFillColor(67, 56, 202);
    doc.rect(15, 15, 180, 15, 'F');
    doc.setFontSize(18);
    doc.setTextColor(255, 255, 255);
    doc.setFont(undefined, 'bold');
    const tripLabel = currentGroupCode
        ? (document.getElementById('groupDisplayName').textContent.toUpperCase() + ' â€” EXPENSE REPORT')
        : 'TRIPWISE â€” EXPENSE REPORT';
    doc.text(tripLabel, 105, 24, { align: 'center' });

    doc.setFontSize(9); doc.setTextColor(100); doc.setFont(undefined, 'normal');
    const today = new Date().toLocaleDateString('en-IN', { year:'numeric', month:'long', day:'numeric' });
    doc.text(`Generated on: ${today}    |    Group Code: ${currentGroupCode || 'â€”'}`, 105, 36, { align: 'center' });

    let y = 48;

    if (expenses.length > 0) {
        const tot = expenses.reduce((s, ex) => s + (ex.amount || 0), 0);
        doc.setFillColor(240, 240, 240);
        doc.rect(15, y - 5, 180, 12, 'F');
        doc.setFontSize(13); doc.setTextColor(0); doc.setFont(undefined, 'bold');
        doc.text(`TOTAL TRIP EXPENSES: Rs. ${tot}`, 105, y + 2, { align: 'center' });
        doc.setFont(undefined, 'normal'); y += 16;
    }

    const section = (title) => {
        if (y > 245) { doc.addPage(); y = 20; }
        doc.setDrawColor(99, 102, 241); doc.setLineWidth(0.3);
        doc.line(15, y, 195, y); y += 6;
        doc.setFontSize(13); doc.setTextColor(99, 102, 241); doc.setFont(undefined, 'bold');
        doc.text(title, 20, y); doc.setFont(undefined, 'normal'); y += 7;
        doc.setFontSize(10); doc.setTextColor(0);
    };

    section('PEOPLE IN THE TRIP');
    if (people.length === 0) { doc.text('No people added', 25, y); y += 7; }
    else people.forEach((p, i) => { doc.text(`${i + 1}. ${p.name}`, 25, y); y += 6; });
    y += 6;

    section('ALL EXPENSES');
    if (expenses.length === 0) { doc.text('No expenses added', 25, y); y += 7; }
    else expenses.forEach((ex, i) => {
        if (y > 265) { doc.addPage(); y = 20; }
        doc.setFont(undefined, 'bold'); doc.text(`${i + 1}. ${ex.name} paid Rs. ${ex.amount}`, 25, y); y += 5;
        doc.setFont(undefined, 'normal'); doc.setFontSize(9);
        doc.text(`For: ${ex.description}`, 30, y); y += 4;
        const info = ex.splittingMode === 'custom' && ex.customAmounts
            ? 'Custom: ' + Object.entries(ex.customAmounts).map(([p,a]) => `${p}: Rs. ${a}`).join(', ')
            : 'Equal split â€” ' + (ex.sharedWith ? ex.sharedWith.join(', ') : '');
        doc.text(info, 30, y); doc.setFontSize(10); y += 7;
    });
    y += 6;

    if (expenses.length > 0 && people.length > 0) {
        const sp = {}, sh = {};
        people.forEach(p => { sp[p.name] = 0; sh[p.name] = 0; });
        expenses.forEach(ex => {
            sp[ex.name] += ex.amount;
            if (ex.splittingMode === 'custom' && ex.customAmounts)
                Object.entries(ex.customAmounts).forEach(([n, a]) => { sh[n] += a; });
            else { const s = ex.amount / ex.sharedWith.length; ex.sharedWith.forEach(n => { sh[n] += s; }); }
        });
        const balances = {};
        people.forEach(p => { balances[p.name] = Math.round(sp[p.name] - sh[p.name]); });
        const settlements = generateOptimalSettlements(balances);

        section('SETTLEMENT PLAN');
        if (settlements.length === 0) {
            doc.setFillColor(212, 237, 218); doc.rect(20, y - 4, 170, 10, 'F');
            doc.setTextColor(21, 87, 36); doc.setFont(undefined, 'bold');
            doc.text('Everyone is settled! No payments needed.', 25, y + 2);
            doc.setFont(undefined, 'normal'); doc.setTextColor(0); y += 10;
        } else {
            settlements.forEach((s, i) => {
                if (y > 265) { doc.addPage(); y = 20; }
                doc.setFillColor(255, 240, 245); doc.rect(20, y - 4, 170, 9, 'F');
                doc.setTextColor(220, 53, 69); doc.setFont(undefined, 'bold');
                doc.text(`${i + 1}. ${s.from} â†’ ${s.to}: Rs. ${s.amount}`, 25, y + 2);
                doc.setFont(undefined, 'normal'); doc.setTextColor(0); y += 10;
            });
        }
        y += 6;

        section('INDIVIDUAL BREAKDOWN');
        people.forEach(p => {
            if (y > 265) { doc.addPage(); y = 20; }
            const paid = Math.round(sp[p.name]), owes = Math.round(sh[p.name]), bal = paid - owes;
            doc.setFont(undefined, 'bold'); doc.text(`${p.name}:`, 25, y);
            doc.setFont(undefined, 'normal'); doc.text(`Paid Rs. ${paid}, Should pay Rs. ${owes}`, 55, y); y += 5;
            if (bal > 0) { doc.setFillColor(212, 237, 218); doc.rect(30, y - 4, 100, 7, 'F'); doc.setTextColor(21, 87, 36); doc.text(`+Rs. ${bal} (Gets back)`, 33, y + 1); }
            else if (bal < 0) { doc.setFillColor(248, 215, 218); doc.rect(30, y - 4, 100, 7, 'F'); doc.setTextColor(114, 28, 36); doc.text(`Rs. ${bal} (Owes)`, 33, y + 1); }
            else { doc.setTextColor(0); doc.text('Settled âœ“', 33, y + 1); }
            doc.setTextColor(0); y += 9;
        });
    }

    const pages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setFontSize(8); doc.setTextColor(150);
        doc.text(`Page ${i} of ${pages}`, 105, 290, { align: 'center' });
        doc.text('Generated by TripWise', 195, 290, { align: 'right' });
    }

    const name = (document.getElementById('groupDisplayName').textContent || 'TripWise').replace(/\s+/g, '-');
    doc.save(`${name}-Expense-Report.pdf`);
}


// ============================================================
//  BOOT
// ============================================================
window.addEventListener('load', loadData);
