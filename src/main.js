import './style.css';
import Chart from 'chart.js/auto';
import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  doc, 
  setDoc, 
  deleteDoc, 
  onSnapshot 
} from 'firebase/firestore';

// User's Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyBm2_YJMOXrhfui1RyLeyRUE9FPDZmf0-Q",
  authDomain: "anuradha-perera.firebaseapp.com",
  projectId: "anuradha-perera",
  storageBucket: "anuradha-perera.firebasestorage.app",
  messagingSenderId: "371845520441",
  appId: "1:371845520441:web:0f943379d0ae4eca3a41e8",
  measurementId: "G-Y1S804KPKD"
};

// Initialize Firebase & Firestore
let firebaseApp = null;
let db = null;
try {
  firebaseApp = initializeApp(firebaseConfig);
  db = getFirestore(firebaseApp);
} catch (e) {
  console.warn('Firebase init warning:', e);
}

// Credentials specified by user
const VALID_CREDENTIALS = {
  phone: '0762266917',
  studentId: '2731461',
  name: 'Nikila Yoshitha'
};

// Default initial paper marks
const DEFAULT_PAPERS = [
  {
    code: '2027 S1 MAIN PAPER 02',
    essay: 4.15,
    mcq: 12.0,
    total: 16.15,
    color: '#e11d48',
    grade: 'W'
  },
  {
    code: '2027 S1 MAIN PAPER 03',
    essay: 30.0,
    mcq: 35.0,
    total: 65.0,
    color: '#10b981',
    grade: 'C'
  }
];

// Grade classification
function getGradeDetails(total) {
  if (total < 35) {
    return { color: '#e11d48', grade: 'W', label: 'Weak (Repeat)', pillClass: 'grade-pill-red' };
  } else if (total < 55) {
    return { color: '#f59e0b', grade: 'S', label: 'Simple Pass (S)', pillClass: 'grade-pill-orange' };
  } else if (total < 75) {
    return { color: '#10b981', grade: 'C', label: 'Credit Pass (C/B)', pillClass: 'grade-pill-green' };
  } else {
    return { color: '#0284c7', grade: 'A', label: 'Distinction (A)', pillClass: 'grade-pill-blue' };
  }
}

