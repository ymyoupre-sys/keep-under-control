import { DB } from "./db.js";
import { Utils } from "./utils.js";
import { Calendar } from "./calendar.js";

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
        // ※ここでは通知許可を求めず、ログインアクション時（ユーザー操作時）に求めるように変更

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

    // --- 戻るボタン制御 (History API) ---
    setupHistoryHandler() {
        window.addEventListener('popstate', (event) => {
            // チャット詳細が開いていて、戻る操作がされた場合
            const chatDetail = document.getElementById('chat-detail-container');
            if (!chatDetail.classList.contains('d-none')) {
                this.closeChatDetail();
            }
        });
    },

    // --- ログイン周り ---
    setupLogin() {
        const btn = document.getElementById('login-btn');
        const input = document.getElementById('login-name');
        const savedUser = localStorage.getItem('app_user_v2');
        if (savedUser) { this.loginSuccess(JSON.parse(savedUser)); return; }

        btn.addEventListener('click', () => {
            const name = input.value.trim();
            const user = CONFIG_USERS.find(u => u.name === name);
            if (user) {
                localStorage.setItem('app_user_v2', JSON.stringify(user));
                this.loginSuccess(user);
            } else {
                document.getElementById('login-error').classList.remove('d-none');
            }
        });
    },

    loginSuccess(user) {
        CURRENT_USER = user;
        
        // ★修正: ログインアクション時（ユーザー操作時）に通知許可を求める
        if ("Notification" in window && Notification.permission === "default") {
            Notification.requestPermission();
        }

        document.getElementById('login-screen').classList.add('d-none');
        document.getElementById('app-screen').classList.remove('d-none');
        document.getElementById('user-display').textContent = `${user.group}｜${user.name} ${user.icon || ''}`;
        
        this.updateUIByRole(user);
        this.startInboxListener();
        
        // ★修正: 奴隷も最初は「未選択」状態にするため、ここでのリスナー開始は削除
        // if (user.role === 'member') { ... } 削除

        Calendar.init(user);

        // 起動時は必ず「受信箱」を開く
        document.querySelector('[data-target="#tab-inbox"]').click();
    },

    updateUIByRole(user) {
        const typeSelect = document.getElementById('form-type');
        const titleLabel = document.getElementById('form-title-label');
        const navForm = document.getElementById('nav-label-form');

        typeSelect.innerHTML = '';
        if (user.role === 'leader') {
            navForm.textContent = "命令";
            titleLabel.textContent = "奴隷へ命令";
            CONFIG_SETTINGS.instructionTypes.forEach(t => typeSelect.add(new Option(t, t)));
        } else {
            navForm.textContent = "許可申請";
            titleLabel.textContent = "主人へ許可申請";
            CONFIG_SETTINGS.applicationTypes.forEach(t => typeSelect.add(new Option(t, t)));
        }
        
        // ★修正: 主人/奴隷問わず、チャットリスト（相手一覧）を描画する
        this.renderChatList();
        
        document.getElementById('submit-form-btn').onclick = () => this.submitForm();
        document.getElementById('send-chat-btn').onclick = () => this.sendChatMessage();
    },

    // --- 受信箱機能 (Inbox) ---
    startInboxListener() {
        if (unsubscribeInbox) unsubscribeInbox();
        
        const listEl = document.getElementById('inbox-list');
        listEl.innerHTML = '<div class="text-center mt-5"><div class="spinner-border text-success"></div></div>';

        let isFirstLoad = true;

        unsubscribeInbox = DB.subscribeInbox(CURRENT_USER, (items) => {
            if (!isFirstLoad && items.length > 0 && document.visibilityState === 'hidden') {
                const latest = items[0];
                if (latest.updatedBy !== CURRENT_USER.id) {
                    this.showLocalNotification("新着通知", `${latest.type}: ${latest.status}`);
                }
            }
            isFirstLoad = false;

            listEl.innerHTML = '';
            if (items.length === 0) {
                listEl.innerHTML = '<div class="text-center text-muted mt-5 p-3">現在、対応が必要な項目はありません<br>☕</div>';
                return;
            }

            items.forEach(item => {
                let badgeHtml = '';
                const stInfo = CONFIG_SETTINGS.statusLabels[item.status] || { label: item.status, color: 'bg-secondary' };
                
                if (CURRENT_USER.role === 'member' && item.category === 'instruction' && item.status === 'pending') {
                     badgeHtml = `<span class="badge bg-info text-dark rounded-pill">命令</span>`;
                } else {
                     badgeHtml = `<span class="badge ${stInfo.color} rounded-pill">${stInfo.label}</span>`;
                }

                let imageHtml = '';
                if (item.image) {
                    imageHtml = `<div class="mt-2"><img src="${item.image}" class="img-fluid rounded border" style="max-height: 150px;"></div>`;
                }

                let commentHtml = '';
                if (item.resultComment) {
                    commentHtml = `<div class="mt-2 p-2 bg-white border rounded small text-danger"><i class="bi bi-chat-quote-fill me-1"></i>${item.resultComment}</div>`;
                }

                const div = document.createElement('div');
                div.className = "list-group-item p-3 border-0 border-bottom";
                div.innerHTML = `
                    <div class="d-flex justify-content-between align-items-center mb-1">
                        ${badgeHtml}
                        <small class="text-muted" style="font-size: 0.75rem">${item.createdDateStr || ''}</small>
                    </div>
                    <h6 class="mb-1 fw-bold">${item.type}</h6>
                    <div class="small text-muted mb-2">
                        <span class="me-2">${item.applicantName || '不明'}</span>
                        <i class="bi bi-arrow-right-short"></i>
                        <span>${item.targetName || '相手'}</span>
                    </div>
                    <div class="mb-2 text-secondary small bg-light p-2 rounded">
                        ${item.body || '(詳細なし)'}
                        ${imageHtml}
                        ${commentHtml}
                    </div>
                    ${this.createActionButtons(item)}
                `;
                listEl.appendChild(div);
            });
        });
    },

    showLocalNotification(title, body) {
        if (Notification.permission === "granted") {
            new Notification(title, { body: body, icon: 'images/icon.png' });
        }
    },

    createActionButtons(item) {
        if (CURRENT_USER.role === 'leader') {
            if (item.category === 'application' && item.status === 'pending') {
                return `
                    <div class="d-flex gap-2 mt-2">
                        <button onclick="window.app.updateStatus('${item.id}', 'approved')" class="btn btn-sm btn-outline-success flex-grow-1">承認</button>
                        <button onclick="window.app.updateStatus('${item.id}', 'rejected')" class="btn btn-sm btn-outline-danger flex-grow-1">却下</button>
                    </div>
                `;
            }
            if (item.status !== 'pending' && item.category === 'application') {
                 return `
                    <div class="d-flex gap-2 mt-2">
                        <button onclick="window.app.updateStatus('${item.id}', 'pending', true)" class="btn btn-sm btn-outline-secondary w-100">取り消し（ステータスリセット）</button>
                    </div>
                `;
            }
            if (item.category === 'instruction') {
                return `
                    <div class="d-flex gap-2 mt-2">
                        <button onclick="window.app.deleteItem('${item.id}')" class="btn btn-sm btn-outline-secondary w-100">命令を取り消す（削除）</button>
                    </div>
                `;
            }
        }

        if (CURRENT_USER.role === 'member') {
            if (item.category === 'instruction' && item.status === 'pending') {
                 return `
                    <div class="d-flex gap-2 mt-2">
                        <button onclick="window.app.updateStatus('${item.id}', 'completed')" class="btn btn-sm btn-outline-primary flex-grow-1">完了</button>
                        <button onclick="window.app.updateStatus('${item.id}', 'incomplete')" class="btn btn-sm btn-outline-danger flex-grow-1">未達</button>
                    </div>
                `;
            }
        }
        return '';
    },

    async updateStatus(id, status, isRevoke = false) {
        let msg = '';
        if (isRevoke) msg = 'ステータスをリセットしますか？';
        else if (status === 'approved') msg = '承認しますか？';
        else if (status === 'rejected') msg = '却下しますか？';
        else if (status === 'completed') msg = '完了として報告しますか？';
        else if (status === 'incomplete') msg = '未達として報告しますか？';
        
        if(!confirm(msg)) return;
        const comment = prompt("コメントがあれば入力してください（任意）");
        await DB.updateStatus(id, status, comment, CURRENT_USER.id);
    },

    async deleteItem(id) {
        if(!confirm('この命令を完全に削除しますか？\n（相手の画面からも消えます）')) return;
        await DB.deleteApplication(id);
    },

    // --- 画像処理関連 ---
    setupImageInputs() {
        const plusBtn = document.querySelector('#chat-input-area .btn-secondary');
        if (plusBtn) {
            const hiddenInput = document.createElement('input');
            hiddenInput.type = 'file';
            hiddenInput.accept = 'image/*';
            hiddenInput.style.display = 'none';
            document.body.appendChild(hiddenInput);
            
            plusBtn.onclick = () => hiddenInput.click();
            
            hiddenInput.onchange = async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                try {
                    const base64 = await Utils.fileToBase64(file);
                    chatImageBase64 = await Utils.compressImage(base64);
                    
                    const previewArea = document.getElementById('chat-image-preview');
                    previewArea.classList.remove('d-none');
                    this.showImagePreview('chat-image-preview', chatImageBase64, () => {
                        chatImageBase64 = null;
                        previewArea.classList.add('d-none');
                        hiddenInput.value = '';
                    });
                } catch(err) { console.error(err); }
            };
        }

        const formFileIn = document.querySelector('#tab-form input[type="file"]');
        if (formFileIn) {
            formFileIn.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                try {
                    const base64 = await Utils.fileToBase64(file);
                    formImageBase64 = await Utils.compressImage(base64);
                    
                    const previewArea = document.getElementById('form-image-preview');
                    previewArea.classList.remove('d-none');
                    this.showImagePreview('form-image-preview', formImageBase64, () => {
                        formImageBase64 = null;
                        formFileIn.value = '';
                        previewArea.classList.add('d-none');
                    });
                } catch (err) { console.error(err); }
            });
        }
    },

    showImagePreview(containerId, base64, onClose) {
        const container = document.getElementById(containerId);
        container.innerHTML = `
            <div class="image-preview-container">
                <img src="${base64}">
                <button class="btn-close"></button>
            </div>
        `;
        container.querySelector('.btn-close').onclick = () => {
            container.innerHTML = '';
            onClose();
        };
    },

    // --- メッセージ（チャット）機能 ---
    
    // ★修正: 主人/奴隷共用のチャット相手リスト描画
    renderChatList() {
        const container = document.getElementById('chat-container');
        container.classList.remove('d-none'); 
        
        let targets = [];
        if (CURRENT_USER.role === 'leader') {
            // 主人は奴隷全員を表示
            targets = CONFIG_USERS.filter(u => u.group === CURRENT_USER.group && u.role === 'member');
            container.innerHTML = `<h6 class="px-2 py-3 text-muted border-bottom">奴隷を選択してメッセージ</h6>`;
        } else {
            // 奴隷は主人を表示
            targets = CONFIG_USERS.filter(u => u.group === CURRENT_USER.group && u.role === 'leader');
            container.innerHTML = `<h6 class="px-2 py-3 text-muted border-bottom">主人を選択して報告</h6>`;
        }
        
        targets.forEach(user => {
            const row = document.createElement('div');
            row.className = "d-flex align-items-center p-3 border-bottom bg-white clickable";
            row.onclick = () => {
                currentChatTargetId = user.id; // 相手のIDをセット
                this.openChatDetail(user.name);
            };
            row.innerHTML = `
                <div class="user-icon">${user.icon || '👤'}</div>
                <div class="fw-bold">${user.name}</div>
                <div class="ms-auto text-muted small"><i class="bi bi-chevron-right"></i></div>
            `;
            container.appendChild(row);
        });
        
        document.getElementById('chat-input-area').classList.add('d-none');
        document.getElementById('header-title').textContent = "メッセージ";
    },

    // チャット詳細を開く
    openChatDetail(targetName) {
        history.pushState({chat: true}, '', '#chat-detail');

        document.getElementById('chat-container').classList.add('d-none'); 
        document.getElementById('chat-detail-container').classList.remove('d-none'); 
        
        const headerTitle = document.getElementById('header-title');
        headerTitle.innerHTML = `<i class="bi bi-chevron-left me-1" onclick="window.history.back()"></i> ${targetName}`;
        headerTitle.classList.add('clickable');
        headerTitle.onclick = () => window.history.back();

        document.getElementById('chat-input-area').classList.remove('d-none');
        this.startChatListener();
    },

    // チャット詳細を閉じて一覧に戻る
    closeChatDetail() {
        if(unsubscribeChat) unsubscribeChat();
        
        document.getElementById('chat-detail-container').innerHTML = ''; 
        document.getElementById('chat-detail-container').classList.add('d-none');
        document.getElementById('chat-container').classList.remove('d-none'); 
        
        document.getElementById('chat-input-area').classList.add('d-none');

        const headerTitle = document.getElementById('header-title');
        headerTitle.textContent = "メッセージ";
        headerTitle.classList.remove('clickable');
        headerTitle.onclick = null;
    },

    startChatListener() {
        if (unsubscribeChat) unsubscribeChat();
        
        // ★修正: 奴隷の場合も currentChatTargetId（主人ID）を使う
        let targetMemberId = currentChatTargetId;
        
        // ※補足: DB構造上、チャットルームIDは「GROUP_MEMBERID」というルールになっている
        // 主人視点: 相手(Member)のIDを使う
        // 奴隷視点: 自分(Member)のIDを使う
        if (CURRENT_USER.role === 'member') {
            targetMemberId = CURRENT_USER.id;
        }
        
        if (!targetMemberId) return;

        const container = document.getElementById('chat-detail-container');
        container.innerHTML = '<div class="p-3 text-center text-muted small">ここでの会話は他言無用です...🤫</div>';

        let isFirstLoad = true;

        unsubscribeChat = DB.subscribeChat(CURRENT_USER.group, targetMemberId, (messages) => {
            if(!isFirstLoad && messages.length > 0 && document.visibilityState === 'hidden') {
                const lastMsg = messages[messages.length - 1];
                if(lastMsg.senderId !== CURRENT_USER.id) {
                    this.showLocalNotification("新着メッセージ", lastMsg.text || '画像が送信されました');
                }
            }
            isFirstLoad = false;

            container.innerHTML = ''; 
            
            messages.forEach(msg => {
                const isMe = msg.senderId === CURRENT_USER.id;
                const row = document.createElement('div');
                row.className = isMe ? "chat-row-me mb-2" : "chat-row-other mb-2";
                
                let content = msg.text || '';
                if (msg.image) {
                    content = `<img src="${msg.image}" class="img-fluid rounded mb-1" style="max-width:200px"><br>${content}`;
                }

                const timeStr = msg.createdAt ? Utils.formatTime(msg.createdAt.toDate()) : '...';

                if (!isMe) {
                    row.innerHTML = `
                        <div class="user-icon small">${msg.senderIcon}</div>
                        <div class="chat-content-wrapper">
                            <div class="chat-time ms-1">${timeStr}</div>
                            <div class="chat-bubble chat-bubble-other">${content}</div>
                        </div>
                    `;
                } else {
                    row.innerHTML = `
                        <div class="chat-content-wrapper">
                            <div class="chat-time text-end me-1">${timeStr}</div>
                            <div class="chat-bubble chat-bubble-me">${content}</div>
                        </div>
                    `;
                }
                container.appendChild(row);
            });
            
            const mainScroll = document.getElementById('main-scroll');
            const chatTab = document.getElementById('tab-chat');
            if (mainScroll && chatTab && chatTab.classList.contains('active')) {
                mainScroll.scrollTop = mainScroll.scrollHeight;
            }
        });
    },

    async sendChatMessage() {
        const input = document.getElementById('chat-input-text');
        const text = input.value.trim();
        if (!text && !chatImageBase64) return;
        
        // ★修正: 奴隷の場合もチャットルームID生成のために自分のIDを使う
        let targetMemberId = currentChatTargetId;
        if (CURRENT_USER.role === 'member') {
            targetMemberId = CURRENT_USER.id;
        }

        try {
            await DB.sendMessage(CURRENT_USER.group, targetMemberId, CURRENT_USER, text, chatImageBase64);
            input.value = '';
            chatImageBase64 = null;
            document.getElementById('chat-image-preview').innerHTML = '';
            document.getElementById('chat-image-preview').classList.add('d-none');
        } catch (e) { console.error(e); alert('送信失敗'); }
    },

    // --- 許可申請/命令フォーム ---
    async submitForm() {
        const type = document.getElementById('form-type').value;
        const body = document.getElementById('form-body').value;
        if (!body && !formImageBase64) { 
            if(!confirm('詳細も画像もありませんが送信しますか？')) return; 
        }
        
        let targetId = null;
        let targetName = '';
        let category = '';

        if (CURRENT_USER.role === 'leader') {
            const targetNameInput = prompt("宛先の奴隷名を入力してください（完全一致）");
            if (!targetNameInput) return;
            const targetUser = CONFIG_USERS.find(u => u.name === targetNameInput && u.group === CURRENT_USER.group);
            if (!targetUser) { alert('該当する奴隷がいません'); return; }
            targetId = targetUser.id;
            targetName = targetUser.name;
            category = 'instruction';
        } else {
            const leader = CONFIG_USERS.find(u => u.group === CURRENT_USER.group && u.role === 'leader');
            targetId = leader.id;
            targetName = leader.name;
            category = 'application';
        }

        try {
            await DB.submitForm({
                category, type, body,
                image: formImageBase64,
                applicantId: CURRENT_USER.id,
                applicantName: CURRENT_USER.name,
                targetId: targetId,
                targetName: targetName,
                groupId: CURRENT_USER.group
            });
            alert('送信しました');
            document.getElementById('form-body').value = '';
            formImageBase64 = null;
            document.getElementById('form-image-preview').innerHTML = '';
            document.getElementById('form-image-preview').classList.add('d-none');
            
        } catch(e) { console.error(e); alert('エラー発生'); }
    },
    
    // --- タブ切り替え ---
    setupTabs() {
        const navLinks = document.querySelectorAll('.nav-link[data-target]');
        navLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                navLinks.forEach(l => l.classList.remove('active'));
                link.classList.add('active');

                const targetId = link.getAttribute('data-target');
                document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('show', 'active'));
                document.querySelector(targetId).classList.add('show', 'active');
                
                const mainScroll = document.getElementById('main-scroll');
                if (mainScroll) mainScroll.scrollTop = 0;

                const labelForm = document.getElementById('nav-label-form').textContent;
                const titleMap = { '#tab-inbox': '受信箱', '#tab-chat': 'メッセージ', '#tab-form': labelForm, '#tab-calendar': 'カレンダー' };
                document.getElementById('header-title').textContent = titleMap[targetId];

                // チャットタブ切り替え時の制御
                const chatInput = document.getElementById('chat-input-area');
                if (targetId === '#tab-chat') {
                    // ★修正: 奴隷も最初は一覧画面（詳細コンテナがd-noneなら一覧を表示）
                    const chatDetail = document.getElementById('chat-detail-container');
                    if (chatDetail.classList.contains('d-none')) {
                         // 一覧表示中
                         document.getElementById('chat-container').classList.remove('d-none');
                         this.renderChatList(); // 再描画
                         chatInput.classList.add('d-none');
                    } else {
                         // 詳細表示中（戻るボタンで戻らなかった場合など）
                         chatInput.classList.remove('d-none');
                    }
                } else {
                    chatInput.classList.add('d-none');
                }
            });
        });

        document.getElementById('logout-btn').addEventListener('click', () => {
            if(confirm('ログアウトしますか？')) {
                localStorage.removeItem('app_user_v2');
                location.reload();
            }
        });
    }
};

window.app = App;
window.onload = () => App.init();
