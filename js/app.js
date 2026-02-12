import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, query, onSnapshot, orderBy, doc, updateDoc, serverTimestamp, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging.js";

// Firebase設定
const firebaseConfig = {
  apiKey: "AIzaSyCWy_BjB9tr02viCSfAx93qeJyX4G0e2iw",
  authDomain: "keep-under-control.firebaseapp.com",
  projectId: "keep-under-control",
  storageBucket: "keep-under-control.firebasestorage.app",
  messagingSenderId: "999632394190",
  appId: "1:999632394190:web:085efbde0239f098c27d9f"
};

// ▼▼▼ あなたのGASのURLをそのまま使ってください ▼▼▼
const gasUrl = "https://script.google.com/macros/s/AKfycbymJdy2UHwg4P7P68fq_c58uw4VWelvd4Vnb3ZjsTvv0VucveufJxND4Dw5pkNDH1kG/exec"; 
// ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const messaging = getMessaging(app);
const vapidKey = "BPfPbUKmRMqsHoTbS7SqOGb_t9bt9f72J4x5rOFaRRuY-uL8oqa-M6ASyg_vh8jn3WRDmiifyHPQJM3c45y9nSI";

let currentUser = null;
let allUsers = [];

const App = {
    async init() {
        try {
            const [usersResp, formResp] = await Promise.all([
                fetch('config/users.json'),
                fetch('config/form.json')
            ]);
            allUsers = await usersResp.json();
            const formData = await formResp.json();
            
            // 申請種別生成
            const typeSelect = document.getElementById('apply-type');
            if (typeSelect) {
                typeSelect.innerHTML = ''; 
                formData.types.forEach(type => {
                    const opt = document.createElement('option');
                    opt.value = type;
                    opt.text = type;
                    typeSelect.appendChild(opt);
                });
            }
            const bodyInput = document.getElementById('apply-body');
            if (bodyInput) bodyInput.placeholder = formData.templates.default;

            // 依頼種別生成
            const reqSelect = document.getElementById('request-type');
            if (reqSelect && formData.requestTypes) {
                reqSelect.innerHTML = '';
                formData.requestTypes.forEach(type => {
                    const opt = document.createElement('option');
                    opt.value = type;
                    opt.text = type;
                    reqSelect.appendChild(opt);
                });
            }

            try {
                this.initDeadlineInputs();
            } catch(e) { console.log('期限入力欄初期化スキップ'); }

            this.checkSession();

        } catch (e) { console.error('初期化エラー:', e); }
    },

    initDeadlineInputs() {
        const mSel = document.getElementById('dl-month');
        if (!mSel) return;

        for(let i=1; i<=12; i++) mSel.add(new Option(i, i));
        mSel.value = new Date().getMonth() + 1;

        const dSel = document.getElementById('dl-day');
        for(let i=1; i<=31; i++) dSel.add(new Option(i, i));
        dSel.value = new Date().getDate();

        const hSel = document.getElementById('dl-hour');
        for(let i=0; i<=23; i++) hSel.add(new Option(i, i));
        hSel.value = 18;

        const minSel = document.getElementById('dl-minutes');
        for(let i=5; i<=60; i+=5) minSel.add(new Option(`${i}分以内`, i));
    },

    toggleDeadlineMode() {
        const modeDate = document.getElementById('mode-date');
        if (!modeDate) return;
        
        const isDate = modeDate.checked;
        const dateArea = document.getElementById('deadline-date-area');
        const relArea = document.getElementById('deadline-relative-area');
        
        if (dateArea) dateArea.className = isDate ? 'd-flex align-items-center gap-1 mb-3 ps-2' : 'd-none';
        if (relArea) relArea.className = isDate ? 'd-none' : 'd-block mb-3 ps-2';
    },

    checkSession() {
        const storedUser = localStorage.getItem('app_user');
        if (storedUser) {
            try {
                currentUser = JSON.parse(storedUser);
                this.showMainScreen();
            } catch(e) { console.error('ログイン復帰失敗', e); }
        }
    },

    async requestNotificationPermission() {
        try {
            const permission = await Notification.requestPermission();
            if (permission === 'granted') {
                const token = await getToken(messaging, { 
                    vapidKey: vapidKey,
                    serviceWorkerRegistration: await navigator.serviceWorker.register('./sw.js')
                });
                if (token) {
                    await setDoc(doc(db, "user_tokens", currentUser.id), {
                        token: token,
                        userId: currentUser.id,
                        updatedAt: serverTimestamp()
                    });
                }
            }
        } catch (err) { console.error(err); }
        
        onMessage(messaging, (payload) => {
            alert(`【新着通知】\n${payload.notification.title}\n${payload.notification.body}`);
        });
    },

    login() {
        const inputName = document.getElementById('login-name-input').value.trim();
        if (!inputName) return;
        currentUser = allUsers.find(u => u.name === inputName);
        if (!currentUser) { alert('ユーザーが見つかりません'); return; }
        
        localStorage.setItem('app_user', JSON.stringify(currentUser));
        this.showMainScreen();
    },

    logout() {
        if(confirm('ログアウトしますか？')) {
            localStorage.removeItem('app_user');
            location.reload();
        }
    },

    showMainScreen() {
        document.getElementById('login-screen').classList.add('d-none');
        document.getElementById('main-screen').classList.remove('d-none');
        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) logoutBtn.classList.remove('d-none');
        document.getElementById('current-user-name').textContent = currentUser.name;

        // リーダーなら依頼タブを表示 & 初期アクティブにする
        const reqTabItem = document.getElementById('nav-item-request');
        if (reqTabItem && currentUser.role === 'leader') {
            reqTabItem.classList.remove('d-none');

            // ★追加ロジック：リーダーなら初期タブを「依頼作成」に切り替え
            // 1. 申請タブを非アクティブ化
            document.getElementById('btn-tab-apply').classList.remove('active');
            document.getElementById('tab-apply').classList.remove('show', 'active');
            
            // 2. 依頼タブをアクティブ化
            document.getElementById('btn-tab-request').classList.add('active');
            document.getElementById('tab-request').classList.add('show', 'active');
        }

        try { this.setupSelects(); } catch(e) { console.error(e); }

        this.startListening();
        this.requestNotificationPermission();
    },

    setupSelects() {
        const leaderSelect = document.getElementById('leader-select');
        if (leaderSelect) {
            leaderSelect.innerHTML = '';
            allUsers.filter(u => u.group === currentUser.group && u.role === 'leader' && u.id !== currentUser.id)
                .forEach(u => leaderSelect.add(new Option(u.name, u.id)));
        }

        const targetSelect = document.getElementById('target-select');
        if (targetSelect) {
            targetSelect.innerHTML = '';
            allUsers.filter(u => u.group === currentUser.group && u.id !== currentUser.id)
                .forEach(u => targetSelect.add(new Option(u.name, u.id)));
        }
    },

    async sendPush(targetUserId, title, body) {
        try {
            const tokenDoc = await getDoc(doc(db, "user_tokens", targetUserId));
            if (tokenDoc.exists()) {
                await fetch(gasUrl, {
                    method: 'POST',
                    mode: 'no-cors',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token: tokenDoc.data().token, title: title, body: body })
                });
            }
        } catch (e) { console.error(e); }
    },

    async submitApplication() {
        const type = document.getElementById('apply-type').value;
        const leaderId = document.getElementById('leader-select').value;
        const body = document.getElementById('apply-body').value;

        try {
            await addDoc(collection(db, "applications"), {
                category: 'application',
                applicantId: currentUser.id,
                applicantName: currentUser.name,
                groupId: currentUser.group,
                leaderId: leaderId,
                type: type,
                body: body,
                status: 'pending',
                comment: '',
                timestamp: serverTimestamp(),
                createdAt: new Date().toLocaleString()
            });
            this.sendPush(leaderId, '新しい申請', `${currentUser.name}さんからの${type}`);
            alert('申請しました！');
            document.getElementById('apply-body').value = '';
            document.querySelector('[data-bs-target="#tab-list"]').click();
        } catch (e) { alert('エラー'); console.error(e); }
    },

    async submitRequest() {
        const type = document.getElementById('request-type').value;
        const targetId = document.getElementById('target-select').value;
        const body = document.getElementById('request-body').value;
        
        let deadlineStr = "";
        const modeDate = document.getElementById('mode-date');
        if (modeDate && modeDate.checked) {
            const m = document.getElementById('dl-month').value;
            const d = document.getElementById('dl-day').value;
            const h = document.getElementById('dl-hour').value;
            deadlineStr = `${m}月${d}日 ${h}時まで`;
        } else {
            const minElem = document.getElementById('dl-minutes');
            if (minElem) {
                const min = minElem.value;
                const now = new Date();
                const targetTime = new Date(now.getTime() + min * 60000);
                deadlineStr = `${targetTime.getHours()}:${String(targetTime.getMinutes()).padStart(2, '0')} まで（${min}分以内）`;
            }
        }

        try {
            await addDoc(collection(db, "applications"), {
                category: 'request',
                applicantId: currentUser.id,
                applicantName: currentUser.name,
                groupId: currentUser.group,
                targetId: targetId,
                type: type,
                body: body,
                deadline: deadlineStr,
                status: 'requesting',
                timestamp: serverTimestamp(),
                createdAt: new Date().toLocaleString()
            });
            this.sendPush(targetId, '新しい依頼', `${currentUser.name}さんから：${type}`);
            alert('依頼を送信しました！');
            document.getElementById('request-body').value = '';
            document.querySelector('[data-bs-target="#tab-list"]').click();
        } catch (e) { alert('エラー'); console.error(e); }
    },

    startListening() {
        const q = query(collection(db, "applications"), orderBy("timestamp", "desc"));
        onSnapshot(q, (snapshot) => {
            const listEl = document.getElementById('application-list');
            if (!listEl) return;
            listEl.innerHTML = '';
            
            snapshot.forEach((docSnap) => {
                const data = docSnap.data();
                const docId = docSnap.id;
                if (data.groupId !== currentUser.group) return;

                const isRequest = data.category === 'request';
                const card = document.createElement('div');
                card.className = 'card shadow-sm p-4 border-0 mb-3'; // padding増やして余白をリッチに
                
                if (isRequest) {
                    const badgeClass = 'status-request';
                    const statusText = `依頼：${data.deadline || '期限なし'}`;
                    
                    card.innerHTML = `
                        <div class="d-flex justify-content-between align-items-center mb-3">
                            <span class="status-badge ${badgeClass}">${statusText}</span>
                            <small class="text-muted fw-bold" style="font-size: 0.75rem;">${data.createdAt}</small>
                        </div>
                        <h6 class="mb-2 fw-bold text-dark">${data.type}</h6>
                        <div class="small text-muted mb-3">
                            <span class="fw-bold">依頼者:</span> ${data.applicantName} <span class="mx-1">|</span> 
                            <span class="fw-bold">対象:</span> ${data.targetId === currentUser.id ? 'あなた' : '他のメンバー'}
                        </div>
                        <div class="bg-light p-3 rounded-3 text-secondary" style="font-size: 0.95rem;">${data.body}</div>
                    `;
                } else {
                    let badgeClass = 'status-pending';
                    let statusText = '承認待ち';
                    if (data.status === 'approved') { badgeClass = 'status-approved'; statusText = '承認済み'; }
                    if (data.status === 'rejected') { badgeClass = 'status-rejected'; statusText = '却下'; }

                    let actionButtons = '';
                    let commentHtml = data.comment ? `<div class="alert alert-secondary mt-3 mb-0 p-3 small rounded-3"><i class="bi bi-chat-left-text me-2"></i><strong>コメント:</strong> ${data.comment}</div>` : '';
                    let decidedTime = data.decidedAt ? `<div class="text-muted small mt-2 text-end">処理日時: ${data.decidedAt}</div>` : '';

                    if (currentUser.id === data.leaderId) {
                        if (data.status === 'pending') {
                            actionButtons = `
                                <div class="mt-4 d-flex gap-2">
                                    <button onclick="app.updateStatus('${docId}', 'approved', '${data.applicantId}')" class="btn btn-success btn-sm flex-grow-1 fw-bold py-2">承認する</button>
                                    <button onclick="app.updateStatus('${docId}', 'rejected', '${data.applicantId}')" class="btn btn-danger btn-sm flex-grow-1 fw-bold py-2">却下する</button>
                                </div>`;
                        } else {
                            actionButtons = `<div class="mt-3"><button onclick="app.undoStatus('${docId}', '${data.applicantId}')" class="btn btn-outline-secondary btn-sm w-100">判定を取り消す</button></div>`;
                        }
                    }

                    card.innerHTML = `
                        <div class="d-flex justify-content-between align-items-center mb-3">
                            <span class="status-badge ${badgeClass}">${statusText}</span>
                            <small class="text-muted fw-bold" style="font-size: 0.75rem;">${data.createdAt}</small>
                        </div>
                        <h6 class="mb-2 fw-bold text-dark">${data.type}</h6>
                        <div class="small text-muted mb-3"><span class="fw-bold">申請者:</span> ${data.applicantName}</div>
                        <div class="bg-light p-3 rounded-3 text-secondary" style="font-size: 0.95rem;">${data.body}</div>
                        ${commentHtml}
                        ${decidedTime}
                        ${actionButtons}
                    `;
                }
                listEl.appendChild(card);
            });
        });
    },

    async updateStatus(docId, status, applicantId) {
        const actionName = status === 'approved' ? '承認' : '却下';
        const comment = prompt(`${actionName}の理由やコメントがあれば入力してください（任意）`);
        if (comment === null) return;
        try {
            await updateDoc(doc(db, "applications", docId), { status: status, comment: comment, decidedAt: new Date().toLocaleString() });
            const msg = status === 'approved' ? '承認されました' : '却下されました';
            const body = comment ? `コメント: ${comment}` : 'アプリで確認してください';
            this.sendPush(applicantId, `申請が${msg}`, body);
        } catch (e) { console.error(e); }
    },

    async undoStatus(docId, applicantId) {
        if (!confirm('現在の判定を取り消して、承認待ちに戻しますか？')) return;
        try {
            await updateDoc(doc(db, "applications", docId), { status: 'pending', decidedAt: null, comment: null });
            this.sendPush(applicantId, '判定が取り消されました', '申請が再度「承認待ち」に戻りました');
        } catch (e) { console.error(e); }
    }
};

window.app = App;
window.onload = () => App.init();


