/* ==========================================================
   إدارة المحل v5.0 - النظام السحابي المتكامل
   الجزء 1: الأساسيات + الباركود + الصوت
   ========================================================== */

/* ============ إعدادات Supabase ============ */
const SUPABASE_URL = 'https://mdvamcntgajaiarhqeci.supabase.co';
const SUPABASE_KEY = 'sb_publishable_8a5ZkcHUW_b51WRanlLGSg_tspTOLoV';
let supabaseClient = null;

/* ============ الحالة العامة ============ */
let state = {
  currentUser: null,
  role: 'employee',
  cart: [],
  products: [],
  sales: [],
  customers: [],
  suppliers: [],
  expenses: [],
  stockMoves: [],
  returns: [],
  customerPayments: [],
  purchases: [],
  shifts: [],
  currentShift: null,
  storeSettings: {
    name: 'محل جديد',
    phone: '',
    address: '',
    currency: 'ج.م',
    logo: '',
    taxNumber: ''
  },
  subscription: { plan: 'trial', status: 'active', expires_at: null }
};

let syncTimer = null;
let isSyncing = false;
let salesChartInstance = null;
let audioCtx = null;
let barcodeStream = null;
let barcodeDetector = null;
let barcodeScanFrame = null;
let barcodeTimer = null;
let lastProcessedBarcode = '';

/* ============ أدوات مساعدة ============ */
function uid(prefix) {
  prefix = prefix || 'ID';
  return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function today() {
  return new Date().toISOString().split('T')[0];
}

function money(n) {
  const cur = state.storeSettings.currency || 'ج.م';
  return (Number(n) || 0).toFixed(2) + ' ' + cur;
}

function escapeHTML(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function normalizeBarcode(v) {
  return String(v == null ? '' : v)
    .normalize('NFKC')
    .replace(/[٠-٩]/g, function(c) { return String(c.charCodeAt(0) - 1632); })
    .replace(/[۰-۹]/g, function(c) { return String(c.charCodeAt(0) - 1776); })
    .replace(/[\s\-]/g, '')
    .trim();
}

/* ============ الصوت ============ */
function initAudio() {
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch (e) { console.warn('Audio not supported'); }
}

function playBeep(success) {
  if (!audioCtx) return;
  try {
    // استئناف الـ context لو كان معلّق
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = success ? 880 : 220;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.2);
  } catch (e) {}
}

/* ============ الإشعارات ============ */
function showNotification(msg, type) {
  type = type || 'success';
  const colors = { success: '#2e7d32', error: '#c62828', warning: '#e58a16', info: '#1769aa' };
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const div = document.createElement('div');
  div.className = 'notification-toast ' + type;
  div.innerHTML = '<span style="font-size:18px">' + (icons[type] || '') + '</span> ' + escapeHTML(msg);
  div.style.cssText =
    'position:fixed;bottom:20px;left:20px;z-index:99999;' +
    'padding:12px 20px;border-radius:10px;color:#fff;font-weight:bold;' +
    'background:' + (colors[type] || colors.success) + ';' +
    'box-shadow:0 6px 20px rgba(0,0,0,0.25);transition:opacity 0.3s;max-width:90vw;' +
    'display:flex;align-items:center;gap:10px;font-family:Tahoma,Arial,sans-serif';
  document.body.appendChild(div);
  setTimeout(function() {
    div.style.opacity = '0';
    setTimeout(function() { div.remove(); }, 300);
  }, 3000);
}

/* ============ Loading ============ */
function showLoading(text) {
  if (document.querySelector('.spinner-overlay')) return;
  const overlay = document.createElement('div');
  overlay.className = 'spinner-overlay';
  overlay.style.cssText =
    'position:fixed;inset:0;background:#0007;display:flex;align-items:center;' +
    'justify-content:center;z-index:99999;backdrop-filter:blur(3px);';
  overlay.innerHTML =
    '<div style="text-align:center;color:#fff">' +
    '<div style="width:50px;height:50px;border:5px solid #ffffff30;' +
    'border-top-color:#fff;border-radius:50%;animation:spin 0.8s linear infinite;margin:auto"></div>' +
    '<p style="margin-top:14px;font-weight:700">' + escapeHTML(text || 'جارٍ التحميل...') + '</p>' +
    '</div>' +
    '<style>@keyframes spin{to{transform:rotate(360deg)}}</style>';
  document.body.appendChild(overlay);
}

function hideLoading() {
  const o = document.querySelector('.spinner-overlay');
  if (o) o.remove();
}

/* ============ حفظ الصفحة الحالية ============ */
function saveCurrentPage(pageId) {
  if (!state.currentUser) return;
  try {
    localStorage.setItem('pos_lastPage_' + state.currentUser.id, pageId);
  } catch (e) {}
}

function getLastPage() {
  if (!state.currentUser) return 'home';
  try {
    return localStorage.getItem('pos_lastPage_' + state.currentUser.id) || 'home';
  } catch (e) { return 'home'; }
}

/* ============ التنقل ============ */
function toggleSidebar(show) {
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (!sidebar || !backdrop) return;
  if (show) {
    sidebar.classList.add('open');
    backdrop.classList.add('open');
    document.body.style.overflow = 'hidden';
  } else {
    sidebar.classList.remove('open');
    backdrop.classList.remove('open');
    document.body.style.overflow = '';
  }
}

function showPage(pageId) {
  // الموظف يشوف المبيعات والرئيسية فقط
  if (state.role === 'employee' && pageId !== 'sales' && pageId !== 'home') {
    showNotification('هذه الصفحة متاحة للمدير فقط', 'warning');
    pageId = 'sales';
  }

  document.querySelectorAll('.page').forEach(function(p) { p.classList.remove('active'); });
  document.querySelectorAll('.sidebar-nav button').forEach(function(b) { b.classList.remove('active'); });

  const targetPage = document.getElementById(pageId);
  if (targetPage) targetPage.classList.add('active');

  const targetBtn = document.querySelector('.sidebar-nav button[data-page="' + pageId + '"]');
  if (targetBtn) targetBtn.classList.add('active');

  // حفظ الصفحة الحالية
  saveCurrentPage(pageId);

  toggleSidebar(false);
  window.scrollTo(0, 0);

  // تحديث المحتوى حسب الصفحة
  if (pageId === 'home') renderDashboard();
  if (pageId === 'sales') {
    populateSalesDropdowns();
    const bc = document.getElementById('saleBarcode');
    if (bc) bc.focus();
  }
  if (pageId === 'inventoryHub') switchInventoryTab('products');
  if (pageId === 'partnersHub') switchPartnersTab('customers');
  if (pageId === 'financeHub') {
    renderExpenses();
    renderReports();
    calcExpectedShiftCash();
    renderShifts();
  }
  if (pageId === 'settingsHub') loadStoreSettings();
  if (pageId === 'subscription') renderSubscription();
}

/* ============ التبويبات ============ */
function switchInventoryTab(tabName) {
  document.querySelectorAll('.inv-tab-content').forEach(function(el) { el.style.display = 'none'; });
  if (tabName === 'products') {
    document.getElementById('invTabProducts').style.display = 'block';
    renderProducts();
  }
  if (tabName === 'moves') {
    document.getElementById('invTabMoves').style.display = 'block';
    populateAdjustDropdown();
    renderStockMoves();
  }
  if (tabName === 'returns') {
    document.getElementById('invTabReturns').style.display = 'block';
    populateReturnDropdowns();
    renderReturns();
  }
}

function switchPartnersTab(tabName) {
  document.querySelectorAll('.part-tab-content').forEach(function(el) { el.style.display = 'none'; });
  if (tabName === 'customers') {
    document.getElementById('partTabCustomers').style.display = 'block';
    renderCustomers();
    renderCustomerPayments();
  }
  if (tabName === 'suppliers') {
    document.getElementById('partTabSuppliers').style.display = 'block';
    renderSuppliers();
    renderPurchases();
  }
}

function switchFinanceTab(tabName) {
  document.querySelectorAll('.fin-tab-content').forEach(function(el) { el.style.display = 'none'; });
  if (tabName === 'expenses') {
    document.getElementById('finTabExpenses').style.display = 'block';
  }
  if (tabName === 'reports') {
    document.getElementById('finTabReports').style.display = 'block';
    renderReports();
  }
  if (tabName === 'shift') {
    document.getElementById('finTabShift').style.display = 'block';
    calcExpectedShiftCash();
    renderShifts();
  }
}

/* ============ Supabase Auth ============ */
function initSupabase() {
  if (typeof supabase !== 'undefined') {
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  }
}

function togglePassword(id, btn) {
  const field = document.getElementById(id);
  if (!field) return;
  const showing = field.type === 'password';
  field.type = showing ? 'text' : 'password';
  btn.textContent = showing ? 'إخفاء' : 'إظهار';
}

function setAuthMessage(msg, isError) {
  const el = document.getElementById('authMessage');
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? '#c0392b' : '#17643a';
}

function setAuthBusy(busy) {
  const lb = document.getElementById('loginButton');
  const sb = document.getElementById('signupButton');
  const fb = document.getElementById('forgotButton');
  if (lb) { lb.disabled = busy; lb.textContent = busy ? 'جارٍ...' : 'دخول للنظام 🚀'; }
  if (sb) sb.disabled = busy;
  if (fb) fb.disabled = busy;
}

async function signIn() {
  const email = (document.getElementById('authEmail').value || '').trim();
  const password = document.getElementById('authPassword').value || '';
  if (!email || !password) return setAuthMessage('أدخل البريد وكلمة المرور', true);
  setAuthBusy(true);
  setAuthMessage('جارٍ تسجيل الدخول...');
  try {
    const result = await supabaseClient.auth.signInWithPassword({ email: email, password: password });
    if (result.error) throw result.error;
    await openUserSession(result.data.user);
  } catch (e) {
    setAuthMessage('تعذر الدخول: ' + (e.message || ''), true);
  } finally {
    setAuthBusy(false);
  }
}

async function signUp() {
  const email = (document.getElementById('authEmail').value || '').trim();
  const password = document.getElementById('authPassword').value || '';
  if (!email || !password) return setAuthMessage('أدخل البريد وكلمة المرور', true);
  if (password.length < 6) return setAuthMessage('كلمة المرور 6 أحرف على الأقل', true);
  setAuthBusy(true);
  setAuthMessage('جارٍ إنشاء الحساب...');
  try {
    const result = await supabaseClient.auth.signUp({ email: email, password: password });
    if (result.error) throw result.error;
    if (result.data.session && result.data.user) {
      await openUserSession(result.data.user);
    } else {
      setAuthMessage('تم إنشاء الحساب. تحقق من بريدك ثم سجّل دخول.');
    }
  } catch (e) {
    setAuthMessage('تعذر الإنشاء: ' + (e.message || ''), true);
  } finally {
    setAuthBusy(false);
  }
}

async function sendPasswordReset() {
  const email = (document.getElementById('authEmail').value || '').trim();
  if (!email) return setAuthMessage('أدخل البريد أولاً', true);
  setAuthBusy(true);
  try {
    const result = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: location.origin + location.pathname
    });
    if (result.error) throw result.error;
    setAuthMessage('تم إرسال رابط الاسترجاع على بريدك.');
  } catch (e) {
    setAuthMessage('تعذر الإرسال: ' + (e.message || ''), true);
  } finally {
    setAuthBusy(false);
  }
}

async function saveNewPassword() {
  const password = document.getElementById('newPassword').value || '';
  if (password.length < 6) return setAuthMessage('كلمة المرور 6 أحرف على الأقل', true);
  try {
    const result = await supabaseClient.auth.updateUser({ password: password });
    if (result.error) throw result.error;
    await supabaseClient.auth.signOut();
    showLoggedOutUI();
    setAuthMessage('تم تغيير كلمة المرور. سجّل دخول الآن.');
  } catch (e) {
    setAuthMessage('تعذر التغيير: ' + (e.message || ''), true);
  }
}

function showLoggedOutUI() {
  state.currentUser = null;
  state.role = 'employee';
  document.body.classList.add('auth-locked');
  const ls = document.getElementById('loginScreen');
  if (ls) ls.classList.add('active');
  const rb = document.getElementById('recoveryPanel');
  if (rb) rb.style.display = 'none';
  const lb = document.getElementById('loginButtons');
  if (lb) lb.style.display = 'block';
}

function showLoggedInUI() {
  document.body.classList.remove('auth-locked');
  const ls = document.getElementById('loginScreen');
  if (ls) ls.classList.remove('active');
}

async function handleLogout() {
  if (!confirm('تسجيل الخروج؟')) return;
  try {
    await supabaseClient.auth.signOut();
    showLoggedOutUI();
  } catch (e) {
    showNotification('تعذر الخروج', 'error');
  }
}

async function openUserSession(user) {
  state.currentUser = user;
  showLoading('جارٍ تحميل بياناتك...');
  try {
    // 1. الدور
    const roleRes = await supabaseClient
      .from('shop_user_roles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle();
    state.role = (roleRes.data && roleRes.data.role === 'employee') ? 'employee' : 'manager';

    // 2. الاشتراك
    const subRes = await supabaseClient
      .from('shop_subscriptions')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();
    if (subRes.data) {
      state.subscription = {
        plan: subRes.data.plan || 'trial',
        status: subRes.data.status || 'active',
        expires_at: subRes.data.expires_at
      };
      if (subRes.data.expires_at && new Date(subRes.data.expires_at) < new Date() && subRes.data.status !== 'expired') {
        await supabaseClient.from('shop_subscriptions').update({ status: 'expired' }).eq('user_id', user.id);
        state.subscription.status = 'expired';
      }
    }

    // 3. البيانات
    const dataRes = await supabaseClient
      .from('shop_data')
      .select('shop_data')
      .eq('user_id', user.id)
      .maybeSingle();
    if (dataRes.error) throw dataRes.error;

    if (dataRes.data && dataRes.data.shop_data && Object.keys(dataRes.data.shop_data).length > 0) {
      const d = dataRes.data.shop_data;
      state.products = d.products || [];
      state.sales = d.sales || [];
      state.customers = d.customers || [];
      state.suppliers = d.suppliers || [];
      state.expenses = d.expenses || [];
      state.stockMoves = d.stockMoves || [];
      state.returns = d.returns || [];
      state.customerPayments = d.customerPayments || [];
      state.purchases = d.purchases || [];
      state.shifts = d.shifts || [];
      state.currentShift = d.currentShift || null;
      if (d.storeSettings) state.storeSettings = Object.assign({}, state.storeSettings, d.storeSettings);
    } else {
      // مستخدم جديد
      state.products = [];
      state.sales = [];
      state.customers = [{ id: uid('CUST'), name: 'عميل نقدي عام', phone: '-', openingDebt: 0 }];
      state.suppliers = [];
      state.expenses = [];
      state.stockMoves = [];
      state.returns = [];
      state.customerPayments = [];
      state.purchases = [];
      state.shifts = [];
      state.currentShift = null;
    }

    if (state.subscription.status === 'expired') {
      showNotification('انتهى اشتراكك. جدد الاشتراك للاستمرار.', 'warning');
    }

    showLoggedInUI();
    applyRolePermissions();
    renderAll();
    
    // استرجاع آخر صفحة
    const lastPage = getLastPage();
    const validPages = ['home', 'sales', 'inventoryHub', 'partnersHub', 'financeHub', 'settingsHub', 'subscription', 'helpGuide', 'aboutUs'];
    const pageToShow = (state.role === 'employee') ? 'sales' : (validPages.includes(lastPage) ? lastPage : 'home');
    showPage(pageToShow);
    
  } catch (e) {
    console.error(e);
    setAuthMessage('تعذر تحميل البيانات: ' + (e.message || ''), true);
    showLoggedOutUI();
  } finally {
    hideLoading();
  }
}

function applyRolePermissions() {
  const employee = state.role === 'employee';
  document.querySelectorAll('.sidebar-nav button').forEach(function(btn) {
    const page = btn.getAttribute('data-page');
    if (employee && page && page !== 'sales' && page !== 'home') {
      btn.style.display = 'none';
    } else {
      btn.style.display = '';
    }
  });
  const syncBtn = document.querySelector('.sidebar-nav button[data-action="sync"]');
  if (syncBtn) syncBtn.style.display = employee ? 'none' : '';
}

async function startAuth() {
  initSupabase();
  if (!supabaseClient) {
    setAuthMessage('فشل الاتصال بالسيرفر', true);
    return;
  }
  try {
    const result = await supabaseClient.auth.getSession();
    if (result.error) throw result.error;
    if (location.hash.indexOf('type=recovery') !== -1) {
      showLoggedOutUI();
      document.getElementById('recoveryPanel').style.display = 'block';
      document.getElementById('loginButtons').style.display = 'none';
      document.getElementById('authTitle').textContent = 'تعيين كلمة مرور جديدة';
    } else if (result.data.session && result.data.session.user) {
      await openUserSession(result.data.session.user);
    } else {
      showLoggedOutUI();
    }
  } catch (e) {
    showLoggedOutUI();
    setAuthMessage('تعذر الاتصال: ' + (e.message || ''), true);
  }

  supabaseClient.auth.onAuthStateChange(function(event, session) {
    if (event === 'PASSWORD_RECOVERY') {
      showLoggedOutUI();
      document.getElementById('recoveryPanel').style.display = 'block';
      document.getElementById('loginButtons').style.display = 'none';
    }
  });
}

/* ============ الباركود ============ */
function setupBarcodeListener() {
  const barcodeInput = document.getElementById('saleBarcode');
  if (!barcodeInput) return;

  barcodeInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(barcodeTimer);
      processBarcodeNow(barcodeInput.value);
      barcodeInput.value = '';
    }
  });

  barcodeInput.addEventListener('input', function() {
    clearTimeout(barcodeTimer);
    const val = barcodeInput.value.trim();
    if (val.length >= 4) {
      barcodeTimer = setTimeout(function() {
        if (document.activeElement === barcodeInput) {
          processBarcodeNow(val);
          barcodeInput.value = '';
        }
      }, 500);
    }
  });
}

function processBarcodeNow(code) {
  const cleanCode = normalizeBarcode(code);
  if (!cleanCode) return;
  if (cleanCode === lastProcessedBarcode) return;
  lastProcessedBarcode = cleanCode;
  setTimeout(function() { lastProcessedBarcode = ''; }, 800);

  const product = state.products.find(function(p) {
    return normalizeBarcode(p.barcode) === cleanCode;
  });

  if (!product) {
    playBeep(false);
    showNotification('الباركود غير مطابق لأي منتج', 'error');
    return;
  }

  if (Number(product.stock) <= 0) {
    playBeep(false);
    showNotification('المنتج نفذ من المخزن!', 'error');
    return;
  }

  // إضافة للفاتورة
  const existing = state.cart.find(function(item) { return item.id === product.id; });
  if (existing) {
    if (existing.qty + 1 > product.stock) {
      playBeep(false);
      showNotification('الكمية تتجاوز المخزون!', 'error');
      return;
    }
    existing.qty += 1;
  } else {
    state.cart.push({
      id: product.id,
      name: product.name,
      price: product.price,
      cost: product.cost,
      qty: 1
    });
  }

  playBeep(true);
  renderCart();
  showNotification('تمت إضافة: ' + product.name, 'success');
}

/* ============ كاميرا الباركود ============ */
async function openBarcodeScanner() {
  const modal = document.getElementById('barcodeModal');
  if (!modal) return;
  modal.style.display = 'flex';

  if (!('BarcodeDetector' in window)) {
    showNotification('المتصفح لا يدعم المسح المباشر', 'warning');
    return;
  }

  try {
    const formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code', 'itf'];
    const supported = await BarcodeDetector.getSupportedFormats();
    const usableFormats = formats.filter(function(f) { return supported.indexOf(f) !== -1; });
    if (!usableFormats.length) throw new Error('لا توجد صيغ مدعومة');

    barcodeDetector = new BarcodeDetector({ formats: usableFormats });
    barcodeStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false
    });

    const video = document.getElementById('barcodeVideo');
    video.srcObject = barcodeStream;
    await video.play();

    const scan = async function() {
      if (!barcodeStream) return;
      try {
        const codes = await barcodeDetector.detect(video);
        if (codes.length && codes[0].rawValue) {
          const code = codes[0].rawValue;
          closeBarcodeScanner();
          processBarcodeNow(code);
          return;
        }
      } catch (e) {}
      barcodeScanFrame = requestAnimationFrame(scan);
    };
    scan();
  } catch (e) {
    showNotification('تعذر تشغيل الكاميرا: ' + (e.message || ''), 'error');
    closeBarcodeScanner();
  }
}

function closeBarcodeScanner() {
  if (barcodeScanFrame) cancelAnimationFrame(barcodeScanFrame);
  barcodeScanFrame = null;
  if (barcodeStream) {
    barcodeStream.getTracks().forEach(function(t) { t.stop(); });
    barcodeStream = null;
  }
  const video = document.getElementById('barcodeVideo');
  if (video) video.srcObject = null;
  const modal = document.getElementById('barcodeModal');
  if (modal) modal.style.display = 'none';
}

/* ============ حفظ / تحميل الإعدادات ============ */
function loadStoreSettings() {
  const s = state.storeSettings || {};
  const set = function(id, val) { const el = document.getElementById(id); if (el) el.value = val || ''; };
  set('storeName', s.name);
  set('storePhone', s.phone);
  set('storeAddress', s.address);
  set('storeTaxNumber', s.taxNumber);
  set('storeCurrency', s.currency);
  const preview = document.getElementById('storeLogoPreview');
  if (preview && s.logo) { preview.src = s.logo; preview.style.display = 'block'; }
  else if (preview) { preview.style.display = 'none'; }
}

function saveStoreSettings() {
  if (state.role !== 'manager') return showNotification('هذه العملية للمدير فقط', 'warning');
  state.storeSettings.name = (document.getElementById('storeName').value || '').trim() || 'محل جديد';
  state.storeSettings.phone = (document.getElementById('storePhone').value || '').trim();
  state.storeSettings.address = (document.getElementById('storeAddress').value || '').trim();
  state.storeSettings.taxNumber = (document.getElementById('storeTaxNumber').value || '').trim();
  state.storeSettings.currency = (document.getElementById('storeCurrency').value || 'ج.م').trim();

  const titleEl = document.querySelector('.logo-title');
  if (titleEl) titleEl.textContent = state.storeSettings.name;

  saveData();
  showNotification('تم حفظ بيانات المحل');
}

function handleLogoUpload(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (file.size > 500 * 1024) return showNotification('حجم الصورة كبير (حد أقصى 500KB)', 'warning');
  const reader = new FileReader();
  reader.onload = function() {
    state.storeSettings.logo = reader.result;
    const preview = document.getElementById('storeLogoPreview');
    if (preview) { preview.src = reader.result; preview.style.display = 'block'; }
    saveData();
    showNotification('تم رفع الشعار');
  };
  reader.readAsDataURL(file);
}

