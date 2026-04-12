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
let unsubscribeRoomMeta = null;

let currentChatTargetId = null; 
let currentChatContext = null; // 🌟 iOS復帰時の再接続用
let chatImagesBase64 = []; 
let formImagesBase64 = []; 
let completionImagesBase64 = []; 

let notificationListenerRegistered = false; // 🌟 onMessage重複登録防止フラグ

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

// 🌟 新規：触覚フィードバック（対応端末のみ）
const haptic = (duration = 10) => {
    try { if (navigator.vibrate) navigator.vibrate(duration); } catch(e) {}
};

// 🌟 新規：スケルトンスクリーン生成
const showSkeleton = (containerId, type = 'list', count = 4) => {
    const container = document.getElementById(containerId);
    if (!container) return;
    let html = '';
    for (let i = 0; i < count; i++) {
        if (type === 'list') {
            html += `<div class="skeleton-row"><div class="skeleton-avatar"></div><div style="flex:1;"><div class="skeleton-line long"></div><div class="skeleton-line short"></div></div></div>`;
        } else if (type === 'card') {
            html += `<div class="skeleton-card"><div class="skeleton-line medium"></div><div class="skeleton-line long"></div><div class="skeleton-line short"></div></div>`;
        }
    }
    container.innerHTML = html;
};

// 🌟 新規：プログレッシブ画像要素を生成
const createProgressiveImg = (src, className = '', style = '') => {
    const img = document.createElement('img');
    img.className = `progressive-img ${className}`;
    if (style) img.style.cssText = style;
    img.onload = () => img.classList.add('loaded');
    img.onerror = () => { img.classList.add('loaded'); img.style.opacity = '0.5'; };
    img.src = src;
    return img;
};

