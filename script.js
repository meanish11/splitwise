// ============================================================
//  TripWise  Main Script  (Firebase Firestore + Real-time sync)
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
function setLoading(on, msg = 'Loading') {
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
    setLoading(true, 'Creating your trip');
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
        showToast(' Could not create group. Check your Firebase config.', 'error');
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
    navigator.clipboard.writeText(code).then(() => showToast('Code copied! ', 'success'));
}

/** Join an existing group by code */
async function joinGroup(code) {
    setLoading(true, 'Looking up group');
    try {
        const snap = await db.collection('groups').doc(code).get();
        setLoading(false);
        if (!snap.exists) {
            const errEl = document.getElementById('joinError');
            errEl.style.display = 'block';
            errEl.textContent = ` No trip found with code "${code}". Please check and try again.`;
            return;
        }
        openWorkspace(code);
    } catch (err) {
        setLoading(false);
        console.error('joinGroup error:', err);
        showToast(' Could not connect to database. Check your Firebase config.', 'error');
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
    document.getElementById('groupDisplayName').textContent = '';

    initMobilePanels();

    //  Real-time listener 
    groupUnsubscribe = db.collection('groups').doc(code)
        .onSnapshot(snap => {
            if (!snap.exists) {
                showToast(' This group was deleted.', 'error');
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
            showToast(' Lost connection to group. Retrying', 'error');
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
    navigator.clipboard.writeText(code).then(() => showToast('Group code copied! Share it with your friends ', 'success'));
}


// ============================================================
//  FIRESTORE WRITE HELPER
// ============================================================

/**
 * Persist the current `people` and `expenses` arrays to Firestore.
 * This is the single write point  all mutations call this.
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
        showToast(' Could not save changes.', 'error');
    }
}


// ============================================================
//  DATA INITIALIZATION
// ============================================================

function loadData() {
    // No localStorage  just show landing page on first load.
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
                   placeholder="0" step="1" min="0" oninput="checkCustomTotal()">
            <span></span>
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
        el.textContent = ` Perfect! Custom total: ${customTotal} matches expense amount`;
        el.className = 'total-check success';
    } else {
        el.textContent = ` Custom total: ${customTotal}, Expense amount: ${expAmount}`;
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
                alert(`Custom amounts total (${customTotal}) must equal the expense amount (${amount}).`); return;
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

    // Landing - Create Group form
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

    // Landing - Join Group form
    const joinForm = document.getElementById('joinGroupForm');
    if (joinForm) {
        joinForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const code = document.getElementById('joinCode').value.trim().toUpperCase();
            if (code.length !== 6) {
                const errEl = document.getElementById('joinError');
                errEl.style.display = 'block';
                errEl.textContent = ' Please enter a valid 6-character code.';
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
        container.innerHTML = '<div class="no-data">No people added yet </div>'; return;
    }
    container.innerHTML = `<div class="people-grid">${
        people.map(p => `
            <div class="person-item">
                <div class="person-details"><div class="person-name">${p.name}</div></div>
                <button class="btn-delete-person" onclick="removePerson('${p.name}')" title="Delete">&times;</button>
            </div>`).join('')
    }</div>`;
}

function displayExpenses() {
    const container = document.getElementById('expensesContainer');
    if (expenses.length === 0) {
        container.innerHTML = '<div class="no-data">No expenses added yet </div>'; return;
    }
    container.innerHTML = expenses.map(ex => {
        let info = ex.splittingMode === 'custom' && ex.customAmounts
            ? 'Custom: ' + Object.entries(ex.customAmounts).map(([p,a]) => `${p}: &#x20B9;${a}`).join(', ')
            : 'Equal split &mdash; ' + (ex.sharedWith ? ex.sharedWith.join(', ') : '');
        return `
            <div class="expense-item">
                <div class="expense-details">
                    <div class="expense-name">${ex.name} paid &#x20B9;${ex.amount}</div>
                    <div class="expense-amount">For: ${ex.description} &bull; ${info}</div>
                </div>
                <button class="btn-delete-expense" onclick="removeExpense(${ex.id})" title="Delete">&times;</button>
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
        div.querySelector('.total-amount').textContent = '\u20B9' + total;
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
    const totalAmt2 = expenses.reduce((acc, ex) => acc + (ex.amount || 0), 0);
    const perPerson = people.length > 0 ? Math.round(totalAmt2 / people.length) : 0;
    let html = '';

    // ── Summary bar ──────────────────────────────────────────
    html += `
        <div style="background:linear-gradient(135deg,rgba(99,102,241,.18),rgba(139,92,246,.12));
                    border:1px solid rgba(139,92,246,.3);border-radius:10px;
                    padding:12px 16px;margin-bottom:18px;font-size:.85rem;
                    color:rgba(199,210,254,.8);line-height:1.8;">
            <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px;">
                <span>&#x1F4B0; Total spent: <strong style="color:#E0E7FF;">&#x20B9;${totalAmt2}</strong></span>
                <span>&#x1F465; ${people.length} people</span>
                <span>&#x2696;&#xFE0F; Equal share per person: <strong style="color:#E0E7FF;">&#x20B9;${perPerson}</strong></span>
            </div>
        </div>`;

    // ── Who pays whom ─────────────────────────────────────────
    if (settlements.length === 0) {
        html += `
            <div style="background:rgba(16,185,129,.1);border:1px solid rgba(16,185,129,.3);
                        border-radius:10px;padding:16px;text-align:center;margin-bottom:18px;">
                <div style="font-size:1.1rem;font-weight:700;color:#34D399;margin-bottom:4px;">
                    &#x1F389; Everyone is settled up!
                </div>
                <div style="font-size:.85rem;color:rgba(199,210,254,.6);">
                    All ${people.length} people have paid their exact fair share. No transfers needed.
                </div>
            </div>`;
    } else {
        html += `<div style="font-size:.72rem;color:rgba(199,210,254,.45);font-weight:700;
                             text-transform:uppercase;letter-spacing:.9px;margin-bottom:10px;">
                    &#x1F4B8; Who Pays Whom (${settlements.length} transfer${settlements.length > 1 ? 's' : ''})
                 </div>`;
        settlements.forEach((s, i) => {
            const fromPaid   = Math.round(spent[s.from] || 0);
            const fromShare  = Math.round(shouldPay[s.from] || 0);
            const toPaid     = Math.round(spent[s.to] || 0);
            const toShare    = Math.round(shouldPay[s.to] || 0);
            html += `
                <div style="background:rgba(255,255,255,.04);border:1px solid rgba(248,113,113,.25);
                            border-left:4px solid #F87171;border-radius:10px;
                            padding:14px 16px;margin-bottom:12px;">
                    <div style="font-size:.7rem;color:rgba(199,210,254,.4);font-weight:700;
                                text-transform:uppercase;letter-spacing:.7px;margin-bottom:8px;">
                        Transfer ${i + 1} of ${settlements.length}
                    </div>
                    <div style="font-size:1rem;color:#E0E7FF;font-weight:600;margin-bottom:6px;">
                        <span style="color:#FCA5A5;">${s.from}</span>
                        <span style="color:rgba(199,210,254,.4);"> must pay </span>
                        <span style="color:#86EFAC;">${s.to}</span>
                    </div>
                    <div style="font-size:1.6rem;font-weight:800;color:#60A5FA;margin-bottom:10px;">
                        &#x20B9;${s.amount}
                    </div>
                    <div style="border-top:1px solid rgba(255,255,255,.07);padding-top:10px;
                                display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                        <div style="background:rgba(248,113,113,.08);border-radius:8px;padding:8px 10px;">
                            <div style="font-size:.7rem;color:#FCA5A5;font-weight:700;
                                        text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">
                                ${s.from} (payer)
                            </div>
                            <div style="font-size:.8rem;color:rgba(199,210,254,.7);line-height:1.7;">
                                Spent: <strong style="color:#E0E7FF;">&#x20B9;${fromPaid}</strong><br>
                                Fair share: <strong style="color:#E0E7FF;">&#x20B9;${fromShare}</strong><br>
                                <span style="color:#FCA5A5;">Owes total: &#x20B9;${fromShare - fromPaid > 0 ? fromShare - fromPaid : 0}</span>
                            </div>
                        </div>
                        <div style="background:rgba(134,239,172,.08);border-radius:8px;padding:8px 10px;">
                            <div style="font-size:.7rem;color:#86EFAC;font-weight:700;
                                        text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">
                                ${s.to} (receiver)
                            </div>
                            <div style="font-size:.8rem;color:rgba(199,210,254,.7);line-height:1.7;">
                                Spent: <strong style="color:#E0E7FF;">&#x20B9;${toPaid}</strong><br>
                                Fair share: <strong style="color:#E0E7FF;">&#x20B9;${toShare}</strong><br>
                                <span style="color:#86EFAC;">Recovers: &#x20B9;${toPaid - toShare > 0 ? toPaid - toShare : 0}</span>
                            </div>
                        </div>
                    </div>
                </div>`;
        });
    }

    // ── Individual breakdown ──────────────────────────────────
    html += `<div style="font-size:.72rem;color:rgba(199,210,254,.45);font-weight:700;
                         text-transform:uppercase;letter-spacing:.9px;margin:20px 0 10px;">
                &#x1F4CA; Individual Breakdown
             </div>`;

    people.forEach(p => {
        const s   = Math.round(spent[p.name]);
        const sh  = Math.round(shouldPay[p.name]);
        const bal = s - sh;
        const isCreditor = bal > 0, isDebtor = bal < 0;

        // Who does this person receive from / pay to?
        const receives = settlements.filter(t => t.to   === p.name).map(t => `<strong style="color:#FCA5A5;">${t.from}</strong> pays &#x20B9;${t.amount}`);
        const pays     = settlements.filter(t => t.from === p.name).map(t => `&#x20B9;${t.amount} to <strong style="color:#86EFAC;">${t.to}</strong>`);

        const borderColor = isCreditor ? '#34D399' : isDebtor ? '#F87171' : '#818CF8';
        const badge = isCreditor
            ? `<span style="background:rgba(16,185,129,.15);color:#34D399;border:1px solid rgba(16,185,129,.35);
                            border-radius:20px;padding:2px 10px;font-size:.75rem;font-weight:700;">
                    &#x2B06;&#xFE0F; Gets back &#x20B9;${bal}
               </span>`
            : isDebtor
            ? `<span style="background:rgba(248,113,113,.15);color:#F87171;border:1px solid rgba(248,113,113,.35);
                            border-radius:20px;padding:2px 10px;font-size:.75rem;font-weight:700;">
                    &#x2B07;&#xFE0F; Owes &#x20B9;${Math.abs(bal)}
               </span>`
            : `<span style="background:rgba(129,140,248,.15);color:#818CF8;border:1px solid rgba(129,140,248,.35);
                            border-radius:20px;padding:2px 10px;font-size:.75rem;font-weight:700;">
                    &#x2714;&#xFE0F; Settled
               </span>`;

        html += `
            <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);
                        border-left:4px solid ${borderColor};border-radius:10px;
                        padding:14px 16px;margin-bottom:10px;">
                <div style="display:flex;justify-content:space-between;align-items:center;
                            flex-wrap:wrap;gap:8px;margin-bottom:10px;">
                    <div style="font-size:1rem;font-weight:700;color:#E0E7FF;">${p.name}</div>
                    ${badge}
                </div>
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:${(pays.length || receives.length) ? '10px' : '0'};">
                    <div style="background:rgba(99,102,241,.1);border-radius:7px;padding:8px;text-align:center;">
                        <div style="font-size:.68rem;color:rgba(199,210,254,.45);text-transform:uppercase;
                                    letter-spacing:.5px;margin-bottom:3px;">Total Paid</div>
                        <div style="font-size:1rem;font-weight:700;color:#E0E7FF;">&#x20B9;${s}</div>
                    </div>
                    <div style="background:rgba(99,102,241,.1);border-radius:7px;padding:8px;text-align:center;">
                        <div style="font-size:.68rem;color:rgba(199,210,254,.45);text-transform:uppercase;
                                    letter-spacing:.5px;margin-bottom:3px;">Fair Share</div>
                        <div style="font-size:1rem;font-weight:700;color:#E0E7FF;">&#x20B9;${sh}</div>
                    </div>
                    <div style="background:rgba(99,102,241,.1);border-radius:7px;padding:8px;text-align:center;">
                        <div style="font-size:.68rem;color:rgba(199,210,254,.45);text-transform:uppercase;
                                    letter-spacing:.5px;margin-bottom:3px;">Balance</div>
                        <div style="font-size:1rem;font-weight:700;color:${borderColor};">
                            ${bal > 0 ? '+' : ''}&#x20B9;${bal}
                        </div>
                    </div>
                </div>
                ${pays.length ? `<div style="font-size:.8rem;color:rgba(199,210,254,.6);margin-top:6px;">
                    &#x27A1;&#xFE0F; <strong style="color:#FCA5A5;">${p.name}</strong> needs to send: ${pays.join(', ')}
                </div>` : ''}
                ${receives.length ? `<div style="font-size:.8rem;color:rgba(199,210,254,.6);margin-top:4px;">
                    &#x2B05;&#xFE0F; <strong style="color:#86EFAC;">${p.name}</strong> will receive from: ${receives.join(', ')}
                </div>` : ''}
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
    const PW = 210, ML = 14, MR = 196, CW = MR - ML;

    // ── helpers ──────────────────────────────────────────────
    const bold   = (sz, r=0,g=0,b=0) => { doc.setFont(undefined,'bold');   doc.setFontSize(sz); doc.setTextColor(r,g,b); };
    const normal = (sz, r=0,g=0,b=0) => { doc.setFont(undefined,'normal'); doc.setFontSize(sz); doc.setTextColor(r,g,b); };
    const checkPage = (need=12) => { if (y + need > 280) { doc.addPage(); y = 18; } };

    const sectionHeader = (title) => {
        checkPage(14);
        doc.setFillColor(67, 56, 202);
        doc.rect(ML, y - 1, CW, 9, 'F');
        bold(10, 255, 255, 255);
        doc.text(title, ML + 3, y + 5.5);
        y += 13;
        normal(9, 0, 0, 0);
    };

    const row = (label, value, labelX, valueX, rowY, labelBold=false, vR=0,vG=0,vB=0) => {
        if (labelBold) bold(9, 80, 80, 80); else normal(9, 80, 80, 80);
        doc.text(label, labelX, rowY);
        bold(9, vR, vG, vB);
        doc.text(value, valueX, rowY, { align: 'right' });
        normal(9, 0, 0, 0);
    };

    // ── HEADER ───────────────────────────────────────────────
    doc.setFillColor(67, 56, 202);
    doc.rect(0, 0, PW, 22, 'F');
    bold(16, 255, 255, 255);
    const tripName = currentGroupCode
        ? document.getElementById('groupDisplayName').textContent
        : 'TripWise';
    doc.text(tripName + ' — Expense Report', PW / 2, 10, { align: 'center' });
    normal(8, 200, 200, 255);
    const today = new Date().toLocaleDateString('en-IN', { year:'numeric', month:'long', day:'numeric' });
    doc.text(`${today}   |   Group Code: ${currentGroupCode || '—'}`, PW / 2, 17, { align: 'center' });

    let y = 28;

    // ── TRIP SUMMARY PILL ────────────────────────────────────
    if (expenses.length > 0) {
        const tot = expenses.reduce((s, ex) => s + (ex.amount || 0), 0);
        doc.setFillColor(240, 243, 255);
        doc.rect(ML, y, CW, 10, 'F');
        bold(10, 67, 56, 202);
        doc.text(`Total Trip Spend: Rs. ${tot}   |   ${people.length} members   |   Rs. ${Math.round(tot/Math.max(people.length,1))} per person`, ML + 3, y + 6.5);
        y += 14;
    }

    // ── PEOPLE ───────────────────────────────────────────────
    sectionHeader('MEMBERS');
    if (people.length === 0) { normal(9,100,100,100); doc.text('No people added.', ML+3, y); y += 7; }
    else {
        const names = people.map(p => p.name).join('   •   ');
        normal(9, 30, 30, 30);
        const lines = doc.splitTextToSize(names, CW - 4);
        doc.text(lines, ML + 3, y);
        y += lines.length * 5 + 4;
    }

    // ── EXPENSES TABLE ───────────────────────────────────────
    sectionHeader('EXPENSE LOG');
    if (expenses.length === 0) { normal(9,100,100,100); doc.text('No expenses added.', ML+3, y); y += 7; }
    else {
        // Table header
        doc.setFillColor(220, 220, 235);
        doc.rect(ML, y - 2, CW, 7, 'F');
        bold(8, 60, 60, 100);
        doc.text('#', ML+2, y+3);
        doc.text('Paid By', ML+10, y+3);
        doc.text('Description', ML+42, y+3);
        doc.text('Split Among', ML+100, y+3);
        doc.text('Amount', MR, y+3, { align:'right' });
        y += 9;

        expenses.forEach((ex, i) => {
            checkPage(10);
            const bg = i % 2 === 0 ? [250,250,255] : [255,255,255];
            doc.setFillColor(...bg); doc.rect(ML, y-2, CW, 8, 'F');

            normal(8, 0, 0, 0);
            doc.text(`${i+1}`, ML+2, y+3);
            bold(8, 0,0,0);
            doc.text(ex.name, ML+10, y+3);
            normal(8, 60,60,60);
            const desc = doc.splitTextToSize(ex.description || '—', 55);
            doc.text(desc[0], ML+42, y+3);
            const splitInfo = ex.splittingMode === 'custom' && ex.customAmounts
                ? 'Custom split'
                : (ex.sharedWith ? ex.sharedWith.join(', ') : '');
            const splitLines = doc.splitTextToSize(splitInfo, 52);
            doc.text(splitLines[0], ML+100, y+3);
            bold(8, 30,80,200);
            doc.text(`Rs. ${ex.amount}`, MR, y+3, { align:'right' });
            y += 8;

            // extra detail line if custom amounts
            if (ex.splittingMode === 'custom' && ex.customAmounts) {
                checkPage(6);
                normal(7, 120,120,120);
                const detail = Object.entries(ex.customAmounts).map(([n,a]) => `${n}: Rs.${a}`).join('  ');
                const dLines = doc.splitTextToSize(detail, CW - 8);
                doc.text(dLines[0], ML+14, y);
                y += 5;
            }
        });
        y += 4;
    }

    // ── SETTLEMENT ───────────────────────────────────────────
    if (expenses.length > 0 && people.length > 0) {
        const sp = {}, sh = {};
        people.forEach(p => { sp[p.name] = 0; sh[p.name] = 0; });
        expenses.forEach(ex => {
            sp[ex.name] += ex.amount;
            if (ex.splittingMode === 'custom' && ex.customAmounts)
                Object.entries(ex.customAmounts).forEach(([n,a]) => { sh[n] += a; });
            else { const s = ex.amount / ex.sharedWith.length; ex.sharedWith.forEach(n => { sh[n] += s; }); }
        });
        const balances = {};
        people.forEach(p => { balances[p.name] = Math.round(sp[p.name] - sh[p.name]); });
        const settlements = generateOptimalSettlements(balances);
        const totalExpAmt = expenses.reduce((acc, ex) => acc + (ex.amount || 0), 0);
        const perHead = Math.round(totalExpAmt / Math.max(people.length, 1));

        sectionHeader('WHO PAYS WHOM');

        if (settlements.length === 0) {
            doc.setFillColor(212, 237, 218); doc.rect(ML, y-1, CW, 10, 'F');
            bold(10, 21, 87, 36);
            doc.text('All good! Everyone paid their fair share. No transfers needed.', ML+3, y+6);
            y += 14;
        } else {
            settlements.forEach((s, i) => {
                checkPage(22);
                // Left accent stripe
                doc.setFillColor(255, 245, 235); doc.rect(ML, y-1, CW, 18, 'F');
                doc.setFillColor(220, 100, 60); doc.rect(ML, y-1, 2, 18, 'F');

                // Step number
                bold(7, 180, 80, 30);
                doc.text(`Step ${i+1} of ${settlements.length}`, ML+5, y+4);

                // Main sentence — plain English
                bold(11, 30, 30, 30);
                doc.text(`${s.from}`, ML+5, y+11);
                normal(10, 80, 80, 80);
                doc.text('pays', ML+5 + doc.getTextWidth(s.from) + 2, y+11);
                bold(11, 30, 30, 30);
                const paysX = ML+5 + doc.getTextWidth(s.from) + 2 + doc.getTextWidth('pays') + 2;
                doc.text(s.to, paysX, y+11);

                // Amount on the right
                bold(13, 30, 80, 200);
                doc.text(`Rs. ${s.amount}`, MR, y+11, { align:'right' });

                // Context line
                const fromPaid=Math.round(sp[s.from]||0), fromShare=Math.round(sh[s.from]||0);
                const toPaid=Math.round(sp[s.to]||0), toShare=Math.round(sh[s.to]||0);
                normal(7, 110, 110, 110);
                doc.text(
                    `${s.from} paid Rs.${fromPaid} but owed Rs.${fromShare}  •  ${s.to} paid Rs.${toPaid} but owed Rs.${toShare}`,
                    ML+5, y+16
                );

                y += 22;
            });
        }
        y += 4;

        // ── INDIVIDUAL SUMMARY TABLE ─────────────────────────
        sectionHeader('INDIVIDUAL SUMMARY');

        // Table header
        doc.setFillColor(220, 220, 235); doc.rect(ML, y-2, CW, 7, 'F');
        bold(8, 60, 60, 100);
        doc.text('Name', ML+3, y+3);
        doc.text('Total Paid', ML+70, y+3, { align:'right' });
        doc.text('Fair Share', ML+110, y+3, { align:'right' });
        doc.text('Status', MR, y+3, { align:'right' });
        y += 9;

        people.forEach((p, i) => {
            checkPage(9);
            const paid = Math.round(sp[p.name]), owes = Math.round(sh[p.name]), bal = paid - owes;
            const bg = i % 2 === 0 ? [250,250,255] : [255,255,255];
            doc.setFillColor(...bg); doc.rect(ML, y-2, CW, 8, 'F');

            // Color stripe on left
            if (bal > 0) doc.setFillColor(21,130,60);
            else if (bal < 0) doc.setFillColor(180,30,30);
            else doc.setFillColor(150,150,150);
            doc.rect(ML, y-2, 2, 8, 'F');

            bold(9, 0, 0, 0);
            doc.text(p.name, ML+5, y+3.5);

            normal(9, 40, 40, 40);
            doc.text(`Rs. ${paid}`, ML+70, y+3.5, { align:'right' });
            doc.text(`Rs. ${owes}`, ML+110, y+3.5, { align:'right' });

            if (bal > 0) { bold(8, 21,87,36); doc.text(`Gets back Rs. ${bal}`, MR, y+3.5, { align:'right' }); }
            else if (bal < 0) { bold(8, 150,20,20); doc.text(`Owes Rs. ${Math.abs(bal)}`, MR, y+3.5, { align:'right' }); }
            else { normal(8, 120,120,120); doc.text('Settled', MR, y+3.5, { align:'right' }); }

            // Who to pay / receive from (sub-row)
            const myPayments = settlements.filter(t => t.from === p.name);
            const myReceipts = settlements.filter(t => t.to   === p.name);
            if (myPayments.length || myReceipts.length) {
                checkPage(6);
                normal(7, 120, 120, 120);
                if (myPayments.length) {
                    const txt = myPayments.map(t => `Send Rs.${t.amount} to ${t.to}`).join('  |  ');
                    doc.text(txt, ML+5, y+10);
                    y += 5;
                }
                if (myReceipts.length) {
                    const txt = myReceipts.map(t => `Receive Rs.${t.amount} from ${t.from}`).join('  |  ');
                    doc.text(txt, ML+5, y+10);
                    y += 5;
                }
            }

            y += 8;
        });
    }

    // ── FOOTER ───────────────────────────────────────────────
    const pages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setFillColor(240, 240, 248); doc.rect(0, 285, PW, 12, 'F');
        normal(7, 140, 140, 140);
        doc.text(`Page ${i} of ${pages}`, PW/2, 291, { align:'center' });
        doc.text('Generated by TripWise', MR, 291, { align:'right' });
    }

    const fname = (document.getElementById('groupDisplayName').textContent || 'TripWise').replace(/\s+/g, '-');
    doc.save(`${fname}-Expense-Report.pdf`);
}


// ============================================================
//  BOOT
// ============================================================
window.addEventListener('load', loadData);