function removeStoreLogo() {
  if (!confirm('حذف الشعار؟')) return;
  state.storeSettings.logo = '';
  const preview = document.getElementById('storeLogoPreview');
  if (preview) preview.style.display = 'none';
  const input = document.getElementById('storeLogo');
  if (input) input.value = '';
  saveData();
  showNotification('تم حذف الشعار');
}

/* ============ الاشتراك ============ */
function renderSubscription() {
  const el = document.getElementById('subscriptionDetails');
  if (!el) return;
  const s = state.subscription;
  const planNames = { trial: 'تجريبي', basic: 'أساسي', pro: 'احترافي', annual: 'سنوي' };
  const statusNames = { active: '🟢 فعّال', expired: '🔴 منتهي', pending: '🟡 معلّق' };
  const expiresText = s.expires_at ? new Date(s.expires_at).toLocaleDateString('ar-EG') : '—';
  el.innerHTML =
    '<p>الخطة: <b>' + (planNames[s.plan] || s.plan) + '</b></p>' +
    '<p>الحالة: <b>' + (statusNames[s.status] || s.status) + '</b></p>' +
    '<p>تاريخ الانتهاء: <b>' + expiresText + '</b></p>';
}

/* ============ حفظ البيانات ============ */
function saveData() {
  if (!state.currentUser) return;
  const key = 'pos_cache_' + state.currentUser.id;
  try {
    const cache = {
      products: state.products,
      sales: state.sales,
      customers: state.customers,
      suppliers: state.suppliers,
      expenses: state.expenses,
      stockMoves: state.stockMoves,
      returns: state.returns,
      customerPayments: state.customerPayments,
      purchases: state.purchases,
      shifts: state.shifts,
      currentShift: state.currentShift,
      storeSettings: state.storeSettings
    };
    localStorage.setItem(key, JSON.stringify(cache));
    scheduleSync();
  } catch (e) {}
}

/* ============ المزامنة ============ */
function scheduleSync() {
  if (!state.currentUser || state.role === 'employee') return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(function() { uploadToCloud(); }, 2000);
}

async function uploadToCloud() {
  if (!state.currentUser || isSyncing) return;
  if (state.role === 'employee') return;
  isSyncing = true;
  try {
    const payload = {
      products: state.products,
      sales: state.sales,
      customers: state.customers,
      suppliers: state.suppliers,
      expenses: state.expenses,
      stockMoves: state.stockMoves,
      returns: state.returns,
      customerPayments: state.customerPayments,
      purchases: state.purchases,
      shifts: state.shifts,
      currentShift: state.currentShift,
      storeSettings: state.storeSettings
    };
    const result = await supabaseClient
      .from('shop_data')
      .upsert({
        user_id: state.currentUser.id,
        shop_data: payload,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });
    if (result.error) throw result.error;
  } catch (e) {
    console.warn('Cloud sync failed:', e.message);
  } finally {
    isSyncing = false;
  }
}

async function syncNow() {
  if (!state.currentUser) return showNotification('سجّل الدخول أولاً', 'warning');
  showLoading('جارٍ المزامنة...');
  try {
    await uploadToCloud();
    showNotification('تمت المزامنة بنجاح ✅');
  } catch (e) {
    showNotification('تعذرت المزامنة', 'error');
  } finally {
    hideLoading();
  }
}

/* ============ التشغيل ============ */
window.onload = function() {
  initAudio();
  setupEventListeners();
  startAuth();
};

function setupEventListeners() {
  // اختصارات لوحة المفاتيح
  window.addEventListener('keydown', function(e) {
    if (e.key === 'F2') { e.preventDefault(); showPage('sales'); }
    if (e.key === 'F4') {
      e.preventDefault();
      showPage('sales');
      const bc = document.getElementById('saleBarcode');
      if (bc) bc.focus();
    }
    if (e.key === 'F8') { e.preventDefault(); if (typeof clearCart === 'function') clearCart(); }
    if (e.key === 'F9') { e.preventDefault(); if (typeof completeSale === 'function') completeSale(); }
  });

  // الباركود
  setupBarcodeListener();

  // شعار المحل
  const logoInput = document.getElementById('storeLogo');
  if (logoInput) logoInput.addEventListener('change', handleLogoUpload);

  // تواريخ اليوم الافتراضية
  const expDate = document.getElementById('expenseDate');
  if (expDate) expDate.value = today();
  const custPayDate = document.getElementById('customerPaymentDate');
  if (custPayDate) custPayDate.value = today();
}

/* ============ Online Sync ============ */
window.addEventListener('online', function() {
  if (state.currentUser && state.role === 'manager') syncNow();
});

/* ============ تحديث كل الواجهات ============ */
function renderAll() {
  renderDashboard();
  renderProducts();
  renderSales();
  renderCustomers();
  renderCustomerPayments();
  renderSuppliers();
  renderPurchases();
  renderExpenses();
  renderReturns();
  renderStockMoves();
  renderReports();
  renderShifts();
  updateStockBadge();
}

function updateStockBadge() {
  const lowCount = state.products.filter(function(p) {
    return Number(p.stock) <= Number(p.minStock || 5);
  }).length;
  const badge = document.getElementById('stockAlertBadge');
  if (badge) {
    badge.innerText = lowCount > 0 ? lowCount : '';
    badge.style.cssText = lowCount > 0
      ? 'display:inline-block;background:#c0392b;color:#fff;border-radius:10px;padding:1px 7px;font-size:11px;margin-right:5px'
      : 'display:none';
  }
}

/* ============ نهاية الجزء 1 ============ */
/* ==========================================================
   الجزء 2: المبيعات + المخزون + العملاء + الموردين + التقارير
   ========================================================== */

/* ----------------- 1. المبيعات ----------------- */

function populateSalesDropdowns() {
  const prodSelect = document.getElementById('saleProduct');
  const custSelect = document.getElementById('saleCustomer');
  if (!prodSelect || !custSelect) return;

  prodSelect.innerHTML = '<option value="">-- اختر منتج --</option>';
  state.products.forEach(function(p) {
    prodSelect.innerHTML += '<option value="' + p.id + '">' + escapeHTML(p.name) + ' (مخزن: ' + p.stock + ') - ' + p.price + ' ' + state.storeSettings.currency + '</option>';
  });

  custSelect.innerHTML = '';
  state.customers.forEach(function(c) {
    custSelect.innerHTML += '<option value="' + c.id + '">' + escapeHTML(c.name) + '</option>';
  });
}

function addToCartManual() {
  const prodId = document.getElementById('saleProduct').value;
  const qty = parseInt(document.getElementById('saleQty').value) || 1;
  if (!prodId) return showNotification('اختر منتجاً أولاً', 'error');

  const product = state.products.find(function(p) { return p.id === prodId; });
  if (!product) return;
  if (qty > product.stock) return showNotification('الكمية تتجاوز المخزون!', 'error');

  const existing = state.cart.find(function(item) { return item.id === product.id; });
  if (existing) {
    if (existing.qty + qty > product.stock) return showNotification('الكمية تتجاوز المخزون!', 'error');
    existing.qty += qty;
  } else {
    state.cart.push({ id: product.id, name: product.name, price: product.price, cost: product.cost, qty: qty });
  }
  document.getElementById('saleQty').value = 1;
  playBeep(true);
  renderCart();
}

function renderCart() {
  const container = document.getElementById('cartTable');
  if (!container) return;

  if (state.cart.length === 0) {
    container.innerHTML = '<p class="text-muted">سلة المبيعات فارغة.</p>';
    const t = document.getElementById('cartTotal');
    if (t) t.innerText = 'إجمالي الفاتورة: 0.00 ' + state.storeSettings.currency;
    return;
  }

  let html = '<div class="table-wrap"><table class="data-table"><thead><tr><th>الصنف</th><th>السعر</th><th>الكمية</th><th>الإجمالي</th><th>إجراء</th></tr></thead><tbody>';
  let subtotal = 0;
  state.cart.forEach(function(item, idx) {
    const tot = item.price * item.qty;
    subtotal += tot;
    html += '<tr>' +
      '<td>' + escapeHTML(item.name) + '</td>' +
      '<td>' + item.price + '</td>' +
      '<td><input type="number" min="1" value="' + item.qty + '" style="width:70px" onchange="updateCartQty(' + idx + ', this.value)"></td>' +
      '<td>' + tot.toFixed(2) + '</td>' +
      '<td><button class="small-btn red" onclick="removeFromCart(' + idx + ')">حذف</button></td>' +
      '</tr>';
  });
  html += '</tbody></table></div>';
  container.innerHTML = html;

  const discVal = parseFloat(document.getElementById('saleDiscount').value) || 0;
  const discType = document.getElementById('saleDiscountType').value;
  const discountAmount = discType === 'percent' ? (subtotal * discVal / 100) : discVal;
  const finalTotal = Math.max(0, subtotal - discountAmount);

  const t = document.getElementById('cartTotal');
  if (t) t.innerText = 'إجمالي الفاتورة: ' + finalTotal.toFixed(2) + ' ' + state.storeSettings.currency + ' (خصم: ' + discountAmount.toFixed(2) + ')';
}

function updateCartQty(idx, val) {
  const q = parseInt(val) || 1;
  const item = state.cart[idx];
  const prod = state.products.find(function(p) { return p.id === item.id; });
  if (prod && q > prod.stock) {
    showNotification('الكمية تتجاوز المخزون!', 'error');
    renderCart();
    return;
  }
  state.cart[idx].qty = q;
  renderCart();
}

function removeFromCart(idx) {
  state.cart.splice(idx, 1);
  renderCart();
}

function clearCart() {
  state.cart = [];
  const d = document.getElementById('saleDiscount'); if (d) d.value = 0;
  const p = document.getElementById('salePaid'); if (p) p.value = 0;
  const n = document.getElementById('saleNotes'); if (n) n.value = '';
  renderCart();
}

function completeSale() {
  if (state.cart.length === 0) {
    playBeep(false);
    return showNotification('السلة فارغة!', 'error');
  }

  const subtotal = state.cart.reduce(function(sum, i) { return sum + i.price * i.qty; }, 0);
  const discVal = parseFloat(document.getElementById('saleDiscount').value) || 0;
  const discType = document.getElementById('saleDiscountType').value;
  const discountAmount = discType === 'percent' ? (subtotal * discVal / 100) : discVal;
  const total = Math.max(0, subtotal - discountAmount);

  const paid = parseFloat(document.getElementById('salePaid').value) || total;
  const customerId = document.getElementById('saleCustomer').value;
  const payMethod = document.getElementById('salePayMethod').value;
  const notes = document.getElementById('saleNotes').value.trim();

  // بدء وردية تلقائية لو مفيش وردية مفتوحة
  if (!state.currentShift) {
    state.currentShift = {
      id: uid('SHIFT'),
      name: 'وردية تلقائية - ' + new Date().toLocaleDateString('ar-EG'),
      cashierName: state.currentUser ? state.currentUser.email : '',
      startTime: new Date().toISOString(),
      startSaleCount: state.sales.length
    };
  }

  // خصم المخزون
  state.cart.forEach(function(item) {
    const prod = state.products.find(function(p) { return p.id === item.id; });
    if (prod) {
      const before = prod.stock;
      prod.stock -= item.qty;
      state.stockMoves.unshift({
        id: uid('SM'),
        date: new Date().toISOString(),
        productId: prod.id,
        productName: prod.name,
        type: 'out',
        qty: item.qty,
        oldStock: before,
        newStock: prod.stock,
        reason: 'بيع'
      });
    }
  });

  const saleObj = {
    id: 'INV-' + Date.now().toString().slice(-8),
    date: new Date().toISOString(),
    items: JSON.parse(JSON.stringify(state.cart)),
    subtotal: subtotal,
    discount: discountAmount,
    total: total,
    paid: paid,
    remaining: Math.max(0, total - paid),
    customerId: customerId,
    payMethod: payMethod,
    notes: notes,
    cashier: state.currentUser ? state.currentUser.email : '',
    shiftId: state.currentShift ? state.currentShift.id : null
  };

  state.sales.unshift(saleObj);

  if (saleObj.remaining > 0 && customerId) {
    const cust = state.customers.find(function(c) { return c.id === customerId; });
    if (cust) cust.openingDebt = (cust.openingDebt || 0) + saleObj.remaining;
  }

  saveData();
  playBeep(true);
  showNotification('تم حفظ الفاتورة بنجاح ✅');

  printInvoice(saleObj);
  clearCart();
  renderSales();
  renderDashboard();
  updateStockBadge();
  renderProducts();
  renderStockMoves();
  renderShifts();
}

function renderSales() {
  const container = document.getElementById('salesTable');
  if (!container) return;

  const searchInput = document.getElementById('salesSearch');
  const fromInput = document.getElementById('salesFrom');
  const toInput = document.getElementById('salesTo');
  const search = (searchInput ? searchInput.value : '').toLowerCase();
  const from = fromInput ? fromInput.value : '';
  const to = toInput ? toInput.value : '';

  const filtered = state.sales.filter(function(s) {
    const cust = state.customers.find(function(c) { return c.id === s.customerId; });
    const haystack = (s.id + ' ' + (cust ? cust.name : '') + ' ' + (s.notes || '')).toLowerCase();
    const matchSearch = haystack.indexOf(search) !== -1;
    const sDate = (s.date || '').split('T')[0];
    let matchDate = true;
    if (from && sDate < from) matchDate = false;
    if (to && sDate > to) matchDate = false;
    return matchSearch && matchDate;
  });

  if (filtered.length === 0) {
    container.innerHTML = '<p class="text-muted">لا توجد فواتير مسجلة.</p>';
    return;
  }

  let html = '<div class="table-wrap"><table class="data-table"><thead><tr><th>رقم الفاتورة</th><th>التاريخ</th><th>العميل</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th><th>طريقة الدفع</th><th>إجراء</th></tr></thead><tbody>';
  filtered.forEach(function(s) {
    const cust = state.customers.find(function(c) { return c.id === s.customerId; });
    html += '<tr>' +
      '<td>' + escapeHTML(s.id) + '</td>' +
      '<td>' + new Date(s.date).toLocaleString('ar-EG') + '</td>' +
      '<td>' + (cust ? escapeHTML(cust.name) : 'نقدي') + '</td>' +
      '<td>' + s.total.toFixed(2) + '</td>' +
      '<td>' + s.paid.toFixed(2) + '</td>' +
      '<td class="' + (s.remaining > 0 ? 'red-text' : '') + '">' + s.remaining.toFixed(2) + '</td>' +
      '<td>' + escapeHTML(s.payMethod) + '</td>' +
      '<td>' +
        '<button class="small-btn primary" onclick="printInvoiceById(\'' + s.id + '\')">طباعة</button>' +
        '<button class="small-btn red" onclick="deleteSale(\'' + s.id + '\')">حذف</button>' +
      '</td>' +
      '</tr>';
  });
  html += '</tbody></table></div>';
  container.innerHTML = html;
}

function deleteSale(id) {
  if (state.role !== 'manager') return showNotification('هذه العملية للمدير فقط', 'warning');
  if (!confirm('حذف الفاتورة وإرجاع الكميات للمخزن؟')) return;
  const idx = state.sales.findIndex(function(s) { return s.id === id; });
  if (idx === -1) return;
  const s = state.sales[idx];
  s.items.forEach(function(item) {
    const prod = state.products.find(function(p) { return p.id === item.id; });
    if (prod) {
      const before = prod.stock;
      prod.stock += item.qty;
      state.stockMoves.unshift({
        id: uid('SM'),
        date: new Date().toISOString(),
        productId: prod.id,
        productName: prod.name,
        type: 'in',
        qty: item.qty,
        oldStock: before,
        newStock: prod.stock,
        reason: 'حذف فاتورة ' + s.id
      });
    }
  });
  state.sales.splice(idx, 1);
  saveData();
  renderSales();
  renderProducts();
  renderStockMoves();
  updateStockBadge();
  showNotification('تم حذف الفاتورة');
}

/* ----------------- 2. المنتجات والمخزون ----------------- */

function saveProduct() {
  if (state.role !== 'manager') return showNotification('هذه العملية للمدير فقط', 'warning');

  const id = document.getElementById('productId').value;
  const name = document.getElementById('productName').value.trim();
  const barcode = document.getElementById('productBarcode').value.trim();
  const category = document.getElementById('productCategory').value.trim();
  const price = parseFloat(document.getElementById('productPrice').value) || 0;
  const cost = parseFloat(document.getElementById('productCost').value) || 0;
  const stock = parseInt(document.getElementById('productStock').value) || 0;
  const minStock = parseInt(document.getElementById('productMin').value) || 5;

  if (!name) return showNotification('اسم المنتج مطلوب', 'error');
  if (price < 0 || cost < 0 || stock < 0 || minStock < 0) return showNotification('القيم لا يمكن أن تكون سالبة', 'error');

  if (id) {
    const prod = state.products.find(function(p) { return p.id === id; });
    if (prod) {
      const oldStock = prod.stock;
      prod.name = name;
      prod.barcode = barcode;
      prod.category = category;
      prod.price = price;
      prod.cost = cost;
      prod.stock = stock;
      prod.minStock = minStock;
      if (oldStock !== stock) {
        state.stockMoves.unshift({
          id: uid('SM'), date: new Date().toISOString(),
          productId: prod.id, productName: prod.name,
          type: stock > oldStock ? 'in' : 'out',
          qty: Math.abs(stock - oldStock),
          oldStock: oldStock, newStock: stock,
          reason: 'تعديل بيانات المنتج'
        });
      }
    }
  } else {
    const newProd = { id: uid('PRD'), name: name, barcode: barcode, category: category, price: price, cost: cost, stock: stock, minStock: minStock };
    state.products.push(newProd);
    if (stock > 0) {
      state.stockMoves.unshift({
        id: uid('SM'), date: new Date().toISOString(),
        productId: newProd.id, productName: newProd.name,
        type: 'in', qty: stock, oldStock: 0, newStock: stock,
        reason: 'رصيد افتتاحي'
      });
    }
  }

  saveData();
  clearProductForm();
  renderProducts();
  renderDashboard();
  updateStockBadge();
  showNotification('تم حفظ المنتج ✅');
}

function clearProductForm() {
  ['productId', 'productName', 'productBarcode', 'productCategory', 'productPrice', 'productCost', 'productStock'].forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const min = document.getElementById('productMin');
  if (min) min.value = 5;
  const title = document.getElementById('productFormTitle');
  if (title) title.innerText = 'إضافة منتج جديد';
}

function renderProducts() {
  const container = document.getElementById('productsTable');
  if (!container) return;

  const searchEl = document.getElementById('productSearch');
  const search = (searchEl ? searchEl.value : '').toLowerCase();

  const filtered = state.products.filter(function(p) {
    return (p.name || '').toLowerCase().indexOf(search) !== -1 ||
      (p.barcode && String(p.barcode).indexOf(search) !== -1) ||
      (p.category && p.category.toLowerCase().indexOf(search) !== -1);
  });

  if (filtered.length === 0) {
    container.innerHTML = '<p class="text-muted">لا توجد منتجات.</p>';
    return;
  }

  let html = '<div class="table-wrap"><table class="data-table"><thead><tr><th>الاسم</th><th>الباركود</th><th>التصنيف</th><th>السعر</th><th>التكلفة</th><th>المخزن</th><th>إجراء</th></tr></thead><tbody>';
  filtered.forEach(function(p) {
    const isLow = Number(p.stock) <= Number(p.minStock || 5);
    html += '<tr' + (isLow ? ' style="background:#fff4d9"' : '') + '>' +
      '<td>' + escapeHTML(p.name) + (isLow ? ' ⚠️' : '') + '</td>' +
      '<td>' + escapeHTML(p.barcode || '-') + '</td>' +
      '<td>' + escapeHTML(p.category || '-') + '</td>' +
      '<td>' + p.price + '</td>' +
      '<td>' + p.cost + '</td>' +
      '<td><b>' + p.stock + '</b></td>' +
      '<td>' +
        '<button class="small-btn primary" onclick="editProduct(\'' + p.id + '\')">تعديل</button>' +
        '<button class="small-btn red" onclick="deleteProduct(\'' + p.id + '\')">حذف</button>' +
      '</td>' +
      '</tr>';
  });
  html += '</tbody></table></div>';
  container.innerHTML = html;
}

