// js/app.js
import { DB } from "./db.js";

// 設定保持用
let CONFIG_USERS = [];
let CONFIG_SETTINGS = {};
let CURRENT_USER = null;

// リスナー解除用関数（画面遷移時に古い監視を止めるため）
let unsubscribeInbox = null;
let unsubscribeChat = null;

// リーダーが現在チャット中の相手ID
let currentChatTargetId = null; 

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
        this.startInboxListener(); // ログインしたらすぐ受信箱を同期開始
        
        // メンバーなら、チャット相手は自動的に「自グループのリーダー」に固定
        if (user.role === 'member') {
            // リーダーを探す（簡易ロジック：同グループの最初のリーダー）
            const leader = CONFIG_USERS.find(u => u.group === user.group && u.role === 'leader');
            if (leader) currentChatTargetId = user.id; // メンバー視点ではIDは自分自身のものを使う(db.jsのロジックに合わせる)
            this.startChatListener();
        }
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
            
            // リーダーの場合、チャットタブは初期状態では「メンバーリスト」を表示する
            this.renderLeaderChatList();
        } else {
            navChat.textContent = "報告";
            navForm.textContent = "申請";
            titleLabel.textContent = "リーダーへ申請";
            CONFIG_SETTINGS.applicationTypes.forEach(t => typeSelect.add(new Option(t, t)));
        }
        
        // フォーム送信ボタンのイベント設定
        document.getElementById('submit-form-btn').onclick = () => this.submitForm();
        // チャット送信ボタンのイベント設定
        document.getElementById('send-chat-btn').onclick = () => this.sendChatMessage();
    },

    // --- 受信箱機能 (Inbox) ---
    startInboxListener() {
        if (unsubscribeInbox) unsubscribeInbox(); // 既存の監視があれば解除
        
        const listEl = document.getElementById('inbox-list');
        listEl.innerHTML = '<div class="text-center mt-5"><div class="spinner-border text-success"></div></div>';

        unsubscribeInbox = DB.subscribeInbox(CURRENT_USER, (items) => {
            listEl.innerHTML = '';
            if (items.length === 0) {
                listEl.innerHTML = '<div class="text-center text-muted mt-5 p-3">現在、対応が必要な項目はありません<br>☕</div>';
                return;
            }

            items.forEach(item => {
                // ステータス情報の取得
                const stInfo = CONFIG_SETTINGS.statusLabels[item.status] || { label: item.status, color: 'bg-secondary' };
                
                const div = document.createElement('a');
                div.className = "list-group-item list-group-item-action p-3 border-0 border-bottom";
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
                    <p class="mb-2 text-secondary small bg-light p-2 rounded">${item.body}</p>
                    
                    ${this.createActionButtons(item)}
                `;
                listEl.appendChild(div);
            });
        });
    },

    createActionButtons(item) {
        // 自分がリーダーで、かつステータスがpendingなら承認ボタンを出す
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

    // --- チャット機能 (Chat) ---
    renderLeaderChatList() {
        // リーダー用：チャットタブにメンバー一覧を表示する
        const container = document.getElementById('chat-container');
        container.innerHTML = `<h6 class="px-2 py-3 text-muted border-bottom">メンバーを選択して連絡</h6>`;
        
        const myMembers = CONFIG_USERS.filter(u => u.group === CURRENT_USER.group && u.role === 'member');
        
        myMembers.forEach(m => {
            const row = document.createElement('div');
            row.className = "d-flex align-items-center p-3 border-bottom bg-white clickable";
            row.onclick = () => {
                currentChatTargetId = m.id; // このメンバーとのチャットを開始
                this.startChatListener();
                // 一覧を隠してチャット画面モードにするUI制御が必要だが、
                // 簡易的にここではコンテナをクリアしてチャット開始する
                this.renderChatHeader(m.name);
            };
            row.innerHTML = `
                <div class="user-icon">${m.icon || '👤'}</div>
                <div class="fw-bold">${m.name}</div>
                <div class="ms-auto text-muted small"><i class="bi bi-chevron-right"></i></div>
            `;
            container.appendChild(row);
        });
        
        // 入力欄を隠す（メンバー選択前なので）
        document.getElementById('chat-input-area').classList.add('d-none');
    },

    renderChatHeader(targetName) {
        // チャット相手の名前を一時的に表示するUIがあると良いが今回は簡易実装
        // 「戻る」ボタンなどが欲しくなるフェーズ
        document.getElementById('header-title').textContent = `${targetName}と連絡`;
        document.getElementById('chat-input-area').classList.remove('d-none');
    },

    startChatListener() {
        if (unsubscribeChat) unsubscribeChat();
        
        // 監視するチャットIDの決定
        // メンバーなら「自分自身(currentChatTargetIdは自分のIDになる)」
        // リーダーなら「選択したメンバーID」
        const targetMemberId = CURRENT_USER.role === 'member' ? CURRENT_USER.id : currentChatTargetId;
        
        if (!targetMemberId) return;

        const container = document.getElementById('chat-container');
        // チャット開始時にコンテナをクリア（リーダーが切り替えた時用）
        container.innerHTML = '<div class="p-3 text-center text-muted small">ここでの会話は他言無用です...🤫</div>';

        unsubscribeChat = DB.subscribeChat(CURRENT_USER.group, targetMemberId, (messages) => {
            // 全書き換えではなく差分追加が理想だが、実装コスト削減のため全書き換え
            // 実際はスクロール位置保持などが必要
            container.innerHTML = ''; 
            
            messages.forEach(msg => {
                const isMe = msg.senderId === CURRENT_USER.id;
                const row = document.createElement('div');
                row.className = isMe ? "chat-row-me mb-2" : "chat-row-other mb-2";
                
                let content = msg.text;
                if (msg.image) {
                    content = `<img src="${msg.image}" class="img-fluid rounded mb-1" style="max-width:200px"><br>${content || ''}`;
                }

                row.innerHTML = `
                    ${!isMe ? `<div class="user-icon small" style="width:28px;height:28px">${msg.senderIcon}</div>` : ''}
                    <div class="${isMe ? 'chat-bubble-me' : 'chat-bubble-other'} chat-bubble">
                        ${content}
                        <div class="text-end text-muted mt-1" style="font-size:0.6rem; opacity:0.7">
                            ${msg.createdAt ? new Date(msg.createdAt.toDate()).getHours() + ':' + String(new Date(msg.createdAt.toDate()).getMinutes()).padStart(2,'0') : '...'}
                        </div>
                    </div>
                `;
                container.appendChild(row);
            });
            
            // 最下部へスクロール
            window.scrollTo(0, document.body.scrollHeight);
        });
    },

    async sendChatMessage() {
        const input = document.getElementById('chat-input-text');
        const text = input.value.trim();
        if (!text) return; // 画像送信ロジックは別途必要だがまずはテキストのみ
        
        const targetMemberId = CURRENT_USER.role === 'member' ? CURRENT_USER.id : currentChatTargetId;
        
        try {
            await DB.sendMessage(CURRENT_USER.group, targetMemberId, CURRENT_USER, text);
            input.value = '';
        } catch (e) {
            console.error(e);
            alert('送信失敗');
        }
    },

    // --- 申請・指示フォーム送信 ---
    async submitForm() {
        const type = document.getElementById('form-type').value;
        const body = document.getElementById('form-body').value;
        
        if (!body) { alert('内容を入力してください'); return; }
        
        // 宛先の決定
        let targetId = null;
        let targetName = '';
        let category = '';

        if (CURRENT_USER.role === 'leader') {
            // リーダー→メンバー（指示）
            // ※本来は「誰に？」の選択プルダウンが必要。
            // Phase 2では簡易的に「グループのメンバー全員への指示」あるいは「チャット中の相手」とするか要検討だが、
            // UI上選択肢がないので、一旦「未指定（周知事項）」として保存するか、
            // 「settings.json」にターゲット選択機能を追加する必要がある。
            // ★暫定対応：promptでメンバーIDを入力させる（開発用）
            const targetNameInput = prompt("宛先のメンバー名を入力してください（完全一致）");
            const targetUser = CONFIG_USERS.find(u => u.name === targetNameInput && u.group === CURRENT_USER.group);
            if (!targetUser) { alert('該当するメンバーがいません'); return; }
            targetId = targetUser.id;
            targetName = targetUser.name;
            category = 'instruction';
        } else {
            // メンバー→リーダー（申請）
            const leader = CONFIG_USERS.find(u => u.group === CURRENT_USER.group && u.role === 'leader');
            targetId = leader.id;
            targetName = leader.name;
            category = 'application';
        }

        try {
            await DB.submitForm({
                category,
                type,
                body,
                applicantId: CURRENT_USER.id,
                applicantName: CURRENT_USER.name,
                targetId: targetId,
                targetName: targetName,
                groupId: CURRENT_USER.group
            });
            alert('送信しました');
            document.getElementById('form-body').value = '';
            // 受信箱タブへ移動
            document.querySelector('[data-target="#tab-inbox"]').click();
        } catch(e) { console.error(e); alert('エラー発生'); }
    },
    
    // --- 共通 ---
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
                
                // タイトル変更
                const labelChat = document.getElementById('nav-label-chat').textContent;
                const labelForm = document.getElementById('nav-label-form').textContent;
                const titleMap = { '#tab-inbox': '受信箱', '#tab-chat': labelChat, '#tab-form': labelForm, '#tab-calendar': '予定' };
                document.getElementById('header-title').textContent = titleMap[targetId];

                // チャットタブから抜けた場合、リーダーならメンバーリストに戻すリセット処理などが必要ならここ
                if (targetId === '#tab-chat' && CURRENT_USER.role === 'leader' && !currentChatTargetId) {
                    this.renderLeaderChatList();
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

// グローバル公開（HTML内のonclick属性から呼ぶため）
window.app = App;
window.onload = () => App.init();
