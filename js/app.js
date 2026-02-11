// Firebase SDKの読み込み
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, addDoc, query, onSnapshot, orderBy, doc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging.js";
import { setDoc, doc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";


// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCWy_BjB9tr02viCSfAx93qeJyX4G0e2iw",
  authDomain: "keep-under-control.firebaseapp.com",
  projectId: "keep-under-control",
  storageBucket: "keep-under-control.firebasestorage.app",
  messagingSenderId: "999632394190",
  appId: "1:999632394190:web:085efbde0239f098c27d9f"
};

// Firebase初期化
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// アプリの状態管理
let currentUser = null;
let allUsers = [];

// メインロジック
const App = {
    // 初期化：ユーザー一覧と申請設定の読み込み
    async init() {
        try {
            // ユーザー設定と申請フォーム設定を並行して取得
            const [usersResp, formResp] = await Promise.all([
                fetch('config/users.json'),
                fetch('config/form.json')
            ]);

            allUsers = await usersResp.json();
            const formData = await formResp.json();
            
            // ユーザープルダウン生成
            const select = document.getElementById('user-select');
            select.innerHTML = '<option value="">ユーザーを選択...</option>'; // リセット
            allUsers.forEach(u => {
                const option = document.createElement('option');
                option.value = u.id;
                option.text = `${u.name} (${u.group})`;
                select.appendChild(option);
            });

            // ★追加：申請種別プルダウン生成
            const typeSelect = document.getElementById('apply-type');
            typeSelect.innerHTML = ''; // HTMLの直書きを消去
            formData.types.forEach(type => {
                const opt = document.createElement('option');
                opt.value = type;
                opt.text = type;
                typeSelect.appendChild(opt);
            });
            
            // テンプレート反映（プレースホルダーとして）
            document.getElementById('apply-body').placeholder = formData.templates.default;

        } catch (e) {
            alert('設定ファイルの読み込みに失敗しました');
            console.error(e);
        }
    },

    // ログイン処理
    login() {
        const userId = document.getElementById('user-select').value;
        if (!userId) return;

        currentUser = allUsers.find(u => u.id === userId);
        
        // 画面切り替え
        document.getElementById('login-screen').classList.add('d-none');
        document.getElementById('main-screen').classList.remove('d-none');
        document.getElementById('current-user-name').textContent = currentUser.name;

        // リーダー一覧のセット（自分と同じグループのリーダーのみ）
        this.setupLeaderSelect();
        
        // データ監視開始（リアルタイム更新）
        this.startListening();
    },

    setupLeaderSelect() {
        const select = document.getElementById('leader-select');
        select.innerHTML = '';
        
        const groupLeaders = allUsers.filter(u => 
            u.group === currentUser.group && u.role === 'leader'
        );

        groupLeaders.forEach(u => {
            const option = document.createElement('option');
            option.value = u.id;
            option.text = u.name;
            select.appendChild(option);
        });
    },

    // 申請送信
    async submitApplication() {
        const type = document.getElementById('apply-type').value;
        const leaderId = document.getElementById('leader-select').value;
        const body = document.getElementById('apply-body').value;

        if (!leaderId || !body) {
            alert('リーダーと内容を入力してください');
            return;
        }

        try {
            await addDoc(collection(db, "applications"), {
                applicantId: currentUser.id,
                applicantName: currentUser.name,
                groupId: currentUser.group,     // グループでフィルタするため保存
                leaderId: leaderId,
                type: type,
                body: body,
                status: 'pending',              // pending, approved, rejected
                timestamp: serverTimestamp(),
                createdAt: new Date().toLocaleString()
            });
            
            alert('申請しました！');
            document.getElementById('apply-body').value = ''; // 入力欄クリア
            // 自動で一覧タブへ移動
            document.querySelector('[data-bs-target="#tab-list"]').click();
        } catch (e) {
            console.error(e);
            alert('送信エラーが発生しました');
        }
    },

    // リアルタイムデータ受信
    startListening() {
        const q = query(collection(db, "applications"), orderBy("timestamp", "desc"));

        onSnapshot(q, (snapshot) => {
            const listEl = document.getElementById('application-list');
            listEl.innerHTML = '';

            snapshot.forEach((docSnap) => {
                const data = docSnap.data();
                const docId = docSnap.id;

                // 【重要】自分のグループ以外のデータは表示しないフィルタリング
                if (data.groupId !== currentUser.group) return;

                // カード作成
                const card = document.createElement('div');
                card.className = 'card shadow-sm p-3 border-0';
                
                // ステータスバッジの色決定
                let badgeClass = 'status-pending';
                let statusText = '承認待ち';
                if (data.status === 'approved') { badgeClass = 'status-approved'; statusText = '承認済み'; }
                if (data.status === 'rejected') { badgeClass = 'status-rejected'; statusText = '否決'; }

                // HTML生成
                let actionButtons = '';
                // 自分が「指定されたリーダー」かつ「承認待ち」の場合のみボタンを表示
                if (currentUser.id === data.leaderId && data.status === 'pending') {
                    actionButtons = `
                        <div class="mt-3 d-flex gap-2">
                            <button onclick="app.updateStatus('${docId}', 'approved')" class="btn btn-success btn-sm flex-grow-1">承認</button>
                            <button onclick="app.updateStatus('${docId}', 'rejected')" class="btn btn-danger btn-sm flex-grow-1">否決</button>
                        </div>
                    `;
                }

                // 承認/否決日時があれば表示
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

    // 承認・否決処理
    async updateStatus(docId, status) {
        if (!confirm('この処理を確定しますか？')) return;
        
        try {
            const docRef = doc(db, "applications", docId);
            await updateDoc(docRef, {
                status: status,
                decidedAt: new Date().toLocaleString()
            });
        } catch (e) {
            console.error(e);
            alert('更新に失敗しました');
        }
    }
};

// グローバルに公開（HTMLからonclickで呼べるようにする）
window.app = App;
window.onload = () => App.init();