function editProduct(id) {
  if (state.role !== 'manager') return showNotification('هذه العملية للمدير فقط', 'warning');
  const p = state.products.find(function(item) { return item.id === id; });
  if (!p) return;
  document.getElementById('productId').value = p.id;
  document.getElementById('productName').value = p.name || '';
  document.getElementById('productBarcode').value = p.barcode || '';
  document.getElementById('productCategory').value = p.category || '';
  document.getElementById('productPrice').value = p.price || 0;
  document.getElementById('productCost').value = p.cost || 0;
  document.getElementById('productStock').value = p.stock || 0;
  document.getElementById('productMin').value = p.minStock || 5;
  const title = document.getElementById('productFormTitle');
  if (title) title.innerText = 'تعديل: ' + p.name;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function deleteProduct(id) {
  if (state.role !== 'manager') return showNotification('هذه العملية للمدير فقط', 'warning');
  if (!confirm('حذف المنتج نهائياً؟')) return;
  state.products = state.products.filter(function(p) { return p.id !== id; });
  saveData();
  renderProducts();
  renderDashboard();
  updateStockBadge();
  showNotification('تم حذف المنتج');
}

function populateAdjustDropdown() {
  const sel = document.getElementById('adjustProduct');
  if (!sel) return;
  sel.innerHTML = '<option value="">-- اختر المنتج --</option>';
  state.products.forEach(function(p) {
    sel.innerHTML += '<option value="' + p.id + '">' + escapeHTML(p.name) + ' (المتوفر: ' + p.stock + ')</option>';
  });
}

function saveStockAdjustment() {
  if (state.role !== 'manager') return showNotification('هذه العملية للمدير فقط', 'warning');

  const prodId = document.getElementById('adjustProduct').value;
  const type = document.getElementById('adjustType').value;
  const qty = parseInt(document.getElementById('adjustQty').value);
  const reason = document.getElementById('adjustReason').value.trim();

  if (!prodId || isNaN(qty) || qty < 0 || !reason) return showNotification('أكمل بيانات الحركة والسبب', 'error');

  const prod = state.products.find(function(p) { return p.id === prodId; });
  if (!prod) return;

  const oldStock = prod.stock;
  let newStock = oldStock;
  if (type === 'in') newStock = oldStock + qty;
  if (type === 'out') newStock = Math.max(0, oldStock - qty);
  if (type === 'set') newStock = qty;

  if (newStock === oldStock) return showNotification('الكمية مطابقة للحالية', 'info');

  prod.stock = newStock;
  state.stockMoves.unshift({
    id: uid('SM'), date: new Date().toISOString(),
    productId: prod.id, productName: prod.name,
    type: type, qty: Math.abs(newStock - oldStock),
    oldStock: oldStock, newStock: newStock, reason: reason
  });

  saveData();
  document.getElementById('adjustQty').value = '';
  document.getElementById('adjustReason').value = '';
  renderStockMoves();
  renderProducts();
  renderDashboard();
  updateStockBadge();
  showNotification('تم تسجيل الحركة ✅');
}

function renderStockMoves() {
  const container = document.getElementById('stockMovesTable');
  if (!container) return;

  const searchEl = document.getElementById('moveSearch');
  const search = (searchEl ? searchEl.value : '').toLowerCase();

  const filtered = state.stockMoves.filter(function(m) {
    return (m.productName || '').toLowerCase().indexOf(search) !== -1 ||
      (m.reason || '').toLowerCase().indexOf(search) !== -1;
  });

  if (filtered.length === 0) {
    container.innerHTML = '<p class="text-muted">لا توجد حركات مسجلة.</p>';
    return;
  }

  let html = '<div class="table-wrap"><table class="data-table"><thead><tr><th>التاريخ</th><th>المنتج</th><th>الحركة</th><th>الكمية</th><th>قبل ➔ بعد</th><th>السبب</th></tr></thead><tbody>';
  filtered.forEach(function(m) {
    const label = m.type === 'in' ? 'إضافة (+)' : (m.type === 'out' ? 'خصم (-)' : 'ضبط (=)');
    html += '<tr>' +
      '<td>' + new Date(m.date).toLocaleString('ar-EG') + '</td>' +
      '<td>' + escapeHTML(m.productName) + '</td>' +
      '<td>' + label + '</td>' +
      '<td>' + m.qty + '</td>' +
      '<td>' + m.oldStock + ' ➔ ' + m.newStock + '</td>' +
      '<td>' + escapeHTML(m.reason) + '</td>' +
      '</tr>';
  });
  html += '</tbody></table></div>';
  container.innerHTML = html;
}

/* ----------------- 3. المرتجعات ----------------- */

function populateReturnDropdowns() {
  const saleSel = document.getElementById('returnSale');
  if (!saleSel) return;
  saleSel.innerHTML = '<option value="">-- اختر الفاتورة --</option>';
  state.sales.forEach(function(s) {
    saleSel.innerHTML += '<option value="' + s.id + '">فاتورة: ' + s.id + ' (' + s.total.toFixed(2) + ' ' + state.storeSettings.currency + ')</option>';
  });
}

function updateReturnProducts() {
  const saleId = document.getElementById('returnSale').value;
  const prodSel = document.getElementById('returnProduct');
  if (!prodSel) return;
  prodSel.innerHTML = '<option value="">-- اختر الصنف --</option>';
  const sale = state.sales.find(function(s) { return s.id === saleId; });
  if (!sale) return;

  sale.items.forEach(function(i) {
    const alreadyReturned = state.returns
      .filter(function(r) { return r.saleId === saleId && r.productId === i.id; })
      .reduce(function(sum, r) { return sum + r.qty; }, 0);
    const remaining = i.qty - alreadyReturned;
    if (remaining > 0) {
      prodSel.innerHTML += '<option value="' + i.id + '">' + escapeHTML(i.name) + ' (متبقي: ' + remaining + ')</option>';
    }
  });
}

function saveReturn() {
  if (state.role !== 'manager') return showNotification('هذه العملية للمدير فقط', 'warning');

  const saleId = document.getElementById('returnSale').value;
  const prodId = document.getElementById('returnProduct').value;
  const qty = parseInt(document.getElementById('returnQty').value) || 1;
  const reason = document.getElementById('returnReason').value.trim();

  if (!saleId || !prodId) return showNotification('اختر الفاتورة والصنف', 'error');
  if (qty < 1) return showNotification('كمية غير صحيحة', 'error');

  const sale = state.sales.find(function(s) { return s.id === saleId; });
  const item = sale ? sale.items.find(function(i) { return i.id === prodId; }) : null;
  if (!item) return showNotification('الصنف غير موجود', 'error');

  const alreadyReturned = state.returns
    .filter(function(r) { return r.saleId === saleId && r.productId === prodId; })
    .reduce(function(sum, r) { return sum + r.qty; }, 0);

  if (qty > item.qty - alreadyReturned) return showNotification('الكمية أكبر من المتبقي', 'error');

  const prod = state.products.find(function(p) { return p.id === prodId; });
  if (prod) {
    const before = prod.stock;
    prod.stock += qty;
    state.stockMoves.unshift({
      id: uid('SM'), date: new Date().toISOString(),
      productId: prod.id, productName: prod.name,
      type: 'in', qty: qty, oldStock: before, newStock: prod.stock,
      reason: 'مرتجع فاتورة ' + saleId
    });
  }

  state.returns.unshift({
    id: uid('RET'), date: new Date().toISOString(),
    saleId: saleId, productId: prodId,
    productName: item.name, qty: qty,
    reason: reason || 'غير محدد'
  });

  saveData();
  document.getElementById('returnQty').value = 1;
  document.getElementById('returnReason').value = '';
  renderReturns();
  renderProducts();
  renderStockMoves();
  renderDashboard();
  updateStockBadge();
  showNotification('تم تسجيل المرتجع ✅');
}

function renderReturns() {
  const container = document.getElementById('returnsTable');
  if (!container) return;
  if (state.returns.length === 0) {
    container.innerHTML = '<p class="text-muted">لا توجد مرتجعات.</p>';
    return;
  }
  let html = '<div class="table-wrap"><table class="data-table"><thead><tr><th>التاريخ</th><th>رقم الفاتورة</th><th>الصنف</th><th>الكمية</th><th>السبب</th></tr></thead><tbody>';
  state.returns.forEach(function(r) {
    html += '<tr>' +
      '<td>' + new Date(r.date).toLocaleString('ar-EG') + '</td>' +
      '<td>' + escapeHTML(r.saleId) + '</td>' +
      '<td>' + escapeHTML(r.productName) + '</td>' +
      '<td>' + r.qty + '</td>' +
      '<td>' + escapeHTML(r.reason) + '</td>' +
      '</tr>';
  });
  html += '</tbody></table></div>';
  container.innerHTML = html;
}

/* ----------------- 4. العملاء ----------------- */

function saveCustomer() {
  if (state.role !== 'manager') return showNotification('هذه العملية للمدير فقط', 'warning');

  const id = document.getElementById('customerId').value;
  const name = document.getElementById('customerName').value.trim();
  const phone = document.getElementById('customerPhone').value.trim();
  const openingDebt = parseFloat(document.getElementById('customerOpeningDebt').value) || 0;

  if (!name) return showNotification('اسم العميل مطلوب', 'error');
  if (openingDebt < 0) return showNotification('الرصيد لا يمكن أن يكون سالباً', 'error');

  const dup = state.customers.find(function(c) {
    return c.name.trim().toLowerCase() === name.toLowerCase() && c.id !== id;
  });
  if (dup) return showNotification('يوجد عميل بنفس الاسم', 'warning');

  if (id) {
    const c = state.customers.find(function(item) { return item.id === id; });
    if (c) { c.name = name; c.phone = phone; c.openingDebt = openingDebt; }
  } else {
    state.customers.push({ id: uid('CUST'), name: name, phone: phone, openingDebt: openingDebt });
  }

  saveData();
  ['customerId', 'customerName', 'customerPhone'].forEach(function(i) {
    const el = document.getElementById(i);
    if (el) el.value = '';
  });
  const d = document.getElementById('customerOpeningDebt');
  if (d) d.value = 0;
  renderCustomers();
  showNotification('تم حفظ العميل ✅');
}

function renderCustomers() {
  const container = document.getElementById('customersTable');
  if (!container) return;

  const searchEl = document.getElementById('customerSearch');
  const search = (searchEl ? searchEl.value : '').toLowerCase();

  const filtered = state.customers.filter(function(c) {
    return (c.name || '').toLowerCase().indexOf(search) !== -1 ||
      (c.phone || '').indexOf(search) !== -1;
  });

  const paySel = document.getElementById('customerPaymentCustomer');
  if (paySel) {
    const currentVal = paySel.value;
    paySel.innerHTML = '';
    state.customers.forEach(function(c) {
      paySel.innerHTML += '<option value="' + c.id + '">' + escapeHTML(c.name) + ' (دين: ' + (c.openingDebt || 0).toFixed(2) + ')</option>';
    });
    if (currentVal) paySel.value = currentVal;
  }

  if (filtered.length === 0) {
    container.innerHTML = '<p class="text-muted">لا يوجد عملاء.</p>';
    return;
  }

  let html = '<div class="table-wrap"><table class="data-table"><thead><tr><th>الاسم</th><th>الهاتف</th><th>الديون</th><th>إجراء</th></tr></thead><tbody>';
  filtered.forEach(function(c) {
    const debtClass = (c.openingDebt || 0) > 0 ? 'red-text' : '';
    html += '<tr>' +
      '<td>' + escapeHTML(c.name) + '</td>' +
      '<td>' + escapeHTML(c.phone || '-') + '</td>' +
      '<td class="' + debtClass + '"><b>' + (c.openingDebt || 0).toFixed(2) + '</b></td>' +
      '<td><button class="small-btn red" onclick="deleteCustomer(\'' + c.id + '\')">حذف</button></td>' +
      '</tr>';
  });
  html += '</tbody></table></div>';
  container.innerHTML = html;
}

function deleteCustomer(id) {
  if (state.role !== 'manager') return showNotification('هذه العملية للمدير فقط', 'warning');
  if (state.customers.length <= 1) return showNotification('لا يمكن حذف آخر عميل', 'warning');
  const hasSales = state.sales.some(function(s) { return s.customerId === id; });
  const hasPayments = state.customerPayments.some(function(p) { return p.customerId === id; });
  if (hasSales || hasPayments) return showNotification('العميل مرتبط بمعاملات', 'warning');
  if (!confirm('حذف العميل؟')) return;
  state.customers = state.customers.filter(function(c) { return c.id !== id; });
  saveData();
  renderCustomers();
  showNotification('تم الحذف');
}

function recordCustomerPayment() {
  if (state.role !== 'manager') return showNotification('هذه العملية للمدير فقط', 'warning');

  const customerId = document.getElementById('customerPaymentCustomer').value;
  const amount = parseFloat(document.getElementById('customerPaymentAmount').value);
  const date = document.getElementById('customerPaymentDate').value || today();
  const notes = document.getElementById('customerPaymentNotes').value.trim();

  if (!customerId || isNaN(amount) || amount <= 0) return showNotification('أدخل مبلغاً صحيحاً', 'error');

  const cust = state.customers.find(function(c) { return c.id === customerId; });
  if (!cust) return showNotification('العميل غير موجود', 'error');
  if (amount > (cust.openingDebt || 0)) return showNotification('المبلغ أكبر من الدين المستحق', 'warning');

  cust.openingDebt = Math.max(0, (cust.openingDebt || 0) - amount);

  state.customerPayments.unshift({
    id: uid('CP'), customerId: customerId, customerName: cust.name,
    amount: amount, date: date, notes: notes
  });

  saveData();
  document.getElementById('customerPaymentAmount').value = '';
  document.getElementById('customerPaymentNotes').value = '';
  renderCustomers();
  renderCustomerPayments();
  showNotification('تم تسجيل التحصيل ✅');
}

function renderCustomerPayments() {
  const container = document.getElementById('customerPaymentsTable');
  if (!container) return;
  if (state.customerPayments.length === 0) {
    container.innerHTML = '<p class="text-muted">لا توجد تحصيلات مسجلة.</p>';
    return;
  }
  let html = '<div class="table-wrap"><table class="data-table"><thead><tr><th>التاريخ</th><th>العميل</th><th>المبلغ</th><th>ملاحظات</th></tr></thead><tbody>';
  state.customerPayments.forEach(function(p) {
    html += '<tr>' +
      '<td>' + escapeHTML(p.date) + '</td>' +
      '<td>' + escapeHTML(p.customerName) + '</td>' +
      '<td><b>' + p.amount.toFixed(2) + '</b></td>' +
      '<td>' + escapeHTML(p.notes || '-') + '</td>' +
      '</tr>';
  });
  html += '</tbody></table></div>';
  container.innerHTML = html;
}

/* ----------------- 5. الموردين والمشتريات ----------------- */

function saveSupplier() {
  if (state.role !== 'manager') return showNotification('هذه العملية للمدير فقط', 'warning');

  const name = document.getElementById('supplierName').value.trim();
  const phone = document.getElementById('supplierPhone').value.trim();
  const openingDebt = parseFloat(document.getElementById('supplierOpeningDebt').value) || 0;

  if (!name) return showNotification('اسم المورد مطلوب', 'error');
  if (openingDebt < 0) return showNotification('الرصيد لا يمكن أن يكون سالباً', 'error');

  state.suppliers.push({ id: uid('SUP'), name: name, phone: phone, openingDebt: openingDebt });
  saveData();
  document.getElementById('supplierName').value = '';
  document.getElementById('supplierPhone').value = '';
  document.getElementById('supplierOpeningDebt').value = 0;
  renderSuppliers();
  showNotification('تم حفظ المورد ✅');
}

function renderSuppliers() {
  const container = document.getElementById('suppliersTable');
  if (!container) return;

  const purSupSel = document.getElementById('purchaseSupplier');
  if (purSupSel) {
    const curVal = purSupSel.value;
    purSupSel.innerHTML = '<option value="">-- اختر المورد --</option>';
    state.suppliers.forEach(function(s) {
      purSupSel.innerHTML += '<option value="' + s.id + '">' + escapeHTML(s.name) + '</option>';
    });
    if (curVal) purSupSel.value = curVal;
  }

  const purProdSel = document.getElementById('purchaseProduct');
  if (purProdSel) {
    const curVal = purProdSel.value;
    purProdSel.innerHTML = '<option value="">-- اختر منتج موجود --</option>';
    state.products.forEach(function(p) {
      purProdSel.innerHTML += '<option value="' + p.id + '">' + escapeHTML(p.name) + '</option>';
    });
    if (curVal) purProdSel.value = curVal;
  }

  if (state.suppliers.length === 0) {
    container.innerHTML = '<p class="text-muted">لا يوجد موردون.</p>';
    return;
  }

  let html = '<div class="table-wrap"><table class="data-table"><thead><tr><th>الاسم</th><th>الهاتف</th><th>المستحقات</th><th>إجراء</th></tr></thead><tbody>';
  state.suppliers.forEach(function(s) {
    const debtClass = (s.openingDebt || 0) > 0 ? 'red-text' : '';
    html += '<tr>' +
      '<td>' + escapeHTML(s.name) + '</td>' +
      '<td>' + escapeHTML(s.phone || '-') + '</td>' +
      '<td class="' + debtClass + '"><b>' + (s.openingDebt || 0).toFixed(2) + '</b></td>' +
      '<td><button class="small-btn red" onclick="deleteSupplier(\'' + s.id + '\')">حذف</button></td>' +
      '</tr>';
  });
  html += '</tbody></table></div>';
  container.innerHTML = html;
}

function deleteSupplier(id) {
  if (state.role !== 'manager') return showNotification('هذه العملية للمدير فقط', 'warning');
  const hasPurchases = state.purchases.some(function(p) { return p.supplierId === id; });
  if (hasPurchases) return showNotification('المورد مرتبط بمشتريات', 'warning');
  if (!confirm('حذف المورد؟')) return;
  state.suppliers = state.suppliers.filter(function(s) { return s.id !== id; });
  saveData();
  renderSuppliers();
  showNotification('تم الحذف');
}

function savePurchase() {
  if (state.role !== 'manager') return showNotification('هذه العملية للمدير فقط', 'warning');

  const supplierId = document.getElementById('purchaseSupplier').value;
  const prodId = document.getElementById('purchaseProduct').value;
  const newName = document.getElementById('purchaseNewName').value.trim();
  const qty = parseInt(document.getElementById('purchaseQty').value) || 1;
  const cost = parseFloat(document.getElementById('purchaseCost').value) || 0;
  const paid = parseFloat(document.getElementById('purchasePaid').value) || 0;

  if (!supplierId) return showNotification('اختر المورد', 'error');
  if (qty < 1) return showNotification('كمية غير صحيحة', 'error');
  if (cost < 0) return showNotification('التكلفة غير صحيحة', 'error');

  let targetProdId = prodId;
  let targetProdName = '';

  if (prodId) {
    const p = state.products.find(function(item) { return item.id === prodId; });
    if (p) {
      const before = p.stock;
      p.stock += qty;
      p.cost = cost;
      targetProdName = p.name;
      state.stockMoves.unshift({
        id: uid('SM'), date: new Date().toISOString(),
        productId: p.id, productName: p.name,
        type: 'in', qty: qty, oldStock: before, newStock: p.stock,
        reason: 'مشتريات'
      });
    }
  } else if (newName) {
    const newProd = { id: uid('PRD'), name: newName, barcode: '', category: 'عام', price: cost * 1.3, cost: cost, stock: qty, minStock: 5 };
    state.products.push(newProd);
    targetProdId = newProd.id;
    targetProdName = newProd.name;
    state.stockMoves.unshift({
      id: uid('SM'), date: new Date().toISOString(),
      productId: newProd.id, productName: newProd.name,
      type: 'in', qty: qty, oldStock: 0, newStock: qty,
      reason: 'منتج جديد - مشتريات'
    });
  } else {
    return showNotification('اختر منتج موجود أو اكتب اسم جديد', 'error');
  }

  const total = qty * cost;
  const remaining = Math.max(0, total - paid);

  if (remaining > 0) {
    const sup = state.suppliers.find(function(s) { return s.id === supplierId; });
    if (sup) sup.openingDebt = (sup.openingDebt || 0) + remaining;
  }

  state.purchases.unshift({
    id: uid('PUR'), date: new Date().toISOString(),
    supplierId: supplierId, productId: targetProdId, productName: targetProdName,
    qty: qty, cost: cost, total: total, paid: paid, remaining: remaining
  });

  saveData();
  document.getElementById('purchaseNewName').value = '';
  document.getElementById('purchaseQty').value = 1;
  document.getElementById('purchaseCost').value = '';
  document.getElementById('purchasePaid').value = 0;
  renderSuppliers();
  renderPurchases();
  renderProducts();
  renderStockMoves();
  updateStockBadge();
  showNotification('تم تسجيل المشتريات ✅');
}

function renderPurchases() {
  const container = document.getElementById('purchasesTable');
  if (!container) return;
  if (state.purchases.length === 0) {
    container.innerHTML = '<p class="text-muted">لا توجد مشتريات.</p>';
    return;
  }
  let html = '<div class="table-wrap"><table class="data-table"><thead><tr><th>التاريخ</th><th>المورد</th><th>المنتج</th><th>الكمية</th><th>التكلفة</th><th>الإجمالي</th><th>المتبقي</th></tr></thead><tbody>';
  state.purchases.forEach(function(p) {
    const sup = state.suppliers.find(function(s) { return s.id === p.supplierId; });
    html += '<tr>' +
      '<td>' + new Date(p.date).toLocaleString('ar-EG') + '</td>' +
      '<td>' + escapeHTML(sup ? sup.name : '-') + '</td>' +
      '<td>' + escapeHTML(p.productName) + '</td>' +
      '<td>' + p.qty + '</td>' +
      '<td>' + p.cost + '</td>' +
      '<td>' + p.total.toFixed(2) + '</td>' +
      '<td class="' + (p.remaining > 0 ? 'red-text' : '') + '">' + p.remaining.toFixed(2) + '</td>' +
      '</tr>';
  });
  html += '</tbody></table></div>';
  container.innerHTML = html;
}

/* ----------------- 6. المصروفات ----------------- */

function saveExpense() {
  if (state.role !== 'manager') return showNotification('هذه العملية للمدير فقط', 'warning');

  const name = document.getElementById('expenseName').value.trim();
  const amount = parseFloat(document.getElementById('expenseAmount').value);
  const date = document.getElementById('expenseDate').value || today();
  const notes = document.getElementById('expenseNotes').value.trim();

  if (!name || isNaN(amount) || amount <= 0) return showNotification('أدخل البند والمبلغ بشكل صحيح', 'error');

  state.expenses.unshift({ id: uid('EXP'), name: name, amount: amount, date: date, notes: notes });
  saveData();
  document.getElementById('expenseName').value = '';
  document.getElementById('expenseAmount').value = '';
  document.getElementById('expenseNotes').value = '';
  renderExpenses();
  renderDashboard();
  showNotification('تم حفظ المصروف ✅');
}

function renderExpenses() {
  const container = document.getElementById('expensesTable');
  if (!container) return;
  if (state.expenses.length === 0) {
    container.innerHTML = '<p class="text-muted">لا توجد مصروفات.</p>';
    return;
  }
  let html = '<div class="table-wrap"><table class="data-table"><thead><tr><th>التاريخ</th><th>البند</th><th>المبلغ</th><th>ملاحظات</th><th>إجراء</th></tr></thead><tbody>';
  state.expenses.forEach(function(e) {
    html += '<tr>' +
      '<td>' + escapeHTML(e.date) + '</td>' +
      '<td>' + escapeHTML(e.name) + '</td>' +
      '<td><b>' + e.amount.toFixed(2) + '</b></td>' +
      '<td>' + escapeHTML(e.notes || '-') + '</td>' +
      '<td><button class="small-btn red" onclick="deleteExpense(\'' + e.id + '\')">حذف</button></td>' +
      '</tr>';
  });
  html += '</tbody></table></div>';
  container.innerHTML = html;
}

function deleteExpense(id) {
  if (state.role !== 'manager') return showNotification('هذه العملية للمدير فقط', 'warning');
  if (!confirm('حذف المصروف؟')) return;
  state.expenses = state.expenses.filter(function(e) { return e.id !== id; });
  saveData();
  renderExpenses();
  renderDashboard();
  showNotification('تم الحذف');
}

/* ----------------- 7. التقارير ----------------- */

function filterByPeriod(items, dateField, from, to) {
  return items.filter(function(item) {
    const d = (item[dateField] || '').split('T')[0];
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}

function renderReports() {
  const from = (document.getElementById('reportFrom') || {}).value || '';
  const to = (document.getElementById('reportTo') || {}).value || '';

  const filteredSales = filterByPeriod(state.sales, 'date', from, to);
  const filteredExpenses = filterByPeriod(state.expenses, 'date', from, to);
  const filteredReturns = filterByPeriod(state.returns, 'date', from, to);

  const totalSales = filteredSales.reduce(function(sum, s) { return sum + s.total; }, 0);
  const totalDiscount = filteredSales.reduce(function(sum, s) { return sum + (s.discount || 0); }, 0);

  let totalCost = 0;
  filteredSales.forEach(function(s) {
    s.items.forEach(function(i) { totalCost += (i.cost || 0) * i.qty; });
  });

  const totalExpenses = filteredExpenses.reduce(function(sum, e) { return sum + e.amount; }, 0);
  const netProfit = totalSales - totalCost - totalExpenses;
  const avgInvoice = filteredSales.length > 0 ? totalSales / filteredSales.length : 0;

  const cardsContainer = document.getElementById('reportCards');
  if (cardsContainer) {
    cardsContainer.innerHTML =
      '<div class="stat-card"><h3>إجمالي المبيعات</h3><p>' + totalSales.toFixed(2) + ' ' + state.storeSettings.currency + '</p></div>' +
      '<div class="stat-card"><h3>عدد الفواتير</h3><p>' + filteredSales.length + '</p></div>' +
      '<div class="stat-card"><h3>متوسط الفاتورة</h3><p>' + avgInvoice.toFixed(2) + ' ' + state.storeSettings.currency + '</p></div>' +
      '<div class="stat-card"><h3>إجمالي التكلفة</h3><p>' + totalCost.toFixed(2) + ' ' + state.storeSettings.currency + '</p></div>' +
      '<div class="stat-card"><h3>المصروفات</h3><p>' + totalExpenses.toFixed(2) + ' ' + state.storeSettings.currency + '</p></div>' +
      '<div class="stat-card" style="background:linear-gradient(135deg,#c8e5d2,#a9d5bb);border-color:#8ab99f">' +
      '<h3>صافي الربح</h3>' +
      '<p style="color:' + (netProfit >= 0 ? '#17643a' : '#c0392b') + '">' + netProfit.toFixed(2) + ' ' + state.storeSettings.currency + '</p>' +
      '</div>';
  }

  const daily = document.getElementById('dailyReport');
  if (daily) {
    daily.innerHTML =
      '<p>عدد الفواتير: <b>' + filteredSales.length + '</b></p>' +
      '<p>إجمالي الخصومات: <b>' + totalDiscount.toFixed(2) + ' ' + state.storeSettings.currency + '</b></p>' +
      '<p>عدد المرتجعات: <b>' + filteredReturns.length + '</b></p>' +
      '<p>عدد المصروفات: <b>' + filteredExpenses.length + '</b></p>' +
      '<p>إجمالي المرتجعات (كمية): <b>' + filteredReturns.reduce(function(sum, r) { return sum + r.qty; }, 0) + '</b></p>';
  }

  // الأكثر مبيعًا
  const topContainer = document.getElementById('topProductsReport');
  if (topContainer) {
    const salesByProduct = {};
    filteredSales.forEach(function(s) {
      s.items.forEach(function(i) {
        if (!salesByProduct[i.id]) salesByProduct[i.id] = { name: i.name, qty: 0, total: 0 };
        salesByProduct[i.id].qty += i.qty;
        salesByProduct[i.id].total += i.price * i.qty;
      });
    });
    const top = Object.values(salesByProduct).sort(function(a, b) { return b.qty - a.qty; }).slice(0, 10);

    if (top.length === 0) {
      topContainer.innerHTML = '<p class="text-muted">لا توجد مبيعات في الفترة.</p>';
    } else {
      let html = '<div class="table-wrap"><table class="data-table"><thead><tr><th>#</th><th>المنتج</th><th>الكمية</th><th>القيمة</th></tr></thead><tbody>';
      top.forEach(function(t, i) {
        html += '<tr><td>' + (i + 1) + '</td><td>' + escapeHTML(t.name) + '</td><td><b>' + t.qty + '</b></td><td>' + t.total.toFixed(2) + '</td></tr>';
      });
      html += '</tbody></table></div>';
      topContainer.innerHTML = html;
    }
  }
}

function setReportPeriod(period) {
  const end = today();
  const d = new Date(end + 'T12:00:00');
  let from = end;

  if (period === 'today') from = end;
  if (period === 'week') { d.setDate(d.getDate() - 6); from = d.toISOString().slice(0, 10); }
  if (period === 'month') { d.setDate(d.getDate() - 29); from = d.toISOString().slice(0, 10); }
  if (period === 'currentMonth') {
    const now = new Date();
    from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  }
  if (period === 'year') {
    const now = new Date();
    from = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
  }

  document.getElementById('reportFrom').value = from;
  document.getElementById('reportTo').value = end;
  renderReports();
  showNotification('تم تحديث الفترة', 'info');
}

function clearReportPeriod() {
  document.getElementById('reportFrom').value = '';
  document.getElementById('reportTo').value = '';
  renderReports();
}

/* ----------------- 8. الورديات ----------------- */

function calcExpectedShiftCash() {
  const shift = state.currentShift;
  if (!shift) {
    const el = document.getElementById('shiftExpectedCash');
    if (el) el.value = '0.00 ' + state.storeSettings.currency;
    calculateShiftDiff();
    return;
  }

  const shiftStart = new Date(shift.startTime).getTime();
  let cashSales = 0;
  state.sales.forEach(function(s) {
    const saleTime = new Date(s.date).getTime();
    if (saleTime >= shiftStart && s.payMethod === 'cash') {
      cashSales += s.paid;
    }
  });
  const el = document.getElementById('shiftExpectedCash');
  if (el) el.value = cashSales.toFixed(2) + ' ' + state.storeSettings.currency;
  calculateShiftDiff();
}

function calculateShiftDiff() {
  const expEl = document.getElementById('shiftExpectedCash');
  const actEl = document.getElementById('shiftActualCash');
  const diffEl = document.getElementById('shiftDifference');
  if (!expEl || !actEl || !diffEl) return;

  const expected = parseFloat(expEl.value) || 0;
  const actual = parseFloat(actEl.value) || 0;
  const diff = actual - expected;

  if (diff < 0) {
    diffEl.value = diff.toFixed(2) + ' ' + state.storeSettings.currency + ' (عجز ⚠️)';
    diffEl.style.color = '#c62828';
  } else if (diff > 0) {
    diffEl.value = diff.toFixed(2) + ' ' + state.storeSettings.currency + ' (زيادة 🟢)';
    diffEl.style.color = '#2e7d32';
  } else {
    diffEl.value = '0.00 ' + state.storeSettings.currency + ' (مطابق ✅)';
    diffEl.style.color = '#17643a';
  }
}

function closeShift() {
  if (state.role !== 'manager') return showNotification('هذه العملية للمدير فقط', 'warning');

  const cashierName = (document.getElementById('shiftCashierName').value || '').trim();
  if (!cashierName) return showNotification('اكتب اسم الكاشير', 'error');

  const actualCash = parseFloat(document.getElementById('shiftActualCash').value) || 0;
  const notes = (document.getElementById('shiftNotes').value || '').trim();

  if (!state.currentShift) {
    // إنشاء وردية من الصفر لو مفيش
    state.currentShift = {
      id: uid('SHIFT'),
      name: cashierName,
      cashierName: cashierName,
      startTime: new Date().toISOString()
    };
  }

  const shiftStart = new Date(state.currentShift.startTime).getTime();
  const shiftSales = state.sales.filter(function(s) {
    return new Date(s.date).getTime() >= shiftStart;
  });

  const cashSales = shiftSales
    .filter(function(s) { return s.payMethod === 'cash'; })
    .reduce(function(sum, s) { return sum + s.paid; }, 0);

  const totalSales = shiftSales.reduce(function(sum, s) { return sum + s.total; }, 0);

  const closedShift = {
    id: state.currentShift.id,
    name: cashierName,
    cashierName: cashierName,
    startTime: state.currentShift.startTime,
    endTime: new Date().toISOString(),
    saleCount: shiftSales.length,
    totalSales: totalSales,
    cashSales: cashSales,
    actualCash: actualCash,
    difference: actualCash - cashSales,
    notes: notes
  };

  state.shifts.unshift(closedShift);
  state.currentShift = null;

  saveData();

  // مسح الحقول
  document.getElementById('shiftCashierName').value = '';
  document.getElementById('shiftActualCash').value = '';
  document.getElementById('shiftDifference').value = '';
  document.getElementById('shiftNotes').value = '';

  calcExpectedShiftCash();
  renderShifts();
  showNotification('تم إغلاق الوردية وحفظها ✅');

  // عرض التقرير للطباعة
  setTimeout(function() { printShiftReportById(closedShift.id); }, 500);
}

function renderShifts() {
  const container = document.getElementById('shiftsTable');
  if (!container) return;
  if (state.shifts.length === 0) {
    container.innerHTML = '<p class="text-muted">لا توجد ورديات مغلقة.</p>';
    return;
  }
  let html = '<div class="table-wrap"><table class="data-table"><thead><tr><th>التاريخ</th><th>الكاشير</th><th>عدد الفواتير</th><th>الكاش المتوقع</th><th>الكاش الفعلي</th><th>الفرق</th><th>إجراء</th></tr></thead><tbody>';
  state.shifts.forEach(function(s) {
    const diffClass = s.difference < 0 ? 'red-text' : (s.difference > 0 ? 'green-text' : '');
    html += '<tr>' +
      '<td>' + new Date(s.endTime).toLocaleString('ar-EG') + '</td>' +
      '<td>' + escapeHTML(s.cashierName) + '</td>' +
      '<td>' + s.saleCount + '</td>' +
      '<td>' + s.cashSales.toFixed(2) + '</td>' +
      '<td>' + s.actualCash.toFixed(2) + '</td>' +
      '<td class="' + diffClass + '"><b>' + s.difference.toFixed(2) + '</b></td>' +
      '<td><button class="small-btn primary" onclick="printShiftReportById(\'' + s.id + '\')">طباعة</button></td>' +
      '</tr>';
  });
  html += '</tbody></table></div>';
  container.innerHTML = html;
}

function printShiftReportById(id) {
  const s = state.shifts.find(function(x) { return x.id === id; });
  if (!s) return;
  const settings = state.storeSettings;

  const w = window.open('', '_blank');
  if (!w) return showNotification('اسمح بالنوافذ المنبثقة', 'warning');

  const diffText = s.difference < 0 ? 'عجز ⚠️' : (s.difference > 0 ? 'زيادة 🟢' : 'مطابق ✅');

  w.document.write(
    '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>تقرير وردية</title>' +
    '<style>' +
    '*{box-sizing:border-box;margin:0;padding:0}' +
    'body{font-family:Tahoma,Arial,sans-serif;background:#f5f8fa;padding:20px;color:#203447}' +
    '.report{max-width:700px;margin:auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 8px 25px #0002}' +
    '.head{background:linear-gradient(125deg,#142f46,#176b70);color:#fff;padding:22px 28px;text-align:center;border-bottom:4px solid #d6a84f}' +
    '.head h1{margin:0 0 6px;font-size:22px}' +
    '.head p{margin:2px 0;font-size:13px;opacity:.95}' +
    '.body{padding:25px 28px}' +
    '.row{display:flex;justify-content:space-between;padding:11px 0;border-bottom:1px dashed #dce3ec;font-size:15px}' +
    '.row:last-child{border-bottom:0}' +
    '.row b{color:#17364c}' +
    '.total{background:#f8fafb;padding:15px;border-radius:10px;margin-top:15px}' +
    '.sign{padding:20px 28px;text-align:center;background:#f8fafb;border-top:1px solid #dce3ec}' +
    '.sign p{margin:15px 0 5px;color:#687b8b;font-size:13px}' +
    '.sign .line{margin-top:25px;border-top:1px solid #333;width:200px;margin-left:auto;margin-right:auto}' +
    '.actions{max-width:700px;margin:20px auto 0;display:flex;gap:12px;justify-content:center}' +
    '.actions button{padding:12px 24px;border:0;border-radius:10px;font-weight:700;cursor:pointer;font-family:inherit}' +
    '.btn-print{background:#176b70;color:#fff}' +
    '@media print{body{background:#fff;padding:0}.actions{display:none}.report{box-shadow:none}}' +
    '</style></head><body>' +
    '<div class="report">' +
    '<div class="head">' +
    '<h1>' + escapeHTML(settings.name) + '</h1>' +
    (settings.phone ? '<p>📞 ' + escapeHTML(settings.phone) + '</p>' : '') +
    (settings.address ? '<p>📍 ' + escapeHTML(settings.address) + '</p>' : '') +
    '<h2 style="margin-top:12px;font-size:18px">تقرير إغلاق وردية</h2>' +
    '</div>' +
    '<div class="body">' +
    '<div class="row"><span>الوردية:</span><b>' + escapeHTML(s.cashierName) + '</b></div>' +
    '<div class="row"><span>بدأت:</span><b>' + new Date(s.startTime).toLocaleString('ar-EG') + '</b></div>' +
    '<div class="row"><span>انتهت:</span><b>' + new Date(s.endTime).toLocaleString('ar-EG') + '</b></div>' +
    '<div class="row"><span>عدد الفواتير:</span><b>' + s.saleCount + '</b></div>' +
    '<div class="row"><span>إجمالي المبيعات:</span><b>' + s.totalSales.toFixed(2) + ' ' + settings.currency + '</b></div>' +
    '<div class="total">' +
    '<div class="row"><span>💵 مبيعات الكاش المتوقعة:</span><b>' + s.cashSales.toFixed(2) + ' ' + settings.currency + '</b></div>' +
    '<div class="row"><span>🧾 النقدية الفعلية بالدرج:</span><b>' + s.actualCash.toFixed(2) + ' ' + settings.currency + '</b></div>' +
    '<div class="row"><span>⚖️ الفرق:</span><b style="color:' + (s.difference < 0 ? '#c0392b' : (s.difference > 0 ? '#17643a' : '#203447')) + '">' + s.difference.toFixed(2) + ' ' + settings.currency + ' (' + diffText + ')</b></div>' +
    (s.notes ? '<div class="row"><span>📝 ملاحظات:</span><b>' + escapeHTML(s.notes) + '</b></div>' : '') +
    '</div>' +
    '</div>' +
    '<div class="sign">' +
    '<p>توقيع الكاشير</p>' +
    '<div class="line"></div>' +
    '<p style="margin-top:30px">توقيع المدير</p>' +
    '<div class="line"></div>' +
    '</div>' +
    '</div>' +
    '<div class="actions"><button class="btn-print" onclick="window.print()">🖨️ طباعة / حفظ PDF</button></div>' +
    '</body></html>'
  );
  w.document.close();
}

function printShiftReport() {
  if (state.currentShift) {
    // معاينة قبل الإغلاق
    const expected = document.getElementById('shiftExpectedCash').value;
    const actual = document.getElementById('shiftActualCash').value;
    const diff = document.getElementById('shiftDifference').value;
    const cashierName = document.getElementById('shiftCashierName').value || 'غير محدد';

    const w = window.open('', '_blank');
    if (!w) return showNotification('اسمح بالنوافذ المنبثقة', 'warning');
    w.document.write(
      '<html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>معاينة وردية</title>' +
      '<style>body{font-family:Tahoma;padding:25px;color:#203447}h2{color:#17364c}hr{margin:15px 0}</style>' +
      '</head><body>' +
      '<h2>' + escapeHTML(state.storeSettings.name) + '</h2>' +
      '<h3>معاينة وردية: ' + escapeHTML(cashierName) + '</h3>' +
      '<p>التاريخ: ' + new Date().toLocaleString('ar-EG') + '</p>' +
      '<hr>' +
      '<p>الكاش المتوقع: <b>' + expected + '</b></p>' +
      '<p>الكاش الفعلي: <b>' + actual + ' ' + state.storeSettings.currency + '</b></p>' +
      '<p>الفرق: <b>' + diff + '</b></p>' +
      '<hr>' +
      '<p style="color:#c0392b">ملاحظة: هذه معاينة، الوردية لم تُحفظ بعد.</p>' +
      '<script>window.onload=function(){window.print()}<\/script>' +
      '</body></html>'
    );
    w.document.close();
  } else {
    showNotification('لا توجد وردية مفتوحة حالياً', 'warning');
  }
}

/* ----------------- 9. الطباعة العامة ----------------- */

function printTableReport(tableType) {
  const settings = state.storeSettings;
  let title = '';
  let headers = [];
  let rows = [];

  switch (tableType) {
    case 'sales':
      title = 'سجل المبيعات';
      headers = ['رقم', 'التاريخ', 'العميل', 'الإجمالي', 'المدفوع', 'المتبقي'];
      rows = state.sales.map(function(s) {
        const cust = state.customers.find(function(c) { return c.id === s.customerId; });
        return [s.id, new Date(s.date).toLocaleDateString('ar-EG'), cust ? cust.name : 'نقدي', s.total.toFixed(2), s.paid.toFixed(2), s.remaining.toFixed(2)];
      });
      break;
    case 'products':
      title = 'قائمة المنتجات';
      headers = ['الاسم', 'الباركود', 'التصنيف', 'السعر', 'التكلفة', 'المخزون'];
      rows = state.products.map(function(p) {
        return [p.name, p.barcode || '-', p.category || '-', p.price, p.cost, p.stock];
      });
      break;
    case 'stockMoves':
      title = 'حركات المخزون';
      headers = ['التاريخ', 'المنتج', 'النوع', 'الكمية', 'قبل', 'بعد', 'السبب'];
      rows = state.stockMoves.map(function(m) {
        return [new Date(m.date).toLocaleDateString('ar-EG'), m.productName, m.type, m.qty, m.oldStock, m.newStock, m.reason];
      });
      break;
    case 'returns':
      title = 'المرتجعات';
      headers = ['التاريخ', 'الفاتورة', 'الصنف', 'الكمية', 'السبب'];
      rows = state.returns.map(function(r) {
        return [new Date(r.date).toLocaleDateString('ar-EG'), r.saleId, r.productName, r.qty, r.reason];
      });
      break;
    case 'customers':
      title = 'قائمة العملاء';
      headers = ['الاسم', 'الهاتف', 'الديون'];
      rows = state.customers.map(function(c) {
        return [c.name, c.phone || '-', (c.openingDebt || 0).toFixed(2)];
      });
      break;
    case 'customerPayments':
      title = 'تحصيلات العملاء';
      headers = ['التاريخ', 'العميل', 'المبلغ', 'ملاحظات'];
      rows = state.customerPayments.map(function(p) {
        return [p.date, p.customerName, p.amount.toFixed(2), p.notes || '-'];
      });
      break;
    case 'suppliers':
      title = 'قائمة الموردين';
      headers = ['الاسم', 'الهاتف', 'المستحقات'];
      rows = state.suppliers.map(function(s) {
        return [s.name, s.phone || '-', (s.openingDebt || 0).toFixed(2)];
      });
      break;
    case 'purchases':
      title = 'المشتريات';
      headers = ['التاريخ', 'المورد', 'المنتج', 'الكمية', 'التكلفة', 'الإجمالي'];
      rows = state.purchases.map(function(p) {
        const sup = state.suppliers.find(function(s) { return s.id === p.supplierId; });
        return [new Date(p.date).toLocaleDateString('ar-EG'), sup ? sup.name : '-', p.productName, p.qty, p.cost, p.total.toFixed(2)];
      });
      break;
    case 'expenses':
      title = 'المصروفات';
      headers = ['التاريخ', 'البند', 'المبلغ', 'ملاحظات'];
      rows = state.expenses.map(function(e) {
        return [e.date, e.name, e.amount.toFixed(2), e.notes || '-'];
      });
      break;
    case 'shifts':
      title = 'سجل الورديات';
      headers = ['التاريخ', 'الكاشير', 'عدد الفواتير', 'الكاش المتوقع', 'الفعلي', 'الفرق'];
      rows = state.shifts.map(function(s) {
        return [new Date(s.endTime).toLocaleString('ar-EG'), s.cashierName, s.saleCount, s.cashSales.toFixed(2), s.actualCash.toFixed(2), s.difference.toFixed(2)];
      });
      break;
    default:
      return showNotification('نوع التقرير غير معروف', 'error');
  }

  openPrintWindow(title, headers, rows, settings);
}

function openPrintWindow(title, headers, rows, settings) {
  const logoHTML = settings.logo
    ? '<img src="' + settings.logo + '" style="max-height:60px;max-width:150px">'
    : '';

  let headerHTML = headers.map(function(h) { return '<th>' + escapeHTML(h) + '</th>'; }).join('');
  let bodyHTML = '';
  rows.forEach(function(r) {
    bodyHTML += '<tr>';
    r.forEach(function(c) { bodyHTML += '<td>' + escapeHTML(c) + '</td>'; });
    bodyHTML += '</tr>';
  });

  if (rows.length === 0) {
    bodyHTML = '<tr><td colspan="' + headers.length + '" style="text-align:center;padding:20px;color:#687b8b">لا توجد بيانات</td></tr>';
  }

  const w = window.open('', '_blank');
  if (!w) return showNotification('اسمح بالنوافذ المنبثقة', 'warning');

  w.document.write(
    '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>' + escapeHTML(title) + '</title>' +
    '<style>' +
    '*{box-sizing:border-box;margin:0;padding:0}' +
    'body{font-family:Tahoma,Arial,sans-serif;background:#fff;padding:20px;color:#203447}' +
    '.header{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #17364c;padding-bottom:15px;margin-bottom:20px}' +
    '.header-info h1{margin:0 0 6px;font-size:20px;color:#17364c}' +
    '.header-info p{margin:2px 0;font-size:12px;color:#687b8b}' +
    '.report-title{text-align:center;font-size:18px;font-weight:800;color:#17364c;margin:15px 0;padding:10px;background:#edf3f9;border-radius:8px}' +
    'table{width:100%;border-collapse:collapse;margin-top:10px}' +
    'th{background:#17364c;color:#fff;padding:10px;text-align:right;font-size:12px}' +
    'td{padding:8px 10px;border-bottom:1px solid #e9eef2;font-size:12px}' +
    'tbody tr:nth-child(even){background:#f8fafb}' +
    '.meta{margin-top:20px;text-align:center;font-size:11px;color:#687b8b;padding-top:15px;border-top:1px dashed #dce3ec}' +
    '.actions{margin-top:20px;text-align:center}' +
    '.actions button{padding:10px 20px;margin:0 5px;border:0;border-radius:8px;font-weight:700;cursor:pointer;font-family:inherit;background:#176b70;color:#fff}' +
    '@media print{.actions{display:none}body{padding:0}}' +
    '</style></head><body>' +
    '<div class="header">' +
    '<div class="header-info">' +
    '<h1>' + escapeHTML(settings.name) + '</h1>' +
    (settings.phone ? '<p>📞 ' + escapeHTML(settings.phone) + '</p>' : '') +
    (settings.address ? '<p>📍 ' + escapeHTML(settings.address) + '</p>' : '') +
    (settings.taxNumber ? '<p>الرقم الضريبي: ' + escapeHTML(settings.taxNumber) + '</p>' : '') +
    '</div>' +
    '<div>' + logoHTML + '</div>' +
    '</div>' +
    '<div class="report-title">' + escapeHTML(title) + '</div>' +
    '<table><thead><tr>' + headerHTML + '</tr></thead><tbody>' + bodyHTML + '</tbody></table>' +
    '<div class="meta">' +
    'عدد السجلات: ' + rows.length + ' | تاريخ الطباعة: ' + new Date().toLocaleString('ar-EG') +
    '</div>' +
    '<div class="actions"><button onclick="window.print()">🖨️ طباعة</button></div>' +
    '</body></html>'
  );
  w.document.close();
}

function exportTableCSV(tableType) {
  const settings = state.storeSettings;
  let title = '';
  let headers = [];
  let rows = [];

  switch (tableType) {
    case 'sales':
      title = 'المبيعات';
      headers = ['رقم', 'التاريخ', 'العميل', 'الإجمالي', 'المدفوع', 'المتبقي', 'طريقة الدفع'];
      rows = state.sales.map(function(s) {
        const cust = state.customers.find(function(c) { return c.id === s.customerId; });
        return [s.id, new Date(s.date).toLocaleDateString('ar-EG'), cust ? cust.name : 'نقدي', s.total.toFixed(2), s.paid.toFixed(2), s.remaining.toFixed(2), s.payMethod];
      });
      break;
    case 'products':
      title = 'المنتجات';
      headers = ['الاسم', 'الباركود', 'التصنيف', 'السعر', 'التكلفة', 'المخزون', 'حد التنبيه'];
      rows = state.products.map(function(p) {
        return [p.name, p.barcode || '', p.category || '', p.price, p.cost, p.stock, p.minStock || 5];
      });
      break;
    case 'stockMoves':
      title = 'حركات المخزون';
      headers = ['التاريخ', 'المنتج', 'النوع', 'الكمية', 'قبل', 'بعد', 'السبب'];
      rows = state.stockMoves.map(function(m) {
        return [new Date(m.date).toLocaleDateString('ar-EG'), m.productName, m.type, m.qty, m.oldStock, m.newStock, m.reason];
      });
      break;
    case 'returns':
      title = 'المرتجعات';
      headers = ['التاريخ', 'الفاتورة', 'الصنف', 'الكمية', 'السبب'];
      rows = state.returns.map(function(r) {
        return [new Date(r.date).toLocaleDateString('ar-EG'), r.saleId, r.productName, r.qty, r.reason];
      });
      break;
    case 'customers':
      title = 'العملاء';
      headers = ['الاسم', 'الهاتف', 'الديون'];
      rows = state.customers.map(function(c) {
        return [c.name, c.phone || '', (c.openingDebt || 0).toFixed(2)];
      });
      break;
    case 'customerPayments':
      title = 'تحصيلات العملاء';
      headers = ['التاريخ', 'العميل', 'المبلغ', 'ملاحظات'];
      rows = state.customerPayments.map(function(p) {
        return [p.date, p.customerName, p.amount.toFixed(2), p.notes || ''];
      });
      break;
    case 'suppliers':
      title = 'الموردين';
      headers = ['الاسم', 'الهاتف', 'المستحقات'];
      rows = state.suppliers.map(function(s) {
        return [s.name, s.phone || '', (s.openingDebt || 0).toFixed(2)];
      });
      break;
    case 'purchases':
      title = 'المشتريات';
      headers = ['التاريخ', 'المورد', 'المنتج', 'الكمية', 'التكلفة', 'الإجمالي', 'المتبقي'];
      rows = state.purchases.map(function(p) {
        const sup = state.suppliers.find(function(s) { return s.id === p.supplierId; });
        return [new Date(p.date).toLocaleDateString('ar-EG'), sup ? sup.name : '', p.productName, p.qty, p.cost, p.total.toFixed(2), p.remaining.toFixed(2)];
      });
      break;
    case 'expenses':
      title = 'المصروفات';
      headers = ['التاريخ', 'البند', 'المبلغ', 'ملاحظات'];
      rows = state.expenses.map(function(e) {
        return [e.date, e.name, e.amount.toFixed(2), e.notes || ''];
      });
      break;
    case 'shifts':
      title = 'الورديات';
      headers = ['التاريخ', 'الكاشير', 'عدد الفواتير', 'الكاش المتوقع', 'الفعلي', 'الفرق'];
      rows = state.shifts.map(function(s) {
        return [new Date(s.endTime).toLocaleString('ar-EG'), s.cashierName, s.saleCount, s.cashSales.toFixed(2), s.actualCash.toFixed(2), s.difference.toFixed(2)];
      });
      break;
    default:
      return showNotification('نوع التقرير غير معروف', 'error');
  }

  let csv = '\uFEFF';
  csv += '"' + settings.name + ' - ' + title + '"\r\n';
  csv += '"تاريخ التصدير: ' + new Date().toLocaleString('ar-EG') + '"\r\n\r\n';
  csv += headers.map(function(h) { return '"' + h + '"'; }).join(',') + '\r\n';
  rows.forEach(function(r) {
    csv += r.map(function(c) { return '"' + String(c || '').replace(/"/g, '""') + '"'; }).join(',') + '\r\n';
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = title + '-' + today() + '.csv';
  document.body.appendChild(a);
  a.click();
  setTimeout(function() { a.remove(); URL.revokeObjectURL(url); }, 100);

  showNotification('تم تصدير الملف ✅');
}

/* ----------------- 10. لوحة التحكم ----------------- */

function renderDashboard() {
  const totalSales = state.sales.reduce(function(sum, s) { return sum + s.total; }, 0);
  const totalExpenses = state.expenses.reduce(function(sum, e) { return sum + e.amount; }, 0);
  const totalProducts = state.products.length;
  const lowStockCount = state.products.filter(function(p) { return Number(p.stock) <= Number(p.minStock || 5); }).length;

  let totalCost = 0;
  state.sales.forEach(function(s) {
    s.items.forEach(function(i) { totalCost += (i.cost || 0) * i.qty; });
  });
  const netProfit = totalSales - totalCost - totalExpenses;

  const customerDebt = state.customers.reduce(function(sum, c) { return sum + (c.openingDebt || 0); }, 0);
  const supplierDebt = state.suppliers.reduce(function(sum, s) { return sum + (s.openingDebt || 0); }, 0);
  const stockValue = state.products.reduce(function(sum, p) { return sum + (p.stock * p.cost); }, 0);

  const cardsEl = document.getElementById('dashboardCards');
  if (cardsEl) {
    cardsEl.innerHTML =
      '<div class="stat-card" style="background:linear-gradient(135deg,#c8e5d2,#a9d5bb);border-color:#8ab99f">' +
      '<h3>صافي الربح</h3>' +
      '<p style="color:' + (netProfit >= 0 ? '#17643a' : '#c0392b') + '">' + netProfit.toFixed(2) + ' ' + state.storeSettings.currency + '</p>' +
      '</div>' +
      '<div class="stat-card"><h3>إجمالي المبيعات</h3><p>' + totalSales.toFixed(2) + ' ' + state.storeSettings.currency + '</p></div>';
  }

  const otherCards = document.getElementById('dashboardOtherCards');
  if (otherCards) {
    otherCards.innerHTML =
      '<div class="stat-card"><h3>عدد المنتجات</h3><p>' + totalProducts + '</p></div>' +
      '<div class="stat-card"><h3>المصروفات</h3><p>' + totalExpenses.toFixed(2) + ' ' + state.storeSettings.currency + '</p></div>' +
      '<div class="stat-card"><h3>قيمة المخزون</h3><p>' + stockValue.toFixed(2) + ' ' + state.storeSettings.currency + '</p></div>' +
      '<div class="stat-card"><h3>ديون العملاء</h3><p style="color:#c0392b">' + customerDebt.toFixed(2) + ' ' + state.storeSettings.currency + '</p></div>' +
      '<div class="stat-card"><h3>مستحقات الموردين</h3><p style="color:#e58a16">' + supplierDebt.toFixed(2) + ' ' + state.storeSettings.currency + '</p></div>' +
      '<div class="stat-card"><h3>تنبيهات المخزون</h3><p style="color:' + (lowStockCount > 0 ? '#c62828' : '#17643a') + '">' + lowStockCount + ' صنف</p></div>';
  }

  const alertsContainer = document.getElementById('stockAlerts');
  if (alertsContainer) {
    const lowList = state.products.filter(function(p) { return Number(p.stock) <= Number(p.minStock || 5); });
    if (lowList.length === 0) {
      alertsContainer.innerHTML = '<p class="notice success">لا توجد تنبيهات مخزون.</p>';
    } else {
      alertsContainer.innerHTML = lowList.map(function(p) {
        return '<div class="stock-alert">⚠️ ' + escapeHTML(p.name) + ' - المتبقي: <b>' + p.stock + '</b></div>';
      }).join('');
    }
  }

  const topContainer = document.getElementById('topProducts');
  if (topContainer) {
    const salesByProduct = {};
    state.sales.forEach(function(s) {
      s.items.forEach(function(i) {
        if (!salesByProduct[i.id]) salesByProduct[i.id] = { name: i.name, qty: 0, total: 0 };
        salesByProduct[i.id].qty += i.qty;
        salesByProduct[i.id].total += i.price * i.qty;
      });
    });
    const top = Object.values(salesByProduct).sort(function(a, b) { return b.qty - a.qty; }).slice(0, 5);
    if (top.length === 0) {
      topContainer.innerHTML = '<p class="text-muted">لا توجد مبيعات بعد.</p>';
    } else {
      let html = '<div class="table-wrap"><table class="data-table"><thead><tr><th>المنتج</th><th>الكمية</th><th>القيمة</th></tr></thead><tbody>';
      top.forEach(function(t) {
        html += '<tr><td>' + escapeHTML(t.name) + '</td><td><b>' + t.qty + '</b></td><td>' + t.total.toFixed(2) + '</td></tr>';
      });
      html += '</tbody></table></div>';
      topContainer.innerHTML = html;
    }
  }

  const summaryContainer = document.getElementById('accountSummary');
  if (summaryContainer) {
    summaryContainer.innerHTML =
      '<div class="table-wrap"><table class="data-table"><tbody>' +
      '<tr><td>ديون العملاء</td><td><b class="red-text">' + customerDebt.toFixed(2) + ' ' + state.storeSettings.currency + '</b></td></tr>' +
      '<tr><td>مستحقات الموردين</td><td><b style="color:#e58a16">' + supplierDebt.toFixed(2) + ' ' + state.storeSettings.currency + '</b></td></tr>' +
      '<tr><td>النقد المحصل</td><td><b class="green-text">' + state.sales.reduce(function(sum, s) { return sum + s.paid; }, 0).toFixed(2) + ' ' + state.storeSettings.currency + '</b></td></tr>' +
      '<tr><td>إجمالي المشتريات</td><td><b>' + state.purchases.reduce(function(sum, p) { return sum + p.total; }, 0).toFixed(2) + ' ' + state.storeSettings.currency + '</b></td></tr>' +
      '</tbody></table></div>';
  }

  renderSalesChart();
}

/* ----------------- 11. الرسم البياني ----------------- */

function renderSalesChart() {
  const container = document.getElementById('salesChart');
  if (!container) return;
  if (typeof Chart === 'undefined') {
    container.innerHTML = '<p class="text-muted">الرسم البياني غير متاح.</p>';
    return;
  }

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }

  const data = days.map(function(day) {
    return state.sales
      .filter(function(s) { return (s.date || '').split('T')[0] === day; })
      .reduce(function(sum, s) { return sum + s.total; }, 0);
  });

  const labels = days.map(function(day) {
    const d = new Date(day + 'T12:00:00');
    return d.toLocaleDateString('ar-EG', { weekday: 'short' });
  });

  if (salesChartInstance) salesChartInstance.destroy();

  const canvas = document.createElement('canvas');
  container.innerHTML = '';
  container.appendChild(canvas);

  salesChartInstance = new Chart(canvas, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'المبيعات',
        data: data,
        borderColor: '#147d80',
        backgroundColor: 'rgba(20, 125, 128, 0.15)',
        borderWidth: 3,
        fill: true,
        tension: 0.35,
        pointBackgroundColor: '#176b70',
        pointRadius: 5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { callback: function(v) { return v.toLocaleString('en-US'); } } },
        x: { grid: { display: false } }
      }
    }
  });
}

/* ============ نهاية الجزء 2 ============ */
/* ==========================================================
   الجزء 3-أ: الفاتورة الاحترافية (PDF + QR)
   ========================================================== */

async function generateQRData(sale) {
  try {
    const profile = state.storeSettings;
    const data = JSON.stringify({
      id: sale.id,
      shop: profile.name || 'المحل',
      date: sale.date,
      total: sale.total,
      customer: sale.customerName || 'عميل نقدي'
    });
    if (typeof QRCode !== 'undefined') {
      return await QRCode.toDataURL(data, {
        width: 130,
        margin: 1,
        color: { dark: '#17364c', light: '#ffffff' }
      });
    }
    return '';
  } catch (e) {
    console.warn('QR gen failed', e);
    return '';
  }
}

function printInvoiceById(id) {
  const s = state.sales.find(function(x) { return x.id === id; });
  if (!s) return showNotification('الفاتورة غير موجودة', 'error');
  printInvoice(s);
}

async function printInvoice(sale) {
  if (!sale) return;
  const cust = state.customers.find(function(c) { return c.id === sale.customerId; });
  const settings = state.storeSettings;

  // توليد QR
  let qrDataUrl = '';
  try {
    qrDataUrl = await generateQRData(sale);
  } catch (e) {}

  const logoHTML = settings.logo
    ? '<img src="' + settings.logo + '" style="max-height:80px;max-width:180px;background:#fff;padding:6px;border-radius:10px">'
    : '<div style="font-size:26px;font-weight:900;color:#fff">' + escapeHTML(settings.name) + '</div>';

  const payMethodNames = { cash: '💵 كاش', visa: '💳 فيزا / شبكة', transfer: '📲 تحويل بنكي' };
  const payMethod = payMethodNames[sale.payMethod] || sale.payMethod;

  const itemsHTML = sale.items.map(function(i) {
    return '<tr>' +
      '<td>' + escapeHTML(i.name) + '</td>' +
      '<td style="text-align:center">' + i.qty + '</td>' +
      '<td style="text-align:center">' + Number(i.price).toFixed(2) + '</td>' +
      '<td style="text-align:center">' + (i.price * i.qty).toFixed(2) + '</td>' +
      '</tr>';
  }).join('');

  const qrHTML = qrDataUrl
    ? '<div class="qr"><img src="' + qrDataUrl + '"><div>امسح للتحقق</div></div>'
    : '';

  const w = window.open('', '_blank');
  if (!w) return showNotification('اسمح بالنوافذ المنبثقة للطباعة', 'warning');

  w.document.write(
    '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">' +
    '<title>فاتورة ' + escapeHTML(sale.id) + '</title>' +
    '<style>' +
    '*{box-sizing:border-box;margin:0;padding:0}' +
    'body{font-family:Tahoma,Arial,sans-serif;background:#e8edf3;padding:20px;color:#203447;line-height:1.5}' +
    '.invoice{max-width:800px;margin:auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 10px 30px #0002}' +
    '.head{background:linear-gradient(125deg,#142f46,#176b70);color:#fff;padding:25px 30px;display:flex;justify-content:space-between;align-items:center;border-bottom:4px solid #d6a84f;gap:20px}' +
    '.head-left h1{margin:0 0 8px;font-size:24px;color:#fff}' +
    '.head-left p{margin:3px 0;font-size:13px;opacity:.95}' +
    '.head-right{flex-shrink:0}' +
    '.info{padding:20px 30px;display:grid;grid-template-columns:1fr 1fr;gap:15px;background:#f8fafb;border-bottom:1px solid #dce3ec}' +
    '.info .label{font-size:12px;color:#687b8b;margin-bottom:3px}' +
    '.info .value{font-size:15px;font-weight:700;color:#17364c}' +
    '.items{padding:20px 30px}' +
    'table{width:100%;border-collapse:collapse}' +
    'th{background:#edf4f6;color:#234356;padding:12px;text-align:right;font-size:13px;border-bottom:2px solid #d6e0e8}' +
    'td{padding:12px;border-bottom:1px solid #e9eef2;font-size:14px}' +
    'tbody tr:nth-child(even){background:#fafcfd}' +
    '.totals{padding:20px 30px;background:#f8fafb;border-top:1px solid #dce3ec}' +
    '.total-row{display:flex;justify-content:space-between;padding:8px 0;font-size:15px;border-bottom:1px dashed #d6e0e8}' +
    '.total-row.grand{font-size:20px;font-weight:900;color:#17364c;border-bottom:0;margin-top:8px;padding-top:12px;border-top:2px solid #17364c}' +
    '.total-row.paid{color:#198754}' +
    '.total-row.due{color:#c0392b}' +
    '.footer{padding:20px 30px;text-align:center;background:linear-gradient(125deg,#142f46,#176b70);color:#fff}' +
    '.footer h3{margin:0 0 6px;font-size:18px}' +
    '.footer p{margin:3px 0;font-size:13px;opacity:.9}' +
    '.qr{margin-top:15px;display:flex;flex-direction:column;align-items:center;gap:6px}' +
    '.qr img{background:#fff;padding:8px;border-radius:10px}' +
    '.qr div{font-size:12px;opacity:.85}' +
    '.actions{max-width:800px;margin:20px auto 0;display:flex;gap:12px;justify-content:center}' +
    '.actions button{padding:12px 24px;border:0;border-radius:10px;font-weight:700;cursor:pointer;font-size:15px;font-family:inherit}' +
    '.btn-print{background:#176b70;color:#fff}' +
    '.btn-close{background:#687585;color:#fff}' +
    '@media print{body{background:#fff;padding:0}.actions{display:none}.invoice{box-shadow:none;border-radius:0}}' +
    '@media(max-width:600px){.head{flex-direction:column;text-align:center}.info{grid-template-columns:1fr}.items{padding:15px}th,td{padding:8px;font-size:12px}}' +
    '</style></head><body>' +
    '<div class="invoice">' +
    '<div class="head">' +
    '<div class="head-left">' +
    '<h1>' + escapeHTML(settings.name) + '</h1>' +
    (settings.phone ? '<p>📞 ' + escapeHTML(settings.phone) + '</p>' : '') +
    (settings.address ? '<p>📍 ' + escapeHTML(settings.address) + '</p>' : '') +
    (settings.taxNumber ? '<p>الرقم الضريبي: ' + escapeHTML(settings.taxNumber) + '</p>' : '') +
    '</div>' +
    '<div class="head-right">' + logoHTML + '</div>' +
    '</div>' +
    '<div class="info">' +
    '<div><div class="label">رقم الفاتورة</div><div class="value">' + escapeHTML(sale.id) + '</div></div>' +
    '<div><div class="label">التاريخ</div><div class="value">' + new Date(sale.date).toLocaleString('ar-EG') + '</div></div>' +
    '<div><div class="label">العميل</div><div class="value">' + escapeHTML(cust ? cust.name : 'عميل نقدي') + '</div></div>' +
    '<div><div class="label">طريقة الدفع</div><div class="value">' + payMethod + '</div></div>' +
    (cust && cust.phone && cust.phone !== '-' ? '<div><div class="label">هاتف العميل</div><div class="value">' + escapeHTML(cust.phone) + '</div></div>' : '') +
    (sale.cashier ? '<div><div class="label">الكاشير</div><div class="value">' + escapeHTML(sale.cashier) + '</div></div>' : '') +
    '</div>' +
    '<div class="items">' +
    '<table><thead><tr><th>الصنف</th><th style="text-align:center">الكمية</th><th style="text-align:center">السعر</th><th style="text-align:center">الإجمالي</th></tr></thead>' +
    '<tbody>' + itemsHTML + '</tbody></table>' +
    '</div>' +
    '<div class="totals">' +
    '<div class="total-row"><span>الإجمالي</span><span>' + Number(sale.subtotal || sale.total).toFixed(2) + ' ' + settings.currency + '</span></div>' +
    (sale.discount > 0 ? '<div class="total-row"><span>الخصم</span><span>-' + Number(sale.discount).toFixed(2) + ' ' + settings.currency + '</span></div>' : '') +
    '<div class="total-row grand"><span>الصافي</span><span>' + Number(sale.total).toFixed(2) + ' ' + settings.currency + '</span></div>' +
    '<div class="total-row paid"><span>المدفوع</span><span>' + Number(sale.paid).toFixed(2) + ' ' + settings.currency + '</span></div>' +
    '<div class="total-row due"><span>المتبقي</span><span>' + Number(sale.remaining).toFixed(2) + ' ' + settings.currency + '</span></div>' +
    '</div>' +
    '<div class="footer">' +
    '<h3>شكراً لتعاملكم معنا 🌹</h3>' +
    '<p>نتمنى لكم يوماً سعيداً</p>' +
    qrHTML +
    '</div>' +
    '</div>' +
    '<div class="actions">' +
    '<button class="btn-print" onclick="window.print()">🖨️ طباعة / حفظ PDF</button>' +
    '<button class="btn-close" onclick="window.close()">إغلاق</button>' +
    '</div>' +
    '</body></html>'
  );
  w.document.close();
}

/* ============ نهاية الجزء 3-أ ============ */
/* ==========================================================
   الجزء 3-ب: النسخ الاحتياطي (تشفير) + المسح
   ========================================================== */

/* ----------------- 12. النسخ الاحتياطي (تشفير حقيقي) ----------------- */

function simpleEncrypt(text, password) {
  if (!password) return text;
  let result = '';
  for (let i = 0; i < text.length; i++) {
    result += String.fromCharCode(text.charCodeAt(i) ^ password.charCodeAt(i % password.length));
  }
  return btoa(unescape(encodeURIComponent(result)));
}

function simpleDecrypt(encoded, password) {
  if (!password) return encoded;
  try {
    const text = decodeURIComponent(escape(atob(encoded)));
    let result = '';
    for (let i = 0; i < text.length; i++) {
      result += String.fromCharCode(text.charCodeAt(i) ^ password.charCodeAt(i % password.length));
    }
    return result;
  } catch (e) {
    throw new Error('فك التشفير فشل - تأكد من كلمة المرور');
  }
}

function exportBackup() {
  if (state.role !== 'manager') return showNotification('هذه العملية للمدير فقط', 'warning');

  const passEl = document.getElementById('backupPassword');
  const pass = (passEl ? passEl.value : '').trim();
  if (!pass) return showNotification('أدخل كلمة المرور للتشفير', 'error');

  const backupData = {
    version: 6,
    exportedAt: new Date().toISOString(),
    storeSettings: state.storeSettings,
    products: state.products,
    sales: state.sales,
    customers: state.customers,
    suppliers: state.suppliers,
    expenses: state.expenses,
    stockMoves: state.stockMoves,
    returns: state.returns,
    customerPayments: state.customerPayments,
    purchases: state.purchases,
    shifts: state.shifts,
    currentShift: state.currentShift
  };

  const jsonStr = JSON.stringify(backupData);
  const encrypted = simpleEncrypt(jsonStr, pass);
  const finalData = JSON.stringify({ encrypted: true, data: encrypted });

  const blob = new Blob([finalData], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'backup-shop-' + today() + '.shopbak';
  document.body.appendChild(a);
  a.click();
  setTimeout(function() { a.remove(); URL.revokeObjectURL(url); }, 100);

  const msgEl = document.getElementById('backupMessage');
  if (msgEl) msgEl.textContent = 'تم تنزيل النسخة المشفرة بنجاح.';
  showNotification('تم تجهيز النسخة الاحتياطية ✅');
}

function importBackup(event) {
  if (state.role !== 'manager') {
    event.target.value = '';
    return showNotification('هذه العملية للمدير فقط', 'warning');
  }

  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const passEl = document.getElementById('backupPassword');
  const pass = (passEl ? passEl.value : '').trim();
  if (!pass) {
    event.target.value = '';
    return showNotification('أدخل كلمة المرور أولاً', 'error');
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const parsed = JSON.parse(e.target.result);
      let backup;

      if (parsed && parsed.encrypted && parsed.data) {
        const decrypted = simpleDecrypt(parsed.data, pass);
        backup = JSON.parse(decrypted);
      } else if (parsed && (parsed.products || parsed.sales)) {
        backup = parsed;
      } else {
        throw new Error('صيغة الملف غير صحيحة');
      }

      if (!confirm('سيتم استبدال البيانات الحالية بالبيانات المستعادة. متابعة؟')) {
        event.target.value = '';
        return;
      }

      if (backup.storeSettings) state.storeSettings = Object.assign({}, state.storeSettings, backup.storeSettings);
      if (Array.isArray(backup.products)) state.products = backup.products;
      if (Array.isArray(backup.sales)) state.sales = backup.sales;
      if (Array.isArray(backup.customers)) state.customers = backup.customers;
      if (Array.isArray(backup.suppliers)) state.suppliers = backup.suppliers;
      if (Array.isArray(backup.expenses)) state.expenses = backup.expenses;
      if (Array.isArray(backup.stockMoves)) state.stockMoves = backup.stockMoves;
      if (Array.isArray(backup.returns)) state.returns = backup.returns;
      if (Array.isArray(backup.customerPayments)) state.customerPayments = backup.customerPayments;
      if (Array.isArray(backup.purchases)) state.purchases = backup.purchases;
      if (Array.isArray(backup.shifts)) state.shifts = backup.shifts;
      if (backup.currentShift !== undefined) state.currentShift = backup.currentShift;

      saveData();
      renderAll();
      loadStoreSettings();
      updateStockBadge();
      showNotification('تمت استعادة النسخة بنجاح ✅');
    } catch (err) {
      console.error(err);
      showNotification('فشل الاستعادة: ' + (err.message || 'تأكد من كلمة المرور'), 'error');
    } finally {
      event.target.value = '';
    }
  };
  reader.readAsText(file);
}

/* ----------------- 13. مسح البيانات ----------------- */

async function clearAllData() {
  if (state.role !== 'manager') return showNotification('هذه العملية للمدير فقط', 'warning');
  if (!confirm('تحذير! سيتم مسح كافة البيانات نهائياً (المنتجات، المبيعات، العملاء...)')) return;
  if (!confirm('تأكيد أخير: هل أنت متأكد؟ لا يمكن التراجع.')) return;

  state.products = [];
  state.sales = [];
  state.customers = [{ id: uid('CUST'), name: 'عميل نقدي عام', phone: '-', openingDebt: 0 }];
  state.suppliers = [];
  state.expenses = [];
  state.stockMoves = [];
  state.returns = [];
  state.customerPayments = [];
  state.purchases = [];
  state.shifts = [];
  state.currentShift = null;
  state.cart = [];

  // مسح الكاش المحلي
  if (state.currentUser) {
    localStorage.removeItem('pos_cache_' + state.currentUser.id);
  }

  // حفظ في السحابة
  await uploadToCloud();

  renderAll();
  updateStockBadge();
  showNotification('تم مسح كل البيانات ✅');
}

/* ============ نهاية الجزء 3-ب ============ */
/* ==========================================================
   الجزء 3-ج: التشغيل النهائي (الأخير)
   ========================================================== */

/* ----------------- 14. معالجة الأخطاء العامة ----------------- */

window.addEventListener('error', function(e) {
  console.error('Global error:', e.message);
});

window.addEventListener('unhandledrejection', function(e) {
  console.error('Unhandled promise:', e.reason);
});

/* ----------------- 15. حماية من Pull-to-Refresh ----------------- */

// منع Pull-to-Refresh (السحب من فوق)
let touchStartY = 0;
let touchMoved = false;

document.addEventListener('touchstart', function(e) {
  touchStartY = e.touches[0].pageY;
  touchMoved = false;
}, { passive: true });

document.addEventListener('touchmove', function(e) {
  if (touchStartY < 50 && e.touches[0].pageY > touchStartY + 30) {
    touchMoved = true;
    if (document.body.scrollTop === 0 && !document.querySelector('.sidebar.open')) {
      e.preventDefault();
    }
  }
}, { passive: false });

/* ----------------- 16. تحويل الأرقام للاتينية ----------------- */

function latinizeVisibleDigits(root) {
  root = root || document.body;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (/[٠-٩۰-۹]/.test(node.nodeValue)) {
      node.nodeValue = node.nodeValue.replace(/[٠-٩۰-۹]/g, function(ch) {
        const arIdx = '٠١٢٣٤٥٦٧٨٩'.indexOf(ch);
        if (arIdx >= 0) return String(arIdx);
        const faIdx = '۰۱۲۳۴۵۶۷۸۹'.indexOf(ch);
        return String(faIdx);
      });
    }
  }
}

const digitObserver = new MutationObserver(function() {
  latinizeVisibleDigits();
});

document.addEventListener('DOMContentLoaded', function() {
  latinizeVisibleDigits();
  digitObserver.observe(document.body, { subtree: true, childList: true, characterData: true });
});

/* ----------------- 17. حماية المستخدم عند إغلاق الصفحة ----------------- */

window.addEventListener('beforeunload', function(e) {
  // حفظ الصفحة الحالية
  const activePage = document.querySelector('.page.active');
  if (activePage && state.currentUser) {
    saveCurrentPage(activePage.id);
  }
});

window.addEventListener('pagehide', function() {
  const activePage = document.querySelector('.page.active');
  if (activePage && state.currentUser) {
    saveCurrentPage(activePage.id);
  }
});

/* ----------------- 18. تفعيل الصوت عند أول تفاعل ----------------- */

document.addEventListener('click', function initAudioOnce() {
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  document.removeEventListener('click', initAudioOnce);
}, { once: true });

document.addEventListener('touchstart', function initAudioOnceTouch() {
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  document.removeEventListener('touchstart', initAudioOnceTouch);
}, { once: true });

/* ----------------- 19. تسجيل التحديثات في الـ Console ----------------- */

console.log(
  '%c🏪 إدارة المحل v5.0\n' +
  '%c✅ النظام جاهز للعمل\n' +
  '📅 ' + new Date().toLocaleString('ar-EG'),
  'font-size:18px;font-weight:bold;color:#176b70',
  'font-size:13px;color:#198754'
);

/* ============ نهاية الجزء 3-ج ============ */
/* ============ نهاية الملف ============ */
/* ============ طباعة تقرير ملخص الفترة ============ */

function printReportSummary() {
  const from = (document.getElementById('reportFrom') || {}).value || '';
  const to = (document.getElementById('reportTo') || {}).value || '';
  const settings = state.storeSettings;

  // نفس حسابات renderReports
  const filteredSales = state.sales.filter(function(s) {
    const d = (s.date || '').split('T')[0];
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });

  const filteredExpenses = state.expenses.filter(function(e) {
    if (from && e.date < from) return false;
    if (to && e.date > to) return false;
    return true;
  });

  const filteredReturns = state.returns.filter(function(r) {
    const d = (r.date || '').split('T')[0];
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });

  const totalSales = filteredSales.reduce(function(sum, s) { return sum + s.total; }, 0);
  const totalDiscount = filteredSales.reduce(function(sum, s) { return sum + (s.discount || 0); }, 0);

  let totalCost = 0;
  filteredSales.forEach(function(s) {
    s.items.forEach(function(i) { totalCost += (i.cost || 0) * i.qty; });
  });

  const totalExpenses = filteredExpenses.reduce(function(sum, e) { return sum + e.amount; }, 0);
  const netProfit = totalSales - totalCost - totalExpenses;
  const avgInvoice = filteredSales.length > 0 ? totalSales / filteredSales.length : 0;

  // الأكثر مبيعًا
  const salesByProduct = {};
  filteredSales.forEach(function(s) {
    s.items.forEach(function(i) {
      if (!salesByProduct[i.id]) salesByProduct[i.id] = { name: i.name, qty: 0, total: 0 };
      salesByProduct[i.id].qty += i.qty;
      salesByProduct[i.id].total += i.price * i.qty;
    });
  });
  const topProducts = Object.values(salesByProduct).sort(function(a, b) { return b.qty - a.qty; }).slice(0, 10);

  const logoHTML = settings.logo
    ? '<img src="' + settings.logo + '" style="max-height:70px;max-width:170px">'
    : '';

  const periodText = (from || 'البداية') + ' ← ' + (to || 'الآن');
  const cur = settings.currency || 'ج.م';

  let topHTML = '';
  if (topProducts.length === 0) {
    topHTML = '<tr><td colspan="4" style="text-align:center;color:#888">لا توجد مبيعات</td></tr>';
  } else {
    topHTML = topProducts.map(function(t, i) {
      return '<tr><td>' + (i + 1) + '</td><td>' + escapeHTML(t.name) + '</td><td>' + t.qty + '</td><td>' + t.total.toFixed(2) + ' ' + cur + '</td></tr>';
    }).join('');
  }

  const w = window.open('', '_blank');
  if (!w) return showNotification('اسمح بالنوافذ المنبثقة للطباعة', 'warning');

  w.document.write(
    '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>تقرير الفترة</title>' +
    '<style>' +
    '*{box-sizing:border-box;margin:0;padding:0}' +
    'body{font-family:Tahoma,Arial,sans-serif;background:#fff;padding:20px;color:#203447}' +
    '.header{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #17364c;padding-bottom:15px;margin-bottom:20px}' +
    '.header h1{margin:0 0 6px;font-size:20px;color:#17364c}' +
    '.header p{margin:2px 0;font-size:12px;color:#687b8b}' +
    '.title{text-align:center;font-size:20px;font-weight:900;color:#17364c;margin:20px 0;padding:12px;background:linear-gradient(135deg,#edf3f9,#dbe6ee);border-radius:10px}' +
    '.period{text-align:center;font-size:13px;color:#687b8b;margin-bottom:20px}' +
    '.stats{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:25px}' +
    '.stat{padding:15px;background:#f8fafb;border-radius:10px;border-right:4px solid #176b70}' +
    '.stat h3{margin:0 0 8px;font-size:13px;color:#687b8b;font-weight:700}' +
    '.stat p{margin:0;font-size:20px;font-weight:900;color:#17364c}' +
    '.stat.profit{background:#e4f7eb;border-right-color:#198754}' +
    '.stat.profit p{color:#198754}' +
    '.section-title{font-size:16px;font-weight:800;color:#17364c;margin:25px 0 12px;padding-bottom:8px;border-bottom:2px solid #edf3f9}' +
    'table{width:100%;border-collapse:collapse}' +
    'th{background:#17364c;color:#fff;padding:10px;text-align:right;font-size:12px}' +
    'td{padding:9px 10px;border-bottom:1px solid #e9eef2;font-size:13px}' +
    'tbody tr:nth-child(even){background:#f8fafb}' +
    '.footer{margin-top:30px;padding-top:15px;border-top:1px dashed #dce3ec;text-align:center;font-size:11px;color:#687b8b}' +
    '.actions{margin-top:25px;text-align:center}' +
    '.actions button{padding:12px 28px;margin:0 5px;border:0;border-radius:10px;font-weight:700;cursor:pointer;font-family:inherit;font-size:15px;background:#176b70;color:#fff}' +
    '.actions button.close{background:#687585}' +
    '@media print{.actions{display:none}body{padding:0}}' +
    '</style></head><body>' +
    '<div class="header">' +
    '<div><h1>' + escapeHTML(settings.name) + '</h1>' +
    (settings.phone ? '<p>📞 ' + escapeHTML(settings.phone) + '</p>' : '') +
    (settings.address ? '<p>📍 ' + escapeHTML(settings.address) + '</p>' : '') +
    (settings.taxNumber ? '<p>الرقم الضريبي: ' + escapeHTML(settings.taxNumber) + '</p>' : '') +
    '</div>' +
    '<div>' + logoHTML + '</div>' +
    '</div>' +
    '<div class="title">📊 تقرير الأداء المالي</div>' +
    '<div class="period">الفترة: ' + escapeHTML(periodText) + '</div>' +
    '<div class="stats">' +
    '<div class="stat"><h3>إجمالي المبيعات</h3><p>' + totalSales.toFixed(2) + ' ' + cur + '</p></div>' +
    '<div class="stat"><h3>عدد الفواتير</h3><p>' + filteredSales.length + '</p></div>' +
    '<div class="stat"><h3>متوسط الفاتورة</h3><p>' + avgInvoice.toFixed(2) + ' ' + cur + '</p></div>' +
    '<div class="stat"><h3>إجمالي التكلفة</h3><p>' + totalCost.toFixed(2) + ' ' + cur + '</p></div>' +
    '<div class="stat"><h3>المصروفات</h3><p>' + totalExpenses.toFixed(2) + ' ' + cur + '</p></div>' +
    '<div class="stat profit"><h3>صافي الربح</h3><p>' + netProfit.toFixed(2) + ' ' + cur + '</p></div>' +
    '</div>' +
    '<div class="section-title">🏆 الأكثر مبيعًا في الفترة</div>' +
    '<table><thead><tr><th>#</th><th>المنتج</th><th>الكمية</th><th>القيمة</th></tr></thead>' +
    '<tbody>' + topHTML + '</tbody></table>' +
    '<div class="section-title">📌 معلومات إضافية</div>' +
    '<table><tbody>' +
    '<tr><td>إجمالي الخصومات</td><td><b>' + totalDiscount.toFixed(2) + ' ' + cur + '</b></td></tr>' +
    '<tr><td>عدد المرتجعات</td><td><b>' + filteredReturns.length + '</b></td></tr>' +
    '<tr><td>عدد المصروفات</td><td><b>' + filteredExpenses.length + '</b></td></tr>' +
    '</tbody></table>' +
    '<div class="footer">تاريخ الطباعة: ' + new Date().toLocaleString('ar-EG') + '</div>' +
    '<div class="actions">' +
    '<button onclick="window.print()">🖨️ طباعة / حفظ PDF</button>' +
    '<button class="close" onclick="window.close()">إغلاق</button>' +
    '</div>' +
    '</body></html>'
  );
  w.document.close();
}
/* ==========================================================
   الجزء 4: تقرير المصروفات التفصيلي (جديد)
   ========================================================== */

function openExpensesDetailReport() {
  if (state.role !== 'manager') return showNotification('هذه العملية للمدير فقط', 'warning');
  
  const modal = document.getElementById('expensesReportModal');
  if (!modal) return;
  
  // القيم الافتراضية: الشهر الحالي
  setExpenseReportPeriod('currentMonth');
  modal.style.display = 'flex';
}

function closeExpensesReportModal() {
  const modal = document.getElementById('expensesReportModal');
  if (modal) modal.style.display = 'none';
}

function setExpenseReportPeriod(period) {
  const end = today();
  const d = new Date(end + 'T12:00:00');
  let from = '';
  
  if (period === 'today') from = end;
  if (period === 'week') { d.setDate(d.getDate() - 6); from = d.toISOString().slice(0, 10); }
  if (period === 'month') { d.setDate(d.getDate() - 29); from = d.toISOString().slice(0, 10); }
  if (period === 'currentMonth') {
    const now = new Date();
    from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  }
  if (period === 'year') {
    const now = new Date();
    from = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
  }
  if (period === 'all') { from = ''; }
  
  document.getElementById('expReportFrom').value = from;
  document.getElementById('expReportTo').value = period === 'all' ? '' : end;
}

async function printExpensesDetail() {
  const from = document.getElementById('expReportFrom').value || '';
  const to = document.getElementById('expReportTo').value || '';
  const settings = state.storeSettings;
  const cur = settings.currency || 'ج.م';

  closeExpensesReportModal();

  // فلترة المصروفات
  const filtered = state.expenses.filter(function(e) {
    if (from && e.date < from) return false;
    if (to && e.date > to) return false;
    return true;
  });

  if (filtered.length === 0) {
    return showNotification('لا توجد مصروفات في الفترة المحددة', 'warning');
  }

  // حساب الإجماليات
  const totalAmount = filtered.reduce(function(sum, e) { return sum + e.amount; }, 0);
  const count = filtered.length;
  const avg = totalAmount / count;

  // تجميع حسب البند
  const byCategory = {};
  filtered.forEach(function(e) {
    const key = e.name.trim();
    if (!byCategory[key]) byCategory[key] = { count: 0, total: 0 };
    byCategory[key].count += 1;
    byCategory[key].total += e.amount;
  });

  // ترتيب البنود
  const sortedCategories = Object.keys(byCategory).map(function(k) {
    return { name: k, count: byCategory[k].count, total: byCategory[k].total, percent: (byCategory[k].total / totalAmount * 100) };
  }).sort(function(a, b) { return b.total - a.total; });

  // البنود الصغيرة (< 3%) تتجمع في "أخرى"
  const bigCategories = sortedCategories.filter(function(c) { return c.percent >= 3; });
  const smallCategories = sortedCategories.filter(function(c) { return c.percent < 3; });
  
  if (smallCategories.length > 0) {
    const otherTotal = smallCategories.reduce(function(sum, c) { return sum + c.total; }, 0);
    const otherCount = smallCategories.reduce(function(sum, c) { return sum + c.count; }, 0);
    bigCategories.push({
      name: 'أخرى',
      count: otherCount,
      total: otherTotal,
      percent: (otherTotal / totalAmount * 100)
    });
  }

  // أعلى بند
  const topCategory = sortedCategories[0];

  // التوزيع اليومي
  const byDay = {};
  filtered.forEach(function(e) {
    if (!byDay[e.date]) byDay[e.date] = 0;
    byDay[e.date] += e.amount;
  });
  const sortedDays = Object.keys(byDay).sort();

  // ألوان الرسم الدائري
  const colors = [
    '#176b70', '#198754', '#d6a84f', '#c0392b', '#1769aa',
    '#e58a16', '#687585', '#8e44ad', '#16a085', '#e74c3c',
    '#3498db', '#9b59b6'
  ];

  // بناء الرسم الدائري
  const labels = bigCategories.map(function(c) { return c.name; });
  const data = bigCategories.map(function(c) { return c.total; });
  const bgColors = bigCategories.map(function(c, i) { return colors[i % colors.length]; });

  const periodText = (from || 'البداية') + ' ← ' + (to || 'الآن');

  // بناء HTML للتقرير
  const w = window.open('', '_blank');
  if (!w) return showNotification('اسمح بالنوافذ المنبثقة', 'warning');

  // الرسم الدائري كـ Base64 (نولّده بـ Chart.js في نافذة الطباعة)
  const pieChartId = 'pieChart_' + Date.now();
  const barChartId = 'barChart_' + Date.now();

  const logoHTML = settings.logo
    ? '<img src="' + settings.logo + '" style="max-height:70px;max-width:170px;background:#fff;padding:5px;border-radius:8px">'
    : '';

  // جدول التفاصيل
  let detailsRows = '';
  filtered.slice().sort(function(a, b) { return String(b.date).localeCompare(String(a.date)); }).forEach(function(e) {
    detailsRows += '<tr>' +
      '<td>' + escapeHTML(e.date) + '</td>' +
      '<td>' + escapeHTML(e.name) + '</td>' +
      '<td style="text-align:center"><b>' + e.amount.toFixed(2) + ' ' + cur + '</b></td>' +
      '<td>' + escapeHTML(e.notes || '-') + '</td>' +
      '</tr>';
  });

  // جدول الترتيب
  let rankingRows = '';
  sortedCategories.forEach(function(c, i) {
    const pctBar = '█'.repeat(Math.round(c.percent / 4));
    rankingRows += '<tr>' +
      '<td>' + (i + 1) + '</td>' +
      '<td><b>' + escapeHTML(c.name) + '</b></td>' +
      '<td>' + c.count + '</td>' +
      '<td>' + c.total.toFixed(2) + ' ' + cur + '</td>' +
      '<td><b>' + c.percent.toFixed(1) + '%</b></td>' +
      '</tr>';
  });

  // جدول المتكررة
  let repeatedRows = '';
  sortedCategories.filter(function(c) { return c.count > 1; }).forEach(function(c) {
    repeatedRows += '<tr>' +
      '<td>' + escapeHTML(c.name) + '</td>' +
      '<td>' + c.count + '</td>' +
      '<td>' + c.total.toFixed(2) + ' ' + cur + '</td>' +
      '<td>' + (c.total / c.count).toFixed(2) + ' ' + cur + '</td>' +
      '</tr>';
  });

  w.document.write(
    '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">' +
    '<title>تقرير المصروفات التفصيلي</title>' +
    '<script src="https://cdn.jsdelivr.net/npm/chart.js"><\/script>' +
    '<style>' +
    '*{box-sizing:border-box;margin:0;padding:0}' +
    'body{font-family:Tahoma,Arial,sans-serif;background:#e8edf3;padding:20px;color:#203447;line-height:1.5}' +
    '.report{max-width:900px;margin:auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 10px 30px #0002}' +
    '.head{background:linear-gradient(125deg,#142f46,#176b70);color:#fff;padding:25px 30px;display:flex;justify-content:space-between;align-items:center;border-bottom:4px solid #d6a84f;gap:20px}' +
    '.head h1{margin:0 0 8px;font-size:24px}' +
    '.head p{margin:3px 0;font-size:13px;opacity:.95}' +
    '.head-right{flex-shrink:0}' +
    '.title-bar{text-align:center;font-size:22px;font-weight:900;color:#17364c;margin:20px 30px;padding:15px;background:linear-gradient(135deg,#edf3f9,#dbe6ee);border-radius:12px;border-right:5px solid #176b70}' +
    '.period-info{padding:12px 30px;background:#f8fafb;border-bottom:1px solid #dce3ec;text-align:center;font-size:14px;color:#344e62}' +
    '.body{padding:20px 30px}' +
    '.section-title{font-size:16px;font-weight:800;color:#17364c;margin:25px 0 12px;padding:10px 14px;background:#edf3f9;border-radius:8px;border-right:4px solid #176b70}' +
    '.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:20px}' +
    '.stat{padding:15px;background:linear-gradient(135deg,#d0e2ed,#bcd5e4);border:1px solid #8fb2c8;border-radius:12px;text-align:center}' +
    '.stat h4{margin:0 0 8px;font-size:13px;color:#344e62;font-weight:700}' +
    '.stat p{margin:0;font-size:20px;font-weight:900;color:#17364c}' +
    '.stat.top{background:linear-gradient(135deg,#c8e5d2,#a9d5bb);border-color:#8ab99f}' +
    '.stat.top p{color:#17643a}' +
    '.chart-container{background:#fff;border:1px solid #dce3ec;border-radius:12px;padding:20px;margin-bottom:20px;position:relative;height:320px}' +
    'table{width:100%;border-collapse:collapse;margin-bottom:15px}' +
    'th{background:#17364c;color:#fff;padding:11px;text-align:right;font-size:13px}' +
    'td{padding:9px 11px;border-bottom:1px solid #e9eef2;font-size:13px}' +
    'tbody tr:nth-child(even){background:#f8fafb}' +
    'tbody tr:hover{background:#f0f8f8}' +
    '.total-row{background:linear-gradient(135deg,#d0e2ed,#bcd5e4)!important;font-weight:900}' +
    '.total-row td{font-size:15px;color:#17364c}' +
    '.actions{max-width:900px;margin:20px auto 0;display:flex;gap:12px;justify-content:center;flex-wrap:wrap}' +
    '.actions button{padding:12px 24px;border:0;border-radius:10px;font-weight:700;cursor:pointer;font-size:15px;font-family:inherit}' +
    '.btn-print{background:#176b70;color:#fff}' +
    '.btn-excel{background:#198754;color:#fff}' +
    '.btn-close{background:#687585;color:#fff}' +
    '.footer{padding:15px 30px;text-align:center;background:#f8fafb;border-top:1px dashed #dce3ec;font-size:12px;color:#687b8b}' +
    '@media print{body{background:#fff;padding:0}.actions{display:none}.report{box-shadow:none;border-radius:0}.chart-container{page-break-inside:avoid}}' +
    '@media(max-width:600px){.head{flex-direction:column;text-align:center}.body{padding:15px}.stats-grid{grid-template-columns:1fr 1fr}.chart-container{height:280px}}' +
    '</style></head><body>' +
    
    '<div class="report">' +
    
    '<div class="head">' +
    '<div>' +
    '<h1>' + escapeHTML(settings.name) + '</h1>' +
    (settings.phone ? '<p>📞 ' + escapeHTML(settings.phone) + '</p>' : '') +
    (settings.address ? '<p>📍 ' + escapeHTML(settings.address) + '</p>' : '') +
    (settings.taxNumber ? '<p>الرقم الضريبي: ' + escapeHTML(settings.taxNumber) + '</p>' : '') +
    '</div>' +
    '<div class="head-right">' + logoHTML + '</div>' +
    '</div>' +
    
    '<div class="title-bar">💸 تقرير المصروفات التفصيلي</div>' +
    
    '<div class="period-info">📅 الفترة: <b>' + escapeHTML(periodText) + '</b></div>' +
    
    '<div class="body">' +
    
    // الملخص السريع
    '<div class="stats-grid">' +
    '<div class="stat"><h4>💰 إجمالي المصروفات</h4><p>' + totalAmount.toFixed(2) + ' ' + cur + '</p></div>' +
    '<div class="stat"><h4>📊 عدد البنود</h4><p>' + count + '</p></div>' +
    '<div class="stat"><h4>📈 متوسط المصروف</h4><p>' + avg.toFixed(2) + ' ' + cur + '</p></div>' +
    '<div class="stat top"><h4>🏆 أعلى بند</h4><p style="font-size:16px">' + escapeHTML(topCategory.name) + '</p><p style="font-size:14px;margin-top:5px">' + topCategory.total.toFixed(2) + ' ' + cur + '</p></div>' +
    '</div>' +
    
    // الرسم الدائري
    '<div class="section-title">🔵 توزيع المصروفات حسب البند</div>' +
    '<div class="chart-container"><canvas id="' + pieChartId + '"></canvas></div>' +
    
    // ترتيب البنود
    '<div class="section-title">🏆 ترتيب البنود من الأعلى للأقل</div>' +
    '<table><thead><tr><th>#</th><th>البند</th><th>مرات</th><th>الإجمالي</th><th>النسبة</th></tr></thead><tbody>' +
    rankingRows +
    '<tr class="total-row"><td colspan="3">الإجمالي</td><td>' + totalAmount.toFixed(2) + ' ' + cur + '</td><td>100%</td></tr>' +
    '</tbody></table>' +
    
    // ملخص البنود المتكررة
    (repeatedRows ?
      '<div class="section-title">🔁 البنود المتكررة</div>' +
      '<table><thead><tr><th>البند</th><th>عدد المرات</th><th>الإجمالي</th><th>المتوسط</th></tr></thead><tbody>' +
      repeatedRows + '</tbody></table>'
      : '') +
    
    // التوزيع اليومي
    '<div class="section-title">📅 التوزيع اليومي</div>' +
    '<div class="chart-container"><canvas id="' + barChartId + '"></canvas></div>' +
    
    // التفاصيل
    '<div class="section-title">📋 تفاصيل كل مصروف</div>' +
    '<table><thead><tr><th>التاريخ</th><th>البند</th><th style="text-align:center">المبلغ</th><th>ملاحظات</th></tr></thead><tbody>' +
    detailsRows +
    '<tr class="total-row"><td colspan="2">الإجمالي</td><td style="text-align:center">' + totalAmount.toFixed(2) + ' ' + cur + '</td><td></td></tr>' +
    '</tbody></table>' +
    
    '</div>' +
    
    '<div class="footer">' +
    'تم إنشاء التقرير في: ' + new Date().toLocaleString('ar-EG') +
    '</div>' +
    
    '</div>' +
    
    '<div class="actions">' +
    '<button class="btn-print" onclick="window.print()">🖨️ طباعة / حفظ PDF</button>' +
    '<button class="btn-excel" onclick="exportExpensesDetailCSV()">📊 تصدير Excel</button>' +
    '<button class="btn-close" onclick="window.close()">إغلاق</button>' +
    '</div>' +
    
    '<script>' +
    'window.onload = function() {' +
      // الرسم الدائري
      'var pieCtx = document.getElementById("' + pieChartId + '").getContext("2d");' +
      'new Chart(pieCtx, {' +
        'type: "doughnut",' +
        'data: {' +
          'labels: ' + JSON.stringify(labels) + ',' +
          'datasets: [{' +
            'data: ' + JSON.stringify(data) + ',' +
            'backgroundColor: ' + JSON.stringify(bgColors) + ',' +
            'borderColor: "#fff",' +
            'borderWidth: 3' +
          '}]' +
        '},' +
        'options: {' +
          'responsive: true,' +
          'maintainAspectRatio: false,' +
          'plugins: {' +
            'legend: { position: "left", labels: { font: { size: 14, family: "Tahoma" }, padding: 12 } },' +
            'tooltip: {' +
              'callbacks: {' +
                'label: function(context) {' +
                  'var total = context.dataset.data.reduce(function(a, b) { return a + b; }, 0);' +
                  'var val = context.parsed;' +
                  'var pct = (val / total * 100).toFixed(1);' +
                  'return context.label + ": " + val.toFixed(2) + " ' + cur + ' (" + pct + "%)";' +
                '}' +
              '}' +
            '}' +
          '}' +
        '}' +
      '});' +
      // رسم الأعمدة (التوزيع اليومي)
      'var barCtx = document.getElementById("' + barChartId + '").getContext("2d");' +
      'new Chart(barCtx, {' +
        'type: "bar",' +
        'data: {' +
          'labels: ' + JSON.stringify(sortedDays) + ',' +
          'datasets: [{' +
            'label: "المصروفات اليومية",' +
            'data: ' + JSON.stringify(sortedDays.map(function(d) { return byDay[d]; })) + ',' +
            'backgroundColor: "#176b70",' +
            'borderRadius: 6' +
          '}]' +
        '},' +
        'options: {' +
          'responsive: true,' +
          'maintainAspectRatio: false,' +
          'plugins: { legend: { display: false } },' +
          'scales: {' +
            'y: { beginAtZero: true, ticks: { callback: function(v) { return v.toFixed(0); } } },' +
            'x: { grid: { display: false } }' +
          '}' +
        '}' +
      '});' +
    '};' +
    '<\/script>' +
    
    '</body></html>'
  );
  w.document.close();

  // حفظ بيانات التقرير للتصدير لاحقًا
  window.__lastExpensesReport = { filtered: filtered, from: from, to: to };
}

function exportExpensesDetailCSV() {
  const data = window.__lastExpensesReport;
  if (!data || !data.filtered || data.filtered.length === 0) {
    return showNotification('لا توجد بيانات للتصدير', 'warning');
  }
  const settings = state.storeSettings;
  const cur = settings.currency || 'ج.م';
  
  const sorted = data.filtered.slice().sort(function(a, b) { return String(a.date).localeCompare(String(b.date)); });
  
  let csv = '\uFEFF';
  csv += '"' + settings.name + ' - تقرير المصروفات التفصيلي"\r\n';
  csv += '"الفترة: ' + (data.from || 'البداية') + ' إلى ' + (data.to || 'الآن') + '"\r\n';
  csv += '"تاريخ التصدير: ' + new Date().toLocaleString('ar-EG') + '"\r\n\r\n';
  csv += '"التاريخ","البند","المبلغ (' + cur + ')","ملاحظات"\r\n';
  
  let total = 0;
  sorted.forEach(function(e) {
    total += e.amount;
    csv += '"' + e.date + '","' + String(e.name).replace(/"/g, '""') + '","' + e.amount.toFixed(2) + '","' + String(e.notes || '').replace(/"/g, '""') + '"\r\n';
  });
  csv += '"الإجمالي","","' + total.toFixed(2) + '",""\r\n';
  
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'expenses-detail-' + today() + '.csv';
  document.body.appendChild(a);
  a.click();
  setTimeout(function() { a.remove(); URL.revokeObjectURL(url); }, 100);
  
  showNotification('تم تصدير الملف ✅');
}

/* ============ نهاية الجزء 4 ============ */
/* ==========================================================
   الجزء 5: التنبيهات الذكية + الهدف الشهري
   ========================================================== */

/* ----------------- 20. التنبيهات الذكية ----------------- */

function renderSmartAlerts() {
  const container = document.getElementById('smartAlerts');
  if (!container) return;
  
  let alerts = [];

  // 1) تنبيه المخزون المنخفض
  const lowStock = state.products.filter(function(p) {
    return Number(p.stock) <= Number(p.minStock || 5);
  });
  
  if (lowStock.length > 0) {
    const outOfStock = lowStock.filter(function(p) { return Number(p.stock) <= 0; });
    let msg, subtitle;
    
    if (outOfStock.length > 0) {
      msg = '⚠️ ' + outOfStock.length + ' منتج نفذ تماماً من المخزون';
      subtitle = 'و ' + (lowStock.length - outOfStock.length) + ' منتج قارب على النفاذ';
    } else {
      msg = '⚠️ ' + lowStock.length + ' منتج وصل لحد التنبيه';
      subtitle = 'راجع المخزون وأعد الطلب';
    }
    
    alerts.push({
      type: 'danger',
      icon: '📦',
      title: msg,
      subtitle: subtitle,
      actionText: 'عرض المنتجات',
      actionFn: 'showPage(\'inventoryHub\'); switchInventoryTab(\'products\');'
    });
  }

  // 2) تنبيه الديون المتأخرة (أكثر من 30 يوم)
  const now = new Date();
  const oldDebts = state.customers.filter(function(c) {
    if (!c.openingDebt || c.openingDebt <= 0) return false;
    // نأخذ أقدم فاتورة غير مدفوعة
    const custSales = state.sales.filter(function(s) {
      return s.customerId === c.id && s.remaining > 0;
    });
    if (custSales.length === 0) {
      // دين افتتاحي بدون فاتورة
      return false;
    }
    const oldest = custSales.reduce(function(oldest, s) {
      const d = new Date(s.date).getTime();
      return (!oldest || d < oldest) ? d : oldest;
    }, null);
    const diffDays = (now.getTime() - oldest) / (1000 * 60 * 60 * 24);
    return diffDays >= 30;
  });

  if (oldDebts.length > 0) {
    const totalOldDebt = oldDebts.reduce(function(sum, c) { return sum + c.openingDebt; }, 0);
    alerts.push({
      type: 'warning',
      icon: '💰',
      title: '💰 ' + oldDebts.length + ' عميل عليهم ديون متأخرة (30+ يوم)',
      subtitle: 'الإجمالي: ' + totalOldDebt.toFixed(2) + ' ' + state.storeSettings.currency,
      actionText: 'عرض العملاء',
      actionFn: 'showPage(\'partnersHub\'); switchPartnersTab(\'customers\');'
    });
  }

  // 3) تنبيه الفواتير غير المسددة
  const dueSales = state.sales.filter(function(s) { return s.remaining > 0; });
  if (dueSales.length > 0) {
    const totalDue = dueSales.reduce(function(sum, s) { return sum + s.remaining; }, 0);
    alerts.push({
      type: 'info',
      icon: '🧾',
      title: '🧾 ' + dueSales.length + ' فاتورة عليها متبقي',
      subtitle: 'الإجمالي: ' + totalDue.toFixed(2) + ' ' + state.storeSettings.currency,
      actionText: 'عرض المبيعات',
      actionFn: 'showPage(\'sales\');'
    });
  }

  // 4) تنبيه مستحقات الموردين
  const supplierDue = state.suppliers.filter(function(s) { return (s.openingDebt || 0) > 0; });
  if (supplierDue.length > 0) {
    const totalSup = supplierDue.reduce(function(sum, s) { return sum + s.openingDebt; }, 0);
    alerts.push({
      type: 'info',
      icon: '🏭',
      title: '🏭 مستحقات موردين: ' + totalSup.toFixed(2) + ' ' + state.storeSettings.currency,
      subtitle: supplierDue.length + ' مورد عليهم مستحقات',
      actionText: 'عرض الموردين',
      actionFn: 'showPage(\'partnersHub\'); switchPartnersTab(\'suppliers\');'
    });
  }

  // بناء الـ HTML
  if (alerts.length === 0) {
    container.innerHTML =
      '<div class="smart-alert info">' +
      '<span class="alert-icon">✨</span>' +
      '<div class="alert-content">' +
      '<div class="alert-title">كل شيء تمام!</div>' +
      '<div class="alert-subtitle">مفيش تنبيهات حالياً</div>' +
      '</div>' +
      '</div>';
    return;
  }

  let html = '<div class="card">';
  html += '<h3>🔔 تنبيهات ذكية</h3>';
  alerts.forEach(function(a) {
    html += '<div class="smart-alert ' + a.type + '">' +
      '<span class="alert-icon">' + a.icon + '</span>' +
      '<div class="alert-content">' +
      '<div class="alert-title">' + a.title + '</div>' +
      '<div class="alert-subtitle">' + a.subtitle + '</div>' +
      '</div>' +
      '<button class="alert-action" onclick="' + a.actionFn + '">' + a.actionText + '</button>' +
      '</div>';
  });
  html += '</div>';
  container.innerHTML = html;
}

/* ----------------- 21. الهدف الشهري ----------------- */

function renderMonthlyGoal() {
  const container = document.getElementById('monthlyGoalCard');
  if (!container) return;

  const goal = parseFloat(state.storeSettings.monthlyGoal) || 0;
  if (goal <= 0) {
    container.innerHTML = '';
    return;
  }

  // حساب مبيعات الشهر الحالي
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const monthEnd = now.toISOString().slice(0, 10);

  const monthSales = state.sales.filter(function(s) {
    const d = (s.date || '').split('T')[0];
    return d >= monthStart && d <= monthEnd;
  });

  const actualSales = monthSales.reduce(function(sum, s) { return sum + s.total; }, 0);
  const percent = Math.min(100, (actualSales / goal * 100));
  const remaining = Math.max(0, goal - actualSales);
  const cur = state.storeSettings.currency;

  // حساب المتوقع في نهاية الشهر
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const projectedSales = dayOfMonth > 0 ? (actualSales / dayOfMonth) * daysInMonth : 0;

  // تحديد اللون والحالة
  let barClass = '';
  let badgeClass = 'on-track';
  let badgeText = '🎯 على المسار';

  const expectedProgress = (dayOfMonth / daysInMonth) * 100;
  const diff = percent - expectedProgress;

  if (diff < -20) {
    barClass = 'danger';
    badgeClass = 'danger';
    badgeText = '🔴 متأخر جداً';
  } else if (diff < -5) {
    barClass = 'warning';
    badgeClass = 'behind';
    badgeText = '🟡 متأخر قليلاً';
  } else if (percent >= 100) {
    badgeText = '🏆 تم تحقيق الهدف!';
    badgeClass = 'on-track';
  }

  container.innerHTML =
    '<div class="goal-card">' +
    '<h3>🎯 هدف المبيعات الشهري <span class="goal-badge ' + badgeClass + '">' + badgeText + '</span></h3>' +
    '<div class="goal-header">' +
    '<div class="goal-values">' +
    '<div class="goal-value"><div class="label">المبيعات</div><div class="value">' + actualSales.toFixed(2) + ' ' + cur + '</div></div>' +
    '<div class="goal-value"><div class="label">الهدف</div><div class="value">' + goal.toFixed(2) + ' ' + cur + '</div></div>' +
    '<div class="goal-value ' + (percent >= 100 ? 'done' : '') + '"><div class="label">المتبقي</div><div class="value">' + remaining.toFixed(2) + ' ' + cur + '</div></div>' +
    '</div>' +
    '<div class="goal-percent ' + (barClass === 'danger' ? 'danger' : barClass === 'warning' ? 'warning' : '') + '">' + percent.toFixed(1) + '%</div>' +
    '</div>' +
    '<div class="goal-bar-container">' +
    '<div class="goal-bar ' + barClass + '" style="width: ' + percent + '%">' +
    (percent >= 15 ? percent.toFixed(0) + '%' : '') +
    '</div>' +
    '</div>' +
    '<div class="goal-footer">' +
    '<span>📅 الشهر: ' + dayOfMonth + ' / ' + daysInMonth + ' يوم</span>' +
    '<span>📊 المتوقع نهاية الشهر: <b>' + projectedSales.toFixed(2) + ' ' + cur + '</b></span>' +
    '</div>' +
    '</div>';
}

/* ----------------- 22. تحديث التنبيهات عند الدخول ----------------- */
function checkAlertsOnStartup() {
  const lowStock = state.products.filter(function(p) {
    return Number(p.stock) <= Number(p.minStock || 5);
  }).length;

  if (lowStock === 0) return;

  let alertDone = false;

  const fireAlert = function() {
    if (alertDone) return;
    alertDone = true;

    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    setTimeout(function() {
      showNotification('⚠️ ' + lowStock + ' منتج بحاجة لإعادة طلب', 'warning');
      playBeep(false);
    }, 200);

    document.removeEventListener('touchstart', fireAlert);
    document.removeEventListener('click', fireAlert);
  };

  document.addEventListener('touchstart', fireAlert, { once: true, passive: true });
  document.addEventListener('click', fireAlert, { once: true });
}

/* ----------------- 23. تحديث الإعدادات (الهدف) ----------------- */

function loadMonthlyGoal() {
  const el = document.getElementById('storeMonthlyGoal');
  if (el) el.value = state.storeSettings.monthlyGoal || '';
}

// تعديل saveStoreSettings عشان يحفظ الهدف
const originalSaveStoreSettings = saveStoreSettings;
saveStoreSettings = function() {
  const goalEl = document.getElementById('storeMonthlyGoal');
  if (goalEl) {
    state.storeSettings.monthlyGoal = parseFloat(goalEl.value) || 0;
  }
  originalSaveStoreSettings();
};

// تعديل loadStoreSettings عشان يحمّل الهدف
const originalLoadStoreSettings = loadStoreSettings;
loadStoreSettings = function() {
  originalLoadStoreSettings();
  loadMonthlyGoal();
};

// تعديل renderDashboard عشان يضيف التنبيهات والهدف
const originalRenderDashboard = renderDashboard;
renderDashboard = function() {
  originalRenderDashboard();
  renderSmartAlerts();
  renderMonthlyGoal();
};

/* ============ نهاية الجزء 5 ============ */
/* ==========================================================
   الجزء 6: مقارنة الفترات
   ========================================================== */

let comparisonChartInstance = null;

function onCompareTypeChange() {
  const type = document.getElementById('compareType').value;
  const customDiv = document.getElementById('compareCustomPeriods');
  if (customDiv) {
    customDiv.style.display = (type === 'custom') ? 'block' : 'none';
  }
}

function getCompareRanges() {
  const type = document.getElementById('compareType').value;
  const now = new Date();

  if (type === 'monthVsPrev') {
    // الشهر الحالي vs الشهر السابق
    const currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const currentEnd = now;
    const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    return {
      labelA: 'الشهر الحالي',
      labelB: 'الشهر السابق',
      fromA: currentStart.toISOString().slice(0, 10),
      toA: currentEnd.toISOString().slice(0, 10),
      fromB: prevStart.toISOString().slice(0, 10),
      toB: prevEnd.toISOString().slice(0, 10)
    };
  }

  if (type === 'monthVsYear') {
    // الشهر الحالي vs نفس الشهر من السنة السابقة
    const currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const currentEnd = now;
    const yearAgoStart = new Date(now.getFullYear() - 1, now.getMonth(), 1);
    const yearAgoEnd = new Date(now.getFullYear() - 1, now.getMonth() + 1, 0);

    return {
      labelA: 'الشهر الحالي',
      labelB: 'نفس الشهر (سنة سابقة)',
      fromA: currentStart.toISOString().slice(0, 10),
      toA: currentEnd.toISOString().slice(0, 10),
      fromB: yearAgoStart.toISOString().slice(0, 10),
      toB: yearAgoEnd.toISOString().slice(0, 10)
    };
  }

  // custom
  return {
    labelA: 'الفترة الأولى',
    labelB: 'الفترة الثانية',
    fromA: document.getElementById('compareAFrom').value,
    toA: document.getElementById('compareATo').value,
    fromB: document.getElementById('compareBFrom').value,
    toB: document.getElementById('compareBTo').value
  };
}

function calcPeriodStats(from, to) {
  const sales = state.sales.filter(function(s) {
    const d = (s.date || '').split('T')[0];
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });

  const expenses = state.expenses.filter(function(e) {
    const d = e.date || '';
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });

  const returns = state.returns.filter(function(r) {
    const d = (r.date || '').split('T')[0];
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });

  const totalSales = sales.reduce(function(sum, s) { return sum + s.total; }, 0);
  const count = sales.length;
  const avgInvoice = count > 0 ? totalSales / count : 0;

  let totalCost = 0;
  sales.forEach(function(s) {
    s.items.forEach(function(i) { totalCost += (i.cost || 0) * i.qty; });
  });

  const totalExpenses = expenses.reduce(function(sum, e) { return sum + e.amount; }, 0);
  const netProfit = totalSales - totalCost - totalExpenses;

  const totalDiscount = sales.reduce(function(sum, s) { return sum + (s.discount || 0); }, 0);

  return {
    totalSales: totalSales,
    count: count,
    avgInvoice: avgInvoice,
    totalCost: totalCost,
    totalExpenses: totalExpenses,
    netProfit: netProfit,
    totalDiscount: totalDiscount,
    returnsCount: returns.length
  };
}

function formatDelta(valA, valB) {
  if (valB === 0) {
    if (valA === 0) return { text: '—', class: '', percent: 0 };
    return { text: '+∞', class: 'delta-up', percent: 100 };
  }
  const diff = valA - valB;
  const percent = (diff / valB) * 100;
  const sign = diff > 0 ? '+' : '';
  const cls = diff > 0 ? 'delta-up' : (diff < 0 ? 'delta-down' : 'delta-flat');
  return {
    text: sign + percent.toFixed(1) + '%',
    class: cls,
    percent: percent
  };
}

function renderComparison() {
  const ranges = getCompareRanges();

  if (!ranges.fromA || !ranges.toA || !ranges.fromB || !ranges.toB) {
    return showNotification('أكمل الفترتين أولاً', 'warning');
  }

  const statsA = calcPeriodStats(ranges.fromA, ranges.toA);
  const statsB = calcPeriodStats(ranges.fromB, ranges.toB);
  const cur = state.storeSettings.currency;

  const metrics = [
    { key: 'totalSales', label: '💰 إجمالي المبيعات', a: statsA.totalSales, b: statsB.totalSales, higherBetter: true },
    { key: 'count', label: '🧾 عدد الفواتير', a: statsA.count, b: statsB.count, higherBetter: true },
    { key: 'avgInvoice', label: '📊 متوسط الفاتورة', a: statsA.avgInvoice, b: statsB.avgInvoice, higherBetter: true },
    { key: 'totalCost', label: '📦 إجمالي التكلفة', a: statsA.totalCost, b: statsB.totalCost, higherBetter: false },
    { key: 'totalExpenses', label: '💸 المصروفات', a: statsA.totalExpenses, b: statsB.totalExpenses, higherBetter: false },
    { key: 'netProfit', label: '🎯 صافي الربح', a: statsA.netProfit, b: statsB.netProfit, higherBetter: true },
    { key: 'totalDiscount', label: '🏷️ إجمالي الخصومات', a: statsA.totalDiscount, b: statsB.totalDiscount, higherBetter: false },
    { key: 'returnsCount', label: '↩️ عدد المرتجعات', a: statsA.returnsCount, b: statsB.returnsCount, higherBetter: false }
  ];

  // بناء الجدول
  let tableHTML = '<div class="table-wrap"><table class="data-table"><thead><tr>' +
    '<th>المؤشر</th>' +
    '<th>' + ranges.labelA + '</th>' +
    '<th>' + ranges.labelB + '</th>' +
    '<th>الفرق</th>' +
    '</tr></thead><tbody>';

  metrics.forEach(function(m) {
  const delta = formatDelta(m.a, m.b, m.higherBetter);
  
  tableHTML += '<tr>' +
    '<td><b>' + m.label + '</b></td>' +
    '<td>' + (m.key === 'count' || m.key === 'returnsCount' ? m.a : m.a.toFixed(2) + ' ' + cur) + '</td>' +
    '<td>' + (m.key === 'count' || m.key === 'returnsCount' ? m.b : m.b.toFixed(2) + ' ' + cur) + '</td>' +
    '<td class="' + delta.class + '"><b>' + delta.text + '</b></td>' +
    '</tr>';
});

  tableHTML += '</tbody></table></div>';

  // بناء التحليل النصي
  const salesDelta = formatDelta(statsA.totalSales, statsB.totalSales, true);
const profitDelta = formatDelta(statsA.netProfit, statsB.netProfit, true);
const expenseDelta = formatDelta(statsA.totalExpenses, statsB.totalExpenses, false);

  let analysis = '<div class="card" style="background:linear-gradient(135deg,#e7f0fa,#d5e5f5);border-color:#8fb2c8">';
  analysis += '<h3>💡 التحليل السريع</h3>';

  // المبيعات
  if (statsA.totalSales > statsB.totalSales) {
    analysis += '<p>✅ المبيعات <b>ارتفعت</b> بنسبة <b style="color:#198754">' + Math.abs(salesDelta.percent).toFixed(1) + '%</b> مقارنة بـ ' + ranges.labelB + '.</p>';
  } else if (statsA.totalSales < statsB.totalSales) {
    analysis += '<p>⚠️ المبيعات <b>انخفضت</b> بنسبة <b style="color:#c0392b">' + Math.abs(salesDelta.percent).toFixed(1) + '%</b> مقارنة بـ ' + ranges.labelB + '.</p>';
  } else {
    analysis += '<p>➖ المبيعات <b>مستقرة</b> مقارنة بـ ' + ranges.labelB + '.</p>';
  }

  // الأرباح
  if (statsA.netProfit > statsB.netProfit) {
    analysis += '<p>✅ الأرباح <b>ارتفعت</b> بنسبة <b style="color:#198754">' + Math.abs(profitDelta.percent).toFixed(1) + '%</b>.</p>';
  } else if (statsA.netProfit < statsB.netProfit) {
    analysis += '<p>⚠️ الأرباح <b>انخفضت</b> بنسبة <b style="color:#c0392b">' + Math.abs(profitDelta.percent).toFixed(1) + '%</b>.</p>';
  }

  // المصروفات
  if (statsA.totalExpenses > statsB.totalExpenses) {
    analysis += '<p>⚠️ المصروفات <b>ارتفعت</b> بنسبة <b style="color:#e58a16">' + Math.abs(expenseDelta.percent).toFixed(1) + '%</b>.</p>';
  } else if (statsA.totalExpenses < statsB.totalExpenses) {
    analysis += '<p>✅ المصروفات <b>انخفضت</b> بنسبة <b style="color:#198754">' + Math.abs(expenseDelta.percent).toFixed(1) + '%</b>.</p>';
  }

  analysis += '</div>';

  // الرسم البياني
  const chartHTML = '<div class="card mt-20">' +
    '<h3>📊 المقارنة البيانية</h3>' +
    '<div id="compareChartContainer" style="height:300px;position:relative"><canvas id="compareChart"></canvas></div>' +
    '</div>';

  // عرض النتائج
  const container = document.getElementById('compareResult');
  container.innerHTML =
    '<div class="card mt-20">' +
    '<h3>📋 تفاصيل المقارنة</h3>' +
    '<p class="muted" style="margin-bottom:10px">' +
    '🅰️ ' + ranges.labelA + ': من ' + ranges.fromA + ' إلى ' + ranges.toA +
    '<br>🅱️ ' + ranges.labelB + ': من ' + ranges.fromB + ' إلى ' + ranges.toB +
    '</p>' +
    tableHTML +
    '</div>' +
    analysis +
    chartHTML;

  // رسم بياني (Bar Chart)
  setTimeout(function() { drawComparisonChart(metrics, ranges); }, 100);

  // حفظ البيانات للطباعة
  window.__lastComparison = {
    ranges: ranges,
    statsA: statsA,
    statsB: statsB,
    metrics: metrics
  };
}

function drawComparisonChart(metrics, ranges) {
  if (typeof Chart === 'undefined') return;
  const canvas = document.getElementById('compareChart');
  if (!canvas) return;

  if (comparisonChartInstance) comparisonChartInstance.destroy();

  // نستخدم 4 مؤشرات رئيسية للرسم
  const chartMetrics = [
    { label: 'المبيعات', a: metrics[0].a, b: metrics[0].b },
    { label: 'التكلفة', a: metrics[3].a, b: metrics[3].b },
    { label: 'المصروفات', a: metrics[4].a, b: metrics[4].b },
    { label: 'الربح', a: metrics[5].a, b: metrics[5].b }
  ];

  comparisonChartInstance = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: chartMetrics.map(function(m) { return m.label; }),
      datasets: [
        {
          label: ranges.labelA,
          data: chartMetrics.map(function(m) { return m.a; }),
          backgroundColor: '#176b70',
          borderRadius: 6
        },
        {
          label: ranges.labelB,
          data: chartMetrics.map(function(m) { return m.b; }),
          backgroundColor: '#d6a84f',
          borderRadius: 6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { font: { size: 13, family: 'Tahoma' } } }
      },
      scales: {
        y: { beginAtZero: true, ticks: { callback: function(v) { return v.toLocaleString('en-US'); } } },
        x: { grid: { display: false } }
      }
    }
  });
}

