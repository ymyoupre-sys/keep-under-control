import { DB } from "./db.js";
import { Utils } from "./utils.js";
import { Calendar } from "./calendar.js";
import { db, messaging, getToken } from "./firebase-config.js";
import { onMessage } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging.js";

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
            
            // 通知設定の初期化
            this.setupNotifications();

        } catch (e) {
            console.error("Init Error", e);
            // 初期化エラーが出てもアラートは出さず、ログだけ残す
        }
    },

    setupLogin() {
        // ログイン済みチェック
        const storedUser = localStorage.getItem('app_user_v2');
        if (storedUser) {
            try {
                CURRENT_USER = JSON.parse(storedUser);
                this.showMainScreen();
                return;
            } catch (e) {
                console.error("User parse error", e);
                localStorage.removeItem('app_user_v2');
            }
        }

        const loginBtn = document.getElementById('login-btn');
        const nameInput = document.getElementById('login-name');
        const errorMsg = document.getElementById('login-error');

        if (!loginBtn || !nameInput) return;

        loginBtn.addEventListener('click', () => {
            const inputName = nameInput.value.trim();
            
            // 名前でユーザーを探す
            const user = CONFIG_USERS.find(u => u.name === inputName);
            
            if (user) {
                CURRENT_USER = user;
                localStorage.setItem('app_user_v2', JSON.stringify(user));
                this.showMainScreen();
                if(errorMsg) errorMsg.classList.add('d-none');
            } else {
                if(errorMsg) errorMsg.classList.remove('d-none');
            }
        });
    },

    showMainScreen() {
        const loginScreen = document.getElementById('login-screen');
        const mainScreen = document.getElementById('main-screen');

        if (loginScreen) loginScreen.classList.add('d-none');
        
        if (mainScreen) {
            mainScreen.classList.remove('d-none');
        } else {
            console.error('Fatal Error: id="main-screen" not found in HTML.');
            return;
        }
        
        // ユーザー名表示
        const userNameEls = document.querySelectorAll('#user-name-display');
        userNameEls.forEach(el => el.textContent = CURRENT_USER.name);

        // 権限ごとの表示切り替え
        if (CURRENT_USER.role === 'leader') {
            document.querySelectorAll('.role-leader').forEach(el => el.classList.remove('d-none'));
            document.querySelectorAll('.role-member').forEach(el => el.classList.add('d-none'));
            this.renderChatList(); 
        } else {
            document.querySelectorAll('.role-leader').forEach(el => el.classList.add('d-none'));
            document.querySelectorAll('.role-member').forEach(el => el.classList.remove('d-none'));
            // メンバーはリーダーとのチャット固定
            this.openChat(CURRENT_USER.group, CURRENT_USER.id, 'リーダー');
        }

        this.startInboxListener();
        
        // カレンダー初期化（DOM要素があるか確認してから実行）
        if(document.getElementById('tab-calendar')) {
            Calendar.init(CURRENT_USER);
        }
    },

    async setupNotifications() {
        try {
            const permission = await Notification.requestPermission();
            if (permission === 'granted') {
                console.log('Notification permission granted.');
                
                // ■ 修正点: sw.js を明示的に登録して、その登録情報を使う
                const registration = await navigator.serviceWorker.register('sw.js');
                
                // ★重要: VAPIDキーをご自身のものに書き換えてください
                const token = await getToken(messaging, { 
                    vapidKey: "BMwS...ご自身のキー...XYZ",
                    serviceWorkerRegistration: registration
                });

                if (token) {
                    console.log('FCM Token:', token);
                    await DB.saveUserToken(CURRENT_USER, token);
                }
                
                onMessage(messaging, (payload) => {
                    console.log('Message received in foreground: ', payload);
                });
            }
        } catch (error) {
            console.error('Notification setup failed:', error);
        }
    },

    setupTabs() {
        document.querySelectorAll('.bottom-nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                document.querySelectorAll('.bottom-nav-item').forEach(nav => nav.classList.remove('active'));
                item.classList.add('active');
                
                const targetId = item.getAttribute('href');
                document.querySelectorAll('.tab-content').forEach(content => content.classList.add('d-none'));
                document.querySelector(targetId).classList.remove('d-none');
                
                const labelChat = CURRENT_USER.role === 'leader' ? 'チャット一覧' : '連絡';
                const labelInbox = CURRENT_USER.role === 'leader' ? '受信箱' : '報告・申請'; 
                const labelForm = CURRENT_USER.role === 'leader' ? '指示作成' : '申請作成';

                const titleMap = { '#tab-chat': labelChat, '#tab-inbox': labelInbox, '#tab-form': labelForm, '#tab-calendar': 'カレンダー' };
                const headerTitle = document.getElementById('header-title');
                if(headerTitle) headerTitle.textContent = titleMap[targetId];

                const chatInput = document.getElementById('chat-input-area');
                
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

        const logoutBtn = document.getElementById('logout-btn');
        if(logoutBtn){
            logoutBtn.addEventListener('click', () => {
                if(confirm('ログアウトしますか？')) {
                    localStorage.removeItem('app_user_v2');
                    location.reload();
                }
            });
        }
    },

    renderChatList() {
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
        const chatRoomId = `${groupId}_${memberId}`;
        currentChatTargetId = chatRoomId;

        const chatContainer = document.getElementById('chat-container');
        const detailContainer = document.getElementById('chat-detail-container');
        
        if(chatContainer) chatContainer.classList.add('d-none');
        if(detailContainer) detailContainer.classList.remove('d-none');
        
        document.getElementById('chat-target-name').textContent = targetName;
        document.getElementById('chat-input-area').classList.remove('d-none');

        if(unsubscribeChat) unsubscribeChat();

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
            window.scrollTo(0, document.body.scrollHeight);
        });
        
        const backBtn = document.getElementById('back-to-chat-list');
        if(backBtn) {
            backBtn.onclick = () => {
                 document.getElementById('chat-detail-container').classList.add('d-none');
                 document.getElementById('chat-input-area').classList.add('d-none');
                 
                 if(CURRENT_USER.role === 'leader') {
                     if(chatContainer) chatContainer.classList.remove('d-none');
                 }
                 if(unsubscribeChat) unsubscribeChat();
                 currentChatTargetId = null;
            };
        }
        
        const sendBtn = document.getElementById('chat-send-btn');
        if(sendBtn) {
            sendBtn.onclick = async () => {
                const input = document.getElementById('chat-message-input');
                const text = input.value;
                if(!text && !chatImageBase64) return;
                
                await DB.sendMessage(groupId, memberId, CURRENT_USER, text, chatImageBase64);
                input.value = '';
                chatImageBase64 = null;
                document.getElementById('chat-image-preview').innerHTML = '';
            };
        }
    },
    
    startInboxListener() {
        if(unsubscribeInbox) unsubscribeInbox();
        
        unsubscribeInbox = DB.subscribeApplications(CURRENT_USER.group, (apps) => {
            const listContainer = document.getElementById('inbox-list');
            if(!listContainer) return;
            listContainer.innerHTML = '';

            apps.forEach(app => {
                const div = document.createElement('div');
                div.className = 'card mb-2 p-2';
                div.innerHTML = `
                    <div class="d-flex justify-content-between">
                        <strong>${app.title}</strong>
                        <span class="badge ${app.status === 'approved' ? 'bg-success' : app.status === 'rejected' ? 'bg-danger' : 'bg-warning'}">${app.status}</span>
                    </div>
                    <div class="small text-muted">${app.userName} - ${Utils.formatDate(app.createdAt ? app.createdAt.toDate() : new Date())}</div>
                `;
                listContainer.appendChild(div);
            });
        });
    },

    setupImageInputs() {
        const chatFile = document.getElementById('chat-image-file');
        if(chatFile){
            chatFile.addEventListener('change', async (e) => {
                if(e.target.files.length > 0) {
                    const base64 = await Utils.fileToBase64(e.target.files[0]);
                    chatImageBase64 = await Utils.compressImage(base64);
                    document.getElementById('chat-image-preview').innerHTML = '<span class="badge bg-secondary">画像選択中</span>';
                }
            });
        }

        const formFile = document.getElementById('form-image-file');
        if(formFile){
            formFile.addEventListener('change', async (e) => {
                if(e.target.files.length > 0) {
                    const base64 = await Utils.fileToBase64(e.target.files[0]);
                    formImageBase64 = await Utils.compressImage(base64);
                    document.getElementById('form-image-preview').innerHTML = '<img src="'+formImageBase64+'" style="width:100px;">';
                }
            });
        }
        
        const submitBtn = document.getElementById('form-submit-btn');
        if(submitBtn) {
            submitBtn.addEventListener('click', () => this.handleFormSubmit());
        }
    },

    setupHistoryHandler() {
        window.addEventListener('popstate', () => {
             const chatDetail = document.getElementById('chat-detail-container');
             if (chatDetail && !chatDetail.classList.contains('d-none')) {
                 const backBtn = document.getElementById('back-to-chat-list');
                 if(backBtn) backBtn.click();
             }
        });
    },

    async handleFormSubmit() {
        const title = document.getElementById('form-title').value;
        const content = document.getElementById('form-content').value;
        
        if(!title) {
            alert('件名は必須です');
            return;
        }

        const data = {
            title: title,
            content: content,
            userId: CURRENT_USER.id,
            userName: CURRENT_USER.name,
            groupId: CURRENT_USER.group,
            type: CURRENT_USER.role === 'leader' ? 'instruction' : 'request',
            image: formImageBase64
        };
        
        try {
            await DB.submitForm(data);
            alert('送信しました');
            document.getElementById('form-title').value = '';
            document.getElementById('form-content').value = '';
            formImageBase64 = null;
            document.getElementById('form-image-preview').innerHTML = '';
        } catch(e) {
            console.error(e);
            alert('送信に失敗しました');
        }
    }
};

window.app = App;
window.onload = () => App.init();