// LocalStorage helpers
function loadLocalPapers() {
  try {
    const raw = localStorage.getItem('ap_papers_records');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {
    console.error('Local storage read error', e);
  }
  return DEFAULT_PAPERS;
}

function saveLocalPapers(papers) {
  try {
    localStorage.setItem('ap_papers_records', JSON.stringify(papers));
  } catch (e) {
    console.error('Local storage write error', e);
  }
}

// Auth State Helper
function getAuthSession() {
  try {
    const raw = localStorage.getItem('ap_papers_auth');
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return null;
}

function setAuthSession(session) {
  if (session) {
    localStorage.setItem('ap_papers_auth', JSON.stringify(session));
  } else {
    localStorage.removeItem('ap_papers_auth');
  }
}

// Global App State
const state = {
  studentName: VALID_CREDENTIALS.name,
  studentId: VALID_CREDENTIALS.studentId,
  institute: 'Rotary',
  batch: '2027 A/L Theory',
  workTimes: {
    labels: ['04-19', '04-21', '04-28', '04-30', '05-11', '05-17', '06-16'],
    data: [14, 2.2, 14, 14, 14, 14, 14]
  },
  papers: loadLocalPapers(),
  simulationHour: null,
  firestoreStatus: 'connecting', // 'connected' | 'permission-denied' | 'error'
  firestoreErrorMsg: ''
};

// Toast Notification
function showToast(msg) {
  let toast = document.getElementById('global-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'global-toast';
    toast.className = 'toast-notice';
    document.body.appendChild(toast);
  }
  toast.innerHTML = `<span>🔔</span> <span>${msg}</span>`;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3200);
}

// Setup Real-time Firestore Sync
function setupFirestoreSync() {
  if (!db) {
    state.firestoreStatus = 'error';
    return;
  }

  try {
    const papersCol = collection(db, 'papers');
    onSnapshot(papersCol, (snapshot) => {
      state.firestoreStatus = 'connected';
      state.firestoreErrorMsg = '';

      if (!snapshot.empty) {
        const remotePapers = [];
        snapshot.forEach(docSnap => {
          remotePapers.push({
            id: docSnap.id,
            ...docSnap.data()
          });
        });
        
        // Sort papers
        remotePapers.sort((a, b) => a.code.localeCompare(b.code));
        state.papers = remotePapers;
        saveLocalPapers(remotePapers);
        
        // Re-render if in active views
        const route = getCurrentRoute();
        if (route === 'dashboard') {
          updateDashboardPapersView();
        } else if (route === 'admin') {
          updateAdminTableView();
        }
      } else {
        // If empty on remote, push our initial papers
        DEFAULT_PAPERS.forEach(async (p) => {
          try {
            await setDoc(doc(db, 'papers', p.code.replace(/\s+/g, '_')), p);
          } catch (err) {}
        });
      }
    }, (error) => {
      console.warn('Firestore sync status:', error.code, error.message);
      if (error.code === 'permission-denied') {
        state.firestoreStatus = 'permission-denied';
        state.firestoreErrorMsg = 'Firestore Security Rules allow read, write: if false; ලෙස ඇති නිසා අවහිර වී ඇත.';
      } else {
        state.firestoreStatus = 'error';
        state.firestoreErrorMsg = error.message;
      }
      
      const route = getCurrentRoute();
      if (route === 'admin') {
        updateAdminTableView();
      }
    });
  } catch (e) {
    console.error('Firestore subscription error:', e);
    state.firestoreStatus = 'error';
  }
}

setupFirestoreSync();

// Save Paper to Firebase & Local
async function savePaperRecord(paperObj) {
  // Always update local state first
  const existingIdx = state.papers.findIndex(p => p.code.toLowerCase() === paperObj.code.toLowerCase());
  if (existingIdx >= 0) {
    state.papers[existingIdx] = paperObj;
  } else {
    state.papers.push(paperObj);
  }
  saveLocalPapers(state.papers);

  // Sync to Firebase
  if (db) {
    try {
      const docId = paperObj.code.replace(/\s+/g, '_');
      await setDoc(doc(db, 'papers', docId), paperObj);
      showToast(`✅ "${paperObj.code}" Firebase Cloud Database එකට save විය!`);
    } catch (e) {
      console.warn('Firebase save failed (check security rules):', e);
      showToast(`💾 "${paperObj.code}" Local එකේ save විය. (Firebase Rules Update කරන්න)`);
    }
  } else {
    showToast(`💾 "${paperObj.code}" Local storage එකේ save විය.`);
  }
}

// Delete Paper from Firebase & Local
async function deletePaperRecord(paperCode) {
  const docId = paperCode.replace(/\s+/g, '_');
  state.papers = state.papers.filter(p => p.code !== paperCode);
  saveLocalPapers(state.papers);

  if (db) {
    try {
      await deleteDoc(doc(db, 'papers', docId));
      showToast(`🗑️ "${paperCode}" Firebase Database එකෙන් delete විය!`);
    } catch (e) {
      console.warn('Firebase delete failed:', e);
      showToast(`🗑️ "${paperCode}" Local එකෙන් delete විය.`);
    }
  } else {
    showToast(`🗑️ "${paperCode}" delete විය.`);
  }
}

// Router
function getCurrentRoute() {
  const path = window.location.pathname.toLowerCase();
  const hash = window.location.hash.toLowerCase();
  if (path === '/admin' || path.startsWith('/admin') || hash === '#admin') {
    return 'admin';
  }
  return 'dashboard';
}

function navigateTo(url) {
  window.history.pushState(null, '', url);
  renderApp();
}

// Dynamic Real-time Greeting
function getGreetingData(date = new Date()) {
  const hours = state.simulationHour !== null ? state.simulationHour : date.getHours();
  if (hours >= 5 && hours < 12) {
    return {
      text: `Good Morning ${state.studentName} !`,
      emoji: '🌅',
      period: 'Morning'
    };
  } else if (hours >= 12 && hours < 17) {
    return {
      text: `Good Afternoon ${state.studentName} !`,
      emoji: '☀️',
      period: 'Afternoon'
    };
  } else if (hours >= 17 && hours < 21) {
    return {
      text: `Good Evening ${state.studentName} !`,
      emoji: '🌇',
      period: 'Evening'
    };
  } else {
    return {
      text: `Good Night ${state.studentName} !`,
      emoji: '🌙',
      period: 'Night'
    };
  }
}

function updateGreeting() {
  const greetingData = getGreetingData();
  const emojiEl = document.getElementById('greeting-emoji');
  const textEl = document.getElementById('greeting-text');
  if (emojiEl) emojiEl.textContent = greetingData.emoji;
  if (textEl) textEl.textContent = greetingData.text;
}

// VIEW 1: LOGIN PAGE (Matching User's Reference Screenshot)
function renderLoginPage() {
  const app = document.querySelector('#app');
  app.innerHTML = `
    <div class="login-page-wrapper">
      <div class="login-card-container">
        <!-- Left Banner with Sir's Photo (Large, Clean, No Text Overlay) -->
        <div class="login-left-banner">
          <img src="/anuradha.jpg" alt="Anuradha Perera Sir" class="login-sir-image" />
        </div>

        <!-- Right Login Form -->
        <div class="login-right-content">
          <!-- Award Badge -->
          <div class="login-award-badge" title="Most Popular Education Portal 2024">
            <span>🏆</span>
            WINNER
          </div>

          <!-- Brand Logo Header with logo.png -->
          <div class="login-brand-header">
            <img src="/logo.png" alt="AP Papers Logo" class="login-brand-logo-img" />
            <span>AP Papers</span>
          </div>

          <h2 class="login-welcome-title">Welcome to AP Papers!</h2>
          <p class="login-welcome-subtitle">Please sign-in to your account and start the adventure</p>

          <!-- Error Message Alert Box (Clean, Generic, No Credential Leaks) -->
          <div class="login-error-alert" id="login-error-alert">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <span id="login-error-text">දුරකථන අංකය හෝ මුරපදය වැරදියි!</span>
          </div>

          <form id="student-login-form">
            <div class="admin-form-group">
              <label class="admin-form-label">Mobile</label>
              <input type="text" id="login-phone" class="admin-form-input" placeholder="0777123456" required autocomplete="tel" />
            </div>

            <div class="admin-form-group">
              <label class="admin-form-label">Student ID / Password</label>
              <input type="password" id="login-password" class="admin-form-input" placeholder="••••••••" required autocomplete="current-password" />
            </div>

            <button type="submit" class="btn-login-submit" id="btn-login">
              Login
            </button>

            <button type="button" class="btn-login-register" id="btn-register-guide">
              Register / Student Help
            </button>
          </form>
        </div>
      </div>
    </div>
  `;

  // Login Form Events
  const loginForm = document.getElementById('student-login-form');
  const phoneInput = document.getElementById('login-phone');
  const passInput = document.getElementById('login-password');
  const errorBox = document.getElementById('login-error-alert');
  const errorText = document.getElementById('login-error-text');
  const registerBtn = document.getElementById('btn-register-guide');

  if (registerBtn) {
    registerBtn.addEventListener('click', () => {
      alert("Rotary Institute සිසු ලියාපදිංචිය සඳහා ආයතනික කාර්යාලය අමතන්න (0112 822 566).");
    });
  }

  if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const enteredPhone = phoneInput.value.trim();
      const enteredPass = passInput.value.trim();

      if (enteredPhone === VALID_CREDENTIALS.phone && enteredPass === VALID_CREDENTIALS.studentId) {
        errorBox.classList.remove('show');
        setAuthSession({
          phone: enteredPhone,
          id: enteredPass,
          name: VALID_CREDENTIALS.name
        });
        showToast(`සාදරයෙන් පිළිගනිමු, ${VALID_CREDENTIALS.name}!`);
        navigateTo('/');
      } else {
        errorText.textContent = "දුරකථන අංකය හෝ මුරපදය වැරදියි! කරුණාකර නැවත උත්සාහ කරන්න.";
        errorBox.classList.add('show');
        phoneInput.focus();
      }
    });
  }
}