function printComparisonReport() {
  const data = window.__lastComparison;
  if (!data) return showNotification('اعرض المقارنة أولاً', 'warning');

  const settings = state.storeSettings;
  const cur = settings.currency;
  const ranges = data.ranges;
  const metrics = data.metrics;

  const logoHTML = settings.logo
    ? '<img src="' + settings.logo + '" style="max-height:70px;max-width:170px;background:#fff;padding:5px;border-radius:8px">'
    : '';

  let rowsHTML = '';
 metrics.forEach(function(m) {
  const delta = formatDelta(m.a, m.b, m.higherBetter);
  
  const colorClass = delta.class === 'delta-up' ? '#198754' : (delta.class === 'delta-down' ? '#c0392b' : '#687b8b');
  const arrow = delta.isNew ? '🆕' : (delta.percent > 0 ? '▲' : (delta.percent < 0 ? '▼' : '●'));

  rowsHTML += '<tr>' +
    '<td><b>' + m.label + '</b></td>' +
    '<td>' + (m.key === 'count' || m.key === 'returnsCount' ? m.a : m.a.toFixed(2) + ' ' + cur) + '</td>' +
    '<td>' + (m.key === 'count' || m.key === 'returnsCount' ? m.b : m.b.toFixed(2) + ' ' + cur) + '</td>' +
    '<td style="color:' + colorClass + ';font-weight:bold">' + arrow + ' ' + delta.text + '</td>' +
    '</tr>';
});

  const w = window.open('', '_blank');
  if (!w) return showNotification('اسمح بالنوافذ المنبثقة', 'warning');

  w.document.write(
    '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">' +
    '<title>مقارنة الفترات</title>' +
    '<style>' +
    '*{box-sizing:border-box;margin:0;padding:0}' +
    'body{font-family:Tahoma,Arial,sans-serif;background:#e8edf3;padding:20px;color:#203447}' +
    '.report{max-width:900px;margin:auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 10px 30px #0002}' +
    '.head{background:linear-gradient(125deg,#142f46,#176b70);color:#fff;padding:25px 30px;display:flex;justify-content:space-between;align-items:center;border-bottom:4px solid #d6a84f;gap:20px}' +
    '.head h1{margin:0 0 8px;font-size:24px}' +
    '.head p{margin:3px 0;font-size:13px;opacity:.95}' +
    '.title-bar{text-align:center;font-size:22px;font-weight:900;color:#17364c;margin:20px 30px;padding:15px;background:linear-gradient(135deg,#edf3f9,#dbe6ee);border-radius:12px;border-right:5px solid #176b70}' +
    '.periods{padding:12px 30px;background:#f8fafb;border-bottom:1px solid #dce3ec;font-size:13px;color:#344e62}' +
    '.periods div{margin:5px 0}' +
    '.periods .a{color:#176b70;font-weight:700}' +
    '.periods .b{color:#d6a84f;font-weight:700}' +
    '.body{padding:20px 30px}' +
    'table{width:100%;border-collapse:collapse;margin-top:15px}' +
    'th{background:#17364c;color:#fff;padding:12px;text-align:right;font-size:13px}' +
    'td{padding:11px 12px;border-bottom:1px solid #e9eef2;font-size:13px}' +
    'tbody tr:nth-child(even){background:#f8fafb}' +
    '.footer{padding:15px 30px;text-align:center;background:#f8fafb;border-top:1px dashed #dce3ec;font-size:12px;color:#687b8b}' +
    '.actions{max-width:900px;margin:20px auto 0;text-align:center}' +
    '.actions button{padding:12px 24px;border:0;border-radius:10px;font-weight:700;cursor:pointer;background:#176b70;color:#fff;font-family:inherit;font-size:15px}' +
    '@media print{body{background:#fff;padding:0}.actions{display:none}.report{box-shadow:none}}' +
    '</style></head><body>' +
    '<div class="report">' +
    '<div class="head">' +
    '<div><h1>' + escapeHTML(settings.name) + '</h1>' +
    (settings.phone ? '<p>📞 ' + escapeHTML(settings.phone) + '</p>' : '') +
    (settings.address ? '<p>📍 ' + escapeHTML(settings.address) + '</p>' : '') +
    '</div>' +
    '<div>' + logoHTML + '</div>' +
    '</div>' +
    '<div class="title-bar">📊 تقرير مقارنة الفترات</div>' +
    '<div class="periods">' +
    '<div>🅰️ <span class="a">' + escapeHTML(ranges.labelA) + ':</span> من ' + ranges.fromA + ' إلى ' + ranges.toA + '</div>' +
    '<div>🅱️ <span class="b">' + escapeHTML(ranges.labelB) + ':</span> من ' + ranges.fromB + ' إلى ' + ranges.toB + '</div>' +
    '</div>' +
    '<div class="body">' +
    '<table>' +
    '<thead><tr><th>المؤشر</th><th>' + escapeHTML(ranges.labelA) + '</th><th>' + escapeHTML(ranges.labelB) + '</th><th>الفرق</th></tr></thead>' +
    '<tbody>' + rowsHTML + '</tbody>' +
    '</table>' +
    '</div>' +
    '<div class="footer">تاريخ التقرير: ' + new Date().toLocaleString('ar-EG') + '</div>' +
    '</div>' +
    '<div class="actions"><button onclick="window.print()">🖨️ طباعة / حفظ PDF</button></div>' +
    '</body></html>'
  );
  w.document.close();
}

