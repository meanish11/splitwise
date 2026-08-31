// ============================================================
//  Splitwise — Main Script (Firebase Firestore + Real-time sync)
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

/** FAQ accordion toggle */
function toggleFaq(btn) {
    const answer = btn.nextElementSibling;
    const isOpen = answer.classList.contains('open');
    // Close all
    document.querySelectorAll('.faq-a.open').forEach(a => a.classList.remove('open'));
    document.querySelectorAll('.faq-q.open').forEach(q => { q.classList.remove('open'); q.setAttribute('aria-expanded', 'false'); });
    // Open clicked one if it was closed
    if (!isOpen) {
        answer.classList.add('open');
        btn.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
    }
}

/** Dark mode toggle */
function toggleDarkMode() {
    const html = document.documentElement;
    const isDark = html.getAttribute('data-theme') === 'dark';
    html.setAttribute('data-theme', isDark ? 'light' : 'dark');
    localStorage.setItem('tripwise-theme', isDark ? 'light' : 'dark');
    updateThemeIcon();
}

function updateThemeIcon() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const sunIcon = document.querySelector('.theme-icon-sun');
    const moonIcon = document.querySelector('.theme-icon-moon');
    if (sunIcon && moonIcon) {
        sunIcon.style.display = isDark ? 'none' : 'block';
        moonIcon.style.display = isDark ? 'block' : 'none';
    }
}

function initTheme() {
    const saved = localStorage.getItem('tripwise-theme');
    if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.setAttribute('data-theme', 'dark');
    }
    updateThemeIcon();
}

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
    // Clean up emoji prefixes from messages
    const cleanMsg = message.replace(/^[\s🚀🔑📋🎉⚠️❌✅💰👥⚖️💸➡️⬅️🔴🟢✨🧮📄⏰🤔📢📝🏕️✅🗑️]/u, '').trim();
    toast.textContent = cleanMsg || message;
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

/**
 * Check if a group has passed its 10-day expiry.
 * If expired, deletes the Firestore document and its sub-collections
 * and returns true. Otherwise returns false.
 */
async function checkAndDeleteExpiredGroup(code, data) {
    if (!data) return false;
    let expiry = null;

    // Prefer the explicit deleteAfter field; fall back to createdAt + 10 days
    if (data.deleteAfter) {
        expiry = data.deleteAfter.toDate ? data.deleteAfter.toDate() : new Date(data.deleteAfter);
    } else if (data.createdAt) {
        const created = data.createdAt.toDate ? data.createdAt.toDate() : new Date(data.createdAt);
        expiry = new Date(created.getTime() + 10 * 24 * 60 * 60 * 1000);
    }

    if (!expiry || Date.now() < expiry.getTime()) return false;

    // Group is expired — delete it
    try {
        await db.collection('groups').doc(code).delete();
        console.log(`[TripWise] Group ${code} auto-deleted after 10-day expiry.`);
    } catch (err) {
        console.warn('[TripWise] Could not auto-delete expired group:', err);
    }
    return true;
}

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

        // deleteAfter = 10 days from now (stored as a Firestore Timestamp for TTL/client checks)
        const deleteAfterDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);

        await groupsRef.doc(code).set({
            name:        tripName,
            code:        code,
            people:      [],
            expenses:    [],
            createdAt:   firebase.firestore.FieldValue.serverTimestamp(),
            deleteAfter: firebase.firestore.Timestamp.fromDate(deleteAfterDate)
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

        // Auto-delete if the group has passed its 10-day expiry
        const expired = await checkAndDeleteExpiredGroup(code, snap.data());
        if (expired) {
            const errEl = document.getElementById('joinError');
            errEl.style.display = 'block';
            errEl.textContent = `⏰ This trip has been automatically deleted after 10 days. Please export a PDF next time before the deadline.`;
            return;
        }

        openWorkspace(code);
    } catch (err) {
        setLoading(false);
        console.error('joinGroup error:', err);
        showToast(' Could not connect to database. Check your Firebase config.', 'error');
    }
}