// Chart Instances
let paperMarksChartInstance = null;
let workTimesChartInstance = null;

// VIEW 2: STUDENT DASHBOARD
function renderDashboard() {
  const app = document.querySelector('#app');
  app.innerHTML = `
    <!-- Top Navigation Bar -->
    <header class="top-navbar">
      <div class="nav-left">
        <button class="nav-btn" id="btn-back" title="Back / Toggle Menu">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </button>
        <div class="nav-brand-box">
          <img src="/logo.png" alt="AP Papers Logo" class="nav-brand-logo" />
          <span class="nav-brand-name">AP Papers</span>
        </div>
      </div>
      <div class="nav-right">
        <!-- Notification Bell -->
        <button class="notification-btn" id="btn-notifications" title="Notifications">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
          </svg>
          <span class="notification-badge"></span>
        </button>
        
        <!-- Notification Dropdown -->
        <div class="notification-dropdown" id="notification-dropdown">
          <div style="font-weight: 700; font-size: 14px; margin-bottom: 10px; color: #1e293b;">Notifications</div>
          <div class="notification-item">
            <strong>Database Live Sync</strong><br>
            <span style="color:#64748b">Connected to Firebase Firestore Cloud DB.</span>
            <div class="time-meta">Just now</div>
          </div>
          <div class="notification-item">
            <strong>2027 S1 MAIN PAPER 03 Released</strong><br>
            <span style="color:#64748b">New marks published: 65.00% (Credit Pass).</span>
            <div class="time-meta">Today</div>
          </div>
        </div>

        <!-- User Profile Badge -->
        <div class="user-profile" id="btn-profile" title="Student Profile">
          <span class="user-name">${state.studentName}</span>
          <div class="user-avatar">NY</div>
        </div>

        <!-- Logout Button -->
        <button class="btn-logout" id="btn-logout" title="Sign Out">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
            <polyline points="16 17 21 12 16 7"></polyline>
            <line x1="21" y1="12" x2="9" y2="12"></line>
          </svg>
          Logout
        </button>
      </div>
    </header>

    <!-- Main Content Dashboard -->
    <main class="dashboard-wrapper">
      <!-- Greeting Row -->
      <div class="greeting-row">
        <div class="greeting-info">
          <span class="greeting-emoji" id="greeting-emoji">🌙</span>
          <h1 class="greeting-text" id="greeting-text">Good Night ${state.studentName} !</h1>
        </div>
        <button class="institute-badge" id="btn-institute" title="Institute Information">
          <svg class="institute-icon" viewBox="0 0 24 24">
            <path d="M12 2L2 7v2h20V7L12 2zm-8 7v10h3V9H4zm5 0v10h3V9H9zm5 0v10h3V9h-3zm5 0v10h3V9h-3zM2 20v2h20v-2H2z"/>
          </svg>
          Institute : ${state.institute}
        </button>
      </div>

      <!-- Top 4 Stats Cards Grid -->
      <section class="stats-grid">
        <!-- 1. Student ID -->
        <div class="stat-card student-id-card" id="card-student-id" title="Click to view Student Digital Pass">
          <div class="stat-content">
            <span class="stat-label">STUDENT ID</span>
            <span class="stat-value-large">${state.studentId}</span>
          </div>
          <div class="qr-icon-badge">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="7" height="7"></rect>
              <rect x="14" y="3" width="7" height="7"></rect>
              <rect x="14" y="14" width="7" height="7"></rect>
              <rect x="3" y="14" width="7" height="7"></rect>
              <path d="M7 7h.01"></path>
              <path d="M17 7h.01"></path>
              <path d="M7 17h.01"></path>
              <path d="M17 17h.01"></path>
            </svg>
          </div>
        </div>

        <!-- 2. AP LearnIX (Gradient AI Card) -->
        <div class="stat-card learnix-card" id="card-learnix" title="Click to open AP LearnIX AI Assistant">
          <div class="stat-content">
            <span class="stat-label">ASK ME ANYTHING...</span>
            <span class="learnix-title">AP LearnIX</span>
          </div>
          <div class="ai-icon-badge">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="4" y="4" width="16" height="16" rx="2"></rect>
              <rect x="9" y="9" width="6" height="6"></rect>
              <path d="M9 1v3"></path>
              <path d="M15 1v3"></path>
              <path d="M9 20v3"></path>
              <path d="M15 20v3"></path>
              <path d="M20 9h3"></path>
              <path d="M20 14h3"></path>
              <path d="M1 9h3"></path>
              <path d="M1 14h3"></path>
            </svg>
          </div>
        </div>

        <!-- 3. AVG WORK TIME -->
        <div class="stat-card worktime-card" id="card-avg-worktime">
          <div class="worktime-header">
            <span class="stat-label">AVG WORK TIME</span>
            <div class="worktime-val" id="avg-worktime-display">12.3 <span>hrs</span></div>
          </div>
          <div class="progress-track">
            <div class="progress-fill-emerald" id="avg-worktime-bar"></div>
          </div>
        </div>

        <!-- 4. TUTE DELIVERY -->
        <div class="stat-card delivery-card" id="card-tute-delivery" title="Click to view Tute Delivery tracking">
          <div class="stat-content">
            <span class="stat-label">TUTE DELIVERY</span>
            <div class="delivery-status">No active delivery</div>
            <div class="delivery-subtext">Nothing on the way right now</div>
          </div>
          <div class="delivery-icon-badge">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="1" y="3" width="15" height="13"></rect>
              <polygon points="16 8 20 8 23 11 23 16 16 16 8"></polygon>
              <circle cx="5.5" cy="18.5" r="2.5"></circle>
              <circle cx="18.5" cy="18.5" r="2.5"></circle>
            </svg>
          </div>
        </div>
      </section>

      <!-- Main Dashboard Split Grid -->
      <div class="dashboard-grid">
        <!-- Left Main Column -->
        <section class="main-column">
          <!-- Paper Marks Analyze Card (Image 2) -->
          <div class="card-box">
            <div class="card-header">
              <h2 class="card-title">Paper Marks Analyze</h2>
            </div>
            <div class="chart-container-analyze">
              <canvas id="paperMarksChart"></canvas>
            </div>
            <div class="custom-legend">
              <div class="legend-item essay" id="legend-essay">
                <span class="legend-symbol">--○--</span> Essay
              </div>
              <div class="legend-item mcq" id="legend-mcq">
                <span class="legend-symbol">--○--</span> MCQ
              </div>
              <div class="legend-item total" id="legend-total">
                <span class="legend-symbol">--○--</span> Total
              </div>
            </div>
          </div>

          <!-- Sub Grid: Papers & Work Times (Image 1) -->
          <div class="sub-charts-grid">
            <!-- Papers Card -->
            <div class="card-box" id="card-papers">
              <div class="card-header">
                <h2 class="card-title">Papers</h2>
                <a class="card-header-link" id="link-what-colors">What are these colours?</a>
              </div>
              <div class="papers-list" id="papers-list-container">
                ${renderPapersListHTML()}
              </div>
            </div>

            <!-- Work Times Card -->
            <div class="card-box" id="card-worktimes">
              <div class="card-header">
                <h2 class="card-title">Work Times</h2>
                <button class="btn-log-today" id="btn-log-today">
                  <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <polyline points="12 6 12 12 16 14"></polyline>
                  </svg>
                  Log today
                </button>
              </div>
              <div class="chart-container-worktimes">
                <canvas id="workTimesChart"></canvas>
              </div>
            </div>
          </div>
        </section>

        <!-- Right Column: Notices -->
        <aside class="sidebar-column">
          <div class="card-box notices-card">
            <div class="card-header">
              <h2 class="card-title notices-title">Notices</h2>
            </div>
            <div class="notices-list">
              <div class="notice-item" id="notice-fees">
                <div class="notice-title-row">
                  <span class="notice-pin">🔴</span>
                  <p class="notice-text">2026 ඔක්තෝබර් මාසය සදහා පන්ති ගාස්තු ගෙවීම.</p>
                </div>
                <a class="notice-link">Click here to more details.</a>
              </div>

              <div class="notice-item" id="notice-reg">
                <div class="notice-title-row">
                  <p class="notice-text">නව සිසු ලියාපදිංචි වීමේ ක්‍රියාවලිය (New Student Registration Guide)</p>
                </div>
                <a class="notice-link">Click here to more details.</a>
              </div>

              <div class="notice-item video-notice" id="notice-video">
                <div class="notice-header-label">VIDEO HELP</div>
                <div class="notice-title-row">
                  <p class="notice-text">Online මගින් සම්බන්ධ වන ඕනෑම පන්තියක් ලබාගන්නා ආකාරය වීඩියෝ සහය</p>
                </div>
                <a class="notice-link uppercase">CLICK HERE TO WATCH VIDEO</a>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </main>

    <!-- Modals Overlay -->
    <div class="modal-overlay" id="global-modal">
      <div class="modal-content" id="modal-content-inner"></div>
    </div>
  `;

  // Attach Dashboard Events & Init Charts
  setupDashboardEvents();
  initPaperMarksChart();
  initWorkTimesChart();
  updateGreeting();
}