// ربط الدالة بـ switchFinanceTab
const __originalSwitchFinanceTab = switchFinanceTab;
switchFinanceTab = function(tabName) {
  __originalSwitchFinanceTab(tabName);
  if (tabName === 'compare') {
    document.getElementById('finTabCompare').style.display = 'block';
    // تعبئة تواريخ افتراضية
    if (!document.getElementById('compareAFrom').value) {
      const now = new Date();
      const currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
      document.getElementById('compareAFrom').value = currentStart.toISOString().slice(0, 10);
      document.getElementById('compareATo').value = now.toISOString().slice(0, 10);
      const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prevEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      document.getElementById('compareBFrom').value = prevStart.toISOString().slice(0, 10);
      document.getElementById('compareBTo').value = prevEnd.toISOString().slice(0, 10);
    }
  }
};

/* ============ نهاية الجزء 6 ============ */
/* ==========================================================
   الجزء 7: الوضع الليلي
   ========================================================== */

function toggleDarkMode() {
  const isDark = document.body.classList.toggle('dark-mode');
  localStorage.setItem('pos_darkMode', isDark ? '1' : '0');
  updateDarkModeBtn();
  showNotification(isDark ? '🌙 الوضع الليلي مُفعّل' : '☀️ الوضع النهاري مُفعّل', 'info');
}

