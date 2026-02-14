import { DB } from "./db.js";
import { Utils } from "./utils.js";
import { Calendar } from "./calendar.js";
import { db, messaging, getToken } from "./firebase-config.js";
import { onMessage } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging.js";

let CONFIG_USERS = [];
let CONFIG_SETTINGS = {};
let CURRENT_USER = null;

let unsubscribeInbox = null;
let unsubscribeChat = null;

let currentChatTargetId = null; 
let chatImagesBase64 = []; 
let formImagesBase64 = []; 

const App = {
    async init() {
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
            this.setupTextareaAutoResize();
            this.setupHistoryHandler();

        } catch (e) {
            console.error("Init Error", e);
        }
    },

    setupHistoryHandler() {
        window.addEventListener('popstate', () => {
             const chatDetail = document.getElementById('chat-detail-container');
             if (chatDetail && !chatDetail.classList.contains('d-none')) {
                 chatDetail.classList.add('d-none');
                 document.getElementById('chat-input-area').classList.add('d-none');
                 document.getElementById('chat-container').classList.remove('d-none');
                 if(unsubscribeChat) unsubscribeChat();
                 currentChatTargetId = null;
             }
        });
    },

    setupLogin() {
        const storedUser = localStorage.getItem('app_user_v2');
        if (storedUser) {
            CURRENT_USER = JSON.parse(storedUser);
            this.showMainScreen();
            return;
        }

        const loginBtn = document.getElementById('login-btn');
        const nameInput = document.getElementById('login-name');
        if (!loginBtn || !nameInput) return;

        loginBtn.addEventListener('click', () => {
            const inputName = nameInput.value.trim();
            const user = CONFIG_USERS.find(u => u.name === inputName);
            if (user) {
                CURRENT_USER = user;
                localStorage.setItem('app_user_v2', JSON.stringify(user));
                this.showMainScreen();
            } else {
                document.getElementById('login-error').classList.remove('d-none');
            }
        });
    },

    showMainScreen() {
        document.getElementById('login-screen').classList.add('d-none');
        document.getElementById('main-screen').classList.remove('d-none');
        
        document.querySelectorAll('#user-name-display').forEach(el => el.textContent = CURRENT_USER.name);

        if (CURRENT_USER.role === 'leader') {
            document.querySelectorAll('.role-leader').forEach(el => el.classList.remove('d-none'));
            document.querySelectorAll('.role-member').forEach(el => el.classList.add('d-none'));
        } else {
            document.querySelectorAll('.role-leader').forEach(el => el.classList.add('d-none'));
            document.querySelectorAll('.role-member').forEach(el => el.classList.remove('d-none'));
        }

        const typeSelect = document.getElementById('form-type-select');
        typeSelect.innerHTML = '';
        const types = CURRENT_USER.role === 'leader' ? CONFIG_SETTINGS.instructionTypes : CONFIG_SETTINGS.applicationTypes;
        types.forEach(type => {
            const opt = document.createElement('option');
            opt.value = type; opt.textContent = type;
            typeSelect.appendChild(opt);
        });

        this.startInboxListener();
        this.renderChatList();
        this.setupNotifications();
        Calendar.init(CURRENT_USER);

        const savedTab = sessionStorage.getItem('activeTab') || '#tab-inbox';
        const targetNav = document.querySelector(`.bottom-nav-item[href="${savedTab}"]`);
        if(targetNav) targetNav.click();
    },

    setupTabs() {
        document.querySelectorAll('.bottom-nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                document.querySelectorAll('.bottom-nav-item').forEach(nav => nav.classList.remove('active'));
                item.classList.add('active');
                
                const targetId = item.getAttribute('href');
                sessionStorage.setItem('activeTab', targetId); 

                // タブを開いた時にバッジ（Nマーク）を消す
                const badge = item.querySelector('.tab-badge');
                if (badge) badge.remove();

                document.querySelectorAll('.tab-content').forEach(content => content.classList.add('d-none'));
                document.querySelector(targetId).classList.remove('d-none');
                
                const titleMap = { '#tab-chat': 'チャット', '#tab-inbox': '受信箱', '#tab-form': CURRENT_USER.role === 'leader' ? '指示作成' : '申請作成', '#tab-calendar': 'カレンダー' };
                document.getElementById('header-title').textContent = titleMap[targetId];

                const chatInput = document.getElementById('chat-input-area');
                if (targetId === '#tab-chat') {
                    const chatDetail = document.getElementById('chat-detail-container');
                    if (chatDetail && !chatDetail.classList.contains('d-none')) chatInput.classList.remove('d-none');
                    else chatInput.classList.add('d-none');
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

        window.openFullscreenImage = (src) => {
            document.getElementById('fullscreen-img').src = src;
            const modal = new bootstrap.Modal(document.getElementById('imageFullscreenModal'));
            modal.show();
        };
    },

    // --- チャット関連 ---
    renderChatList() {
        const targets = CONFIG_USERS.filter(u => u.group === CURRENT_USER.group && u.id !== CURRENT_USER.id);
        const container = document.getElementById('chat-list');
        container.innerHTML = '';
        targets.forEach(target => {
            const div = document.createElement('div');
            div.className = 'p-3 border-bottom d-flex align-items-center bg-white clickable';
            div.innerHTML = `
                <div class="rounded-circle bg-secondary text-white d-flex align-items-center justify-content-center me-3" style="width:40px; height:40px; font-size:20px;">${target.icon}</div>
                <div>
                    <div class="fw-bold">${target.name} <span class="badge bg-light text-dark ms-1">${target.role === 'leader' ? 'リーダー' : 'メンバー'}</span></div>
                    <div class="small text-muted">タップして会話を開く</div>
                </div>
            `;
            div.onclick = () => this.openChat(CURRENT_USER.group, CURRENT_USER.id, target.id, target.name);
            container.appendChild(div);
        });
    },

    openChat(groupId, myId, targetId, targetName) {
        history.pushState({chat: true}, '', '#chat'); 

        currentChatTargetId = DB.getChatRoomId(groupId, myId, targetId);

        document.getElementById('chat-container').classList.add('d-none');
        document.getElementById('chat-detail-container').classList.remove('d-none');
        document.getElementById('chat-target-name').textContent = targetName;
        document.getElementById('chat-input-area').classList.remove('d-none');

        if(unsubscribeChat) unsubscribeChat();

        const detailContainer = document.getElementById('chat-detail-container');

        unsubscribeChat = DB.subscribeChat(groupId, myId, targetId, (messages) => {
            const msgContainer = document.getElementById('chat-messages');
            msgContainer.innerHTML = '';
            messages.forEach(msg => {
                const isMe = msg.senderId === CURRENT_USER.id;
                const reactionsCount = msg.reactions ? msg.reactions.length : 0;
                const hasReacted = msg.reactions && msg.reactions.includes(CURRENT_USER.id);
                
                const div = document.createElement('div');
                div.className = `d-flex align-items-start chat-row ${isMe ? 'justify-content-end' : 'justify-content-start'}`;
                
                const iconHtml = !isMe ? `<div class="flex-shrink-0 me-2 mt-1" style="font-size:28px; line-height:1;">${msg.senderIcon}</div>` : '';
                
                let imagesHtml = '';
                if(msg.images && msg.images.length > 0) {
                    imagesHtml = `<div class="d-flex flex-wrap gap-1 mt-1 ${isMe ? 'justify-content-end' : 'justify-content-start'}">`;
                    msg.images.forEach(img => {
                        imagesHtml += `<img src="${img}" class="img-fluid rounded clickable" style="width: 100px; height: 100px; object-fit: cover;" onclick="openFullscreenImage('${img}')">`;
                    });
                    imagesHtml += `</div>`;
                }

                let textHtml = '';
                const editedLabel = msg.isEdited ? `<span class="text-muted ms-1" style="font-size:9px;">(編集済)</span>` : '';
                
                if(msg.text) {
                    textHtml = `<div class="p-2 rounded text-dark shadow-sm" style="background-color: ${isMe ? 'var(--chat-me-bg)' : 'var(--chat-other-bg)'}; display: inline-block; text-align: left;">${msg.text}${editedLabel}</div>`;
                } else if (msg.isEdited) {
                    textHtml = `<div class="w-100 ${isMe ? 'text-end' : 'text-start'}">${editedLabel}</div>`;
                }

                const reactionHtml = reactionsCount > 0 ? `<div class="reaction-badge"><i class="${hasReacted ? 'bi bi-heart-fill' : 'bi bi-heart'}"></i> ${reactionsCount}</div>` : '';

                div.innerHTML = `
                    ${iconHtml}
                    <div style="max-width: 75%; position: relative;">
                        <div class="d-flex flex-column ${isMe ? 'align-items-end' : 'align-items-start'}">
                            ${textHtml}
                            ${imagesHtml}
                        </div>
                        ${reactionHtml}
                    </div>
                `;

                if (!isMe) {
                    let pressTimer;
                    const bubble = div.querySelector('div[style*="max-width"]');
                    bubble.addEventListener('touchstart', () => {
                        pressTimer = setTimeout(() => { DB.toggleReaction(groupId, myId, targetId, msg.id, CURRENT_USER.id); }, 500);
                    }, {passive:true});
                    bubble.addEventListener('touchend', () => clearTimeout(pressTimer));
                }

                if (isMe && msg.text) {
                    const bubble = div.querySelector('div[style*="max-width"]');
                    bubble.onclick = () => {
                        const newText = prompt("メッセージを編集しますか？", msg.text);
                        if (newText !== null && newText.trim() !== "" && newText !== msg.text) {
                            DB.updateMessage(groupId, myId, targetId, msg.id, newText);
                        }
                    };
                }

                msgContainer.appendChild(div);
            });
            
            setTimeout(() => { detailContainer.scrollTop = detailContainer.scrollHeight; }, 50);
        });
        
        document.getElementById('back-to-chat-list').onclick = () => history.back(); 
        
        document.getElementById('chat-send-btn').onclick = async () => {
            const input = document.getElementById('chat-message-input');
            const text = input.value;
            if(!text && chatImagesBase64.length === 0) return;
            
            await DB.sendMessage(groupId, myId, targetId, CURRENT_USER, text, chatImagesBase64);
            input.value = '';
            input.style.height = '38px'; 
            chatImagesBase64 = [];
            this.updateImagePreview('chat-image-preview', chatImagesBase64, 'chat-image-file');
            setTimeout(() => { detailContainer.scrollTop = detailContainer.scrollHeight; }, 100);
        };
    },
    
    // --- 受信箱 ---
    startInboxListener() {
        if(unsubscribeInbox) unsubscribeInbox();
        
        unsubscribeInbox = DB.subscribeApplications(CURRENT_USER.group, (apps) => {
            const listContainer = document.getElementById('inbox-list');
            listContainer.innerHTML = '';

            apps.forEach(app => {
                if(CURRENT_USER.role === 'member' && app.userId !== CURRENT_USER.id && app.type !== 'instruction') return;

                const div = document.createElement('div');
                div.className = 'card mb-2 p-2 border-start border-4 clickable shadow-sm position-relative';
                div.style.borderLeftColor = app.status === 'pending' ? '#ffc107' : (app.status === 'approved' ? '#198754' : '#dc3545');
                
                const badgeHtml = app.type === 'instruction' 
                    ? `<span class="badge bg-primary px-3 py-1 mb-1">指示</span>`
                    : `<span class="badge border border-secondary text-secondary mb-1 px-3 py-1">申請</span>`;

                div.innerHTML = `
                    <div class="d-flex justify-content-between align-items-start pe-4">
                        <div>
                            ${badgeHtml}
                            <strong class="ms-1 d-block mt-1">${app.title}</strong>
                        </div>
                        <span class="badge ${CONFIG_SETTINGS.statusLabels[app.status]?.color || 'bg-secondary'} mt-1">${CONFIG_SETTINGS.statusLabels[app.status]?.label || app.status}</span>
                    </div>
                    <div class="small text-muted mt-2">${app.userName} - ${app.createdDateStr}</div>
                `;
                
                // ★修正：リーダーか、自分の申請（指示以外）なら×ボタンを表示して取り消し可能に
                const canDelete = CURRENT_USER.role === 'leader' || (CURRENT_USER.role === 'member' && app.userId === CURRENT_USER.id && app.type !== 'instruction');
                
                if (canDelete) {
                    const deleteBtn = document.createElement('button');
                    deleteBtn.className = "btn btn-link text-muted p-0 position-absolute";
                    deleteBtn.style.cssText = "top: 8px; right: 12px; z-index: 10;";
                    deleteBtn.innerHTML = '<i class="bi bi-x-lg"></i>';
                    deleteBtn.onclick = async (e) => {
                        e.stopPropagation(); 
                        if(confirm("本当にこの項目を取り消し（削除）しますか？\n（削除後は元に戻せません）")) {
                            await DB.deleteApplication(app.id);
                        }
                    };
                    div.appendChild(deleteBtn);
                }

                div.onclick = () => this.showInboxDetail(app);
                listContainer.appendChild(div);
            });
        });
    },

    showInboxDetail(appData) {
        document.getElementById('detail-title').textContent = appData.title;
        document.getElementById('detail-sender').textContent = appData.userName;
        document.getElementById('detail-date').textContent = appData.createdDateStr;
        document.getElementById('detail-content').textContent = appData.content || '（内容なし）';

        const imgContainer = document.getElementById('detail-images');
        imgContainer.innerHTML = '';
        if(appData.images && appData.images.length > 0) {
            appData.images.forEach(img => {
                const el = document.createElement('img');
                el.src = img;
                el.className = 'image-preview-item clickable';
                el.onclick = () => window.openFullscreenImage(img);
                imgContainer.appendChild(el);
            });
        }

        const leaderArea = document.getElementById('leader-judge-area');
        const closeModal = () => bootstrap.Modal.getInstance(document.getElementById('inboxDetailModal')).hide();

        if (CURRENT_USER.role === 'leader') {
            leaderArea.classList.remove('d-none');
            
            if (appData.type !== 'instruction') {
                document.getElementById('judge-comment-area').classList.remove('d-none');
                const commentInput = document.getElementById('judge-comment');
                commentInput.value = appData.resultComment || '';

                if (appData.status === 'pending') {
                    document.getElementById('judge-btn-group').classList.remove('d-none');
                    document.getElementById('btn-cancel-judge').classList.add('d-none');
                    
                    document.getElementById('btn-approve').onclick = async () => {
                        await DB.updateStatus(appData.id, 'approved', commentInput.value, CURRENT_USER.id);
                        closeModal(); 
                    };
                    document.getElementById('btn-reject').onclick = async () => {
                        await DB.updateStatus(appData.id, 'rejected', commentInput.value, CURRENT_USER.id);
                        closeModal(); 
                    };
                } else {
                    document.getElementById('judge-btn-group').classList.add('d-none');
                    document.getElementById('btn-cancel-judge').classList.remove('d-none');
                    
                    document.getElementById('btn-cancel-judge').onclick = async () => {
                        await DB.updateStatus(appData.id, 'pending', '', CURRENT_USER.id);
                        closeModal(); 
                    };
                }
            } else {
                document.getElementById('judge-comment-area').classList.add('d-none');
                document.getElementById('judge-btn-group').classList.add('d-none');
                document.getElementById('btn-cancel-judge').classList.add('d-none');
            }
        } else {
            leaderArea.classList.add('d-none');
        }

        const modal = new bootstrap.Modal(document.getElementById('inboxDetailModal'));
        modal.show();
    },

    // --- 画像・フォーム関連 ---
    setupImageInputs() {
        const handleFiles = async (files, arrayRef, previewId, inputId) => {
            if (files.length + arrayRef.length > 4) { alert('画像は最大4枚までです'); return; }
            for (let i = 0; i < files.length; i++) {
                const base64 = await Utils.fileToBase64(files[i]);
                const comp = await Utils.compressImage(base64);
                arrayRef.push(comp);
            }
            this.updateImagePreview(previewId, arrayRef, inputId);
        };

        document.getElementById('chat-image-file').addEventListener('change', e => {
            handleFiles(e.target.files, chatImagesBase64, 'chat-image-preview', 'chat-image-file');
        });

        document.getElementById('form-image-file').addEventListener('change', e => {
            handleFiles(e.target.files, formImagesBase64, 'form-image-preview', 'form-image-file');
        });

        document.getElementById('form-submit-btn').addEventListener('click', () => this.handleFormSubmit());
    },

    updateImagePreview(containerId, imageArray, inputId) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';
        
        if (imageArray.length === 0 && inputId) {
            document.getElementById(inputId).value = '';
        }

        imageArray.forEach((img, index) => {
            const wrapper = document.createElement('div');
            wrapper.style.position = 'relative';
            // ★修正：添付直後のプレビュー画像もタップで拡大できるようにし、透過のカスタム×ボタンを適用
            wrapper.innerHTML = `
                <img src="${img}" class="image-preview-item clickable" onclick="window.openFullscreenImage('${img}')">
                <div class="custom-close-preview"><i class="bi bi-x"></i></div>
            `;
            wrapper.querySelector('.custom-close-preview').onclick = (e) => {
                e.stopPropagation(); // 拡大表示が同時に開くのを防ぐ
                imageArray.splice(index, 1);
                this.updateImagePreview(containerId, imageArray, inputId); 
            };
            container.appendChild(wrapper);
        });
    },

    setupTextareaAutoResize() {
        const tx = document.getElementById('chat-message-input');
        tx.setAttribute('style', 'height:38px; overflow-y:hidden; resize:none;');
        tx.addEventListener("input", function() {
            this.style.height = 'auto';
            const newHeight = Math.min(this.scrollHeight, 100); 
            this.style.height = newHeight + "px";
            if(newHeight >= 100) this.style.overflowY = 'auto';
        }, false);
    },

    async handleFormSubmit() {
        const title = document.getElementById('form-type-select').value;
        const content = document.getElementById('form-content').value;
        
        const data = {
            title: title,
            content: content,
            userId: CURRENT_USER.id,
            userName: CURRENT_USER.name,
            groupId: CURRENT_USER.group,
            type: CURRENT_USER.role === 'leader' ? 'instruction' : 'request',
            images: formImagesBase64
        };
        
        try {
            await DB.submitForm(data);
            alert('送信しました');
            document.getElementById('form-content').value = '';
            formImagesBase64 = [];
            this.updateImagePreview('form-image-preview', formImagesBase64, 'form-image-file');
            document.querySelector('.bottom-nav-item[href="#tab-inbox"]').click(); 
        } catch(e) { console.error(e); alert('送信に失敗しました'); }
    },

    // --- 通知関連 ---
    // リアルタイムバッジを追加する処理
    addTabBadge(tabId) {
        const activeTab = document.querySelector('.bottom-nav-item.active').getAttribute('href');
        // 今見ているタブならバッジは付けない
        if (activeTab === tabId) return;

        const navItem = document.querySelector(`.bottom-nav-item[href="${tabId}"]`);
        if (navItem) {
            let badge = navItem.querySelector('.tab-badge');
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'tab-badge';
                badge.textContent = 'N'; // Newの意味でN
                navItem.appendChild(badge);
            }
        }
    },

    // アプリ内トースト（バナー）を表示する処理
    showToast(title, body) {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = 'bg-dark text-white p-3 rounded shadow-lg mb-2 d-flex align-items-center';
        toast.style.pointerEvents = 'auto'; // タップして消せるようにする
        toast.innerHTML = `<i class="bi bi-bell-fill text-warning me-3 fs-4"></i><div><strong class="d-block">${title}</strong><span class="small">${body}</span></div>`;
        
        toast.onclick = () => toast.remove();
        container.appendChild(toast);
        setTimeout(() => { if (toast.parentNode) toast.remove(); }, 4000);
    },

    async setupNotifications() {
        try {
            const permission = await Notification.requestPermission();
            if (permission === 'granted') {
                const registration = await navigator.serviceWorker.register('sw.js');
                const token = await getToken(messaging, { 
                    // ★ご自身のVAPIDキーをここに記載してください！
                    vapidKey: "BMdNlbLwC3bEwAIp-ZG9Uwp-5n4HdyXvlsqJbt6Q5YRdCA7gUexx0G9MpjB3AdLk6iNJodLTobC3-bGG6YskB0s", 
                    serviceWorkerRegistration: registration
                });
                if (token) await DB.saveUserToken(CURRENT_USER, token);
                
                // ★修正：アプリを開いている時のリアルタイム通知処理
                onMessage(messaging, (payload) => { 
                    console.log('Foreground Message:', payload); 
                    const title = payload.notification?.title || '新着通知';
                    const body = payload.notification?.body || '';
                    const tabType = payload.data?.tab || 'inbox'; // サーバーが送ってきたタブ情報
                    
                    // アプリ内バナーを表示
                    this.showToast(title, body);
                    // 該当タブに赤バッジを付与
                    this.addTabBadge(`#tab-${tabType}`);
                });
            }
        } catch (error) { console.error('Notification setup failed:', error); }
    }
};

window.app = App;
window.onload = () => App.init();