function renderPapersListHTML() {
  return state.papers.map(p => {
    const details = getGradeDetails(p.total);
    return `
      <div class="paper-item">
        <div class="paper-meta">
          <span class="paper-name">${p.code}</span>
          <span class="paper-score" style="color: ${details.color};">${Number(p.total).toFixed(2)}%</span>
        </div>
        <div class="paper-progress-track">
          <div class="paper-progress-fill" style="width: ${Math.min(100, Math.max(2, p.total))}%; background-color: ${details.color};"></div>
        </div>
      </div>
    `;
  }).join('');
}

function updateDashboardPapersView() {
  const container = document.getElementById('papers-list-container');
  if (container) {
    container.innerHTML = renderPapersListHTML();
  }
  if (paperMarksChartInstance) {
    paperMarksChartInstance.data.labels = state.papers.map(p => p.code);
    paperMarksChartInstance.data.datasets[0].data = state.papers.map(p => p.essay);
    paperMarksChartInstance.data.datasets[1].data = state.papers.map(p => p.mcq);
    paperMarksChartInstance.data.datasets[2].data = state.papers.map(p => p.total);
    paperMarksChartInstance.data.datasets.forEach(d => {
      d.showLine = state.papers.length > 1;
    });
    paperMarksChartInstance.update();
  }
}

