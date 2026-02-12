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
        // 通知の許可を求める
        if ("Notification" in window && Notification.permission === "default") {
            Notification.requestPermission();
        }

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
            
        } catch (e) {
            console.error("Init Error", e);
            alert("初期化エラー");
        }
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
        document.getElementById('login-screen').classList.add('d-none');
        document.getElementById('app-screen').classList.remove('d-none');
        document.getElementById('user-display').textContent = `${user.group}｜${user.name} ${user.icon || ''}`;
        
        this.updateUIByRole(user);
        this.startInboxListener();
        
        if (user.role === 'member') {
            const leader = CONFIG_USERS.find(u => u.group === user.group && u.role === 'leader');
            if (leader) currentChatTargetId = user.id; // メンバーは自分のIDの部屋を見る
            this.startChatListener();
        }

        Calendar.init(user);
    },

    updateUIByRole(user) {
        const typeSelect = document.getElementById('form-type');
        const titleLabel = document.getElementById('form-title-label');
        const navForm = document.getElementById('nav-label-form');

        typeSelect.innerHTML = '';
        if (user.role === 'leader') {
            navForm.textContent = "指示";
            titleLabel.textContent = "メンバーへ指示";
            CONFIG_SETTINGS.instructionTypes.forEach(t => typeSelect.add(new Option(t, t)));
            this.renderLeaderChatList();
        } else {
            navForm.textContent = "申請";
            titleLabel.textContent = "リーダーへ申請";
            CONFIG_SETTINGS.applicationTypes.forEach(t => typeSelect.add(new Option(t, t)));
        }
        
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
            // プッシュ通知（ローカル）判定: 初回ロード以外で、アイテムが増えたor更新された場合
            // ここでは簡易的に「新しい未読がある」場合に通知
            if (!isFirstLoad && items.length > 0 && document.visibilityState === 'hidden') {
                const latest = items[0];
                // 自分が更新したものは除外
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
                // メンバーの場合、リーダーからの「指示」はステータスバッジ（承認待ち等）を出さない
                // または「完了」「未達」などの状態を表示する
                let badgeHtml = '';
                const stInfo = CONFIG_SETTINGS.statusLabels[item.status] || { label: item.status, color: 'bg-secondary' };
                
                // メンバー視点かつカテゴリが指示の場合、「承認待ち」は表示しない
                if (CURRENT_USER.role === 'member' && item.category === 'instruction' && item.status === 'pending') {
                     badgeHtml = `<span class="badge bg-info text-dark rounded-pill">指示</span>`;
                } else {
                     badgeHtml = `<span class="badge ${stInfo.color} rounded-pill">${stInfo.label}</span>`;
                }

                let imageHtml = '';
                if (item.image) {
                    imageHtml = `<div class="mt-2"><img src="${item.image}" class="img-fluid rounded border" style="max-height: 150px;"></div>`;
                }

                // コメント表示
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
        // --- リーダーの操作 ---
        if (CURRENT_USER.role === 'leader') {
            // メンバーからの申請に対して（承認待ち）
            if (item.category === 'application' && item.status === 'pending') {
                return `
                    <div class="d-flex gap-2 mt-2">
                        <button onclick="window.app.updateStatus('${item.id}', 'approved')" class="btn btn-sm btn-outline-success flex-grow-1">承認</button>
                        <button onclick="window.app.updateStatus('${item.id}', 'rejected')" class="btn btn-sm btn-outline-danger flex-grow-1">却下</button>
                    </div>
                `;
            }
            // 既に承認/却下したもの、または自分が出した指示に対して（取り消し/リセット）
            if (item.status !== 'pending') {
                 return `
                    <div class="d-flex gap-2 mt-2">
                        <button onclick="window.app.updateStatus('${item.id}', 'pending', true)" class="btn btn-sm btn-outline-secondary w-100">取り消し（ステータスリセット）</button>
                    </div>
                `;
            }
            // 自分が出した指示（pending中）に対して
            if (item.category === 'instruction' && item.status === 'pending') {
                return `
                    <div class="d-flex gap-2 mt-2">
                        <button onclick="window.app.updateStatus('${item.id}', 'canceled', true)" class="btn btn-sm btn-outline-secondary w-100">指示を取り消す</button>
                    </div>
                `;
            }
        }

        // --- メンバーの操作 ---
        if (CURRENT_USER.role === 'member') {
            // リーダーからの指示に対して（完了/未達報告）
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
        if (isRevoke) msg = '取り消しますか？';
        else if (status === 'approved') msg = '承認しますか？';
        else if (status === 'rejected') msg = '却下しますか？';
        else if (status === 'completed') msg = '完了として報告しますか？';
        else if (status === 'incomplete') msg = '未達として報告しますか？';
        
        if(!confirm(msg)) return;

        // コメント入力
        const comment = prompt("コメントがあれば入力してください（任意）");

        await DB.updateStatus(id, status, comment, CURRENT_USER.id);
        
        // ローカルでの通知（相手への通知はDBリスナー経由で行われるが、念のため自分にもフィードバック）
        // alert('更新しました');
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
    renderLeaderChatList() {
        const container = document.getElementById('chat-container');
        container.innerHTML = `<h6 class="px-2 py-3 text-muted border-bottom">メンバーを選択してメッセージ</h6>`;
        const myMembers = CONFIG_USERS.filter(u => u.group === CURRENT_USER.group && u.role === 'member');
        
        myMembers.forEach(m => {
            const row = document.createElement('div');
            row.className = "d-flex align-items-center p-3 border-bottom bg-white clickable";
            row.onclick = () => {
                currentChatTargetId = m.id;
                this.startChatListener();
                this.renderChatHeader(m.name);
            };
            row.innerHTML = `
                <div class="user-icon">${m.icon || '👤'}</div>
                <div class="fw-bold">${m.name}</div>
                <div class="ms-auto text-muted small"><i class="bi bi-chevron-right"></i></div>
            `;
            container.appendChild(row);
        });
        document.getElementById('chat-input-area').classList.add('d-none');
    },

    renderChatHeader(targetName) {
        document.getElementById('header-title').textContent = `${targetName}とメッセージ`;
        document.getElementById('chat-input-area').classList.remove('d-none');
    },

    startChatListener() {
        if (unsubscribeChat) unsubscribeChat();
        
        const targetMemberId = CURRENT_USER.role === 'member' ? CURRENT_USER.id : currentChatTargetId;
        if (!targetMemberId) return;

        const container = document.getElementById('chat-container');
        container.innerHTML = '<div class="p-3 text-center text-muted small">ここでの会話は他言無用です...🤫</div>';

        let isFirstLoad = true;

        unsubscribeChat = DB.subscribeChat(CURRENT_USER.group, targetMemberId, (messages) => {
            // 新規メッセージ通知（別タブを開いている時など）
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

                // HTML構造：時間（上）→ バブル（下）
                // 相手の場合：アイコン（左）→ ラッパー（時間→バブル）
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
            
            // スクロール制御（修正済み）
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
        // 画像もテキストも無い場合は送信不可
        if (!text && !chatImageBase64) return;
        
        const targetMemberId = CURRENT_USER.role === 'member' ? CURRENT_USER.id : currentChatTargetId;
        try {
            await DB.sendMessage(CURRENT_USER.group, targetMemberId, CURRENT_USER, text, chatImageBase64);
            input.value = '';
            chatImageBase64 = null;
            document.getElementById('chat-image-preview').innerHTML = '';
            document.getElementById('chat-image-preview').classList.add('d-none');
        } catch (e) { console.error(e); alert('送信失敗'); }
    },

    // --- 申請/指示フォーム ---
    async submitForm() {
        const type = document.getElementById('form-type').value;
        const body = document.getElementById('form-body').value;
        // 詳細なしでもOK、ただし画像も詳細もなければエラー
        if (!body && !formImageBase64) { 
            if(!confirm('詳細も画像もありませんが送信しますか？')) return; 
        }
        
        let targetId = null;
        let targetName = '';
        let category = '';

        if (CURRENT_USER.role === 'leader') {
            const targetNameInput = prompt("宛先のメンバー名を入力してください（完全一致）");
            if (!targetNameInput) return;
            const targetUser = CONFIG_USERS.find(u => u.name === targetNameInput && u.group === CURRENT_USER.group);
            if (!targetUser) { alert('該当するメンバーがいません'); return; }
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
            document.querySelector('[data-target="#tab-inbox"]').click();
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

                if (targetId === '#tab-chat' && CURRENT_USER.role === 'leader' && !currentChatTargetId) {
                    this.renderLeaderChatList();
                }
                
                const chatInput = document.getElementById('chat-input-area');
                if (targetId === '#tab-chat') {
                     if (!(CURRENT_USER.role === 'leader' && !currentChatTargetId)) {
                         chatInput.classList.remove('d-none');
                         // タブ開いた時も最下部へ
                         if(mainScroll) mainScroll.scrollTop = mainScroll.scrollHeight;
                     } else {
                         chatInput.classList.add('d-none');
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
