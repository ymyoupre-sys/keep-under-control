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
            if (leader) currentChatTargetId = user.id; 
            this.startChatListener();
        }

        Calendar.init(user);
    },

    updateUIByRole(user) {
        const typeSelect = document.getElementById('form-type');
        const titleLabel = document.getElementById('form-title-label');
        const navChat = document.getElementById('nav-label-chat');
        const navForm = document.getElementById('nav-label-form');

        typeSelect.innerHTML = '';
        if (user.role === 'leader') {
            navChat.textContent = "連絡";
            navForm.textContent = "指示";
            titleLabel.textContent = "メンバーへ指示";
            CONFIG_SETTINGS.instructionTypes.forEach(t => typeSelect.add(new Option(t, t)));
            this.renderLeaderChatList();
        } else {
            navChat.textContent = "報告";
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

        unsubscribeInbox = DB.subscribeInbox(CURRENT_USER, (items) => {
            listEl.innerHTML = '';
            if (items.length === 0) {
                listEl.innerHTML = '<div class="text-center text-muted mt-5 p-3">現在、対応が必要な項目はありません<br>☕</div>';
                return;
            }

            items.forEach(item => {
                const stInfo = CONFIG_SETTINGS.statusLabels[item.status] || { label: item.status, color: 'bg-secondary' };
                let imageHtml = '';
                if (item.image) {
                    imageHtml = `<div class="mt-2"><img src="${item.image}" class="img-fluid rounded border" style="max-height: 150px;"></div>`;
                }

                const div = document.createElement('div');
                div.className = "list-group-item p-3 border-0 border-bottom";
                div.innerHTML = `
                    <div class="d-flex justify-content-between align-items-center mb-1">
                        <span class="badge ${stInfo.color} rounded-pill">${stInfo.label}</span>
                        <small class="text-muted" style="font-size: 0.75rem">${item.createdDateStr || ''}</small>
                    </div>
                    <h6 class="mb-1 fw-bold">${item.type}</h6>
                    <div class="small text-muted mb-2">
                        <span class="me-2">${item.applicantName || '不明'}</span>
                        <i class="bi bi-arrow-right-short"></i>
                        <span>${item.targetName || 'リーダー'}</span>
                    </div>
                    <div class="mb-2 text-secondary small bg-light p-2 rounded">
                        ${item.body}
                        ${imageHtml}
                    </div>
                    ${this.createActionButtons(item)}
                `;
                listEl.appendChild(div);
            });
        });
    },

    createActionButtons(item) {
        if (CURRENT_USER.role === 'leader' && item.category === 'application' && item.status === 'pending') {
            return `
                <div class="d-flex gap-2 mt-2">
                    <button onclick="window.app.updateStatus('${item.id}', 'approved')" class="btn btn-sm btn-outline-success flex-grow-1">承認</button>
                    <button onclick="window.app.updateStatus('${item.id}', 'rejected')" class="btn btn-sm btn-outline-danger flex-grow-1">却下</button>
                </div>
            `;
        }
        return '';
    },

    async updateStatus(id, status) {
        if(!confirm(status === 'approved' ? '承認しますか？' : '却下しますか？')) return;
        await DB.updateStatus(id, status);
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

    // --- チャット機能 ---
    renderLeaderChatList() {
        const container = document.getElementById('chat-container');
        container.innerHTML = `<h6 class="px-2 py-3 text-muted border-bottom">メンバーを選択して連絡</h6>`;
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
        document.getElementById('header-title').textContent = `${targetName}と連絡`;
        document.getElementById('chat-input-area').classList.remove('d-none');
    },

    startChatListener() {
        if (unsubscribeChat) unsubscribeChat();
        
        const targetMemberId = CURRENT_USER.role === 'member' ? CURRENT_USER.id : currentChatTargetId;
        if (!targetMemberId) return;

        const container = document.getElementById('chat-container');
        container.innerHTML = '<div class="p-3 text-center text-muted small">ここでの会話は他言無用です...🤫</div>';

        unsubscribeChat = DB.subscribeChat(CURRENT_USER.group, targetMemberId, (messages) => {
            container.innerHTML = ''; 
            
            messages.forEach(msg => {
                const isMe = msg.senderId === CURRENT_USER.id;
                const row = document.createElement('div');
                row.className = isMe ? "chat-row-me mb-2" : "chat-row-other mb-2";
                
                let content = msg.text || '';
                if (msg.image) {
                    content = `<img src="${msg.image}" class="img-fluid rounded mb-1" style="max-width:200px"><br>${content}`;
                }

                row.innerHTML = `
                    ${!isMe ? `<div class="user-icon small" style="width:28px;height:28px">${msg.senderIcon}</div>` : ''}
                    <div class="${isMe ? 'chat-bubble-me' : 'chat-bubble-other'} chat-bubble">
                        ${content}
                        <div class="text-end text-muted mt-1" style="font-size:0.6rem; opacity:0.7">
                            ${msg.createdAt ? Utils.formatTime(msg.createdAt.toDate()) : '...'}
                        </div>
                    </div>
                `;
                container.appendChild(row);
            });
            // チャットの時は自動でスクロールを下げる
            const mainScroll = document.getElementById('main-scroll');
            if (mainScroll) mainScroll.scrollTop = mainScroll.scrollHeight;
        });
    },

    async sendChatMessage() {
        const input = document.getElementById('chat-input-text');
        const text = input.value.trim();
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

    // --- 申請フォーム ---
    async submitForm() {
        const type = document.getElementById('form-type').value;
        const body = document.getElementById('form-body').value;
        if (!body && !formImageBase64) { alert('内容を入力してください'); return; }
        
        let targetId = null;
        let targetName = '';
        let category = '';

        if (CURRENT_USER.role === 'leader') {
            const targetNameInput = prompt("宛先のメンバー名を入力してください（完全一致）");
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
                
                // ★タブ切り替え時にスクロールを最上部へリセット
                const mainScroll = document.getElementById('main-scroll');
                if (mainScroll) mainScroll.scrollTop = 0;

                const labelChat = document.getElementById('nav-label-chat').textContent;
                const labelForm = document.getElementById('nav-label-form').textContent;
                const titleMap = { '#tab-inbox': '受信箱', '#tab-chat': labelChat, '#tab-form': labelForm, '#tab-calendar': '予定' };
                document.getElementById('header-title').textContent = titleMap[targetId];

                if (targetId === '#tab-chat' && CURRENT_USER.role === 'leader' && !currentChatTargetId) {
                    this.renderLeaderChatList();
                }
                
                // チャット入力欄の表示/非表示（d-noneクラスで制御）
                const chatInput = document.getElementById('chat-input-area');
                if (targetId === '#tab-chat') {
                     // チャット画面では、リーダーでメンバー未選択時以外は表示
                     if (!(CURRENT_USER.role === 'leader' && !currentChatTargetId)) {
                         chatInput.classList.remove('d-none');
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