// VIEW 3: ADMIN PANEL (`/admin`)
function renderAdmin() {
  const app = document.querySelector('#app');
  
  let dbBadge = '<span class="db-status-pill connected">● Firebase Cloud DB Active</span>';
  if (state.firestoreStatus === 'permission-denied') {
    dbBadge = '<span class="db-status-pill warning">⚠️ Rules Update Required (Local Mode)</span>';
  }

  app.innerHTML = `
    <!-- Admin Navbar -->
    <nav class="admin-navbar">
      <div class="admin-nav-title">
        <img src="/logo.png" alt="Logo" style="width:28px; height:28px; object-fit:contain; border-radius:50%;" />
        Rotary Academic Administration
        <span class="admin-nav-badge">Marks Portal</span>
      </div>
      <div style="display:flex; align-items:center; gap:12px;">
        ${dbBadge}
        <button class="btn-back-dashboard" id="btn-back-to-dashboard">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
          Back to Student Dashboard
        </button>
      </div>
    </nav>

    <!-- Admin Content Area -->
    <div class="admin-wrapper">
      <!-- Firestore Rules Helper Banner if permission denied -->
      ${state.firestoreStatus === 'permission-denied' ? `
        <div class="firestore-rules-alert">
          <strong>⚠️ Firebase Firestore Security Rules Update Required:</strong>
          <p>ඔබගේ Firebase Console එකේ Security Rules වල දැනට <code>allow read, write: if false;</code> ඇති නිසා Cloud Database එකට write කිරීම අවහිර වී ඇත. පහත Rule එක <strong>Firebase Console &rarr; Firestore Database &rarr; Rules</strong> වෙත paste කර Publish කරන්න:</p>
          <pre>rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}</pre>
          <span style="font-size:12px;">(දැනට marks සියල්ල බාධාවකින් තොරව local storage එකේ save වේ. Rule එක publish කළ පසු ක්ෂණිකව cloud database එකට sync වේ.)</span>
        </div>
      ` : ''}

      <!-- Student Banner -->
      <div class="admin-header-banner">
        <div class="admin-student-info">
          <h2>Student: ${state.studentName}</h2>
          <p>Student ID: <strong>${state.studentId}</strong> | Institute: <strong>Rotary Nugegoda</strong> | Batch: <strong>${state.batch}</strong></p>
        </div>
        <div>
          <button id="btn-restore-defaults" style="background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 8px 14px; border-radius: 8px; font-size: 12.5px; font-weight: 600; cursor: pointer;">
            Restore Default Papers (02 & 03)
          </button>
        </div>
      </div>

      <!-- Admin Layout Grid -->
      <div class="admin-layout-grid">
        <!-- Left: Form to Add/Edit Paper Marks -->
        <div class="admin-card">
          <h3 class="admin-card-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0284c7" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
            Add / Update Paper Marks
          </h3>

          <form id="admin-marks-form">
            <div class="admin-form-group">
              <label class="admin-form-label">Paper Name / Code</label>
              <input type="text" id="admin-input-paper-code" class="admin-form-input" placeholder="e.g. 2027 S1 MAIN PAPER 04" required list="paper-suggestions" />
              <datalist id="paper-suggestions">
                <option value="2027 S1 MAIN PAPER 02"></option>
                <option value="2027 S1 MAIN PAPER 03"></option>
                <option value="2027 S1 MAIN PAPER 04"></option>
                <option value="2027 S1 MAIN PAPER 05"></option>
                <option value="2027 S1 MODEL PAPER 01"></option>
              </datalist>
            </div>

            <div class="admin-form-group">
              <label class="admin-form-label">MCQ Marks</label>
              <input type="number" step="0.01" min="0" max="100" id="admin-input-mcq" class="admin-form-input" placeholder="e.g. 35.00" required />
            </div>

            <div class="admin-form-group">
              <label class="admin-form-label">Essay Marks <span style="font-weight: normal; color: #64748b; font-size: 11.5px;">(Optional - MCQ පමණක් ඇත්නම් හිස්ව තබන්න)</span></label>
              <input type="number" step="0.01" min="0" max="100" id="admin-input-essay" class="admin-form-input" placeholder="Optional (e.g. 30.00)" />
            </div>

            <!-- Total Preview Box (Auto Calculates) -->
            <div class="total-calc-box">
              <div>
                <span class="total-calc-label">Calculated Total:</span>
                <div class="total-calc-val" id="admin-preview-total">0.00%</div>
              </div>
              <div id="admin-preview-grade-badge">
                <span class="grade-badge-pill grade-pill-red">W (Repeat)</span>
              </div>
            </div>

            <button type="submit" class="btn-save-marks" id="btn-submit-marks">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                <polyline points="17 21 17 13 7 13 7 21"></polyline>
                <polyline points="7 3 7 8 15 8"></polyline>
              </svg>
              Save Marks & Sync to Database
            </button>
          </form>
        </div>

        <!-- Right: Current Papers Table -->
        <div class="admin-card">
          <h3 class="admin-card-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2">
              <line x1="8" y1="6" x2="21" y2="6"></line>
              <line x1="8" y1="12" x2="21" y2="12"></line>
              <line x1="8" y1="18" x2="21" y2="18"></line>
              <line x1="3" y1="6" x2="3.01" y2="6"></line>
              <line x1="3" y1="12" x2="3.01" y2="12"></line>
              <line x1="3" y1="18" x2="3.01" y2="18"></line>
            </svg>
            Live Database Records (${state.papers.length})
          </h3>

          <div class="papers-table-container">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>Paper Name</th>
                  <th>MCQ</th>
                  <th>Essay</th>
                  <th>Total</th>
                  <th>Grade</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody id="admin-table-body">
                ${renderAdminTableRows()}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;

  setupAdminEvents();
}

function renderAdminTableRows() {
  if (state.papers.length === 0) {
    return `<tr><td colspan="6" style="text-align: center; color: #94a3b8; padding: 20px;">No paper records found. Add one on the left.</td></tr>`;
  }
  return state.papers.map(p => {
    const details = getGradeDetails(p.total);
    return `
      <tr>
        <td><strong>${p.code}</strong></td>
        <td>${p.mcq}</td>
        <td>${p.essay}</td>
        <td><strong style="color: ${details.color};">${Number(p.total).toFixed(2)}%</strong></td>
        <td><span class="grade-badge-pill ${details.pillClass}">${details.label}</span></td>
        <td>
          <button class="table-btn-delete" data-code="${p.code}">Delete</button>
        </td>
      </tr>
    `;
  }).join('');
}

function updateAdminTableView() {
  const tbody = document.getElementById('admin-table-body');
  if (tbody) {
    tbody.innerHTML = renderAdminTableRows();
    attachTableDeleteHandlers();
  }
}

function setupAdminEvents() {
  const backBtn = document.getElementById('btn-back-to-dashboard');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      navigateTo('/');
    });
  }

  const mcqInput = document.getElementById('admin-input-mcq');
  const essayInput = document.getElementById('admin-input-essay');
  const totalDisplay = document.getElementById('admin-preview-total');
  const gradeBadgeBox = document.getElementById('admin-preview-grade-badge');

  function calculatePreview() {
    const mcq = parseFloat(mcqInput.value) || 0;
    const essay = essayInput.value.trim() !== '' ? (parseFloat(essayInput.value) || 0) : 0;
    const total = parseFloat((mcq + essay).toFixed(2));
    totalDisplay.textContent = `${total.toFixed(2)}%`;
    const details = getGradeDetails(total);
    gradeBadgeBox.innerHTML = `<span class="grade-badge-pill ${details.pillClass}">${details.label}</span>`;
  }

  mcqInput.addEventListener('input', calculatePreview);
  essayInput.addEventListener('input', calculatePreview);

  const form = document.getElementById('admin-marks-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = document.getElementById('admin-input-paper-code').value.trim();
    const mcq = parseFloat(mcqInput.value) || 0;
    const essay = essayInput.value.trim() !== '' ? (parseFloat(essayInput.value) || 0) : 0;
    const total = parseFloat((mcq + essay).toFixed(2));
    const details = getGradeDetails(total);

    const paperObj = {
      code,
      mcq,
      essay,
      total,
      color: details.color,
      grade: details.grade
    };

    await savePaperRecord(paperObj);
    updateAdminTableView();

    // Reset inputs
    document.getElementById('admin-input-paper-code').value = '';
    mcqInput.value = '';
    essayInput.value = '';
    calculatePreview();
  });

  const restoreBtn = document.getElementById('btn-restore-defaults');
  if (restoreBtn) {
    restoreBtn.addEventListener('click', async () => {
      for (const p of DEFAULT_PAPERS) {
        await savePaperRecord(p);
      }
      updateAdminTableView();
      showToast('Reset to default papers (02 & 03)!');
    });
  }

  attachTableDeleteHandlers();
}

function attachTableDeleteHandlers() {
  const deleteBtns = document.querySelectorAll('.table-btn-delete');
  deleteBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      const code = btn.getAttribute('data-code');
      if (code) {
        await deletePaperRecord(code);
        updateAdminTableView();
      }
    });
  });
}

// Setup Dashboard Interactions
function setupDashboardEvents() {
  // Logout button
  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      setAuthSession(null);
      showToast('Logged out successfully.');
      renderApp();
    });
  }

  // Notifications Dropdown
  const btnNotifications = document.getElementById('btn-notifications');
  const notificationDropdown = document.getElementById('notification-dropdown');
  if (btnNotifications && notificationDropdown) {
    btnNotifications.addEventListener('click', (e) => {
      e.stopPropagation();
      notificationDropdown.classList.toggle('active');
    });

    document.addEventListener('click', (e) => {
      if (!notificationDropdown.contains(e.target) && !btnNotifications.contains(e.target)) {
        notificationDropdown.classList.remove('active');
      }
    });
  }

  // Student Pass Modal
  const cardStudentId = document.getElementById('card-student-id');
  if (cardStudentId) {
    cardStudentId.addEventListener('click', () => {
      openModal(`
        <div class="modal-header">
          <h3 class="modal-title">Student Digital Identity Pass</h3>
          <button class="modal-close-btn" title="Close">&times;</button>
        </div>
        <div class="id-pass-card">
          <div class="id-pass-header">
            <span class="id-pass-title">ROTARY INSTITUTE NUGEGODA</span>
            <span style="font-size: 11px; background: rgba(255,255,255,0.25); padding: 3px 8px; border-radius: 12px;">ACTIVE STUDENT</span>
          </div>
          <div class="id-pass-body">
            <div class="id-avatar-box">NY</div>
            <div class="id-details">
              <h3>${state.studentName}</h3>
              <p><strong>Student ID:</strong> ${state.studentId}</p>
              <p><strong>Batch:</strong> ${state.batch}</p>
            </div>
          </div>
        </div>
      `);
    });
  }

  // LearnIX Modal
  const cardLearnix = document.getElementById('card-learnix');
  if (cardLearnix) {
    cardLearnix.addEventListener('click', () => {
      openModal(`
        <div class="modal-header">
          <h3 class="modal-title">AP LearnIX AI Assistant</h3>
          <button class="modal-close-btn" title="Close">&times;</button>
        </div>
        <div style="font-size: 14px; line-height: 1.6; color: #334155;">
          <p>Hello ${state.studentName}! I have analyzed your ${state.papers.length} paper records from the database. Ask me any study or exam questions!</p>
        </div>
      `);
    });
  }

  // What are these colours modal
  const linkWhatColors = document.getElementById('link-what-colors');
  if (linkWhatColors) {
    linkWhatColors.addEventListener('click', () => {
      openModal(`
        <div class="modal-header">
          <h3 class="modal-title">Paper Grading Color Scheme</h3>
          <button class="modal-close-btn" title="Close">&times;</button>
        </div>
        <div style="font-size: 14px; line-height: 1.6; color: #334155;">
          <div style="display: flex; flex-direction: column; gap: 10px;">
            <div style="padding: 10px; background: #fff1f2; border-left: 4px solid #e11d48; border-radius: 8px;">
              <strong style="color: #e11d48;">Red (&lt; 35%)</strong>: Weak performance / Repeat.
            </div>
            <div style="padding: 10px; background: #fffbeb; border-left: 4px solid #f59e0b; border-radius: 8px;">
              <strong style="color: #f59e0b;">Orange (35-54%)</strong>: Simple Pass (S).
            </div>
            <div style="padding: 10px; background: #f0fdf4; border-left: 4px solid #10b981; border-radius: 8px;">
              <strong style="color: #10b981;">Green (55-74%)</strong>: Credit Pass (C/B).
            </div>
            <div style="padding: 10px; background: #f0f9ff; border-left: 4px solid #0284c7; border-radius: 8px;">
              <strong style="color: #0284c7;">Cyan (75-100%)</strong>: Distinction (A).
            </div>
          </div>
        </div>
      `);
    });
  }

  // Log today modal
  const btnLogToday = document.getElementById('btn-log-today');
  if (btnLogToday) {
    btnLogToday.addEventListener('click', () => {
      openModal(`
        <div class="modal-header">
          <h3 class="modal-title">Log Today's Study Hours</h3>
          <button class="modal-close-btn" title="Close">&times;</button>
        </div>
        <form id="log-time-form" style="display: flex; flex-direction: column; gap: 14px;">
          <div>
            <label style="display: block; font-size: 13px; font-weight: 600; color: #334155; margin-bottom: 6px;">Hours Studied</label>
            <input type="number" id="input-study-hours" min="0.5" max="24" step="0.5" value="8.0" required style="width: 100%; padding: 10px; border: 1px solid #cbd5e1; border-radius: 8px;" />
          </div>
          <button type="submit" style="background: #0284c7; color: white; border: none; padding: 10px; border-radius: 8px; font-weight: 600; cursor: pointer;">Save Log</button>
        </form>
      `);

      const logForm = document.getElementById('log-time-form');
      logForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const hours = parseFloat(document.getElementById('input-study-hours').value) || 0;
        state.workTimes.labels.push('Today');
        state.workTimes.data.push(hours);
        if (workTimesChartInstance) workTimesChartInstance.update();
        closeModal();
        showToast(`Logged ${hours} study hours today!`);
      });
    });
  }
}

// Modal System
function openModal(htmlContent) {
  const modalOverlay = document.getElementById('global-modal');
  const modalInner = document.getElementById('modal-content-inner');
  if (!modalOverlay || !modalInner) return;

  modalInner.innerHTML = htmlContent;
  modalOverlay.classList.add('active');
  document.body.style.overflow = 'hidden';

  const closeBtn = modalInner.querySelector('.modal-close-btn');
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
}

function closeModal() {
  const modalOverlay = document.getElementById('global-modal');
  if (modalOverlay) modalOverlay.classList.remove('active');
  document.body.style.overflow = '';
}

// Paper Marks Analyze Chart (Image 2 custom floating tooltip)
function initPaperMarksChart() {
  const ctx = document.getElementById('paperMarksChart');
  if (!ctx) return;

  const labels = state.papers.map(p => p.code);
  const essayData = state.papers.map(p => p.essay);
  const mcqData = state.papers.map(p => p.mcq);
  const totalData = state.papers.map(p => p.total);

  paperMarksChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Essay',
          data: essayData,
          borderColor: '#f59e0b',
          backgroundColor: '#ffffff',
          pointBackgroundColor: '#ffffff',
          pointBorderColor: '#f59e0b',
          pointBorderWidth: 2.5,
          pointRadius: 6,
          pointHoverRadius: 9,
          pointHoverBackgroundColor: '#f59e0b',
          pointHoverBorderColor: '#ffffff',
          showLine: labels.length > 1,
          borderWidth: 2,
          tension: 0.1
        },
        {
          label: 'MCQ',
          data: mcqData,
          borderColor: '#10b981',
          backgroundColor: '#ffffff',
          pointBackgroundColor: '#ffffff',
          pointBorderColor: '#10b981',
          pointBorderWidth: 2.5,
          pointRadius: 6,
          pointHoverRadius: 9,
          pointHoverBackgroundColor: '#10b981',
          pointHoverBorderColor: '#ffffff',
          showLine: labels.length > 1,
          borderWidth: 2,
          tension: 0.1
        },
        {
          label: 'Total',
          data: totalData,
          borderColor: '#3b82f6',
          backgroundColor: '#ffffff',
          pointBackgroundColor: '#ffffff',
          pointBorderColor: '#3b82f6',
          pointBorderWidth: 2.5,
          pointRadius: 6,
          pointHoverRadius: 9,
          pointHoverBackgroundColor: '#3b82f6',
          pointHoverBorderColor: '#ffffff',
          showLine: labels.length > 1,
          borderWidth: 2,
          tension: 0.1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: false,
          external: function(context) {
            let tooltipEl = document.getElementById('chartjs-tooltip-custom');
            if (!tooltipEl) {
              tooltipEl = document.createElement('div');
              tooltipEl.id = 'chartjs-tooltip-custom';
              tooltipEl.className = 'custom-chartjs-tooltip';
              document.body.appendChild(tooltipEl);
            }

            const tooltipModel = context.tooltip;
            if (tooltipModel.opacity === 0) {
              tooltipEl.classList.remove('visible');
              return;
            }

            if (tooltipModel.body) {
              const paperIndex = tooltipModel.dataPoints[0].dataIndex;
              const paper = state.papers[paperIndex];
              if (paper) {
                tooltipEl.innerHTML = `
                  <div class="tooltip-header">${paper.code}</div>
                  <div class="tooltip-list">
                    <div class="tooltip-entry">
                      <div class="tooltip-entry-left">
                        <span class="tooltip-dot dot-total"></span> Total
                      </div>
                      <div class="tooltip-entry-val">${paper.total}</div>
                    </div>
                    <div class="tooltip-entry">
                      <div class="tooltip-entry-left">
                        <span class="tooltip-dot dot-mcq"></span> MCQ
                      </div>
                      <div class="tooltip-entry-val">${paper.mcq}</div>
                    </div>
                    <div class="tooltip-entry">
                      <div class="tooltip-entry-left">
                        <span class="tooltip-dot dot-essay"></span> Essay
                      </div>
                      <div class="tooltip-entry-val">${paper.essay}</div>
                    </div>
                  </div>
                `;
              }
            }

            const position = context.chart.canvas.getBoundingClientRect();
            tooltipEl.style.left = (position.left + window.pageXOffset + tooltipModel.caretX) + 'px';
            tooltipEl.style.top = (position.top + window.pageYOffset + tooltipModel.caretY) + 'px';
            tooltipEl.classList.add('visible');
          }
        }
      },
      scales: {
        y: {
          min: 0,
          max: 100,
          ticks: {
            stepSize: 25,
            color: '#64748b',
            font: { family: 'Outfit', size: 12 }
          },
          grid: {
            color: '#e2e8f0',
            borderDash: [3, 4],
            drawBorder: false
          }
        },
        x: {
          ticks: {
            color: '#64748b',
            font: { family: 'Outfit', size: 12, weight: 500 }
          },
          grid: {
            color: '#f1f5f9',
            borderDash: [3, 4],
            drawBorder: false
          }
        }
      }
    }
  });

  // Custom legend toggles
  const legendEssay = document.getElementById('legend-essay');
  const legendMcq = document.getElementById('legend-mcq');
  const legendTotal = document.getElementById('legend-total');

  if (legendEssay) {
    legendEssay.addEventListener('click', () => {
      const isVisible = paperMarksChartInstance.isDatasetVisible(0);
      paperMarksChartInstance.setDatasetVisibility(0, !isVisible);
      paperMarksChartInstance.update();
      legendEssay.style.opacity = isVisible ? '0.35' : '1';
    });
  }
  if (legendMcq) {
    legendMcq.addEventListener('click', () => {
      const isVisible = paperMarksChartInstance.isDatasetVisible(1);
      paperMarksChartInstance.setDatasetVisibility(1, !isVisible);
      paperMarksChartInstance.update();
      legendMcq.style.opacity = isVisible ? '0.35' : '1';
    });
  }
  if (legendTotal) {
    legendTotal.addEventListener('click', () => {
      const isVisible = paperMarksChartInstance.isDatasetVisible(2);
      paperMarksChartInstance.setDatasetVisibility(2, !isVisible);
      paperMarksChartInstance.update();
      legendTotal.style.opacity = isVisible ? '0.35' : '1';
    });
  }
}

// Work Times Chart
function initWorkTimesChart() {
  const ctx = document.getElementById('workTimesChart');
  if (!ctx) return;

  const gradient = ctx.getContext('2d').createLinearGradient(0, 0, 0, 200);
  gradient.addColorStop(0, 'rgba(56, 189, 248, 0.28)');
  gradient.addColorStop(1, 'rgba(56, 189, 248, 0.01)');

  workTimesChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: state.workTimes.labels,
      datasets: [
        {
          label: 'Study Hours',
          data: state.workTimes.data,
          borderColor: '#00b4d8',
          borderWidth: 2.5,
          fill: true,
          backgroundColor: gradient,
          tension: 0.45,
          pointRadius: 0,
          pointHoverRadius: 6,
          pointHoverBackgroundColor: '#00b4d8',
          pointHoverBorderColor: '#ffffff',
          pointHoverBorderWidth: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          min: 0,
          max: 14,
          ticks: {
            stepSize: 4,
            callback: (val) => (val === 0 || val === 4 || val === 8 || val === 12 || val === 14) ? val : null,
            color: '#64748b',
            font: { family: 'Outfit', size: 11 }
          },
          grid: { color: '#f1f5f9', borderDash: [3, 4] }
        },
        x: {
          ticks: { color: '#64748b', font: { family: 'Outfit', size: 11 } },
          grid: { display: false }
        }
      }
    }
  });
}

// Master Router & Render
function renderApp() {
  const existingTooltip = document.getElementById('chartjs-tooltip-custom');
  if (existingTooltip) existingTooltip.remove();

  const route = getCurrentRoute();
  const session = getAuthSession();

  // If visiting /admin, let user into Admin Panel
  if (route === 'admin') {
    renderAdmin();
    return;
  }

  // If not logged in, show Login Page
  if (!session) {
    renderLoginPage();
    return;
  }

  // Otherwise render Dashboard
  renderDashboard();
}

window.addEventListener('popstate', renderApp);
window.addEventListener('hashchange', renderApp);

// Live Clock Greeting Update
setInterval(() => {
  if (getCurrentRoute() === 'dashboard' && getAuthSession()) {
    updateGreeting();
  }
}, 1000);

document.addEventListener('click', (e) => {
  const modalOverlay = document.getElementById('global-modal');
  if (modalOverlay && e.target === modalOverlay) closeModal();
});

// Run Application
renderApp();