function updateDarkModeBtn() {
  const btn = document.getElementById('darkModeBtn');
  if (!btn) return;
  const isDark = document.body.classList.contains('dark-mode');
  btn.textContent = isDark ? '☀️' : '🌙';
  btn.title = isDark ? 'الوضع النهاري' : 'الوضع الليلي';
}

function applySavedDarkMode() {
  const saved = localStorage.getItem('pos_darkMode') === '1';
  if (saved) {
    document.body.classList.add('dark-mode');
  }
  updateDarkModeBtn();
}

// تطبيق الوضع فورًا عند التحميل
document.addEventListener('DOMContentLoaded', function() {
  applySavedDarkMode();
});

// لو الصفحة اتحمّلت خلاص
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', applySavedDarkMode);
} else {
  applySavedDarkMode();
}

/* ============ نهاية الجزء 7 ============ */
/* ==========================================================
   الجزء 8: طباعة الباركود
   ========================================================== */

function openBarcodePrintModal() {
  if (state.role !== 'manager') return showNotification('هذه العملية للمدير فقط', 'warning');

  if (state.products.length === 0) {
    return showNotification('لا توجد منتجات', 'warning');
  }

  const modal = document.getElementById('barcodePrintModal');
  if (!modal) return;

  const list = document.getElementById('barcodeProductList');
  let html = '';
  state.products.forEach(function(p) {
    if (!p.barcode) {
      html += '<label style="display:flex;align-items:center;gap:8px;padding:8px;border-bottom:1px solid #e9eef2;opacity:0.5">' +
        '<input type="checkbox" disabled>' +
        '<span>' + escapeHTML(p.name) + ' <span style="color:#c0392b;font-size:11px">(بدون باركود)</span></span>' +
        '</label>';
    } else {
      html += '<label style="display:flex;align-items:center;gap:8px;padding:8px;border-bottom:1px solid #e9eef2;cursor:pointer">' +
        '<input type="checkbox" class="barcode-product-cb" value="' + p.id + '" checked>' +
        '<span><b>' + escapeHTML(p.name) + '</b> — <span style="color:#687b8b;font-size:12px">' + escapeHTML(p.barcode) + '</span></span>' +
        '</label>';
    }
  });
  list.innerHTML = html;

  modal.style.display = 'flex';
}