const TRANSLATIONS = {
    "login_title": { ja: "利用開始", en: "Start Using", zh: "开始使用" },
    "login_notice": {
        ja: `<strong>【重要なお知らせ】</strong><br>お手数ですが、初回ログイン時に<strong>自分専用のパスワード（6文字以上）</strong>の設定をお願いいたします。<br><span class="text-danger">※初期パスワードは「123456」です。</span>`,
        en: `<strong>[Important Notice]</strong><br>Please set your <strong>personal password (6+ characters)</strong> upon your first login.<br><span class="text-danger">* Default password is '123456'.</span>`,
        zh: `<strong>【重要通知】</strong><br>首次登录时，请设置<strong>专属密码（6位以上）</strong>。<br><span class="text-danger">※初始密码为“123456”。</span>`
    },
    "login_account_creation": {
        ja: `<strong>【個人用アカウント作成について】</strong><br>不特定多数の募集は中止しました。個人用アカウントの作成を希望される方は、<a href="https://x.com/FvFA4yNQfW15814" target="_blank" rel="noopener noreferrer" class="text-decoration-none fw-bold">@FvFA4yNQfW15814</a> までDMにてお問い合わせください。`,
        en: `<strong>[Regarding Personal Account Creation]</strong><br>I have discontinued recruitment for the general public. If you wish to create a personal account, please contact <a href="https://x.com/FvFA4yNQfW15814" target="_blank" rel="noopener noreferrer" class="text-decoration-none fw-bold">@FvFA4yNQfW15814</a> via DM.`,
        zh: `<strong>【关于个人账户创建】</strong><br>已停止面向不特定多数的招募。如果希望创建个人账户，请通过私信联系 <a href="https://x.com/FvFA4yNQfW15814" target="_blank" rel="noopener noreferrer" class="text-decoration-none fw-bold">@FvFA4yNQfW15814</a>。`
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
    "msg_confirm_withdraw": { 
        ja: "【警告】\n退会すると、あなたの送信した画像データとアカウント情報はすべて削除され、復元することはできません。\n本当に退会してもよろしいですか？", 
        en: "[Warning]\nDeleting your account will erase all your uploaded images and account information. This cannot be undone.\nAre you sure you want to proceed?", 
        zh: "【警告】\n注销后，您发送的图片数据和账户信息将被全部删除且无法恢复。\n确定要注销吗？" 
    },    
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
    "badge_request": { ja: "申請", en: "Request", zh: "申请" },

    // 👇 規約用の翻訳データ
    "terms_title": { ja: "※重要：利用規約およびプライバシーポリシー", en: "*Important: Terms of Service and Privacy Policy", zh: "※重要：使用条款与隐私政策" },
    "terms_intro": { ja: "本アプリのご利用にあたり、以下の規約およびプライバシーポリシーへの同意が必須となります。", en: "To use this app, you must agree to the following Terms of Service and Privacy Policy.", zh: "使用本应用前，必须同意以下使用条款与隐私政策。" },
    "terms_h1": { ja: "1. 免責事項", en: "1. Disclaimer", zh: "1. 免责声明" },
    "terms_p1": { ja: "本アプリの利用、通信障害、システムエラー、またはデータの消失により生じた直接的および間接的な損害について、管理者は一切の責任を負いません。", en: "The administrator assumes no responsibility for any direct or indirect damages caused by the use of this app, communication failures, system errors, or data loss.", zh: "对于因使用本应用、通信故障、系统错误或数据丢失而造成的任何直接或间接损失，管理员概不负责。" },
    "terms_h2": { ja: "2. アカウントの管理と禁止事項（データアップロードについて）", en: "2. Account Management and Prohibited Acts", zh: "2. 账户管理与禁止事项" },
    "terms_p2_1": { ja: "アカウントの第三者への貸与・譲渡・使い回しを固く禁じます。他ユーザーへのなりすましや不正アクセス等の禁止行為が発覚した場合、管理者は予告なくアカウントを停止・削除できるものとします。", en: "Lending, transferring, or sharing accounts with third parties is strictly prohibited. If prohibited acts such as impersonation or unauthorized access are discovered, the administrator may suspend or delete the account without notice.", zh: "严禁向第三方出借、转让或共享账户。如发现冒充他人或未经授权访问等禁止行为，管理员可随时中止或删除账户。" },
    "terms_p2_2": { ja: "本アプリ内での違法な画像（無修正画像、児童ポルノ等）、極度な残虐画像、その他利用サーバー（Google・GitHub等）の規約に違反するデータのアップロードを禁じます。アップロードされたデータにより生じたトラブルや、システム提供元からのアカウント凍結等の問題について、管理者は一切の責任を負いません。これらはすべて、データをアップロードしたユーザー自身の責任において解決するものとします。", en: "Uploading illegal images (uncensored, CSAM, etc.), extreme gore, or other data violating server terms (Google, GitHub, etc.) is prohibited. The administrator bears no responsibility for any trouble or account freezing caused by uploaded data. Users must resolve all such issues at their own responsibility.", zh: "禁止上传违法图片（无码图片、儿童色情等）、极度残忍图片，或其他违反服务器（Google、GitHub等）条款的数据。对于因上传数据引发的纠纷或系统提供商冻结账户等问题，管理员概不负责。所有这些问题均由上传数据的用户自行承担责任解决。" },
    "terms_h3": { ja: "3. データの閲覧権限", en: "3. Data Viewing Permissions", zh: "3. 数据查看权限" },
    "terms_p3": { ja: "業務遂行およびセキュリティ管理の目的上、システム管理者（および所属グループの権限者）は、必要に応じてユーザーの送信内容（チャット・申請・予定・画像等）を閲覧および管理できるものとします。", en: "For operational and security management purposes, the system administrator (and group leaders) may view and manage users' transmitted content as necessary.", zh: "出于运营和安全管理目的，系统管理员（及所属群组的权限者）可视需要查看和管理用户发送的内容。" },
    "terms_h4": { ja: "4. プライバシーポリシー", en: "4. Privacy Policy", zh: "4. 隐私政策" },
    "terms_p4": { ja: "本システムはメールアドレス等の不要な個人情報を収集しません。登録された氏名、システムログ、Auth UID等は本アプリの運営目的のみに使用し、法令に基づく場合を除き、第三者へ提供することはありません。", en: "This system does not collect unnecessary personal information such as email addresses. Registered names, system logs, Auth UIDs, etc. are used solely for app operation and will not be provided to third parties unless required by law.", zh: "本系统不收集电子邮件地址等不必要的个人信息。注册的姓名、系统日志、Auth UID等仅用于本应用的运营目的，除法律要求外，不会向第三方提供。" },
    "terms_h5": { ja: "5. 未成年者の利用について", en: "5. Regarding Use by Minors", zh: "5. 关于未成年人使用" },
    "terms_p5": { ja: "本アプリは取り扱うコンテンツの性質上、18歳未満の方の利用を固く禁じます。本規約に同意して利用を開始した時点で、ユーザーは18歳以上であることを確約したものとみなします。年齢を偽って利用したことにより生じたトラブルや不利益について、管理者は一切の責任を負いません。", en: "Due to the nature of the content, use by individuals under 18 is strictly prohibited. By agreeing to these terms, the user confirms they are 18 or older. The administrator assumes no responsibility for any trouble or disadvantages caused by falsifying age.", zh: "由于内容的性质，严禁18岁以下人员使用本应用。同意本条款即表示用户确认其已满18岁。对于因虚报年龄而引发的纠纷或不利后果，管理员概不负责。" },
    "terms_btn_logout": { ja: "ログアウト", en: "Logout", zh: "退出登录" },
    "terms_btn_withdraw": { ja: "退会する", en: "Delete Account", zh: "注销账户" },
    "terms_btn_agree": { ja: "同意して利用を開始", en: "Agree & Start", zh: "同意并开始使用" },

    // 🌟 新規：メッセージ削除
    "msg_deleted": { ja: "メッセージが削除されました", en: "This message was deleted", zh: "此消息已被删除" },
    "msg_confirm_delete_msg": { ja: "このメッセージを削除しますか？\n削除すると元に戻せません。", en: "Delete this message?\nThis cannot be undone.", zh: "删除此消息？\n删除后无法恢复。" },
    "edit_modal_title": { ja: "メッセージの編集", en: "Edit Message", zh: "编辑消息" },
    "edit_modal_delete": { ja: "削除", en: "Delete", zh: "删除" },
    "edit_modal_save": { ja: "保存", en: "Save", zh: "保存" },
    "edit_modal_cancel": { ja: "キャンセル", en: "Cancel", zh: "取消" },

    // 🌟 新規：既読表示
    "read_label": { ja: "既読", en: "Read", zh: "已读" },

    // 🌟 新規：複数メンバー完了管理
    "completion_progress": { ja: "完了", en: "done", zh: "已完成" },
    "completion_you_done": { ja: "報告済み", en: "Reported", zh: "已汇报" },

    // 🌟 新規：チャット一覧
    "chat_tap_to_open": { ja: "タップして会話を開く", en: "Tap to open", zh: "点击打开对话" },
    "chat_image_sent": { ja: "画像が送信されました", en: "Image sent", zh: "发送了图片" }

};

let currentLang = localStorage.getItem('app_lang') || 'ja'; 

const App = {
    async init() {    
        try {
            const settingsRes = await fetch('config/settings.json?v=' + new Date().getTime());
            CONFIG_SETTINGS = await settingsRes.json();

            onAuthStateChanged(auth, async (user) => {
                if (user && CURRENT_USER) {
                    await DB.createAuthBridge(user.uid, CURRENT_USER.id, CURRENT_USER.group, CURRENT_USER.role);
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
                 if(unsubscribeRoomMeta) unsubscribeRoomMeta();
                 currentChatTargetId = null;
                 currentChatContext = null;
             }
        });
    },

    setupLogin() {
        const storedUser = localStorage.getItem('app_user_v3');
        if (storedUser) {
            CURRENT_USER = JSON.parse(storedUser);
            this.showMainScreen();
            
            // 🛡️ バックグラウンドでFirestoreから最新のユーザー情報を取得し、localStorageを同期する
            onAuthStateChanged(auth, async (user) => {
                if (user) {
                    try {
                        const freshData = await DB.getUserByAuthUid(user.uid);
                        if (freshData) {
                            // 🛡️ Firestoreの最新データでCURRENT_USERを更新
                            CURRENT_USER = freshData;
                            const userToSave = { ...CURRENT_USER };
                            delete userToSave.password;
                            localStorage.setItem('app_user_v3', JSON.stringify(userToSave));
                            
                            // 🛡️ もしlocalStorageでは規約未同意だったが、Firestore側では同意済みだった場合
                            //    → 規約モーダルが出ていたら自動で閉じる（iOS等でlocalStorageが消えた時の救済）
                            if (freshData.agreedTermsVersion === 4) {
                                const termsModalEl = document.getElementById('termsModal');
                                const termsModalInstance = bootstrap.Modal.getInstance(termsModalEl);
                                if (termsModalInstance) {
                                    termsModalInstance.hide();
                                    // 規約モーダルで止まっていた場合、メイン画面の初期化をやり直す
                                    this.showMainScreen();
                                }
                            }
                        }
                    } catch (e) { console.warn("バックグラウンド同期エラー:", e); }
                }
            });
            
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
            const inputPass = passInput.value.trim(); // 👈 let から const に戻しました（強制上書きしないため）

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

                // 認証（ログイン）
                try {
                    await signInWithEmailAndPassword(auth, dummyEmail, inputPass);
                } catch (authErr) {
                    if (inputPass === INITIAL_PASS) {
                        await createUserWithEmailAndPassword(auth, dummyEmail, inputPass);
                        isFirstLogin = true;
                    } else {
                        console.error("Authentication Error:", authErr);
                        throw new Error("wrong-password");
                    }
                }

                // 名簿の取得処理
                let userData = null;
                try {
                    if (isFirstLogin) {
                        userData = await DB.getUserByName(inputName);
                    } else {
                        userData = await DB.getUserByAuthUid(auth.currentUser.uid);
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
                    await DB.createAuthBridge(auth.currentUser.uid, CURRENT_USER.id, CURRENT_USER.group, CURRENT_USER.role);
                }
                
                if (inputPass === INITIAL_PASS) {
                    const pwdModal = new bootstrap.Modal(document.getElementById('passwordChangeModal'));
                    pwdModal.show();

                    const changeBtn = document.getElementById('btn-change-password');
                    changeBtn.onclick = async () => {
                        document.activeElement?.blur(); // 🛡️ iOS対策
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
                
                // 🌟 ここを追加・修正：Firebaseの生のエラーコードを画面に出す
                const errorCode = error.code || error.message || "Unknown Error";
                alert(`ログインできませんでした。\n何度も発生する場合は、以下をアプリ作成者までご報告ください。\n\n【エラー詳細】\n${errorCode}`);

                document.getElementById('login-error').classList.remove('d-none');
                loginBtn.disabled = false;
                loginBtn.textContent = TRANSLATIONS["login_button"][currentLang];
            }
        });
    }, // 
        
    showMainScreen() {
        // ===== 🚨【重要変更】利用規約の同意チェック（バージョン管理） =====
        // agreedTermsVersion が 4 じゃない場合（前回同意した人も含めて全員）ブロックする
        if (CURRENT_USER.agreedTermsVersion !== 4) {
            const termsModal = new bootstrap.Modal(document.getElementById('termsModal'));
            termsModal.show();

            // 「同意する」ボタンの処理
            document.getElementById('btn-terms-agree').onclick = async () => {
                const btn = document.getElementById('btn-terms-agree');
                btn.disabled = true;
                btn.textContent = "処理中..."; 
                
                try {
                    await DB.agreeToTerms(CURRENT_USER.id); 
                    
                    CURRENT_USER.agreedToTerms = true;
                    CURRENT_USER.agreedTermsVersion = 4; 
                    localStorage.setItem('app_user_v3', JSON.stringify(CURRENT_USER)); 
                    
                    termsModal.hide();
                    this.showMainScreen(); 
                } catch (e) {
                    console.error("同意処理エラー:", e);
                    alert("通信エラーが発生しました。もう一度お試しください。");
                    btn.disabled = false;
                    btn.textContent = "同意して利用を開始";
                }
            };

            // 「ログアウト」ボタンの処理
            document.getElementById('btn-terms-logout').onclick = async () => {
                try { await signOut(auth); } catch(e){}
                localStorage.removeItem('app_user_v3');
                location.reload();
            };

            // 🌟👇【新規追加】「退会する」ボタンの処理
            document.getElementById('btn-terms-withdraw').onclick = async () => {
                // テストアカウントの誤爆防止
                if (TEST_ACCOUNT_NAMES.includes(CURRENT_USER.name)) {
                    this.showToast(TRANSLATIONS["msg_test_acc_block"][currentLang], '', 'error'); 
                    return; 
                }

                // 最終確認
                if(confirm(TRANSLATIONS["msg_confirm_withdraw"][currentLang])) { 
                    try {
                        const btn = document.getElementById('btn-terms-withdraw');
                        btn.disabled = true;
                        btn.textContent = "処理中...";

                        // データベースから名簿を削除
                        await DB.deleteUserAccount(CURRENT_USER);
                        
                        // Authからユーザーを削除
                        if (auth.currentUser) {
                            await deleteUser(auth.currentUser);
                        }
                        
                        // ローカルの記憶を消去してリロード
                        localStorage.removeItem('app_user_v3');
                        alert(TRANSLATIONS["msg_withdraw_success"][currentLang]); 
                        location.reload();
                        
                    } catch (e) {
                        console.error("退会エラー:", e);
                        // セキュリティエラー（ログインから時間が経ちすぎている場合）の対応
                        if (e.code === 'auth/requires-recent-login') {
                            alert(TRANSLATIONS["msg_withdraw_relogin"][currentLang]); 
                        } else {
                            alert(TRANSLATIONS["msg_withdraw_fail"][currentLang]); 
                        }
                        document.getElementById('btn-terms-withdraw').disabled = false;
                    }
                }
            };
            // 🌟👆【新規追加】ここまで

            return; 
        }
        // ==========================================

        // （👇 ここから下は元々の処理がそのまま続きます）
        document.getElementById('login-screen')?.classList.add('d-none');
        document.getElementById('main-screen')?.classList.remove('d-none'); 
        
        document.querySelectorAll('#user-name-display').forEach(el => el.textContent = CURRENT_USER.name);

        if (CURRENT_USER.role === 'leader') {
            document.querySelectorAll('.role-leader').forEach(el => el.classList.remove('d-none'));
            document.querySelectorAll('.role-member').forEach(el => el.classList.add('d-none'));
        } else {
            document.querySelectorAll('.role-leader').forEach(el => el.classList.add('d-none'));
            document.querySelectorAll('.role-member').forEach(el => el.classList.remove('d-none'));
        }

        const typeSelect = document.getElementById('form-type-select');
        if (!typeSelect) { console.error('form-type-select が見つかりません'); return; }
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
        this.updateNotificationButtonState(); 
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
            this.showToast(TRANSLATIONS["msg_notif_unsupported"][currentLang], '', 'error');
            return;
        }

        if (Notification.permission === 'denied') {
            this.showToast(TRANSLATIONS["msg_notif_denied"][currentLang], '', 'error');
            return;
        }

        if (Notification.permission === 'granted') {
            this.showToast(TRANSLATIONS["msg_notif_already_on"][currentLang], '', 'info');
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
                    this.showToast(TRANSLATIONS["msg_notif_enabled"][currentLang], '', 'success');
                }
            }
        } catch (error) {
            console.error(error);
            this.showToast(TRANSLATIONS["msg_notif_error"][currentLang], '', 'error');
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
            if (document.visibilityState === 'visible') {
                clearBadge();
                
                // 🌟 iOS対策：バックグラウンド復帰時にFirestoreリスナーを再接続
                if (CURRENT_USER) {
                    // 受信箱のリスナーを再接続
                    this.startInboxListener();
                    
                    // チャット画面が開いている場合はチャットリスナーも再接続
                    if (currentChatContext) {
                        const ctx = currentChatContext;
                        if(unsubscribeChat) unsubscribeChat();
                        if(unsubscribeRoomMeta) unsubscribeRoomMeta();
                        this.openChat(ctx.groupId, ctx.myId, ctx.targetId, ctx.targetName, true);
                    }
                }
            }
        });

        document.querySelectorAll('.bottom-nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                haptic(5);
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
                this.showToast(TRANSLATIONS["msg_test_acc_block"][currentLang], '', 'error'); 
                return; 
            }
            if(confirm(TRANSLATIONS["msg_confirm_withdraw"][currentLang])) { 
                const btn = document.getElementById('btn-show-withdraw');
                btn.disabled = true;
                try {
                    await DB.deleteUserAccount(CURRENT_USER);
                    
                    if (auth.currentUser) {
                        await deleteUser(auth.currentUser);
                    }
                    
                    localStorage.removeItem('app_user_v3');
                    alert(TRANSLATIONS["msg_withdraw_success"][currentLang]); 
                    location.reload();
                    
                } catch (e) {
                    console.error("退会エラー:", e);
                    btn.disabled = false;
                    if (e.code === 'auth/requires-recent-login') {
                        alert(TRANSLATIONS["msg_withdraw_relogin"][currentLang]); 
                    } else {
                        alert(TRANSLATIONS["msg_withdraw_fail"][currentLang]); 
                    }
                }
            }
        });

        window.openFullscreenImage = (src) => {
            // 🛡️ 許可されたURLだけ表示する（外部の悪意あるURLをブロック）
            const isAllowed = 
                src.startsWith('https://firebasestorage.googleapis.com/') ||
                src.startsWith('https://storage.googleapis.com/') ||
                src.startsWith('data:image/') ||
                src.startsWith('images/');
            
            if (!isAllowed) {
                console.warn('許可されていない画像URLをブロックしました:', src);
                return;
            }
            
            document.getElementById('fullscreen-img').src = src;
            const modal = new bootstrap.Modal(document.getElementById('imageFullscreenModal'));
            modal.show();
        };
    },

    async renderChatList() {
        // 🌟 スケルトン表示
        showSkeleton('chat-list', 'list', 3);
        
        const groupUsers = await DB.getGroupUsers(CURRENT_USER.group);
        const targets = groupUsers.filter(u => u.id !== CURRENT_USER.id);
        
        const container = document.getElementById('chat-list');
        container.innerHTML = '';
        if (groupUsers.length >= 3) {
            const roomId = DB.getChatRoomId(CURRENT_USER.group, CURRENT_USER.id, "ALL");
            const meta = await DB.getRoomMeta(roomId);
            const hasUnread = meta && meta.updatedAt && (
                !meta[`lastRead_${CURRENT_USER.id}`] || 
                meta.updatedAt.toMillis() > meta[`lastRead_${CURRENT_USER.id}`].toMillis()
            ) && meta.lastSenderId !== CURRENT_USER.id;

            const allDiv = document.createElement('div');
            allDiv.className = 'p-3 border-bottom d-flex align-items-center clickable';
            allDiv.style.backgroundColor = hasUnread ? '#e0f2e0' : '#e8f5e9';
            
            let previewHtml = `<div class="small text-muted">${TRANSLATIONS["chat_tap_to_open"][currentLang]}</div>`;
            if (meta && meta.lastMessage) {
                const senderIcon = meta.lastSenderIcon || '👤';
                const senderName = escapeHTML(meta.lastSenderName || '');
                const preview = escapeHTML(meta.lastMessage.substring(0, 30)) + (meta.lastMessage.length > 30 ? '...' : '');
                previewHtml = `<div class="small text-muted text-truncate" style="max-width: 200px;">${hasUnread ? senderIcon + ' ' : ''}${senderName}: ${preview}</div>`;
            }

            allDiv.innerHTML = `
                <div class="rounded-circle text-white d-flex align-items-center justify-content-center me-3 shadow-sm position-relative" style="width:40px; height:40px; font-size:20px; background-color: var(--primary-color);">📢
                    ${hasUnread ? '<span class="chat-unread-dot"></span>' : ''}
                </div>
                <div class="flex-grow-1 overflow-hidden">
                    <div class="fw-bold">グループ全体チャット <span class="badge bg-secondary ms-1">全員</span></div>
                    ${previewHtml}
                </div>
            `;
            allDiv.onclick = () => this.openChat(CURRENT_USER.group, CURRENT_USER.id, "ALL", "グループ全体チャット");
            container.appendChild(allDiv);
        }
        for (const target of targets) {
            const safeIcon = target.icon || "👤";
            const roomId = DB.getChatRoomId(CURRENT_USER.group, CURRENT_USER.id, target.id);
            const meta = await DB.getRoomMeta(roomId);
            const hasUnread = meta && meta.updatedAt && (
                !meta[`lastRead_${CURRENT_USER.id}`] || 
                meta.updatedAt.toMillis() > meta[`lastRead_${CURRENT_USER.id}`].toMillis()
            ) && meta.lastSenderId !== CURRENT_USER.id;

            let previewHtml = `<div class="small text-muted">${TRANSLATIONS["chat_tap_to_open"][currentLang]}</div>`;
            if (meta && meta.lastMessage) {
                const preview = escapeHTML(meta.lastMessage.substring(0, 30)) + (meta.lastMessage.length > 30 ? '...' : '');
                previewHtml = `<div class="small ${hasUnread ? 'text-dark fw-bold' : 'text-muted'} text-truncate" style="max-width: 200px;">${preview}</div>`;
            }

            const div = document.createElement('div');
            div.className = 'p-3 border-bottom d-flex align-items-center clickable';
            div.style.backgroundColor = hasUnread ? '#f0f8ff' : 'white';
            div.innerHTML = `
                <div class="rounded-circle bg-secondary text-white d-flex align-items-center justify-content-center me-3 position-relative" style="width:40px; height:40px; font-size:20px;">${safeIcon}
                    ${hasUnread ? '<span class="chat-unread-dot"></span>' : ''}
                </div>
                <div class="flex-grow-1 overflow-hidden">
                    <div class="fw-bold">${escapeHTML(target.name)} <span class="badge bg-light text-dark ms-1">${target.role === 'leader' ? 'master' : 'slave'}</span></div>
                    ${previewHtml}
                </div>
            `;
            div.onclick = () => this.openChat(CURRENT_USER.group, CURRENT_USER.id, target.id, target.name);
            container.appendChild(div);
        }
    },

    openChat(groupId, myId, targetId, targetName, isReconnect = false) {
        if (!isReconnect) {
            history.pushState({chat: true}, '', '#chat'); 
        }

        currentChatTargetId = DB.getChatRoomId(groupId, myId, targetId);
        currentChatContext = { groupId, myId, targetId, targetName }; // 🌟 復帰時の再接続用に保存

        if (!isReconnect) {
            document.getElementById('chat-container').classList.add('d-none');
            const chatDetailEl = document.getElementById('chat-detail-container');
            chatDetailEl.classList.remove('d-none');
            // 🌟 スライドインアニメーション
            chatDetailEl.classList.add('slide-enter');
            chatDetailEl.classList.remove('slide-active');
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    chatDetailEl.classList.remove('slide-enter');
                    chatDetailEl.classList.add('slide-active');
                });
            });
            document.getElementById('chat-target-name').textContent = targetName;
            document.getElementById('chat-input-area').classList.remove('d-none');
            document.querySelector('.bottom-nav').classList.add('d-none');
        }

        if(unsubscribeChat) unsubscribeChat();
        if(unsubscribeRoomMeta) unsubscribeRoomMeta();

        const detailContainer = document.getElementById('chat-detail-container');
        const isGroupChat = targetId === "ALL";
        
        let roomMeta = {};
        let currentMessages = [];
        let prevMessageCount = 0;
        let isFirstLoad = true;

        // 🌟 レンダリングの一元管理（競合防止）
        let renderScheduled = false;
        let pendingScrollToBottom = false;

        function scheduleRender(scrollToBottom = false) {
            if (scrollToBottom) pendingScrollToBottom = true;
            if (renderScheduled) return;
            renderScheduled = true;
            requestAnimationFrame(() => {
                renderScheduled = false;
                const doScroll = pendingScrollToBottom;
                pendingScrollToBottom = false;
                renderChatMessages(currentMessages, roomMeta, doScroll);
            });
        }

        // 🌟 既読情報のリアルタイム購読（メタ変更時は既読ラベルだけ更新）
        unsubscribeRoomMeta = DB.subscribeRoomMeta(currentChatTargetId, (meta) => {
            roomMeta = meta;
            if (currentMessages.length > 0) {
                scheduleRender(false);
            }
        });

        // 🌟 既読時刻の更新（連続書き込み防止のためデバウンス）
        let lastReadTimer = null;
        function debouncedUpdateLastRead() {
            if (lastReadTimer) clearTimeout(lastReadTimer);
            lastReadTimer = setTimeout(() => {
                DB.updateLastRead(currentChatTargetId, CURRENT_USER.id);
            }, 500);
        }
        
        // 初回の既読更新
        debouncedUpdateLastRead();

        const self = this;

        function getReadCount(msg, meta) {
            if (!msg.createdAt) return 0;
            let count = 0;
            for (const [key, value] of Object.entries(meta)) {
                if (key.startsWith('lastRead_') && key !== `lastRead_${CURRENT_USER.id}`) {
                    if (value && value.toMillis && msg.createdAt.toMillis && value.toMillis() >= msg.createdAt.toMillis()) {
                        count++;
                    }
                }
            }
            return count;
        }

        function renderChatMessages(messages, meta, scrollToBottom = false) {
            const msgContainer = document.getElementById('chat-messages');
            if (!msgContainer) return;
            const previousScrollTop = detailContainer.scrollTop;
            msgContainer.innerHTML = '';

            let lastDateStr = '';

            messages.forEach(msg => {
                const isMe = msg.senderId === CURRENT_USER.id;

                // 🌟 日付セパレーター
                if (msg.createdAt) {
                    const msgDate = msg.createdAt.toDate();
                    const dateStr = `${msgDate.getFullYear()}/${msgDate.getMonth()+1}/${msgDate.getDate()}`;
                    if (dateStr !== lastDateStr) {
                        const separator = document.createElement('div');
                        separator.className = 'chat-date-separator';
                        const today = new Date();
                        const yesterday = new Date(today);
                        yesterday.setDate(yesterday.getDate() - 1);
                        
                        let displayDate = dateStr;
                        if (dateStr === `${today.getFullYear()}/${today.getMonth()+1}/${today.getDate()}`) {
                            displayDate = currentLang === 'ja' ? '今日' : currentLang === 'zh' ? '今天' : 'Today';
                        } else if (dateStr === `${yesterday.getFullYear()}/${yesterday.getMonth()+1}/${yesterday.getDate()}`) {
                            displayDate = currentLang === 'ja' ? '昨日' : currentLang === 'zh' ? '昨天' : 'Yesterday';
                        }
                        separator.innerHTML = `<span>${displayDate}</span>`;
                        msgContainer.appendChild(separator);
                        lastDateStr = dateStr;
                    }
                }
                
                // 🌟 削除済みメッセージの表示
                if (msg.isDeleted) {
                    const iconHtml = !isMe ? `
                        <div class="flex-shrink-0 me-2 mt-1 d-flex flex-column align-items-center" style="width: 45px;">
                            <div style="font-size:28px; line-height:1;">${msg.senderIcon || '👤'}</div>
                            <div style="font-size: 0.55rem; color: #666; margin-top: 2px; text-align: center; line-height: 1.1; word-break: break-all;">${escapeHTML(msg.senderName || '')}</div>
                        </div>
                    ` : '';
                    const div = document.createElement('div');
                    div.className = `d-flex align-items-start chat-row ${isMe ? 'justify-content-end' : 'justify-content-start'}`;
                    div.innerHTML = `
                        ${iconHtml}
                        <div style="max-width: 75%;">
                            <div class="p-2 rounded deleted-message">
                                <i class="bi bi-trash3"></i> ${TRANSLATIONS["msg_deleted"][currentLang]}
                            </div>
                        </div>
                    `;
                    msgContainer.appendChild(div);
                    return;
                }

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

                // 🌟 既読表示の生成
                let readHtml = '';
                if (isMe && msg.createdAt) {
                    const readCount = getReadCount(msg, meta);
                    if (readCount > 0) {
                        const readText = isGroupChat 
                            ? `${TRANSLATIONS["read_label"][currentLang]}${readCount}` 
                            : TRANSLATIONS["read_label"][currentLang];
                        readHtml = `<div style="font-size: 0.6rem; color: #4CAF50; white-space: nowrap; text-align: right;">${readText}</div>`;
                    }
                }

                const timeHtml = timeStr ? `<div style="font-size: 0.65rem; color: #888; margin: 0 4px; align-self: flex-end; padding-bottom: 2px; white-space: nowrap;">${readHtml}${timeStr}</div>` : '';

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
                    const imgPlaceholderId = `img-${msg.id}-${Date.now()}`;
                    
                    if (!msg.text) {
                        imagesBlock = `
                            <div class="d-flex align-items-end">
                                ${isMe ? timeHtml : ''}
                                <div style="position: relative;" class="chat-bubble-content">
                                    <div id="${imgPlaceholderId}" class="d-flex flex-wrap gap-1 mt-1 ${isMe ? 'justify-content-end' : 'justify-content-start'}" style="max-width: 210px;" onclick="event.stopPropagation();">
                                    </div>
                                    ${reactionHtml}
                                </div>
                                ${!isMe ? timeHtml : ''}
                            </div>
                        `;
                    } else {
                        imagesBlock = `
                            <div id="${imgPlaceholderId}" class="d-flex flex-wrap gap-1 ${isMe ? 'justify-content-end' : 'justify-content-start'}" style="max-width: 210px;" onclick="event.stopPropagation();">
                            </div>
                        `;
                    }

                    setTimeout(() => {
                        const placeholder = document.getElementById(imgPlaceholderId);
                        if (placeholder) {
                            msg.images.forEach(imgUrl => {
                                // 🌟 プログレッシブ画像読み込み
                                const imgEl = createProgressiveImg(imgUrl, 'img-fluid rounded clickable', 'width: 100px; height: 100px; object-fit: cover;');
                                imgEl.onclick = (e) => {
                                    e.stopPropagation();
                                    window.openFullscreenImage(imgUrl);
                                };
                                placeholder.appendChild(imgEl);
                            });
                        }
                    }, 0);
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
                            pressTimer = setTimeout(() => { haptic(20); DB.toggleReaction(groupId, myId, targetId, msg.id, CURRENT_USER.id); }, 500);
                        }, {passive:true});
                        bubble.addEventListener('touchend', () => clearTimeout(pressTimer));
                        bubble.addEventListener('touchmove', () => clearTimeout(pressTimer), {passive:true});
                    });
                }

                // 🌟 変更：自分のメッセージをタップ → 編集＋削除モーダル
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
                                    <div class="modal-dialog">
                                        <div class="modal-content">
                                            <div class="modal-header">
                                                <h5 class="modal-title">${TRANSLATIONS["edit_modal_title"][currentLang]}</h5>
                                                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                                            </div>
                                            <div class="modal-body">
                                                <textarea id="chat-edit-textarea" class="form-control" rows="5" style="resize: none;"></textarea>
                                            </div>
                                            <div class="modal-footer">
                                                <button type="button" class="btn btn-outline-danger me-auto" id="chat-delete-btn"><i class="bi bi-trash3"></i> ${TRANSLATIONS["edit_modal_delete"][currentLang]}</button>
                                                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">${TRANSLATIONS["edit_modal_cancel"][currentLang]}</button>
                                                <button type="button" class="btn btn-primary" id="chat-edit-save-btn">${TRANSLATIONS["edit_modal_save"][currentLang]}</button>
                                            </div>
                                        </div>
                                    </div>
                                `;
                                document.body.appendChild(editModalEl);
                            }

                            const textarea = document.getElementById('chat-edit-textarea');
                            textarea.value = msg.text;
                            
                            // 編集モーダルでは編集欄と保存ボタンを表示
                            textarea.classList.remove('d-none');
                            document.getElementById('chat-edit-save-btn').classList.remove('d-none');
                            
                            const editModal = new bootstrap.Modal(editModalEl);
                            editModal.show();

                            // 保存ボタン
                            const saveBtn = document.getElementById('chat-edit-save-btn');
                            const newSaveBtn = saveBtn.cloneNode(true);
                            saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);
                            
                            newSaveBtn.onclick = async () => {
                                document.activeElement?.blur();
                                const newText = textarea.value;
                                if (newText.trim() !== "" && newText !== msg.text) {
                                    newSaveBtn.disabled = true;
                                    try { await DB.updateMessage(groupId, myId, targetId, msg.id, newText); }
                                    catch(e) { console.error("Edit Error:", e); }
                                    finally { newSaveBtn.disabled = false; }
                                }
                                editModal.hide();
                            };

                            // 🌟 削除ボタン
                            const deleteBtn = document.getElementById('chat-delete-btn');
                            const newDeleteBtn = deleteBtn.cloneNode(true);
                            deleteBtn.parentNode.replaceChild(newDeleteBtn, deleteBtn);
                            
                            newDeleteBtn.onclick = async () => {
                                if (confirm(TRANSLATIONS["msg_confirm_delete_msg"][currentLang])) {
                                    newDeleteBtn.disabled = true;
                                    try { await DB.deleteMessage(groupId, myId, targetId, msg.id); }
                                    catch(e) { console.error("Delete Error:", e); }
                                    finally { newDeleteBtn.disabled = false; }
                                    editModal.hide();
                                }
                            };
                        };
                    }
                }
                // 🌟 新規：画像のみメッセージの削除対応
                else if (isMe && !msg.text && msg.images && msg.images.length > 0) {
                    const imgContainer = div.querySelector('.chat-bubble-content');
                    if (imgContainer) {
                        imgContainer.onclick = (e) => {
                            // 画像のフルスクリーン表示のクリックと区別するためstopPropagationされていない場合のみ
                            if (e.target.tagName === 'IMG') return;
                            
                            let editModalEl = document.getElementById('chatEditModal');
                            if (!editModalEl) {
                                editModalEl = document.createElement('div');
                                editModalEl.id = 'chatEditModal';
                                editModalEl.className = 'modal fade';
                                editModalEl.tabIndex = -1;
                                editModalEl.innerHTML = `
                                    <div class="modal-dialog">
                                        <div class="modal-content">
                                            <div class="modal-header">
                                                <h5 class="modal-title">${TRANSLATIONS["edit_modal_title"][currentLang]}</h5>
                                                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                                            </div>
                                            <div class="modal-body">
                                                <textarea id="chat-edit-textarea" class="form-control d-none" rows="5" style="resize: none;"></textarea>
                                            </div>
                                            <div class="modal-footer">
                                                <button type="button" class="btn btn-outline-danger me-auto" id="chat-delete-btn"><i class="bi bi-trash3"></i> ${TRANSLATIONS["edit_modal_delete"][currentLang]}</button>
                                                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">${TRANSLATIONS["edit_modal_cancel"][currentLang]}</button>
                                                <button type="button" class="btn btn-primary d-none" id="chat-edit-save-btn">${TRANSLATIONS["edit_modal_save"][currentLang]}</button>
                                            </div>
                                        </div>
                                    </div>
                                `;
                                document.body.appendChild(editModalEl);
                            }
                            
                            // 画像のみモーダルでは編集欄と保存ボタンを非表示
                            document.getElementById('chat-edit-textarea').classList.add('d-none');
                            document.getElementById('chat-edit-save-btn').classList.add('d-none');
                            
                            const editModal = new bootstrap.Modal(editModalEl);
                            editModal.show();

                            const deleteBtn = document.getElementById('chat-delete-btn');
                            const newDeleteBtn = deleteBtn.cloneNode(true);
                            deleteBtn.parentNode.replaceChild(newDeleteBtn, deleteBtn);
                            
                            newDeleteBtn.onclick = async () => {
                                if (confirm(TRANSLATIONS["msg_confirm_delete_msg"][currentLang])) {
                                    newDeleteBtn.disabled = true;
                                    try { await DB.deleteMessage(groupId, myId, targetId, msg.id); }
                                    catch(e) { console.error("Delete Error:", e); }
                                    finally { newDeleteBtn.disabled = false; }
                                    editModal.hide();
                                }
                            };
                        };

                        // 🌟 画像のみメッセージ：長押しでも削除モーダルを表示
                        let imgPressTimer;
                        imgContainer.addEventListener('touchstart', () => {
                            imgPressTimer = setTimeout(() => { imgContainer.onclick({ target: imgContainer }); }, 500);
                        }, {passive:true});
                        imgContainer.addEventListener('touchend', () => clearTimeout(imgPressTimer));
                        imgContainer.addEventListener('touchmove', () => clearTimeout(imgPressTimer), {passive:true});
                    }
                }

                msgContainer.appendChild(div);
            });

            // 🌟 スクロール制御（一元管理）
            if (scrollToBottom) {
                setTimeout(() => { detailContainer.scrollTop = detailContainer.scrollHeight; }, 50);
            } else {
                detailContainer.scrollTop = previousScrollTop;
            }
        }

        unsubscribeChat = DB.subscribeChat(groupId, myId, targetId, (messages) => {
            currentMessages = messages;

            const currentMessageCount = messages.length;
            const shouldScroll = isFirstLoad || currentMessageCount > prevMessageCount;
            
            scheduleRender(shouldScroll);

            if (isFirstLoad) isFirstLoad = false;
            prevMessageCount = currentMessageCount;

            // 🌟 既読時刻を更新（デバウンス付き）
            debouncedUpdateLastRead();
        });
        
        document.getElementById('back-to-chat-list').onclick = () => {
            document.querySelector('.bottom-nav').classList.remove('d-none');
            currentChatContext = null; // 🌟 復帰時再接続の対象外にする
            // 🌟 チャット一覧に戻る時にリストを更新（既読状態の反映）
            this.renderChatList();
            history.back();
        };
        
        document.getElementById('chat-send-btn').onclick = async () => {
            const input = document.getElementById('chat-message-input');
            const sendBtn = document.getElementById('chat-send-btn');
            const text = input.value;
            if(!text && chatImagesBase64.length === 0) return;
            
            sendBtn.disabled = true;
            haptic();
            try {
                await DB.sendMessage(groupId, myId, targetId, CURRENT_USER, text, chatImagesBase64);
                input.value = '';
                input.style.height = '38px'; 
                chatImagesBase64 = [];
                self.updateImagePreview('chat-image-preview', chatImagesBase64, 'chat-image-file');
                input.blur();
                setTimeout(() => { detailContainer.scrollTop = detailContainer.scrollHeight; }, 100);
            } catch(e) { console.error("Send Error:", e); }
            finally { sendBtn.disabled = false; }
        };
    },
    
    startInboxListener() {
        if(unsubscribeInbox) unsubscribeInbox();
        
        // 🌟 スケルトン表示
        showSkeleton('inbox-list', 'card', 4);
        
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

                // 🌟 新規：複数メンバー完了進捗の表示
                let progressHtml = '';
                if (isInstruction) {
                    const completedByList = app.completedByList || [];
                    const targetMemberIds = app.targetMemberIds || [];
                    if (targetMemberIds.length > 1) {
                        progressHtml = `<span class="badge ${completedByList.length >= targetMemberIds.length ? 'bg-secondary' : 'bg-info'} ms-1">${completedByList.length}/${targetMemberIds.length} ${TRANSLATIONS["completion_progress"][currentLang]}</span>`;
                    } else if (isInstructionCompleted) {
                        progressHtml = `<span class="badge bg-secondary ms-1">${TRANSLATIONS["completion_progress"][currentLang]}</span>`;
                    }
                }

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
                            ${progressHtml}
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
                            deleteBtn.disabled = true;
                            try { await DB.deleteApplication(app.id); }
                            catch(err) { console.error("Delete Error:", err); }
                            finally { deleteBtn.disabled = false; }
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
                        // 🌟 変更：自分が completedByList に含まれているかで判定
                        const completedByList = app.completedByList || [];
                        const myCompleted = completedByList.includes(CURRENT_USER.id);
                        btnStateCompleted = myCompleted;
                        
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
                                document.activeElement?.blur();
                                const comment = document.getElementById('completion-comment').value.trim();
                                
                                if (!comment && completionImagesBase64.length === 0) {
                                    App.showToast(TRANSLATIONS["msg_completion_error"][currentLang], '', 'error'); 
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
                                    App.showToast(TRANSLATIONS["msg_report_fail"][currentLang], '', 'error'); 
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
                            const target = e.currentTarget;
                            target.disabled = true;
                            try { await DB.markAsConfirmed(app.id); }
                            catch(err) { console.error("Confirm Error:", err); target.disabled = false; }
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
                const el = createProgressiveImg(img, 'image-preview-item clickable');
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
        
        if (appData.type === 'instruction' && (appData.status === 'completed' || (appData.completedByList && appData.completedByList.length > 0))) {
            completionArea.classList.remove('d-none');
            completionImagesContainer.innerHTML = '';
            
            // 🌟 変更：メンバーごとの完了報告を表示
            const completionReports = appData.completionReports || {};
            const completedByList = appData.completedByList || [];
            
            if (Object.keys(completionReports).length > 0) {
                let reportsHtml = '';
                for (const [userId, report] of Object.entries(completionReports)) {
                    const memberName = completedByList.includes(userId) ? userId : userId;
                    reportsHtml += `<div class="mb-2 p-2 bg-white rounded border">
                        <div class="small fw-bold text-success"><i class="bi bi-person-check"></i> ${escapeHTML(memberName)}</div>
                        <div style="white-space: pre-wrap; font-size: 0.9rem;">${escapeHTML(report.comment || '（コメントなし）')}</div>
                    </div>`;
                    
                    if (report.images && report.images.length > 0) {
                        report.images.forEach(img => {
                            const el = createProgressiveImg(img, 'image-preview-item clickable');
                            el.onclick = () => window.openFullscreenImage(img);
                            completionImagesContainer.appendChild(el);
                        });
                    }
                }
                completionComment.innerHTML = reportsHtml;
            } else {
                // 後方互換：旧形式の単一報告
                completionComment.textContent = appData.completionComment || '（コメントなし）';
                if(appData.completionImages && appData.completionImages.length > 0) {
                    appData.completionImages.forEach(img => {
                        const el = createProgressiveImg(img, 'image-preview-item clickable');
                        el.onclick = () => window.openFullscreenImage(img);
                        completionImagesContainer.appendChild(el);
                    });
                }
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
                        document.activeElement?.blur(); // 🛡️ iOS対策
                        haptic();
                        const btn = document.getElementById('btn-approve');
                        btn.disabled = true;
                        try { await DB.updateStatus(appData.id, 'approved', commentInput.value, CURRENT_USER.id); closeModal(); }
                        catch(e) { console.error("Approve Error:", e); btn.disabled = false; }
                    };
                    document.getElementById('btn-reject').onclick = async () => {
                        document.activeElement?.blur(); // 🛡️ iOS対策
                        haptic();
                        const btn = document.getElementById('btn-reject');
                        btn.disabled = true;
                        try { await DB.updateStatus(appData.id, 'rejected', commentInput.value, CURRENT_USER.id); closeModal(); }
                        catch(e) { console.error("Reject Error:", e); btn.disabled = false; }
                    };
                } else {
                    document.getElementById('judge-btn-group').classList.add('d-none');
                    document.getElementById('btn-cancel-judge').classList.remove('d-none');
                    
                    document.getElementById('btn-cancel-judge').onclick = async () => {
                        const btn = document.getElementById('btn-cancel-judge');
                        btn.disabled = true;
                        try { await DB.updateStatus(appData.id, 'pending', '', CURRENT_USER.id); closeModal(); }
                        catch(e) { console.error("Cancel Judge Error:", e); btn.disabled = false; }
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
                App.showToast(TRANSLATIONS["msg_max_images"][currentLang], '', 'error'); 
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
            
            // 🛡️ XSS対策：createElementで安全に画像を追加
            const imgEl = document.createElement('img');
            imgEl.src = img;
            imgEl.className = 'image-preview-item clickable';
            imgEl.onclick = () => window.openFullscreenImage(img);
            wrapper.appendChild(imgEl);
            
            const closeBtn = document.createElement('div');
            closeBtn.className = 'custom-close-preview';
            closeBtn.innerHTML = '<i class="bi bi-x"></i>';
            closeBtn.onclick = (e) => {
                e.stopPropagation(); 
                imageArray.splice(index, 1);
                this.updateImagePreview(containerId, imageArray, inputId); 
            };
            wrapper.appendChild(closeBtn);
            
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
        
        // 🛡️ iOS対策：キーボード表示時にチャットを最下部にスクロールする
        tx.addEventListener('focus', () => {
            setTimeout(() => {
                const container = document.getElementById('chat-detail-container');
                if (container && !container.classList.contains('d-none')) {
                    container.scrollTop = container.scrollHeight;
                }
            }, 300); // iOS キーボードアニメーション完了を待つ
        });
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
            if (targetSelect.selectedIndex >= 0) {
                targetUserName = targetSelect.options[targetSelect.selectedIndex].text;
            } else {
                targetUserName = "宛先不明";
            }
        }

        // 🌟 新規：命令の対象メンバーIDリストを生成
        let targetMemberIds = [];
        if (CURRENT_USER.role === 'leader') {
            if (targetUserId) {
                targetMemberIds = [targetUserId];
            } else {
                // 全員宛 → グループ内の全メンバーを対象にする
                const groupUsers = await DB.getGroupUsers(CURRENT_USER.group);
                targetMemberIds = groupUsers.filter(u => u.role === 'member').map(u => u.id);
            }
        }
        
        const data = {
            title: title,
            content: content,
            userId: CURRENT_USER.id,
            userName: CURRENT_USER.name || "名称未設定",
            groupId: CURRENT_USER.group,
            type: CURRENT_USER.role === 'leader' ? 'instruction' : 'request',
            images: formImagesBase64,
            targetUserId: targetUserId,
            targetUserName: targetUserName,
            targetMemberIds: targetMemberIds,
            completedByList: []
        };
        
        try {
            const submitBtn = document.getElementById('form-submit-btn');
            submitBtn.disabled = true;
            submitBtn.textContent = TRANSLATIONS["login_authenticating"]?.[currentLang] || "送信中...";
            
            await DB.submitForm(data);
            this.showToast(TRANSLATIONS["msg_submit_success"][currentLang], '', 'success');
            haptic();
            document.getElementById('form-content').value = '';
            formImagesBase64 = [];
            this.updateImagePreview('form-image-preview', formImagesBase64, 'form-image-file');
            document.querySelector('.bottom-nav-item[href="#tab-inbox"]').click(); 
        } catch(e) { 
            console.error(e); 
            this.showToast(TRANSLATIONS["msg_submit_fail"][currentLang], '', 'error'); 
        } finally {
            const submitBtn = document.getElementById('form-submit-btn');
            submitBtn.disabled = false;
            submitBtn.textContent = TRANSLATIONS["form_submit"][currentLang] || "送信";
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

    showToast(title, body, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;
        
        const iconMap = {
            success: 'bi-check-circle-fill',
            error: 'bi-exclamation-triangle-fill',
            info: 'bi-bell-fill'
        };
        
        const toast = document.createElement('div');
        toast.className = `app-toast toast-${type}`;
        toast.innerHTML = `<i class="bi ${iconMap[type] || iconMap.info} me-3 fs-4"></i><div><strong class="d-block">${escapeHTML(title)}</strong>${body ? `<span class="small">${escapeHTML(body)}</span>` : ''}</div>`;
        
        toast.onclick = () => {
            toast.classList.add('toast-exit');
            setTimeout(() => toast.remove(), 300);
        };
        container.appendChild(toast);
        
        setTimeout(() => {
            if (toast.parentNode) {
                toast.classList.add('toast-exit');
                setTimeout(() => { if (toast.parentNode) toast.remove(); }, 300);
            }
        }, 3500);
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
                
                // 🌟 onMessageリスナーの重複登録を防止
                if (!notificationListenerRegistered) {
                    notificationListenerRegistered = true;
                    onMessage(messaging, (payload) => { 
                        const senderId = payload.data?.senderId;
                        if (senderId === CURRENT_USER.id) return; 

                        console.log('Foreground Message:', payload); 
                        const title = payload.notification?.title || '新着通知';
                        const body = payload.notification?.body || '';
                        const tabType = payload.data?.tab || 'inbox'; 
                        
                        // 🌟 チャット画面を開いている場合はトーストを抑制
                        const chatDetail = document.getElementById('chat-detail-container');
                        const isChatOpen = chatDetail && !chatDetail.classList.contains('d-none');
                        
                        if (!(isChatOpen && tabType === 'chat')) {
                            this.showToast(title, body);
                        }
                        this.addTabBadge(`#tab-${tabType}`);
                    });
                }
            }
        } catch (error) { console.error('Notification setup failed:', error); }
    }
};

window.app = App;
window.onload = () => App.init();

