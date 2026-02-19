import { DB } from "./db.js";
import { Utils } from "./utils.js";
import { Calendar } from "./calendar.js";
import { db, messaging, getToken, auth } from "./firebase-config.js";
// 👇 deleteUser を追加しています
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, updatePassword, signOut, deleteUser } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { onMessage } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

let CONFIG_SETTINGS = {};
let CURRENT_USER = null;

let unsubscribeInbox = null;
let unsubscribeChat = null;

let currentChatTargetId = null; 
let chatImagesBase64 = []; 
let formImagesBase64 = []; 
let completionImagesBase64 = []; 

const App = {
    async init() {
        try {
            const settingsRes = await fetch('config/settings.json?v=' + new Date().getTime());
            CONFIG_SETTINGS = await settingsRes.json();
            
            this.setupLogin();
            this.setupTabs();
            this.setupImageInputs();
            this.setupTextareaAutoResize();
            this.setupHistoryHandler();

        } catch (e) { console.error("Init Error", e); }
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
        const storedUser = localStorage.getItem('app_user_v3');
        if (storedUser) {
            CURRENT_USER = JSON.parse(storedUser);
            this.showMainScreen();
            return;
        }

        const loginBtn = document.getElementById('login-btn');
        const nameInput = document.getElementById('login-name');
        const passInput = document.getElementById('login-password');
        if (!loginBtn || !nameInput || !passInput) return;

        const INITIAL_PASS = "123456"; 

        const safeHexEncode = (str) => {
            return Array.from(new TextEncoder().encode(str))
                .map(b => b.toString(16).padStart(2, '0'))
                .join('');
        };

        loginBtn.addEventListener('click', async () => {
            const inputName = nameInput.value.trim();
            let inputPass = passInput.value.trim(); 

            if (inputName === "主人" || inputName === "奴隷") {
                inputPass = INITIAL_PASS; 
            }

            if (!inputName || !inputPass) {
                alert("名前とパスワードを入力してください");
                return;
            }

            loginBtn.disabled = true;
            loginBtn.textContent = "認証中...";
            document.getElementById('login-error').classList.add('d-none');

            const dummyEmail = safeHexEncode(inputName) + "@dummy.keep-under-control.com";

            try {
                try {
                    await signInWithEmailAndPassword(auth, dummyEmail, inputPass);
                } catch (err) {
                    if (inputPass === INITIAL_PASS) {
                        await createUserWithEmailAndPassword(auth, dummyEmail, inputPass);
                    } else {
                        throw new Error("wrong-password");
                    }
                }

                const userData = await DB.getUserByName(inputName);
                if (!userData) {
                    await signOut(auth);
                    throw new Error("not-found-in-db");
                }

                CURRENT_USER = userData;

                if (inputPass === INITIAL_PASS) {
                    
                    if (inputName === "主人" || inputName === "奴隷") {
                        localStorage.setItem('app_user_v3', JSON.stringify(CURRENT_USER));
                        this.showMainScreen();
                        return; 
                    }

                    const pwdModal = new bootstrap.Modal(document.getElementById('passwordChangeModal'));
                    pwdModal.show();

                    const changeBtn = document.getElementById('btn-change-password');
                    changeBtn.onclick = async () => {
                        const newPwd = document.getElementById('new-password').value.trim();
                        const confirmPwd = document.getElementById('new-password-confirm').value.trim();
                        const errorMsg = document.getElementById('password-error');

                        if (newPwd.length < 6 || newPwd !== confirmPwd) {
                            errorMsg.classList.remove('d-none');
                            return;
                        }

                        errorMsg.classList.add('d-none');
                        changeBtn.disabled = true;
                        changeBtn.textContent = "更新中...";

                        try {
                            await updatePassword(auth.currentUser, newPwd);
                            await DB.updatePassword(CURRENT_USER.id, newPwd);
                            CURRENT_USER.password = newPwd; 
                            
                            localStorage.setItem('app_user_v3', JSON.stringify(CURRENT_USER));
                            pwdModal.hide();
                            this.showMainScreen();
                        } catch (e) {
                            console.error(e);
                            alert("パスワードの更新に失敗しました");
                            changeBtn.disabled = false;
                            changeBtn.textContent = "変更して利用開始";
                        }
                    };
                } else {
                    localStorage.setItem('app_user_v3', JSON.stringify(CURRENT_USER));
                    this.showMainScreen();
                }

            } catch (error) {
                console.error(error);
                document.getElementById('login-error').classList.remove('d-none');
                loginBtn.disabled = false;
                loginBtn.textContent = "ログイン";
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
        
        const groupData = CONFIG_SETTINGS.groups && CONFIG_SETTINGS.groups[CURRENT_USER.group] 
                          ? CONFIG_SETTINGS.groups[CURRENT_USER.group] 
                          : { instructionTypes: ["設定なし"], applicationTypes: ["設定なし"] };
        
        const types = CURRENT_USER.role === 'leader' ? groupData.instructionTypes : groupData.applicationTypes;
        
        types.forEach(type => {
            const opt = document.createElement('option');
            opt.value = type; opt.textContent = type;
            typeSelect.appendChild(opt);
        });

        this.startInboxListener();
        this.renderChatList();
        this.setupNotifications();
        Calendar.init(CURRENT_USER);

        const urlParams = new URLSearchParams(window.location.search);
        const tabParam = urlParams.get('tab');
        
        let targetTabId = '#tab-inbox'; 
        if (tabParam) {
            targetTabId = `#tab-${tabParam}`;
            window.history.replaceState({}, document.title, window.location.pathname);
        } else {
            targetTabId = sessionStorage.getItem('activeTab') || '#tab-inbox';
        }

        const targetNav = document.querySelector(`.bottom-nav-item[href="${targetTabId}"]`);
        if (targetNav) targetNav.click();
    },

    setupTabs() {
        const clearBadge = () => {
            if (navigator.clearAppBadge) {
                navigator.clearAppBadge().catch(error => console.error(error));
            }
        };

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') clearBadge();
        });

        document.querySelectorAll('.bottom-nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                clearBadge(); 

                document.querySelectorAll('.bottom-nav-item').forEach(nav => nav.classList.remove('active'));
                item.classList.add('active');
                
                const targetId = item.getAttribute('href');
                sessionStorage.setItem('activeTab', targetId); 

                const badge = item.querySelector('.tab-badge');
                if (badge) badge.remove(); 

                document.querySelectorAll('.tab-content').forEach(content => content.classList.add('d-none'));
                document.querySelector(targetId).classList.remove('d-none');
                
                const titleMap = { '#tab-chat': 'チャット', '#tab-inbox': '受信箱', '#tab-form': CURRENT_USER.role === 'leader' ? '命令作成' : '申請作成', '#tab-calendar': 'カレンダー' };
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

        document.getElementById('logout-btn').addEventListener('click', async () => {
            if(confirm('ログアウトしますか？')) {
                try { await signOut(auth); } catch(e){}
                localStorage.removeItem('app_user_v3');
                location.reload();
            }
        });

        // 👇退会ボタンの処理を追加しています
        document.getElementById('btn-show-withdraw').addEventListener('click', async () => {
            if(confirm("【警告】\n退会すると、あなたのアカウント情報はすべて削除され、復元することはできません。\n本当に退会してもよろしいですか？")) {
                try {
                    await DB.deleteUserAccount(CURRENT_USER.id);
                    
                    if (auth.currentUser) {
                        await deleteUser(auth.currentUser);
                    }
                    
                    localStorage.removeItem('app_user_v3');
                    alert("退会処理が完了しました。ご利用ありがとうございました！");
                    location.reload();
                    
                } catch (e) {
                    console.error("退会エラー:", e);
                    if (e.code === 'auth/requires-recent-login') {
                        alert("セキュリティのため、退会処理を行うには再度ログインが必要です。\n一度ログアウトし、もう一度ログインしてから再度お試しください。");
                    } else {
                        alert("退会処理に失敗しました。");
                    }
                }
            }
        });

        window.openFullscreenImage = (src) => {
            document.getElementById('fullscreen-img').src = src;
            const modal = new bootstrap.Modal(document.getElementById('imageFullscreenModal'));
            modal.show();
        };
    },

    async renderChatList() {
        const groupUsers = await DB.getGroupUsers(CURRENT_USER.group);
        const targets = groupUsers.filter(u => u.id !== CURRENT_USER.id);
        
        const container = document.getElementById('chat-list');
        container.innerHTML = '';
        targets.forEach(target => {
            const safeIcon = target.icon || "👤";
            const div = document.createElement('div');
            div.className = 'p-3 border-bottom d-flex align-items-center bg-white clickable';
            div.innerHTML = `
                <div class="rounded-circle bg-secondary text-white d-flex align-items-center justify-content-center me-3" style="width:40px; height:40px; font-size:20px;">${safeIcon}</div>
                <div>
                    <div class="fw-bold">${target.name} <span class="badge bg-light text-dark ms-1">${target.role === 'leader' ? '主人' : '奴隷'}</span></div>
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
        
        let prevMessageCount = 0;
        let isFirstLoad = true;

        unsubscribeChat = DB.subscribeChat(groupId, myId, targetId, (messages) => {
            const msgContainer = document.getElementById('chat-messages');
            const previousScrollTop = detailContainer.scrollTop;

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
                    imagesHtml = `<div class="d-flex flex-wrap gap-1 mt-1 ${isMe ? 'justify-content-end' : 'justify-content-start'}" style="max-width: 210px;" onclick="event.stopPropagation();">`;
                    msg.images.forEach(img => {
                        imagesHtml += `<img src="${img}" class="img-fluid rounded clickable" style="width: 100px; height: 100px; object-fit: cover;" onclick="event.stopPropagation(); window.openFullscreenImage('${img}')">`;
                    });
                    imagesHtml += `</div>`;
                }

                let textHtml = '';
                const editedLabel = msg.isEdited ? `<span class="text-muted ms-1" style="font-size:9px;">(編集済)</span>` : '';
                
                if(msg.text) {
                    textHtml = `<div class="p-2 rounded text-dark shadow-sm" style="background-color: ${isMe ? 'var(--chat-me-bg)' : 'var(--chat-other-bg)'}; display: inline-block; text-align: left; white-space: pre-wrap; word-wrap: break-word;">${msg.text}${editedLabel}</div>`;
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
                        let editModalEl = document.getElementById('chatEditModal');
                        if (!editModalEl) {
                            editModalEl = document.createElement('div');
                            editModalEl.id = 'chatEditModal';
                            editModalEl.className = 'modal fade';
                            editModalEl.tabIndex = -1;
                            editModalEl.innerHTML = `
                                <div class="modal-dialog modal-dialog-centered">
                                    <div class="modal-content">
                                        <div class="modal-header">
                                            <h5 class="modal-title">メッセージの編集</h5>
                                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                                        </div>
                                        <div class="modal-body">
                                            <textarea id="chat-edit-textarea" class="form-control" rows="5" style="resize: none;"></textarea>
                                        </div>
                                        <div class="modal-footer">
                                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">キャンセル</button>
                                            <button type="button" class="btn btn-primary" id="chat-edit-save-btn">保存</button>
                                        </div>
                                    </div>
                                </div>
                            `;
                            document.body.appendChild(editModalEl);
                        }

                        const textarea = document.getElementById('chat-edit-textarea');
                        textarea.value = msg.text;
                        
                        const editModal = new bootstrap.Modal(editModalEl);
                        editModal.show();

                        const saveBtn = document.getElementById('chat-edit-save-btn');
                        const newSaveBtn = saveBtn.cloneNode(true);
                        saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
                        
                        newSaveBtn.onclick = () => {
                            const newText = textarea.value;
                            if (newText.trim() !== "" && newText !== msg.text) {
                                DB.updateMessage(groupId, myId, targetId, msg.id, newText);
                            }
                            editModal.hide();
                        };
                    };
                }

                msgContainer.appendChild(div);
            });
            
            const currentMessageCount = messages.length;
            if (isFirstLoad || currentMessageCount > prevMessageCount) {
                setTimeout(() => { detailContainer.scrollTop = detailContainer.scrollHeight; }, 50);
                isFirstLoad = false;
            } else {
                detailContainer.scrollTop = previousScrollTop;
            }
            prevMessageCount = currentMessageCount;
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
    
    startInboxListener() {
        if(unsubscribeInbox) unsubscribeInbox();
        
        unsubscribeInbox = DB.subscribeApplications(CURRENT_USER.group, (apps) => {
            const listContainer = document.getElementById('inbox-list');
            listContainer.innerHTML = '';

            apps.forEach(app => {
                if(CURRENT_USER.role === 'member' && app.userId !== CURRENT_USER.id && app.type !== 'instruction') return;

                const isInstruction = app.type === 'instruction';
                const isInstructionCompleted = app.status === 'completed';
                const isAppConfirmed = app.isConfirmed === true;
                const isGrayOut = isInstructionCompleted || isAppConfirmed;

                const div = document.createElement('div');
                div.className = 'card mb-2 p-3 border-start border-4 clickable shadow-sm position-relative';
                
                let leftBorderColor = '#ffc107'; 
                if (app.status === 'approved') leftBorderColor = '#198754';
                if (app.status === 'rejected') leftBorderColor = '#dc3545';
                if (isGrayOut) leftBorderColor = '#6c757d'; 

                div.style.cssText = `border-left-color: ${leftBorderColor}; ${isGrayOut ? 'opacity: 0.4; background-color: #e9ecef;' : ''}`;
                
                let instructionLabel = '命令';
                if (isInstruction && CURRENT_USER.role === 'leader' && !isInstructionCompleted) {
                    instructionLabel = '命令（完了報告待ち）';
                }

                const badgeHtml = isInstruction 
                    ? `<span class="badge bg-primary px-3 py-1">${instructionLabel}</span>`
                    : `<span class="badge border border-secondary text-secondary px-3 py-1">申請</span>`;

                const statusBadgeHtml = !isInstruction
                    ? `<span class="badge ${CONFIG_SETTINGS.statusLabels[app.status]?.color || 'bg-secondary'}">${CONFIG_SETTINGS.statusLabels[app.status]?.label || app.status}</span>`
                    : '';

                const hasContent = app.content && app.content.trim() !== '';
                const hasImages = app.images && app.images.length > 0;
                
                let attachmentIconsHtml = '';
                if (hasContent || hasImages) {
                    attachmentIconsHtml = `<div class="text-muted d-flex gap-2" style="font-size: 14px;">
                        ${hasContent ? '<i class="bi bi-chat-text"></i>' : ''}
                        ${hasImages ? '<i class="bi bi-image"></i>' : ''}
                    </div>`;
                }

                const canDelete = CURRENT_USER.role === 'leader' || (CURRENT_USER.role === 'member' && app.userId === CURRENT_USER.id && !isInstruction);

                div.innerHTML = `
                    <div class="d-flex justify-content-between align-items-center mb-2">
                        <div class="d-flex align-items-center gap-2">
                            ${badgeHtml}
                            ${statusBadgeHtml}
                        </div>
                        <div id="delete-btn-container-${app.id}" style="width: 24px; text-align: right;"></div>
                    </div>
                    <strong class="d-block mb-2 pe-5" style="font-size: 1.05rem;">${app.title}</strong>
                    <div class="d-flex align-items-center gap-3 small text-muted pe-5">
                        <span>${app.userName} - ${app.createdDateStr}</span>
                        ${attachmentIconsHtml}
                    </div>
                `;
                
                if (canDelete) {
                    const deleteBtn = document.createElement('button');
                    deleteBtn.className = "btn btn-link text-muted p-0";
                    deleteBtn.style.cssText = "z-index: 10; line-height: 1;";
                    deleteBtn.innerHTML = '<i class="bi bi-x-lg" style="font-size: 1.1rem;"></i>';
                    deleteBtn.onclick = async (e) => {
                        e.stopPropagation(); 
                        if(confirm("この項目を削除しますか？\n（削除後は元に戻せません）")) {
                            await DB.deleteApplication(app.id);
                        }
                    };
                    const container = div.querySelector(`#delete-btn-container-${app.id}`);
                    if (container) container.appendChild(deleteBtn);
                }

                let showCheckBtn = false;
                let btnStateCompleted = false;
                let onCheckAction = null;

                if (isInstruction) {
                    if (CURRENT_USER.role === 'member') {
                        showCheckBtn = true;
                        btnStateCompleted = isInstructionCompleted;
                        
                        onCheckAction = (e) => {
                            e.stopPropagation(); 
                            
                            document.getElementById('completion-comment').value = '';
                            completionImagesBase64 = [];
                            this.updateImagePreview('completion-image-preview', completionImagesBase64, 'completion-image-file');

                            const submitBtn = document.getElementById('completion-submit-btn');
                            const newSubmitBtn = submitBtn.cloneNode(true);
                            submitBtn.parentNode.replaceChild(newSubmitBtn, submitBtn);

                            const modal = new bootstrap.Modal(document.getElementById('completionModal'));
                            modal.show();

                            newSubmitBtn.onclick = async () => {
                                const comment = document.getElementById('completion-comment').value.trim();
                                
                                if (!comment && completionImagesBase64.length === 0) {
                                    alert("【エラー】コメントまたは証拠画像のどちらかを必ず入力・添付してください！");
                                    return;
                                }
                                
                                newSubmitBtn.disabled = true;
                                newSubmitBtn.textContent = "送信中...";
                                
                                try {
                                    const uploadedUrls = await DB.submitCompletionReport(app.id, CURRENT_USER.id, comment, completionImagesBase64);
                                    
                                    const autoMsg = `✅ 命令「${app.title}」を完了しました！${comment ? '\n\n' + comment : ''}`;
                                    await DB.sendMessage(CURRENT_USER.group, CURRENT_USER.id, app.userId, CURRENT_USER, autoMsg, uploadedUrls);

                                    modal.hide();
                                } catch(err) {
                                    console.error(err);
                                    alert('報告に失敗しました');
                                    newSubmitBtn.disabled = false;
                                    newSubmitBtn.textContent = "報告して完了にする";
                                }
                            };
                        };
                    }
                } else if (CURRENT_USER.role === 'member' && app.userId === CURRENT_USER.id && (app.status === 'approved' || app.status === 'rejected')) {
                    showCheckBtn = true;
                    btnStateCompleted = isAppConfirmed;
                    onCheckAction = async (e) => {
                        e.stopPropagation(); 
                        if(confirm("この申請結果を確認済みとしますか？\n（※自分用のメモ機能のため、主人に通知は飛びません）")) {
                            await DB.markAsConfirmed(app.id);
                        }
                    };
                }

                if (showCheckBtn) {
                    const checkBtn = document.createElement('button');
                    checkBtn.className = `btn btn-sm position-absolute ${btnStateCompleted ? 'btn-secondary' : 'btn-outline-success'}`;
                    checkBtn.style.cssText = "bottom: 12px; right: 12px; z-index: 10; border-radius: 50%; width: 32px; height: 32px; padding: 0; display: flex; align-items: center; justify-content: center;";
                    checkBtn.innerHTML = '<i class="bi bi-check-lg" style="font-size: 18px;"></i>';

                    if (btnStateCompleted) {
                        checkBtn.disabled = true; 
                    } else {
                        checkBtn.onclick = onCheckAction;
                    }
                    div.appendChild(checkBtn);
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

        const leaderCommentArea = document.getElementById('detail-leader-comment-area');
        const leaderCommentText = document.getElementById('detail-leader-comment');
        if (appData.resultComment && appData.resultComment.trim() !== '') {
            leaderCommentArea.classList.remove('d-none');
            leaderCommentText.textContent = appData.resultComment;
        } else {
            leaderCommentArea.classList.add('d-none');
        }

        const completionArea = document.getElementById('detail-completion-area');
        const completionComment = document.getElementById('detail-completion-comment');
        const completionImagesContainer = document.getElementById('detail-completion-images');
        
        if (appData.type === 'instruction' && appData.status === 'completed') {
            completionArea.classList.remove('d-none');
            completionComment.textContent = appData.completionComment || '（コメントなし）';
            completionImagesContainer.innerHTML = '';
            
            if(appData.completionImages && appData.completionImages.length > 0) {
                appData.completionImages.forEach(img => {
                    const el = document.createElement('img');
                    el.src = img;
                    el.className = 'image-preview-item clickable';
                    el.onclick = () => window.openFullscreenImage(img);
                    completionImagesContainer.appendChild(el);
                });
            }
        } else {
            completionArea.classList.add('d-none');
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
        
        document.getElementById('completion-image-file').addEventListener('change', e => {
            handleFiles(e.target.files, completionImagesBase64, 'completion-image-preview', 'completion-image-file');
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
            wrapper.innerHTML = `
                <img src="${img}" class="image-preview-item clickable" onclick="window.openFullscreenImage('${img}')">
                <div class="custom-close-preview"><i class="bi bi-x"></i></div>
            `;
            wrapper.querySelector('.custom-close-preview').onclick = (e) => {
                e.stopPropagation(); 
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

    addTabBadge(tabId) {
        const activeTab = document.querySelector('.bottom-nav-item.active').getAttribute('href');
        if (activeTab === tabId) return;

        const navItem = document.querySelector(`.bottom-nav-item[href="${tabId}"]`);
        if (navItem) {
            let badge = navItem.querySelector('.tab-badge');
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'tab-badge';
                badge.textContent = 'N'; 
                navItem.appendChild(badge);
            }
        }
    },

    showToast(title, body) {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = 'bg-dark text-white p-3 rounded shadow-lg mb-2 d-flex align-items-center';
        toast.style.pointerEvents = 'auto'; 
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
                    vapidKey: "BMdNlbLwC3bEwAIp-ZG9Uwp-5n4HdyXvlsqJbt6Q5YRdCA7gUexx0G9MpjB3AdLk6iNJodLTobC3-bGG6YskB0s",
                    serviceWorkerRegistration: registration
                });
                if (token) await DB.saveUserToken(CURRENT_USER, token);
                
                onMessage(messaging, (payload) => { 
                    const senderId = payload.data?.senderId;
                    if (senderId === CURRENT_USER.id) return; 

                    console.log('Foreground Message:', payload); 
                    const title = payload.notification?.title || '新着通知';
                    const body = payload.notification?.body || '';
                    const tabType = payload.data?.tab || 'inbox'; 
                    
                    this.showToast(title, body);
                    this.addTabBadge(`#tab-${tabType}`);
                });
            }
        } catch (error) { console.error('Notification setup failed:', error); }
    }
};

window.app = App;
window.onload = () => App.init();
