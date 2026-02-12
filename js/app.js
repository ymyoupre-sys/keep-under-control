// js/app.js
import { DB } from "./db.js";
import { Utils } from "./utils.js";
import { Calendar } from "./calendar.js";
import { db, messaging, getToken } from "./firebase-config.js";
import { onMessage } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging.js"; // 追加

// 設定保持用
let CONFIG_USERS = [];
let CONFIG_SETTINGS = {};
let CURRENT_USER = null;

let unsubscribeInbox = null;
let unsubscribeChat = null;

let currentChatTargetId = null; 
let chatImageBase64 = null;
let formImageBase64 = null;

const App = {
    async init() {
        console.log("App Initializing...");
        
        try {
            const [usersRes, settingsRes] = await Promise.all([
                fetch('config/users.json'),
                fetch('config/settings.json')
            ]);
            CONFIG_USERS = await usersRes.json();
            CONFIG_SETTINGS = await settingsRes.json();
            
            this.setupLogin();
            this.setupTabs();
            this.setupImageInputs();
            this.setupHistoryHandler(); 
            
        } catch (e) {
            console.error("Init Error", e);
            alert("初期化エラー");
        }
    },

    setupLogin() {
        // 既存のログイン済みチェック
        const storedUser = localStorage.getItem('app_user_v2');
        if (storedUser) {
            CURRENT_USER = JSON.parse(storedUser);
            this.showMainScreen();
        }

        const loginBtn = document.getElementById('login-btn');
        loginBtn.addEventListener('click', () => {
            const email = document.getElementById('email').value;
            const password = document.getElementById('password').value;
            
            const user = CONFIG_USERS.find(u => u.email === email && u.password === password);
            if (user) {
                CURRENT_USER = user;
                localStorage.setItem('app_user_v2', JSON.stringify(user));
                this.showMainScreen();
            } else {
                alert('メールアドレスまたはパスワードが間違っています');
            }
        });
    },

    showMainScreen() {
        document.getElementById('login-screen').classList.add('d-none');
        document.getElementById('main-screen').classList.remove('d-none');
        
        // ユーザー名表示
        const userNameEls = document.querySelectorAll('#user-name-display');
        userNameEls.forEach(el => el.textContent = CURRENT_USER.name);

        // 権限ごとの表示切り替え
        if (CURRENT_USER.role === 'leader') {
            document.querySelectorAll('.role-leader').forEach(el => el.classList.remove('d-none'));
            document.querySelectorAll('.role-member').forEach(el => el.classList.add('d-none'));
            
            // リーダーはメンバー全員のチャットリストを見る
            // メンバーリストの生成などは省略（既存コードにある想定）
            this.renderChatList(); 
        } else {
            document.querySelectorAll('.role-leader').forEach(el => el.classList.add('d-none'));
            document.querySelectorAll('.role-member').forEach(el => el.classList.remove('d-none'));
            
            // メンバーはリーダーとのチャット固定
            this.openChat(CURRENT_USER.group, CURRENT_USER.id, 'リーダー');
        }

        // リスナー開始
        this.startInboxListener();
        
        // カレンダー初期化
        Calendar.init(CURRENT_USER);

        // ★追加：通知設定の開始
        this.setupNotifications();
    },

    // ★追加：通知設定とトークン保存
    async setupNotifications() {
        try {
            // 1. 通知の許可を要求
            const permission = await Notification.requestPermission();
            if (permission === 'granted') {
                console.log('Notification permission granted.');
                
                // 2. FCMトークンの取得
                // ※重要: 下記の vapidKey には、Firebaseコンソールで取得したキー文字列を入れてください
                const token = await getToken(messaging, { 
                    vapidKey: "Bwm...ここにキーを貼り付けてください...Xyz" 
                });

                if (token) {
                    console.log('FCM Token:', token);
                    // 3. データベースにユーザーと紐づけて保存
                    await DB.saveUserToken(CURRENT_USER, token);
                } else {
                    console.log('No registration token available.');
                }

                // 4. アプリを開いている時の通知制御
                // 「チャットを開いている時は通知不要」を実現するため、
                // フォアグラウンド受信時は何もしない（OSのシステム通知も出ない）ようにします。
                onMessage(messaging, (payload) => {
                    console.log('Message received in foreground: ', payload);
                    // ここで alert や toast を出さない限り、ユーザーには通知されません。
                    // 必要であれば、「チャット画面以外を見ているときだけ」スナックバーを出すなどの分岐も可能です。
                });

            } else {
                console.log('Unable to get permission to notify.');
            }
        } catch (error) {
            console.error('Notification setup failed:', error);
        }
    },

    // ... (setupTabs, setupImageInputs, setupHistoryHandler など既存のコードはそのまま) ...
    setupTabs() {
        document.querySelectorAll('.bottom-nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                // アクティブ切り替え
                document.querySelectorAll('.bottom-nav-item').forEach(nav => nav.classList.remove('active'));
                item.classList.add('active');
                
                // コンテンツ切り替え
                const targetId = item.getAttribute('href');
                document.querySelectorAll('.tab-content').forEach(content => content.classList.add('d-none'));
                document.querySelector(targetId).classList.remove('d-none');
                
                // ヘッダータイトル変更
                const labelChat = CURRENT_USER.role === 'leader' ? 'チャット一覧' : '連絡';
                const labelInbox = CURRENT_USER.role === 'leader' ? '受信箱' : '報告・申請'; // 文言は調整
                const labelForm = CURRENT_USER.role === 'leader' ? '指示作成' : '申請作成';

                const titleMap = { '#tab-chat': labelChat, '#tab-inbox': labelInbox, '#tab-form': labelForm, '#tab-calendar': 'カレンダー' };
                document.getElementById('header-title').textContent = titleMap[targetId];

                const chatInput = document.getElementById('chat-input-area');
                
                // チャットタブの挙動
                if (targetId === '#tab-chat') {
                    const chatDetail = document.getElementById('chat-detail-container');
                    const chatList = document.getElementById('chat-container');
                    
                    if (chatDetail && chatDetail.classList.contains('d-none')) {
                         if (chatList) {
                             chatList.classList.remove('d-none');
                             this.renderChatList(); 
                         }
                         if (chatInput) chatInput.classList.add('d-none');
                    } else {
                         if (chatInput) chatInput.classList.remove('d-none');
                    }
                } else {
                    if (chatInput) chatInput.classList.add('d-none');
                }
            });
        });

        document.getElementById('logout-btn').addEventListener('click', () => {
            if(confirm('ログアウトしますか？')) {
                localStorage.removeItem('app_user_v2');
                location.reload();
            }
        });
    },

    // ... (renderChatList, openChat などは既存のまま) ...
    renderChatList() {
        // リーダー用：メンバー一覧を表示してクリックでチャットを開く
        // config/users.json から自分のグループのメンバーを抽出
        const members = CONFIG_USERS.filter(u => u.group === CURRENT_USER.group && u.role === 'member');
        const container = document.getElementById('chat-list');
        if(!container) return;
        
        container.innerHTML = '';
        members.forEach(member => {
            const div = document.createElement('div');
            div.className = 'p-3 border-bottom d-flex align-items-center bg-white';
            div.innerHTML = `
                <div class="rounded-circle bg-secondary text-white d-flex align-items-center justify-content-center me-3" style="width:40px; height:40px;">${member.name[0]}</div>
                <div>
                    <div class="fw-bold">${member.name}</div>
                    <div class="small text-muted">タップしてチャットを開く</div>
                </div>
            `;
            div.onclick = () => this.openChat(CURRENT_USER.group, member.id, member.name);
            container.appendChild(div);
        });
    },

    openChat(groupId, memberId, targetName) {
        // ... (既存のチャットオープン処理) ...
        // チャットIDを特定
        const chatRoomId = `${groupId}_${memberId}`;
        currentChatTargetId = chatRoomId; // 通知制御判定用に保持

        document.getElementById('chat-container').classList.add('d-none');
        document.getElementById('chat-detail-container').classList.remove('d-none');
        document.getElementById('chat-target-name').textContent = targetName;
        document.getElementById('chat-input-area').classList.remove('d-none'); // 入力欄表示

        // 前のリスナー解除
        if(unsubscribeChat) unsubscribeChat();

        // リスナー登録
        unsubscribeChat = DB.subscribeChat(groupId, memberId, (messages) => {
            const msgContainer = document.getElementById('chat-messages');
            msgContainer.innerHTML = '';
            messages.forEach(msg => {
                const isMe = msg.senderId === CURRENT_USER.id;
                const div = document.createElement('div');
                div.className = `d-flex mb-3 ${isMe ? 'justify-content-end' : 'justify-content-start'}`;
                
                let contentHtml = '';
                if (msg.image) {
                    contentHtml = `<img src="${msg.image}" class="img-fluid rounded" style="max-width:200px;">`;
                } else {
                    contentHtml = `<div class="p-2 rounded ${isMe ? 'bg-success text-white' : 'bg-white border'}">${msg.text}</div>`;
                }

                div.innerHTML = contentHtml;
                msgContainer.appendChild(div);
            });
            // 最下部へスクロール
            window.scrollTo(0, document.body.scrollHeight);
        });
        
        // 戻るボタン
        document.getElementById('back-to-chat-list').onclick = () => {
             document.getElementById('chat-detail-container').classList.add('d-none');
             document.getElementById('chat-input-area').classList.add('d-none');
             
             if(CURRENT_USER.role === 'leader') {
                 document.getElementById('chat-container').classList.remove('d-none');
             } else {
                 // メンバーは戻る場所がない（あるいはタブ切り替え扱い）
             }
             if(unsubscribeChat) unsubscribeChat();
             currentChatTargetId = null;
        };
        
        // 送信ボタン
        const sendBtn = document.getElementById('chat-send-btn');
        // イベントリスナーの重複登録を防ぐため、cloneNode等でリセットするか、onclickで上書きする
        sendBtn.onclick = async () => {
            const input = document.getElementById('chat-message-input');
            const text = input.value;
            if(!text && !chatImageBase64) return;
            
            await DB.sendMessage(groupId, memberId, CURRENT_USER, text, chatImageBase64);
            input.value = '';
            chatImageBase64 = null;
            document.getElementById('chat-image-preview').innerHTML = ''; // プレビュー消去
        };
    },
    
    startInboxListener() {
        if(unsubscribeInbox) unsubscribeInbox();
        
        // 申請/報告の監視
        unsubscribeInbox = DB.subscribeApplications(CURRENT_USER.group, (apps) => {
            const listContainer = document.getElementById('inbox-list');
            if(!listContainer) return;
            listContainer.innerHTML = '';

            apps.forEach(app => {
                // 自分がリーダーなら全て見える。メンバーなら自分が出したものか、自分宛て（指示）のもの
                // ※ここでは簡易的に全て表示し、フィルタリングは要件に合わせてください
                const div = document.createElement('div');
                div.className = 'card mb-2 p-2';
                div.innerHTML = `
                    <div class="d-flex justify-content-between">
                        <strong>${app.title}</strong>
                        <span class="badge ${app.status === 'approved' ? 'bg-success' : app.status === 'rejected' ? 'bg-danger' : 'bg-warning'}">${app.status}</span>
                    </div>
                    <div class="small text-muted">${app.userName} - ${Utils.formatDate(app.createdAt ? app.createdAt.toDate() : new Date())}</div>
                `;
                // ... クリック時の詳細表示ロジック ...
                listContainer.appendChild(div);
            });
        });
    },

    setupImageInputs() {
        // 画像添付周りの処理（既存）
    },

    setupHistoryHandler() {
        // 戻るボタン処理（既存）
    },

    // フォーム送信処理（抜粋修正）
    async handleFormSubmit() {
        // ... バリデーション ...
        const title = document.getElementById('form-title').value;
        const content = document.getElementById('form-content').value;
        
        const data = {
            title: title,
            content: content,
            userId: CURRENT_USER.id,
            userName: CURRENT_USER.name,
            groupId: CURRENT_USER.group, // ★追加：グループIDを必ず含める
            type: CURRENT_USER.role === 'leader' ? 'instruction' : 'request',
            image: formImageBase64
        };
        
        await DB.submitForm(data);
        alert('送信しました');
        // ... リセット処理 ...
    }
};

window.app = App;
window.onload = () => App.init();
