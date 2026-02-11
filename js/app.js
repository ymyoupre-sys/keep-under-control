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
            
            // 申請種別の生成
            const typeSelect = document.getElementById('apply-type');
            typeSelect.innerHTML = ''; 
            formData.types.forEach(type => {
                const opt = document.createElement('option');
                opt.value = type;
                opt.text = type;
                typeSelect.appendChild(opt);
            });
            document.getElementById('apply-body').placeholder = formData.templates.default;

            // ★追加：自動ログインチェック
            this.checkSession();

        } catch (e) { console.error(e); }
    },

    // ★追加：セッション確認
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

    // ログイン処理（完全一致に変更）
    login() {
        const inputName = document.getElementById('login-name-input').value.trim();
        if (!inputName) return;

        // 名前で完全一致検索
        currentUser = allUsers.find(u => u.name === inputName);
        
        if (!currentUser) {
            alert('ユーザーが見つかりません。名簿と完全に一致する名前を入力してください。');
            return;
        }

        // セッション保存
        localStorage.setItem('app_user', JSON.stringify(currentUser));
        
        this.showMainScreen();
    },

    // ★追加：ログアウト処理
    logout() {
        if(confirm('ログアウトしますか？')) {
            localStorage.removeItem('app_user');
            location.reload(); // 画面リロードして初期状態に戻す
        }
    },

    // メイン画面表示処理（共通化）
    showMainScreen() {
        document.getElementById('login-screen').classList.add('d-none');
        document.getElementById('main-screen').classList.remove('d-none');
        document.getElementById('logout-btn').classList.remove('d-none'); // ログアウトボタン表示
        document.getElementById('current-user-name').textContent = currentUser.name;

        this.setupLeaderSelect();
        this.startListening();
        this.requestNotificationPermission();
    },

    setupLeaderSelect() {
        const select = document.getElementById('leader-select');
        select.innerHTML = '';
        const groupLeaders = allUsers.filter(u => u.group === currentUser.group && u.role === 'leader');
        groupLeaders.forEach(u => {
            const option = document.createElement('option');
            option.value = u.id;
            option.text = u.name;
            select.appendChild(option);
        });
    },

    async sendPush(targetUserId, title, body) {
        try {
            const tokenDoc = await getDoc(doc(db, "user_tokens", targetUserId));
            if (tokenDoc.exists()) {
                const token = tokenDoc.data().token;
                await fetch(gasUrl, {
                    method: 'POST',
                    mode: 'no-cors',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token: token, title: title, body: body })
                });
            }
        } catch (e) { console.error(e); }
    },

    async submitApplication() {
        const type = document.getElementById('apply-type').value;
        const leaderId = document.getElementById('leader-select').value;
        const body = document.getElementById('apply-body').value;

        if (!leaderId || !body) { alert('入力不備があります'); return; }

        try {
            await addDoc(collection(db, "applications"), {
                applicantId: currentUser.id,
                applicantName: currentUser.name,
                groupId: currentUser.group,
                leaderId: leaderId,
                type: type,
                body: body,
                status: 'pending',
                comment: '', // コメント用フィールド初期化
                timestamp: serverTimestamp(),
                createdAt: new Date().toLocaleString()
            });
            
            this.sendPush(leaderId, '新しい申請', `${currentUser.name}さんからの${type}`);

            alert('申請しました！');
            document.getElementById('apply-body').value = '';
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

                const card = document.createElement('div');
                card.className = 'card shadow-sm p-3 border-0';
                
                let badgeClass = 'status-pending';
                let statusText = '承認待ち';
                if (data.status === 'approved') { badgeClass = 'status-approved'; statusText = '承認済み'; }
                if (data.status === 'rejected') { badgeClass = 'status-rejected'; statusText = '否決'; }

                let actionButtons = '';
                // ボタン表示ロジック
                if (currentUser.id === data.leaderId) {
                    // まだ承認待ちの場合
                    if (data.status === 'pending') {
                        actionButtons = `
                            <div class="mt-3 d-flex gap-2">
                                <button onclick="app.updateStatus('${docId}', 'approved', '${data.applicantId}')" class="btn btn-success btn-sm flex-grow-1">承認</button>
                                <button onclick="app.updateStatus('${docId}', 'rejected', '${data.applicantId}')" class="btn btn-danger btn-sm flex-grow-1">否決</button>
                            </div>
                        `;
                    } 
                    // ★追加：既に承認/否決済みの場合（取り消しボタンを表示）
                    else {
                        actionButtons = `
                            <div class="mt-3">
                                <button onclick="app.undoStatus('${docId}', '${data.applicantId}')" class="btn btn-outline-secondary btn-sm w-100">判定を取り消す</button>
                            </div>
                        `;
                    }
                }
                
                let decidedTime = data.decidedAt ? `<div class="text-muted small mt-1">処理日時: ${data.decidedAt}</div>` : '';
                // ★追加：コメントがあれば表示
                let commentHtml = data.comment ? `<div class="alert alert-light mt-2 mb-0 p-2 small"><i class="bi bi-chat-left-text"></i> ${data.comment}</div>` : '';

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
                listEl.appendChild(card);
            });
        });
    },

    // ★修正：承認・否決処理（コメント入力付き）
    async updateStatus(docId, status, applicantId) {
        // コメント入力プロンプトを表示
        const actionName = status === 'approved' ? '承認' : '否決';
        const comment = prompt(`${actionName}の理由やコメントがあれば入力してください（任意）`);
        
        if (comment === null) return; // キャンセルされたら何もしない

        try {
            await updateDoc(doc(db, "applications", docId), {
                status: status,
                comment: comment, // コメント保存
                decidedAt: new Date().toLocaleString()
            });

            const msg = status === 'approved' ? '承認されました' : '否決されました';
            const body = comment ? `コメント: ${comment}` : 'アプリで確認してください';
            this.sendPush(applicantId, `申請が${msg}`, body);

        } catch (e) { console.error(e); }
    },

    // ★追加：判定取り消し処理
    async undoStatus(docId, applicantId) {
        if (!confirm('現在の判定を取り消して、承認待ちに戻しますか？')) return;

        try {
            await updateDoc(doc(db, "applications", docId), {
                status: 'pending',
                decidedAt: null, // 日時クリア
                comment: null    // コメントクリア
            });

            this.sendPush(applicantId, '判定が取り消されました', '申請が再度「承認待ち」に戻りました');

        } catch (e) { console.error(e); }
    }
};

window.app = App;
window.onload = () => App.init();
