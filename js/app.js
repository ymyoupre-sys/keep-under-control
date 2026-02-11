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

// ▼▼▼ あなたのGASのURLを確認して貼ってください ▼▼▼
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
            typeSelect.innerHTML = ''; 
            formData.types.forEach(type => {
                const opt = document.createElement('option');
                opt.value = type;
                opt.text = type;
                typeSelect.appendChild(opt);
            });
            document.getElementById('apply-body').placeholder = formData.templates.default;

            // ★追加：命令種別生成
            const reqSelect = document.getElementById('request-type');
            reqSelect.innerHTML = '';
            if(formData.requestTypes) {
                formData.requestTypes.forEach(type => {
                    const opt = document.createElement('option');
                    opt.value = type;
                    opt.text = type;
                    reqSelect.appendChild(opt);
                });
            }

            // ★追加：期限入力欄のプルダウン生成
            this.initDeadlineInputs();

            this.checkSession();

        } catch (e) { console.error(e); }
    },

    // ★追加：期限プルダウンの初期化
    initDeadlineInputs() {
        // 月 (1-12)
        const mSel = document.getElementById('dl-month');
        for(let i=1; i<=12; i++) mSel.add(new Option(i, i));
        // 初期値を今月にする
        mSel.value = new Date().getMonth() + 1;

        // 日 (1-31)
        const dSel = document.getElementById('dl-day');
        for(let i=1; i<=31; i++) dSel.add(new Option(i, i));
        // 初期値を今日にする
        dSel.value = new Date().getDate();

        // 時 (0-23)
        const hSel = document.getElementById('dl-hour');
        for(let i=0; i<=23; i++) hSel.add(new Option(i, i));
        hSel.value = 0; // デフォルト0時

        // 分以内 (5-60, 5分刻み)
        const minSel = document.getElementById('dl-minutes');
        for(let i=5; i<=60; i+=5) minSel.add(new Option(`${i}分以内`, i));
    },

    // ★追加：期限入力モード切替
    toggleDeadlineMode() {
        const isDate = document.getElementById('mode-date').checked;
        document.getElementById('deadline-date-area').className = isDate ? 'd-flex gap-1 mb-3' : 'd-none';
        document.getElementById('deadline-relative-area').className = isDate ? 'd-none' : 'd-block mb-3';
    },

    checkSession() {
        const storedUser = localStorage.getItem('app_user');
        if (storedUser) {
            currentUser = JSON.parse(storedUser);
            this.showMainScreen();
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
        document.getElementById('logout-btn').classList.remove('d-none');
        document.getElementById('current-user-name').textContent = currentUser.name;

        // ★追加：リーダーなら命令タブを表示
        if (currentUser.role === 'leader') {
            document.getElementById('nav-item-request').classList.remove('d-none');
        }

        this.setupSelects();
        this.startListening();
        this.requestNotificationPermission();
    },

    setupSelects() {
        // 申請用のリーダー選択（自分以外）
        const leaderSelect = document.getElementById('leader-select');
        leaderSelect.innerHTML = '';
        allUsers.filter(u => u.group === currentUser.group && u.role === 'leader' && u.id !== currentUser.id)
            .forEach(u => leaderSelect.add(new Option(u.name, u.id)));

        // ★追加：命令用のターゲット選択（同じグループの全員、自分以外）
        const targetSelect = document.getElementById('target-select');
        targetSelect.innerHTML = '';
        allUsers.filter(u => u.group === currentUser.group && u.id !== currentUser.id)
            .forEach(u => targetSelect.add(new Option(u.name, u.id)));
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

    // 申請送信
    async submitApplication() {
        const type = document.getElementById('apply-type').value;
        const leaderId = document.getElementById('leader-select').value;
        const body = document.getElementById('apply-body').value;
        if (!leaderId || !body) { alert('入力不備があります'); return; }

        try {
            await addDoc(collection(db, "applications"), {
                category: 'application', // 区別用
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

    // ★追加：命令送信
    async submitRequest() {
        const type = document.getElementById('request-type').value;
        const targetId = document.getElementById('target-select').value;
        const body = document.getElementById('request-body').value;
        
        // 期限計算
        let deadlineStr = "";
        const isDateMode = document.getElementById('mode-date').checked;
        if (isDateMode) {
            const m = document.getElementById('dl-month').value;
            const d = document.getElementById('dl-day').value;
            const h = document.getElementById('dl-hour').value;
            deadlineStr = `${m}月${d}日 ${h}時まで`;
        } else {
            const min = document.getElementById('dl-minutes').value;
            // 現在時刻 + 分
            const now = new Date();
            const targetTime = new Date(now.getTime() + min * 60000);
            deadlineStr = `${targetTime.getHours()}:${String(targetTime.getMinutes()).padStart(2, '0')} まで（${min}分以内）`;
        }

        if (!targetId || !body) { alert('入力不備があります'); return; }

        try {
            await addDoc(collection(db, "applications"), { // 同じコレクションに保存
                category: 'request', // 区別用
                applicantId: currentUser.id, // 命令者（リーダー）
                applicantName: currentUser.name,
                groupId: currentUser.group,
                targetId: targetId, // 命令先
                type: type,
                body: body,
                deadline: deadlineStr, // 期限
                status: 'requesting', // 命令中
                timestamp: serverTimestamp(),
                createdAt: new Date().toLocaleString()
            });
            
            this.sendPush(targetId, '新しい命令', `${currentUser.name}さんから：${type}`);
            alert('命令を送信しました！');
            document.getElementById('request-body').value = '';
            document.querySelector('[data-bs-target="#tab-list"]').click();
        } catch (e) { alert('エラー'); console.error(e); }
    },

    startListening() {
        const q = query(collection(db, "applications"), orderBy("timestamp", "desc"));
        onSnapshot(q, (snapshot) => {
            const listEl = document.getElementById('application-list');
            listEl.innerHTML = '';
            snapshot.forEach((docSnap) => {
                const data = docSnap.data();
                const docId = docSnap.id;
                if (data.groupId !== currentUser.group) return;

                // ★表示分岐：申請か命令か
                const isRequest = data.category === 'request';
                
                // カードのHTML生成
                const card = document.createElement('div');
                card.className = 'card shadow-sm p-3 border-0';
                
                if (isRequest) {
                    // --- 命令の場合 ---
                    // 表示バッジ
                    const badgeClass = 'status-request';
                    const statusText = `命令：${data.deadline}`;
                    
                    // アクションボタン（命令された側のみ「完了」ボタンを押せるイメージ？今回は表示のみ）
                    // 要望になかったのでシンプルに表示のみにします
                    
                    card.innerHTML = `
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            <span class="badge ${badgeClass}">${statusText}</span>
                            <small class="text-muted">${data.createdAt}</small>
                        </div>
                        <h6 class="mb-1">命令：${data.type}</h6>
                        <div class="small text-muted mb-2">命令者: ${data.applicantName} <br> 対象: ${data.targetId === currentUser.id ? 'あなた' : '他のメンバー'}</div>
                        <p class="mb-0 bg-light p-2 rounded">${data.body}</p>
                    `;

                } else {
                    // --- 通常申請の場合（既存ロジック） ---
                    let badgeClass = 'status-pending';
                    let statusText = '承認待ち';
                    if (data.status === 'approved') { badgeClass = 'status-approved'; statusText = '承認済み'; }
                    if (data.status === 'rejected') { badgeClass = 'status-rejected'; statusText = '却下'; }

                    let actionButtons = '';
                    let commentHtml = data.comment ? `<div class="alert alert-light mt-2 mb-0 p-2 small"><i class="bi bi-chat-left-text"></i> ${data.comment}</div>` : '';
                    let decidedTime = data.decidedAt ? `<div class="text-muted small mt-1">処理日時: ${data.decidedAt}</div>` : '';

                    if (currentUser.id === data.leaderId) {
                        if (data.status === 'pending') {
                            actionButtons = `
                                <div class="mt-3 d-flex gap-2">
                                    <button onclick="app.updateStatus('${docId}', 'approved', '${data.applicantId}')" class="btn btn-success btn-sm flex-grow-1">承認</button>
                                    <button onclick="app.updateStatus('${docId}', 'rejected', '${data.applicantId}')" class="btn btn-danger btn-sm flex-grow-1">却下</button>
                                </div>`;
                        } else {
                            actionButtons = `<div class="mt-3"><button onclick="app.undoStatus('${docId}', '${data.applicantId}')" class="btn btn-outline-secondary btn-sm w-100">判定を取り消す</button></div>`;
                        }
                    }

                    card.innerHTML = `
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            <span class="badge ${badgeClass}">${statusText}</span>
                            <small class="text-muted">${data.createdAt}</small>
                        </div>
                        <h6 class="mb-1">${data.type}</h6>
                        <div class="small text-muted mb-2">申請者: ${data.applicantName}</div>
                        <p class="mb-0 bg-light p-2 rounded">${data.body}</p>
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
