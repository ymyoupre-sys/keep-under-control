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
let chatImagesBase64 = []; // 複数画像用配列
let formImagesBase64 = []; // 複数画像用配列

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
            this.setupPullToRefresh();
            this.setupTextareaAutoResize();

        } catch (e) {
            console.error("Init Error", e);
        }
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

        // 申請/指示のプルダウン作成
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

        // 前回のタブを復元 (デフォルトは受信箱)
        const savedTab = sessionStorage.getItem('activeTab') || '#tab-inbox';
        const targetNav = document.querySelector(`.bottom-nav-item[href="${savedTab}"]`);
        if(targetNav) targetNav.click();
    },

    // --- プルリフレッシュ (引っ張って更新) ---
    setupPullToRefresh() {
        let touchstartY = 0;
        const scrollArea = document.getElementById('scrollable-content');
        const indicator = document.getElementById('ptr-indicator');

        scrollArea.addEventListener('touchstart', e => {
            if (scrollArea.scrollTop === 0) touchstartY = e.touches[0].clientY;
        }, {passive: true});

        scrollArea.addEventListener('touchmove', e => {
            if (scrollArea.scrollTop === 0 && touchstartY > 0) {
                const dy = e.touches[0].clientY - touchstartY;
                if (dy > 0 && dy < 100) {
                    indicator.style.height = `${dy}px`;
                    indicator.style.lineHeight = `${dy}px`;
                }
            }
        }, {passive: true});

        scrollArea.addEventListener('touchend', e => {
            if (indicator.style.height && parseInt(indicator.style.height) > 60) {
                indicator.textContent = "更新中...";
                location.reload();
            } else {
                indicator.style.height = '0';
            }
            touchstartY = 0;
        });
    },

    setupTabs() {
        document.querySelectorAll('.bottom-nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                document.querySelectorAll('.bottom-nav-item').forEach(nav => nav.classList.remove('active'));
                item.classList.add('active');
                
                const targetId = item.getAttribute('href');
                sessionStorage.setItem('activeTab', targetId); // タブ状態保存

                document.querySelectorAll('.tab-content').forEach(content => content.classList.add('d-none'));
                document.querySelector(targetId).classList.remove('d-none');
                
                const titleMap = { '#tab-chat': 'チャット', '#tab-inbox': '受信箱', '#tab-form': CURRENT_USER.role === 'leader' ? '指示作成' : '申請作成', '#tab-calendar': 'カレンダー' };
                document.getElementById('header-title').textContent = titleMap[targetId];

                const chatInput = document.getElementById('chat-input-area');
                if (targetId === '#tab-chat') {
                    const chatDetail = document.getElementById('chat-detail-container');
                    if (chatDetail && !chatDetail.classList.contains('d-none')) {
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

        // モーダルの画像フルスクリーン表示機能
        window.openFullscreenImage = (src) => {
            document.getElementById('fullscreen-img').src = src;
            const modal = new bootstrap.Modal(document.getElementById('imageFullscreenModal'));
            modal.show();
        };
    },

    // --- チャット関連 ---
    renderChatList() {
        // 同じグループの自分以外全員をリスト表示（リーダーもメンバーも）
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
        currentChatTargetId = DB.getChatRoomId(groupId, myId, targetId);

        document.getElementById('chat-container').classList.add('d-none');
        document.getElementById('chat-detail-container').classList.remove('d-none');
        document.getElementById('chat-target-name').textContent = targetName;
        document.getElementById('chat-input-area').classList.remove('d-none');

        if(unsubscribeChat) unsubscribeChat();

        unsubscribeChat = DB.subscribeChat(groupId, myId, targetId, (messages) => {
            const msgContainer = document.getElementById('chat-messages');
            msgContainer.innerHTML = '';
            messages.forEach(msg => {
                const isMe = msg.senderId === CURRENT_USER.id;
                const reactionsCount = msg.reactions ? msg.reactions.length : 0;
                const hasReacted = msg.reactions && msg.reactions.includes(CURRENT_USER.id);
                
                const div = document.createElement('div');
                div.className = `d-flex mb-3 ${isMe ? 'justify-content-end' : 'justify-content-start'}`;
                
                // アイコンHTML
                const iconHtml = !isMe ? `<div class="me-2" style="font-size:24px;">${msg.senderIcon}</div>` : '';
                
                // 画像ギャラリーHTML
                let imagesHtml = '';
                if(msg.images && msg.images.length > 0) {
                    imagesHtml = `<div class="d-flex flex-wrap gap-1 mt-1">`;
                    msg.images.forEach(img => {
                        imagesHtml += `<img src="${img}" class="img-fluid rounded" style="width: 100px; height: 100px; object-fit: cover;" onclick="openFullscreenImage('${img}')">`;
                    });
                    imagesHtml += `</div>`;
                }

                // テキストHTML
                let textHtml = '';
                if(msg.text) {
                    textHtml = `<div class="p-2 rounded ${isMe ? 'text-dark' : 'bg-white border text-dark'}" style="background-color: ${isMe ? 'var(--chat-me-bg)' : ''};">${msg.text}</div>`;
                }

                const editedLabel = msg.isEdited ? `<div class="small text-muted text-end" style="font-size:10px;">編集済</div>` : '';
                const reactionHtml = reactionsCount > 0 ? `<div class="reaction-badge text-danger"><i class="${hasReacted ? 'bi bi-heart-fill' : 'bi bi-heart'}"></i> ${reactionsCount}</div>` : '';

                div.innerHTML = `
                    ${iconHtml}
                    <div class="chat-bubble">
                        ${textHtml}
                        ${imagesHtml}
                        ${editedLabel}
                        ${reactionHtml}
                    </div>
                `;

                // 長押しでいいね
                let pressTimer;
                const bubble = div.querySelector('.chat-bubble');
                bubble.addEventListener('touchstart', () => {
                    pressTimer = setTimeout(() => { DB.toggleReaction(groupId, myId, targetId, msg.id, CURRENT_USER.id); }, 500);
                }, {passive:true});
                bubble.addEventListener('touchend', () => clearTimeout(pressTimer));

                // 自分のメッセージをタップで編集
                if (isMe && msg.text) {
                    bubble.onclick = () => {
                        const newText = prompt("メッセージを編集しますか？", msg.text);
                        if (newText !== null && newText.trim() !== "" && newText !== msg.text) {
                            DB.updateMessage(groupId, myId, targetId, msg.id, newText);
                        }
                    };
                }

                msgContainer.appendChild(div);
            });
            window.scrollTo(0, document.body.scrollHeight);
        });
        
        // 戻るボタンでリストへ（アプリは終了しない）
        document.getElementById('back-to-chat-list').onclick = () => {
             document.getElementById('chat-detail-container').classList.add('d-none');
             document.getElementById('chat-input-area').classList.add('d-none');
             document.getElementById('chat-container').classList.remove('d-none');
             if(unsubscribeChat) unsubscribeChat();
             currentChatTargetId = null;
        };
        
        document.getElementById('chat-send-btn').onclick = async () => {
            const input = document.getElementById('chat-message-input');
            const text = input.value;
            if(!text && chatImagesBase64.length === 0) return;
            
            await DB.sendMessage(groupId, myId, targetId, CURRENT_USER, text, chatImagesBase64);
            input.value = '';
            input.style.height = '38px'; // 高さリセット
            chatImagesBase64 = [];
            this.updateImagePreview('chat-image-preview', chatImagesBase64);
        };
    },
    
    // --- 受信箱 ---
    startInboxListener() {
        if(unsubscribeInbox) unsubscribeInbox();
        
        unsubscribeInbox = DB.subscribeApplications(CURRENT_USER.group, (apps) => {
            const listContainer = document.getElementById('inbox-list');
            listContainer.innerHTML = '';

            apps.forEach(app => {
                // リーダーは全て、メンバーは自分が作ったものか、リーダーの指示(type=instruction)を表示
                if(CURRENT_USER.role === 'member' && app.userId !== CURRENT_USER.id && app.type !== 'instruction') return;

                const div = document.createElement('div');
                div.className = 'card mb-2 p-2 border-start border-4 clickable';
                // 未承認なら左端の色を変える
                div.style.borderLeftColor = app.status === 'pending' ? '#ffc107' : (app.status === 'approved' ? '#198754' : '#dc3545');
                
                div.innerHTML = `
                    <div class="d-flex justify-content-between align-items-center">
                        <div>
                            <span class="badge bg-secondary mb-1">${app.type === 'instruction' ? '指示' : '申請'}</span>
                            <strong class="ms-1">${app.title}</strong>
                        </div>
                        <span class="badge ${CONFIG_SETTINGS.statusLabels[app.status]?.color || 'bg-secondary'}">${CONFIG_SETTINGS.statusLabels[app.status]?.label || app.status}</span>
                    </div>
                    <div class="small text-muted mt-1">${app.userName} - ${app.createdDateStr}</div>
                `;
                
                // タップで詳細モーダルを開く
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

        // 複数画像の表示
        const imgContainer = document.getElementById('detail-images');
        imgContainer.innerHTML = '';
        if(appData.images && appData.images.length > 0) {
            appData.images.forEach(img => {
                const el = document.createElement('img');
                el.src = img;
                el.className = 'image-preview-item';
                el.onclick = () => window.openFullscreenImage(img);
                imgContainer.appendChild(el);
            });
        }

        // リーダー用アクションの表示制御
        const leaderArea = document.getElementById('leader-judge-area');
        if (CURRENT_USER.role === 'leader' && appData.type !== 'instruction') {
            leaderArea.classList.remove('d-none');
            const commentInput = document.getElementById('judge-comment');
            commentInput.value = appData.resultComment || '';

            // 承認・却下ボタン
            document.getElementById('btn-approve').onclick = () => DB.updateStatus(appData.id, 'approved', commentInput.value, CURRENT_USER.id);
            document.getElementById('btn-reject').onclick = () => DB.updateStatus(appData.id, 'rejected', commentInput.value, CURRENT_USER.id);
            
            // 取り消しボタン（判定済みなら表示）
            const cancelBtn = document.getElementById('btn-cancel-judge');
            if(appData.status !== 'pending') {
                cancelBtn.classList.remove('d-none');
                cancelBtn.onclick = () => DB.updateStatus(appData.id, 'pending', '', CURRENT_USER.id);
            } else {
                cancelBtn.classList.add('d-none');
            }

            // 削除ボタン
            document.getElementById('btn-delete-app').onclick = async () => {
                if(confirm("この申請を削除しますか？")) {
                    await DB.deleteApplication(appData.id);
                    bootstrap.Modal.getInstance(document.getElementById('inboxDetailModal')).hide();
                }
            };
        } else {
            leaderArea.classList.add('d-none');
        }

        const modal = new bootstrap.Modal(document.getElementById('inboxDetailModal'));
        modal.show();
    },

    // --- 画像・フォーム関連 ---
    setupImageInputs() {
        const handleFiles = async (files, arrayRef, previewId) => {
            if (files.length + arrayRef.length > 4) { alert('画像は最大4枚までです'); return; }
            for (let i = 0; i < files.length; i++) {
                const base64 = await Utils.fileToBase64(files[i]);
                const comp = await Utils.compressImage(base64);
                arrayRef.push(comp);
            }
            this.updateImagePreview(previewId, arrayRef);
        };

        document.getElementById('chat-image-file').addEventListener('change', e => {
            handleFiles(e.target.files, chatImagesBase64, 'chat-image-preview');
        });

        document.getElementById('form-image-file').addEventListener('change', e => {
            handleFiles(e.target.files, formImagesBase64, 'form-image-preview');
        });

        document.getElementById('form-submit-btn').addEventListener('click', () => this.handleFormSubmit());
    },

    updateImagePreview(containerId, imageArray) {
        const container = document.getElementById(containerId);
        container.innerHTML = '';
        imageArray.forEach((img, index) => {
            const wrapper = document.createElement('div');
            wrapper.style.position = 'relative';
            wrapper.innerHTML = `
                <img src="${img}" class="image-preview-item">
                <button type="button" class="btn-close btn-close-white bg-dark position-absolute top-0 end-0 m-1" style="font-size: 10px;" aria-label="Close"></button>
            `;
            wrapper.querySelector('button').onclick = () => {
                imageArray.splice(index, 1);
                this.updateImagePreview(containerId, imageArray); // 再描画して削除を反映
            };
            container.appendChild(wrapper);
        });
    },

    setupTextareaAutoResize() {
        const tx = document.getElementById('chat-message-input');
        tx.setAttribute('style', 'height:38px; overflow-y:hidden; resize:none;');
        tx.addEventListener("input", function() {
            this.style.height = 'auto';
            const newHeight = Math.min(this.scrollHeight, 100); // 最大100pxまで
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
            this.updateImagePreview('form-image-preview', formImagesBase64);
            document.querySelector('.bottom-nav-item[href="#tab-inbox"]').click(); // 送信後は受信箱へ
        } catch(e) { console.error(e); alert('送信に失敗しました'); }
    },

    async setupNotifications() {
        try {
            const permission = await Notification.requestPermission();
            if (permission === 'granted') {
                const registration = await navigator.serviceWorker.register('sw.js');
                const token = await getToken(messaging, { 
                    vapidKey: "BMdNlbLwC3bEwAIp-ZG9Uwp-5n4HdyXvlsqJbt6Q5YRdCA7gUexx0G9MpjB3AdLk6iNJodLTobC3-bGG6YskB0s",
                    serviceWorkerRegistration: registration
                });
                if (token) await DB.saveUserToken(CURRENT_USER, token);
                
                onMessage(messaging, (payload) => { console.log('Message:', payload); });
            }
        } catch (error) { console.error('Notification setup failed:', error); }
    }
};

window.app = App;
window.onload = () => App.init();