function closeBarcodePrintModal() {
  const modal = document.getElementById('barcodePrintModal');
  if (modal) modal.style.display = 'none';
}

function barcodeSelectAll(checked) {
  document.querySelectorAll('.barcode-product-cb').forEach(function(cb) {
    cb.checked = checked;
  });
}

async function printBarcodeLabels() {
  const selected = Array.from(document.querySelectorAll('.barcode-product-cb:checked')).map(function(cb) { return cb.value; });

  if (selected.length === 0) {
    return showNotification('اختر منتج واحد على الأقل', 'warning');
  }

  const copies = parseInt(document.getElementById('barcodeCopies').value) || 1;
  const size = document.getElementById('barcodeSize').value;
  const barcodeType = document.getElementById('barcodeType').value;

  closeBarcodePrintModal();

  const settings = state.storeSettings;
  const cur = settings.currency;

  const sizeStyles = {
    small: 'width:32%;padding:6px;margin:1px;font-size:10px;',
    medium: 'width:48%;padding:8px;margin:1px;font-size:11px;',
    large: 'width:98%;padding:12px;margin:2px;font-size:13px;'
  };

  const sizeClass = sizeStyles[size] || sizeStyles.medium;

  const productsToPrint = state.products.filter(function(p) {
    return selected.indexOf(p.id) !== -1;
  });

  showLoading('جارٍ توليد الباركود...');
  const labels = [];
  
  for (const product of productsToPrint) {
    for (let i = 0; i < copies; i++) {
      let qrHTML = '';
      let code128HTML = '';

      // QR Code
      if (barcodeType === 'qr' || barcodeType === 'both') {
        try {
          if (typeof QRCode !== 'undefined') {
            const dataUrl = await QRCode.toDataURL(String(product.barcode || product.id), {
              width: 100,
              margin: 1,
              color: { dark: '#000000', light: '#ffffff' }
            });
            qrHTML = '<img src="' + dataUrl + '" style="width:70px;height:70px;display:block;margin:3px auto">';
          }
        } catch (e) {
          qrHTML = '<div style="font-size:10px">QR: ' + escapeHTML(product.barcode) + '</div>';
        }
      }

      // Code 128
      if (barcodeType === 'code128' || barcodeType === 'both') {
        try {
          if (typeof JsBarcode !== 'undefined') {
            const svgId = 'bc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('id', svgId);
            document.body.appendChild(svg);
            JsBarcode('#' + svgId, String(product.barcode || product.id), {
              format: 'CODE128',
              width: 1.5,
              height: 40,
              displayValue: false,
              margin: 0
            });
            code128HTML = svg.outerHTML;
            svg.remove();
          }
        } catch (e) {
          code128HTML = '';
        }
      }

      labels.push({
        name: product.name,
        barcode: product.barcode,
        price: product.price,
        qr: qrHTML,
        code128: code128HTML
      });
    }
  }
  hideLoading();

  const w = window.open('', '_blank');
  if (!w) return showNotification('اسمح بالنوافذ المنبثقة', 'warning');

  let labelsHTML = '';
  labels.forEach(function(l) {
    labelsHTML += '<div class="label" style="' + sizeClass + '">' +
      '<div class="label-shop">' + escapeHTML(settings.name) + '</div>' +
      '<div class="label-name">' + escapeHTML(l.name) + '</div>' +
      l.qr +
      l.code128 +
      '<div class="label-code">' + escapeHTML(l.barcode) + '</div>' +
      '<div class="label-price">' + Number(l.price).toFixed(2) + ' ' + cur + '</div>' +
      '</div>';
  });

  w.document.write(
    '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">' +
    '<title>طباعة الباركود</title>' +
    '<style>' +
    '*{box-sizing:border-box;margin:0;padding:0}' +
    'body{font-family:Tahoma,Arial,sans-serif;background:#fff;padding:5mm;color:#000}' +
    '.sheet{display:flex;flex-wrap:wrap;gap:2mm}' +
    '.label{border:1px dashed #999;border-radius:5px;text-align:center;page-break-inside:avoid;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center}' +
    '.label-shop{font-size:8px;color:#666;margin-bottom:2px;font-weight:700}' +
    '.label-name{font-size:11px;font-weight:900;margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;width:100%}' +
    '.label svg{max-width:100%;height:auto}' +
    '.label-code{font-size:11px;font-weight:700;letter-spacing:1px;margin-top:3px;font-family:monospace}' +
    '.label-price{font-size:13px;font-weight:900;color:#17364c;margin-top:2px;border-top:1px solid #ddd;padding-top:3px;width:100%}' +
    '.actions{text-align:center;margin-top:20px;padding:15px}' +
    '.actions button{padding:12px 24px;margin:5px;border:0;border-radius:10px;font-weight:700;cursor:pointer;font-family:inherit;font-size:15px;background:#176b70;color:#fff}' +
    '@media print{body{padding:0}.actions{display:none}.sheet{gap:0}}' +
    '</style></head><body>' +
    '<div class="sheet">' + labelsHTML + '</div>' +
    '<div class="actions">' +
    '<button onclick="window.print()">🖨️ طباعة</button>' +
    '<button onclick="window.close()" style="background:#687585">إغلاق</button>' +
    '</div>' +
    '</body></html>'
  );
  w.document.close();

  showNotification('تم توليد ' + labels.length + ' ملصق ✅');
}