/** Unified go to home handler (works from both landing tabs and active workspace) */
function goToHome() {
    if (document.getElementById('workspace-page') && document.getElementById('workspace-page').style.display === 'flex') {
        goBackToLanding();
    } else {
        showLandingTab('home');
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
        .onSnapshot(async snap => {
            if (!snap.exists) {
                showToast(' This group was deleted.', 'error');
                goBackToLanding();
                return;
            }
            const data = snap.data();

            // Auto-delete check: if the group has passed its 10-day expiry,
            // delete it from Firestore; the next snapshot will show !snap.exists
            // and redirect everyone back to the landing page.
            const expired = await checkAndDeleteExpiredGroup(code, data);
            if (expired) {
                showToast('⏰ This trip expired and has been automatically deleted after 10 days.', 'error');
                return; // goBackToLanding() will fire on the deletion snapshot
            }

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
    if (!code || code === '------') return;
    navigator.clipboard.writeText(code).then(() => showToast('Trip Code copied to clipboard!', 'success'));
}

/** Copy full invite message with link */
function copyInviteLink() {
    const code = currentGroupCode || document.getElementById('groupDisplayCode').textContent;
    const name = document.getElementById('groupDisplayName').textContent || 'our group';
    const link = window.location.origin + window.location.pathname + (code ? '?code=' + code : '');
    const text = `Join "${name}" on Splitwise! \nGroup Code: *${code}*\nLink: ${link}`;
    navigator.clipboard.writeText(text).then(() => showToast('Invite link & code copied!', 'success'));
}

/** Share via WhatsApp from Modal */
function shareTripWhatsAppFromModal() {
    const code = document.getElementById('modalCode').textContent;
    const name = document.getElementById('modalTripName').textContent || 'our group';
    const link = window.location.origin + window.location.pathname + (code ? '?code=' + code : '');
    const msg  = encodeURIComponent(`Join our group "${name}" on Splitwise!\nGroup Code: *${code}*\nOpen link: ${link}`);
    window.open(`https://api.whatsapp.com/send?text=${msg}`, '_blank');
}

/** Prefill description with quick category chip */
function setQuickCategory(categoryName) {
    const descInput = document.getElementById('expenseDescription');
    const amtInput  = document.getElementById('expenseAmount');
    if (descInput) descInput.value = categoryName;
    if (amtInput && !amtInput.value) amtInput.focus();
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

/** Generate a consistent color for a name (avatar backgrounds) */
function getAvatarColor(name) {
    const colors = ['#0D6B4F','#1D6FA5','#B45309','#7C3AED','#C2341A','#047857','#9333EA','#1A7D46','#6366F1','#B8860B'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
}

function displayPeople() {
    const container = document.getElementById('peopleContainer');
    const badge     = document.getElementById('peopleCountBadge');
    const mCount    = document.getElementById('mCountPeople');

    if (badge) badge.textContent = `${people.length} member${people.length !== 1 ? 's' : ''}`;
    if (mCount) mCount.textContent = people.length;

    if (people.length === 0) {
        container.innerHTML = `<div class="empty-state">
            <div class="empty-state-icon"><svg width="24" height="24"><use href="#icon-users"/></svg></div>
            <div class="empty-state-title">No members added yet</div>
            <div class="empty-state-desc">Add everyone in your trip group above.</div>
        </div>`;
        return;
    }

    // Calculate how much each person paid
    const spentMap = {};
    people.forEach(p => spentMap[p.name] = 0);
    expenses.forEach(ex => {
        if (spentMap[ex.name] !== undefined) spentMap[ex.name] += ex.amount;
    });

    container.innerHTML = `<div class="people-grid">${
        people.map(p => {
            const initial = p.name.charAt(0).toUpperCase();
            const color   = getAvatarColor(p.name);
            const spent   = spentMap[p.name] || 0;
            return `
            <div class="person-item">
                <div class="person-details">
                    <div class="person-avatar" style="background:${color}">${initial}</div>
                    <div class="person-info-block">
                        <span class="person-name">${p.name}</span>
                        <span class="person-spent-tag">${spent > 0 ? `Paid ₹${spent.toLocaleString('en-IN')}` : '₹0 spent'}</span>
                    </div>
                </div>
                <button class="btn-delete-person" onclick="removePerson('${p.name.replace(/'/g, "\\'")}')"
                        title="Remove ${p.name}" aria-label="Remove ${p.name}">&times;</button>
            </div>`;
        }).join('')
    }</div>`;
}

function displayExpenses() {
    const container = document.getElementById('expensesContainer');
    const badge     = document.getElementById('expensesCountBadge');
    const mCount    = document.getElementById('mCountExpenses');

    if (badge) badge.textContent = `${expenses.length} logged`;
    if (mCount) mCount.textContent = expenses.length;

    if (expenses.length === 0) {
        container.innerHTML = `<div class="empty-state">
            <div class="empty-state-icon"><svg width="24" height="24"><use href="#icon-receipt"/></svg></div>
            <div class="empty-state-title">No expenses logged</div>
            <div class="empty-state-desc">Add a shared bill or cost using the form above.</div>
        </div>`;
        return;
    }

    container.innerHTML = expenses.map(ex => {
        let info = ex.splittingMode === 'custom' && ex.customAmounts
            ? 'Custom: ' + Object.entries(ex.customAmounts).map(([p,a]) => `${p}: ₹${a}`).join(', ')
            : (ex.sharedWith && ex.sharedWith.length === people.length ? 'Split equally with all' : (ex.sharedWith ? 'Split: ' + ex.sharedWith.join(', ') : ''));
        const initial = ex.name.charAt(0).toUpperCase();
        const color = getAvatarColor(ex.name);
        return `
            <div class="expense-item">
                <div class="expense-details">
                    <div class="expense-top-row">
                        <span class="person-avatar" style="background:${color};width:24px;height:24px;font-size:0.65rem;flex-shrink:0">${initial}</span>
                        <span class="expense-desc-title">${ex.description || 'Expense'}</span>
                        <span class="expense-amount-badge" style="margin-left:auto;">₹${ex.amount.toLocaleString('en-IN')}</span>
                    </div>
                    <div class="expense-meta-info">
                        <span class="expense-payer-tag">${ex.name} paid</span>
                        <span>·</span>
                        <span>${info}</span>
                    </div>
                </div>
                <button class="btn-delete-expense" onclick="removeExpense(${ex.id})" title="Delete" aria-label="Delete expense">&times;</button>
            </div>`;
    }).join('');
}

function updatePersonDropdown() {
    const sel = document.getElementById('personSelect');
    if (!sel) return;
    const currentVal = sel.value;
    sel.innerHTML = '<option value="">Select payer...</option>';
    people.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name; opt.textContent = p.name;
        sel.appendChild(opt);
    });
    if (currentVal && people.some(p => p.name === currentVal)) {
        sel.value = currentVal;
    }
}

function updateSharedWithCheckboxes() {
    const container = document.getElementById('sharedWithCheckboxes');
    if (!container) return;
    container.innerHTML = '';
    people.forEach(p => {
        const initial = p.name.charAt(0).toUpperCase();
        const color   = getAvatarColor(p.name);
        const label   = document.createElement('label');
        label.className = 'member-chip-label';
        label.innerHTML = `
            <input type="checkbox" class="person-checkbox" value="${p.name}" checked onchange="updateSelectedCount()">
            <span class="member-chip-avatar" style="background:${color}">${initial}</span>
            <span class="member-chip-name">${p.name}</span>
            <span class="member-chip-check">✓</span>
        `;
        container.appendChild(label);
    });
    updateSelectedCount();
}

function updateTotalExpenses() {
    const total   = expenses.reduce((s, ex) => s + (ex.amount || 0), 0);
    const div     = document.getElementById('totalExpenses');
    const ticker  = document.getElementById('topbarTotalAmount');
    const meta    = document.getElementById('totalCardMeta');

    const formatted = '₹' + total.toLocaleString('en-IN');
    if (ticker) ticker.textContent = formatted;

    if (total > 0) {
        if (div) {
            div.style.display = 'block';
            div.querySelector('.total-amount-display').textContent = formatted;
            if (meta && people.length > 0) {
                const perPerson = Math.round(total / people.length);
                meta.textContent = `₹${perPerson.toLocaleString('en-IN')} per person across ${people.length} member${people.length !== 1 ? 's' : ''}`;
            }
        }
    } else {
        if (div) div.style.display = 'none';
    }
}


// ============================================================
//  SETTLEMENT CALCULATION & SHARING
// ============================================================

let lastSettlementData = null;

function calculateSettlements() {
    if (people.length === 0) {
        document.getElementById('settlementResults').innerHTML = '<div class="no-data">Please add trip members first</div>';
        return;
    }
    if (expenses.length === 0) {
        document.getElementById('settlementResults').innerHTML = '<div class="no-data">Please add some expenses first</div>';
        return;
    }

    const spent  = {}, shouldPay = {};
    people.forEach(p => { spent[p.name] = 0; shouldPay[p.name] = 0; });

    expenses.forEach(ex => {
        spent[ex.name] = (spent[ex.name] || 0) + ex.amount;
        if (ex.splittingMode === 'custom' && ex.customAmounts) {
            Object.entries(ex.customAmounts).forEach(([name, amt]) => {
                shouldPay[name] = (shouldPay[name] || 0) + amt;
            });
        } else {
            const count = ex.sharedWith && ex.sharedWith.length ? ex.sharedWith.length : 1;
            const share = ex.amount / count;
            (ex.sharedWith || []).forEach(name => {
                shouldPay[name] = (shouldPay[name] || 0) + share;
            });
        }
    });

    const balances = {};
    people.forEach(p => { balances[p.name] = Math.round((spent[p.name] || 0) - (shouldPay[p.name] || 0)); });

    const settlements = generateOptimalSettlements(balances);
    const totalAmt    = expenses.reduce((s, ex) => s + (ex.amount || 0), 0);

    lastSettlementData = { settlements, spent, shouldPay, totalAmt };
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
        <div class="settle-summary">
            <span>Total: <strong>₹${totalAmt2.toLocaleString('en-IN')}</strong></span>
            <span>${people.length} members</span>
            <span>Avg: <strong>₹${perPerson.toLocaleString('en-IN')}</strong>/ea</span>
        </div>`;

    // ── Who pays whom ─────────────────────────────────────────
    if (settlements.length === 0) {
        html += `
            <div class="settle-all-clear">
                <div class="settle-title">🎉 Everyone is settled up!</div>
                <div class="settle-sub">All ${people.length} members paid their exact fair share.</div>
            </div>`;
    } else {
        html += `<div class="settle-badge transfers">
                    ${settlements.length} Direct Transfer${settlements.length > 1 ? 's' : ''} to Settle
                 </div>`;

        settlements.forEach((s, i) => {
            const fromPaid  = Math.round(spent[s.from]    || 0);
            const fromShare = Math.round(shouldPay[s.from] || 0);
            const toPaid    = Math.round(spent[s.to]      || 0);
            const toShare   = Math.round(shouldPay[s.to]  || 0);
            const owes      = fromShare - fromPaid > 0 ? fromShare - fromPaid : 0;
            const recovers  = toPaid - toShare > 0 ? toPaid - toShare : 0;

            html += `
                <div class="settle-transfer">
                    <div class="settle-transfer-label">Payment ${i + 1} of ${settlements.length}</div>
                    <div class="settle-transfer-row">
                        <span class="settle-from">${s.from}</span>
                        <span class="settle-arrow">→ pays →</span>
                        <span class="settle-to">${s.to}</span>
                        <span class="settle-transfer-amount">₹${s.amount.toLocaleString('en-IN')}</span>
                    </div>
                    <div class="settle-transfer-detail">
                        <div class="settle-detail-box debtor">
                            <div class="settle-detail-name">${s.from}</div>
                            Paid: ₹${fromPaid.toLocaleString('en-IN')} · Share: ₹${fromShare.toLocaleString('en-IN')}<br>
                            <strong style="color:var(--danger)">Net Owed: ₹${owes.toLocaleString('en-IN')}</strong>
                        </div>
                        <div class="settle-detail-box creditor">
                            <div class="settle-detail-name">${s.to}</div>
                            Paid: ₹${toPaid.toLocaleString('en-IN')} · Share: ₹${toShare.toLocaleString('en-IN')}<br>
                            <strong style="color:var(--success)">Net Back: ₹${recovers.toLocaleString('en-IN')}</strong>
                        </div>
                    </div>
                </div>`;
        });
    }

    // ── Individual breakdown ──────────────────────────────────
    html += `<div class="settle-badge breakdown">Member Summary</div>`;

    people.forEach(p => {
        const s   = Math.round(spent[p.name] || 0);
        const sh  = Math.round(shouldPay[p.name] || 0);
        const bal = s - sh;
        const isCreditor = bal > 0, isDebtor = bal < 0;

        const receives = settlements.filter(t => t.to   === p.name).map(t => `<strong>${t.from}</strong> pays ₹${t.amount.toLocaleString('en-IN')}`);
        const pays     = settlements.filter(t => t.from === p.name).map(t => `pays <strong>${t.to}</strong> ₹${t.amount.toLocaleString('en-IN')}`);

        const badgeClass = isCreditor ? 'positive' : isDebtor ? 'negative' : 'neutral';
        const badgeText = isCreditor ? `+₹${bal.toLocaleString('en-IN')}` : isDebtor ? `-₹${Math.abs(bal).toLocaleString('en-IN')}` : 'Settled';
        const balColor = isCreditor ? 'var(--success)' : isDebtor ? 'var(--danger)' : 'var(--accent)';

        html += `
            <div class="settle-person">
                <div class="settle-person-header">
                    <div class="settle-person-name">${p.name}</div>
                    <span class="settle-person-badge ${badgeClass}">${badgeText}</span>
                </div>
                <div class="settle-person-stats">
                    <div class="settle-stat-cell">
                        <div class="settle-stat-cell-label">Paid</div>
                        <div class="settle-stat-cell-value">₹${s.toLocaleString('en-IN')}</div>
                    </div>
                    <div class="settle-stat-cell">
                        <div class="settle-stat-cell-label">Share</div>
                        <div class="settle-stat-cell-value">₹${sh.toLocaleString('en-IN')}</div>
                    </div>
                    <div class="settle-stat-cell">
                        <div class="settle-stat-cell-label">Balance</div>
                        <div class="settle-stat-cell-value" style="color:${balColor}">
                            ${bal > 0 ? '+' : ''}₹${bal.toLocaleString('en-IN')}
                        </div>
                    </div>
                </div>
                ${pays.length ? `<div class="settle-person-flow sends">
                    ${p.name} ${pays.join(' & ')}
                </div>` : ''}
                ${receives.length ? `<div class="settle-person-flow receives">
                    ${p.name} gets from ${receives.join(' & ')}
                </div>` : ''}
            </div>`;
    });

    container.innerHTML = html;

    const expBtn = document.getElementById('exportBtn');
    if (expBtn) expBtn.style.display = 'block';

    const quickShares = document.getElementById('settleQuickShares');
    if (quickShares) quickShares.style.display = 'grid';
}

/** Share settlement breakdown directly on WhatsApp */
function shareSettlementWhatsApp() {
    if (!lastSettlementData) {
        calculateSettlements();
        if (!lastSettlementData) return;
    }
    const { settlements, totalAmt } = lastSettlementData;
    const tripName = document.getElementById('groupDisplayName').textContent || 'Splitwise Group';

    let text = `🌴 *${tripName} — Expense Settlement Summary*\n`;
    text += `💰 *Total Spent:* ₹${totalAmt.toLocaleString('en-IN')}\n\n`;

    if (settlements.length === 0) {
        text += `✨ Everyone is fully settled up! No payments needed.\n`;
    } else {
        text += `💸 *Who Pays Whom:*\n`;
        settlements.forEach((s, idx) => {
            text += `${idx + 1}. *${s.from}* 👉 pays *${s.to}* : ₹${s.amount.toLocaleString('en-IN')}\n`;
        });
    }

    text += `\nShared via Splitwise`;
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
}

/** Copy settlement breakdown text to clipboard */
function copySettlementSummary() {
    if (!lastSettlementData) {
        calculateSettlements();
        if (!lastSettlementData) return;
    }
    const { settlements, totalAmt } = lastSettlementData;
    const tripName = document.getElementById('groupDisplayName').textContent || 'Splitwise Group';

    let text = `🌴 ${tripName} — Expense Settlement Summary\n`;
    text += `Total Spent: ₹${totalAmt.toLocaleString('en-IN')}\n\n`;

    if (settlements.length === 0) {
        text += `Everyone is fully settled up! No payments needed.\n`;
    } else {
        text += `Who Pays Whom:\n`;
        settlements.forEach((s, idx) => {
            text += `${idx + 1}. ${s.from} pays ${s.to} : ₹${s.amount.toLocaleString('en-IN')}\n`;
        });
    }

    navigator.clipboard.writeText(text).then(() => showToast('Settlement text copied to clipboard!', 'success'));
}


// ============================================================
//  PDF EXPORT
// ============================================================

function exportToPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const PW = 210, ML = 14, MR = 196, CW = MR - ML;

    // ── Typography & color helpers ───────────────────────────
    const bold   = (sz, r=17,g=24,b=39) => { doc.setFont(undefined,'bold');   doc.setFontSize(sz); doc.setTextColor(r,g,b); };
    const normal = (sz, r=55,g=65,b=81) => { doc.setFont(undefined,'normal'); doc.setFontSize(sz); doc.setTextColor(r,g,b); };
    const checkPage = (need=14) => { if (y + need > 275) { doc.addPage(); y = 18; } };

    // Section header banner (clean light gray with emerald accent)
    const sectionHeader = (title) => {
        checkPage(16);
        doc.setFillColor(243, 244, 246); // #F3F4F6
        doc.rect(ML, y - 1, CW, 8, 'F');
        doc.setFillColor(13, 107, 79);   // #0D6B4F Emerald accent
        doc.rect(ML, y - 1, 3, 8, 'F');
        bold(9, 17, 24, 39);
        doc.text(title, ML + 6, y + 4.8);
        y += 12;
        normal(8.5, 55, 65, 81);
    };

    // ── HEADER BANNER (EMERALD) ──────────────────────────────
    doc.setFillColor(13, 107, 79); // #0D6B4F
    doc.rect(0, 0, PW, 24, 'F');

    // Title
    bold(15, 255, 255, 255);
    const tripName = currentGroupCode
        ? document.getElementById('groupDisplayName').textContent
        : 'Splitwise Group';
    doc.text(tripName + ' — Expense Report', PW / 2, 11, { align: 'center' });

    // Subtitle
    normal(8, 206, 234, 214);
    const today = new Date().toLocaleDateString('en-IN', { year:'numeric', month:'long', day:'numeric' });
    doc.text(`${today}   •   Group Code: ${currentGroupCode || '—'}   •   Splitwise`, PW / 2, 18, { align: 'center' });

    let y = 30;

    // ── SUMMARY METRICS CARD ─────────────────────────────────
    if (expenses.length > 0) {
        const tot = expenses.reduce((s, ex) => s + (ex.amount || 0), 0);
        const perHead = Math.round(tot / Math.max(people.length, 1));

        doc.setFillColor(230, 244, 234); // #E6F4EA
        doc.rect(ML, y, CW, 12, 'F');
        doc.setDrawColor(167, 243, 208); // #A7F3D0
        doc.rect(ML, y, CW, 12, 'S');

        bold(10, 13, 107, 79);
        doc.text(`Total Spend: Rs. ${tot.toLocaleString('en-IN')}`, ML + 5, y + 7.5);

        normal(8.5, 55, 65, 81);
        doc.text(`${people.length} Members   •   Rs. ${perHead.toLocaleString('en-IN')} / person`, MR - 5, y + 7.5, { align: 'right' });
        y += 18;
    }

    // ── MEMBERS LIST ─────────────────────────────────────────
    sectionHeader('GROUP MEMBERS');
    if (people.length === 0) {
        normal(8.5, 107, 114, 128);
        doc.text('No members added yet.', ML + 3, y);
        y += 8;
    } else {
        const names = people.map(p => p.name).join('   •   ');
        normal(8.5, 31, 41, 55);
        const lines = doc.splitTextToSize(names, CW - 6);
        doc.text(lines, ML + 3, y);
        y += lines.length * 5 + 6;
    }

    // ── EXPENSES LOG TABLE ───────────────────────────────────
    sectionHeader('EXPENSE LOG');
    if (expenses.length === 0) {
        normal(8.5, 107, 114, 128);
        doc.text('No expenses logged yet.', ML + 3, y);
        y += 8;
    } else {
        // Table Header
        doc.setFillColor(243, 244, 246);
        doc.rect(ML, y - 2, CW, 7, 'F');
        bold(7.5, 107, 114, 128);
        doc.text('#', ML + 3, y + 3);
        doc.text('PAID BY', ML + 12, y + 3);
        doc.text('DESCRIPTION', ML + 48, y + 3);
        doc.text('SPLIT AMONG', ML + 110, y + 3);
        doc.text('AMOUNT', MR - 2, y + 3, { align: 'right' });
        y += 9;

        expenses.forEach((ex, i) => {
            checkPage(11);
            const bg = i % 2 === 0 ? [255, 255, 255] : [249, 250, 251];
            doc.setFillColor(...bg);
            doc.rect(ML, y - 2, CW, 8, 'F');

            normal(7.5, 156, 163, 175);
            doc.text(`${i + 1}`, ML + 3, y + 3.2);

            bold(8, 17, 24, 39);
            doc.text(ex.name, ML + 12, y + 3.2);

            normal(8, 75, 85, 99);
            const desc = doc.splitTextToSize(ex.description || 'General expense', 58);
            doc.text(desc[0], ML + 48, y + 3.2);

            const splitInfo = ex.splittingMode === 'custom' && ex.customAmounts
                ? 'Custom split'
                : (ex.sharedWith && ex.sharedWith.length === people.length ? 'All members' : (ex.sharedWith ? ex.sharedWith.join(', ') : ''));
            const splitLines = doc.splitTextToSize(splitInfo, 50);
            doc.text(splitLines[0], ML + 110, y + 3.2);

            bold(8.5, 13, 107, 79);
            doc.text(`Rs. ${ex.amount.toLocaleString('en-IN')}`, MR - 2, y + 3.2, { align: 'right' });
            y += 8.5;

            // Detail line if custom amounts
            if (ex.splittingMode === 'custom' && ex.customAmounts) {
                checkPage(6);
                normal(7, 107, 114, 128);
                const detail = Object.entries(ex.customAmounts).map(([n,a]) => `${n}: Rs.${a.toLocaleString('en-IN')}`).join('  |  ');
                const dLines = doc.splitTextToSize(detail, CW - 16);
                doc.text(dLines[0], ML + 16, y);
                y += 5;
            }
        });
        y += 5;
    }

    // ── SETTLEMENT: WHO PAYS WHOM ─────────────────────────────
    if (expenses.length > 0 && people.length > 0) {
        const sp = {}, sh = {};
        people.forEach(p => { sp[p.name] = 0; sh[p.name] = 0; });
        expenses.forEach(ex => {
            sp[ex.name] = (sp[ex.name] || 0) + ex.amount;
            if (ex.splittingMode === 'custom' && ex.customAmounts)
                Object.entries(ex.customAmounts).forEach(([n,a]) => { sh[n] = (sh[n] || 0) + a; });
            else {
                const count = ex.sharedWith && ex.sharedWith.length ? ex.sharedWith.length : 1;
                const s = ex.amount / count;
                (ex.sharedWith || []).forEach(n => { sh[n] = (sh[n] || 0) + s; });
            }
        });

        const balances = {};
        people.forEach(p => { balances[p.name] = Math.round((sp[p.name] || 0) - (sh[p.name] || 0)); });
        const settlements = generateOptimalSettlements(balances);

        sectionHeader('SETTLEMENT — WHO PAYS WHOM');

        if (settlements.length === 0) {
            doc.setFillColor(230, 244, 234);
            doc.rect(ML, y - 1, CW, 10, 'F');
            doc.setDrawColor(167, 243, 208);
            doc.rect(ML, y - 1, CW, 10, 'S');
            bold(9, 5, 150, 105);
            doc.text('All settled! Everyone paid their exact fair share. No transfers required.', ML + 4, y + 5.5);
            y += 15;
        } else {
            settlements.forEach((s, i) => {
                checkPage(22);

                // Transfer card background & borders
                doc.setFillColor(255, 255, 255);
                doc.rect(ML, y - 1, CW, 19, 'F');
                doc.setDrawColor(229, 231, 235);
                doc.rect(ML, y - 1, CW, 19, 'S');

                // Left emerald indicator
                doc.setFillColor(13, 107, 79);
                doc.rect(ML, y - 1, 2.5, 19, 'F');

                // Step tag
                bold(7, 13, 107, 79);
                doc.text(`PAYMENT ${i + 1} OF ${settlements.length}`, ML + 6, y + 4.5);

                // Main Transfer statement
                bold(10.5, 220, 38, 38); // Debtor Red
                doc.text(s.from, ML + 6, y + 11.5);

                normal(9.5, 107, 114, 128);
                const fromW = doc.getTextWidth(s.from);
                doc.text('  pays  ', ML + 6 + fromW, y + 11.5);

                const paysW = doc.getTextWidth('  pays  ');
                bold(10.5, 5, 150, 105); // Creditor Green
                doc.text(s.to, ML + 6 + fromW + paysW, y + 11.5);

                // Transfer Amount on Right
                bold(12, 13, 107, 79);
                doc.text(`Rs. ${s.amount.toLocaleString('en-IN')}`, MR - 5, y + 11.5, { align: 'right' });

                // Sub-context line
                const fromPaid  = Math.round(sp[s.from] || 0), fromShare = Math.round(sh[s.from] || 0);
                const toPaid    = Math.round(sp[s.to] || 0),   toShare   = Math.round(sh[s.to] || 0);
                normal(7, 107, 114, 128);
                doc.text(
                    `${s.from} (Paid: Rs.${fromPaid.toLocaleString('en-IN')} · Share: Rs.${fromShare.toLocaleString('en-IN')})  →  ${s.to} (Paid: Rs.${toPaid.toLocaleString('en-IN')} · Share: Rs.${toShare.toLocaleString('en-IN')})`,
                    ML + 6, y + 16.5
                );

                y += 23;
            });
        }
        y += 4;

        // ── INDIVIDUAL SUMMARY TABLE ─────────────────────────
        sectionHeader('MEMBER BREAKDOWN');

        doc.setFillColor(243, 244, 246);
        doc.rect(ML, y - 2, CW, 7, 'F');
        bold(7.5, 107, 114, 128);
        doc.text('MEMBER', ML + 5, y + 3);
        doc.text('TOTAL PAID', ML + 75, y + 3, { align: 'right' });
        doc.text('FAIR SHARE', ML + 118, y + 3, { align: 'right' });
        doc.text('FINAL BALANCE', MR - 3, y + 3, { align: 'right' });
        y += 9;

        people.forEach((p, i) => {
            checkPage(10);
            const paid = Math.round(sp[p.name] || 0);
            const owes = Math.round(sh[p.name] || 0);
            const bal  = paid - owes;

            const bg = i % 2 === 0 ? [255, 255, 255] : [249, 250, 251];
            doc.setFillColor(...bg);
            doc.rect(ML, y - 2, CW, 8, 'F');

            // Left status stripe
            if (bal > 0) doc.setFillColor(5, 150, 105);
            else if (bal < 0) doc.setFillColor(220, 38, 38);
            else doc.setFillColor(156, 163, 175);
            doc.rect(ML, y - 2, 2, 8, 'F');

            bold(8.5, 17, 24, 39);
            doc.text(p.name, ML + 5, y + 3.2);

            normal(8.5, 55, 65, 81);
            doc.text(`Rs. ${paid.toLocaleString('en-IN')}`, ML + 75, y + 3.2, { align: 'right' });
            doc.text(`Rs. ${owes.toLocaleString('en-IN')}`, ML + 118, y + 3.2, { align: 'right' });

            if (bal > 0) {
                bold(8, 5, 150, 105);
                doc.text(`Gets back Rs. ${bal.toLocaleString('en-IN')}`, MR - 3, y + 3.2, { align: 'right' });
            } else if (bal < 0) {
                bold(8, 220, 38, 38);
                doc.text(`Owes Rs. ${Math.abs(bal).toLocaleString('en-IN')}`, MR - 3, y + 3.2, { align: 'right' });
            } else {
                normal(8, 107, 114, 128);
                doc.text('Settled', MR - 3, y + 3.2, { align: 'right' });
            }

            y += 8.5;
        });
    }

    // ── FOOTER ───────────────────────────────────────────────
    const pages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setFillColor(248, 249, 250);
        doc.rect(0, 286, PW, 11, 'F');
        doc.setDrawColor(229, 231, 235);
        doc.line(0, 286, PW, 286);

        normal(7.5, 107, 114, 128);
        doc.text(`Page ${i} of ${pages}`, PW / 2, 292, { align: 'center' });
        doc.text('Generated by Splitwise', MR, 292, { align: 'right' });
        doc.text('Instant Group Expense Splitter', ML, 292, { align: 'left' });
    }

    const fname = (document.getElementById('groupDisplayName').textContent || 'Splitwise').replace(/\s+/g, '-');
    doc.save(`${fname}-Expense-Report.pdf`);
}


// ============================================================
//  BOOT
// ============================================================
window.addEventListener('load', function() {
    initTheme();
    loadData();

    // Check for ?code=XYZ or #join=XYZ in URL for one-click invite join
    const params = new URLSearchParams(window.location.search);
    let codeFromUrl = params.get('code') || params.get('join');
    if (!codeFromUrl && window.location.hash) {
        const match = window.location.hash.match(/(?:join=|code=)([A-Za-z0-9]{6})/);
        if (match) codeFromUrl = match[1];
    }
    if (codeFromUrl) {
        const joinCodeInput = document.getElementById('joinCode');
        if (joinCodeInput) {
            joinCodeInput.value = codeFromUrl.toUpperCase();
            showLandingTab('join');
            // Auto join if 6 characters
            if (codeFromUrl.length === 6) {
                joinGroup(codeFromUrl.toUpperCase());
            }
        }
    }
});
