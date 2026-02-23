import { DB } from "./db.js";
import { Utils } from "./utils.js";
import { Calendar } from "./calendar.js";
import { db, messaging, getToken, auth } from "./firebase-config.js";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, updatePassword, signOut, deleteUser, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
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

const TEST_ACCOUNT_NAMES = ["リーダー", "メンバー", "领导者", "成员", "leader", "member"];

// 👇 悪意のあるプログラム（タグ）を無害な文字に変換（消毒）するセキュリティ機能
const escapeHTML = (str) => {
    if (typeof str !== 'string') return str;
    return str.replace(/[&<>'"]/g, 
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
};

const TRANSLATIONS = {
    "login_title": { ja: "利用開始", en: "Start Using", zh: "开始使用" },
    "login_notice": {
        ja: `<strong>【重要なお知らせ】</strong><br>システムの大規模なセキュリティ改修を行いました。<br>お手数ですが、初回ログイン時に<strong>自分専用のパスワード（6文字以上）</strong>の設定をお願いいたします。<br><span class="text-danger">※初期パスワードは「123456」です。<br>※テストアカウント「リーダー」「メンバー」等はPWなしでログイン可能です。</span>`,
        en: `<strong>[Important Notice]</strong><br>We have implemented major security upgrades.<br>Please set your <strong>personal password (6+ characters)</strong> upon your first login.<br><span class="text-danger">* Default password is '123456'.<br>* Test accounts "leader" "member" can login without a password.</span>`,
        zh: `<strong>【重要通知】</strong><br>系统进行了大规模的安全升级。<br>首次登录时，请设置<strong>专属密码（6位以上）</strong>。<br><span class="text-danger">※初始密码为“123456”。<br>※“领导者”和“成员”等测试账号无需密码即可登录。</span>`
    },
    "login_account_creation": {
        ja: `<strong>【個人用アカウント作成について】</strong><br>個人用アカウントの作成を希望される方は、<a href="https://x.com/FvFA4yNQfW15814" target="_blank" rel="noopener noreferrer" class="text-decoration-none fw-bold">@FvFA4yNQfW15814</a> までDMにてお問い合わせください。`,
        en: `<strong>[Regarding Personal Account Creation]</strong><br>If you wish to create a personal account, please contact <a href="https://x.com/FvFA4yNQfW15814" target="_blank" rel="noopener noreferrer" class="text-decoration-none fw-bold">@FvFA4yNQfW15814</a> via DM.`,
        zh: `<strong>【关于个人账户创建】</strong><br>如果希望创建个人账户，请通过私信联系 <a href="https://x.com/FvFA4yNQfW15814" target="_blank" rel="noopener noreferrer" class="text-decoration-none fw-bold">@FvFA4yNQfW15814</a>。`
    },
    "login_name_placeholder": { ja: "名前 (例: 田中)", en: "Name (e.g., John)", zh: "姓名 (例: 王)" },
    "login_pass_placeholder": { ja: "パスワード", en: "Password", zh: "密码" },
    "login_button": { ja: "ログイン", en: "Login", zh: "登录" },
    "login_authenticating": { ja: "認証中...", en: "Authenticating...", zh: "验证中..." },
    "login_error": { ja: "名前またはパスワードが間違っています", en: "Invalid name or password.", zh: "姓名或密码错误。" },
    
    "nav_chat": { ja: "チャット", en: "Chat", zh: "聊天" },
    "nav_inbox": { ja: "受信箱", en: "Inbox", zh: "收件箱" },
    "nav_form_leader": { ja: "命令作成", en: "Create Instruction", zh: "发布指令" },
    "nav_form_member": { ja: "申請作成", en: "Create Request", zh: "创建申请" },
    "nav_calendar": { ja: "カレンダー", en: "Calendar", zh: "日历" },
    "menu_logout": { ja: "ログアウト", en: "Logout", zh: "退出登录" },
    "menu_withdraw": { ja: "退会する", en: "Delete Account", zh: "注销账户" },

    "form_target_label": { ja: "宛先", en: "To", zh: "收件人" },
    "target_all": { ja: "全員 (指定なし)", en: "All", zh: "所有人" },
    "form_type_suffix": { ja: "の種類", en: " Type", zh: "类型" },
    "form_content": { ja: "内容", en: "Content", zh: "内容" },
    "form_optional": { ja: "(任意)", en: "(Optional)", zh: "(选填)" },
    "form_image": { ja: "画像添付", en: "Attach Images", zh: "附加图片" },
    "form_image_limit": { ja: "(最大4枚)", en: " (Max 4)", zh: " (最多4张)" },
    "form_submit": { ja: "送信", en: "Submit", zh: "发送" },
    "chat_placeholder": { ja: "メッセージ...", en: "Message...", zh: "输入消息..." },
    "chat_edited": { ja: "(編集済)", en: "(Edited)", zh: "(已编辑)" },

    "detail_sender_label": { ja: "送信者:", en: "Sender:", zh: "发送者:" },
    "detail_date_label": { ja: "日時:", en: "Date:", zh: "日期:" },
    "detail_no_content": { ja: "（内容なし）", en: "(No content)", zh: "（无内容）" },
    "detail_leader_comment": { ja: "主人からのコメント", en: "Master's Comment", zh: "主人留言" },
    "detail_completion_title": { ja: "完了報告の内容", en: "Completion Report", zh: "完成报告" },
    "judge_comment_label": { ja: "判定コメント (任意)", en: "Comment (Optional)", zh: "审批留言 (选填)" },
    "btn_approve": { ja: "承認する", en: "Approve", zh: "批准" },
    "btn_reject": { ja: "却下する", en: "Reject", zh: "驳回" },
    "btn_cancel_judge": { ja: "判定を取り消す", en: "Cancel Judgment", zh: "取消判定" },

    "completion_title": { ja: "命令の完了報告", en: "Report Completion", zh: "汇报完成" },
    "completion_warning": { ja: "コメントまたは証拠画像のどちらかが必須です。", en: "A comment or image is required.", zh: "必须提供留言或证明图片。" },
    "completion_comment_label": { ja: "報告コメント", en: "Report Comment", zh: "汇报留言" },
    "completion_comment_placeholder": { ja: "作業完了しました。", en: "Task completed.", zh: "任务已完成。" },
    "completion_image_label": { ja: "証拠画像 (最大4枚)", en: "Evidence Image (Max 4)", zh: "证明图片 (最多4张)" },
    "btn_completion_submit": { ja: "報告して完了にする", en: "Submit Report", zh: "提交报告" },

    "event_modal_title": { ja: "予定の追加", en: "Add Event", zh: "添加日程" },
    "event_start_date": { ja: "開始日", en: "Start Date", zh: "开始日期" },
    "event_end_date": { ja: "終了日", en: "End Date", zh: "结束日期" },
    "event_title_label": { ja: "予定の内容", en: "Event Details", zh: "日程内容" },
    "event_title_placeholder": { ja: "例: 外出、調教など", en: "e.g., Outing, Training", zh: "例: 外出、训练等" },
    "btn_cancel": { ja: "キャンセル", en: "Cancel", zh: "取消" },
    "btn_save": { ja: "保存", en: "Save", zh: "保存" },

    "updates_title": { ja: "更新情報", en: "Updates", zh: "更新日志" },
    "updates_content": {
        ja: `<ul class="mb-0 ps-3" style="line-height: 1.8;"><li>アプリをリリース</li><li>セキュリティ対策のための改修</li><li>命令への完了報告時には、画像かコメントの添付を必須としました</li><li>アプリに通知ドットが表示されるようにしました</li><li>退会ボタンを設置しました</li><li>命令/申請、チャット欄に日時が表示されるようにしました</li><li>英語、中国語に対応しました</li><li>3名以上のグループの場合、通知の宛先を設定できるようにしました</li></ul>`,
        en: `<ul class="mb-0 ps-3" style="line-height: 1.8;"><li>App released</li><li>Security improvements</li><li>Image or comment is now required when reporting completion</li><li>Added notification dots to the app</li><li>Added account deletion button</li><li>Added timestamps to requests/instructions, and chats</li><li>Added support for English and Chinese</li><li>Added the ability to specify notification recipients for groups of 3 or more members</li></ul>`,
        zh: `<ul class="mb-0 ps-3" style="line-height: 1.8;"><li>应用发布</li><li>安全升级</li><li>汇报完成指令时，必须附带图片或留言</li><li>应用内新增通知红点显示</li><li>新增注销账户按钮</li><li>指令/申请和聊天栏现在会显示日期时间</li><li>新增对英语和中文的支持</li><li>3人及以上群组支持设置通知收件人</li></ul>`
    },
    "btn_choose_file": { ja: "ファイルを選択", en: "Choose Files", zh: "选择文件" },

    "msg_enter_name_pass": { ja: "名前とパスワードを入力してください", en: "Please enter your name and password.", zh: "请输入姓名和密码。" },
    "msg_pwd_update_fail": { ja: "パスワードの更新に失敗しました", en: "Failed to update password.", zh: "密码更新失败。" },
    "msg_confirm_logout": { ja: "ログアウトしますか？", en: "Are you sure you want to log out?", zh: "确定要退出登录吗？" },
    "msg_test_acc_block": { ja: "テスト用アカウントのため、退会処理は実行できません。", en: "Test accounts cannot be deleted.", zh: "测试账号无法注销。" },
    "msg_confirm_withdraw": { ja: "【警告】\n退会すると、あなたのアカウント情報はすべて削除され、復元することはできません。\n本当に退会してもよろしいですか？", en: "[Warning]\nDeleting your account will erase all your data. This cannot be undone.\nAre you sure you want to proceed?", zh: "【警告】\n注销后，您的所有账户信息将被删除且无法恢复。\n确定要注销吗？" },
    "msg_withdraw_success": { ja: "退会処理が完了しました。ご利用ありがとうございました！", en: "Account deleted successfully. Thank you!", zh: "注销成功。感谢您的使用！" },
    "msg_withdraw_fail": { ja: "退会処理に失敗しました。", en: "Failed to delete account.", zh: "注销失败。" },
    "msg_withdraw_relogin": { ja: "セキュリティのため、退会処理を行うには再度ログインが必要です。\n一度ログアウトし、もう一度ログインしてから再度お試しください。", en: "For security reasons, please log in again to delete your account.", zh: "出于安全考虑，请重新登录后再尝试注销。" },
    "msg_confirm_delete": { ja: "この項目を削除しますか？\n（削除後は元に戻せません）", en: "Delete this item?\n(Cannot be undone)", zh: "确定删除此项目吗？\n(删除后无法恢复)" },
    "msg_submit_success": { ja: "送信しました", en: "Submitted successfully.", zh: "发送成功。" },
    "msg_submit_fail": { ja: "送信に失敗しました", en: "Failed to submit.", zh: "发送失败。" },
    "msg_max_images": { ja: "画像は最大4枚までです", en: "Maximum of 4 images allowed.", zh: "最多只能上传4张图片。" },
    "msg_completion_error": { ja: "【エラー】コメントまたは証拠画像のどちらかを必ず入力・添付してください！", en: "[Error] A comment or evidence image is required!", zh: "【错误】必须填写留言或上传证明图片！" },
    "msg_report_fail": { ja: "報告に失敗しました", en: "Failed to report.", zh: "汇报失败。" },
    "msg_confirm_mark_read": { ja: "この申請結果を確認済みとしますか？\n（※自分用のメモ機能のため、主人に通知は飛びません）", en: "Mark this result as confirmed?\n(*Memo only, master will not be notified)", zh: "是否确认此结果？\n(※此为备忘功能，不会通知主人)" },
    
    // 👇 通知許可用のメッセージを追加
    "msg_notif_unsupported": { ja: "お使いのブラウザは通知機能に対応していません。", en: "Your browser does not support notifications.", zh: "您的浏览器不支持通知功能。" },
    "msg_notif_denied": { ja: "通知がブロックされています。端末の設定アプリから、このWebサイトの通知を「許可」に変更してください。", en: "Notifications are blocked. Please allow notifications for this site in your device settings.", zh: "通知被屏蔽。请在设备设置中允许此网站的通知。" },
    "msg_notif_enabled": { ja: "通知をオンにしました！", en: "Notifications turned on!", zh: "通知已开启！" },
    "msg_notif_already_on": { ja: "すでに通知はオンになっています。", en: "Notifications are already on.", zh: "通知已处于开启状态。" },
    "msg_notif_error": { ja: "通知の設定中にエラーが発生しました。", en: "An error occurred while setting up notifications.", zh: "设置通知时发生错误。" },

    "badge_instruction": { ja: "命令", en: "Instruction", zh: "指令" },
    "badge_instruction_wait": { ja: "命令（完了報告待ち）", en: "Instruction (Pending Report)", zh: "指令 (待汇报)" },
    "badge_request": { ja: "申請", en: "Request", zh: "申请" }
};
let currentLang = localStorage.getItem('app_lang') || 'ja'; 

const App = {
    async init() {
        try {
            const settingsRes = await fetch('config/settings.json?v=' + new Date().getTime());
            CONFIG_SETTINGS = await settingsRes.json();

            onAuthStateChanged(auth, async (user) => {
                if (user && CURRENT_USER) {
                    await DB.createAuthBridge(user.uid, CURRENT_USER.id, CURRENT_USER.group);
                }
            });
            
            this.setupLanguage();

            this.setupLogin();
            this.setupTabs();
            this.setupImageInputs();
            this.setupTextareaAutoResize();
            this.setupHistoryHandler();

        } catch (e) { console.error("Init Error", e); }
    },

    setupLanguage() {
        const langSelect = document.getElementById('lang-select');
        if (langSelect) {
            langSelect.value = currentLang;
            langSelect.addEventListener('change', (e) => {
                this.applyTranslations(e.target.value);
            });
        }
        this.applyTranslations(currentLang); 
    },

    applyTranslations(lang) {
        currentLang = lang;
        localStorage.setItem('app_lang', lang); 
        
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if(TRANSLATIONS[key] && TRANSLATIONS[key][lang]) {
                el.textContent = TRANSLATIONS[key][lang];
            }
        });

        document.querySelectorAll('[data-i18n-html]').forEach(el => {
            const key = el.getAttribute('data-i18n-html');
            if(TRANSLATIONS[key] && TRANSLATIONS[key][lang]) {
                el.innerHTML = TRANSLATIONS[key][lang];
            }
        });
        
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            if(TRANSLATIONS[key] && TRANSLATIONS[key][lang]) {
                el.setAttribute('placeholder', TRANSLATIONS[key][lang]);
            }
        });
        
        const targetTabId = sessionStorage.getItem('activeTab') || '#tab-inbox';
        if(CURRENT_USER) {
            const titleMap = { 
                '#tab-chat': TRANSLATIONS["nav_chat"][currentLang], 
                '#tab-inbox': TRANSLATIONS["nav_inbox"][currentLang], 
                '#tab-form': CURRENT_USER.role === 'leader' ? TRANSLATIONS["nav_form_leader"][currentLang] : TRANSLATIONS["nav_form_member"][currentLang], 
                '#tab-calendar': TRANSLATIONS["nav_calendar"][currentLang] 
            };
            const headerTitle = document.getElementById('header-title');
            if(headerTitle && titleMap[targetTabId]) headerTitle.textContent = titleMap[targetTabId];
            
            if (targetTabId === '#tab-inbox') this.startInboxListener();
            
            this.setupFormTargets();
        }
    },

    setupHistoryHandler() {
        window.addEventListener('popstate', () => {
             const chatDetail = document.getElementById('chat-detail-container');
             if (chatDetail && !chatDetail.classList.contains('d-none')) {
                 chatDetail.classList.add('d-none');
                 document.getElementById('chat-input-area').classList.add('d-none');
                 document.getElementById('chat-container').classList.remove('d-none');
                 document.querySelector('.bottom-nav').classList.remove('d-none');
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
                .map(b => b.toString(16).padStart(2, '0')).join('');
        };

loginBtn.addEventListener('click', async () => {
            const inputName = nameInput.value.trim();
            let inputPass = passInput.value.trim(); 

            // テストアカウントの場合は、裏側でパスワードを強制セットして顔パスにする
            if (TEST_ACCOUNT_NAMES.includes(inputName)) {
                inputPass = INITIAL_PASS; 
            }

            if (!inputName || !inputPass) {
                alert(TRANSLATIONS["msg_enter_name_pass"][currentLang]); 
                return;
            }

            loginBtn.disabled = true;
            loginBtn.textContent = TRANSLATIONS["login_authenticating"][currentLang];
            document.getElementById('login-error').classList.add('d-none');

            const dummyEmail = safeHexEncode(inputName) + "@dummy.keep-under-control.com";

            try {
                let isFirstLogin = false;

                // 🚨【修正1】認証（ログイン）だけの処理を完全に独立させる
                try {
                    await signInWithEmailAndPassword(auth, dummyEmail, inputPass);
                } catch (authErr) {
                    if (inputPass === INITIAL_PASS) {
                        await createUserWithEmailAndPassword(auth, dummyEmail, inputPass);
                        isFirstLogin = true;
                    } else {
                        console.error("Authentication Error:", authErr);
                        throw new Error("wrong-password"); // ここは本当にパスワードが違う時だけ
                    }
                }

                // 🚨【修正2】名簿の取得処理（データベースのエラーと分離）
                let userData = null;
                try {
                    if (isFirstLogin) {
                        userData = await DB.getUserByName(inputName);
                    } else {
                        // 既存ユーザーはUIDで探す
                        userData = await DB.getUserByAuthUid(auth.currentUser.uid);
                        
                        // 🌟【超重要】過去にパスワード設定済みだが、名簿側のロック(authUid)が空の場合の救済措置
                        if (!userData) {
                            userData = await DB.getUserByName(inputName);
                        }
                    }
                } catch (dbErr) {
                    console.error("Firestore Rules Error:", dbErr);
                    throw new Error("db-error");
                }

                if (!userData) {
                    await signOut(auth);
                    throw new Error("not-found-in-db");
                }

                CURRENT_USER = userData;

                if (auth.currentUser) {
                    // 第4引数に CURRENT_USER.role を追加し、役職を証明書に刻む
                    await DB.createAuthBridge(auth.currentUser.uid, CURRENT_USER.id, CURRENT_USER.group, CURRENT_USER.role);
                }
                
                if (inputPass === INITIAL_PASS) {
                    
                    // テストユーザーなら、隔離部屋へ直行
                    if (TEST_ACCOUNT_NAMES.includes(inputName)) {
                        const userToSave = { ...CURRENT_USER };
                        delete userToSave.password; 
                        localStorage.setItem('app_user_v3', JSON.stringify(userToSave));
                        this.showMainScreen();
                        return; 
                    }

                    // 本番ユーザー（初回ログイン）の場合はパスワード変更
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
                            const userToSave = { ...CURRENT_USER };
                            delete userToSave.password; 
                            localStorage.setItem('app_user_v3', JSON.stringify(userToSave));

                            pwdModal.hide();
                            this.showMainScreen();
                        } catch (e) {
                            console.error(e);
                            alert(TRANSLATIONS["msg_pwd_update_fail"][currentLang]); 
                            changeBtn.disabled = false;
                            changeBtn.textContent = "変更して利用開始";
                        }
                    };
                } else {
                    const userToSave = { ...CURRENT_USER };
                    delete userToSave.password; 
                    localStorage.setItem('app_user_v3', JSON.stringify(userToSave));
                    this.showMainScreen();
                }

            } catch (error) {
                console.error("General Login Error:", error);
                document.getElementById('login-error').classList.remove('d-none');
                loginBtn.disabled = false;
                loginBtn.textContent = TRANSLATIONS["login_button"][currentLang];
            }
        });
        
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

        this.setupFormTargets();

        this.startInboxListener();
        this.renderChatList();
        this.setupNotifications();
        this.updateNotificationButtonState(); // 👇 🔔ボタンの見た目を更新
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

    // 👇 🔔ボタンの見た目を「許可状態」に合わせて変更する機能
    updateNotificationButtonState() {
        const btn = document.getElementById('notification-btn');
        if (!btn) return;
        const icon = btn.querySelector('i');
        
        if (!('Notification' in window)) {
            btn.classList.add('d-none');
            return;
        }

        if (Notification.permission === 'granted') {
            icon.className = 'bi bi-bell-fill text-warning';
        } else {
            icon.className = 'bi bi-bell-slash text-secondary';
        }
    },

    // 👇 🔔ボタンを押したときに発動する「手動の」通知許可リクエスト
    async requestNotificationManual() {
        if (!('Notification' in window)) {
            alert(TRANSLATIONS["msg_notif_unsupported"][currentLang]);
            return;
        }

        if (Notification.permission === 'denied') {
            alert(TRANSLATIONS["msg_notif_denied"][currentLang]);
            return;
        }

        if (Notification.permission === 'granted') {
            alert(TRANSLATIONS["msg_notif_already_on"][currentLang]);
            return;
        }

        try {
            const permission = await Notification.requestPermission();
            this.updateNotificationButtonState();
            
            if (permission === 'granted') {
                const registration = await navigator.serviceWorker.register('sw.js');
                const token = await getToken(messaging, { 
                    vapidKey: "BMdNlbLwC3bEwAIp-ZG9Uwp-5n4HdyXvlsqJbt6Q5YRdCA7gUexx0G9MpjB3AdLk6iNJodLTobC3-bGG6YskB0s",
                    serviceWorkerRegistration: registration
                });
                if (token) {
                    await DB.saveUserToken(CURRENT_USER, token);
                    alert(TRANSLATIONS["msg_notif_enabled"][currentLang]);
                }
            }
        } catch (error) {
            console.error(error);
            alert(TRANSLATIONS["msg_notif_error"][currentLang]);
        }
    },

    async setupFormTargets() {
        const groupUsers = await DB.getGroupUsers(CURRENT_USER.group);
        const targetContainer = document.getElementById('form-target-container');
        const targetSelect = document.getElementById('form-target-select');
        
        if (!targetContainer || !targetSelect) return;

        if (groupUsers.length >= 3) {
            targetContainer.classList.remove('d-none');
            
            const currentValue = targetSelect.value;
            
            targetSelect.innerHTML = '';
            
            const optAll = document.createElement('option');
            optAll.value = "all";
            optAll.textContent = TRANSLATIONS["target_all"][currentLang];
            optAll.setAttribute('data-i18n', 'target_all');
            targetSelect.appendChild(optAll);
            
            const targetRole = CURRENT_USER.role === 'leader' ? 'member' : 'leader';
            const targets = groupUsers.filter(u => u.role === targetRole);
            
            targets.forEach(t => {
                const opt = document.createElement('option');
                opt.value = t.id;
                opt.textContent = t.name;
                targetSelect.appendChild(opt);
            });
            
            if (currentValue) {
                targetSelect.value = currentValue;
            }
        } else {
            targetContainer.classList.add('d-none');
        }
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
                
                const titleMap = { 
                    '#tab-chat': TRANSLATIONS["nav_chat"][currentLang], 
                    '#tab-inbox': TRANSLATIONS["nav_inbox"][currentLang], 
                    '#tab-form': CURRENT_USER.role === 'leader' ? TRANSLATIONS["nav_form_leader"][currentLang] : TRANSLATIONS["nav_form_member"][currentLang], 
                    '#tab-calendar': TRANSLATIONS["nav_calendar"][currentLang] 
                };
                document.getElementById('header-title').textContent = titleMap[targetId];

                const chatInput = document.getElementById('chat-input-area');
                const bottomNav = document.querySelector('.bottom-nav'); // 👇 追加
                
                if (targetId === '#tab-chat') {
                    const chatDetail = document.getElementById('chat-detail-container');
                    if (chatDetail && !chatDetail.classList.contains('d-none')) {
                        chatInput.classList.remove('d-none');
                        bottomNav.classList.add('d-none'); // 👇 チャット詳細中はナビを隠す！
                    } else {
                        chatInput.classList.add('d-none');
                        bottomNav.classList.remove('d-none'); // 👇 チャット一覧ではナビを出す！
                    }
                } else {
                    chatInput.classList.add('d-none');
                    bottomNav.classList.remove('d-none'); // 👇 他のタブでもナビを出す！
                }
            });
        });

        // 👇 🔔ボタンがクリックされた時の処理を紐付け
        document.getElementById('notification-btn').addEventListener('click', () => {
            this.requestNotificationManual();
        });

        document.getElementById('logout-btn').addEventListener('click', async () => {
            if(confirm(TRANSLATIONS["msg_confirm_logout"][currentLang])) { 
                try { await signOut(auth); } catch(e){}
                localStorage.removeItem('app_user_v3');
                location.reload();
            }
        });

        document.getElementById('btn-show-withdraw').addEventListener('click', async () => {
            if (TEST_ACCOUNT_NAMES.includes(CURRENT_USER.name)) {
                alert(TRANSLATIONS["msg_test_acc_block"][currentLang]); 
                return; 
            }
            if(confirm(TRANSLATIONS["msg_confirm_withdraw"][currentLang])) { 
                try {
                    await DB.deleteUserAccount(CURRENT_USER.id);
                    
                    if (auth.currentUser) {
                        await deleteUser(auth.currentUser);
                    }
                    
                    localStorage.removeItem('app_user_v3');
                    alert(TRANSLATIONS["msg_withdraw_success"][currentLang]); 
                    location.reload();
                    
                } catch (e) {
                    console.error("退会エラー:", e);
                    if (e.code === 'auth/requires-recent-login') {
                        alert(TRANSLATIONS["msg_withdraw_relogin"][currentLang]); 
                    } else {
                        alert(TRANSLATIONS["msg_withdraw_fail"][currentLang]); 
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
        if (groupUsers.length >= 3) {
            const allDiv = document.createElement('div');
            allDiv.className = 'p-3 border-bottom d-flex align-items-center clickable';
            allDiv.style.backgroundColor = '#e8f5e9';
            allDiv.innerHTML = `
                <div class="rounded-circle text-white d-flex align-items-center justify-content-center me-3 shadow-sm" style="width:40px; height:40px; font-size:20px; background-color: var(--primary-color);">📢</div>
                <div>
                    <div class="fw-bold">グループ全体チャット <span class="badge bg-secondary ms-1">全員</span></div>
                    <div class="small text-muted">参加者全員にメッセージを送信できます</div>
                </div>
            `;
            allDiv.onclick = () => this.openChat(CURRENT_USER.group, CURRENT_USER.id, "ALL", "グループ全体チャット");
            container.appendChild(allDiv);
        }
        targets.forEach(target => {
            const safeIcon = target.icon || "👤";
            const div = document.createElement('div');
            div.className = 'p-3 border-bottom d-flex align-items-center bg-white clickable';
            div.innerHTML = `
                <div class="rounded-circle bg-secondary text-white d-flex align-items-center justify-content-center me-3" style="width:40px; height:40px; font-size:20px;">${safeIcon}</div>
                <div>
                    <div class="fw-bold">${escapeHTML(target.name)} <span class="badge bg-light text-dark ms-1">${target.role === 'leader' ? 'master' : 'slave'}</span></div>
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
        document.querySelector('.bottom-nav').classList.add('d-none');

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
                
                let timeStr = "";
                if (msg.createdAt) {
                    const date = msg.createdAt.toDate();
                    const m = date.getMonth() + 1;
                    const d = date.getDate();
                    const h = date.getHours();
                    const min = String(date.getMinutes()).padStart(2, '0');
                    timeStr = `${m}/${d} ${h}:${min}`;
                }
                const timeHtml = timeStr ? `<div style="font-size: 0.65rem; color: #888; margin: 0 4px; align-self: flex-end; padding-bottom: 2px; white-space: nowrap;">${timeStr}</div>` : '';

                const reactionHtml = reactionsCount > 0 ? `<div class="reaction-badge"><i class="${hasReacted ? 'bi bi-heart-fill' : 'bi bi-heart'}"></i> ${reactionsCount}</div>` : '';

                const iconHtml = !isMe ? `
                    <div class="flex-shrink-0 me-2 mt-1 d-flex flex-column align-items-center" style="width: 45px;">
                        <div style="font-size:28px; line-height:1;">${msg.senderIcon}</div>
                        <div style="font-size: 0.55rem; color: #666; margin-top: 2px; text-align: center; line-height: 1.1; word-break: break-all;">${escapeHTML(msg.senderName)}</div>
                    </div>
                ` : '';
                
                const editedLabel = msg.isEdited ? `<span class="text-muted ms-1" style="font-size:9px;">${TRANSLATIONS["chat_edited"][currentLang]}</span>` : '';

                let textBlock = '';
                if(msg.text) {
                    textBlock = `
                        <div class="d-flex align-items-end mb-1">
                            ${isMe ? timeHtml : ''}
                            <div style="position: relative;" class="chat-bubble-content">
                                <div class="p-2 rounded text-dark shadow-sm" style="background-color: ${isMe ? 'var(--chat-me-bg)' : 'var(--chat-other-bg)'}; display: inline-block; text-align: left; white-space: pre-wrap; word-wrap: break-word;">${escapeHTML(msg.text)}${editedLabel}</div>
                                ${reactionHtml}
                            </div>
                            ${!isMe ? timeHtml : ''}
                        </div>
                    `;
                } else if (msg.isEdited) {
                    textBlock = `<div class="w-100 ${isMe ? 'text-end' : 'text-start'} mb-1">${editedLabel}</div>`;
                }

                let imagesBlock = '';
                if(msg.images && msg.images.length > 0) {
                    let imgs = '';
                    msg.images.forEach(img => {
                        imgs += `<img src="${img}" class="img-fluid rounded clickable" style="width: 100px; height: 100px; object-fit: cover;" onclick="event.stopPropagation(); window.openFullscreenImage('${img}')">`;
                    });

                    if (!msg.text) {
                        imagesBlock = `
                            <div class="d-flex align-items-end">
                                ${isMe ? timeHtml : ''}
                                <div style="position: relative;" class="chat-bubble-content">
                                    <div class="d-flex flex-wrap gap-1 mt-1 ${isMe ? 'justify-content-end' : 'justify-content-start'}" style="max-width: 210px;" onclick="event.stopPropagation();">
                                        ${imgs}
                                    </div>
                                    ${reactionHtml}
                                </div>
                                ${!isMe ? timeHtml : ''}
                            </div>
                        `;
                    } else {
                        imagesBlock = `
                            <div class="d-flex flex-wrap gap-1 ${isMe ? 'justify-content-end' : 'justify-content-start'}" style="max-width: 210px;" onclick="event.stopPropagation();">
                                ${imgs}
                            </div>
                        `;
                    }
                }

                const div = document.createElement('div');
                div.className = `d-flex align-items-start chat-row ${isMe ? 'justify-content-end' : 'justify-content-start'}`;
                div.innerHTML = `
                    ${iconHtml}
                    <div style="max-width: 75%;">
                        <div class="d-flex flex-column ${isMe ? 'align-items-end' : 'align-items-start'}">
                            ${textBlock}
                            ${imagesBlock}
                        </div>
                    </div>
                `;

                if (!isMe) {
                    let pressTimer;
                    const bubbles = div.querySelectorAll('.chat-bubble-content');
                    bubbles.forEach(bubble => {
                        bubble.addEventListener('touchstart', () => {
                            pressTimer = setTimeout(() => { DB.toggleReaction(groupId, myId, targetId, msg.id, CURRENT_USER.id); }, 500);
                        }, {passive:true});
                        bubble.addEventListener('touchend', () => clearTimeout(pressTimer));
                    });
                }

                if (isMe && msg.text) {
                    const bubble = div.querySelector('.chat-bubble-content .p-2');
                    if (bubble) {
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
        
        document.getElementById('back-to-chat-list').onclick = () => {
            document.querySelector('.bottom-nav').classList.remove('d-none'); // 👇 戻る時にナビを復活
            history.back();
        };
        
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
                
                if (app.targetUserId) {
                    if (CURRENT_USER.id !== app.userId && CURRENT_USER.id !== app.targetUserId) return;
                } else {
                    if(CURRENT_USER.role === 'member' && app.userId !== CURRENT_USER.id && app.type !== 'instruction') return;
                }

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
                
                let instructionLabel = TRANSLATIONS["badge_instruction"][currentLang];
                if (isInstruction && CURRENT_USER.role === 'leader' && !isInstructionCompleted) {
                    instructionLabel = TRANSLATIONS["badge_instruction_wait"][currentLang];
                }

                const badgeHtml = isInstruction 
                    ? `<span class="badge bg-primary px-3 py-1">${instructionLabel}</span>`
                    : `<span class="badge border border-secondary text-secondary px-3 py-1">${TRANSLATIONS["badge_request"][currentLang]}</span>`;

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

                let senderReceiverText = escapeHTML(app.userName);
                if (app.targetUserName) {
                    senderReceiverText += ` <i class="bi bi-caret-right-fill text-muted"></i> ${escapeHTML(app.targetUserName)}`;
                }
                senderReceiverText += ` <span class="ms-1">- ${app.createdDateStr}</span>`;

                div.innerHTML = `
                    <div class="d-flex justify-content-between align-items-center mb-2">
                        <div class="d-flex align-items-center gap-2">
                            ${badgeHtml}
                            ${statusBadgeHtml}
                        </div>
                        <div id="delete-btn-container-${app.id}" style="width: 24px; text-align: right;"></div>
                    </div>
                    <strong class="d-block mb-2 pe-5" style="font-size: 1.05rem;">${escapeHTML(app.title)}</strong>
                    <div class="d-flex align-items-center gap-2 small text-muted pe-5">
                        <span>${senderReceiverText}</span>
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
                        if(confirm(TRANSLATIONS["msg_confirm_delete"][currentLang])) { 
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
                                    alert(TRANSLATIONS["msg_completion_error"][currentLang]); 
                                    return;
                                }
                                
                                newSubmitBtn.disabled = true;
                                newSubmitBtn.textContent = "送信中...";
                                
                                try {
                                    const uploadedUrls = await DB.submitCompletionReport(app.id, CURRENT_USER.group, CURRENT_USER.id, comment, completionImagesBase64);
                                    
                                    const autoMsg = `✅ 「${app.title}」を完了しました！${comment ? '\n\n' + comment : ''}`;
                                    await DB.sendMessage(CURRENT_USER.group, CURRENT_USER.id, app.userId, CURRENT_USER, autoMsg, uploadedUrls);

                                    modal.hide();
                                } catch(err) {
                                    console.error(err);
                                    alert(TRANSLATIONS["msg_report_fail"][currentLang]); 
                                    newSubmitBtn.disabled = false;
                                    newSubmitBtn.textContent = TRANSLATIONS["btn_completion_submit"][currentLang] || "報告して完了にする";
                                }
                            };
                        };
                    }
                } else if (CURRENT_USER.role === 'member' && app.userId === CURRENT_USER.id && (app.status === 'approved' || app.status === 'rejected')) {
                    showCheckBtn = true;
                    btnStateCompleted = isAppConfirmed;
                    onCheckAction = async (e) => {
                        e.stopPropagation(); 
                        if(confirm(TRANSLATIONS["msg_confirm_mark_read"][currentLang])) { 
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
        document.getElementById('detail-content').textContent = appData.content || TRANSLATIONS["detail_no_content"][currentLang];

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
            if (files.length + arrayRef.length > 4) { 
                alert(TRANSLATIONS["msg_max_images"][currentLang]); 
                return; 
            }
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
        
        const targetContainer = document.getElementById('form-target-container');
        const targetSelect = document.getElementById('form-target-select');
        let targetUserId = null;
        let targetUserName = null;
        
        if (targetContainer && !targetContainer.classList.contains('d-none') && targetSelect && targetSelect.value && targetSelect.value !== 'all') {
            targetUserId = targetSelect.value;
            targetUserName = targetSelect.options[targetSelect.selectedIndex].text;
        }
        
        const data = {
            title: title,
            content: content,
            userId: CURRENT_USER.id,
            userName: CURRENT_USER.name,
            groupId: CURRENT_USER.group,
            type: CURRENT_USER.role === 'leader' ? 'instruction' : 'request',
            images: formImagesBase64,
            targetUserId: targetUserId,
            targetUserName: targetUserName
        };
        
        try {
            await DB.submitForm(data);
            alert(TRANSLATIONS["msg_submit_success"][currentLang]); 
            document.getElementById('form-content').value = '';
            formImagesBase64 = [];
            this.updateImagePreview('form-image-preview', formImagesBase64, 'form-image-file');
            document.querySelector('.bottom-nav-item[href="#tab-inbox"]').click(); 
        } catch(e) { 
            console.error(e); 
            alert(TRANSLATIONS["msg_submit_fail"][currentLang]); 
        }
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
        toast.innerHTML = `<i class="bi bi-bell-fill text-warning me-3 fs-4"></i><div><strong class="d-block">${escapeHTML(title)}</strong><span class="small">${escapeHTML(body)}</span></div>`;
        
        toast.onclick = () => toast.remove();
        container.appendChild(toast);
        setTimeout(() => { if (toast.parentNode) toast.remove(); }, 4000);
    },

    async setupNotifications() {
        try {
            const permission = await Notification.requestPermission();
            if (permission === 'granted') {
                const registration = await navigator.serviceWorker.register('sw.js');
                
                // 👇 【追加】サービスワーカーが完全に起き上がる（Activeになる）まで待つ！
                await navigator.serviceWorker.ready; 
                
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











