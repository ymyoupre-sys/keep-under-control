// Firebase SDK
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

// ▼▼▼ ここにあなたのGASのURLを埋め込みました ▼▼▼
const gasUrl = "https://script.google.com/macros/s/AKfycbymJdy2UHwg4P7P68fq_c58uw4VWelvd4Vnb3ZjsTvv0VucveufJxND4Dw5pkNDH1kG/exec"; 
// ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const messaging = getMessaging(app);
const vapidKey = "BPfPbUKmRMqsHoTbS7SqOGb_t9bt9f72J4x5rOFaRRuY-uL8oqa-M6ASyg_vh8jn3WRDmiifyHPQJM3c45y9nSI";

let currentUser = null;
let allUsers = [];

const App = {
    // 初期化
    async init() {
        try {
            const [usersResp, formResp] = await Promise.all([
                fetch('config/users.json'),
                fetch('config/form.json')
            ]);
            allUsers = await usersResp.json();
            const formData = await formResp.json();
            
            const select = document.getElementById('user-select');
            select.innerHTML = '<option value="">ユーザーを選択...</option>'; 
            allUsers.forEach(u => {
                const option = document.createElement('option');
                option.value = u.id;
                option.text = `${u.name} (${u.group})`;
                select.appendChild(option);
            });

            const typeSelect = document.getElementById('apply-type');
            typeSelect.innerHTML = ''; 
            formData.types.forEach(type => {
                const opt = document.createElement('option');
                opt.value = type;
                opt.text = type;
                typeSelect.appendChild(opt);
            });
            
            document.getElementById('apply-body').placeholder = formData.templates.default;
        } catch (e) { console.error(e); }
    },

    // 通知許可とトークン保存
    async requestNotificationPermission() {
        try {
            const permission = await Notification.requestPermission();
            if (permission === 'granted') {
                const token = await getToken(messaging, { 
                    vapidKey: vapidKey,
                    serviceWorkerRegistration: await navigator.serviceWorker.register('./sw.js')
                });
                if (token) {
                    // トークンを保存
                    await setDoc(doc(db, "user_tokens", currentUser.id), {
                        token: token,
                        userId: currentUser.id,
                        updatedAt: serverTimestamp()
                    });
                }
            }
        } catch (err) { console.error(err); }
        
        // フォアグラウンド受信
        onMessage(messaging, (payload) => {
            alert(`【新着通知】\n${payload.notification.title}\n${payload.notification.body}`);
        });
    },

    // ログイン
    login() {
        const userId = document.getElementById('user-select').value;
        if (!userId) return;
        currentUser = allUsers.find(u => u.id === userId);
        document.getElementById('login-screen').classList.add('d-none');
        document.getElementById('main-screen').classList.remove('d-none');
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

    // ★追加機能：通知送信ヘルパー
    async sendPush(targetUserId, title, body) {
        try {
            // Firestoreから相手のトークンを取得
            const tokenDoc = await getDoc(doc(db, "user_tokens", targetUserId));
            if (tokenDoc.exists()) {
                const token = tokenDoc.data().token;
                // GAS経由で送信
                await fetch(gasUrl, {
                    method: 'POST',
                    mode: 'no-cors', // CORSエラー回避
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token: token, title: title, body: body })
                });
                console.log('通知送信リクエスト完了');
            } else {
                console.log('相手の通知トークンがありません');
            }
        } catch (e) {
            console.error('通知送信失敗:', e);
        }
    },

    // 申請送信
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
                timestamp: serverTimestamp(),
                createdAt: new Date().toLocaleString()
            });
            
            // ★リーダーへ通知送信
            this.sendPush(leaderId, '新しい申請が届きました', `${currentUser.name}さんからの${type}`);

            alert('申請しました！');
            document.getElementById('apply-body').value = '';
            document.querySelector('[data-bs-target="#tab-list"]').click();
        } catch (e) { alert('エラー'); console.error(e); }
    },

    // 一覧監視
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
                // ボタン部分の修正：applicantIdも渡すようにする
                if (currentUser.id === data.leaderId && data.status === 'pending') {
                    actionButtons = `
                        <div class="mt-3 d-flex gap-2">
                            <button onclick="app.updateStatus('${docId}', 'approved', '${data.applicantId}')" class="btn btn-success btn-sm flex-grow-1">承認</button>
                            <button onclick="app.updateStatus('${docId}', 'rejected', '${data.applicantId}')" class="btn btn-danger btn-sm flex-grow-1">否決</button>
                        </div>
                    `;
                }
                
                let decidedTime = data.decidedAt ? `<div class="text-muted small mt-1">処理日時: ${data.decidedAt}</div>` : '';

                card.innerHTML = `
                    <div class="d-flex justify-content-between align-items-start mb-2">
                        <span class="badge ${badgeClass}">${statusText}</span>
                        <small class="text-muted">${data.createdAt}</small>
                    </div>
                    <h6 class="mb-1">${data.type}</h6>
                    <div class="small text-muted mb-2">申請者: ${data.applicantName}</div>
                    <p class="mb-0 bg-light p-2 rounded">${data.body}</p>
                    ${decidedTime}
                    ${actionButtons}
                `;
                listEl.appendChild(card);
            });
        });
    },

    // 承認・否決処理（引数にapplicantIdを追加）
    async updateStatus(docId, status, applicantId) {
        if (!confirm('確定しますか？')) return;
        try {
            await updateDoc(doc(db, "applications", docId), {
                status: status,
                decidedAt: new Date().toLocaleString()
            });

            // ★申請者へ通知送信
            const msg = status === 'approved' ? '承認されました' : '否決されました';
            this.sendPush(applicantId, `申請が${msg}`, 'アプリで詳細を確認してください');

        } catch (e) { console.error(e); }
    }
};

window.app = App;
window.onload = () => App.init();
